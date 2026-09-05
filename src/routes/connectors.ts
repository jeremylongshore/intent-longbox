// The two connector routes, and nothing else.
//
// Bead: longbox-e5b.3.6 (alias E03-B06). Docs: 000-docs/053 §8; 042 §4 (the
// envelope and the code registry), §5.1 CLASS TWO; 048 §9.3 (the constant
// answer); 029 §3.1 (the HTTP edge is thin).
//
// Same shape as every other handler in this repository: parse what arrived
// against the declared contract, call ONE service function, send what it
// returns. No `db.query`, no `pg` import, no `../db.js` import — the
// architecture gate counts them and the count is zero.
//
// ============================================================================
// THE RAW BODY, AND WHY IT LIVES IN AN ENCAPSULATED PLUGIN
// ============================================================================
//
// A Shopify webhook's HMAC is computed over the bytes exactly as they arrived.
// Verifying it against a re-serialisation of the parsed JSON does not work and
// is not a near miss: `JSON.parse` followed by `JSON.stringify` changes key
// order, number formatting and whitespace, so correct messages fail — and a
// verifier built that way can be made to accept wrong ones by anyone who
// understands the re-serialisation.
//
// So the webhook route registers its own `application/json` parser that keeps
// the buffer. It is registered INSIDE `app.register(...)` because Fastify
// ENCAPSULATES content-type parsers per plugin: doing it on the root instance
// would change how every JSON body in the system is parsed, for one route's
// benefit, which is the kind of global change that is invisible until it breaks
// something unrelated.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { LongboxError } from "../contracts/v1/errors.js";
import * as contract from "../contracts/v1/schemas.js";
import {
  ConnectorCallbackError,
  WebhookRateLimitedError,
  WebhookRefusedError,
  completeInstall,
  receiveWebhook,
  type ConnectorDeps,
} from "../services/connectors/shopify/index.js";

/** One header value, whatever Fastify's union says. Never an empty string. */
function headerValue(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * Every callback refusal becomes ONE code, and the reason it is a `switch` on
 * exactly one member rather than a lookup table is that only one member differs.
 *
 * 048 §9.3's constant answer: `unknown_state`, `state_expired`,
 * `state_replayed`, `domain_mismatch`, `bad_signature`, `bad_domain`,
 * `scope_insufficient`, `scope_excessive`, `exchange_failed` and
 * `app_not_configured` are ONE answer from outside, because a caller who could
 * tell them apart would hold an oracle over which install states exist and over
 * whether a forged signature was the thing that failed. `rate_limited` is the
 * exception and must be: it is the one refusal whose correct client behaviour is
 * different (wait and retry), 042 §4.4 makes `retryable` a fact the server
 * STATES rather than one the client infers, and it discloses nothing — a
 * throttle fired for a shop the caller already named.
 */
function callbackError(err: ConnectorCallbackError): LongboxError {
  return err.refusal === "rate_limited"
    ? new LongboxError("RATE_LIMITED")
    : new LongboxError("CONNECTOR_CALLBACK_REFUSED");
}

export function registerConnectorRoutes(app: FastifyInstance, deps: ConnectorDeps): void {
  const P = contract.API_PREFIX;

  // ⚠ NEITHER ROUTE'S REQUEST LINE IS LOGGED, AND THE SUPPRESSION IS NOT HERE.
  // A provider callback's URL carries the OAuth state, the code and the
  // signature (019 T31), and `disableRequestLogging` is a SERVER option in this
  // Fastify version — so `src/app.ts` decides it with a predicate derived from
  // the auth allowlist's `provider-callback` rows. Read that comment before
  // changing either route's options: `logLevel: "silent"` was tried here and is
  // the wrong tool, because it also deletes the error line 042 I14's
  // correlation id exists to be joined to.

  // THE OAUTH CALLBACK. A GET that writes — permitted for the
  // `provider-callback` kind alone (048 I6(d) as amended at v1.5.2) because it
  // reads no cookie, so a cross-site navigation carries no authority to spend.
  app.get(`${P}/connectors/shopify/callback`, async (req: FastifyRequest, reply: FastifyReply) => {
    // The SHAPE only. Every field is attacker-controlled until `completeInstall`
    // has verified the HMAC over the whole query, and the schema says so in its
    // own doc comment. Validating first is still worth it: it bounds the lengths
    // before any of them reaches an HMAC computation or a URL.
    const parsed = contract.connectorCallbackQuery.safeParse(req.query ?? {});
    if (!parsed.success) throw new LongboxError("VALIDATION_FAILED", parsed.error.flatten());
    try {
      // The RAW query, not the parsed object: the signature covers every
      // parameter Shopify sent, including ones this contract has never heard of,
      // and handing the verifier a stripped copy would break every authentic
      // callback the day the provider adds a field.
      const result = await completeInstall(deps, req.query as Record<string, string | string[] | undefined>);
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof ConnectorCallbackError) throw callbackError(err);
      throw err;
    }
  });

  // THE WEBHOOK RECEIVER, in its own encapsulation so the raw-body parser is
  // this route's and not the server's.
  void app.register(async (scoped) => {
    scoped.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_req, body, done: (err: Error | null, body?: unknown) => void) => {
        // The BUFFER is the payload. Nothing here parses it, and that is the
        // point: the handler needs the bytes to verify, and a body this route
        // never trusted enough to verify is a body it has no business parsing.
        // A malformed JSON webhook therefore fails its signature check or gets
        // recorded as bytes with a digest — never a 500 out of a parser.
        done(null, body);
      }
    );

    scoped.post(`${P}/connectors/shopify/webhooks`, async (req: FastifyRequest, reply: FastifyReply) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      try {
        await receiveWebhook(
          deps,
          {
            topic: headerValue(req.headers["x-shopify-topic"]),
            hmac: headerValue(req.headers["x-shopify-hmac-sha256"]),
            shopDomain: headerValue(req.headers["x-shopify-shop-domain"]),
            webhookId: headerValue(req.headers["x-shopify-webhook-id"]),
            apiVersion: headerValue(req.headers["x-shopify-api-version"]),
          },
          raw
        );
        // ONE answer for a first delivery and for a redelivery. Shopify acts on
        // the status code, and a body that distinguished them would be a fact
        // about this system's state returned to a caller that authenticated with
        // a shared secret rather than as a tenant.
        return reply.code(200).send({ acknowledged: true });
      } catch (err) {
        // 401 for anything that failed authentication, INCLUDING an authentic
        // message with no usable topic or id: from outside, "your signature is
        // wrong" and "your signature is right and your headers are unusable" are
        // one answer, and Shopify's own expectation on the compliance topics is
        // a 401 rather than a 200.
        if (err instanceof WebhookRefusedError) throw new LongboxError("WEBHOOK_SIGNATURE_INVALID");
        // 429 and NOT 401, and the split matters on the wire rather than only
        // in the log: Shopify retries a 429 with backoff and does NOT retry a
        // 401, so collapsing the two would mean a shop that tripped a
        // provisional floor lost the message permanently — including, on the
        // worst day, a `customers/redact`.
        if (err instanceof WebhookRateLimitedError) throw new LongboxError("RATE_LIMITED");
        throw err;
      }
    });
  });
}
