// The HTTP edge, and nothing else.
//
// EVERY HANDLER IS THE SAME FOUR LINES: parse the params, parse the body against
// the declared contract, call ONE service function, send what it returns. There
// is no `db.query` in this file, no `pg` import, no `../db.js` import and no
// provider import — 029 §3.1's "the HTTP edge is thin", asserted by an exact
// inventory in `scripts/architectureRules.ts` (which now declares ZERO for this
// file rather than a defect row) and by two dependency-cruiser rules that no
// longer name it in a `pathNot` exemption.
//
// THE PREFIX IS STRUCTURAL (042 §3.4 half one). This file registers RELATIVE
// paths inside a plugin mounted once at `/api/v1/shops/:shopId`, so a route
// added here CANNOT be added without the tenant prefix: it does not spell the
// prefix at all. That removes the failure mode where a new route is registered
// against a different literal and looks identical to a reviewer — E3, "the
// tenant boundary is a convention held by one `const`". Half two, the route
// walk, is `tests/contract/route-table-scoping.test.ts`.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeAny } from "zod";
import { LongboxError } from "../contracts/v1/errors.js";
import * as contract from "../contracts/v1/schemas.js";
import type { ApiDeps, CallContext } from "../services/sessionApi.js";
import * as api from "../services/sessionApi.js";

/** The header 042 §5.1 makes REQUIRED on every mutating route. */
const IDEMPOTENCY_HEADER = "idempotency-key";

function parse<T extends ZodTypeAny>(schema: T, value: unknown): ReturnType<T["parse"]> {
  const result = schema.safeParse(value);
  if (!result.success) {
    // The Zod `flatten()` output is genuinely useful and today it is loose in the
    // `error` key with no type (042 E9). It becomes `details`, where a client can
    // give it a type — and it is never rendered to a person (§4.3).
    throw new LongboxError("VALIDATION_FAILED", result.error.flatten());
  }
  return result.data as ReturnType<T["parse"]>;
}

/**
 * THE REQUIREMENT MOVED; THE READ STAYED (048 §5.3, R10; E03-D09).
 *
 * The `Idempotency-Key` header is now REQUIRED by the authentication hook, in an
 * `onRequest` driven from the route table — ahead of `@fastify/multipart` and
 * ahead of the session read. That matters and it is not tidiness: this function
 * used to be the enforcement, and it runs inside a handler, which is AFTER
 * multipart has begun consuming the body. A cross-site request that will be
 * refused for a missing header had, by then, already had up to 25 MiB streamed to
 * disk. I6(b) asserts the ORDERING, not the presence, for exactly that reason.
 *
 * The throw below is now UNREACHABLE and stays anyway, because "the hook
 * guarantees it" is the kind of guarantee that stops holding when somebody edits
 * an allowlist row — and an empty string reaching `request_idempotency` would be
 * a row whose UNIQUE key is shared by every keyless request in the shop.
 */
function idempotencyKey(req: FastifyRequest): string {
  const raw = req.headers[IDEMPOTENCY_HEADER];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || key.length === 0 || key.length > 200) {
    throw new LongboxError("IDEMPOTENCY_KEY_REQUIRED");
  }
  return key;
}

function context(req: FastifyRequest, route: string, shopId: string, sessionId?: string): CallContext {
  return {
    shopId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    idempotencyKey: idempotencyKey(req),
    route,
    method: req.method,
    // 048 §6.3 and K1: the operator and the session lock come from the hook's
    // resolved principal. The handler passes them along and never derives them —
    // a route that computed either would be a second source of truth for who is
    // asking, which is the defect this whole bead exists to remove.
    ...(req.auth?.operatorId !== undefined ? { operatorId: req.auth.operatorId } : {}),
    ...(req.auth?.sessionLock !== undefined ? { sessionLock: req.auth.sessionLock } : {}),
  };
}

/** One shape for every mutating reply: the service decides the status. */
async function send(reply: FastifyReply, outcome: { status: number; body: unknown }): Promise<FastifyReply> {
  return reply.code(outcome.status).send(outcome.body);
}

/**
 * The shop-scoped surface. Registered by `buildApp` inside
 * `{ prefix: "/api/v1/shops/:shopId" }`; every path below is relative to it.
 */
export function registerScanSessionRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const T = contract.TENANT_PREFIX;

  app.post("/scan-sessions", async (req, reply) => {
    const { shopId } = parse(contract.shopParams, req.params);
    parse(contract.createSessionRequest, req.body ?? {});
    return send(reply, await api.createSession(deps, context(req, `${T}/scan-sessions`, shopId)));
  });

  app.get("/scan-sessions/:id", async (req) => {
    const { shopId, id } = parse(contract.sessionParams, req.params);
    return api.getSessionDetail(deps.pool, shopId, id);
  });

  app.post("/scan-sessions/:id/photos", async (req, reply) => {
    const { shopId, id } = parse(contract.sessionParams, req.params);
    const file = await req.file();
    if (!file) throw new LongboxError("PHOTO_FIELD_REQUIRED");
    const kindRaw = (file.fields["kind"] as { value?: string } | undefined)?.value ?? "cover";
    const kind = parse(contract.photoKind, kindRaw);
    const against = file.fields["against"]
      ? parse(contract.againstSchema, JSON.parse(String((file.fields["against"] as { value: string }).value)))
      : undefined;
    const ctx = { ...context(req, `${T}/scan-sessions/:id/photos`, shopId, id), sessionId: id };
    return send(
      reply,
      await api.uploadPhoto(deps, ctx, { stream: file.file, mimetype: file.mimetype, kind }, against)
    );
  });

  /**
   * The photo preview (E03-D05), and the reason it is HERE rather than a mount.
   *
   * `app.ts` used to publish `uploads/` statically: every shop's photographs on
   * one unscoped tree with no auth, no signature and no expiry (046 §3.3 B5).
   * 046 §6 Q5 ruled DELETE rather than replace, because the only consumer was
   * this preview — Shopify is handed root-relative paths it cannot fetch (E28).
   * Registered here, the route inherits the tenant prefix structurally and will
   * inherit E03-B02's authentication the moment it lands, which is the property
   * a mount could never have had.
   *
   * `private, no-store` because a shop's photograph must not sit in a shared
   * cache or on disk in a counter phone's browser after the shift ends.
   */
  app.get("/scan-sessions/:id/photos/:photoId", async (req, reply) => {
    const { shopId, id, photoId } = parse(contract.photoParams, req.params);
    const photo = await api.readPhoto(deps, shopId, id, photoId);
    return reply
      .header("cache-control", "private, no-store")
      .header("content-length", photo.contentLength)
      .header("x-content-type-options", "nosniff")
      .type(photo.contentType)
      .send(photo.stream);
  });

  app.post("/scan-sessions/:id/identify", async (req, reply) => {
    const { shopId, id } = parse(contract.sessionParams, req.params);
    const body = parse(contract.identifyRequest, req.body ?? {});
    const ctx = { ...context(req, `${T}/scan-sessions/:id/identify`, shopId, id), sessionId: id };
    return send(reply, await api.identify(deps, ctx, body));
  });

  app.post("/scan-sessions/:id/confirm", async (req, reply) => {
    const { shopId, id } = parse(contract.sessionParams, req.params);
    const body = parse(contract.confirmRequest, req.body);
    const ctx = { ...context(req, `${T}/scan-sessions/:id/confirm`, shopId, id), sessionId: id };
    return send(reply, await api.confirm(deps, ctx, body));
  });

  app.post("/scan-sessions/:id/condition", async (req, reply) => {
    const { shopId, id } = parse(contract.sessionParams, req.params);
    const body = parse(contract.conditionRequest, req.body);
    const ctx = { ...context(req, `${T}/scan-sessions/:id/condition`, shopId, id), sessionId: id };
    return send(reply, await api.assessCondition(deps, ctx, body));
  });

  app.post("/scan-sessions/:id/price", async (req, reply) => {
    const { shopId, id } = parse(contract.sessionParams, req.params);
    const body = parse(contract.priceRequest, req.body);
    const ctx = { ...context(req, `${T}/scan-sessions/:id/price`, shopId, id), sessionId: id };
    return send(reply, await api.price(deps, ctx, body));
  });

  app.post("/scan-sessions/:id/draft", async (req, reply) => {
    const { shopId, id } = parse(contract.sessionParams, req.params);
    const body = parse(contract.draftRequest, req.body ?? {});
    const ctx = { ...context(req, `${T}/scan-sessions/:id/draft`, shopId, id), sessionId: id };
    return send(reply, await api.requestDraft(deps, ctx, body));
  });
}

// `GET /api/v1/shops` USED TO BE REGISTERED HERE, and where it was typed is the
// whole of why it was broken. It sat outside the tenant plugin, so it never saw
// a hook, and it answered `SELECT id, name, slug FROM shop` — every shop in the
// database to any caller (042 E4, 034 E9, a live 019 T24 exposure and the
// tenancy allowlist's last `defect` row).
//
// E03-D08 moved it to `src/routes/auth.ts` and turned it into *my shops*
// (048 §6.4). It is an IDENTITY route: it answers which tenants a session may
// act on, so it belongs with the three routes that establish a tenant rather
// than with the fourteen that assume one. Nothing shop-scoped is registered
// outside the prefix plugin below any more.
