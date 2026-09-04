// The v1 error-code registry (042 §4.2, executed by E02-D08).
//
// 042 §4.2 places the registry in `src/contracts/v1/errors.ts` and the envelope
// machinery in the HTTP edge; `src/http/errors.ts` holds the second half and
// re-exports this one, so there is ONE list and two readers (the handler that
// throws, and the OpenAPI emitter that describes).
//
// EACH ENTRY DECLARES FOUR THINGS, exactly as 042 §4.2 requires: its HTTP
// status, whether it is retryable, whether it is operator-renderable, and the
// 021 registered-copy row the CLIENT uses when it is. **The copy row is a
// pointer, never the copy**: 042 §4.3 rules that the server emits no operator
// prose at all, so a string a person reads is selected by the client from
// `code` and lives in 021, not here.
//
// `message` — the developer-facing English that travels in the envelope — is
// NOT written at the throw site. It is a plain string literal in `MESSAGES`
// below, keyed by code, and `LongboxError` takes no message argument at all.
//
// THAT IS A CHANGE OF MECHANISM, NOT OF STYLE, and the reason is that the first
// version could not be checked. When a message was an argument, the guard was a
// regex over `new LongboxError("CODE", "…")` call sites — which sees a
// double-quoted literal and misses a template literal, a concatenation, a
// variable and every `envelope()` call site. **A guard that a refactor can walk
// out of is not a guard.** With one keyed map the check is total by
// construction: the map IS the set of strings the server can emit, so
// `tests/contract/server-emits-no-operator-copy.test.ts` scans a closed list
// rather than hoping its pattern matched every writer, and a lint asserts no
// handler passes a message at all.
//
// Context that used to live in a bespoke message goes in `details`, which is
// structured and typed — which is where 042 §4.1 puts it anyway.
//
// ADDING A CODE IS ADDITIVE and stays within `v1` (042 §2.3). CHANGING a code's
// status or meaning is a `v2` change, and **a retired code is retired forever**
// (042 §4.2) — never reused with a new meaning.

export interface ErrorCodeSpec {
  /** The HTTP status this code maps to. Changing it is a `v2` change (042 §2.3). */
  readonly status: number;
  /**
   * 042 §4.4: a fact the server knows and states, never an inference the client
   * re-derives from the status. Two 409s disagree — `STALE_WORLD_VIEW` is not
   * retryable (someone else won; a person must resolve it) and
   * `WRITE_CONFLICT_RETRY_EXHAUSTED` is (nobody won yet).
   */
  readonly retryable: boolean;
  /**
   * Whether the CLIENT may show a person something for this code. It never means
   * "render `message`" — it means "select 021 copy from `code`".
   */
  readonly operatorRenderable: boolean;
  /** The 021 registered-copy row a client selects when `operatorRenderable`. */
  readonly copyRow: string | null;
  /** Why the code exists: the §1 finding or ratified rule it implements. */
  readonly implements: string;
}

export const ERROR_CODES = {
  VALIDATION_FAILED: {
    status: 400,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements: "042 §4.2 — the eleven Zod flatten() sends (E9); the flatten output moves to `details`",
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 400,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements:
      "042 §5.1 — 'Every mutating route REQUIRES an Idempotency-Key header'. The registry is " +
      "designed to grow (042 §14) and a required header with no code for its absence would be a " +
      "requirement no client could diagnose.",
  },
  PHOTO_FIELD_REQUIRED: {
    status: 400,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements:
      "042 §3.1 R4 — the multipart file field, previously `{error:'multipart file field required'}`",
  },
  SHOP_NOT_FOUND: {
    status: 404,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements: "042 §4.2 — routes:96",
  },
  SESSION_NOT_FOUND: {
    status: 404,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements: "042 §4.2 — the seven `scan session not found` sends",
  },
  PHOTO_NOT_FOUND: {
    status: 404,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements:
      "046 §6 Q5 / E03-D05 — the photo-fetch route. It is 404 and NEVER 403, deliberately: 019 " +
      "T24 signs cross-tenant access at zero, and a 403 would confirm that a photo id exists in " +
      "some other shop. A photo belonging to another shop, to another session, or whose bytes " +
      "are missing are ONE answer from outside.",
  },
  ROUTE_NOT_FOUND: {
    status: 404,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements:
      "042 §4.5 / I10 — Fastify's default 404 is its own shape, and I10 drives EVERY route into " +
      "every failure it can produce. An unrouted path is one of them.",
  },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements:
      "042 §4.5 — `FST_INVALID_MULTIPART_CONTENT_TYPE`, which Fastify answers 406. The registry " +
      "states 415: the condition is that the request's media type is not one the route accepts, " +
      "and a framework's status is not a contract. Adding the code is additive under §2.3.",
  },
  PHOTO_TOO_LARGE: {
    status: 413,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string (042 §4.5)",
    implements: "042 §4.5 — routes:44-49's accidental envelope (E8), now deliberate",
  },
  /**
   * E03-B07. The bytes are not one of the three accepted image types.
   *
   * 415 and NOT 400: the request is well-formed, and the condition is exactly
   * what 415 names — the payload's media type is not one this route accepts.
   * It is a SIBLING of `UNSUPPORTED_MEDIA_TYPE` rather than a reuse, because
   * that code means "this route takes multipart/form-data" and this one means
   * "the FILE inside your multipart body is not a JPEG, PNG or WebP". A client
   * that cannot tell them apart cannot tell a person which thing to fix.
   *
   * The verdict comes from the MAGIC BYTES. A caller who declares `image/png`
   * and sends a PDF, an SVG or an HTML document lands here whatever the
   * `Content-Type` part said (046 E6).
   */
  UNSUPPORTED_IMAGE_TYPE: {
    status: 415,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string (a re-take, not a retry)",
    implements: "046 E6 / G-5 — the type is detected, never declared",
  },
  /**
   * E03-B07. The bytes ARE one of the three types and the container is not
   * valid: a chunk or segment outside the closed allowlist, a second document
   * appended after the terminator (the polyglot), a truncated structure, or an
   * animated WebP.
   *
   * 422 and not 400: the syntax of the REQUEST is fine — the multipart parse
   * succeeded, the fields validated — and it is the CONTENT that cannot be
   * processed, which is the distinction 422 exists to make.
   */
  MALFORMED_IMAGE: {
    status: 422,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string (a re-take, not a retry)",
    implements: "046 G-5 — container walk against a closed allowlist; no trailing bytes",
  },
  /**
   * E03-B07. The header declares more pixels than the ceiling allows — the
   * decompression bomb, refused from the header by arithmetic with no decoder
   * ever asked to open the file. 422 for the same reason as `MALFORMED_IMAGE`:
   * the request is well-formed and its content is not processable.
   */
  IMAGE_DIMENSIONS_TOO_LARGE: {
    status: 422,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "046 §5 / G-5 — the pixel ceiling is a PROVISIONAL floor (src/services/media.ts)",
  },
  /**
   * E03-B07. A per-session or per-shop storage ceiling is already reached.
   *
   * 409 and not 429: 429 is a RATE, and retrying later is the honest advice it
   * carries. This is a STATE — a session or a shop holding more photographs
   * than the policy allows — and it does not clear by waiting; it clears when
   * the retention sweep (E03-B09) or an operator removes something. `details`
   * carries `{scope, limit_kind}` so a client can say which, without the server
   * writing prose.
   */
  PHOTO_QUOTA_EXCEEDED: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "046 §4 B4 — 'no per-tenant quota'; the ceilings are PROVISIONAL floors",
  },
  SHOP_HAS_NO_PRICING_POLICY: {
    status: 409,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements: "042 §4.2 — routes:319",
  },
  SESSION_HAS_NO_CONFIRMATION: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "042 §4.2 — routes:367",
  },
  SESSION_HAS_NO_PRICING: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "042 §4.2 — routes:371",
  },
  SESSION_HAS_NO_CONDITION: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "042 §4.2 / 040 F6 — a draft with no condition is refused. NOT WIRED by E02-D08",
  },
  CONTRADICTION_BLOCKS_ONE_TAP: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 C3 — the contradiction sentence",
    implements: "042 §4.6 / 040 F3 / locked decision 7",
  },
  /**
   * E06-D01, under 040 v1.3.0 F3.
   *
   * F3 keyed the one-tap refusal on `llm_rerank.contradiction`, which was right
   * while the contradiction verdict was the only thing that could take a band
   * off `high`. It is now one of five ceilings, so a payload with NO evidence and
   * NO contradiction derives `low` and would still have passed a
   * contradiction-only check. The refusal now keys on the BAND — the server's
   * own conclusion — and this code names the causes that are not a contradiction:
   * absent evidence, a disagreeing barcode, an ambiguous candidate set, an
   * unsure model, or no re-rank at all.
   *
   * It is a SIBLING rather than a widening of `CONTRADICTION_BLOCKS_ONE_TAP`
   * because 021 C3's registered copy is specifically the contradiction sentence —
   * "something on the cover disagrees" is the wrong thing to tell an operator
   * when the truth is "we could not read enough of the cover to be sure".
   */
  ONE_TAP_NOT_CORROBORATED: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string (NOT C3: this is not a contradiction)",
    implements: "042 §4.6 / 040 v1.3.0 F3 / locked decision 7",
  },
  STALE_WORLD_VIEW: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes 040 A9's 'Someone else answered this one.'",
    implements: "042 §6 / 040 §5.1 — the second device",
  },
  SESSION_IS_TERMINAL: {
    status: 409,
    retryable: false,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "042 §4.2 / 040 I5 — nothing follows a `voided` transition",
  },
  BLOCKED_BY_RETENTION_HOLD: {
    status: 409,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements: "042 §4.2 / 040 G-c / 022 P7 Q6. NOT WIRED by E02-D08 — no hold table exists (E13/E03)",
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    retryable: false,
    operatorRenderable: false,
    copyRow: null,
    implements: "042 §5.4 — same key, different request hash",
  },
  IDENTIFY_FAILED: {
    status: 502,
    retryable: true,
    operatorRenderable: true,
    copyRow: "021 C3 — the manual-search path",
    implements: "042 §4.2 — routes:192, and the 502 stops being a success body (E10)",
  },
  IDENTIFY_PROVIDER_UNAVAILABLE: {
    status: 503,
    retryable: true,
    operatorRenderable: true,
    copyRow: "021 C3 — the manual-search path",
    implements: "042 §4.2 — routes:182, and the adapter's exception message stops being the body (E10)",
  },
  RATE_LIMITED: {
    status: 429,
    retryable: true,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "042 §8.2 — the ordinary class only; the METERED class degrades to manual (§8.3)",
  },
  WRITE_CONFLICT_RETRY_EXHAUSTED: {
    status: 409,
    retryable: true,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements:
      "042 A6 — the transaction exhausted `tx_max_retries` on 40001 or 40P01. Distinct from " +
      "STALE_WORLD_VIEW: this one means NOBODY won yet, that one means SOMEONE ELSE won.",
  },
  INTERNAL_ERROR: {
    status: 500,
    retryable: true,
    operatorRenderable: true,
    copyRow: "021 — E05 owes the registered string",
    implements: "042 §4.2 — today an unhandled throw, serialized by Fastify",
  },
} as const satisfies Record<string, ErrorCodeSpec>;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * The developer-facing message for each code — the COMPLETE set of strings this
 * server can put in an error body. Never rendered to an operator (042 §4.3): a
 * person's screen selects 021 registered copy from `code`.
 *
 * Every entry is a plain literal, so the guard can read them all. No model name,
 * no provider id, no percentage, no cost, no second person, and nothing
 * interpolated from a request — a reflected URL or a provider's exception text
 * is exactly the class of leak 042 E10 and E12 recorded.
 */
export const MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "the request body or path parameters failed schema validation",
  IDEMPOTENCY_KEY_REQUIRED: "a non-empty Idempotency-Key header is required on every mutating route",
  PHOTO_FIELD_REQUIRED: "a multipart file field is required",
  SHOP_NOT_FOUND: "no shop with that id",
  SESSION_NOT_FOUND: "no scan session with that id in this shop",
  PHOTO_NOT_FOUND: "no photo with that id in this session",
  ROUTE_NOT_FOUND: "no route matches this request",
  UNSUPPORTED_MEDIA_TYPE: "this route accepts multipart/form-data only",
  PHOTO_TOO_LARGE: "the uploaded file exceeds the configured multipart limit",
  UNSUPPORTED_IMAGE_TYPE: "the uploaded bytes are not a jpeg, png or webp image",
  MALFORMED_IMAGE: "the uploaded image is not a well-formed file of its own type",
  IMAGE_DIMENSIONS_TOO_LARGE: "the uploaded image declares more pixels than the configured ceiling",
  PHOTO_QUOTA_EXCEEDED: "a photo storage ceiling for this session or shop is already reached",
  SHOP_HAS_NO_PRICING_POLICY: "this shop has no pricing policy row",
  SESSION_HAS_NO_CONFIRMATION: "this session has no current human_confirmation",
  SESSION_HAS_NO_PRICING: "this session has no current pricing_snapshot",
  SESSION_HAS_NO_CONDITION: "this session has no current condition_assessment",
  CONTRADICTION_BLOCKS_ONE_TAP:
    "the driving re-rank carries a contradiction; a one-tap confirmation is refused",
  ONE_TAP_NOT_CORROBORATED:
    "the driving re-rank did not reach the high band; a one-tap confirmation is refused",
  STALE_WORLD_VIEW: "the referenced record is no longer this session's current world",
  SESSION_IS_TERMINAL: "this session is terminal and takes no further records",
  BLOCKED_BY_RETENTION_HOLD: "an open retention hold blocks this write",
  IDEMPOTENCY_KEY_REUSED: "this idempotency key was already used for a different request body",
  IDENTIFY_FAILED: "the vision provider returned no usable answer",
  IDENTIFY_PROVIDER_UNAVAILABLE: "no vision provider is configured for this shop",
  RATE_LIMITED: "this shop's request rate exceeded the provisional floor",
  WRITE_CONFLICT_RETRY_EXHAUSTED: "a write conflict survived the transaction retry budget",
  INTERNAL_ERROR: "an unhandled error occurred",
};

export const ERROR_CODE_NAMES = Object.keys(ERROR_CODES) as ErrorCode[];

export function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

/** The wire shape of every non-2xx response, in every version (042 §4.1). */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    /** Developer-facing English. NEVER rendered to an operator (042 §4.3). */
    message: string;
    /** Structured and code-specific; never free prose (042 §4.1). */
    details: Record<string, unknown>;
    /** 034 §3.1's spelling, not a second one (042 §4.7). */
    correlation_id: string;
    /** 042 §4.4 — what a client and the offline queue may do next. */
    retryable: boolean;
  };
}

/**
 * A failure with a registry code. Every handler and every service throws one of
 * these instead of composing a body, so the envelope has exactly one author.
 *
 * It lives beside the registry rather than in the HTTP edge so a SERVICE can
 * refuse in the contract's vocabulary without importing Fastify — the staleness
 * check (§6) and the idempotency replay (§5) both refuse from inside a
 * transaction, several layers below a reply.
 */
export class LongboxError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  /**
   * **There is no message parameter, deliberately.** The message is the
   * registry's; anything a caller wants to add is structured and goes in
   * `details`. A handler that could pass a string is a handler that can leak one.
   */
  constructor(code: ErrorCode, details: Record<string, unknown> = {}) {
    super(MESSAGES[code]);
    this.name = "LongboxError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_CODES[this.code].status;
  }

  get retryable(): boolean {
    return ERROR_CODES[this.code].retryable;
  }
}

export function envelope(
  code: ErrorCode,
  correlationId: string,
  details: Record<string, unknown> = {}
): ErrorEnvelope {
  return {
    error: {
      code,
      message: MESSAGES[code],
      details,
      correlation_id: correlationId,
      retryable: ERROR_CODES[code].retryable,
    },
  };
}
