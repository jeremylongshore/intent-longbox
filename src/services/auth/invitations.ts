// Invitations: issuing one, and redeeming one on a phone the shop already owns.
//
// **The rule this file implements** (048 §7.1, §7.1a):
//
//   > An invitation is an append-only fact naming a shop, a role, an inviter and
//   > an expiry, with `sha256(token)` stored and the token shown once. It is
//   > single-use because its use table carries `UNIQUE (invitation_id)` — not
//   > because a status column says so. Acceptance grants the membership in the
//   > same transaction.
//
//   > An invitation or enrollment code is redeemable ONLY on a device that
//   > already holds a live device session enrolled to the same shop the token
//   > names. A correct token presented from any other context — another shop's
//   > device, a browser with no device session, a laptop — is refused with
//   > §9.3's constant answer.
//
// ============================================================================
// WHERE EACH GUARANTEE ACTUALLY LIVES
// ============================================================================
//
//   * **single-use** — `UNIQUE (invitation_id)` on `invitation_use`, at the
//     database. The `spent` check below is an EARLY REFUSAL and not the
//     mechanism: two concurrent redemptions both pass it, and the constraint is
//     what makes exactly one of them commit;
//   * **the device binding** — the auth-allowlist row requires a live `device`
//     principal before this code runs, AND `redeemInvitation` refuses a token
//     whose shop is not the device session's shop. Both halves are needed: the
//     allowlist proves a phone, the shop comparison proves it is *this shop's*
//     phone (019 T24, non-waivable);
//   * **expiry** — a predicate over `expires_at`, never a column anybody marks;
//   * **the per-shop ceilings** — `policy.ts`, enforced here, and they are what
//     make 048 §7.1a's permission for a short code true rather than asserted.
//
// ============================================================================
// THE ONE CONSTANT ANSWER (048 §9.3)
// ============================================================================
//
// An unknown code, a spent one, an expired one, one for another shop, and a shop
// still inside its redemption delay all produce `INVITATION_INVALID` with no
// `details`. The caller cannot tell them apart, which is the point: a helpful
// error here is a query interface over which codes exist.
//
// **The residual 048 §9.3 records applies verbatim and is not re-argued**: a
// throttled shop is refused BEFORE the digest lookup, so its refusal returns
// faster than the others. What bounds that leak is the delay itself, and the
// fact recovered is one bit about a shop the caller already named on a channel
// that is already possession-bound.
//
// ============================================================================
// NO REAL NAMES (048 §7.1's header, which means it)
// ============================================================================
//
// Nothing in this file, in its tests or in any fixture carries a real shop's
// name, a real employee's name or a real code.
import type { Queryable, Tx } from "../../db.js";
import { digestOf, mintInvitationCode } from "./codes.js";
import {
  INVITATION_TTL_MS,
  LOCKOUT_WINDOW_MS,
  MAX_OUTSTANDING_INVITATIONS_PER_SHOP,
  redemptionWaitMs,
} from "./policy.js";
import { recordFailure, type AuthMethod } from "./pin.js";
import type { SessionRow } from "./sessions.js";

export type InvitableRole = "owner" | "manager" | "operator";

export interface IssuedInvitation {
  invitationId: string;
  /** Returned ONCE. Never logged, never stored, never in an envelope. */
  code: string;
  expiresAt: Date;
}

export type IssueRefusal = "too_many_outstanding" | "not_a_member";

/**
 * Issue an invitation. **Returns the code once and never again.**
 *
 * `invitedBy` must hold a live membership at the shop — checked here rather than
 * assumed from the caller, because this function is reachable from a CLI script
 * as well as from a future route, and a check that only exists at the HTTP edge
 * is a check the second caller does not have.
 *
 * The outstanding ceiling (048 §7.1a) is counted over UNEXPIRED, UNREDEEMED
 * rows — both predicates, because neither table has a status column. It is
 * counted INSIDE this transaction, after a `FOR UPDATE` on the shop row would be
 * the belt-and-braces version; it is deliberately NOT taken, because the ceiling
 * bounds an aggregate keyspace divisor and being off by one under a race does
 * not change what it is for. Stated rather than left as an oversight.
 */
export async function issueInvitation(
  tx: Tx,
  args: {
    shopId: string;
    appUserId: string;
    role: InvitableRole;
    locationId?: string | null;
    invitedBy: string;
    now: Date;
  }
): Promise<{ ok: true; invitation: IssuedInvitation } | { ok: false; refusal: IssueRefusal }> {
  const inviter = await tx.query(
    `SELECT m.id FROM membership m
      WHERE m.app_user_id = $1 AND m.shop_id = $2
        AND m.effective_from <= now()
        AND (m.effective_until IS NULL OR m.effective_until > now())
        AND NOT EXISTS (SELECT 1 FROM membership_revocation r WHERE r.membership_id = m.id)
      LIMIT 1`,
    [args.invitedBy, args.shopId]
  );
  if (inviter.rows.length === 0) return { ok: false, refusal: "not_a_member" };

  const outstanding = await countOutstandingInvitations(tx, args.shopId);
  if (outstanding >= MAX_OUTSTANDING_INVITATIONS_PER_SHOP) {
    return { ok: false, refusal: "too_many_outstanding" };
  }

  const code = mintInvitationCode();
  const expiresAt = new Date(args.now.getTime() + INVITATION_TTL_MS);
  const res = await tx.query(
    `INSERT INTO invitation
       (shop_id, app_user_id, role, scope_kind, location_id, token_digest, expires_at, invited_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      args.shopId,
      args.appUserId,
      args.role,
      args.locationId ? "location" : "shop",
      args.locationId ?? null,
      digestOf(code),
      expiresAt,
      args.invitedBy,
    ]
  );
  return {
    ok: true,
    invitation: { invitationId: (res.rows[0] as { id: string }).id, code, expiresAt },
  };
}

/** Unexpired and unredeemed — two predicates, no status column (048 §7.1). */
export async function countOutstandingInvitations(db: Queryable, shopId: string): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM invitation i
      WHERE i.shop_id = $1
        AND i.expires_at > now()
        AND NOT EXISTS (SELECT 1 FROM invitation_use u WHERE u.invitation_id = i.id)`,
    [shopId]
  );
  return (res.rows[0] as { n: number }).n;
}

export type RedemptionRefusal = "wait" | "unknown" | "spent" | "expired" | "wrong_shop";

export interface InvitationRow {
  id: string;
  shop_id: string;
  app_user_id: string;
  role: InvitableRole;
  scope_kind: "shop" | "location";
  location_id: string | null;
  expires_at: Date;
  invited_by: string;
}

export type InvitationVerdict =
  { ok: true; invitation: InvitationRow } | { ok: false; reason: RedemptionRefusal };

/**
 * **Step one of two: decide, and record the failure.** Runs in its own
 * transaction, which COMMITS whatever the verdict.
 *
 * This is `openOperatorSession`'s shape and it is here for the same reason
 * (048 §9.1, R5): the `auth_attempt` row is what the delay is derived from, so
 * throwing the refusal from inside the transaction that appended it would roll
 * the row back and hand a caller an unlimited budget through the very mechanism
 * meant to bound it. The verdict comes out; the refusal is thrown after the
 * commit; the grant is a second transaction.
 *
 * **The rate key is the DEVICE SESSION'S shop, and that IS 048 R14's "the shop
 * the token names".** R14 keys invitation acceptance on the shop the token
 * names, and R15 makes a redemption succeed only when those two shops are the
 * same — so on every path that can succeed they are one shop, and on a
 * cross-shop attempt the budget spent is the attacker's own shop's rather than
 * the victim's. Keying on the token's shop instead would mean looking the token
 * up BEFORE throttling, which is the ordering 048 §9.1 refuses: the throttle
 * runs before any credential is tested.
 *
 * **A throttled request records NO attempt row**, exactly as a blocked PIN
 * records none: the refusal happens before the code is looked at, so there is no
 * credential test to record, and recording one would let a flooder ratchet the
 * delay by hammering.
 */
export async function verifyInvitation(
  tx: Tx,
  args: { device: SessionRow; code: string; now: Date }
): Promise<InvitationVerdict> {
  const shopId = args.device.shop_id;

  const wait = await redemptionWait(tx, shopId, "invitation", args.now);
  if (wait > 0) return { ok: false, reason: "wait" };

  const res = await tx.query(
    `SELECT i.id, i.shop_id, i.app_user_id, i.role, i.scope_kind, i.location_id,
            i.expires_at, i.invited_by,
            EXISTS (SELECT 1 FROM invitation_use u WHERE u.invitation_id = i.id) AS spent
       FROM invitation i WHERE i.token_digest = $1`,
    [digestOf(args.code)]
  );
  const row = res.rows[0] as (InvitationRow & { spent: boolean }) | undefined;

  const fail = async (failureClass: string, reason: RedemptionRefusal): Promise<InvitationVerdict> => {
    await recordFailure(tx, {
      shopId,
      deviceId: args.device.device_id,
      method: "invitation",
      failureClass,
    });
    return { ok: false, reason };
  };

  if (!row) return fail("unknown_invitation", "unknown");
  // 019 T24, non-waivable: a token for another shop is refused on this phone,
  // and the refusal is byte-identical to an unknown token's. The `app_user_id`
  // is NOT recorded on this attempt row — the person the invitation names is a
  // fact about the OTHER shop, and copying it here would put one shop's staff
  // identifier in another shop's table.
  if (row.shop_id !== shopId) return fail("cross_shop_invitation", "wrong_shop");
  if (row.spent) return fail("spent_invitation", "spent");
  if (row.expires_at.getTime() <= args.now.getTime()) return fail("expired_invitation", "expired");
  return { ok: true, invitation: row };
}

/**
 * **Step two of two: grant, in ONE transaction.**
 *
 * 048 §7.1: "Acceptance grants the membership in the same transaction." Both
 * rows commit or neither does, so there is no state in which a code is spent and
 * no membership exists, and none in which a membership exists that no code paid
 * for.
 *
 * **The `UNIQUE (invitation_id)` is the mechanism and the loser is REFUSED, not
 * repaired.** `ON CONFLICT DO NOTHING RETURNING id` returns nothing when another
 * transaction already committed a use, and this function then throws — rolling
 * its own membership INSERT back with it. That is the whole of "single-use is a
 * constraint or it is a race": the early `spent` check in `verifyInvitation`
 * cannot serialise two callers, and this can.
 */
export class InvitationAlreadySpent extends Error {
  constructor() {
    super("invitation already redeemed");
    this.name = "InvitationAlreadySpent";
  }
}

export async function grantInvitation(
  tx: Tx,
  args: { invitation: InvitationRow; device: SessionRow; deviceSessionId: string }
): Promise<{ membershipId: string; invitationUseId: string }> {
  const membership = await tx.query(
    `INSERT INTO membership
       (app_user_id, shop_id, scope_kind, location_id, role, granted_by, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      args.invitation.app_user_id,
      args.invitation.shop_id,
      args.invitation.scope_kind,
      args.invitation.location_id,
      args.invitation.role,
      // The INVITER granted this, not the phone. `membership.granted_by` is the
      // person who decided, and the person who decided signed the invitation.
      args.invitation.invited_by,
      "invitation redeemed",
    ]
  );
  const membershipId = (membership.rows[0] as { id: string }).id;

  const use = await tx.query(
    `INSERT INTO invitation_use
       (shop_id, invitation_id, membership_id, redeemed_on_device_id, redeemed_on_session_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (invitation_id) DO NOTHING
     RETURNING id`,
    [args.invitation.shop_id, args.invitation.id, membershipId, args.device.device_id, args.deviceSessionId]
  );
  const useRow = use.rows[0] as { id: string } | undefined;
  if (!useRow) throw new InvitationAlreadySpent();
  return { membershipId, invitationUseId: useRow.id };
}

/**
 * 048 §7.1a's per-shop ceiling on REDEMPTION ATTEMPTS, derived from
 * `auth_attempt` (048 §9.1: attempts are facts, not counters in a process — so
 * this survives a restart and is not per worker).
 *
 * The window count reads `now()`, which 048 §9.1 already declares the third
 * sanctioned exception under 041 §2.6. This is the same derivation on the same
 * table for the same reason and adds no fourth exception: "how many times has
 * this shop failed a redemption in the last interval" is a statement about now
 * in exactly `abandoned`'s sense.
 *
 * **`auth_attempt` stays SUBSTRATE, not surface** (048 §9.1, R17): this is a
 * read for exactly one shop, in the request that is authenticating against that
 * shop, and it projects no operator identifier — it does not `GROUP BY` a
 * person, does not order by one, and returns two aggregates about a shop.
 */
export async function redemptionWait(
  db: Queryable,
  shopId: string,
  method: Extract<AuthMethod, "invitation" | "enrollment_code">,
  now: Date
): Promise<number> {
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
  const res = await db.query(
    `SELECT count(*)::int AS failures,
            extract(epoch from (now() - max(created_at))) AS age
       FROM auth_attempt
      WHERE shop_id = $1 AND method = $2 AND created_at >= $3`,
    [shopId, method, since]
  );
  const row = res.rows[0] as { failures: number; age: string | null };
  return redemptionWaitMs({
    failures: row.failures,
    lastFailureAgeMs: row.age === null ? Number.POSITIVE_INFINITY : Number(row.age) * 1000,
  });
}
