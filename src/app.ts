import { join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import type pg from "pg";
import type { AppConfig } from "./config.js";
import { LongboxError } from "./contracts/v1/errors.js";
import { API_PREFIX, TENANT_PREFIX } from "./contracts/v1/schemas.js";
import { DEPRECATION_HEADERS } from "./contracts/v1/routes.js";
import { registerErrorHandling } from "./http/errors.js";
import { registerScanSessionRoutes, registerShopRoutes } from "./routes/scanSessions.js";
import { ShopRateLimiter } from "./services/rateLimit.js";
import type { ApiDeps } from "./services/sessionApi.js";

export interface BuildAppOptions {
  /** Injected so the rate posture is testable without wall-clock sleeps. */
  limiter?: ShopRateLimiter;
}

/**
 * The registered route table, captured through Fastify's own `onRoute` hook.
 *
 * 019 T35(b) requires "a CI walk of Fastify's REGISTERED route table (not a
 * hand-kept list) that fails closed on any unclassified route", and this is what
 * the walk reads. A hand-kept list would be a second declaration of the surface,
 * which is the failure this decoration exists to prevent.
 */
export interface RegisteredRoute {
  method: string;
  url: string;
}

declare module "fastify" {
  interface FastifyInstance {
    registeredRoutes: RegisteredRoute[];
  }
}

export async function buildApp(
  db: pg.Pool,
  config: AppConfig,
  opts: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      // Never log request bodies or headers (keys travel in neither, but belt-and-braces).
      redact: ["req.headers.authorization", "req.headers['x-api-key']"],
    },
  });

  const deps: ApiDeps = { pool: db, config, limiter: opts.limiter ?? new ShopRateLimiter() };

  app.decorate("registeredRoutes", [] as RegisteredRoute[]);
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) app.registeredRoutes.push({ method, url: route.url });
  });

  registerErrorHandling(app);

  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await app.register(fastifyStatic, { root: join(process.cwd(), "public"), prefix: "/" });
  await app.register(fastifyStatic, {
    root: join(process.cwd(), config.uploadsDir),
    prefix: `/${config.uploadsDir}/`,
    decorateReply: false,
  });

  app.get("/healthz", async () => ({ ok: true }));

  registerShopRoutes(app, deps);

  // 042 §3.4 half one — ONE prefix, ONE plugin. Every shop-scoped route is
  // registered inside this boundary and cannot spell a different one.
  await app.register(
    async (scoped) => {
      // 042 §8.1 — the ORDINARY class, keyed on `shop_id` and never on an IP. A
      // per-IP bucket throttles a whole shop behind one counter's Wi-Fi anyway
      // while mistaking two shops behind one carrier for one shop, and a
      // per-device bucket is a per-operator surface by the back door against a
      // line 019 signs at zero and marks non-waivable.
      scoped.addHook("onRequest", async (req) => {
        const shopId = (req.params as { shopId?: string } | undefined)?.shopId;
        if (!shopId) return;
        const decision = deps.limiter.takeOrdinary(shopId);
        if (!decision.allowed) {
          throw new LongboxError("RATE_LIMITED", { retry_after_seconds: decision.retryAfterSeconds });
        }
      });
      registerScanSessionRoutes(scoped, deps);
    },
    { prefix: TENANT_PREFIX }
  );

  registerUnversionedAliases(app);

  return app;
}

/**
 * THE UNVERSIONED ALIASES, AND WHICH REDIRECT (042 §2.3, §9.1 row 5).
 *
 * 042 fixes that the API is versioned in the path and that a deprecated surface
 * is served concurrently with `Deprecation` and `Sunset` headers; it does not
 * name a status code for the alias, and this bead had to choose one.
 *
 * **308 Permanent Redirect, not 301 and not 410.**
 *   - Not **410 Gone**: seven of the nine aliased routes are POSTs that WRITE,
 *     and E05-B08's offline queue is a second consumer BY CONSTRUCTION — a
 *     queued write is replayed by a client that is older than the one running
 *     (042 §2.2). Answering it `410` would discard an operator's act at the
 *     moment the client can least do anything about it. The queue does not exist
 *     yet, which is exactly why the shape must be right before it does.
 *   - Not **301 Moved Permanently**: 301 permits a client to rewrite a POST into
 *     a GET, and every agent in practice does. A redirect that silently turns a
 *     confirmation into a read is worse than no redirect.
 *   - **308** is the member of the same class that preserves method AND body, so
 *     an old client's POST arrives at `/api/v1/…` intact.
 *
 * A redirected write still has to satisfy `v1`, so a pre-v1 client that never
 * sent an `Idempotency-Key` gets `400 IDEMPOTENCY_KEY_REQUIRED` after the
 * redirect rather than a silent success. That is the honest answer: the alias
 * buys a client its URL back, not an exemption from the contract.
 *
 * Removal is E02-B10's contract step (042 §9.1 row 5), not a later judgement
 * call — the rows are on §3.4's allowlist as `exemption` with that bead named.
 */
function registerUnversionedAliases(app: FastifyInstance): void {
  const handler = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    reply.headers({ ...DEPRECATION_HEADERS });
    return reply.redirect(`${API_PREFIX}${req.url.slice("/api".length)}`, 308);
  };
  app.all("/api/shops", handler);
  app.all("/api/shops/*", handler);
}
