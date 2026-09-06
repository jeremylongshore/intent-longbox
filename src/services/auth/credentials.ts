// THE FIRST FACTOR — the password 048 §4.1 calls PRIMARY and 048 §10.2's table
// assigned to nobody.
//
// Bead: longbox-e5b.3.21 (alias E03-D11). Docs: 000-docs/057 §4.1, §4.5; 048
// §4.1, §9.1, §9.2, §9.3, §10.1, §12.4 rows 3/3a; 041 §4.2; 042 §5.3(b).
//
// ============================================================================
// IT IS `pin.ts`, ONE LAYER UP, AND THE MIRRORING IS DELIBERATE
// ============================================================================
//
// 048 §9.1 gives one construction for every credential this system verifies:
// **count and verify in ONE transaction under `SELECT … FOR UPDATE` on an anchor
// row, because every reader of the count is a writer of the row the count is
// about.** `operator_pin` is the anchor for a PIN (per `(device, person)`),
// `user_authenticator` is the anchor for a TOTP code and a recovery code (per
// person, 048 §4.3), and `user_credential` is the anchor here (per person, which
// is §9.1's own key "for a password").
//
// Where this file differs from `pin.ts`, it differs because the record does:
//
//   * **the key is the PERSON, not a pair.** A password is not a
//     possession-bound credential and there is no device to key on — 048 §9.1's
//     per-device ceiling exists to bound "an attacker holding the phone walks
//     the roster", which is a shared-counter-phone attack that has no analogue
//     here;
//   * **the budget is SHARED with the second factor** (057 §4.5). 048 §4.3
//     already rules that TOTP and recovery-code attempts share ONE per-person
//     budget, *"because two forms of one factor with two budgets is one budget
//     an attacker doubles by alternating"*. Three forms is the same sentence
//     with a bigger number, so `personWait` counts `password`, `totp` and
//     `recovery_code` together and every one of the three reads it;
//   * **an unknown email consumes no budget and can consume none.** There is no
//     row to anchor on and no person to key a count on, so the branch pays the
//     decoy's cost, appends a failure with a NULL `app_user_id`, and refuses.
//     That is a deliberate asymmetry and it is stated rather than discovered:
//     the guessing it leaves unbounded is guessing at addresses this system does
//     not hold, and the alternative — keying a budget on the SUBMITTED string —
//     is an unbounded table an attacker fills by choosing new strings.
//
// ============================================================================
// EVERY REFUSAL ANSWERS THE SAME THING, AND THE CALLER MUST COMMIT
// ============================================================================
//
// 048 §9.3: an unknown email, a wrong password, a person with no credential and
// a person inside their delay all return a verdict the caller turns into ONE
// code with no `details`. And, exactly as for `verifyOperatorPin` and
// `verifyTotp`: **the transaction MUST commit whatever the verdict**, because
// the `auth_attempt` row this function appends is what the delay is derived
// from. Throwing from inside it would roll the failure back and hand an attacker
// an unlimited budget through the mechanism designed to bound it.
import { randomUUID } from "node:crypto";
import type { Queryable, Tx } from "../../db.js";
import { LOCKOUT_WINDOW_MS, secondFactorWaitMs } from "./policy.js";
import { hashWithPepper, verifyWithPepper } from "./secrets.js";
import { recordFailure } from "./pin.js";

/** The columns the first-factor verification reads. Named, never a star (042 I5). */
const CREDENTIAL_COLUMNS = `c.id, c.app_user_id, c.password_hash, c.pepper_version`;

export interface UserCredentialRow {
  id: string;
  app_user_id: string;
  /**
   * NULL after a break-glass clearance (`migrations/037`, 063 §3.8). A null
   * digest verifies against nothing, so a cleared person is refused with 048
   * §9.3's constant answer exactly as a person with no credential is — and the
   * ANCHOR survives, which is the whole reason a clearance is not a DELETE.
   */
  password_hash: string | null;
  pepper_version: number;
}

/**
 * A digest to verify against when there is nothing to verify against.
 *
 * `verifyOperatorPin`'s decoy, for the same reason and computed once per
 * process: 048 §9.3 requires the same work in every case, so an unknown email
 * and a person with no credential must cost what a wrong password costs.
 * Otherwise the response body withholds "this address is unknown" and the clock
 * publishes it.
 */
let decoyDigest: string | undefined;
async function decoy(pepper: string): Promise<string> {
  decoyDigest ??= await hashWithPepper("this-is-not-a-password", pepper);
  return decoyDigest;
}

/**
 * Set or replace a person's password. **An UPDATE in place, by decision.**
 *
 * 048 §10.1: *"a password is changed in place; versioning the hash would keep
 * every old password's hash forever, which is a liability rather than an audit
 * trail."* `migrations/031`'s `ENABLE ALWAYS` trigger is what makes "in place"
 * mean the three columns it may mean, and nothing else — the row's owner, its
 * id and its birth are as immutable as any append-only fact.
 *
 * The password's SHAPE is deliberately not policed here beyond a floor, and the
 * absence is a decision (057 §4.1): 048 §3.5 fixes the PIN's shape because six
 * digits is a keyspace worth arguing about, and says nothing at all about a
 * password's composition. A composition rule (an uppercase, a symbol) is a rule
 * that shortens real passwords and lengthens nobody's, and this record will not
 * invent one where the ratified one is silent. What IS enforced is a minimum
 * length, because a two-character password is a typo rather than a choice.
 */
export const MIN_PASSWORD_LENGTH = 12;

export type PasswordRefusal = "too_short" | "already_set" | "no_credential";

/**
 * Hash a chosen password, or refuse the floor. Shared by the two writers below
 * so the argon2id call and the length rule have exactly one home.
 */
async function digestOrRefuse(
  password: string,
  pepper: string
): Promise<{ ok: true; hash: string } | { ok: false; refusal: PasswordRefusal }> {
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, refusal: "too_short" };
  return { ok: true, hash: await hashWithPepper(password, pepper) };
}

/**
 * **PROVISION a first password. It can never overwrite one, and the DATABASE is
 * what makes that true** (E03-D24; the data-model lens's H4, 000-docs/063 §3.3).
 *
 * ⚠ **THIS WAS ONE `setPassword` UPSERT AND THE LENS WAS RIGHT TO REFUSE IT.**
 * That function was an `INSERT … ON CONFLICT (app_user_id) DO UPDATE`, willing
 * to overwrite, shared by both writers and distinguished only by an
 * application-level existence check in one of them — so 063 §3.3's central
 * security claim (*the credential route provisions and can never replace*) was a
 * fact about which of two call sites a future author remembered to invoke. A
 * break-glass administration path is already on this epic's roadmap and is
 * exactly the third call site that would have inherited the gap silently.
 *
 * **`DO NOTHING RETURNING id` makes the ROW COUNT the enforcement**, which is
 * 048 R19's own idiom one factor down: an existing credential returns no row, so
 * the refusal comes from the database rather than from a `SELECT` somebody has
 * to remember to run first.
 *
 * ⚠ **AND A CLEARED ROW IS ABSENT, WHICH TAKES A SECOND STATEMENT** (the
 * invariant review's BLOCK, 063 §3.8). A break-glass clearance NULLs the hash
 * and keeps the row — the row is the lockout anchor — so `ON CONFLICT DO
 * NOTHING`, which keys on the ROW, refused a person who has no password. The
 * `UPDATE … WHERE password_hash IS NULL` below is the revival, and its predicate
 * is what keeps the enforcement intact: a LIVE hash matches nothing there. The caller still takes `lockCredential` before this
 * — not for correctness here, but because the shared per-person lockout budget
 * has two anchors and a write that skipped one would not serialise against a
 * concurrent sign-in (057 §4.5).
 *
 * The password's SHAPE is deliberately not policed beyond a floor, and the
 * absence is a decision (057 §4.1): 048 §3.5 fixes the PIN's shape because six
 * digits is a keyspace worth arguing about, and says nothing at all about a
 * password's composition. A composition rule shortens real passwords and
 * lengthens nobody's. What IS enforced is a minimum length, because a
 * two-character password is a typo rather than a choice.
 */
export async function provisionPassword(
  tx: Tx,
  args: { appUserId: string; password: string; pepper: string }
): Promise<{ ok: true; credentialId: string } | { ok: false; refusal: PasswordRefusal }> {
  const digest = await digestOrRefuse(args.password, args.pepper);
  if (!digest.ok) return digest;
  const id = randomUUID();
  const inserted = await tx.query(
    `INSERT INTO user_credential (id, app_user_id, password_hash)
     VALUES ($1,$2,$3)
     ON CONFLICT (app_user_id) DO NOTHING
     RETURNING id`,
    [id, args.appUserId, digest.hash]
  );
  const fresh = inserted.rows[0] as { id: string } | undefined;
  if (fresh) return { ok: true, credentialId: fresh.id };

  // ⚠ **A CLEARED ROW IS ABSENT FOR PROVISIONING PURPOSES, AND WITHOUT THIS
  // SECOND STATEMENT A CLEARED PERSON WAS UNREACHABLE BY EVERY SURFACE** (the
  // invariant review's BLOCK; 063 §3.8). `clearPassword` NULLs the hash and
  // keeps the ROW, because the row is 048 §9.1's lockout anchor and
  // `migrations/031`'s trigger refuses a DELETE to everyone including the schema
  // owner. But `ON CONFLICT DO NOTHING` keys on the ROW, so the first-password
  // route answered `already_set` for somebody who has no password; the rotation
  // route needs a privileged session, which needs the password that was just
  // cleared; and no CLI calls either. `--reason lost_credential` therefore had
  // no outcome at all, and three artifacts said the opposite.
  //
  // **The affected-row count is still the whole of the authorization** (H4): the
  // `password_hash IS NULL` predicate is what makes this a REVIVAL and not an
  // overwrite — a live hash matches nothing here and falls through to
  // `already_set`, so `replacePassword` remains the only statement in this
  // system that can overwrite a live password, and it still costs a privileged
  // session and a fresh second factor.
  //
  // It sits inside `migrations/031`'s column licence, which is the same licence
  // the clearance's NULL uses: the trigger pins `id`, `app_user_id`,
  // `created_at` and `authored_by`, and says nothing about the value of
  // `password_hash` — so NULL → hash needs no migration and no widening.
  const revived = await tx.query(
    `UPDATE user_credential
        SET password_hash = $2, updated_at = now()
      WHERE app_user_id = $1 AND password_hash IS NULL
     RETURNING id`,
    [args.appUserId, digest.hash]
  );
  const row = revived.rows[0] as { id: string } | undefined;
  if (!row) return { ok: false, refusal: "already_set" };
  return { ok: true, credentialId: row.id };
}

/**
 * **REPLACE an existing password. It can never create one**, and the row count
 * is again the enforcement (H4).
 *
 * 048 §10.1: *"a password is changed in place; versioning the hash would keep
 * every old password's hash forever, which is a liability rather than an audit
 * trail."* `migrations/031`'s `ENABLE ALWAYS` trigger is what makes "in place"
 * mean the three columns it may mean — the row's owner, its id and its birth are
 * as immutable as any append-only fact.
 *
 * A person with no credential matches no row and is refused `no_credential`
 * rather than quietly acquiring one from a route whose whole gate is a fresh
 * second factor.
 */
export async function replacePassword(
  tx: Tx,
  args: { appUserId: string; password: string; pepper: string }
): Promise<{ ok: true; credentialId: string } | { ok: false; refusal: PasswordRefusal }> {
  const digest = await digestOrRefuse(args.password, args.pepper);
  if (!digest.ok) return digest;
  const res = await tx.query(
    `UPDATE user_credential
        SET password_hash = $2, updated_at = now()
      WHERE app_user_id = $1
     RETURNING id`,
    [args.appUserId, digest.hash]
  );
  const row = res.rows[0] as { id: string } | undefined;
  if (!row) return { ok: false, refusal: "no_credential" };
  return { ok: true, credentialId: row.id };
}

/**
 * **CLEAR a password, as a schema-owner break-glass act** (E03-D24; the security
 * lens's F3, 000-docs/063 §3.8).
 *
 * `migrations/031`'s trigger refuses a DELETE to everyone including the schema
 * owner, deliberately — the anchor row is what the lockout budget counts
 * against, and a credential that could be deleted is a lockout that could be
 * reset by deleting it. So a clearance NULLs the hash, which the trigger's
 * three-column licence permits, and the FACT of it is a row in
 * `user_credential_clearance` (`migrations/037`).
 *
 * A NULL hash verifies against nothing: `verifyPassword` reads the column and a
 * null digest cannot match, so a cleared person is refused with §9.3's constant
 * answer exactly as a person with no credential is.
 *
 * ⚠ **AND THE FIRST-PASSWORD ROUTE IS REACHABLE AGAIN, WHICH TOOK A CODE CHANGE
 * RATHER THAN THE SENTENCE THIS COMMENT USED TO CARRY.** It said the route was
 * *"reachable again, because `provisionPassword`'s `ON CONFLICT DO NOTHING` keys
 * on the ROW and the row is still there"* — which was exactly backwards: keying
 * on the row is what made it REFUSE. `provisionPassword` now treats a cleared
 * row as absent (`UPDATE … WHERE password_hash IS NULL`), so a clearance is a
 * terminal act whose outcome is that the person is provisioned from the counter
 * phone by the ordinary route. Clearing rather than deleting still keeps the
 * anchor and its lockout history.
 */
export async function clearPassword(
  tx: Tx,
  args: { appUserId: string; reason: CredentialClearanceReason; clearedBy: string | null; note?: string }
): Promise<{ cleared: boolean; credentialId?: string }> {
  const res = await tx.query(
    `UPDATE user_credential
        SET password_hash = NULL, updated_at = now()
      WHERE app_user_id = $1
     RETURNING id`,
    [args.appUserId]
  );
  const row = res.rows[0] as { id: string } | undefined;
  if (!row) return { cleared: false };
  await tx.query(
    `INSERT INTO user_credential_clearance (credential_id, app_user_id, reason, cleared_by, note)
     VALUES ($1,$2,$3,$4,$5)`,
    [row.id, args.appUserId, args.reason, args.clearedBy, args.note ?? null]
  );
  return { cleared: true, credentialId: row.id };
}

/** Why a password was cleared. A CLOSED set, matching `migrations/037`'s CHECK. */
export type CredentialClearanceReason = "squatted_credential" | "lost_credential";

/** Read a person's credential without locking it. For state questions only. */
export async function readCredential(
  db: Queryable,
  appUserId: string
): Promise<UserCredentialRow | undefined> {
  const res = await db.query(`SELECT ${CREDENTIAL_COLUMNS} FROM user_credential c WHERE c.app_user_id = $1`, [
    appUserId,
  ]);
  return res.rows[0] as UserCredentialRow | undefined;
}

/**
 * Resolve a sign-in identifier to a person, by lowercased email.
 *
 * `app_user.email` is a LOGIN IDENTIFIER and not a delivery channel (048 §7.2:
 * there is no mailer and this system does not invent one). The lowercasing
 * matches `scripts/issue-invitation.ts`'s `lower($1)` insert, so a person who
 * capitalises their own address at sign-in is the same person.
 */
export async function personIdForEmail(db: Queryable, email: string): Promise<string | undefined> {
  const res = await db.query(`SELECT u.id FROM app_user u WHERE u.email = lower($1)`, [email]);
  return (res.rows[0] as { id: string } | undefined)?.id;
}

export type PasswordVerdict =
  | { ok: true; appUserId: string }
  | { ok: false; reason: "wait" | "unknown_person" | "no_credential" | "wrong_password" };

/**
 * **Verify a password under its anchor, on the shared per-person budget.**
 *
 * The order is the whole function, and it is `verifyTotp`'s order one factor
 * earlier:
 *
 *   1. resolve the identifier to a person — no lock yet, because there may be no
 *      person and there is nothing to lock;
 *   2. **the anchor** — `FOR UPDATE` on that person's `user_credential` row,
 *      before anything is counted, so N concurrent attempts consume N budget
 *      rather than one (048 §9.1's write-skew case);
 *   3. **the window count**, refused before any cryptography: a blocked attempt
 *      tests no credential, so it records no failure and cannot be used to
 *      ratchet the delay;
 *   4. **the same work in every case** — an unknown address and a person with no
 *      credential both verify the decoy;
 *   5. the failure fact, appended inside this transaction, which the caller
 *      commits.
 */
export async function verifyPassword(
  tx: Tx,
  args: { email: string; password: string; pepper: string; now: Date }
): Promise<PasswordVerdict> {
  const appUserId = await personIdForEmail(tx, args.email);

  if (appUserId === undefined) {
    // No person, so no anchor and no budget to key on. Pay the cost, record the
    // fact with a NULL person — which is exactly what `auth_attempt`'s nullable
    // `app_user_id` was declared for in `020` — and refuse.
    await verifyWithPepper(args.password, args.pepper, await decoy(args.pepper));
    await recordFailure(tx, { method: "password", failureClass: "unknown_identifier" });
    return { ok: false, reason: "unknown_person" };
  }

  const anchor = await tx.query(
    `SELECT ${CREDENTIAL_COLUMNS} FROM user_credential c WHERE c.app_user_id = $1 FOR UPDATE OF c`,
    [appUserId]
  );
  const row = anchor.rows[0] as UserCredentialRow | undefined;

  const wait = await personWait(tx, appUserId, args.now);
  if (wait > 0) return { ok: false, reason: "wait" };

  // A CLEARED row (`password_hash IS NULL`, 063 §3.8) pays the decoy's cost and
  // answers as an absent credential does — the same work in every case (§9.3),
  // and no branch where a null reaches the verifier.
  const digest = row?.password_hash ?? (await decoy(args.pepper));
  const matched = await verifyWithPepper(args.password, args.pepper, digest);

  if (!row || row.password_hash === null) {
    await recordFailure(tx, { appUserId, method: "password", failureClass: "no_credential" });
    return { ok: false, reason: "no_credential" };
  }
  if (!matched) {
    await recordFailure(tx, { appUserId, method: "password", failureClass: "wrong_password" });
    return { ok: false, reason: "wrong_password" };
  }
  return { ok: true, appUserId };
}

/**
 * **ONE per-person budget, across all three factors** (057 §4.5).
 *
 * 048 §4.3 rules that TOTP and recovery-code attempts share one budget *"because
 * two forms of one factor with two budgets is one budget an attacker doubles by
 * alternating"*. The first factor is a THIRD form of the same thing — a value an
 * attacker submits against one named person — and giving it its own budget would
 * be the same doubling with the same argument against it, one factor lower.
 *
 * So this is `authenticator.ts`'s `secondFactorWait` widened to three methods
 * and re-homed under a name that no longer says "second": both files call THIS
 * one, so the two cannot drift into two budgets by an edit to one of them.
 *
 * ⚠ **The shared budget is serialised FOR THE ROUTE because the sign-in takes
 * BOTH anchors** (057 §4.5). Two anchors and one count is the write-skew shape
 * 048 §9.1 exists to close, and `openPrivilegedSession` closes it by taking
 * `user_credential FOR UPDATE` and then `user_authenticator FOR UPDATE` in ONE
 * transaction, in that order — the fixed order 042 §5.3(b) now declares in five
 * positions and `pnpm arch` polices.
 *
 * **There IS one path that takes only one of them, and it is declared rather than
 * denied**: `pnpm redeem-recovery-code` holds `user_authenticator` alone and reads
 * and appends this same counter. It is accepted because reaching it needs the
 * schema owner's database URL and shell access on the host — a network caller
 * cannot race it, and the only race available is an operator racing themselves.
 * 057 §9 R8 carries it; an earlier version of this comment claimed no such path
 * existed, which was false of this repository the day it was written.
 */
export async function personWait(db: Queryable, appUserId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
  const res = await db.query(
    `SELECT count(*)::int AS failures,
            extract(epoch from (now() - max(created_at))) AS age
       FROM auth_attempt
      WHERE app_user_id = $1 AND created_at >= $2
        AND method IN ('password','totp','recovery_code')`,
    [appUserId, since]
  );
  const r = res.rows[0] as { failures: number; age: string | null };
  return secondFactorWaitMs({
    failures: r.failures,
    lastFailureAgeMs: r.age === null ? Number.POSITIVE_INFINITY : Number(r.age) * 1000,
  });
}

/**
 * Take the first factor's anchor without verifying anything.
 *
 * The re-enrollment and sign-out paths do not test a password and must still not
 * race a concurrent sign-in for the same person; this is the lock without the
 * verification, so those paths join the same order rather than inventing one.
 */
export async function lockCredential(tx: Tx, appUserId: string): Promise<UserCredentialRow | undefined> {
  const res = await tx.query(
    `SELECT ${CREDENTIAL_COLUMNS} FROM user_credential c WHERE c.app_user_id = $1 FOR UPDATE OF c`,
    [appUserId]
  );
  return res.rows[0] as UserCredentialRow | undefined;
}
