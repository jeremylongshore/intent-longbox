// THE AUTHENTICATION HOOK — one `onRequest`, six steps, in a fixed order.
//
//   1. `Sec-Fetch-Site: same-origin` (Origin allowlist fallback) on every
//      non-`GET`/`HEAD` route — 048 §5.1 (R9), checked BEFORE anything is read;
//   2. `Idempotency-Key` presence on every mutating route — 048 §5.3 (R10),
//      moved out of the handlers and ahead of the multipart parser;
//   3. the session read, and the two-cookie pairing check — §3.6 (R1);
//   4. the rate class — 048 R14, for the ANONYMOUS routes, before the
//      short-circuit that used to skip it;
//   5. the tenant, resolved MEMBERSHIP-FIRST from the session — §6.1 (R13);
//   6. the PERMISSION the route declares, decided against the grants that tenant
//      resolution just read — E03-B03 / 054 §3.
//
// **The order is the security property, not a style.** Steps 1 and 2 are one
// header lookup each and touch no disk, no database and no session, so the
// cheapest refusal comes first (042 §5.3's "the cheapest possible rejection
// path"). Step 3 before step 4 because the tenant is a fact ABOUT the session.
// I6(b) asserts the ordering rather than the presence, because a check in the
// right place and a check in the wrong place return the same code.
//
// **It fails closed on a route it has never heard of, TWICE.** The required
// principal is `device+operator` unless the AUTH allowlist says otherwise — so a
// route registered next year is behind the strongest requirement by DEFAULT, and
// its author has to write a row to loosen it. A route added outside the tenant
// plugin is exactly how `GET /api/v1/shops` happened (048 E3), and the fix for
// that class is a default, not a reminder. E03-B03 adds the second: a
// tenant-prefixed route whose route-table row declares no `requires` is REFUSED,
// so a new shop-scoped route does not inherit "anyone with a membership" by
// saying nothing.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { LongboxError } from "../../contracts/v1/errors.js";
import { authRowFor, routeSpecFor, type AuthPrincipal, type RouteSpec } from "../../contracts/v1/routes.js";
import { TENANT_PREFIX } from "../../contracts/v1/schemas.js";
import { tenantDb, withTransaction, type Tx } from "../../db.js";
import type { ShopRateLimiter } from "../rateLimit.js";
import type { AppConfig } from "../../config.js";
import { highestRole, membershipsAt, type MembershipRow, type Role } from "./memberships.js";
import { isPrivileged } from "../../contracts/v1/permissions.js";
import { PERMISSION_MATRIX_VERSION, authorize } from "./permissions.js";
import { recordAuthorizationDecision, shouldRecord } from "./authorizationAudit.js";
import { mfaState } from "./authenticator.js";
import {
  DEVICE_COOKIE,
  OPERATOR_COOKIE,
  PRIVILEGED_COOKIE,
  clearCookie,
  isSameOriginRequest,
  setCookie,
  shouldRotate,
} from "./policy.js";
import { resolvePrincipal, resolvePrivileged } from "./principal.js";
import { lockAndRotate, type DeviceBoundSession, type SessionRow } from "./sessions.js";

/** What the hook leaves on the request for the handlers and the services. */
export interface RequestAuth {
  device?: DeviceBoundSession;
  operator?: DeviceBoundSession;
  /**
   * E03-D11's third principal (048 §4.1). Present ONLY on a route whose auth
   * row declares `principal: "privileged"`, and never beside `device` or
   * `operator` — the hook reads one cookie set or the other and returns.
   */
  privileged?: SessionRow;
  /** 048 §6.1 — the ONLY source of `shop_id` for a request. */
  shopId?: string;
  locationId?: string;
  /**
   * 034 §3.1's "highest role held at this scope". **It still GRANTS nothing** —
   * E03-B03 put the granting in `authorize()`, which reads the individual
   * memberships rather than this collapsed answer, and this stays what the
   * request context always was: what this person is, here.
   */
  role?: Role;
  /**
   * The membership grant the permission decision was taken against (E03-B03).
   * Present only on a request that was ALLOWED, and recorded on the
   * `authorization_decision` row: it is the AUTHORITY the act was taken under,
   * which a role name cannot identify when a person holds two grants.
   */
  membershipId?: string;
  /**
   * TRUE once the authentication hook has taken this shop's `ordinary` token
   * (054 §4.3, F4), so the tenant plugin's hook does not take a second one for
   * the same request. Two takes would halve every shop's declared budget, which
   * is a rate limit nobody wrote down.
   */
  ordinaryTokenTaken?: boolean;
  /**
   * 048 §6.3 — every write records this and sets `actor_verified = true`, and
   * NEITHER is ever accepted from a request body.
   */
  operatorId?: string;
  /** `Set-Cookie` values this request owes its response. */
  cookies: string[];
  /**
   * The session lock and rotation, to be run INSIDE the request transaction at
   * 048 K1's declared position — after the `request_idempotency` INSERT and
   * before the `scan_session` anchor. `runIdempotent` calls it; nothing else may.
   */
  sessionLock?: (tx: Tx) => Promise<void>;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: RequestAuth;
  }
}

export interface AuthHookDeps {
  pool: pg.Pool;
  config: AppConfig;
  limiter: ShopRateLimiter;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A static mount is NOT a route (042 §3.1) and has no principal.
 *
 * There is exactly ONE left — `public/`, the phone client itself, registered by
 * `@fastify/static` as the wildcard Fastify reports as `/*`. Putting it behind
 * the hook would mean the phone could not load the page it uses to sign in.
 *
 * The `uploads/` mount that used to be the second one is GONE (E03-D05, 046 §6
 * Q5): photographs are served by a tenant-prefixed route, which the hook covers
 * like every other. So a photo is now behind a device session AND an operator
 * session, which is what made deleting the mount the right ruling rather than
 * signing its URLs.
 */
function isStaticMount(url: string): boolean {
  return url === "/*" || url === "/";
}

export function registerAuthentication(app: FastifyInstance, deps: AuthHookDeps): void {
  // `decorateRequest` needs a value; the hook assigns the real object as its
  // first statement, on every request, before anything reads it.
  app.decorateRequest("auth", null as unknown as RequestAuth);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    req.auth = { cookies: [] };
    const url = req.routeOptions.url;
    if (url === undefined) return; // unrouted: the 404 handler answers, reflecting nothing
    if (isStaticMount(url)) return;

    const row = authRowFor(req.method, url);
    const spec = routeSpecFor(req.method, url);

    // A 308 alias reads nothing, writes nothing and resolves no tenant (R12). It
    // must answer IDENTICALLY to its target for an anonymous, a wrong-tenant and
    // a missing-header request — which it does by doing none of the checks and
    // letting the target do all of them (I6(f)).
    if (row?.kind === "redirect") return;

    // ⚠ THE ONE MECHANISM SUBSTITUTION IN THIS HOOK, AND IT IS DECLARED RATHER
    // THAN INFERRED (E03-B06; 042 §5.1 CLASS TWO at v1.4.3; 048 I6(d)/(e) as
    // amended at v1.5.2; 000-docs/053 §8).
    //
    // A `provider-callback` row is an inbound call from a THIRD-PARTY SYSTEM —
    // Shopify's servers, or a merchant's browser at the end of Shopify's
    // redirect. Neither can be made to send `Sec-Fetch-Site` or an
    // `Idempotency-Key`: the first is a browser header a server-to-server POST
    // does not have, and the second is a Longbox convention a provider has never
    // heard of. Demanding them would not make the route safer; it would make it
    // unreachable, which is how a receiver ends up unsigned instead.
    //
    // **Both mechanisms are REPLACED, and by strictly stronger ones.** For CSRF:
    // the handler verifies an HMAC over the request's own bytes under the app
    // secret, and a cross-site HTML form cannot produce one — which is a
    // stronger statement than "this request claims to be same-origin". For
    // exactly-once: the route table's `idempotency.uniqueOn` NAMES the database
    // constraint that makes a second execution a failed INSERT, and a contract
    // test asserts that index exists in `migrations/`. The class is bounded by
    // the allowlist row, so a future route joins it by having somebody write a
    // row and an argument — never by an author deciding a header is awkward.
    const providerCallback = row?.kind === "provider-callback";

    // ---- 1. cross-site (048 §5.1, R9) ------------------------------------
    if (!providerCallback && !SAFE_METHODS.has(req.method)) {
      const same = isSameOriginRequest(
        {
          secFetchSite: headerOf(req, "sec-fetch-site"),
          origin: headerOf(req, "origin"),
        },
        deps.config.publicOrigins
      );
      // The same code an unauthenticated request gets, deliberately: §9.3's
      // constant answer means a caller cannot tell a cross-site attempt from a
      // missing cookie, and neither can a page trying to probe for one.
      if (!same) throw new LongboxError("SESSION_REQUIRED");
    }

    // ---- 2. Idempotency-Key (048 §5.3, R10) ------------------------------
    // Driven from the ROUTE TABLE rather than written per handler, for I6's own
    // reason: a rule enforced by fourteen copies is a rule with thirteen places
    // to be forgotten. A mutating route absent from the table is treated as
    // mutating anyway — fail closed on the table too.
    if (!providerCallback && !SAFE_METHODS.has(req.method) && (spec === undefined || spec.mutating)) {
      const key = headerOf(req, "idempotency-key");
      if (key === undefined || key.length === 0 || key.length > 200) {
        throw new LongboxError("IDEMPOTENCY_KEY_REQUIRED");
      }
    }

    const required: AuthPrincipal = row?.principal ?? "device+operator";

    // ---- 3. the rate class, BEFORE the anonymous short-circuit -----------
    //
    // ⚠ THIS ORDER IS A FIX, AND THE BUG IT FIXES IS WORTH STATING. The block
    // that takes the device bucket used to sit AFTER `if (required === "none")
    // return` and to key on the resolved session's `device_id` — so the one
    // route that is anonymous, mutating and append-only-writing,
    // `POST /api/v1/device-sessions`, declared `rateClass: "device"` in the
    // route table and was **bucketed by nothing at all**. Four hundred anonymous
    // POSTs produced four hundred refusals, zero throttles and four hundred
    // `auth_attempt` rows. The declaration was asserted by the route walk; the
    // ENFORCEMENT was not, which is exactly the shape 048 R10 warns about — a
    // check in the wrong place returns the same code as a check in the right one.
    //
    // A route with no session yet has no device and no shop to key on, and 042
    // §8.1 forbids an IP. What it does have is ITSELF: the bucket below is
    // per-route and shop-independent, which bounds the aggregate flood. The
    // second half — a bucket keyed on the PRESENTED CREDENTIAL's digest, which
    // 048 R14 asks for — is taken in `openDeviceSession`, because the credential
    // is in the BODY and `onRequest` runs before any body parsing. Two buckets,
    // two questions: this one bounds "how much of this route at all", that one
    // bounds "how many times this exact secret".
    //
    // **The DoS trade, stated rather than discovered.** A flood can make device
    // enrollment unavailable estate-wide for a minute. That is accepted for the
    // same reason 048 §9.1 accepts the lockout's: the worst outcome available to
    // a flooder is a wait on a route a shop touches once per phone per month,
    // and the alternative on the table was an unmetered write path.
    //
    // **E03-D07 WIDENED THE CONDITION FROM `=== "device"` TO "any class at
    // all"**, and the widening is the same bug one route later. `POST
    // /api/v1/device-enrollments` is anonymous and declares `rateClass:
    // "ordinary"` — because 048 R14 keys it on the shop the CODE names — and
    // `ordinary` is taken by the tenant plugin's hook, which this route is
    // outside of. Under the old condition it would have declared a class and
    // been bucketed by nothing, which is precisely the state the paragraph above
    // was written about. A sessionless route now gets the aggregate bucket
    // whatever class it declares, and its class-specific bucket is taken in the
    // service once the body has been read.
    if (required === "none" && spec !== undefined && spec.rateClass !== "none") {
      const decision = deps.limiter.takeRoute(url);
      if (!decision.allowed) {
        throw new LongboxError("RATE_LIMITED", { retry_after_seconds: decision.retryAfterSeconds });
      }
    }

    // ---- 4. the session (048 §3.3, §3.6) ---------------------------------
    if (required === "none") return;

    // ⚠ **THE PRIVILEGED BRANCH READS A DIFFERENT COOKIE AND RETURNS BEFORE THE
    // OTHER TWO ARE LOOKED AT** (E03-D11; 048 §4.1, 057 §4.2).
    //
    // This is what makes 048 §4.1's *"never an operator session on a shared
    // phone"* structural rather than a check. A privileged route consults
    // `__Host-lb_priv` and nothing else, so an operator cookie cannot satisfy
    // one however privileged its holder is — and the counter phone's two
    // cookies are not touched, so an owner who signs in privileged in the same
    // browser does not disturb whatever the phone is doing.
    if (required === "privileged") {
      await enforcePrivileged(req, deps, { url, spec });
      return;
    }

    const outcome = await resolvePrincipal(deps.pool, headerOf(req, "cookie"), new Date());
    if (outcome.kind !== "resolved") {
      // Both cookies are cleared on every refusal, including a pair mismatch:
      // the client falls back to the device-session flow, and there is no
      // reconciliation, no repair and no third state (048 §3.6).
      clearBoth(req);
      flushCookies(req, reply);
      throw new LongboxError("SESSION_REQUIRED");
    }

    req.auth.device = outcome.device;
    if (outcome.operator) req.auth.operator = outcome.operator;
    req.auth.locationId = outcome.device.location_id;

    // 048 R8 / I1: a device session with NO live operator session reaches an
    // ENUMERATED set — the operator picker and the shops route — and every other
    // route refuses it. The set is positive, so a route added later is outside it
    // by default rather than inside it by omission.
    if (required === "device+operator" && !outcome.operator) {
      throw new LongboxError("OPERATOR_REQUIRED");
    }

    // The device class of 048 R14 for the routes that DO have a session: keyed
    // on the device, never on an IP and never on the person — a stranger must
    // not be able to exhaust a named person's budget.
    if (spec?.rateClass === "device") {
      const decision = deps.limiter.takeDevice(outcome.device.device_id);
      if (!decision.allowed) {
        throw new LongboxError("RATE_LIMITED", { retry_after_seconds: decision.retryAfterSeconds });
      }
    }

    // ---- 5. the tenant (048 §6.1, R13) -----------------------------------
    const operator = outcome.operator;
    if (operator) {
      if (operator.app_user_id) req.auth.operatorId = operator.app_user_id;
      req.auth.shopId = operator.shop_id;
      req.auth.locationId = operator.location_id;

      if (url.startsWith(TENANT_PREFIX)) {
        const urlShopId = (req.params as { shopId?: string } | undefined)?.shopId;
        // The session is the tenant; the URL is a value CHECKED against it. The
        // comparison touches no table at all, so the cheapest refusal for the
        // commonest wrong-tenant case reads nothing — which is R13's timing half
        // before the query that is R13's timing half.
        if (urlShopId !== operator.shop_id) throw new LongboxError("SHOP_NOT_FOUND");
        // E03-B04: the first read of the request that CAN name a tenant, so it
        // does. `membership` carries a tenant policy, so this read is filtered by
        // the database as well as by its own predicate — and a session whose
        // `shop_id` did not match would find nothing here, which is the same
        // refusal the line above already produces.
        const memberships = await membershipsAt(
          tenantDb(deps.pool, operator.shop_id),
          operator.app_user_id!,
          operator.shop_id
        );
        // A membership can be revoked while a session is live (048 §2.3, §3.4).
        // The session is not evidence of a membership; it is evidence of who is
        // asking, and the membership is checked every request.
        if (memberships.length === 0) throw new LongboxError("SHOP_NOT_FOUND");
        // `memberships` is non-empty here (the line above refuses otherwise), so
        // this is always a role; the local keeps `exactOptionalPropertyTypes`
        // honest rather than asserting past it.
        const held = highestRole(memberships);
        if (held !== undefined) req.auth.role = held;

        // ---- 6. the PERMISSION (E03-B03, 054 §3) ------------------------
        //
        // ⚠ **AUTHORIZATION IS HERE, IN THE HOOK, AND IN NO HANDLER.** The
        // reason is the one 048 R10 gives for moving `Idempotency-Key` out of
        // fourteen handlers: a rule enforced by fourteen copies is a rule with
        // thirteen places to be forgotten. It runs AFTER the tenant is resolved
        // and BEFORE any handler, so no route can read a row it was not
        // permitted to ask for, and it is driven off the route table's
        // `requires` column so adding a route means declaring a permission
        // rather than remembering a check.
        await enforcePermission(req, deps, { url, spec, session: operator, memberships });
      }
    }

    // ---- rotation (048 §3.3) ---------------------------------------------
    // BOTH chains, independently. The device chain's rotation period is measured
    // in a day and the operator chain's in minutes (§3.6's "two principals with
    // different lifetimes, which was §3.1's whole point"), so on most requests
    // this rotates one row or none. Rotating only the request's "primary"
    // principal would leave the device chain to rotate solely on requests that
    // happen to carry no operator, which is not a rule anybody wrote down.
    await maybeRotate(req, deps, [outcome.device, outcome.operator]);
  });

  // The one place a `Set-Cookie` reaches a response. Cookies are ACCUMULATED on
  // the request by whoever mints a session and flushed here, so no service and
  // no handler writes a header — and a rotation that happened inside a
  // transaction that then rolled back never reaches this point, because the
  // token was minted by a statement that rolled back with it.
  app.addHook("onSend", async (req, reply, payload) => {
    flushCookies(req, reply);
    return payload;
  });
}

/**
 * **THE PERMISSION CHECK, AND THE AUDIT ROW IT LEAVES** (E03-B03; 054 §3, §4).
 *
 * One function, called from one place, for every shop-scoped request.
 *
 * **It fails closed on a route with no declared permission.** A tenant-prefixed
 * route absent from the route table, or present with `requires: null`, is
 * REFUSED — not permitted. That is the same construction the principal already
 * uses (`device+operator` unless a row says otherwise) and it is the half that
 * matters: a shop-scoped route added next year without a `requires` does not
 * quietly inherit "anyone with a membership", it fails until its author decides
 * what it needs. The refusal is `PERMISSION_DENIED` rather than a 500 because
 * from the caller's side it is exactly what it says it is.
 *
 * **The two refusals answer differently, on purpose** (054 §3.3):
 *   * `refused_role` → `PERMISSION_DENIED` (403). A fact about the caller's own
 *     role, which they can read off their own screen.
 *   * `refused_scope` → `SHOP_NOT_FOUND` (404), **byte-identical to the answer a
 *     caller with no membership at all gets** — no `details`, same code, same
 *     shape. 019 T24 and 048 §6.5: a person standing at the wrong counter must
 *     not learn that the right counter exists, and a location-scoped grant is
 *     precisely the case where they might.
 *
 * **One consequence of failing closed on the table, stated because it is a
 * behaviour change and not a bug:** Fastify auto-registers a `HEAD` for every
 * `GET`, the route table declares only `GET` and `POST` (042 §3.1), so a `HEAD`
 * on a shop-scoped route now answers `403` where it previously reached the
 * handler. Nothing in this repository issues one — the phone client does not,
 * and the route walk already filters `HEAD` out — and a `HEAD` answers the same
 * existence question a `GET` does, so refusing an undeclared method is the right
 * side to fail on. The tenancy answer is unaffected: a wrong shop is still
 * `SHOP_NOT_FOUND` from step 5, before this function runs.
 *
 * **The audit write is fail-closed for an allowance and best-effort for a
 * refusal**, which is not an inconsistency but the only coherent pair. If the
 * decision row cannot be written for an act we are about to PERMIT, we do not
 * permit it — otherwise "every authorized mutation has a decision record" is a
 * sentence no artifact may say (021 discipline). If it cannot be written for an
 * act we are REFUSING, the refusal still stands: turning a refusal into a
 * different refusal buys nothing, and turning it into a 500 would tell a caller
 * that their probe hit something.
 */
async function enforcePermission(
  req: FastifyRequest,
  deps: AuthHookDeps,
  ctx: {
    url: string;
    spec: RouteSpec | undefined;
    /** The session the decision is taken FOR: an operator's, or a privileged one. */
    session: SessionRow;
    memberships: readonly MembershipRow[];
  }
): Promise<void> {
  const permission = ctx.spec?.requires ?? null;
  if (permission === null) {
    // Fail closed: a shop-scoped route that declares no permission is refused.
    // See the header — this is the default that makes the column mandatory.
    throw new LongboxError("PERMISSION_DENIED");
  }

  // ---- the ORDINARY bucket, taken HERE and not in the tenant plugin --------
  //
  // ⚠ **THIS MOVED, AND THE FINDING IS THE SECURITY LENS'S F4.** The audit
  // INSERT below runs in an `onRequest` hook on the ROOT instance, and the
  // tenant plugin's rate bucket runs in a plugin-level hook that fires AFTER
  // it — so one enrolled phone could drive unbounded `authorization_decision`
  // INSERTs by holding a live session and hammering a route it is refused,
  // never reaching the limiter at all. A table whose growth is bounded by
  // "requests that reach a live grant" is only bounded if something bounds
  // those.
  //
  // The bucket is therefore taken at the earliest point where the shop is
  // KNOWN — immediately after tenant resolution, which is where 042 §8.1 wanted
  // it anyway ("per shop, never per IP") — and `app.ts`'s plugin hook skips when
  // this one has already taken it, so a request still spends exactly one token.
  // A throttled request records NO decision, which is correct: no decision was
  // taken.
  // E03-D11 guards the take: the privileged branch takes this bucket at the
  // earliest point ITS shop is known, which is earlier still, and a second take
  // for one request would halve the shop's declared budget — F4's own finding,
  // arriving from the other direction.
  takeOrdinaryOnce(req, deps, ctx.session.shop_id);

  const verdict = authorize(ctx.memberships, permission, {
    atLocation: ctx.session.location_id,
    now: new Date(),
  });

  if (
    shouldRecord(verdict, {
      mutating: ctx.spec?.mutating ?? true,
      privileged: isPrivileged(permission),
    })
  ) {
    const record = {
      shopId: ctx.session.shop_id,
      routeMethod: req.method.toUpperCase(),
      // The TEMPLATE Fastify registered, never `req.url` (054 §4.2).
      routePath: ctx.url,
      permission,
      matrixVersion: PERMISSION_MATRIX_VERSION,
      matrixCommit: deps.config.buildCommit ?? "unknown",
      membershipId: verdict.kind === "allowed" ? verdict.membershipId : null,
      role: verdict.role ?? null,
      sessionChainId: ctx.session.chain_id,
      decision: verdict.kind === "allowed" ? ("allowed" as const) : ("refused" as const),
      refusalReason:
        verdict.kind === "allowed"
          ? null
          : verdict.kind === "refused_role"
            ? ("role" as const)
            : ("scope" as const),
    };
    try {
      await recordAuthorizationDecision(tenantDb(deps.pool, ctx.session.shop_id), record);
    } catch (err) {
      if (verdict.kind === "allowed") {
        req.log.error({ err }, "authorization decision could not be recorded; refusing the request");
        throw new LongboxError("INTERNAL_ERROR");
      }
      req.log.error({ err }, "authorization refusal could not be recorded");
    }
  }

  if (verdict.kind === "allowed") {
    req.auth.membershipId = verdict.membershipId;
    return;
  }
  if (verdict.kind === "refused_scope") throw new LongboxError("SHOP_NOT_FOUND");
  throw new LongboxError("PERMISSION_DENIED");
}

/** The shop's `ordinary` token, taken at most once per request (054 §4.3 F4). */
function takeOrdinaryOnce(req: FastifyRequest, deps: AuthHookDeps, shopId: string): void {
  if (req.auth.ordinaryTokenTaken === true) return;
  const decision = deps.limiter.takeOrdinary(shopId);
  req.auth.ordinaryTokenTaken = true;
  if (!decision.allowed) {
    throw new LongboxError("RATE_LIMITED", { retry_after_seconds: decision.retryAfterSeconds });
  }
}

/**
 * **THE PRIVILEGED BRANCH** (E03-D11; 048 §4.1, §8.1; 054 §3; 057 §4.2, §4.4).
 *
 * It is the tenant branch's shape with three differences, and each one is a
 * decision rather than a shortcut:
 *
 *   1. **the tenant comes from the SESSION and there is no URL to check it
 *      against.** These routes carry no `:shopId` — the shop is a property of
 *      the sign-in, checked there against the person's live memberships — so
 *      048 §6.1's "the URL is a value checked against the session" has nothing
 *      to check and nothing is skipped;
 *   2. **the membership is re-read every request**, exactly as it is for an
 *      operator. A session is not evidence of a membership; it is evidence of
 *      who is asking, and a revocation that landed a second ago must take
 *      effect now. A person with no live membership at the session's shop gets
 *      `SHOP_NOT_FOUND` — byte-identical to a shop that does not exist;
 *   3. **`mfaState` gates the whole branch.** 048 §8.1: a session established
 *      with a recovery code *"can reach NOTHING else until"* the person has
 *      re-enrolled. It is a PREDICATE over facts — no live authenticator, and a
 *      recovery-code use exists — so nothing can be left stale and nothing but
 *      an enrollment escapes it. **It runs on every privileged request and not
 *      only on the one that redeemed the code**, which is stronger than 048
 *      asks for and is the correct reading: a person whose factor is retired
 *      from another surface is in that state too, and a check that only fired
 *      at sign-in would not know.
 *
 * **It fails closed on a route with no declared permission, and the exception
 * is a DECLARED ROW rather than a special case.** A privileged route must name
 * a permission unless its auth-allowlist row says `selfService: true`, which
 * means it acts on the caller's own session and nothing else. Without that
 * rule, a privileged route added next year with no `requires` would inherit
 * "any privileged session at any shop", which is the fail-open 054 §3 removed
 * from the tenant branch.
 */
async function enforcePrivileged(
  req: FastifyRequest,
  deps: AuthHookDeps,
  ctx: { url: string; spec: RouteSpec | undefined }
): Promise<void> {
  const outcome = await resolvePrivileged(deps.pool, headerOf(req, "cookie"), new Date());
  if (outcome.kind !== "resolved") {
    req.auth.cookies.push(clearCookie(PRIVILEGED_COOKIE));
    throw new LongboxError("PRIVILEGED_SESSION_REQUIRED");
  }
  const session = outcome.privileged;
  const appUserId = session.app_user_id;
  // Unreachable: `migrations/031`'s shape CHECK makes `app_user_id` NOT NULL on
  // every privileged row. Here for `requireDevice`'s reason — a database
  // guarantee read through a nullable column is a guarantee somebody has to
  // remember, and a thrown code is cheaper than a 500.
  if (appUserId === null) throw new LongboxError("PRIVILEGED_SESSION_REQUIRED");

  req.auth.privileged = session;
  req.auth.shopId = session.shop_id;
  req.auth.operatorId = appUserId;
  if (session.location_id !== null) req.auth.locationId = session.location_id;

  // The bucket, at the earliest point the shop is known — 054 §4.3's F4, whose
  // finding was that an audit INSERT reachable before any limiter is an
  // unbounded table. Everything below this line reads or writes.
  //
  // The condition is written out rather than implied, and it FAILS CLOSED: a
  // route the table has never heard of takes a token like every other. Every
  // privileged route declares `ordinary` — a privileged session names a shop and
  // names no device, so the shop is the only key available and it is the key
  // 042 §8.1 asks for — and `tests/contract/rate-class-enforcement.test.ts`
  // requires a hook site to name the guard it runs behind, because a guard
  // nobody checked is how three routes came to declare a class and be bucketed
  // by nothing.
  if (ctx.spec === undefined || ctx.spec.rateClass !== "none") {
    takeOrdinaryOnce(req, deps, session.shop_id);
  }

  const state = await mfaState(tenantDb(deps.pool, session.shop_id), appUserId);
  if (state === "must_reenroll" && ctx.spec?.requires !== null) {
    throw new LongboxError("MFA_REENROLLMENT_REQUIRED");
  }

  const memberships = await membershipsAt(tenantDb(deps.pool, session.shop_id), appUserId, session.shop_id);
  if (memberships.length === 0) throw new LongboxError("SHOP_NOT_FOUND");
  const held = highestRole(memberships);
  if (held !== undefined) req.auth.role = held;

  const row = authRowFor(req.method, ctx.url);
  if (ctx.spec?.requires === null || ctx.spec?.requires === undefined) {
    // The declared exception, and it is one row: a route that acts on the
    // caller's own session needs no permission, and a route that does not say so
    // is refused.
    if (row?.selfService !== true) throw new LongboxError("PERMISSION_DENIED");
  } else {
    await enforcePermission(req, deps, { url: ctx.url, spec: ctx.spec, session, memberships });
  }

  await maybeRotate(req, deps, [session]);
}

function headerOf(req: FastifyRequest, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

function clearBoth(req: FastifyRequest): void {
  req.auth.cookies.push(clearCookie(DEVICE_COOKIE), clearCookie(OPERATOR_COOKIE));
}

function flushCookies(req: FastifyRequest, reply: FastifyReply): void {
  const pending = req.auth?.cookies ?? [];
  if (pending.length === 0) return;
  const existing = reply.getHeader("set-cookie");
  const previous = Array.isArray(existing) ? existing : existing === undefined ? [] : [String(existing)];
  reply.header("set-cookie", [...previous, ...pending]);
  req.auth.cookies = [];
}

/**
 * Rotation happens in a transaction, and WHICH transaction depends on the method.
 *
 * For a MUTATING request the rotation joins the request's own transaction at
 * 048 K1's declared position — after the `request_idempotency` INSERT and before
 * the `scan_session` anchor — so **a request that rolls back issues no
 * successor** (I3(viii)) and the original token still works. `runIdempotent`
 * runs the closure; nothing else does.
 *
 * For a SAFE method there is no request transaction to join, and the choice is
 * between rotating in a transaction of its own and not rotating at all. Not
 * rotating is the wrong answer: idle expiry is computed at issuance (§3.3), so a
 * phone that only reads would idle out mid-shift while it was in constant use.
 * The transaction here is one INSERT under one row lock and takes no domain
 * lock at all, so it cannot participate in 042 §5.3(b)'s ordering and cannot
 * deadlock against it.
 */
async function maybeRotate(
  req: FastifyRequest,
  deps: AuthHookDeps,
  candidates: ReadonlyArray<SessionRow | undefined>
): Promise<void> {
  const now = new Date();
  const due = candidates.filter((s): s is SessionRow => s !== undefined && shouldRotate(timingOf(s), now));
  if (due.length === 0) return;

  if (!SAFE_METHODS.has(req.method)) {
    req.auth.sessionLock = async (tx: Tx): Promise<void> => {
      for (const session of due) await rotateInto(req, tx, session, now);
    };
    return;
  }
  // A safe method has no request transaction to join, and the choice is between
  // rotating in one of its own and not rotating at all. Not rotating is the
  // wrong answer: `idle_expires_at` is computed at issuance (§3.3), so a phone
  // that only READS would idle out mid-shift while it was in constant use. This
  // transaction is one row lock and one INSERT and takes no domain lock at all,
  // so it cannot participate in 042 §5.3(b)'s ordering and cannot deadlock
  // against it. It is AWAITED rather than fired off, because a `Set-Cookie` that
  // arrives after the response is a cookie the browser never sees.
  // Both chains are at ONE shop by construction — `issueOperatorSession` copies
  // `shop_id` from its parent device session at issuance (048 §3.5) — so one
  // tenant context covers the whole rotation (E03-B04).
  await withTransaction(
    deps.pool,
    async (tx) => {
      for (const session of due) await rotateInto(req, tx, session, now);
    },
    { label: "session-rotate", tenant: { shopId: due[0]!.shop_id } }
  );
}

async function rotateInto(req: FastifyRequest, tx: Tx, session: SessionRow, now: Date): Promise<void> {
  const issued = await lockAndRotate(tx, session, now);
  if (!issued) return;
  req.auth.cookies.push(setCookie(cookieNameFor(session), issued.token, issued.row.absolute_expires_at));
}

/**
 * The cookie a rotation of THIS session sets.
 *
 * A total map over the three kinds rather than a ternary, for `sessions.ts`'s
 * reason one file over: the ternary this replaced would have set the OPERATOR
 * cookie on a privileged rotation — silently, on the chain that can staff a
 * shop, with the browser then holding a privileged token in the slot the counter
 * flow reads.
 */
const COOKIE_FOR: Record<SessionRow["kind"], string> = {
  device: DEVICE_COOKIE,
  operator: OPERATOR_COOKIE,
  privileged: PRIVILEGED_COOKIE,
};

function cookieNameFor(session: SessionRow): string {
  return COOKIE_FOR[session.kind];
}

function timingOf(row: SessionRow) {
  return {
    issuedAt: row.issued_at,
    rotateAfter: row.rotate_after,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}
