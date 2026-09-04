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
  openDeviceSession,
  openOperatorSession,
  operatorRoster,
  type AuthDeps,
  type AuthResult,
} from "../services/auth/api.js";

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

  app.post(`${P}/operator-sessions`, async (req, reply) => {
    const body = parse(contract.operatorSessionRequest, req.body ?? {});
    const result = await openOperatorSession(deps, requireDevice(req), {
      appUserId: body.app_user_id,
      pin: body.pin,
    });
    return send(req, reply, result);
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
