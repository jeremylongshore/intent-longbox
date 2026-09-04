import { join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import type pg from "pg";
import { spendCeilings, type AppConfig } from "./config.js";
import { LongboxError } from "./contracts/v1/errors.js";
import { API_PREFIX, TENANT_PREFIX } from "./contracts/v1/schemas.js";
import { DEPRECATION_HEADERS } from "./contracts/v1/routes.js";
import { registerErrorHandling } from "./http/errors.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerScanSessionRoutes } from "./routes/scanSessions.js";
import { ShopRateLimiter } from "./services/rateLimit.js";
import type { ApiDeps } from "./services/sessionApi.js";
import { registerAuthentication } from "./services/auth/hook.js";

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

  // The metered ceilings come from the CONFIG, which has already refused an
  // unusable pair at boot (`assertSpendCeilingsOrThrow`, 050 §2 Q4(c)) — so a
  // limiter built here can never carry a number the config layer would reject.
  const ceilings = spendCeilings(config);
  const deps: ApiDeps = {
    pool: db,
    config,
    limiter:
      opts.limiter ??
      new ShopRateLimiter({ meteredPerDay: ceilings.shop, serviceAccountPerDay: ceilings.longbox }),
  };

  app.decorate("registeredRoutes", [] as RegisteredRoute[]);
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) app.registeredRoutes.push({ method, url: route.url });
  });

  registerErrorHandling(app);

  // ⚠ THE AUTHENTICATION HOOK IS REGISTERED HERE, AND THE POSITION IS THE DESIGN
  // (048 §5.3 R10, §6.2).
  //
  // It is an APP-LEVEL `onRequest`, so it runs before every plugin-level hook —
  // including the tenant plugin's rate bucket below, which is what lets that
  // bucket be keyed on the SESSION's shop rather than on `req.params.shopId`.
  // 046 G-20 assigned that fix to E13-B02 "after G-1"; it is not a separate
  // change, it is one line of ordering inside a hook this bead adds anyway.
  //
  // It is registered BEFORE `@fastify/multipart`, and that is the load-bearing
  // half. `onRequest` runs before any body parsing whatsoever, so a request that
  // will be refused — for a cross-site `Sec-Fetch-Site`, a missing
  // `Idempotency-Key` or a dead session — is refused having touched no disk, no
  // database and no session. Today the header requirement lives inside each
  // handler, which is AFTER multipart has begun consuming the body: a cross-site
  // request with no header has by then had up to 25 MiB streamed to disk. I6(b)
  // asserts the ORDERING and not merely the presence of the check, because a
  // check in the right place and a check in the wrong place return the same code.
  registerAuthentication(app, deps);

  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  // ONE static mount, and the second one is GONE (046 §6 Q5, E03-D05).
  //
  // `uploads/` used to be mounted here with no auth, no signature and no expiry:
  // every shop's photographs on one unscoped tree, readable by anyone who had or
  // guessed a URL — 046 §3.3 B5, the largest information-disclosure cell in §4.
  // The ruling was DELETE, not replace: the mount's only real consumer was the
  // phone client's preview (Shopify is handed root-relative paths it cannot
  // fetch — 046 E28), so removing it removes a reader and adds no design debt.
  // The preview now goes through `GET …/scan-sessions/:id/photos/:photoId`
  // INSIDE the tenant plugin, which means E03-B07 decides signed URLs later
  // against a surface that is already private rather than against a public one.
  await app.register(fastifyStatic, { root: join(process.cwd(), "public"), prefix: "/" });

  app.get("/healthz", async () => ({ ok: true }));

  // Four identity routes plus *my shops* (048 §6.4) — the five that establish a
  // tenant rather than assume one, and therefore the five that cannot live
  // inside the prefix plugin below.
  registerAuthRoutes(app, deps);

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
        // 048 §6.2, AND THIS IS THE WHOLE OF 046 G-20's FIX. The key is the
        // SESSION's shop, resolved by the authentication hook that has already
        // run, and `req.params.shopId` only when there is no session — which
        // after this bead means a route the auth allowlist exempted. 042 §8.1's
        // rule is "per shop, never per IP"; what ran before was "per
        // shop-id-string a caller chose", which is not the same rule.
        const shopId = req.auth?.shopId ?? (req.params as { shopId?: string } | undefined)?.shopId;
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
