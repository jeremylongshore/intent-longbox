// The four authentication routes, and nothing else.
//
// Same shape as every other handler in this repository (029 §3.1's "the HTTP edge
// is thin"): parse the body against the declared contract, call ONE service
// function, send what it returns. No `db.query`, no `pg` import, no `../db.js`
// import — the architecture gate counts them and the count is zero.
//
// The one thing these handlers do that the scan-session handlers do not is
// PUSH COOKIES onto the request, where the authentication hook's `onSend` flushes
// them. That is deliberate: a `Set-Cookie` written from four places is four
// places to get `__Host-`, `SameSite` or the expiry wrong, and I6(a) asserts the
// attributes on every cookie this server emits.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeAny } from "zod";
import { LongboxError } from "../contracts/v1/errors.js";
import * as contract from "../contracts/v1/schemas.js";
import {
  endOperatorSession,
  myShops,
  openDeviceSession,
  openOperatorSession,
  operatorRoster,
  redeemEnrollmentCode,
  redeemInvitation,
  type AuthDeps,
  type AuthResult,
} from "../services/auth/api.js";

/** One header value, whatever Fastify's union says. Never an empty string. */
function headerValue(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value.length === 0 ? undefined : value;
}

function parse<T extends ZodTypeAny>(schema: T, value: unknown): ReturnType<T["parse"]> {
  const result = schema.safeParse(value);
  if (!result.success) throw new LongboxError("VALIDATION_FAILED", result.error.flatten());
  return result.data as ReturnType<T["parse"]>;
}

async function send(req: FastifyRequest, reply: FastifyReply, result: AuthResult): Promise<FastifyReply> {
  req.auth.cookies.push(...result.cookies);
  return reply.code(result.status).send(result.body);
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const P = contract.API_PREFIX;

  // The device's own front door. The hook lets it through anonymously because
  // the CREDENTIAL in the body is the authentication (048 §7.3).
  app.post(`${P}/device-sessions`, async (req, reply) => {
    const body = parse(contract.deviceSessionRequest, req.body ?? {});
    return send(req, reply, await openDeviceSession(deps, body.device_secret));
  });

  // The picker. Behind a live device session, because "who works here" is a
  // per-shop datum a passer-by on the same Wi-Fi has no claim on (048 R8).
  app.get(`${P}/operators`, async (req, reply) => {
    return send(req, reply, await operatorRoster(deps, requireDevice(req)));
  });

  // ***MY SHOPS*** (048 §6.4, E03-D08). Registered HERE, with the other three
  // routes that establish rather than assume a tenant — it used to live in
  // `routes/scanSessions.ts`, which is how it ended up outside the hook and
  // returning the whole `shop` table to anybody (048 E3, 042 E4).
  //
  // A device-only session is enough, because this is the route that tells a
  // freshly-enrolled phone which shop it is: requiring an operator would mean
  // the picker could not render before somebody had already picked.
  app.get(`${P}/shops`, async (req, reply) => {
    return send(req, reply, await myShops(deps, requireDevice(req), req.auth.operator));
  });

  app.post(`${P}/operator-sessions`, async (req, reply) => {
    const body = parse(contract.operatorSessionRequest, req.body ?? {});
    const result = await openOperatorSession(deps, requireDevice(req), {
      appUserId: body.app_user_id,
      pin: body.pin,
    });
    return send(req, reply, result);
  });

  // E03-D07. Behind a live DEVICE session (048 R15): an invitation is redeemable
  // only on a phone the shop already owns, and the service additionally refuses a
  // token naming a different shop than that phone's (019 T24).
  app.post(`${P}/invitations/redemptions`, async (req, reply) => {
    const body = parse(contract.invitationRedemptionRequest, req.body ?? {});
    // The header's PRESENCE is the hook's (048 R10); its VALUE is needed here,
    // because this route is not in 042 §5.1's authentication-act exemption and
    // takes a real `request_idempotency` row. The `??` is unreachable — the hook
    // refuses an absent or empty key on every mutating route — and is here for
    // the reason `requireDevice` is: "the hook guarantees it" stops holding the
    // day somebody edits a row, and a thrown code is cheaper than a 500.
    const key = headerValue(req.headers["idempotency-key"]);
    if (key === undefined) throw new LongboxError("IDEMPOTENCY_KEY_REQUIRED");
    const result = await redeemInvitation(deps, requireDevice(req), {
      code: body.code,
      pin: body.pin,
      idempotencyKey: key,
    });
    return send(req, reply, result);
  });

  // E03-D07. Anonymous by construction: the caller is the phone being enrolled,
  // so it holds no session. The CODE is the authentication, exactly as the device
  // credential is on `POST …/device-sessions`.
  app.post(`${P}/device-enrollments`, async (req, reply) => {
    const body = parse(contract.deviceEnrollmentRequest, req.body ?? {});
    return send(req, reply, await redeemEnrollmentCode(deps, { code: body.code }));
  });

  app.post(`${P}/operator-sessions/end`, async (req, reply) => {
    parse(contract.endOperatorSessionRequest, req.body ?? {});
    const operator = req.auth.operator;
    // Unreachable: the auth allowlist requires `device+operator` on this path and
    // the hook refuses without one. It is here because "the hook guarantees it"
    // is exactly the kind of guarantee that stops holding when somebody edits a
    // row, and a thrown code is cheaper than a `!` that turns into a 500.
    if (!operator) throw new LongboxError("OPERATOR_REQUIRED");
    return send(req, reply, await endOperatorSession(deps, operator));
  });
}

function requireDevice(req: FastifyRequest): NonNullable<FastifyRequest["auth"]["device"]> {
  const device = req.auth.device;
  if (!device) throw new LongboxError("SESSION_REQUIRED");
  return device;
}
