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
import type { Permission } from "./permissions.js";
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
    kind: "exemption",
    reason:
      "*MY SHOPS* (048 §6.4 as amended at v1.3.0, E03-D08) — THE ROUTE THAT ESTABLISHES WHICH " +
      "TENANT, which is why it cannot sit inside a prefix whose tenant it is being asked to " +
      "supply. It answers the one shop the SESSION PINS, and the two branches are NOT the same " +
      "query: a device-only session names no person and holds no membership, so its answer is " +
      "read by the session's own ENROLLMENT ID (a fact the session carries, never one the caller " +
      "supplied); only the OPERATOR branch is membership-rooted, which is where R13 binds because " +
      "that is where an identity exists to be tested. It was this list's last `defect` row — it " +
      "returned every shop in the database to any caller (042 E4, 034 E9) — and 042 A8's 'no " +
      "defect-kind row may exist at G2' is now assertable as zero rather than deferred.",
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
  // E03-D07's two redemption routes. Both are CORRECT outside the tenant prefix
  // and for the same underlying reason as the four above: they are how a caller
  // acquires a tenant, so a tenant-prefixed spelling would need the answer before
  // it could ask the question.
  {
    method: "POST",
    path: "/api/v1/invitations/redemptions",
    kind: "exemption",
    reason:
      "an employee redeems an invitation on the shop's own counter phone (048 §7.1, §7.2). The " +
      "TOKEN names the shop and the DEVICE SESSION names the shop, and the redemption succeeds " +
      "only when those are the same shop (R15) — so a shopId in the path would be a third, " +
      "caller-asserted answer to a question two authenticated facts already agree on, which is " +
      "042 E4's defect re-created on a credential route.",
  },
  {
    method: "POST",
    path: "/api/v1/device-enrollments",
    kind: "exemption",
    reason:
      "a phone redeems an enrollment code and becomes an enrolled device (048 §7.3). The caller " +
      "holds no session by construction — that is what enrollment means — so it can name no " +
      "tenant; the shop and the location are properties of the CODE.",
  },
  // E03-D11's four. The first two ESTABLISH a person (048 §4.1) and the second
  // two are reached FROM that person's session — and all four are correct outside
  // the tenant prefix for one reason: the shop is a property of the SESSION, so a
  // `shopId` in the path would be a caller-asserted fourth answer to a question
  // the session already answers. 048 §6.1 makes the URL's shop a value CHECKED
  // against the session; on these routes there is no value to check and nothing
  // to check it against, so there is no path parameter at all.
  {
    method: "POST",
    path: "/api/v1/privileged-sessions",
    kind: "exemption",
    reason:
      "a person signs in with a password and a second factor (048 §4.1). It ESTABLISHES the " +
      "tenant — the body names a shop and the shop is checked against the person's live " +
      "memberships — so it cannot sit inside a prefix whose tenant it is being asked to supply.",
  },
  {
    method: "POST",
    path: "/api/v1/privileged-sessions/end",
    kind: "exemption",
    reason:
      "it revokes the privileged chain named by the cookie and touches no shop-scoped row beyond " +
      "the revocation fact itself, so it has no tenant to be prefixed by — the same reason " +
      "`POST /api/v1/operator-sessions/end` is exempt one class up.",
  },
  {
    method: "POST",
    path: "/api/v1/invitations",
    kind: "exemption",
    reason:
      "an owner or manager invites a person (048 §7.1). The shop is the PRIVILEGED SESSION's and " +
      "is stamped from it, never read from the URL or the body — so a `shopId` in the path would " +
      "be exactly the caller-asserted tenant 048 §6.1 removed. Its sibling " +
      "`/api/v1/invitations/redemptions` is exempt for the mirror reason (the caller has no " +
      "tenant yet); this one is exempt because the caller's tenant is not the URL's to state.",
  },
  {
    method: "POST",
    path: "/api/v1/device-enrollment-codes",
    kind: "exemption",
    reason:
      "an owner or manager equips a phone (048 §7.3). Same reason as the row above: the shop is " +
      "the session's, and the LOCATION is a body field checked against that shop rather than a " +
      "second path segment.",
  },
  // E03-B06's two connector routes. Both are CORRECT outside the tenant prefix,
  // and for a reason neither of the two above has: their caller is not a Longbox
  // client at all. A `shopId` in either path would be a tenant asserted by
  // whoever completed a redirect or posted a body — 042 E4's defect, arriving on
  // the two routes where the tenant is established by a SIGNATURE instead.
  {
    method: "GET",
    path: "/api/v1/connectors/shopify/callback",
    kind: "exemption",
    reason:
      "the OAuth authorization-code callback (000-docs/053 §8.3). The shop is resolved from the " +
      "single-use install state Longbox itself minted, and cross-checked against the `shop` " +
      "parameter inside the signed message — two facts that must agree, neither of them a path " +
      "segment. Shopify chooses the URL shape here, not this repository: it is the `redirect_uri` " +
      "registered with the app, and a tenant-prefixed spelling would need the answer before it " +
      "could ask the question.",
  },
  {
    method: "POST",
    path: "/api/v1/connectors/shopify/webhooks",
    kind: "exemption",
    reason:
      "the signed webhook receiver (053 §8.2). ONE path for every topic, because the " +
      "authentication, the dedupe and the receipt are identical and only the EFFECT differs — " +
      "and the tenant is `X-Shopify-Shop-Domain` inside the signed bytes, resolved to a shop when " +
      "one exists and recorded with a null resolution when it does not (a `shop/redact` for an " +
      "already-offboarded store is the commonest message this route receives).",
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

/**
 * 048 §6.2: the principal a route requires before it resolves anything.
 *
 * `privileged` is E03-D11's (048 §4.1, §12.4 row 3a) and is NOT "device+operator
 * plus something". It names a DIFFERENT COOKIE and a different chain: a route
 * that requires it reads `__Host-lb_priv` and nothing else, so an operator
 * session on a shared counter phone can never satisfy one — which is 048 §4.1's
 * *"never an operator session on a shared phone"* made unconstructible rather
 * than checked in a handler somebody has to remember to write.
 */
export type AuthPrincipal = "none" | "device" | "device+operator" | "privileged";

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
   *
   * `provider-callback` — E03-B06's own kind (042 §5.1 CLASS TWO at v1.4.3, 048
   * I6(d)/(e) as amended at v1.5.2, 000-docs/053 §8). An inbound call from a
   * THIRD-PARTY SYSTEM: it holds no Longbox session and can be given none, it
   * cannot be made to send an `Idempotency-Key` or a `Sec-Fetch-Site`, and its
   * authenticity is a signature over its own bytes verified before any row is
   * read or written. **The two mechanisms are REPLACED, not dropped**, and by
   * strictly stronger ones — a cross-site form cannot produce a valid HMAC, and
   * exactly-once is a named UNIQUE on the ACT rather than a header a caller
   * chose. The row is a separate KIND rather than a `none` principal alone
   * because "anonymous" and "not a browser and not our client" are different
   * facts, and only the second one licenses skipping a CSRF check.
   */
  readonly kind: "route" | "redirect" | "provider-callback";
  readonly reason: string;
  /**
   * A row for a route the DESIGN has settled and this bead does not register.
   * The walk asserts a pending row's path is ABSENT from the route table, so the
   * flag has to be flipped deliberately when the route lands rather than quietly
   * going stale — the same construction `APPEND_ONLY_EXEMPTIONS.pending` uses.
   */
  readonly pending?: true;
  readonly closingBead?: string;
  /**
   * The permission a PENDING privileged route will require when it lands
   * (E03-B03, 054 §3.4).
   *
   * It is here rather than on the route table because a pending route has no row
   * there — `ROUTES` generates the OpenAPI document, and a route in the document
   * that the server does not serve is a lie in a published artifact. The
   * permission is still decided NOW, by the bead that owns the matrix, so that
   * E03-D11 inherits an answer instead of choosing one — the same construction
   * this row's `principal` already uses, and the same reason.
   *
   * The permission is already ENFORCED on the CLI path E03-D07 built
   * (`issueInvitation` / `issueEnrollmentCode` call the same decision function),
   * so the route landing later does not change who may do the thing; it changes
   * only how they reach it.
   */
  readonly requires?: Permission;
  /**
   * **A `privileged` route that acts on the CALLER'S OWN SESSION and nothing
   * else, and therefore requires no permission** (E03-D11, 057 §4.4).
   *
   * It exists so the privileged branch of the authentication hook can fail
   * CLOSED like the tenant branch does. There, a route that declares no
   * `requires` is refused, because a shop-scoped route added next year must not
   * inherit "anyone with a membership" by saying nothing. The same default is
   * right here and has one genuine exception — signing yourself out — and the
   * exception is a ROW with a reason rather than a name the hook special-cases,
   * for 041 §9.2 item 4's rule: an absence is indistinguishable from an
   * oversight, and a declared exemption is a decision a reviewer can argue with.
   *
   * There is exactly one member and there is no obvious second. A route that
   * touches anything beyond the caller's own session — a membership, a device, a
   * credential, a shop's configuration — is not self-service however it is
   * spelled, and the permission it needs is a decision for 054's matrix.
   */
  readonly selfService?: true;
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
    reason:
      "*MY SHOPS* (048 §6.4). A DEVICE session is required and an operator is NOT, because this " +
      "is the route that tells a freshly-enrolled phone which shop it is — requiring an operator " +
      "would mean the picker could not render before somebody had already picked. It is one half " +
      "of R8's enumerated device-only set, the other being the operator roster. E03-D09 narrowed " +
      "who could REACH it; E03-D08 narrowed what it ANSWERS, and both were needed: a reachable " +
      "set narrowed without narrowing the answer would have let the defect row look closed while " +
      "the query was unchanged.",
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
    reason:
      "REGISTERED BY E03-D07, AND THE PRINCIPAL THIS ROW ALREADY DECLARED IS THE RIGHT ONE — but " +
      "its previous REASON was not, so it is corrected here rather than left to read as a " +
      "decision. That reason said the code is 'bound to a device already holding a live device " +
      "session at the same shop (048 R15)', which is R15's rule applied to the one object it " +
      "cannot fit: the caller of this route IS the phone being enrolled, so it holds no session " +
      "— that is what enrollment means, and 048 §7.3's own sentence is 'the phone posts it once " +
      "and receives a device session'. The binding is therefore unavailable, §7.1a's other clause " +
      "governs ('a short code without both is refused'), and the code is 128 bits. Its bounds are " +
      "the entropy, the route's aggregate bucket taken in the hook before any body parsing, the " +
      "per-shop delay and `ordinary` bucket taken in the service once the code names a shop, a " +
      "fifteen-minute expiry, and `UNIQUE (code_id)`. See `src/services/auth/enrollment.ts`.",
  },
  {
    method: "POST",
    path: "/api/v1/invitations/redemptions",
    principal: "device",
    kind: "route",
    reason:
      "R15's DEVICE BINDING, and this is the route it was written for. An invitation is redeemable " +
      "ONLY on a phone already holding a live device session at the shop the token names — a " +
      "correct code presented from a browser with no device session, or from another shop's " +
      "phone, is refused with §9.3's constant answer. `device` and not `device+operator`: the " +
      "person redeeming is not an operator yet, which is the whole point of the route.",
  },
  // -------------------------------------------------------------------------
  // E03-D11's two sign-in routes, and the two issuance rows they un-pend.
  // -------------------------------------------------------------------------
  {
    method: "POST",
    path: "/api/v1/privileged-sessions",
    principal: "none",
    kind: "route",
    reason:
      "THE CREDENTIALS IN THE BODY ARE THE AUTHENTICATION, exactly as they are on " +
      "`POST /api/v1/device-sessions` one class down. A person signing in holds no session — that " +
      "is what signing in means — so the principal is `none` and the route's bounds are elsewhere: " +
      "the aggregate route bucket the hook takes before any body parsing, a second bucket keyed on " +
      "the digest of the SUBMITTED ADDRESS taken in the service (048 R14's shape, and never an IP " +
      "— 042 §8.1), 048 §9.1's growing per-person delay under the `user_credential` anchor, and a " +
      "budget SHARED with both second-factor methods so alternating between them does not double " +
      "it (048 §4.3, applied to three forms of one thing). Every refusal — unknown address, wrong " +
      "password, wrong code, no membership at the named shop, still inside the delay — answers " +
      "`SESSION_REQUIRED` with no `details` (048 §9.3).",
  },
  {
    method: "POST",
    path: "/api/v1/privileged-sessions/end",
    principal: "privileged",
    kind: "route",
    selfService: true,
    reason:
      "Ending the chain the `__Host-lb_priv` cookie names. `privileged` and not `none`: a caller " +
      "with no privileged session has nothing to end, and answering 200 to one would be an oracle " +
      "that says nothing useful and invites a client to treat sign-out as fire-and-forget.",
  },
  {
    method: "POST",
    path: "/api/v1/invitations",
    principal: "privileged",
    kind: "route",
    requires: "membership.invite",
    reason:
      "REGISTERED BY E03-D11, AND THE PRINCIPAL CHANGED WHEN IT LANDED. This row previously read " +
      "`device+operator` with `pending: true`, and the principal was wrong for the reason the row " +
      "itself gave: 048 §4.1 puts issuance in a session established by password + TOTP, and " +
      "`device+operator` is the PIN-derived session on the shared counter phone that §4.1 refuses " +
      "in its own words. The old value was the closest the two ratified kinds could come; the " +
      "third kind is what the row always wanted. **The permission is unchanged** — " +
      "`membership.invite`, decided by E03-B03 (054 §3.4) precisely so this bead would inherit an " +
      "answer instead of choosing one — and it is enforced at the hook's ONE site, against the " +
      "memberships the session's shop resolves. `mayGrantRole` refuses handing out a role above " +
      "the inviter's own rank, in the service, where the target role is known; " +
      "`scripts/issue-invitation.ts` stays as the schema-owner path and reaches the same function.",
  },
  // -------------------------------------------------------------------------
  // E03-B06's connector rows. Both are `provider-callback`, and the kind is the
  // whole of what makes them safe outside the two CSRF mechanisms — see the
  // `kind` documentation above and 000-docs/053 §8.
  // -------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/v1/connectors/shopify/callback",
    principal: "none",
    kind: "provider-callback",
    reason:
      "THE SIGNATURE AND THE SINGLE-USE STATE ARE THE AUTHENTICATION. A merchant's browser " +
      "arrives here at the end of Shopify's redirect holding no Longbox session — that is what an " +
      "install IS — and the request is accepted only when the query's HMAC verifies under the " +
      "app secret AND names an unspent, unexpired state Longbox minted for that exact store. " +
      "**It is a GET that WRITES, which 048 I6(d) forbade flatly and now permits for this kind " +
      "alone (v1.5.2)**: the reason I6(d) existed is that a cross-site GET carries the browser's " +
      "AMBIENT CREDENTIAL, and this route reads no cookie at all, so there is no ambient " +
      "authority to abuse. Its exactly-once guarantee is `connector_install_state_use (state_id)` " +
      "— a replayed callback is a failed INSERT the database decides.",
  },
  {
    method: "POST",
    path: "/api/v1/connectors/shopify/webhooks",
    principal: "none",
    kind: "provider-callback",
    reason:
      "Shopify's servers post here. They send no cookie, no `Sec-Fetch-Site` and no " +
      "`Idempotency-Key`, and no amount of configuration can make them: the caller is not a " +
      "browser and not our client. `X-Shopify-Hmac-Sha256` over the RAW body under the app secret " +
      "is the authentication, verified before a single row is read or written, so a forged " +
      "message costs one HMAC and leaves no trace. Exactly-once is " +
      "`connector_webhook_receipt (connector, webhook_id)`, because Shopify's delivery is " +
      "at-least-once BY DESIGN and an at-least-once delivery met by anything other than a unique " +
      "index is an at-least-once EFFECT.",
  },
  {
    method: "GET",
    path: "/api/v1/connectors/shopify/install",
    principal: "device+operator",
    kind: "route",
    pending: true,
    closingBead: "E10-B02 `longbox-e5b.10.2` (the Shopify app lifecycle and the unlisted app)",
    reason:
      "DECLARED AND NOT REGISTERED. Starting an install is an OWNER act and 048 §7.3 puts owner " +
      "acts in a privileged session. ⚠ **THE REASON THIS ROW GIVES HAS CHANGED, AND THE OLD ONE " +
      "IS NOW FALSE**: it said privileged sessions 'still do not exist (048 §12.4 row 3a)', which " +
      "E03-D11 made untrue — they exist, and the two rows below are registered behind them. What " +
      "keeps THIS row pending is a different thing entirely: the route it describes is the " +
      "merchant-facing landing an UNLISTED PUBLIC APP needs (Shopify's `app_url`), which is the " +
      "distribution mode CLAUDE.md locked decision 3 makes the END STATE and not the pilot's. It " +
      "waits on E10-B02 and on nothing in this bead. E03-B06 builds the SERVICE (`mintInstallState`, " +
      "which mints the state and the authorize URL) and reaches it from " +
      "`scripts/connector-install.ts`, exactly as E03-D07 reaches `issueInvitation` from a CLI. " +
      "The route this row describes is the merchant-facing landing an UNLISTED PUBLIC APP needs " +
      "(Shopify's `app_url`), which is the distribution mode CLAUDE.md locked decision 3 makes " +
      "the END STATE and not the pilot's. It is declared so its principal is a decision somebody " +
      "already made rather than one inferred by whoever adds the handler. The walk asserts this " +
      "path is ABSENT today.",
  },
  {
    method: "POST",
    path: "/api/v1/device-enrollment-codes",
    principal: "privileged",
    kind: "route",
    requires: "device.enrollment.issue",
    reason:
      "REGISTERED BY E03-D11, on the row above's reasoning verbatim: 048 §7.3 is 'an owner or " +
      "manager, IN A PRIVILEGED SESSION', and that session now exists. **The one thing worth " +
      "reading twice is the SCOPE**: `device.enrollment.issue` is LOCATION-scoped, and a " +
      "privileged session stands nowhere by default — so a location-scoped manager reaches it " +
      "only by naming their storefront at sign-in (`location_id` on the sign-in body, checked " +
      "against the shop and against their own grant; 057 §4.4). A person who names none holds a " +
      "session that reaches shop-scoped acts only, which is fail-closed and is the correct " +
      "direction: a grant that is valid somewhere does not reach an act from nowhere.",
  },
];

/** The rows whose routes must be registered; `pending` rows must not be. */
export const AUTH_ALLOWLIST_ACTIVE = AUTH_ALLOWLIST.filter((r) => r.pending !== true);

/**
 * The paths whose REQUEST LINE must never be logged (E03-B06, 019 T31).
 *
 * DERIVED FROM THE ALLOWLIST rather than written as a literal, so a route that
 * joins the `provider-callback` class gets the suppression by declaring what it
 * is — the same reason the authentication hook reads these rows instead of a
 * list of paths.
 *
 * **Why the class and not a hand-picked path.** A provider callback's URL is
 * chosen by the PROVIDER and carries whatever the provider puts in it: today an
 * OAuth `state`, a `code` and an `hmac`, all of which 019 T31 keeps out of a log
 * and `migrations/026` keeps out of a column. The next member's query string is
 * not knowable now, which is exactly why the rule is about the KIND.
 */
export const NO_REQUEST_LOG_PATHS: readonly string[] = AUTH_ALLOWLIST.filter(
  (r) => r.kind === "provider-callback"
).map((r) => r.path);

/**
 * Whether this request's line must be suppressed.
 *
 * Takes the RAW url and compares only the part before `?`: the decision is about
 * the route, and reading the query here would be reading the thing being kept
 * out of the log.
 */
export function isNoRequestLogPath(url: string | undefined): boolean {
  if (url === undefined) return false;
  const path = url.split("?", 1)[0]!;
  return NO_REQUEST_LOG_PATHS.includes(path);
}

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
  /**
   * **The permission this route requires (E03-B03, 054 §3).**
   *
   * `null` ONLY for a route outside the tenant prefix. That is not a category of
   * route that skips authorization — it is the set of routes for which no role
   * has been resolved yet, because a role is a property of a MEMBERSHIP AT A
   * SHOP and those routes are exactly the ones that establish the shop (the
   * probe, the two credential exchanges, the picker, *my shops*, the two
   * redemptions). They are constrained by their PRINCIPAL instead, on the auth
   * allowlist, which is the other of 048 R12's two lists.
   *
   * **Every tenant-prefixed route declares a non-null permission, and the hook
   * fails closed on one that does not** — a shop-scoped route added without a
   * `requires` is refused, not permitted. `tests/contract/permission-enforcement.test.ts`
   * asserts the rule in both directions AND asserts the hook actually calls the
   * decision function, on the same evidence standard
   * `rate-class-enforcement.test.ts` had to learn: a declaration whose
   * enforcement nobody proved reachable is a declaration, not a control.
   */
  readonly requires: Permission | null;
  readonly request: ZodTypeAny | null;
  /**
   * The QUERY schema, for a route whose input arrives in the query string
   * (E03-B06). Null everywhere else.
   *
   * A separate field from `request` rather than a reuse of it, because the two
   * land in different places in the generated document — `requestBody` versus
   * `parameters[in=query]` — and a route table that conflated them would emit an
   * artifact describing a body no client sends (042 §3.3 property 3's fiction
   * rule).
   */
  readonly query?: ZodTypeAny;
  /**
   * 042 §5.1 CLASS TWO, at v1.4.3 (E03-B06). Present ONLY on a route whose
   * caller is a third-party system that cannot be made to send an
   * `Idempotency-Key`.
   *
   * **`uniqueOn` is required and is the whole point.** 042 §5.1 already rules
   * that "a UNIQUE constraint" alone is not a test — every table here has a
   * surrogate primary key, which is a UNIQUE — so a member of the class must
   * NAME the constraint that makes a second execution of the same request a
   * failed INSERT rather than a second effect. `tests/contract/api-contract.test.ts`
   * reads this string and asserts the index exists in `migrations/`.
   */
  readonly idempotency?: {
    readonly exemptionClass: "provider-callback";
    /** `table (columns)`, spelled as the migration spells it. */
    readonly uniqueOn: string;
    readonly reason: string;
  };
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
  // E03-B03, and it belongs in COMMON for exactly the reason SESSION_REQUIRED
  // does: the refusal comes from the HOOK, over a `requires` every shop-scoped
  // route declares, so it is total by construction. `COMMON` is spread only into
  // the tenant-prefixed rows (the sessionless routes spell their own lists), so
  // adding it here declares it precisely where a role can be refused and nowhere
  // else — `/healthz` does not grow a 403.
  "PERMISSION_DENIED",
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
    requires: null,
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
    requires: null,
    mutating: false,
    // 048 R14's device class, for the same reason `GET /api/v1/operators` carries
    // it: an authenticated read outside the tenant plugin has no ordinary bucket
    // (that hook lives inside the plugin) and must not be keyed on an IP. Keyed
    // on the DEVICE, never on the person. It read `none` while it was a defect,
    // which made the one route that leaked the `shop` table also the one
    // unmetered read in the system.
    rateClass: "device",
    request: null,
    response: s.shopsResponse,
    successStatus: 200,
    errors: ["SESSION_REQUIRED", "RATE_LIMITED", "INTERNAL_ERROR"],
    summary:
      "My shops: the shops this session may act on — the enrolled shop for a device-only " +
      "session, and that shop on a live membership for an operator session (048 §6.4).",
  },
  {
    method: "POST",
    path: `${s.API_PREFIX}/device-sessions`,
    pluginPath: null,
    requires: null,
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
    requires: null,
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
    requires: null,
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
  // -------------------------------------------------------------------------
  // E03-D11 — the first factor, the privileged session, and the two issuance
  // routes (000-docs/057; 048 §4.1, §7, §12.4 row 3a).
  //
  // ⚠ **THE LAST TWO CARRY A NON-NULL `requires` OUTSIDE THE TENANT PREFIX, AND
  // THAT IS A CHANGE TO WHAT `requires: null` MEANS** (057 §4.4). The field's own
  // documentation said null "ONLY for a route outside the tenant prefix", and the
  // ground it gave is the real rule: those are the routes for which NO ROLE HAS
  // BEEN RESOLVED YET, because a role is a property of a membership at a shop and
  // they are the routes that establish the shop. A privileged session establishes
  // the shop at SIGN-IN, so by the time these two are reached a role has been
  // resolved — the ground does not apply to them, and the rule keyed on the
  // prefix would have exempted the two most privileged acts in the system from
  // the one enforcement site 054 §3 built. So the rule is restated as the ground
  // always was: **a route whose caller has a resolved role declares the
  // permission it requires; a route that has no role yet declares null.**
  {
    method: "POST",
    path: `${s.API_PREFIX}/privileged-sessions`,
    pluginPath: null,
    requires: null,
    mutating: true,
    // The aggregate route bucket, taken in the hook before any body parsing
    // (`rateClass !== "none"` on a sessionless route). The per-identifier bucket
    // is taken in `openPrivilegedSession`, because the address is in the BODY and
    // `onRequest` runs before the body is read — the same split
    // `openDeviceSession` makes for the same mechanical reason.
    rateClass: "device",
    request: s.privilegedSessionRequest,
    response: s.privilegedSessionResponse,
    successStatus: 201,
    errors: [
      "VALIDATION_FAILED",
      "SESSION_REQUIRED",
      "IDEMPOTENCY_KEY_REQUIRED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ],
    summary: "Open a privileged session with a password and a second factor.",
  },
  {
    method: "POST",
    path: `${s.API_PREFIX}/privileged-sessions/end`,
    pluginPath: null,
    requires: null,
    mutating: true,
    // `ordinary` and NOT `device`: this route's caller holds a privileged
    // session, which names a shop and names no device at all — so the shop is
    // the only key available and it is the key 042 §8.1 asks for. The bucket is
    // taken by the privileged branch of the hook at the earliest point the shop
    // is known, which is the same place the two issuance routes take theirs.
    rateClass: "ordinary",
    request: s.endPrivilegedSessionRequest,
    response: s.endPrivilegedSessionResponse,
    successStatus: 200,
    errors: ["PRIVILEGED_SESSION_REQUIRED", "IDEMPOTENCY_KEY_REQUIRED", "RATE_LIMITED", "INTERNAL_ERROR"],
    summary: "End the privileged session named by its cookie.",
  },
  {
    method: "POST",
    path: `${s.API_PREFIX}/invitations`,
    pluginPath: null,
    requires: "membership.invite",
    mutating: true,
    // `ordinary`, keyed on the SESSION's shop — which the hook resolves before
    // the permission decision, so unlike the redemption routes this bucket is
    // taken in the hook and not in the service. There is no body field to wait
    // for: the shop is the session's.
    rateClass: "ordinary",
    request: s.invitationRequest,
    response: s.invitationResponse,
    successStatus: 201,
    errors: [
      "VALIDATION_FAILED",
      "PRIVILEGED_SESSION_REQUIRED",
      "MFA_REENROLLMENT_REQUIRED",
      // 057 §4.4b: `role: "owner"` and no fresh code, or a code that did not
      // verify. The only privileged act whose damage the session's expiry does
      // not bound, so the factor is re-presented rather than inherited.
      "FRESH_SECOND_FACTOR_REQUIRED",
      "PERMISSION_DENIED",
      "SHOP_NOT_FOUND",
      "INVITATION_REFUSED",
      "IDEMPOTENCY_KEY_REQUIRED",
      "IDEMPOTENCY_KEY_REUSED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ],
    summary: "Invite a person to this shop; the code is shown once.",
  },
  {
    method: "POST",
    path: `${s.API_PREFIX}/device-enrollment-codes`,
    pluginPath: null,
    requires: "device.enrollment.issue",
    mutating: true,
    rateClass: "ordinary",
    request: s.enrollmentCodeRequest,
    response: s.enrollmentCodeResponse,
    successStatus: 201,
    errors: [
      "VALIDATION_FAILED",
      "PRIVILEGED_SESSION_REQUIRED",
      "MFA_REENROLLMENT_REQUIRED",
      "PERMISSION_DENIED",
      "SHOP_NOT_FOUND",
      "ENROLLMENT_CODE_REFUSED",
      "IDEMPOTENCY_KEY_REQUIRED",
      "IDEMPOTENCY_KEY_REUSED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ],
    summary: "Issue a device enrollment code for one phone at one location.",
  },
  {
    method: "POST",
    path: `${s.API_PREFIX}/operator-sessions/end`,
    pluginPath: null,
    requires: null,
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
    // E03-D07. `ordinary`, keyed on THE SHOP THE TOKEN NAMES (048 R14) — which
    // is the device session's shop, because R15 makes a redemption succeed only
    // when those two are the same.
    //
    // ⚠ THE BUCKET IS TAKEN IN `redeemInvitation`, AND THE FIRST VERSION OF THIS
    // COMMENT DESCRIBED AN ENFORCEMENT THAT DID NOT EXIST. It said the hook
    // "keys `ordinary` off the tenant prefix" — which is true of `app.ts`'s hook
    // and useless here, because that hook is registered INSIDE the tenant plugin
    // and this route is on the root instance, so it never runs for it. The hook's
    // own bucket is gated on `rateClass === "device"`. Nothing bucketed this
    // route at all: two hundred posts, two hundred 401s, zero limiter calls.
    // The service now takes `takeOrdinary(device.shop_id)` BEFORE any credential
    // is tested, and `tests/contract/rate-class-enforcement.test.ts` no longer
    // accepts a substring as evidence — it requires the call to sit in the
    // function the handler invokes and refuses a guard the route cannot satisfy.
    method: "POST",
    path: `${s.API_PREFIX}/invitations/redemptions`,
    pluginPath: null,
    requires: null,
    mutating: true,
    rateClass: "ordinary",
    request: s.invitationRedemptionRequest,
    response: s.invitationRedemptionResponse,
    successStatus: 201,
    errors: [
      "VALIDATION_FAILED",
      "SESSION_REQUIRED",
      "INVITATION_INVALID",
      "PIN_REFUSED",
      "IDEMPOTENCY_KEY_REQUIRED",
      "IDEMPOTENCY_KEY_REUSED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ],
    summary: "Redeem an invitation on this enrolled phone and set a PIN.",
  },
  {
    // E03-D07. `ordinary`, keyed on the shop the CODE names — unknown until the
    // code is looked up, so the hook takes the route's aggregate bucket and the
    // service takes the shop's. See `src/services/auth/enrollment.ts` for why
    // that ordering is forced here and not on the invitation route.
    method: "POST",
    path: `${s.API_PREFIX}/device-enrollments`,
    pluginPath: null,
    requires: null,
    mutating: true,
    rateClass: "ordinary",
    request: s.deviceEnrollmentRequest,
    response: s.deviceEnrollmentResponse,
    successStatus: 201,
    errors: [
      "VALIDATION_FAILED",
      "ENROLLMENT_CODE_INVALID",
      "IDEMPOTENCY_KEY_REQUIRED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ],
    summary: "Redeem a device enrollment code and receive a device session.",
  },
  {
    // E03-B06. **A GET that MUTATES, and the only one in this table.** It is
    // permitted by 048 I6(d) as amended at v1.5.2, for the `provider-callback`
    // kind alone: I6(d) existed because a cross-site GET carries the browser's
    // ambient credential, and this route reads no cookie, so there is no ambient
    // authority for a cross-site navigation to spend. What it reads instead is a
    // signature it cannot forge and a state it cannot guess.
    //
    // `mutating: true` is stated honestly rather than softened to `false` to
    // dodge a test: the route writes two rows, and a route table that lied about
    // that would be a worse artifact than an amended invariant.
    method: "GET",
    path: `${s.API_PREFIX}/connectors/shopify/callback`,
    pluginPath: null,
    // E03-B03: outside the tenant prefix, so no membership is resolved and no
    // permission can be evaluated. This route's caller is a PROVIDER, not a
    // person — it authenticates by signature (or by the state it was issued),
    // which is a different question from what a role may do.
    requires: null,
    mutating: true,
    // `ordinary`, keyed on the shop the STATE names (048 R14's shape). The
    // hook takes the route's aggregate bucket because the shop is unknown until
    // the state is resolved; `completeInstall` takes the shop's own bucket after
    // the signature verifies, so an unsigned flood is refused more cheaply than
    // a signed one.
    rateClass: "ordinary",
    request: null,
    query: s.connectorCallbackQuery,
    response: s.connectorCallbackResponse,
    successStatus: 200,
    errors: ["VALIDATION_FAILED", "CONNECTOR_CALLBACK_REFUSED", "RATE_LIMITED", "INTERNAL_ERROR"],
    idempotency: {
      exemptionClass: "provider-callback",
      uniqueOn: "connector_install_state_use (state_id)",
      reason:
        "Shopify chooses this URL's shape and sends no header of ours. A GET takes no " +
        "Idempotency-Key under 042 §5.1 in any case (the rule governs non-safe methods), so the " +
        "exactly-once guarantee has to be a constraint on the ACT: a replayed callback fails to " +
        "insert the state's use row, inside the same transaction as the token version it names, " +
        "so the loser writes neither.",
    },
    summary: "Complete a connector install: verify the grant and introduce the token version.",
  },
  {
    // E03-B06. The signed webhook receiver — ONE route for every topic, because
    // the authentication, the dedupe and the receipt are identical and only the
    // effect differs.
    method: "POST",
    path: `${s.API_PREFIX}/connectors/shopify/webhooks`,
    pluginPath: null,
    // E03-B03: outside the tenant prefix, so no membership is resolved and no
    // permission can be evaluated. This route's caller is a PROVIDER, not a
    // person — it authenticates by signature (or by the state it was issued),
    // which is a different question from what a role may do.
    requires: null,
    mutating: true,
    // `ordinary`, keyed on the shop the SIGNED DOMAIN names — taken in
    // `receiveWebhook` after the HMAC, for the same reason as the callback.
    rateClass: "ordinary",
    request: null,
    response: s.connectorWebhookResponse,
    successStatus: 200,
    errors: ["WEBHOOK_SIGNATURE_INVALID", "RATE_LIMITED", "INTERNAL_ERROR"],
    idempotency: {
      exemptionClass: "provider-callback",
      uniqueOn: "connector_webhook_receipt (connector, webhook_id)",
      reason:
        "Shopify's delivery is at-least-once BY DESIGN and it sends no Idempotency-Key. The " +
        "guarantee is the unique index on ITS id: the receipt insert is the duplicate check " +
        "(041 §4.2(i)), and the effect runs only for the insert that won, in the same " +
        "transaction, so a crash between the two replays both.",
    },
    summary: "Receive one signed Shopify webhook: authenticate, record, then act.",
  },
  {
    method: "POST",
    path: `${s.TENANT_PREFIX}/scan-sessions`,
    pluginPath: "/scan-sessions",
    requires: "scan.session.open",
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
    requires: "scan.session.read",
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
    requires: "scan.photo.write",
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
    requires: "scan.photo.read",
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
    requires: "scan.identify",
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
    requires: "scan.confirm",
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
    requires: "condition.record",
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
    requires: "pricing.request",
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
    requires: "listing.draft.request",
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
