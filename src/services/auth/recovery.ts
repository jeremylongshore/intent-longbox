// Recovery: redeeming one code, and the nomination a shop makes at registration.
//
// ============================================================================
// A RECOVERY CODE SUBSTITUTES FOR THE SECOND FACTOR AND FOR NOTHING ELSE (R20)
// ============================================================================
//
// 048 §8.1, in the amendment that exists because v1.0.0 of that record did not say
// it: *"The recovery flow is email + password (unchanged, still required) + one
// unused recovery code, in place of the TOTP code. A recovery code is never
// accepted without the password, is never accepted on its own, and is never
// accepted in place of the password."* Without that sentence, the reading that gets
// built is "a recovery code signs you in" — which turns a printed slip in a drawer
// into a single-factor bearer credential for the owner account, strictly worse than
// the password it would be bypassing because it is written down by design and
// cannot be changed by the person who memorised it.
//
// **This module cannot enforce the password half, and says so rather than implying
// otherwise.** `user_credential` — 048 §4.1's first factor — is not in this tree
// (see `authenticator.ts`'s header and 048 §12.4 row 3a). What `redeemRecoveryCode`
// enforces is everything else: the code is live, it is used at most once by
// `UNIQUE (code_id)`, using it RETIRES the factor it substituted for so
// re-enrollment is forced by a predicate rather than by a prompt, and every refusal
// answers the same thing. **The function's contract is that its caller has already
// verified the first factor**, which is stated here, asserted in the CLI, and is
// the first line of the acceptance criteria for the bead that lands the session.
//
// ============================================================================
// USING ONE FORCES RE-ENROLLMENT, AND IT IS A RULE RATHER THAN A PROMPT
// ============================================================================
//
// 048 §8.1: *"Otherwise the owner works for six months on recovery codes, the
// second factor quietly becomes a stack of paper, and the first time anybody
// notices is when the paper runs out."* The mechanism is that the redemption
// appends a `recovery_code_used` retirement in the SAME transaction as the use, so
// afterwards `mfaState` reads `must_reenroll` — there is no live authenticator and
// there is a use — and the only thing that can clear it is an enrollment, which
// also supersedes the remaining codes by issuing a new batch. Nothing is set, so
// nothing can be left stale.
import type { Queryable, Tx } from "../../db.js";
import { RECOVERY_CODE_COUNT, retireAuthenticator, lockLiveAuthenticator } from "./authenticator.js";
import { normaliseCode } from "./codes.js";
import { recordFailure } from "./pin.js";
import { hashRecoveryCode, verifyRecoveryCode } from "./secrets.js";
import { secondFactorWait } from "./authenticator.js";

/** Thrown when `UNIQUE (code_id)` refuses a second use. Converted by the caller. */
export class RecoveryCodeAlreadyUsed extends Error {
  constructor() {
    super("that recovery code has already been used");
    this.name = "RecoveryCodeAlreadyUsed";
  }
}

export type RecoveryVerdict =
  | { ok: true; codeId: string; retiredAuthenticatorId: string }
  | { ok: false; reason: "wait" | "no_authenticator" | "no_live_codes" | "wrong_code" };

/**
 * A decoy digest, verified when a person has no live codes, so the timing does not
 * distinguish "no set" from "wrong code" (048 §9.3). Cached, and computed over a
 * value that is not a code and cannot be one.
 */
let decoyDigest: string | undefined;
async function decoy(pepper: string): Promise<string> {
  decoyDigest ??= await hashRecoveryCode("this-is-not-a-recovery-code", pepper);
  return decoyDigest;
}

/**
 * **Pay the full cost of a redemption whatever the verdict** (048 §9.3, and the
 * invariant review of `faf105f`).
 *
 * ⚠ THE FINDING THIS FIXES, AS A MEASUREMENT. A live redemption verifies the
 * whole set with no early break — eight argon2id runs at `secrets.ts`'s
 * parameters. The first draft's refusal paths verified the decoy ONCE, so a
 * person with no authenticator, or with an exhausted set, answered in **472 ms**
 * where a real wrong code took **3197 ms**: a ~6.8x gap, which is not a subtle
 * side channel — it is "does this owner still have a second factor" and "have
 * they burned their codes" readable with a stopwatch, against exactly the
 * population worth enumerating. §9.3's rule is *"the same work is done in each
 * case"*, and one verification is not the same work as eight.
 *
 * So every path that reaches a credential test performs exactly
 * `RECOVERY_CODE_COUNT` verifications: the live ones it had, plus decoys for the
 * rest. **Re-measured after the change, four alternating runs on one machine:
 * 3759 / 3306 / 3329 / 3195 ms, wrong-code and no-authenticator interleaved** —
 * the two paths are no longer separable, and what is left is argon2id's own
 * run-to-run spread on a loaded box rather than a signal about the account. The
 * numbers are a MEASUREMENT OF THIS MACHINE and are recorded as evidence that the
 * gap closed, never as a latency figure for the system (042 A3, 021 B16).
 *
 * The one path that does NOT pay is a refusal made BEFORE any credential is
 * tested — the lockout wait — and that asymmetry is 048 §9.3's own stated
 * residual, not a new one: hashing while blocked would hand an attacker a way to
 * make the server spend argon2id at a rate they choose.
 */
async function payRemainingCost(presented: string, pepper: string, alreadyDone: number): Promise<void> {
  const digest = await decoy(pepper);
  for (let i = alreadyDone; i < RECOVERY_CODE_COUNT; i += 1) {
    await verifyRecoveryCode(presented, pepper, digest);
  }
}

/**
 * Redeem one recovery code in place of the second factor.
 *
 * ⚠ **The caller must have verified the FIRST factor already** (048 §8.1, R20).
 * This function takes an `app_user_id` because the person has already been
 * identified and authenticated by something else; handing it an id off a URL would
 * make a printed slip a single-factor credential, which is precisely what R20
 * exists to forbid.
 *
 * ⚠ **The transaction MUST commit whatever the verdict**, as with every other
 * credential check in this module set: the `auth_attempt` row is what the delay is
 * derived from, and rolling it back is an unlimited budget.
 *
 * The anchor is the same one `verifyTotp` takes — the live `user_authenticator`
 * row — because that is the row the count is about and the row this act retires. A
 * person with no live authenticator is refused before anything else: recovery
 * substitutes for a factor, and there is nothing to substitute for.
 */
export async function redeemRecoveryCode(
  tx: Tx,
  args: { appUserId: string; code: string; pepper: string; now: Date }
): Promise<RecoveryVerdict> {
  const authenticator = await lockLiveAuthenticator(tx, args.appUserId);

  const wait = await secondFactorWait(tx, args.appUserId, args.now);
  if (wait > 0) return { ok: false, reason: "wait" };

  if (!authenticator) {
    // Costs the FULL set, so "this person has already recovered and has not
    // re-enrolled" is not readable off the clock.
    await payRemainingCost(normaliseCode(args.code), args.pepper, 0);
    await recordFailure(tx, {
      appUserId: args.appUserId,
      method: "recovery_code",
      failureClass: "no_authenticator",
    });
    return { ok: false, reason: "no_authenticator" };
  }

  const live = await liveRecoveryCodes(tx, args.appUserId);
  if (live.length === 0) {
    await payRemainingCost(normaliseCode(args.code), args.pepper, 0);
    await recordFailure(tx, {
      appUserId: args.appUserId,
      method: "recovery_code",
      failureClass: "no_live_codes",
    });
    return { ok: false, reason: "no_live_codes" };
  }

  // The set is tried in turn. It is the cost of 048 §8.1's argon2id instruction on
  // a value the caller does not label, and it is why `RECOVERY_CODE_COUNT` is eight
  // (see `secrets.ts`'s `hashRecoveryCode`). The loop does NOT break early: an
  // attacker who could tell "matched the first" from "matched the last" would learn
  // the position of a code in a set they are about to spend anyway, but the same
  // timing tells them nothing about a WRONG code only if every candidate is tried.
  const presented = normaliseCode(args.code);
  let matched: string | undefined;
  for (const candidate of live) {
    const same = await verifyRecoveryCode(presented, args.pepper, candidate.code_hash);
    if (same) matched = candidate.id;
  }
  // A PARTLY-SPENT SET COSTS WHAT A FULL ONE COSTS. Without this, the number of
  // verifications is the number of codes the person has left — so the clock
  // reports how close an owner is to running out, which is the one fact somebody
  // planning a lockout would most want.
  await payRemainingCost(presented, args.pepper, live.length);

  if (!matched) {
    await recordFailure(tx, {
      appUserId: args.appUserId,
      method: "recovery_code",
      failureClass: "wrong_code",
    });
    return { ok: false, reason: "wrong_code" };
  }

  // **Single use is the CONSTRAINT and not this read** (048 §8.1). Two concurrent
  // redemptions of one code both find it live above; the second INSERT is what
  // fails, at the database, on `UNIQUE (code_id)`.
  try {
    await tx.query(`INSERT INTO recovery_code_use (app_user_id, code_id) VALUES ($1,$2)`, [
      args.appUserId,
      matched,
    ]);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "23505") throw new RecoveryCodeAlreadyUsed();
    throw err;
  }

  // The forced re-enrollment, as a fact in the same transaction as the use.
  await retireAuthenticator(tx, {
    authenticatorId: authenticator.id,
    appUserId: args.appUserId,
    reason: "recovery_code_used",
    retiredBy: args.appUserId,
  });

  return { ok: true, codeId: matched, retiredAuthenticatorId: authenticator.id };
}

/** A live code: newest batch for this person, and no use row. */
async function liveRecoveryCodes(
  db: Queryable,
  appUserId: string
): Promise<Array<{ id: string; code_hash: string }>> {
  const res = await db.query(
    `SELECT c.id, c.code_hash
       FROM recovery_code c
      WHERE c.app_user_id = $1
        AND c.batch_id = (SELECT b.batch_id FROM recovery_code b
                           WHERE b.app_user_id = $1
                           ORDER BY b.issued_at DESC, b.id DESC LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM recovery_code_use u WHERE u.code_id = c.id)
      ORDER BY c.id`,
    [appUserId]
  );
  return res.rows as Array<{ id: string; code_hash: string }>;
}

/** How many codes are still live — for the CLI's "you have N left" line. */
export async function liveRecoveryCodeCount(db: Queryable, appUserId: string): Promise<number> {
  return (await liveRecoveryCodes(db, appUserId)).length;
}

// ---------------------------------------------------------------------------
// 048 §8.2 — the nomination.
// ---------------------------------------------------------------------------

/**
 * The three answers a shop may give at registration, and there is no fourth.
 *
 * 048 §8.2: *"At shop registration the owner nominates either a second `owner`, or
 * a named recovery contact recorded on the shop … It is nominated, not required. A
 * shop that declines proceeds, and the decline is a fact rather than a blank field
 * — because the difference between 'this owner has no second person' and 'nobody
 * asked' is the difference between a known residual and a surprise during an
 * outage."*
 *
 * `declined` is a first-class answer for exactly that reason. What `register-shop`
 * refuses is SILENCE, not a decline.
 */
export type RecoveryNominationKind = "second_owner" | "named_contact" | "declined";

export interface RecoveryNomination {
  id: string;
  shop_id: string;
  kind: RecoveryNominationKind;
  contact_name: string | null;
  contact_note: string | null;
  created_at: Date;
}

/**
 * Record the shop's answer. Appended, never edited — a shop that changes its mind
 * appends a second row and the newest one is the current answer.
 *
 * ⚠ A named contact **is not a credential and grants nothing**. It is the
 * out-of-band identity check E11-B09's break-glass runbook performs against, so
 * that the verification stops being "the person who emailed sounds right". No code
 * path reads it as authority, and none may be added that does.
 */
export async function recordRecoveryNomination(
  tx: Tx,
  args: {
    shopId: string;
    kind: RecoveryNominationKind;
    contactName?: string | null;
    contactNote?: string | null;
    nominatedBy?: string | null;
  }
): Promise<void> {
  const named = args.kind === "named_contact";
  await tx.query(
    `INSERT INTO shop_recovery_nomination (shop_id, kind, contact_name, contact_note, nominated_by)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      args.shopId,
      args.kind,
      named ? (args.contactName ?? null) : null,
      named ? (args.contactNote ?? null) : null,
      args.nominatedBy ?? null,
    ]
  );
}

/** The shop's current answer, or `undefined` when nobody has been asked yet. */
export async function currentRecoveryNomination(
  db: Queryable,
  shopId: string
): Promise<RecoveryNomination | undefined> {
  const res = await db.query(
    `SELECT n.id, n.shop_id, n.kind, n.contact_name, n.contact_note, n.created_at
       FROM shop_recovery_nomination n
      WHERE n.shop_id = $1
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT 1`,
    [shopId]
  );
  return res.rows[0] as RecoveryNomination | undefined;
}
