// THE AUTHENTICATION HOOK — one `onRequest`, four steps, in a fixed order.
//
//   1. `Sec-Fetch-Site: same-origin` (Origin allowlist fallback) on every
//      non-`GET`/`HEAD` route — 048 §5.1 (R9), checked BEFORE anything is read;
//   2. `Idempotency-Key` presence on every mutating route — 048 §5.3 (R10),
//      moved out of the handlers and ahead of the multipart parser;
//   3. the session read, and the two-cookie pairing check — §3.6 (R1);
//   4. the rate class — 048 R14, for the ANONYMOUS routes, before the
//      short-circuit that used to skip it;
//   5. the tenant, resolved MEMBERSHIP-FIRST from the session — §6.1 (R13).
//
// **The order is the security property, not a style.** Steps 1 and 2 are one
// header lookup each and touch no disk, no database and no session, so the
// cheapest refusal comes first (042 §5.3's "the cheapest possible rejection
// path"). Step 3 before step 4 because the tenant is a fact ABOUT the session.
// I6(b) asserts the ordering rather than the presence, because a check in the
// right place and a check in the wrong place return the same code.
//
// **It fails closed on a route it has never heard of.** The required principal
// is `device+operator` unless the AUTH allowlist says otherwise — so a route
// registered next year is behind the strongest requirement by DEFAULT, and its
// author has to write a row to loosen it. A route added outside the tenant
// plugin is exactly how `GET /api/v1/shops` happened (048 E3), and the fix for
// that class is a default, not a reminder.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { LongboxError } from "../../contracts/v1/errors.js";
import { authRowFor, routeSpecFor, type AuthPrincipal } from "../../contracts/v1/routes.js";
import { TENANT_PREFIX } from "../../contracts/v1/schemas.js";
import { withTransaction, type Tx } from "../../db.js";
import type { ShopRateLimiter } from "../rateLimit.js";
import type { AppConfig } from "../../config.js";
import { membershipAt, type Role } from "./memberships.js";
import {
  DEVICE_COOKIE,
  OPERATOR_COOKIE,
  clearCookie,
  isSameOriginRequest,
  setCookie,
  shouldRotate,
} from "./policy.js";
import { resolvePrincipal } from "./principal.js";
import { lockAndRotate, type SessionRow } from "./sessions.js";

/** What the hook leaves on the request for the handlers and the services. */
export interface RequestAuth {
  device?: SessionRow;
  operator?: SessionRow;
  /** 048 §6.1 — the ONLY source of `shop_id` for a request. */
  shopId?: string;
  locationId?: string;
  /** 034 §3.1's "highest role held at this scope". It GRANTS nothing (E03-B03's). */
  role?: Role;
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
        const scope = await membershipAt(deps.pool, operator.app_user_id!, operator.shop_id);
        // A membership can be revoked while a session is live (048 §2.3, §3.4).
        // The session is not evidence of a membership; it is evidence of who is
        // asking, and the membership is checked every request.
        if (!scope) throw new LongboxError("SHOP_NOT_FOUND");
        req.auth.role = scope.role;
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
  await withTransaction(
    deps.pool,
    async (tx) => {
      for (const session of due) await rotateInto(req, tx, session, now);
    },
    { label: "session-rotate" }
  );
}

async function rotateInto(req: FastifyRequest, tx: Tx, session: SessionRow, now: Date): Promise<void> {
  const issued = await lockAndRotate(tx, session, now);
  if (!issued) return;
  req.auth.cookies.push(setCookie(cookieNameFor(session), issued.token, issued.row.absolute_expires_at));
}

function cookieNameFor(session: SessionRow): string {
  return session.kind === "device" ? DEVICE_COOKIE : OPERATOR_COOKIE;
}

function timingOf(row: SessionRow) {
  return {
    issuedAt: row.issued_at,
    rotateAfter: row.rotate_after,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}
