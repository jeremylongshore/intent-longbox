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
    const kindRaw = (file.fields.kind as { value?: string } | undefined)?.value ?? "cover";
    const kind = parse(contract.photoKind, kindRaw);
    const against = file.fields.against
      ? parse(contract.againstSchema, JSON.parse(String((file.fields.against as { value: string }).value)))
      : undefined;
    const ctx = { ...context(req, `${T}/scan-sessions/:id/photos`, shopId, id), sessionId: id };
    return send(
      reply,
      await api.uploadPhoto(deps, ctx, { stream: file.file, mimetype: file.mimetype, kind }, against)
    );
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

/**
 * `GET /api/v1/shops` — registered OUTSIDE the tenant plugin, and that is the
 * defect, not an oversight in where the line was typed.
 *
 * 042 §3.4's allowlist carries it as `kind: "defect"` with E03-B02/E03-B03 as
 * its closing bead: it returns every shop in the database to any caller (E4,
 * 034 E9), which is a live 019 T24 exposure — cross-tenant access = 0,
 * NON-WAIVABLE. It is not closed here because closing it means deciding who the
 * caller IS, and there is no caller identity before E03. The phone client
 * depends on it until there is.
 */
export function registerShopRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get(`${contract.API_PREFIX}/shops`, async () => api.listShops(deps.pool));
}
