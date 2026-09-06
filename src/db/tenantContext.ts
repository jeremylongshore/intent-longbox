// THE TENANT CONTEXT A TRANSACTION CARRIES — the value every row-level-security
// policy in `migrations/029` reads, and the closed list of the places allowed to
// say "this statement is not about one shop".
//
// WHY THIS FILE EXISTS (034 §3.2, E03-B04). 034 fixes three tenancy layers and
// names the third: "PostgreSQL row-level security with **transaction-local**
// tenant context — `SET LOCAL`, never sticky connection state, because the pool
// is shared and a leaked `SET` outlives the request". This module is the value
// half of that sentence; `src/db.ts` is the mechanism half and `migrations/029`
// is the enforcement half.
//
// THE CONTEXT IS A VALUE, SET INSIDE A TRANSACTION, AND IT IS NEVER STICKY.
// `set_config(name, value, /* is_local */ true)` is `SET LOCAL` with a
// parameterisable name — it reverts at COMMIT or ROLLBACK, so the connection that
// goes back to the pool carries nothing. That is not a style preference: 046 §6
// K-5 records the failure mode this design exists to make unconstructible —
// "`SET LOCAL` on a pooled connection outside a transaction leaks into the next
// request that borrows it". Both GUCs are written on EVERY context, including the
// one being cleared, so a transaction can never inherit a value from whatever ran
// on that connection before it.
//
// THE SERVICE SCOPES ARE A CLOSED UNION, AND THAT IS THE WHOLE CONTROL.
// A handful of statements are cross-tenant BY CONSTRUCTION: a session cookie is
// resolved by a token digest before anyone knows which shop the caller is at, and
// "which shops may this person act at" is a question about several tenants at
// once. Those statements cannot carry a `shopId`, and the alternative — exempting
// the tables they read from row-level security altogether — would remove the
// boundary for the hundred ordinary readers of those tables in order to serve
// four extraordinary ones. So the boundary stays ON the table and the exceptions
// are a countable inventory: adding one means adding a member to the union below
// WITH its reason, and `pnpm arch` holds the number of call sites at an exact
// count (`scripts/architectureRules.ts`), never a ceiling — the same discipline
// 000-docs/044 §6 applies to `cost_log`'s single writer.
//
// WHAT THIS BUYS AND WHAT IT DOES NOT (stated here because it is the residual a
// reader will otherwise assume away). The application role can set either GUC to
// any value it likes: nothing in Postgres stops a compromised process from
// declaring itself another shop. RLS defends against a FORGOTTEN PREDICATE — a
// handler that omits `AND shop_id = $1`, a report that joins one table too many, a
// generated query — which is 034 §3.4's "the runtime assertion fails to a bug, and
// RLS fails to a database misconfiguration". The value fed to the GUC comes from
// the authenticated session and never from a body or a URL (048 §6.1); that is
// the layer above, and it is E03-B02/B03's, not this file's.

/**
 * A statement that is cross-tenant by construction, with the reason it is.
 *
 * Adding a member is a decision, not an edit: the union is closed, every member
 * carries the sentence that justifies it, and `pnpm arch` asserts the exact
 * number of call sites that reach each one.
 */
export const SERVICE_SCOPES = [
  {
    scope: "session-resolution",
    reason:
      "The authentication hook resolves a `__Host-` cookie to a session row by SHA-256 digest " +
      "(048 §3.2). The row it finds IS the tenant — 048 §6.1: `shop_id` comes from the session — " +
      "so the lookup cannot carry the shop it is about to establish. Covers `app_session`, " +
      "`app_session_revocation` and the `auth_attempt` rows a refusal writes before any shop is known.",
  },
  {
    scope: "device-session-open",
    reason:
      "A phone presents its device secret and gets back the shop it is enrolled at (048 §3.2, §7.4). " +
      "The `device_credential` lookup is by digest across the estate for the same reason as above: " +
      "the credential names the tenant, so the statement that reads it cannot already know one.",
  },
  {
    scope: "code-redemption",
    reason:
      "An enrollment code or an invitation is redeemed by a caller with no session at all " +
      "(048 §7.2, §7.3). The code identifies the shop; the SELECT that finds it therefore runs " +
      "before a tenant exists. Covers `device_enrollment_code`, `device_enrollment_code_use`, " +
      "`invitation` and `invitation_use`.",
  },
  {
    scope: "my-shops",
    reason:
      "`GET /api/v1/shops` answers WHICH TENANTS this session may act on (048 §6.4, E03-D08). " +
      "It is the one read whose correct answer spans shops, because a person may hold memberships " +
      "at more than one (034 §2.6). It is scoped by `app_user_id` in the predicate, not by a tenant.",
  },
  {
    scope: "outbox-sweep",
    reason:
      "The background poller has no session (043 §7.3) and drains ONE SHOP AT A TIME — so the only " +
      "thing it cannot do under a tenant context is ask WHICH shops exist. `shop` carries a policy of " +
      "its own (its tenant column is `id`), so that enumeration needs a scope; the claim, the dispatch " +
      "and every attempt row that follow run under the shop they are about. This scope reads `shop` " +
      "and nothing else.",
  },
  {
    scope: "connector-inbound",
    reason:
      "An inbound call from the platform itself — the OAuth callback and the webhook (053 §7). " +
      "Both arrive with no session and identify the tenant by a value this system must LOOK UP: " +
      "the callback by `state_digest`, the webhook by the `shop_domain` a granted token records. " +
      "The lookup therefore precedes the tenant, exactly as a session cookie's does; everything " +
      "after it — the token version, the use row, the receipt — is written under the shop the " +
      "lookup produced. A webhook that matches no install writes a receipt with a NULL `shop_id` " +
      "(053 §5.5), which matches no tenant policy at all and is the second reason the scope exists.",
  },
  {
    scope: "person-admission",
    reason:
      "AN INVITATION NAMES ITS PERSON BEFORE ANY CODE IS MINTED (048 §7.1), so `upsertPerson` runs " +
      "for somebody who may hold no grant anywhere — including the ordinary case of a person who " +
      "already works at ANOTHER shop, whose row this shop must find by email and may not read " +
      "(034 §2.6). That is the one moment `app_user`'s membership-EXISTS policy cannot serve, and " +
      "056 §7 gave it as the reason for having no policy at all. E03-D21 answers it with a scope " +
      "instead of a hole: this one may SELECT a person and may INSERT an ACTIVE one, and may not " +
      "UPDATE or DELETE anything — so the running server can admit a person and can never rename, " +
      "suspend or deactivate one. 000-docs/062 §3. **Redemption does NOT use it**: `grantInvitation` " +
      "writes the membership before the person is read, so the ordinary tenant context already " +
      "carries that transaction.",
  },
  {
    scope: "second-factor",
    reason:
      "TOTP enrollment, TOTP verification and recovery-code redemption are acts of a PERSON, not " +
      "of a shop (048 §4, §8): `app_user` and `user_authenticator` carry no `shop_id` at all, and " +
      "the `auth_attempt` row a failure appends carries a NULL one, which matches no tenant policy. " +
      "**`app_user` IS policied since E03-D21, and this scope is why the sign-in still works**: " +
      "`findPersonIdByEmail` is the FIRST statement of an unauthenticated sign-in, so no shop is " +
      "known and no membership can be asked about — the same shape as a cookie's digest lookup " +
      "one scope up. It reads the person table and projects `u.id` alone (000-docs/062 §3.3). " +
      "Its callers today are the three CLIs, which run as the schema owner and would bypass the " +
      "policies anyway; the scope is named there so the transaction says what it is, and so the " +
      "route E03-D11 turns them into inherits a context that is already correct.",
  },
] as const;

/** The scope names, as a closed union. */
export type ServiceScope = (typeof SERVICE_SCOPES)[number]["scope"];

const SERVICE_SCOPE_NAMES: readonly string[] = SERVICE_SCOPES.map((s) => s.scope);

export function isServiceScope(value: string): value is ServiceScope {
  return SERVICE_SCOPE_NAMES.includes(value);
}

/**
 * What a transaction is about: one shop, or one declared cross-tenant statement.
 *
 * There is no third member and no `undefined` member. A transaction that declares
 * neither runs with both GUCs empty, which every policy in `migrations/029` reads
 * as "no rows and no writes" — the fail-closed default, and the reason an omitted
 * context is a loud zero rather than a quiet everything.
 */
export type TenantContext = { readonly shopId: string } | { readonly service: ServiceScope };

/** The GUC that carries the tenant. Read by `current_shop_id()` in `migrations/029`. */
export const SHOP_ID_SETTING = "longbox.shop_id";

/** The GUC that carries a declared cross-tenant scope. Read by `longbox_service()`. */
export const SERVICE_SETTING = "longbox.service";

/**
 * Postgres accepts any string in a GUC, so the uuid check happens HERE.
 *
 * The value is interpolated into the `set_config` call rather than bound, because
 * the statement travels with `BEGIN` in one simple-protocol round trip (a bound
 * parameter would force a second one on every transaction in the system). That
 * makes validating the shape the whole of the injection defence, so it is strict:
 * the canonical 8-4-4-4-12 hex form and nothing else. A `shopId` reaching here
 * came from a session row (048 §6.1) and is a `uuid` column value; anything that
 * is not that shape is a bug in a caller, and it throws rather than being escaped.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The service half of the same rule: a scope reaching the statement is a declared one. */
export function assertServiceScope(value: string): ServiceScope {
  if (!isServiceScope(value)) {
    throw new Error(`tenant context: not a declared service scope: ${JSON.stringify(value)}`);
  }
  return value;
}

export function assertShopId(value: string): string {
  if (!UUID.test(value)) {
    throw new Error(`tenant context: shopId is not a uuid: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * The exact SQL that opens a transaction and pins its tenant context.
 *
 * ONE statement string, sent in ONE round trip, with `BEGIN` first: the context
 * is `SET LOCAL`, so it only means anything inside a transaction, and setting it
 * before `BEGIN` would silently be a no-op that outlived the request (034 §3.2's
 * named hazard, and Postgres does not warn about it).
 *
 * BOTH GUCs ARE ALWAYS WRITTEN. A tenant context blanks the service flag and a
 * service context blanks the shop id, so no transaction can inherit half a
 * context from an earlier one on the same pooled connection — even though
 * `is_local` already reverts them, because "already reverts" is a property of a
 * code path that ran, and this is a property of the statement itself.
 *
 * Returned as a string rather than executed so `tests/tenant-context.test.ts` can
 * assert the exact bytes with no database at all.
 */
export function beginWithContext(context: TenantContext | undefined, serializable: boolean): string {
  const begin = serializable ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN";
  if (context === undefined) return begin;
  const shopId = "shopId" in context ? assertShopId(context.shopId) : "";
  // CHECKED AT RUNTIME, not only in the type (the invariant review's NOTE 4). The
  // scope is interpolated into the statement exactly as the shop id is, and a
  // TypeScript union is a compile-time promise: an `as` cast, a value crossing a
  // JSON boundary, or a plain `any` at one call site is all it takes for the
  // promise to be worth nothing at the moment it matters.
  const service = "service" in context ? assertServiceScope(context.service) : "";
  // `service` is a member of the closed union above, so it is a literal from this
  // file; `shopId` has just been shape-checked. Neither can carry a quote.
  return (
    `${begin}; SELECT set_config('${SHOP_ID_SETTING}', '${shopId}', true), ` +
    `set_config('${SERVICE_SETTING}', '${service}', true)`
  );
}

/** A label for the retry log, so a contended transaction says which context it ran under. */
export function describeContext(context: TenantContext | undefined): string {
  if (context === undefined) return "no-tenant";
  return "shopId" in context ? "shop" : `service:${context.service}`;
}
