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
import { serviceDb, tenantDb, withTransaction, type Queryable } from "../../db.js";
import type { AppConfig } from "../../config.js";
import { API_PREFIX } from "../../contracts/v1/schemas.js";
import { replayIfSettled, runIdempotent, type IdempotentRequest } from "../idempotency.js";
import { digestOf } from "./codes.js";
import { resolveDeviceCredential } from "./devices.js";
import { EnrollmentCodeAlreadySpent, enrollDevice, verifyEnrollmentCode } from "./enrollment.js";
import { InvitationAlreadySpent, grantInvitation, verifyInvitation } from "./invitations.js";
import {
  membershipAt,
  shopRoster,
  shopsForSession,
  type RosterEntry,
  type ShopSummary,
} from "./memberships.js";
import { recordFailure, setOperatorPin, verifyOperatorPin } from "./pin.js";
import { tokenHash } from "./secrets.js";
import type { ShopRateLimiter } from "../rateLimit.js";
import { DEVICE_COOKIE, OPERATOR_COOKIE, clearCookie, setCookie } from "./policy.js";
import { issueDeviceSession, issueOperatorSession, revokeChain, type SessionRow } from "./sessions.js";

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

/** The picker's roster. Display name and id, ordered by name — never by activity. */
export async function operatorRoster(deps: AuthDeps, device: SessionRow): Promise<AuthResult> {
  const operators: RosterEntry[] = await shopRoster(tenantDb(deps.pool, device.shop_id), device.shop_id);
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
  device: SessionRow,
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
  device: SessionRow,
  input: { appUserId: string; pin: string }
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

  // `app_user` carries no tenant column and therefore no policy (its reason, and
  // the residual it leaves, are 056 §7 and §11 R9). `shop` DOES carry one now — on
  // its own `id` — so the read that follows names the tenant it is about.
  const person = await readUser(deps.pool, input.appUserId);
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

async function readUser(db: Queryable, id: string): Promise<{ id: string; display_name: string }> {
  const res = await db.query(`SELECT id, display_name FROM app_user WHERE id = $1`, [id]);
  const row = res.rows[0] as { id: string; display_name: string } | undefined;
  if (!row) throw new LongboxError("SESSION_REQUIRED");
  return row;
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
  device: SessionRow,
  input: { code: string; pin: string; idempotencyKey: string }
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
    const person = await readUser(tx, invitation.app_user_id);
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
