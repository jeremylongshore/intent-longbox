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
import { withTransaction, type Queryable } from "../../db.js";
import type { AppConfig } from "../../config.js";
import { resolveDeviceCredential } from "./devices.js";
import {
  membershipAt,
  shopRoster,
  shopsForSession,
  type RosterEntry,
  type ShopSummary,
} from "./memberships.js";
import { recordFailure, verifyOperatorPin } from "./pin.js";
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

  const credential = await resolveDeviceCredential(deps.pool, secret);
  if (!credential) {
    await withTransaction(deps.pool, (tx) =>
      recordFailure(tx, { method: "device_credential", failureClass: "unknown_or_revoked_credential" })
    );
    throw new LongboxError("SESSION_REQUIRED");
  }

  const shop = await readShop(deps.pool, credential.shop_id);
  const issued = await withTransaction(deps.pool, (tx) =>
    issueDeviceSession(tx, {
      shopId: credential.shop_id,
      locationId: credential.location_id,
      deviceId: credential.device_id,
      deviceCredentialId: credential.credential_id,
      now: new Date(),
    })
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
  const operators: RosterEntry[] = await shopRoster(deps.pool, device.shop_id);
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
  const shops: ShopSummary[] = await shopsForSession(deps.pool, {
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
  const verdict = await withTransaction(deps.pool, async (tx) => {
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
  });

  if (!verdict.ok) throw new LongboxError("PIN_INVALID");

  const issued = await withTransaction(deps.pool, async (tx) => {
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
  });

  const person = await readUser(deps.pool, input.appUserId);
  const shop = await readShop(deps.pool, device.shop_id);
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
  await withTransaction(deps.pool, (tx) =>
    revokeChain(tx, {
      chainId: operator.chain_id,
      shopId: operator.shop_id,
      reason: "signed_out",
      revokedBy: operator.app_user_id,
    })
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
