// The ONE error envelope (042 §4), and the single `setErrorHandler` that every
// failure — handler-authored, framework-raised or unhandled — passes through.
//
// WHAT THIS REPLACES. Three shapes existed (042 E8, E9, E10): twenty-eight
// `{ error: string | ZodFlatten }` sends, Fastify's own `{statusCode, code,
// error, message}` for the 413 (because a handler THREW rather than sent), and
// `POST …/identify`'s 502, which returned its SUCCESS body with an `error`
// string inside it — beside `confidence`, `provider`, `model` and `costUsd`.
// The one machine-readable code in the API was the one no handler composed.
//
// THE RULE THAT DOES THE WORK (042 §4.3). `message` is a DEVELOPER string. The
// server emits no operator prose at all, so there is none to leak: a person's
// screen selects 021 registered copy from `code`. That moves the 022 P6 guard
// UPSTREAM of the thing that emits the forbidden material, where
// `tests/public-copy.test.ts` — a static grep over one client file — could only
// ever defend the last thirty lines of the pipeline.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { envelope, LongboxError } from "../contracts/v1/errors.js";
import { SupersessionError } from "../services/supersession.js";

export {
  ERROR_CODES,
  ERROR_CODE_NAMES,
  isErrorCode,
  LongboxError,
  envelope,
} from "../contracts/v1/errors.js";
export type { ErrorCode, ErrorCodeSpec, ErrorEnvelope } from "../contracts/v1/errors.js";

/** The header a caller may set to join its own trace; generated when absent. */
export const CORRELATION_HEADER = "x-correlation-id";

/**
 * Map a framework or unknown error onto the registry (042 §4.5).
 *
 * `FST_REQ_FILE_TOO_LARGE` KEEPS ITS MEANING and becomes `PHOTO_TOO_LARGE`: the
 * one shape a client could branch on today arrived by accident, and the
 * migration is that it now arrives on purpose. Everything unrecognised is
 * `INTERNAL_ERROR` — and the thrown message is DROPPED rather than forwarded,
 * because `routes:182` forwarding a provider adapter's exception message
 * verbatim to the caller is 042 E10.
 */
export function classify(err: unknown): LongboxError {
  if (err instanceof LongboxError) return err;
  const fastifyCode = (err as { code?: unknown } | null)?.code;
  if (fastifyCode === "FST_REQ_FILE_TOO_LARGE") return new LongboxError("PHOTO_TOO_LARGE");
  if (fastifyCode === "FST_INVALID_MULTIPART_CONTENT_TYPE") {
    return new LongboxError("UNSUPPORTED_MEDIA_TYPE");
  }
  if (fastifyCode === "FST_ERR_VALIDATION") return new LongboxError("VALIDATION_FAILED");
  // 041 §3.3's refusals, translated into the contract's vocabulary rather than
  // reaching a caller as a 500. `prior-already-superseded` IS a stale world view
  // — somebody corrected the row this write names — and the other two mean the
  // predecessor is not this session's, which is a 404 and never a message naming
  // another shop (019 T24).
  if (err instanceof SupersessionError) {
    return err.code === "prior-already-superseded"
      ? new LongboxError("STALE_WORLD_VIEW", { refusal: err.code })
      : new LongboxError("SESSION_NOT_FOUND", { refusal: err.code });
  }
  // 042 A6 / 041 §4.5: both write-conflict classes are retryable, and reaching
  // here means `withTransaction` already spent `tx_max_retries` on them.
  if (fastifyCode === "40001" || fastifyCode === "40P01") {
    // The SQLSTATE is a STRUCTURED detail, not an interpolation into prose: a
    // message built from a value is a message the guard cannot read, and this one
    // used to be a template literal that slipped past it entirely.
    return new LongboxError("WRITE_CONFLICT_RETRY_EXHAUSTED", { sqlstate: fastifyCode });
  }
  return new LongboxError("INTERNAL_ERROR");
}

declare module "fastify" {
  interface FastifyRequest {
    /** 034 §3.1's `correlation_id`, per request. Not an idempotency key (042 §4.7). */
    correlationId: string;
  }
}

export function correlationIdOf(req: FastifyRequest): string {
  return req.correlationId ?? "00000000-0000-0000-0000-000000000000";
}

/**
 * Install the correlation id and the one error handler.
 *
 * The id is returned on EVERY response, success and failure (042 §4.7), because
 * "what happened to this request" needs something to join on whether or not it
 * went wrong — and a client that only sees an id when it fails cannot report the
 * request that quietly did the wrong thing.
 *
 * It is a NEW id per request even when the `Idempotency-Key` repeats: that is
 * precisely what makes a replay traceable, and 042 I14 asserts the two never
 * collapse into one field.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.decorateRequest("correlationId", "");

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const supplied = req.headers[CORRELATION_HEADER];
    const value = Array.isArray(supplied) ? supplied[0] : supplied;
    req.correlationId = value && value.length > 0 && value.length <= 200 ? value : randomUUID();
    void reply.header(CORRELATION_HEADER, req.correlationId);
  });

  app.setErrorHandler((err, req, reply) => {
    const mapped = classify(err);
    // ⚠ THE CORRELATION ID IS ON THE LOG LINE, NOT ONLY IN THE RESPONSE (042 I14,
    // added by E03-B06's invariant re-verification). The id is what an operator
    // joins a report to a server line with, and until now it reached only the
    // caller: a person holding a failing request's id had nothing to grep for.
    //
    // It matters most on the routes that log least. E03-B06's two connector
    // routes carry `disableRequestLogging` — their URL holds an OAuth state, a
    // code and a signature (019 T31) — so this is the ONLY line an unhandled
    // throw on them produces, and a line with no id would be a line nobody can
    // attribute.
    //
    // **The URL is deliberately absent** and so is every request field: `err`
    // and an id, and nothing that could carry a query string into a log.
    if (mapped.code === "INTERNAL_ERROR") {
      req.log.error({ err, correlation_id: correlationIdOf(req) }, "unhandled error");
    }
    const retryAfter = mapped.details["retry_after_seconds"];
    if (typeof retryAfter === "number") void reply.header("retry-after", String(retryAfter));
    void reply.code(mapped.status).send(envelope(mapped.code, correlationIdOf(req), mapped.details));
  });

  // The 404 reflects NOTHING from the request. The first version interpolated
  // `${req.method} ${req.url}`, which put an attacker-controlled string into a
  // wire message and into every log that carries one — the same class of defect
  // as forwarding a provider's exception text (042 E10). The correlation id is
  // how a caller ties this response to what they sent.
  app.setNotFoundHandler((req, reply) => {
    void reply.code(404).send(envelope("ROUTE_NOT_FOUND", correlationIdOf(req)));
  });
}
