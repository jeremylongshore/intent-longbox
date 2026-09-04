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

/**
 * The two static mounts, which 042 §3.1 states are NOT routes and treats in
 * §3.5. They are listed so the walk can tell "declared as a mount" from
 * "unclassified", which is the whole point of an allowlist.
 *
 * ⚠ The uploads mount is a LIVE tenancy exposure (042 E5, 022 P7, 019 §3.0's G2
 * item): every shop's photo bytes on one unscoped tree, no auth, no signature,
 * no expiry. It is not on the route allowlist because a mount is not a route,
 * and it is not this bead's to close — §3.5 fixes the CONTRACT shape (a
 * shop-scoped, time-bounded, signed URL issued by the owning module) and hands
 * the mechanism to E03-B07. What E02-D08 does close is the response half:
 * `storage_url` is no longer a field of any DTO.
 */
export const STATIC_MOUNTS = [
  { prefix: "/", reason: "public/ — the phone client itself (042 §3.5)" },
  { prefix: "uploads", reason: "config.uploadsDir — E03-B07 owns the signed-URL replacement (042 §3.5, E5)" },
] as const;

export type RateClass = "metered" | "ordinary" | "none";

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
  readonly response: ZodTypeAny;
  readonly successStatus: number;
  readonly errors: readonly ErrorCode[];
  readonly summary: string;
}

const COMMON: readonly ErrorCode[] = [
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
