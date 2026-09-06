// The application service behind the four authentication routes: one function
// per route, each returning the wire status, a DTO-shaped body and any cookies
// the response owes.
//
// ⚠ THESE FOUR ROUTES DO NOT GO THROUGH `runIdempotent`, AND THE REASON IS NOT
// EXPEDIENCE. 042 §5.1 requires an `Idempotency-Key` on every mutating route and
// §5.3 serialises the act through `request_idempotency`, whose stored response is
// the RESPONSE BODY. An authentication act's effect is not its body — it is the
// `Set-Cookie`, which is not stored and cannot be — so a replayed
// `POST /api/v1/operator-sessions` would return a byte-identical `201` with **no
// cookie**, and the phone would look signed in while holding nothing. That is a
// worse failure than a duplicate: a duplicate operator session costs one extra
// row and is revoked by the next one (`operator_switch`), while a successful
// response with no credential is a screen that lies.
//
// **The header is still REQUIRED**, by the hook, on all four — because 048 §5.2's
// second CSRF mechanism is exactly "a cross-site HTML form cannot set a custom
// header", and dropping the requirement here would silently remove that defence
// from the only routes that mint credentials. So the header is enforced and the
// TABLE is not consulted, which is a narrower deviation than it looks: §5.1's
// rule is kept, §5.3's storage is skipped, and the two are separable.
import type pg from "pg";
import { LongboxError } from "../../contracts/v1/errors.js";
import { serviceDb, tenantDb, withTransaction, type Queryable, type Tx } from "../../db.js";
import type { AppConfig } from "../../config.js";
import { API_PREFIX } from "../../contracts/v1/schemas.js";
import { replayIfSettled, runIdempotent, type IdempotentRequest } from "../idempotency.js";
import type { AuthenticatorKeyring } from "./aead.js";
import { MFA_REQUIRED_ROLES, enrollAuthenticator, mfaState, verifyTotp } from "./authenticator.js";
import {
  EnrollmentOfferAlreadySpent,
  mintEnrollmentOffer,
  openEnrollmentOffer,
  spendEnrollmentOffer,
} from "./enrollmentOffer.js";
import { otpauthUri } from "./totp.js";
import { digestOf } from "./codes.js";
import { lockCredential, provisionPassword, replacePassword, verifyPassword } from "./credentials.js";
import { resolveDeviceCredential } from "./devices.js";
import {
  EnrollmentCodeAlreadySpent,
  enrollDevice,
  issueEnrollmentCode,
  verifyEnrollmentCode,
  type DeviceKind,
} from "./enrollment.js";
import {
  InvitationAlreadySpent,
  grantInvitation,
  issueInvitation,
  verifyInvitation,
  type InvitableRole,
} from "./invitations.js";
import { membershipAt, membershipsAt, shopsForSession, type ShopSummary } from "./memberships.js";
import { upsertPerson } from "./people.js";
import { mayIssueInvitation } from "./invitations.js";
// E03-D17: the ONE door onto a person's attributes (034 §3.3, 019 T35(b)). Every
// call below writes an `identity_access` fact; nothing in this file may read
// `app_user` directly, and `pnpm arch` refuses it if anybody tries.
import {
  httpAccessor,
  resolvePersonByKey,
  resolvePersonForAuthenticatorEnrollment,
  resolveShopRoster,
  type ObservedRoute,
  type Person,
} from "../../identity/index.js";
import { recordFailure, setOperatorPin, verifyOperatorPin } from "./pin.js";
import { redeemRecoveryCode } from "./recovery.js";
import { tokenHash } from "./secrets.js";
import type { ShopRateLimiter } from "../rateLimit.js";
import { DEVICE_COOKIE, OPERATOR_COOKIE, PRIVILEGED_COOKIE, clearCookie, setCookie } from "./policy.js";
import {
  issueDeviceSession,
  issueOperatorSession,
  issuePrivilegedSession,
  revokeChain,
  revokePrivilegedChainsOf,
  type DeviceBoundSession,
  type SessionRow,
} from "./sessions.js";

export interface AuthDeps {
  pool: pg.Pool;
  config: AppConfig;
  /**
   * The rate limiter, which this service needs and the scan-session service does
   * not: two of the four authentication routes are reached with no session to
   * key a bucket on, so the key has to be derived from what the REQUEST carries
   * (048 R14) — and that is the body, which the hook cannot see.
   */
  limiter: ShopRateLimiter;
}

export interface AuthResult {
  status: number;
  body: unknown;
  /** `Set-Cookie` values, accumulated onto the request and flushed by the hook. */
  cookies: string[];
}

/**
 * A phone exchanges the secret it was enrolled with for a device session.
 *
 * Every failure answers `SESSION_REQUIRED` with no `details` (048 §9.3): an
 * unknown secret, a revoked credential and a malformed one are indistinguishable
 * on the wire, because a helpful error at an authentication boundary is a query
 * interface over the credential table.
 */
export async function openDeviceSession(deps: AuthDeps, secret: string): Promise<AuthResult> {
  // THE SECOND BUCKET, KEYED ON THE PRESENTED CREDENTIAL'S DIGEST (048 R14).
  //
  // The hook already bounded the route in aggregate; this bounds ONE SECRET, and
  // it is taken here rather than there for a mechanical reason: the credential
  // arrives in the BODY, and the hook is an `onRequest` that runs before any
  // body parsing. Never an IP (042 §8.1) and never a person — the digest names
  // a credential, and a stranger holding a wrong guess cannot spend a real
  // phone's budget with it.
  //
  // **It is taken BEFORE the lookup and before any failure is recorded.** A
  // throttled attempt writes no `auth_attempt` row, for the reason the blocked
  // PIN writes none (048 §9.1, R5): the refusal happens before a credential is
  // tested, so there is no credential test to record — and recording one would
  // let a flooder grow the very table the lockout derivation reads.
  const digest = tokenHash(secret);
  const budget = deps.limiter.takeDevice(`credential:${digest}`);
  if (!budget.allowed) {
    throw new LongboxError("RATE_LIMITED", { retry_after_seconds: budget.retryAfterSeconds });
  }

  // THE ONE READ IN THIS FILE THAT CANNOT NAME A TENANT (E03-B04): the digest is
  // presented by a phone that has not said which shop it is at, and the row it
  // finds IS the shop. The lookup and the failure it may record therefore run in
  // the `device-session-open` service scope — a member of the closed union in
  // `src/db/tenantContext.ts`, not an ad-hoc bypass. The `auth_attempt` row a
  // failure writes carries a NULL `shop_id`, and a NULL matches no tenant policy.
  const credential = await resolveDeviceCredential(serviceDb(deps.pool, "device-session-open"), secret);
  if (!credential) {
    await withTransaction(
      deps.pool,
      (tx) =>
        recordFailure(tx, { method: "device_credential", failureClass: "unknown_or_revoked_credential" }),
      { tenant: { service: "device-session-open" } }
    );
    throw new LongboxError("SESSION_REQUIRED");
  }

  const shop = await readShop(tenantDb(deps.pool, credential.shop_id), credential.shop_id);
  // From here the tenant is KNOWN — the credential named it — so the session is
  // issued under an ordinary tenant context and not under the scope above.
  const issued = await withTransaction(
    deps.pool,
    (tx) =>
      issueDeviceSession(tx, {
        shopId: credential.shop_id,
        locationId: credential.location_id,
        deviceId: credential.device_id,
        deviceCredentialId: credential.credential_id,
        now: new Date(),
      }),
    { tenant: { shopId: credential.shop_id } }
  );

  return {
    status: 201,
    body: {
      device: {
        shop_id: credential.shop_id,
        shop_name: shop.name,
        location_id: credential.location_id,
      },
    },
    cookies: [setCookie(DEVICE_COOKIE, issued.token, issued.row.absolute_expires_at)],
  };
}

/**
 * The picker's roster. Display name and id, ordered by name — never by activity.
 *
 * Through `src/identity/` since E03-D17, so the bulk read that produces N people
 * records itself as one access of `key_kind: "shop_roster"` with
 * `resolved_count: N` — rather than being indistinguishable, in the audit, from
 * the single-person lookup beside it.
 */
export async function operatorRoster(
  deps: AuthDeps,
  device: DeviceBoundSession,
  observed: ObservedRoute
): Promise<AuthResult> {
  const operators: Person[] = await resolveShopRoster(
    tenantDb(deps.pool, device.shop_id),
    httpAccessor(observed, "operator_picker_roster", device.shop_id),
    device.shop_id
  );
  return { status: 200, body: { operators }, cookies: [] };
}

/**
 * ***MY SHOPS*** (048 §6.4) — the route that answers "which tenant", which is
 * why it sits HERE, beside the picker and the PIN, rather than beside the
 * scan-session routes it used to be registered with.
 *
 * That move is the point rather than tidying. `GET /api/v1/shops` was registered
 * in `routes/scanSessions.ts` next to the tenant plugin and outside it — 048 E3's
 * "a route registered outside the tenant plugin never sees the hook", which is
 * exactly how it came to return every shop in the database to any caller. It is
 * an IDENTITY route: it is how a caller learns which tenants its session can act
 * on, so it cannot sit inside a prefix whose tenant it is being asked to supply,
 * and it belongs with the other three routes that have the same property.
 *
 * The operator is OPTIONAL and the answer differs, which is R8's enumerated set
 * doing its job: a device-only session reaches the picker and this route, and
 * this route tells it the one shop the phone is enrolled to.
 */
export async function myShops(
  deps: AuthDeps,
  device: DeviceBoundSession,
  operator?: SessionRow
): Promise<AuthResult> {
  const principal = operator ?? device;
  // The one read whose correct answer SPANS tenants: a person may hold
  // memberships at more than one shop (034 §2.6) and this route is how a caller
  // learns which. It is scoped by `app_user_id` in the predicate rather than by a
  // tenant context, which is exactly why `my-shops` is a declared service scope.
  const shops: ShopSummary[] = await shopsForSession(serviceDb(deps.pool, "my-shops"), {
    ...(operator?.app_user_id ? { appUserId: operator.app_user_id } : {}),
    shopId: principal.shop_id,
  });
  return { status: 200, body: { shops }, cookies: [] };
}

/**
 * Tap a name, enter six digits.
 *
 * **The verification transaction COMMITS whatever the verdict**, and that is the
 * whole shape of this function. `verifyOperatorPin` takes the `operator_pin`
 * anchor `FOR UPDATE`, counts the window and appends the `auth_attempt` failure
 * inside one transaction (048 §9.1, R5) — so throwing `PIN_INVALID` from INSIDE
 * that transaction would roll the failure row back and hand an attacker an
 * unlimited budget through the very mechanism designed to bound it. The verdict
 * comes out; the refusal is thrown after the commit.
 *
 * **Every refusal is one code with no `details`** (§9.3): an unknown pair, a
 * retired PIN, a wrong PIN, a person with no live membership at this shop, and a
 * pair still inside its growing delay all answer `PIN_INVALID`, and the same
 * work is done in each case so the timing does not distinguish them.
 */
export async function openOperatorSession(
  deps: AuthDeps,
  device: DeviceBoundSession,
  input: { appUserId: string; pin: string },
  observed: ObservedRoute
): Promise<AuthResult> {
  const now = new Date();
  const verdict = await withTransaction(
    deps.pool,
    async (tx) => {
      const pin = await verifyOperatorPin(tx, {
        shopId: device.shop_id,
        deviceId: device.device_id,
        appUserId: input.appUserId,
        pin: input.pin,
        pepper: deps.config.pinPepper,
        now,
      });
      if (!pin.ok) return { ok: false as const };
      // MEMBERSHIP-FIRST, and it runs AFTER the hash so the two failures cost the
      // same (§9.3). A PIN row can outlive a membership by a moment — a revocation
      // retires the PIN in the same transaction (§3.5), and this is the belt to
      // that braces: the session is issued only to somebody who holds the scope
      // right now.
      const scope = await membershipAt(tx, input.appUserId, device.shop_id);
      if (!scope) {
        await recordFailure(tx, {
          shopId: device.shop_id,
          deviceId: device.device_id,
          appUserId: input.appUserId,
          method: "operator_pin",
          failureClass: "no_live_membership",
        });
        return { ok: false as const };
      }
      return { ok: true as const };
    },
    { tenant: { shopId: device.shop_id } }
  );

  if (!verdict.ok) throw new LongboxError("PIN_INVALID");

  const issued = await withTransaction(
    deps.pool,
    async (tx) => {
      // Switching operator ENDS the previous one's chain on this phone. Without
      // this, two operator sessions would be live on one device at once and "who
      // is holding the phone" would have two answers — which is the attribution
      // 019 T35(c) reconciles and 022 P1 makes the system's problem.
      const previous = await liveOperatorChainOn(tx, device.chain_id);
      if (previous) {
        await revokeChain(tx, {
          chainId: previous,
          shopId: device.shop_id,
          reason: "operator_switch",
          revokedBy: input.appUserId,
        });
      }
      return issueOperatorSession(tx, { parent: device, appUserId: input.appUserId, now });
    },
    { tenant: { shopId: device.shop_id } }
  );

  // ⚠ **`app_user` IS POLICIED SINCE E03-D21, AND THIS READ IS WHY THE TENANT
  // CONTEXT IS LOAD-BEARING TWICE OVER** (000-docs/062; 056 §11 R9, discharged).
  // The person table carries no tenant COLUMN and now carries a tenant PREDICATE:
  // a live membership at `current_shop_id()`. The block above satisfies it by
  // construction — `membershipAt` refused the session unless this person holds one
  // right now, with the same liveness triple the policy uses — so the read below
  // returns the person, and a person whose grant was revoked in between returns
  // nothing rather than a name.
  //
  // ⚠ **AND IT RUNS ON A `tenantDb` HANDLE SINCE E03-D17, WHICH IS NOT COSMETIC.**
  // The accessor appends an `identity_access` fact on the SAME handle, and that
  // table IS policied (`shop_id = current_shop_id()`) — so a read on the raw pool
  // would leave the fact with no tenant for the WITH CHECK to satisfy and the
  // database would refuse it. The read naming its tenant is what makes the audit
  // writable: the boundary paying for itself rather than being worked around.
  const person = requirePerson(
    await resolvePersonByKey(
      tenantDb(deps.pool, device.shop_id),
      httpAccessor(observed, "session_display_name", device.shop_id),
      input.appUserId
    )
  );
  const shop = await readShop(tenantDb(deps.pool, device.shop_id), device.shop_id);
  return {
    status: 201,
    body: {
      operator: { id: person.id, display_name: person.display_name },
      shop: { id: shop.id, name: shop.name },
    },
    cookies: [setCookie(OPERATOR_COOKIE, issued.token, issued.row.absolute_expires_at)],
  };
}

/**
 * End the operator session; the DEVICE session survives.
 *
 * That asymmetry is 033 A13's requirement in one line: the next person is one tap
 * and a PIN away, and the phone never loses its enrollment.
 */
export async function endOperatorSession(deps: AuthDeps, operator: SessionRow): Promise<AuthResult> {
  await withTransaction(
    deps.pool,
    (tx) =>
      revokeChain(tx, {
        chainId: operator.chain_id,
        shopId: operator.shop_id,
        reason: "signed_out",
        revokedBy: operator.app_user_id,
      }),
    { tenant: { shopId: operator.shop_id } }
  );
  return { status: 200, body: { ended: true }, cookies: [clearCookie(OPERATOR_COOKIE)] };
}

// ===========================================================================
// E03-D11 — the first factor, the privileged session, and the two issuance
// routes it un-pends (000-docs/057; 048 §4.1, §7, §12.4 row 3a)
// ===========================================================================

/**
 * **Sign in as a PERSON: password, then second factor, then one shop.**
 *
 * ⚠ **THE WHOLE FUNCTION IS AN ORDER, AND EVERY POSITION IN IT IS ARGUED**
 * (057 §4.5).
 *
 *   1. **the per-identifier bucket**, keyed on the digest of the submitted
 *      address and taken BEFORE anything is read. Never an IP (042 §8.1) and
 *      never the person, because a person does not exist yet at this point and
 *      a stranger must not be able to exhaust a named person's budget with a
 *      wrong guess. The hook has already taken the route's aggregate bucket;
 *      this one bounds ONE identifier, and it is here rather than there because
 *      the address is in the BODY and `onRequest` runs before body parsing;
 *   2. **one transaction that COMMITS WHATEVER THE VERDICT**, holding
 *      `user_credential FOR UPDATE` and then `user_authenticator FOR UPDATE` —
 *      042 §5.3(b)'s order at positions three and four, which `pnpm arch`
 *      polices. Both anchors, in one transaction, is what makes 048 §4.3's
 *      SHARED per-person budget actually serialised: two anchors and one count
 *      is the write-skew shape §9.1 exists to close, and the only path that
 *      takes just one of them is a path that does not exist;
 *   3. **the first factor before the second**, because a code presented without
 *      a password must not consume a step (048 R19) and must not tell the
 *      caller whether the person has a second factor at all;
 *   4. **the membership read LAST**, on 048 R13's membership-first reasoning
 *      turned around: a person whose factors are wrong must not learn whether
 *      they hold anything at the shop they named, and a person whose factors
 *      are right and whose membership is absent gets the same refusal as one
 *      whose password was wrong (§9.3, and 019 T24 for the shop half);
 *   5. **the session issued in a SECOND transaction**, after the first has
 *      committed its failure facts — the shape `openOperatorSession` already
 *      uses, and for its reason: throwing from inside the verification
 *      transaction would roll back the `auth_attempt` row the delay is derived
 *      from and hand an attacker an unlimited budget.
 *
 * **Every refusal is `SESSION_REQUIRED` with no `details`** (048 §9.3): an
 * unknown address, a wrong password, a wrong code, a replayed step, a person
 * with no second factor, a shop they hold nothing at, a role that is not
 * privileged, and a person still inside their growing delay are one answer.
 */
export async function openPrivilegedSession(
  deps: AuthDeps,
  input: {
    email: string;
    password: string;
    totpCode?: string;
    recoveryCode?: string;
    shopId: string;
    locationId?: string;
  },
  observed: ObservedRoute
): Promise<AuthResult> {
  const now = new Date();

  // ---- 1. the per-identifier bucket, on its OWN budget ---------------------
  //
  // ⚠ **IT WAS `takeDevice` AND THAT WAS TWO BUGS, BOTH THE SECURITY LENS'S**
  // (F2 and F3/F4; 057 §4.5a). `takeDevice` shares the SHOP's 120/min ordinary
  // rate, which is sized for a phone working through a box of books — against an
  // anonymous internet-facing route whose caller is a stranger holding somebody's
  // email address, 120 attempts a minute is not a circuit breaker, it is a
  // comfortable guessing budget. And it shared the map, so a busy counter and a
  // sign-in flood could exhaust each other.
  //
  // **The tighter number NARROWS the TIMING ORACLE. It does not close it**, and
  // that is the half worth reading twice. 048 §9.1 refuses to run argon2id while
  // a person is inside their lockout delay, correctly, and 057 does not reopen it
  // — but the measured consequence on this route is that a KNOWN address inside
  // its delay answers in single-digit milliseconds while an UNKNOWN one pays the
  // decoy's full cost. A budget of five per identifier per minute cuts how FAST a
  // stranger can harvest that difference, from about 120 observations a minute to
  // about five.
  //
  // It cannot equalise the two answers, because the WINDOWS DO NOT MATCH: the
  // bucket refills every minute and `LOCKOUT_WINDOW_MS` is fifteen, so a warmed
  // known address keeps falling out of the bucket and back onto its lockout.
  // Measured in minute two: 6-16 ms on four attempts of five against about 600 ms
  // on all five. See 057 §4.5a and §9 R10 — a narrowed residual, not a fix.
  //
  // The DIGEST and not the address: a rate-limit key is held in a process and
  // printed in a log line the day somebody debugs it, and an address is a person.
  // And keyed on what was SUBMITTED rather than on the resolved person, because
  // bucketing a known address differently from an unknown one would make the
  // bucket the oracle it exists to close.
  const budget = deps.limiter.takeSignIn(tokenHash(input.email.toLowerCase()));
  if (!budget.allowed) {
    throw new LongboxError("RATE_LIMITED", { retry_after_seconds: budget.retryAfterSeconds });
  }

  // 2–4. Person-scoped reads and the failure facts they may append: `app_user`,
  // `user_credential` and `user_authenticator` carry no tenant at all, and the
  // `auth_attempt` rows written here carry a NULL `shop_id` which matches no
  // policy — which is exactly what `second-factor` was declared for
  // (`src/db/tenantContext.ts`, and its own text names this route).
  const verdict = await withTransaction(
    deps.pool,
    async (tx) => {
      const first = await verifyPassword(tx, {
        email: input.email,
        password: input.password,
        pepper: deps.config.pinPepper,
        now,
      });
      if (!first.ok) return { ok: false as const };
      const appUserId = first.appUserId;

      // The second factor. A recovery code substitutes for THIS and for nothing
      // else (048 R20) — the password above has already been verified and is not
      // optional on either branch, which is what makes the substitution a second
      // factor rather than a bearer credential in a drawer.
      if (input.recoveryCode !== undefined) {
        const redeemed = await redeemRecoveryCode(tx, {
          appUserId,
          code: input.recoveryCode,
          pepper: deps.config.pinPepper,
          now,
        });
        if (!redeemed.ok) return { ok: false as const };
      } else {
        const second = await verifyTotp(tx, {
          appUserId,
          code: input.totpCode ?? "",
          keyring: requireKeyring(deps),
          now,
        });
        if (!second.ok) return { ok: false as const };
      }

      return { ok: true as const, appUserId };
    },
    { tenant: { service: "second-factor" } }
  );

  if (!verdict.ok) throw new LongboxError("SESSION_REQUIRED");

  // ---- 4. the scope, in its OWN transaction under the SHOP the caller named --
  //
  // ⚠ **THE CONTEXT CHANGES HERE, AND THE CHANGE IS THE POINT** (057 §4.5). The
  // two factors above are facts about a PERSON, who may hold memberships at
  // several shops (034 §2.6) — so they run in the `second-factor` scope and
  // their failures carry a NULL `shop_id`, which matches no tenant policy. What
  // follows is a question about ONE shop, so it runs under that shop's tenant
  // context: the membership read is filtered by the database as well as by its
  // own predicate, and a caller naming a shop they hold nothing at finds
  // nothing, twice.
  //
  // **It also bounds who can grow a shop's failure log.** These refusals are
  // recorded against the shop the caller NAMED, which is only reachable by
  // somebody who has already passed both factors — a person signing in at the
  // wrong shop, not a stranger. A refusal here before the factors were checked
  // would have let anybody append to any shop's substrate by naming it.
  const scope = await withTransaction(
    deps.pool,
    async (tx) => {
      // `authorize` is not consulted: this route grants no permission — it
      // establishes WHO is asking and at WHICH shop, and 048 §12.3 is explicit
      // that those are different questions.
      const memberships = await membershipsAt(tx, verdict.appUserId, input.shopId);
      if (memberships.length === 0) {
        await recordFailure(tx, {
          shopId: input.shopId,
          appUserId: verdict.appUserId,
          method: "password",
          failureClass: "no_live_membership",
        });
        return false;
      }
      // 048 §4.1's table: only the three MFA-REQUIRED roles hold a privileged
      // session at all. An `operator` who somehow held a password would
      // otherwise get a session that reaches nothing — a state with no meaning
      // and one more thing to reason about.
      if (!memberships.some((m) => MFA_REQUIRED_ROLES.includes(m.role))) {
        await recordFailure(tx, {
          shopId: input.shopId,
          appUserId: verdict.appUserId,
          method: "password",
          failureClass: "role_not_privileged",
        });
        return false;
      }

      // The optional location: a VALUE checked against the shop and against this
      // person's own grants, never trusted (057 §4.4). A location that is not
      // this shop's, or one this person's grants do not reach, is refused with
      // the same one answer — it is a scope claim, and 019 T24 governs.
      if (input.locationId !== undefined) {
        const reachable = memberships.some(
          (m) => m.scopeKind === "organization" || m.scopeKind === "shop" || m.locationId === input.locationId
        );
        const belongs = await tx.query(`SELECT 1 FROM location WHERE id = $1 AND shop_id = $2`, [
          input.locationId,
          input.shopId,
        ]);
        if (!reachable || belongs.rows.length === 0) {
          await recordFailure(tx, {
            shopId: input.shopId,
            appUserId: verdict.appUserId,
            method: "password",
            failureClass: "location_not_in_scope",
          });
          return false;
        }
      }
      return true;
    },
    { tenant: { shopId: input.shopId } }
  );

  if (!scope) throw new LongboxError("SESSION_REQUIRED");

  // 5. The session, under the shop it names — which is known now, so the scope
  // above does not cover it. `app_session` carries a tenant policy and the row
  // being written satisfies it.
  const issued = await withTransaction(
    deps.pool,
    async (tx) => {
      // ⚠ **SIGNING IN AGAIN EVICTS A COPY, AND BEFORE THIS IT EVICTED NOTHING**
      // (057 §4.4a; the security lens's F1). A privileged session is deliberately
      // not device-bound, so a copied `__Host-lb_priv` cookie is an owner until
      // it expires — and an owner who suspected a copy had NO act available to
      // them, because signing in again simply added a second live chain. Now the
      // ordinary thing they would try is the thing that works. It runs before the
      // INSERT, so it cannot revoke the chain it is making room for.
      await revokePrivilegedChainsOf(tx, { appUserId: verdict.appUserId, shopId: input.shopId });
      return issuePrivilegedSession(tx, {
        shopId: input.shopId,
        locationId: input.locationId ?? null,
        appUserId: verdict.appUserId,
        now,
      });
    },
    { tenant: { shopId: input.shopId } }
  );

  const person = requirePerson(
    await resolvePersonByKey(
      tenantDb(deps.pool, input.shopId),
      httpAccessor(observed, "session_display_name", input.shopId),
      verdict.appUserId
    )
  );
  const shop = await readShop(tenantDb(deps.pool, input.shopId), input.shopId);
  // 048 §8.1's forced re-enrollment, rendered rather than discovered: a recovery
  // redemption retired the authenticator in the transaction above, so this reads
  // `must_reenroll` and the client can say so instead of finding out by being
  // refused on the next thing it tries.
  // `tenantDb` and NOT the `second-factor` scope, deliberately: the shop is known
  // by this line, and a cross-tenant scope is the one hole in the tenant boundary
  // (056 §5) — reaching for one where an ordinary context works would widen the
  // boundary to save a variable. `user_authenticator` and `recovery_code_use` are
  // declared RLS exemptions, so the context is not what makes this read work; it
  // is what makes the transaction say what it is about.
  const state = await mfaState(tenantDb(deps.pool, input.shopId), verdict.appUserId);

  return {
    status: 201,
    body: {
      person: { id: person.id, display_name: person.display_name },
      shop: { id: shop.id, name: shop.name },
      must_reenroll: state === "must_reenroll",
    },
    cookies: [setCookie(PRIVILEGED_COOKIE, issued.token, issued.row.absolute_expires_at)],
  };
}

/** End a privileged session. One revocation fact; the cookie is cleared. */
export async function endPrivilegedSession(deps: AuthDeps, session: SessionRow): Promise<AuthResult> {
  await withTransaction(
    deps.pool,
    (tx) =>
      revokeChain(tx, {
        chainId: session.chain_id,
        shopId: session.shop_id,
        reason: "signed_out",
        revokedBy: session.app_user_id,
      }),
    { tenant: { shopId: session.shop_id } }
  );
  return { status: 200, body: { ended: true }, cookies: [clearCookie(PRIVILEGED_COOKIE)] };
}

/**
 * **Invite a person to this shop** (048 §7.1), which until now was a CLI.
 *
 * ⚠ **THE SHOWN-ONCE CODE TRAVELS OUTSIDE THE STORED RESPONSE** (057 §4.8; 042
 * §5.1's amend-by-a-row at v1.5.0). This route takes a real `request_idempotency`
 * row — it writes an `invitation`, which outlives the response and is not a
 * cookie, so 042 §5.1's authentication-act class does not reach it. But the
 * response body §5.3 STORES must not contain the code: `invitation` holds
 * `sha256(code)` and nothing else, and storing the plaintext in a jsonb column
 * would put a live credential in the database on the one route whose whole
 * custody story is *"shown once, stored nowhere"*. So the closure returns the
 * body WITHOUT the code, the code is captured beside it, and a replay returns
 * the stored body truthfully — an id, an expiry, and no code.
 *
 * The permission was already decided at the hook. What this function adds is the
 * RANK check the hook cannot make, because the target role is in the body:
 * `mayGrantRole` refuses handing out a role above the caller's own (054 §5).
 */
export async function createInvitation(
  deps: AuthDeps,
  session: SessionRow,
  input: {
    email: string;
    displayName: string;
    role: InvitableRole;
    locationId?: string;
    totpCode?: string;
    idempotencyKey: string;
  }
): Promise<AuthResult> {
  const appUserId = session.app_user_id;
  if (appUserId === null) throw new LongboxError("PRIVILEGED_SESSION_REQUIRED");

  const req: IdempotentRequest = {
    shopId: session.shop_id,
    idempotencyKey: input.idempotencyKey,
    route: `${API_PREFIX}/invitations`,
    method: "POST",
    params: {},
    // The email is hashed rather than carried, on `redeemInvitation`'s reasoning
    // one route over: `request_idempotency.request_hash` is stored, and an
    // address is a person. The role and the location are part of the ACT and are
    // carried as themselves — two invitations differing only in role are two
    // different acts and must not replay each other's response.
    body: {
      email_digest: digestOf(input.email.toLowerCase()),
      role: input.role,
      location_id: input.locationId ?? null,
    },
  };

  // ⚠ **INVITING AN OWNER COSTS A FRESH SECOND FACTOR, AND ONLY INVITING AN
  // OWNER DOES** (057 §4.4b; the security lens's F1). 048 §4.1 already requires a
  // privileged act to sit in a session established by password + TOTP *"within a
  // freshness window"*, and §4.3 makes the window the chain's absolute expiry —
  // which is right for every act whose damage the expiry bounds. **Naming a
  // second OWNER is not such an act**: the membership it grants is PERMANENT and
  // grants the power to grant it again, so a copied cookie spent on this one
  // outlives every session in the system. So this act re-presents the factor
  // rather than inheriting it, which turns the one irreversible thing a stolen
  // cookie can do into something it cannot do without the owner's phone.
  //
  // **The order is `redeemInvitation`'s, and for its reason.** `replayIfSettled`
  // runs FIRST, so a genuine retry replays instead of being asked for a second
  // fresh code it cannot produce (048 R19 spends a step exactly once). Then the
  // verification, in its OWN transaction that COMMITS whatever the verdict,
  // because the `auth_attempt` row is what 048 §9.1's delay is derived from and
  // throwing from inside `runIdempotent` would roll it back.
  if (input.role === "owner") {
    const settled = await replayIfSettled(tenantDb(deps.pool, session.shop_id), req);
    if (settled) return { status: settled.status, body: settled.body, cookies: [] };
    await requireFreshSecondFactor(deps, appUserId, input.totpCode);
  }

  // ⚠ **THE RANK CHECK RUNS BEFORE THE ADMISSION, AND THE ORDER IS THE FIX**
  // (E03-D21, the security lens's F4). `mayGrantRole` used to be reached inside
  // `issueInvitation`, inside the idempotent transaction — which is AFTER the
  // person below has been committed. An authorization refusal that leaves a side
  // effect behind is the wrong shape whatever the side effect is, and this one is
  // not nothing: the first shop to type an address owns that person's display
  // name estate-wide (000-docs/062 §6). A manager refused for naming an owner now
  // creates no row at all.
  //
  // It costs one extra membership read on the SUCCESS path, because
  // `issueInvitation` still runs the same gate inside the request transaction —
  // deliberately: a grant revoked between the two must refuse the act, and only
  // the in-transaction read can see that. The decision RECORD is unaffected: on
  // this surface the hook already wrote the allowance, so a permitted call writes
  // nothing from either site, and a refusal is written once, here, before the
  // throw.
  const mayInvite = await withTransaction(
    deps.pool,
    (tx) =>
      mayIssueInvitation(tx, {
        shopId: session.shop_id,
        role: input.role,
        invitedBy: appUserId,
        now: new Date(),
        audit: { routeMethod: "POST", routePath: `${API_PREFIX}/invitations`, recordAllowance: false },
      }),
    { tenant: { shopId: session.shop_id } }
  );
  if (!mayInvite) throw new LongboxError("PERMISSION_DENIED");

  // ⚠ **THE PERSON IS ADMITTED IN A TRANSACTION OF ITS OWN, AND THE REASON IS THE
  // POLICY THAT NOW STANDS OVER `app_user`** (E03-D21, 000-docs/062 §3.2).
  // `migrations/036` policies the person table on a LIVE MEMBERSHIP, and this is
  // the one act in the system that reaches a person before any grant exists: an
  // invitation NAMES its addressee before any code is minted (048 §7.1), and that
  // addressee may hold nothing anywhere — or may already work at ANOTHER shop,
  // whose row this shop's tenant context cannot see and must still find by email
  // (034 §2.6). A transaction carries ONE context, so the admission cannot borrow
  // the request's: it runs in the declared `person-admission` scope, which may
  // SELECT a person and INSERT an ACTIVE one and may do nothing else at all.
  //
  // **The cost is stated rather than hidden**: this commits before the idempotent
  // transaction below, so an invitation refused by the shop's CEILING, or by any
  // rolled-back request, still leaves an `app_user` row behind — and that row is
  // not nothing, because the first shop to type an address owns that person's
  // display name at every other shop (000-docs/062 §6). The largest class of
  // orphan — an authorization refusal — is gone with the reordering above; what
  // remains is bounded by the route's `ordinary` rate token and is routed to
  // E03-B09. The alternative — a context that changes inside a transaction —
  // would make "which tenant was this transaction about" a question with two
  // answers, which is the property 056 §3 exists to keep single.
  //
  // **A REPLAY re-runs it.** For a non-`owner` role the replay check lives inside
  // `runIdempotent`, so a retried key reaches this line again; `upsertPerson` is
  // idempotent on the address, so the second pass finds the row it created and
  // adds nothing.
  const invitedPersonId = await withTransaction(
    deps.pool,
    (tx) => upsertPerson(tx, { email: input.email, displayName: input.displayName }),
    { tenant: { service: "person-admission" } }
  );

  let code: string | undefined;
  let expiresAt: Date | undefined;
  const outcome = await runIdempotent(deps.pool, req, async (tx) => {
    // `upsertPerson` returns an ID and no longer a row (E03-D17): a write that
    // handed back a display name was a person-read wearing a write's clothes,
    // and no caller ever used the name.
    const issued = await issueInvitation(tx, {
      shopId: session.shop_id,
      appUserId: invitedPersonId,
      role: input.role,
      locationId: input.locationId ?? null,
      invitedBy: appUserId,
      now: new Date(),
      // The hook already recorded the ALLOWANCE for `membership.invite` on this
      // request (054 §4.3's privileged rule), so the service does not record a
      // second one for the same decision. A RANK refusal is a different decision
      // about a different act and is still recorded — see `issueInvitation`.
      audit: { routeMethod: "POST", routePath: `${API_PREFIX}/invitations`, recordAllowance: false },
    });
    if (!issued.ok) {
      // `not_permitted` here is the RANK refusal — the hook already allowed the
      // permission — so it is a role refusal and answers as one. The ceiling is a
      // fact about the shop's own state and answers as itself.
      throw new LongboxError(issued.refusal === "not_permitted" ? "PERMISSION_DENIED" : "INVITATION_REFUSED");
    }
    code = issued.invitation.code;
    expiresAt = issued.invitation.expiresAt;
    return {
      status: 201,
      body: {
        invitation: {
          id: issued.invitation.invitationId,
          role: input.role,
          expires_at: issued.invitation.expiresAt.toISOString(),
        },
      },
    };
  });

  const body = outcome.body as { invitation: Record<string, unknown> };
  return {
    status: outcome.status,
    // The code is spliced onto the RESPONSE and was never in the stored body.
    // `expiresAt` is checked too, so a replay cannot pick up a code from a
    // variable a previous call in the same process happened to set.
    body: code !== undefined && expiresAt !== undefined ? { invitation: { ...body.invitation, code } } : body,
    cookies: [],
  };
}

/** **Issue a device enrollment code** (048 §7.3). `createInvitation`'s twin. */
export async function createEnrollmentCode(
  deps: AuthDeps,
  session: SessionRow,
  input: {
    locationId: string;
    deviceLabel: string;
    deviceKind: DeviceKind;
    idempotencyKey: string;
  }
): Promise<AuthResult> {
  const appUserId = session.app_user_id;
  if (appUserId === null) throw new LongboxError("PRIVILEGED_SESSION_REQUIRED");

  const req: IdempotentRequest = {
    shopId: session.shop_id,
    idempotencyKey: input.idempotencyKey,
    route: `${API_PREFIX}/device-enrollment-codes`,
    method: "POST",
    params: {},
    body: { location_id: input.locationId, device_label: input.deviceLabel, device_kind: input.deviceKind },
  };

  let code: string | undefined;
  const outcome = await runIdempotent(deps.pool, req, async (tx) => {
    const issued = await issueEnrollmentCode(tx, {
      shopId: session.shop_id,
      locationId: input.locationId,
      deviceLabel: input.deviceLabel,
      deviceKind: input.deviceKind,
      issuedBy: appUserId,
      now: new Date(),
      audit: {
        routeMethod: "POST",
        routePath: `${API_PREFIX}/device-enrollment-codes`,
        recordAllowance: false,
      },
    });
    if (!issued.ok) {
      // ONE code for the ceiling and for an unknown location, so the route is not
      // an oracle over which location ids exist (019 T24). `not_permitted` is a
      // SCOPE refusal here — the hook allowed the permission for the session's
      // scope and this call re-decided it at the location the body named — so it
      // answers as absence does, byte-identically to a caller with no membership.
      throw new LongboxError(
        issued.refusal === "not_permitted" ? "SHOP_NOT_FOUND" : "ENROLLMENT_CODE_REFUSED"
      );
    }
    code = issued.enrollment.code;
    return {
      status: 201,
      body: {
        enrollment: {
          id: issued.enrollment.codeId,
          location_id: input.locationId,
          expires_at: issued.enrollment.expiresAt.toISOString(),
        },
      },
    };
  });

  const body = outcome.body as { enrollment: Record<string, unknown> };
  return {
    status: outcome.status,
    body: code !== undefined ? { enrollment: { ...body.enrollment, code } } : body,
    cookies: [],
  };
}

/**
 * **Re-present the second factor for the one act the session's expiry does not
 * bound** (057 §4.4b; the security lens's F1).
 *
 * ⚠ **IT IS ITS OWN FUNCTION AND ITS OWN TRANSACTION, AND BOTH ARE STRUCTURAL.**
 *
 * The transaction, because `verifyTotp` appends the `auth_attempt` row 048 §9.1
 * derives the delay from and its caller must therefore COMMIT WHATEVER THE
 * VERDICT — throwing from inside `runIdempotent` would roll the failure back and
 * hand an attacker an unbounded budget through the mechanism built to bound it.
 * So this commits, and only then does the caller open the idempotent one.
 *
 * The FUNCTION, because 042 §5.3(b)'s lock order is about locks held TOGETHER,
 * and these never are: this transaction takes `user_authenticator` and commits
 * before `runIdempotent` takes anything at all, so no deadlock is constructible
 * between them. `pnpm arch` reads handler bodies and cannot see a commit, so
 * leaving the call inline would have made a true statement about two
 * transactions look like a false one about one — the split makes the code say
 * what is actually happening rather than teaching the next reader to distrust
 * the lint.
 *
 * **ONE refusal for an absent code and a wrong one.** The caller already holds a
 * privileged session, so neither answer discloses anything the other does not,
 * and both lead to the same next action: open your authenticator.
 */
async function requireFreshSecondFactor(
  deps: AuthDeps,
  appUserId: string,
  code: string | undefined
): Promise<void> {
  if (code === undefined) throw new LongboxError("FRESH_SECOND_FACTOR_REQUIRED");
  const fresh = await withTransaction(
    deps.pool,
    (tx) => verifyTotp(tx, { appUserId, code, keyring: requireKeyring(deps), now: new Date() }),
    { tenant: { service: "second-factor" } }
  );
  if (!fresh.ok) throw new LongboxError("FRESH_SECOND_FACTOR_REQUIRED");
}

/** The keyring, or the boot invariant that should have made this unreachable. */
function requireKeyring(deps: AuthDeps): AuthenticatorKeyring {
  const ring = deps.config.authenticatorKeys;
  // `loadConfig` calls `requireAuthenticatorKey` and refuses to boot without one,
  // so this is unreachable in a served process. It is here for the reason
  // `requireDevice` is in `routes/auth.ts`: "the config guarantees it" stops
  // holding the day somebody builds a config literal, and a thrown code is
  // cheaper than a 500 on the route that mints the most privileged credential.
  if (!ring) throw new LongboxError("INTERNAL_ERROR");
  return ring;
}

/** The live operator chain sitting on a device chain, if there is one. */
async function liveOperatorChainOn(db: Queryable, deviceChainId: string): Promise<string | undefined> {
  const res = await db.query(
    `SELECT DISTINCT s.chain_id FROM app_session s
      WHERE s.parent_chain_id = $1
        AND s.kind = 'operator'
        AND NOT EXISTS (SELECT 1 FROM app_session_revocation r WHERE r.chain_id = s.chain_id)
        AND s.absolute_expires_at > now()`,
    [deviceChainId]
  );
  return (res.rows[0] as { chain_id: string } | undefined)?.chain_id;
}

async function readShop(db: Queryable, shopId: string): Promise<{ id: string; name: string }> {
  const res = await db.query(`SELECT id, name FROM shop WHERE id = $1`, [shopId]);
  const row = res.rows[0] as { id: string; name: string } | undefined;
  if (!row) throw new LongboxError("SHOP_NOT_FOUND");
  return row;
}

/**
 * The refusal an accessor deliberately does not choose.
 *
 * `src/identity/`'s accessors return `undefined` rather than throwing, because
 * the HTTP consequence of "no such person" differs by caller and a data module
 * that picked one would be choosing somebody else's refusal code — 048 §9.3's
 * constant-answer rule is the caller's to keep. Both session routes want the
 * same one, so it is written once here. **It replaces `readUser`**, which was
 * this file's private second copy of the accessor's statement (E03-D17).
 */
function requirePerson(person: Person | undefined): Person {
  if (person === undefined) throw new LongboxError("SESSION_REQUIRED");
  return person;
}

// ===========================================================================
// E03-D07 — invitations and device enrollment (048 §7)
// ===========================================================================

/**
 * **Redeem an invitation on a phone the shop already owns** (048 §7.1, R15).
 *
 * The employee taps in the code the owner handed them across the counter and
 * chooses a PIN, and the two happen in one act because 048 §7.2 says they do:
 * *"the employee enters it on the enrolled device and sets a PIN."* Splitting
 * them would leave a person holding a membership and no way to sign in, which is
 * a state somebody then has to be told how to escape.
 *
 * ⚠ **THIS ROUTE IS NOT IN 042 §5.1's AUTHENTICATION-ACT EXEMPTION, AND THE
 * SENTENCE THAT PREDICTED IT WOULD BE IS AMENDED BY THIS BEAD.** 042 v1.3.0
 * wrote that the class's next members "will be E03-D06's password sign-in and
 * E03-D07's enrollment redemption" — and it also wrote the class's BOUNDARY,
 * which decides the question against that prediction for this route: the
 * exemption covers a route that "(a) writes no witness row about a book, a batch
 * or a shop's catalog, and (b) whose entire externally visible effect is a
 * cookie". **Redeeming an invitation writes a `membership`** — the record of who
 * may act in this shop, which is the substrate 019 T35(c) reconciles against —
 * **and it sets a PIN**, and neither is a cookie: both outlive the response, and
 * a duplicate of either is a second grant and a second credential rather than
 * one spare row on a chain the phone stops using.
 *
 * So it takes the header AND the `request_idempotency` row.
 *
 * **The order below is the part that has to be right.** `replayIfSettled` runs
 * FIRST, before anything looks at the code, for the reason `identify` does the
 * same (`idempotency.ts`: *"a caller that SPENDS before it calls this has
 * already lost"*). Without it a genuine retry would re-verify a code its own
 * first call had already spent, be refused as `spent`, and turn a lost response
 * into a dead invitation. Then the verification transaction, which COMMITS
 * whatever the verdict because the `auth_attempt` row is what the delay is
 * derived from (048 §9.1, R5); then `runIdempotent`, which sets the PIN, grants
 * the membership and writes the use row in ONE transaction.
 */
export async function redeemInvitation(
  deps: AuthDeps,
  device: DeviceBoundSession,
  input: { code: string; pin: string; idempotencyKey: string },
  observed: ObservedRoute
): Promise<AuthResult> {
  const req: IdempotentRequest = {
    shopId: device.shop_id,
    idempotencyKey: input.idempotencyKey,
    route: `${API_PREFIX}/invitations/redemptions`,
    method: "POST",
    params: {},
    // **THE RAW BODY IS NOT WHAT IS HASHED, AND THAT IS DELIBERATE.** 042 §5.4
    // hashes the body so a reused key with different content is a 422 — and this
    // body is a code and a PIN, which `request_idempotency.request_hash` would
    // then be an offline verifier for: a 40-bit code and a six-digit PIN are both
    // enumerable against a stored SHA-256 by anybody holding a dump, and 048 §9.2
    // spends a whole section keeping exactly that out of reach. What is hashed is
    // the code's DIGEST plus a marker that a PIN was supplied, which separates two
    // different redemptions under one key exactly as well and stores nothing a
    // dump can invert into either secret.
    body: { code_digest: digestOf(input.code), pin_supplied: true },
  };

  const settled = await replayIfSettled(tenantDb(deps.pool, device.shop_id), req);
  if (settled) return { status: settled.status, body: settled.body, cookies: [] };

  // 048 R14's DECLARED CLASS FOR THIS ROUTE — `ordinary`, keyed on THE SHOP THE
  // TOKEN NAMES, which R15 makes the device session's shop on every path that
  // can succeed.
  //
  // ⚠ IT IS TAKEN HERE, AND THE REASON IS A BUG THIS BEAD SHIPPED AND AN
  // INVARIANT REVIEW CAUGHT. The first version declared `ordinary` and enforced
  // NOTHING: the hook's bucket is gated on `rateClass === "device"`, and
  // `app.ts`'s `takeOrdinary` hook lives INSIDE the tenant plugin — this route is
  // registered on the root instance, so neither ran. Two hundred posts produced
  // two hundred refusals, zero throttles and zero limiter calls, while the route
  // walk asserted the declaration and passed. That is the
  // `POST /api/v1/device-sessions` finding for the third time, and the third time
  // is what a class of defect looks like rather than an accident.
  //
  // **Before `verifyInvitation`**, not after: a throttled request must not test a
  // credential, must not append an `auth_attempt` row, and must not spend the
  // budget the delay is derived from (048 §9.1, R5).
  const budget = deps.limiter.takeOrdinary(device.shop_id);
  if (!budget.allowed) {
    throw new LongboxError("RATE_LIMITED", { retry_after_seconds: budget.retryAfterSeconds });
  }

  // `code-redemption` rather than the device's own shop, and the difference is a
  // SIGNAL rather than a nicety: under a tenant context an invitation issued at
  // another shop would simply be invisible and the recorded refusal would read
  // `unknown_invitation`, whereas `verifyInvitation` compares the two shops itself
  // and records `cross_shop_invitation` — a lifted code, which is worth detecting
  // (048 §7.2, R15). The caller-visible answer is byte-identical either way; only
  // the recorded failure class differs.
  const verdict = await withTransaction(
    deps.pool,
    (tx) => verifyInvitation(tx, { device, code: input.code, now: new Date() }),
    { tenant: { service: "code-redemption" } }
  );
  if (!verdict.ok) throw new LongboxError("INVITATION_INVALID");
  const invitation = verdict.invitation;

  const outcome = await runIdempotent(deps.pool, req, async (tx) => {
    const set = await setOperatorPin(tx, {
      shopId: invitation.shop_id,
      deviceId: device.device_id,
      appUserId: invitation.app_user_id,
      pin: input.pin,
      pepper: deps.config.pinPepper,
    });
    // A weak PIN is refused BEFORE the grant, so a rejected PIN does not spend
    // the invitation: the throw rolls the whole transaction back, the use row is
    // never written, and the employee tries a different six digits. This is the
    // one refusal on this route that is NOT §9.3's constant answer, and that is
    // deliberate — the sameness protects an authentication boundary from becoming
    // a query interface over which codes and people exist, and "the PIN you just
    // chose is not allowed" is a statement about a value the caller invented,
    // which discloses nothing about this system at all.
    if (!set.ok) throw new LongboxError("PIN_REFUSED");

    await grantInvitation(tx, { invitation, device, deviceSessionId: device.id });
    // On the TRANSACTION handle, so the grant, the PIN, the access fact and the
    // receipt are one atomic act — the strongest form of the accessor's write,
    // and the one `src/identity/access.ts` says a caller gets when it has a
    // transaction to offer.
    const person = requirePerson(
      await resolvePersonByKey(
        tx,
        httpAccessor(observed, "invitation_addressee", invitation.shop_id),
        invitation.app_user_id
      )
    );
    const shop = await readShop(tx, invitation.shop_id);
    return {
      status: 201,
      body: {
        operator: { id: person.id, display_name: person.display_name },
        shop: { id: shop.id, name: shop.name },
      },
    };
  }).catch((err: unknown) => {
    // The loser of a concurrent redemption: `UNIQUE (invitation_id)` refused the
    // use row and the transaction rolled back with it, so there is no second
    // membership and no second PIN. The answer is the same one code every other
    // refusal on this route gets (048 §9.3).
    if (err instanceof InvitationAlreadySpent) throw new LongboxError("INVITATION_INVALID");
    throw err;
  });

  return { status: outcome.status, body: outcome.body, cookies: [] };
}

/**
 * **Redeem an enrollment code from the phone being enrolled** (048 §7.3).
 *
 * Anonymous by construction — the phone holds no session, which is what
 * enrollment means — so the code IS the authentication, exactly as the device
 * credential is on `POST …/device-sessions`. Its compensating controls are
 * `codes.ts`'s 128 bits, the route's aggregate bucket taken in the hook before
 * any body parsing, the per-shop delay and the `ordinary` bucket taken below,
 * the fifteen-minute expiry, and `UNIQUE (code_id)`.
 *
 * ⚠ **THIS ROUTE *IS* IN 042 §5.1's EXEMPTION, BY AN EXTENSION THIS BEAD RECORDS
 * RATHER THAN ASSUMES.** The class's clause (b) read "whose entire externally
 * visible effect is a cookie", and this route's effect is a cookie plus three
 * durable rows — so it did not qualify as written. It is admitted by an
 * amend-by-a-row (042 v1.4.0, corrected at v1.4.2) making (b) **two disjuncts**:
 * **(b1)** a `Set-Cookie` and nothing else, which is where the three session
 * routes sit and why they owe no constraint; or **(b2)** a shown-once secret
 * PLUS a UNIQUE on THE ACT, named by table and columns. This route is the only
 * (b2) member and it names **`device_enrollment_code_use (code_id)`**.
 *
 * **The disjunction is not decoration — v1.4.1 wrote it as a CONJUNCTION and
 * that expelled three of the class's four members**, because nothing in
 * `app_session` makes a repeated sign-in a failed INSERT and nothing should.
 * The admission rests on the argument §5.1 makes for the class in the first
 * place: storing a response here would replay a byte-identical `201` **with no
 * cookie**, leaving a phone that believes it is enrolled and holds nothing, and
 * the duplicate that storage exists to prevent is already impossible —
 * `UNIQUE (code_id)` is a stronger guarantee than an idempotency key, taken by
 * the database, on the act itself.
 *
 * **The cost of that ruling, stated rather than discovered**: a retry after a
 * lost response finds the code spent and is refused, so the shop issues another.
 * That is a minute of an owner's time on a flow a shop performs once per phone,
 * against the alternative of a phone that has been told it is enrolled and
 * cannot prove it.
 *
 * **The credential secret is minted, hashed and DISCARDED** — never returned,
 * never stored, never reaching the phone. 048 §7.4 accepts with its eyes open
 * that a device credential is *"bearer material sitting in a browser cookie jar
 * on a phone that lives on a shop counter"*; a phone enrolled here holds only a
 * ROTATING SESSION, and the credential row exists as that session's anchor and
 * as the thing a revocation names. **The trade is real and is stated**: a phone
 * idle past `DEVICE_IDLE_MS` cannot re-authenticate itself and must be
 * re-enrolled with a new code. For a phone that lives on a counter and is used
 * daily that is the correct direction, and it removes §7.4's residual for every
 * device this route creates.
 */
export async function redeemEnrollmentCode(deps: AuthDeps, input: { code: string }): Promise<AuthResult> {
  const now = new Date();
  // No session and no shop: the code names the tenant the phone is about to join,
  // so the lookup — and the `auth_attempt` row an unknown code writes with a NULL
  // `shop_id` — run in the `code-redemption` scope.
  const verdict = await withTransaction(
    deps.pool,
    (tx) => verifyEnrollmentCode(tx, { code: input.code, now }),
    { tenant: { service: "code-redemption" } }
  );
  if (!verdict.ok) throw new LongboxError("ENROLLMENT_CODE_INVALID");

  // 048 R14's declared class for this route — `ordinary`, keyed on THE SHOP THE
  // CODE NAMES. Taken here rather than in the hook for the reason
  // `openDeviceSession`'s credential bucket is: the shop is a property of the
  // code, the code is in the BODY, and `onRequest` runs before any body parsing.
  // The hook's aggregate `takeRoute` bucket is the half that CAN run there, and
  // the two answer different questions — "how much of this route at all" and
  // "how much of this route against this shop".
  const budget = deps.limiter.takeOrdinary(verdict.code.shop_id);
  if (!budget.allowed) {
    throw new LongboxError("RATE_LIMITED", { retry_after_seconds: budget.retryAfterSeconds });
  }

  // ONE TRANSACTION FOR ALL FOUR ROWS, and the fourth is the one this bead first
  // got wrong. The `device`, the `device_credential` and the
  // `device_enrollment_code_use` committed together, and `issueDeviceSession` ran
  // in a SECOND transaction afterwards — so a crash in the gap left a spent code,
  // an enrolled phone and no session: the phantom phone `migrations/024`'s header
  // says this design prevents, arriving through the one seam the header did not
  // look at. Caught by the invariant review, not by a test, which is why the
  // integration suite now has a case that rolls the session INSERT back and
  // asserts the device and the use row roll back with it.
  //
  // It costs no new lock and no new ordering: `app_session` is an INSERT with no
  // `FOR UPDATE`, and 042 §5.3(b)'s order is about the idempotency row, the
  // session lock and the `scan_session` anchor — none of which this route takes.
  const enrolled = await withTransaction(
    deps.pool,
    async (tx) => {
      const device = await enrollDevice(tx, { code: verdict.code });
      const session = await issueDeviceSession(tx, {
        shopId: device.shopId,
        locationId: device.locationId,
        deviceId: device.deviceId,
        deviceCredentialId: device.credentialId,
        now,
      });
      return { device, session };
    },
    // The tenant is known from the code just verified, so the four rows are
    // written under an ordinary tenant context rather than under that scope.
    { tenant: { shopId: verdict.code.shop_id } }
  ).catch((err: unknown) => {
    if (err instanceof EnrollmentCodeAlreadySpent) throw new LongboxError("ENROLLMENT_CODE_INVALID");
    throw err;
  });
  const issued = enrolled.session;

  const shop = await readShop(tenantDb(deps.pool, enrolled.device.shopId), enrolled.device.shopId);
  return {
    status: 201,
    body: {
      device: {
        shop_id: enrolled.device.shopId,
        shop_name: shop.name,
        location_id: enrolled.device.locationId,
      },
    },
    cookies: [setCookie(DEVICE_COOKIE, issued.token, issued.row.absolute_expires_at)],
  };
}

/**
 * An `IdempotentRequest` carrying the hook's session lock, built OUTSIDE the
 * handler that uses it.
 *
 * ⚠ **THE SEPARATE FUNCTION IS THE POINT, AND IT IS `sessionApi.ts`'s
 * `idempotentRequest` for the same reason.** `pnpm arch`'s lock-order rule reads
 * a handler's TEXT and recognises the session lock through its name, so a
 * handler that spells `{ sessionLock: … }` while building its request literal
 * reads as one that TAKES the session lock at that point — before its
 * `request_idempotency` INSERT, which is 042 §5.3(b)'s order backwards. The lock
 * is of course taken by `runIdempotent`, in the right place, after the INSERT;
 * moving the spelling out here makes the lint see what actually happens instead
 * of teaching the next reader to distrust it.
 */
function withSessionLock(
  base: IdempotentRequest,
  sessionLock: ((tx: Tx) => Promise<void>) | undefined
): IdempotentRequest {
  return { ...base, ...(sessionLock ? { sessionLock } : {}) };
}

// ===========================================================================
// E03-D24 — the credential self-service surface (000-docs/063; 057 §9 R2/R2a)
// ===========================================================================
//
// ⚠ **WHAT THESE FOUR FUNCTIONS HAVE IN COMMON IS THE SUBJECT, AND IT IS THE
// WHOLE OF THEIR AUTHORITY.** Every row any of them reads or writes is keyed on
// the caller's OWN `app_user_id`, taken from the session and never from a body
// (048 §6.3, I8). No membership is consulted, because a password and a second
// factor are person-scoped and cross shops (034 §2.6) — `user_credential` and
// `user_authenticator` carry no `shop_id` at all.
//
// ⚠ **WHERE EACH ONE IS ACTUALLY DECIDED, because an earlier version of this
// header said "the hook enforces it at the same one site every other route is
// decided at" and that is FALSE for the first of the four** (the invariant
// review's delta 6):
//
//   * **`POST /api/v1/credentials`** — its ENFORCED authority is
//     `principal: "device+operator"` on the auth allowlist, checked in
//     `registerAuthentication`. `requires: SELF_SERVICE` on that route is a
//     DECLARATION, bounded by `tests/contract/permission-enforcement.test.ts`
//     (which refuses a permission on a route with no resolved role, and requires
//     an anonymous route never to carry the marker) — and, since the security
//     lens's F1, it is what makes the hook write the route's
//     `authorization_decision` row from the operator branch.
//   * **the other three** — `principal: "privileged"`, and the marker IS the
//     enforced authority: `enforcePrivileged` refuses a privileged route that
//     declares neither a permission nor the marker, which is the fail-closed
//     default 054 §3 built one principal down.
//
// The distinction matters because the two are different guarantees: one is a
// property of which COOKIE the hook consults, the other of which VALUE the route
// table carries (063 §3.1, §3.2).

/**
 * **Set a FIRST password, from the operator session on the counter phone.**
 *
 * This is the function 057 §9 R2a is about: `setPassword` reached production
 * through the module's door with no caller at all, so a deployed system had no
 * way to give anybody a password and `POST /api/v1/privileged-sessions` could
 * not succeed for any real person.
 *
 * ⚠ **IT PROVISIONS AND NEVER REPLACES, AND THE REASON IS WHO CAN REACH IT.**
 * 048 §3.5 states plainly that an operator session is an attribution of record
 * and is NOT non-repudiable — a coworker who watches a PIN can act as that
 * person on that phone. A route that could overwrite a live password would hand
 * that coworker a way to lock an owner out of the privileged surface. So an
 * existing credential is refused with `CREDENTIAL_ALREADY_SET`, and replacing
 * one is `rotateOwnPassword` below, behind the privileged session and a fresh
 * code.
 *
 * **What the password this route sets is worth on its own: nothing.** A
 * privileged session needs a password AND a second factor, and this route mints
 * no factor — so the coworker above ends up holding half of a credential pair
 * for a session they still cannot open (063 §3.3).
 *
 * The order is 042 §5.3(b)'s, positions one, two and three: the idempotency row,
 * the session lock the hook handed us, then `user_credential FOR UPDATE` — taken
 * through `lockCredential`, which exists for exactly this ("the re-enrollment
 * and sign-out paths do not test a password and must still not race a concurrent
 * sign-in for the same person").
 */
export async function setOwnPassword(
  deps: AuthDeps,
  operator: SessionRow,
  input: { password: string; idempotencyKey: string; sessionLock?: (tx: Tx) => Promise<void> }
): Promise<AuthResult> {
  const appUserId = operator.app_user_id;
  // Unreachable: the allowlist requires `device+operator`, and an operator row
  // names a person. Here for `requireDevice`'s reason — a guarantee read through
  // a nullable column is one somebody has to remember.
  if (appUserId === null) throw new LongboxError("OPERATOR_REQUIRED");

  // The SECOND bucket (063 §3.6). The route's declared `device` class is taken
  // by the hook; this one bounds what ONE session can do to a credential, and it
  // is taken BEFORE any hashing so a throttled request spends no argon2id.
  const budget = deps.limiter.takeCredentialWrite(operator.chain_id);
  if (!budget.allowed) {
    throw new LongboxError("RATE_LIMITED", { retry_after_seconds: budget.retryAfterSeconds });
  }

  const req = withSessionLock(
    {
      shopId: operator.shop_id,
      idempotencyKey: input.idempotencyKey,
      route: `${API_PREFIX}/credentials`,
      method: "POST",
      params: {},
      // **THE PASSWORD IS NOT WHAT IS HASHED INTO `request_hash`**, on
      // `redeemInvitation`'s reasoning one credential over: that column is stored,
      // and a stored SHA-256 of a password is an offline verifier for anybody
      // holding a dump. What separates two different requests under one key is
      // that a password was supplied at all, which is as much as this route's
      // shape can differ by.
      body: { password_supplied: true },
    },
    input.sessionLock
  );

  const outcome = await runIdempotent(deps.pool, req, async (tx) => {
    // The anchor, taken for 057 §4.5's reason rather than for this refusal's:
    // the shared per-person lockout budget has two anchors, and a write that
    // took neither would not serialise against a concurrent sign-in.
    await lockCredential(tx, appUserId);
    // ⚠ **THE REFUSAL IS THE DATABASE'S ROW COUNT AND NOT AN `if` ABOVE IT**
    // (the data-model lens's H4, 063 §3.3). This read `if (existing) throw`
    // against one shared upsert that was willing to overwrite — so the claim
    // *provisions and never replaces* was a fact about which of two call sites
    // an author remembered, and a break-glass path already on this epic's
    // roadmap was exactly the third site that would inherit the gap.
    // `provisionPassword` is `ON CONFLICT DO NOTHING RETURNING id`: an existing
    // credential returns no row, which is 048 R19's idiom one factor down — and
    // since v1.1.1 it falls back to a revival `UPDATE … WHERE password_hash IS
    // NULL` when that happens, so a row a clearance emptied is ABSENT here
    // (063 §3.8 property 2) while a LIVE hash still matches neither statement.
    const set = await provisionPassword(tx, {
      appUserId,
      password: input.password,
      pepper: deps.config.pinPepper,
    });
    if (!set.ok) {
      throw new LongboxError(set.refusal === "already_set" ? "CREDENTIAL_ALREADY_SET" : "CREDENTIAL_REFUSED");
    }
    return { status: 201, body: { credential_set: true } };
  });

  return { status: outcome.status, body: outcome.body, cookies: [] };
}

/**
 * **Replace a password from a privileged session, with a fresh code.**
 *
 * The freshness gate is 057 §4.4b's, generalised by this bead and recorded in
 * 063 §3.3: an act re-presents the second factor when its damage OUTLIVES the
 * session it was done from, because 048 §4.1's window (which 057 §4.3 makes the
 * chain's own absolute expiry) bounds sessions and not acts. A replaced password
 * outlives every session in the system — the person it locks out cannot sign in
 * again at all, and no expiry undoes that.
 *
 * **The order below is `createInvitation`'s and it is structural.**
 * `replayIfSettled` runs FIRST, so a genuine retry replays instead of being
 * asked for a second fresh code it cannot produce (048 R19 spends a step exactly
 * once). Then `requireFreshSecondFactor`, in its OWN transaction that COMMITS
 * whatever the verdict, because the `auth_attempt` row is what 048 §9.1's delay
 * is derived from. Only then the idempotent transaction — so no transaction ever
 * holds the authenticator lock and the credential lock at once on THIS path, and
 * 042 §5.3(b)'s order is not in question for it.
 */
export async function rotateOwnPassword(
  deps: AuthDeps,
  session: SessionRow,
  input: {
    password: string;
    totpCode: string;
    idempotencyKey: string;
    sessionLock?: (tx: Tx) => Promise<void>;
  }
): Promise<AuthResult> {
  const appUserId = session.app_user_id;
  if (appUserId === null) throw new LongboxError("PRIVILEGED_SESSION_REQUIRED");

  const budget = deps.limiter.takeCredentialWrite(session.chain_id);
  if (!budget.allowed) {
    throw new LongboxError("RATE_LIMITED", { retry_after_seconds: budget.retryAfterSeconds });
  }

  const req = withSessionLock(
    {
      shopId: session.shop_id,
      idempotencyKey: input.idempotencyKey,
      route: `${API_PREFIX}/credentials/rotations`,
      method: "POST",
      params: {},
      body: { password_supplied: true },
    },
    input.sessionLock
  );

  const settled = await replayIfSettled(tenantDb(deps.pool, session.shop_id), req);
  if (settled) return { status: settled.status, body: settled.body, cookies: [] };
  await requireFreshSecondFactor(deps, appUserId, input.totpCode);

  const outcome = await runIdempotent(deps.pool, req, async (tx) => {
    // The anchor is taken even though nothing is verified under it: a rotation
    // and a concurrent sign-in for the same person must serialise, or the
    // sign-in can verify a digest the rotation is halfway through replacing.
    await lockCredential(tx, appUserId);
    // `replacePassword` is an `UPDATE … WHERE app_user_id` whose row count is
    // the enforcement (H4): it can never CREATE a credential, so this route
    // cannot become a second way to provision one. A person with none — which
    // this route's own gate makes unreachable, since a privileged session needs
    // the password — is refused rather than quietly given one.
    const set = await replacePassword(tx, {
      appUserId,
      password: input.password,
      pepper: deps.config.pinPepper,
    });
    if (!set.ok) throw new LongboxError("CREDENTIAL_REFUSED");
    return { status: 200, body: { credential_set: true } };
  });

  return { status: outcome.status, body: outcome.body, cookies: [] };
}

/**
 * **Step one of an enrolment: mint a secret, seal it, show it once.**
 *
 * It writes NO durable row — no authenticator, no recovery code, no membership,
 * nothing a duplicate of which would be a second effect — which is why it takes
 * the `Idempotency-Key` header (the hook's, 048 §5.2's CSRF half) and NOT a
 * `request_idempotency` row (042 §5.1 class one, disjunct (b3), added by this
 * bead). Storing a response here would put a live secret in a jsonb column on
 * the one route whose whole custody story is *"shown once, stored nowhere"* —
 * which is 057 §4.8's ruling for the invitation code, arriving one credential up.
 *
 * The label is the person's login identifier, resolved through the identity
 * accessor with `authenticator_enrollment`'s purpose — the SAME purpose
 * `pnpm enroll-authenticator` cites, because it is the same read for the same
 * reason (048 §4.3: an authenticator app showing `Longbox: 7f3a…` is one nobody
 * can tell apart from the other one on the same phone). 060's accessor writes
 * the fact; this route is a declared accessor pair.
 */
export async function offerAuthenticator(
  deps: AuthDeps,
  session: SessionRow,
  observed: ObservedRoute
): Promise<AuthResult> {
  const appUserId = session.app_user_id;
  if (appUserId === null) throw new LongboxError("PRIVILEGED_SESSION_REQUIRED");

  const budget = deps.limiter.takeCredentialWrite(session.chain_id);
  if (!budget.allowed) {
    throw new LongboxError("RATE_LIMITED", { retry_after_seconds: budget.retryAfterSeconds });
  }

  const person = await resolvePersonForAuthenticatorEnrollment(
    tenantDb(deps.pool, session.shop_id),
    httpAccessor(observed, "authenticator_enrollment", session.shop_id),
    appUserId
  );
  // A privileged session names a person who exists, so this is unreachable; it
  // refuses rather than labelling a URI `undefined` if that ever stops being true.
  if (!person) throw new LongboxError("AUTHENTICATOR_ENROLLMENT_REFUSED");

  const offer = mintEnrollmentOffer({
    keyring: requireKeyring(deps),
    appUserId,
    now: new Date(),
  });

  return {
    status: 200,
    body: {
      otpauth_uri: otpauthUri({ secret: offer.secret, label: person.email, issuer: "Longbox" }),
      enrollment_ticket: offer.ticket,
      expires_at: offer.expiresAt.toISOString(),
    },
    cookies: [],
  };
}

/**
 * **Step two: confirm the offer, and supersede whatever was there.**
 *
 * ⚠ **A PERSON WHO STILL HOLDS A LIVE FACTOR MUST PRESENT A FRESH CODE FROM
 * IT**, and a person in 048 §8.1's re-enrolment state must not — because they
 * have none, and the recovery code they signed in with was that presentation.
 * The branch is on the state and not on a field the caller supplies, so a caller
 * cannot choose which rule applies to them (063 §3.4).
 *
 * **The lock order is the three anchors, in one transaction**: the idempotency
 * row, then `user_credential FOR UPDATE` (`lockCredential`), then
 * `user_authenticator FOR UPDATE` (inside `enrollAuthenticator`). The credential
 * anchor is taken even though no password is tested here, for 057 §4.5's own
 * reason — the per-person lockout budget is SHARED across all three factors and
 * has two anchors, so a path that touches one of them without the other does not
 * serialise against a concurrent sign-in. **This route holds both, which is what
 * 057 §9 R8 says would close its residual for a routed recovery flow.**
 */
export async function enrolOwnAuthenticator(
  deps: AuthDeps,
  session: SessionRow,
  input: {
    ticket: string;
    code: string;
    freshCode?: string;
    idempotencyKey: string;
    sessionLock?: (tx: Tx) => Promise<void>;
  }
): Promise<AuthResult> {
  const appUserId = session.app_user_id;
  if (appUserId === null) throw new LongboxError("PRIVILEGED_SESSION_REQUIRED");

  const budget = deps.limiter.takeCredentialWrite(session.chain_id);
  if (!budget.allowed) {
    throw new LongboxError("RATE_LIMITED", { retry_after_seconds: budget.retryAfterSeconds });
  }

  const req = withSessionLock(
    {
      shopId: session.shop_id,
      idempotencyKey: input.idempotencyKey,
      route: `${API_PREFIX}/authenticators`,
      method: "POST",
      params: {},
      // ⚠ **THE BODY HASH IS THE TICKET'S DIGEST AND NOT THE CODE, AND CI
      // CAUGHT THE VERSION THAT WAS.** 042 §5.4 hashes the body so a reused key
      // with different content is a 422 — which means the hashed value must
      // identify the ACT and nothing else. The confirming CODE does not: it is a
      // TOTP code, so it changes every thirty seconds for the same logical
      // enrolment, and a client retrying a lost response half a minute later
      // sent a different body and was refused `IDEMPOTENCY_KEY_REUSED`. That is
      // precisely the failure 042 §5.1 describes as turning a lost response into
      // a dead enrolment, and 048 R19 makes it unavoidable rather than unlucky:
      // the step is SPENT, so a genuine retry cannot resend the first code.
      //
      // The TICKET identifies the act — one sealed offer, one enrolment — and it
      // is hashed rather than carried for `redeemInvitation`'s reason one
      // credential over: `request_hash` is STORED. A digest of AEAD ciphertext
      // inverts to nothing, unlike the digest of a six-digit code.
      body: { ticket_digest: digestOf(input.ticket) },
    },
    input.sessionLock
  );

  const settled = await replayIfSettled(tenantDb(deps.pool, session.shop_id), req);
  if (settled) return { status: settled.status, body: settled.body, cookies: [] };

  // The freshness branch, decided on the person's STATE and never on the body.
  // `enrolled` means a live factor exists, so it must be presented; the other
  // two states have nothing to present, and `unenrolled` is unreachable behind a
  // privileged session (there is no way to open one without a second factor) —
  // it takes the same branch as `must_reenroll` so that if it ever becomes
  // reachable it is not an unhandled case.
  const state = await mfaState(tenantDb(deps.pool, session.shop_id), appUserId);
  if (state === "enrolled") await requireFreshSecondFactor(deps, appUserId, input.freshCode);

  const opened = openEnrollmentOffer({
    keyring: requireKeyring(deps),
    appUserId,
    ticket: input.ticket,
    now: new Date(),
  });
  if (!opened.ok) throw new LongboxError("AUTHENTICATOR_ENROLLMENT_REFUSED");

  let recoveryCodes: readonly string[] | undefined;
  const outcome = await runIdempotent(deps.pool, req, async (tx) => {
    await lockCredential(tx, appUserId);
    // ⚠ **THE TICKET IS SPENT BY THE DATABASE, IN THIS TRANSACTION** (048 R15;
    // the security lens's F2, 063 §3.4). Without it a ticket replayed under a
    // NEW key forty seconds later minted a second authenticator and a second
    // recovery set, silently retiring the codes the person had just written
    // down. `authenticator_offer_use.ticket_digest` is the primary key, so the
    // second attempt is a failed INSERT rather than a check somebody has to
    // remember — and a genuine retry never reaches here, because
    // `replayIfSettled` answered it above.
    await spendEnrollmentOffer(tx, { ticketDigest: digestOf(input.ticket), appUserId });
    const enrolled = await enrollAuthenticator(tx, {
      appUserId,
      secret: opened.secret,
      confirmationCode: input.code,
      keyring: requireKeyring(deps),
      pepper: deps.config.pinPepper,
      now: new Date(),
      enrolledBy: appUserId,
    });
    if (!enrolled.ok) throw new LongboxError("AUTHENTICATOR_ENROLLMENT_REFUSED");
    recoveryCodes = enrolled.enrolled.recoveryCodes;
    return {
      status: 201,
      body: {
        authenticator: {
          id: enrolled.enrolled.authenticatorId,
          enrolled_at: new Date().toISOString(),
        },
      },
    };
  }).catch((err: unknown) => {
    // The loser of a re-submitted ticket: the PRIMARY KEY refused the use row
    // and the transaction rolled back with it, so there is no second
    // authenticator and no second recovery set. It answers the route's ONE
    // refusal, on `redeemInvitation`'s reasoning one credential over — a caller
    // holding a ticket must not learn which half of it the server disliked.
    if (err instanceof EnrollmentOfferAlreadySpent) {
      throw new LongboxError("AUTHENTICATOR_ENROLLMENT_REFUSED");
    }
    throw err;
  });

  const body = outcome.body as { authenticator: Record<string, unknown> };
  return {
    status: outcome.status,
    // Spliced onto the RESPONSE and never onto the stored body — 057 §4.8's
    // construction, verbatim. A replay returns the id and no codes.
    body:
      recoveryCodes !== undefined
        ? { authenticator: { ...body.authenticator, recovery_codes: recoveryCodes } }
        : body,
    cookies: [],
  };
}
