// The declared route table (042 §3.1) and the allowlist the route-table walk
// reads (042 §3.4, amendment A8).
//
// HALF ONE OF §3.4 IS THE PREFIX PLUGIN — the shop-scoped surface is registered
// once at `/api/v1/shops/:shopId`, so a route added inside it CANNOT be added
// without the prefix: it does not spell the prefix at all. That removes the
// failure mode where a new route is registered against a different literal and
// looks identical to a reviewer (E3: "the tenant boundary is a convention held
// by one `const`").
//
// HALF TWO IS THIS FILE — the part that actually holds. A plugin boundary is a
// convention a determined author routes around, so a test walks Fastify's
// REGISTERED route table (019 T35(b): "not a hand-kept list") and fails closed
// on any route that is neither under the tenant prefix nor on the list below.
//
// EVERY ROW CARRIES A `kind`, AND THE TWO KINDS ARE NOT THE SAME EPISTEMIC
// OBJECT (A8, the Q8 ruling). An `exemption` is a route that is CORRECT outside
// the tenant prefix and says why. A `defect` is a route that is WRONG, is not
// fixed yet, and names the bead that fixes it. **A defect row means "this record
// refused to hide it", never "this record permitted it"** — and no defect-kind
// row may exist at G2.
import type { ZodTypeAny } from "zod";
import type { ErrorCode } from "./errors.js";
import * as s from "./schemas.js";

export type RouteKind = "exemption" | "defect";

export interface AllowlistRow {
  readonly method: string;
  readonly path: string;
  readonly kind: RouteKind;
  readonly reason: string;
  /** Required when `kind === "defect"`. */
  readonly closingBead?: string;
}

export const ROUTE_ALLOWLIST: readonly AllowlistRow[] = [
  {
    method: "GET",
    path: "/healthz",
    kind: "exemption",
    reason:
      "liveness probe; returns {ok:true}, reads nothing, has no tenant, and is deliberately " +
      "UNVERSIONED (042 §3.1 R0 — it is a probe for E13-B04, not an API call)",
  },
  {
    method: "GET",
    path: "/api/v1/shops",
    kind: "defect",
    closingBead: "E03-B02 / E03-B03 (authn, RBAC)",
    reason:
      "THE SHOP PICKER RETURNS EVERY SHOP TO ANY CALLER (042 E4, 034 E9). A live 019 T24 " +
      "exposure — cross-tenant access = 0, NON-WAIVABLE, any → K1. It is not exempt from " +
      "anything; it is broken, and the phone client depends on it until an authenticated " +
      "session exists. E02-D08 did not close it and must not: closing it means deciding who " +
      "the caller is, which is E03's. 042 A8: no defect-kind row may exist at G2.",
  },
  // E03-D09's four authentication routes. Every one is CORRECT outside the
  // tenant prefix, and each says why in its own terms rather than sharing a
  // reason: they are how a caller ACQUIRES a tenant, so a tenant-prefixed
  // authentication route would need the answer before it could ask the question.
  {
    method: "POST",
    path: "/api/v1/device-sessions",
    kind: "exemption",
    reason:
      "a phone exchanges its enrolled credential for a device session (048 §7.3). The credential " +
      "names the shop; the caller does not, and a shopId in this path would be a tenant asserted " +
      "by whoever is holding the phone — 042 E4's defect re-created on the one route that exists " +
      "to stop it.",
  },
  {
    method: "GET",
    path: "/api/v1/operators",
    kind: "exemption",
    reason:
      "the operator picker's roster, scoped to the shop the DEVICE SESSION names (048 §3.5). " +
      "Taking the shop from the path instead would let a caller with any device session read " +
      "another shop's staff list, which is a per-shop datum and a 019 T24 exposure.",
  },
  {
    method: "POST",
    path: "/api/v1/operator-sessions",
    kind: "exemption",
    reason:
      "the PIN (048 §3.5). It ESTABLISHES the operator, so it cannot sit inside a prefix whose " +
      "tenant is resolved from the operator's memberships; the shop comes from the device " +
      "session, which is the only trustworthy source at this instant.",
  },
  {
    method: "POST",
    path: "/api/v1/operator-sessions/end",
    kind: "exemption",
    reason:
      "the operator switch: it revokes the operator chain named by the cookies and touches no " +
      "shop-scoped row, so it has no tenant to be prefixed by.",
  },
  // The unversioned aliases. 042 §9.1 row 5 — "the unversioned aliases are
  // removed; the Deprecation/Sunset window closes" — is E02-B10's contract step,
  // so they are declared here rather than deleted here.
  {
    method: "ALL",
    path: "/api/shops",
    kind: "exemption",
    closingBead: "E02-B10 (042 §9.1 row 5)",
    reason:
      "308 alias onto /api/v1/shops with Deprecation and Sunset headers (042 §2.3). A " +
      "deliberate, dated, method-preserving redirect is not a defect: it is the deprecation " +
      "window doing its job, and it is removed by a contract step rather than by silence.",
  },
  {
    method: "ALL",
    path: "/api/shops/*",
    kind: "exemption",
    closingBead: "E02-B10 (042 §9.1 row 5)",
    reason:
      "as above, for the shop-scoped surface: a 308 alias onto /api/v1/shops/:shopId/… with " +
      "Deprecation and Sunset headers, removed by E02-B10's contract step rather than by silence",
  },
];

// ---------------------------------------------------------------------------
// THE AUTH ALLOWLIST — A SECOND LIST, NOT A COLUMN ON THE FIRST (048 §6.2, R12).
//
// It is tempting to reuse `ROUTE_ALLOWLIST`, and it is wrong, because **the two
// lists answer different questions**: "may this route sit outside the tenant
// prefix" and "may this route be reached without a session" have different
// answers on the same route. `GET /healthz` is outside the prefix AND anonymous.
// `POST /api/v1/operator-sessions` (the PIN) is outside the tenant prefix —  it
// ESTABLISHES the operator, so it cannot be inside it — and is **not** anonymous:
// it needs a live device session. Collapsing the two means one of the answers is
// inferred, and an inferred security answer is the shape `GET /api/v1/shops`
// already took once.
//
// Two lists, each fail-closed, each with a reason, and **a route absent from both
// is a build failure**. The rows carry the REQUIRED PRINCIPAL — `none`, `device`
// or `device+operator` — never a bare boolean, because "anonymous or not" cannot
// express the PIN route.
// ---------------------------------------------------------------------------

/** 048 §6.2: the principal a route requires before it resolves anything. */
export type AuthPrincipal = "none" | "device" | "device+operator";

export interface AuthAllowlistRow {
  readonly method: string;
  readonly path: string;
  readonly principal: AuthPrincipal;
  /**
   * `route` — an endpoint that reads, writes or resolves something.
   * `redirect` — 048 R12's own kind: the 308 aliases reply and touch nothing.
   * They must NOT be given the `none` principal, because that reads as "this
   * endpoint serves unauthenticated callers"; what they actually are is a
   * method-and-body-preserving redirect that reads nothing, writes nothing and
   * resolves no tenant. **I6(f) asserts an alias path and its `/api/v1` target
   * refuse identically** — a redirect that answers differently from its target is
   * an oracle sitting on the front door with the word "deprecated" over it.
   */
  readonly kind: "route" | "redirect";
  readonly reason: string;
  /**
   * A row for a route the DESIGN has settled and this bead does not register.
   * The walk asserts a pending row's path is ABSENT from the route table, so the
   * flag has to be flipped deliberately when the route lands rather than quietly
   * going stale — the same construction `APPEND_ONLY_EXEMPTIONS.pending` uses.
   */
  readonly pending?: true;
  readonly closingBead?: string;
}

export const AUTH_ALLOWLIST: readonly AuthAllowlistRow[] = [
  {
    method: "GET",
    path: "/healthz",
    principal: "none",
    kind: "route",
    reason:
      "liveness probe for E13-B04. It returns {ok:true}, reads nothing, resolves no tenant and " +
      "discloses nothing a port scan does not already know.",
  },
  {
    method: "POST",
    path: "/api/v1/device-sessions",
    principal: "none",
    kind: "route",
    reason:
      "THE DEVICE CREDENTIAL IS THE AUTHENTICATION (048 §7.3). A phone posts the secret it was " +
      "enrolled with and receives the device session; there is no session yet, by construction. " +
      "It is rate-classed on the device the credential names, never on an IP (048 R14).",
  },
  {
    method: "GET",
    path: "/api/v1/operators",
    principal: "device",
    kind: "route",
    reason:
      "the operator picker's roster (048 §3.5, R8). It renders ONLY to a live device session: " +
      '"who works here" is a per-shop datum a passer-by on the same Wi-Fi has no claim on. Its ' +
      "payload is display name and id only — I7 asserts no count, no timestamp, no ordering key.",
  },
  {
    method: "POST",
    path: "/api/v1/operator-sessions",
    principal: "device",
    kind: "route",
    reason:
      "THE PIN. Outside the tenant prefix because it establishes the operator, and NOT anonymous " +
      "because a PIN is a knowledge factor on a possession-bound channel (048 §3.5) — it is " +
      "verified only on a device that already holds a live device session, and is useless " +
      "anywhere else. This row is the one that made a boolean insufficient (R12).",
  },
  {
    method: "POST",
    path: "/api/v1/operator-sessions/end",
    principal: "device+operator",
    kind: "route",
    reason:
      "switching operator mid-shift: the operator chain is revoked and the DEVICE chain is left " +
      "alone, so the next person is one tap and a PIN away (033 A13's 'no re-login, no " +
      "re-picking the box') and the phone never loses its enrollment.",
  },
  {
    method: "GET",
    path: "/api/v1/shops",
    principal: "device",
    kind: "route",
    closingBead: "E03-D08 (048 §6.4)",
    reason:
      "⚠ STILL THE TENANCY ALLOWLIST'S LAST `defect` ROW. This bead puts a DEVICE session in " +
      "front of it — it is no longer reachable by anybody who can reach the port — and does NOT " +
      "close it: the route still returns every shop in the database to any caller who holds one. " +
      "Turning it into *my shops* (a membership-scoped query) and flipping the tenancy row from " +
      "`defect` to `exemption` is E03-D08's by name (048 §10.2), landing the moment this hook " +
      "exists. Narrowing the reachable set without narrowing the ANSWER would let the defect row " +
      "look closed while the query is unchanged.",
  },
  {
    method: "ALL",
    path: "/api/shops",
    principal: "none",
    kind: "redirect",
    closingBead: "E02-B10 (042 §9.1 row 5)",
    reason:
      "a 308 alias that reads nothing, writes nothing and resolves no tenant (048 R12). The " +
      "AUTHENTICATION happens at the target, so the redirect answers identically for an " +
      "anonymous, a wrong-tenant and a missing-header request — asserted by I6(f).",
  },
  {
    method: "ALL",
    path: "/api/shops/*",
    principal: "none",
    kind: "redirect",
    closingBead: "E02-B10 (042 §9.1 row 5)",
    reason: "as above, for the shop-scoped surface.",
  },
  {
    method: "POST",
    path: "/api/v1/device-enrollments",
    principal: "none",
    kind: "route",
    pending: true,
    closingBead: "E03-D07 (048 §7, §7.1a)",
    reason:
      "DECLARED AND NOT REGISTERED. Redeeming an enrollment code — an append-only, single-use " +
      "fact bound to a device already holding a live device session at the same shop (048 R15) — " +
      "is E03-D07's, and it needs the E05 screens. The row is here so the day that route is " +
      "registered its principal is a decision somebody already made, rather than one inferred " +
      "at 5pm by whoever is adding the handler. The walk asserts this path is ABSENT today.",
  },
];

/** The rows whose routes must be registered; `pending` rows must not be. */
export const AUTH_ALLOWLIST_ACTIVE = AUTH_ALLOWLIST.filter((r) => r.pending !== true);

export function authRowFor(method: string, path: string): AuthAllowlistRow | undefined {
  return AUTH_ALLOWLIST_ACTIVE.find(
    (r) => r.path === path && (r.method === "ALL" || r.method === method.toUpperCase())
  );
}

/**
 * The static mounts, which 042 §3.1 states are NOT routes and treats in §3.5.
 * They are listed so the walk can tell "declared as a mount" from
 * "unclassified", which is the whole point of an allowlist.
 *
 * **THERE IS NOW ONE, AND THAT IS THE CHANGE E03-D05 MADE.** The uploads mount
 * was a live tenancy exposure (042 E5, 046 §3.3 B5, 022 P7, 019 §3.0's G2 item):
 * every shop's photo bytes on one unscoped tree, no auth, no signature, no
 * expiry. 046 §6 Q5 ruled DELETE rather than replace — the mount's only
 * surviving consumer was the phone preview, because Shopify is handed
 * root-relative paths it cannot fetch (046 E28), so deleting it removed a reader
 * and added no design debt. The preview is now
 * `GET /api/v1/shops/:shopId/scan-sessions/:id/photos/:photoId`, an ORDINARY
 * tenant route in the table below. E03-B07 still owns signed, time-bounded URLs
 * — it now decides them against a surface that is already private.
 */
export const STATIC_MOUNTS = [
  { prefix: "/", reason: "public/ — the phone client itself (042 §3.5)" },
] as const;

/**
 * 042 §8.2's two classes, plus the one 048 R14 adds for the routes that have no
 * session yet to be bucketed by.
 *
 * `device` keys on the `device_id` the presented credential or session names —
 * **the device is authenticated; the person is what is being tested**. Keying the
 * PIN route on `app_user_id` instead would let a stranger exhaust a NAMED
 * PERSON'S budget, which is 048 §9.1's "never a global lock a stranger can
 * trigger against a named person" arriving as a rate limit instead of as a
 * lockout. Never an IP, for 042 §8.1's unchanged reasons: one shop is one IP, and
 * two shops behind one carrier are one IP.
 */
export type RateClass = "metered" | "ordinary" | "device" | "none";

export interface RouteSpec {
  readonly method: "GET" | "POST";
  /** The full route TEMPLATE, exactly as Fastify registers it. */
  readonly path: string;
  /** The path within the tenant plugin, or null for a route outside it. */
  readonly pluginPath: string | null;
  readonly mutating: boolean;
  /** 042 §8.2 — only `identify` spends money. */
  readonly rateClass: RateClass;
  readonly request: ZodTypeAny | null;
  /**
   * The success body's schema, or `null` when the route answers BYTES rather
   * than JSON. Null is not "undescribed": `responseMediaType` then carries what
   * the route sends, and the OpenAPI emitter renders `string/binary` for it. A
   * Zod schema for a photograph would be a fiction, and 042 §3.3 property 3
   * refuses fictions in the generated artifact.
   */
  readonly response: ZodTypeAny | null;
  /** Defaults to `application/json`. Set only by a route that streams bytes. */
  readonly responseMediaType?: string;
  readonly successStatus: number;
  readonly errors: readonly ErrorCode[];
  readonly summary: string;
}

const COMMON: readonly ErrorCode[] = [
  // E03-D09: every shop-scoped route now refuses before it resolves anything —
  // 048 I1's "no route reaches the database or the filesystem without a resolved
  // session". Declared on every route rather than on the ones a reader expects,
  // because the refusal comes from the HOOK and is therefore total by
  // construction; listing it selectively would describe a rule the code does not
  // have.
  "SESSION_REQUIRED",
  "OPERATOR_REQUIRED",
  "VALIDATION_FAILED",
  "SESSION_NOT_FOUND",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "WRITE_CONFLICT_RETRY_EXHAUSTED",
];

const MUTATING: readonly ErrorCode[] = [
  ...COMMON,
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "STALE_WORLD_VIEW",
];

export const ROUTES: readonly RouteSpec[] = [
  {
    method: "GET",
    path: "/healthz",
    pluginPath: null,
    mutating: false,
    rateClass: "none",
    request: null,
    response: s.healthResponse,
    successStatus: 200,
    errors: [],
    summary: "Liveness probe (unversioned by declaration).",
  },
  {
    method: "GET",
    path: `${s.API_PREFIX}/shops`,
    pluginPath: null,
    mutating: false,
    rateClass: "none",
    request: null,
    response: s.shopsResponse,
    successStatus: 200,
    errors: ["INTERNAL_ERROR"],
    summary: "List shops. DECLARED DEFECT: returns every shop to any caller (042 E4).",
  },
  {
    method: "POST",
    path: `${s.API_PREFIX}/device-sessions`,
    pluginPath: null,
    mutating: true,
    rateClass: "device",
    request: s.deviceSessionRequest,
    response: s.deviceSessionResponse,
    successStatus: 201,
    errors: ["VALIDATION_FAILED", "SESSION_REQUIRED", "RATE_LIMITED", "INTERNAL_ERROR"],
    summary: "Exchange an enrolled device credential for a device session.",
  },
  {
    method: "GET",
    path: `${s.API_PREFIX}/operators`,
    pluginPath: null,
    mutating: false,
    rateClass: "device",
    request: null,
    response: s.operatorRosterResponse,
    successStatus: 200,
    errors: ["SESSION_REQUIRED", "RATE_LIMITED", "INTERNAL_ERROR"],
    summary: "The operator picker's roster: display name and id, and nothing else.",
  },
  {
    method: "POST",
    path: `${s.API_PREFIX}/operator-sessions`,
    pluginPath: null,
    mutating: true,
    rateClass: "device",
    request: s.operatorSessionRequest,
    response: s.operatorSessionResponse,
    successStatus: 201,
    errors: [
      "VALIDATION_FAILED",
      "SESSION_REQUIRED",
      "PIN_INVALID",
      "IDEMPOTENCY_KEY_REQUIRED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ],
    summary: "Open an operator session with a PIN on this enrolled device.",
  },
  {
    method: "POST",
    path: `${s.API_PREFIX}/operator-sessions/end`,
    pluginPath: null,
    mutating: true,
    rateClass: "device",
    request: s.endOperatorSessionRequest,
    response: s.endOperatorSessionResponse,
    successStatus: 200,
    errors: [
      "SESSION_REQUIRED",
      "OPERATOR_REQUIRED",
      "IDEMPOTENCY_KEY_REQUIRED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ],
    summary: "End the operator session; the device session survives.",
  },
  {
    method: "POST",
    path: `${s.TENANT_PREFIX}/scan-sessions`,
    pluginPath: "/scan-sessions",
    mutating: true,
    rateClass: "ordinary",
    request: s.createSessionRequest,
    response: s.sessionCreatedResponse,
    successStatus: 201,
    errors: [...MUTATING, "SHOP_NOT_FOUND"],
    summary: "Open a scan session.",
  },
  {
    method: "GET",
    path: `${s.TENANT_PREFIX}/scan-sessions/:id`,
    pluginPath: "/scan-sessions/:id",
    mutating: false,
    rateClass: "ordinary",
    request: null,
    response: s.sessionDetailResponse,
    successStatus: 200,
    errors: [...COMMON],
    summary: "The session, its derived state, its transitions and its full event trail.",
  },
  {
    method: "POST",
    path: `${s.TENANT_PREFIX}/scan-sessions/:id/photos`,
    pluginPath: "/scan-sessions/:id/photos",
    mutating: true,
    rateClass: "ordinary",
    request: null,
    response: s.photoResponse,
    successStatus: 201,
    errors: [...MUTATING, "PHOTO_FIELD_REQUIRED", "PHOTO_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE"],
    summary: "Upload one photo (multipart).",
  },
  {
    // E03-D05. An ORDINARY tenant route, not an exemption and not a mount: it is
    // the tenant-scoped replacement for the deleted public `uploads/` tree, and
    // the whole point is that it is spelled inside the same prefix plugin as
    // every other shop-scoped route, so it cannot be reached without naming a
    // shop and a session that own the photo.
    method: "GET",
    path: `${s.TENANT_PREFIX}/scan-sessions/:id/photos/:photoId`,
    pluginPath: "/scan-sessions/:id/photos/:photoId",
    mutating: false,
    rateClass: "ordinary",
    request: null,
    response: null,
    responseMediaType: "application/octet-stream",
    successStatus: 200,
    errors: [...COMMON, "PHOTO_NOT_FOUND"],
    summary:
      "Stream one photo's bytes. Private by construction: `Cache-Control: private, no-store`, " +
      "no directory listing, and a photo outside this shop or session is 404 and never 403.",
  },
  {
    method: "POST",
    path: `${s.TENANT_PREFIX}/scan-sessions/:id/identify`,
    pluginPath: "/scan-sessions/:id/identify",
    mutating: true,
    rateClass: "metered",
    request: s.identifyRequest,
    response: s.identifyResponse,
    successStatus: 200,
    errors: [...MUTATING, "IDENTIFY_FAILED", "IDENTIFY_PROVIDER_UNAVAILABLE"],
    summary: "Identify the book. Returns the ids of every record it wrote (042 §6.3).",
  },
  {
    method: "POST",
    path: `${s.TENANT_PREFIX}/scan-sessions/:id/confirm`,
    pluginPath: "/scan-sessions/:id/confirm",
    mutating: true,
    rateClass: "ordinary",
    request: s.confirmRequest,
    response: s.confirmResponse,
    successStatus: 201,
    errors: [...MUTATING, "CONTRADICTION_BLOCKS_ONE_TAP", "ONE_TAP_NOT_CORROBORATED"],
    summary: "Record the operator's identification.",
  },
  {
    method: "POST",
    path: `${s.TENANT_PREFIX}/scan-sessions/:id/condition`,
    pluginPath: "/scan-sessions/:id/condition",
    mutating: true,
    rateClass: "ordinary",
    request: s.conditionRequest,
    response: s.conditionResponse,
    successStatus: 201,
    errors: [...MUTATING],
    summary: "Record the condition: a grade RANGE and defect callouts, never a number.",
  },
  {
    method: "POST",
    path: `${s.TENANT_PREFIX}/scan-sessions/:id/price`,
    pluginPath: "/scan-sessions/:id/price",
    mutating: true,
    rateClass: "ordinary",
    request: s.priceRequest,
    response: s.priceResponse,
    successStatus: 201,
    errors: [...MUTATING, "SHOP_HAS_NO_PRICING_POLICY"],
    summary: "Price the book from every configured source.",
  },
  {
    method: "POST",
    path: `${s.TENANT_PREFIX}/scan-sessions/:id/draft`,
    pluginPath: "/scan-sessions/:id/draft",
    mutating: true,
    rateClass: "ordinary",
    request: s.draftRequest,
    response: s.draftResponse,
    successStatus: 202,
    errors: [...MUTATING, "SESSION_HAS_NO_CONFIRMATION", "SESSION_HAS_NO_PRICING"],
    summary: "Owe the Shopify draft: appends the job inside the request transaction, answers 202.",
  },
];

export const MUTATING_ROUTES = ROUTES.filter((r) => r.mutating);

export function routeSpecFor(method: string, path: string): RouteSpec | undefined {
  return ROUTES.find((r) => r.method === method.toUpperCase() && r.path === path);
}

/** The `Deprecation` / `Sunset` pair every alias response carries (042 §2.3). */
export const DEPRECATION_HEADERS = {
  deprecation: "true",
  link: `<${s.API_PREFIX}>; rel="successor-version"`,
} as const;
