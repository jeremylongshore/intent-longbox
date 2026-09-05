// The SECOND FACTOR: enrolling one, verifying one under an anchor lock, and
// ending one.
//
// ============================================================================
// WHAT THIS MODULE IS FOR, AND WHAT IT DELIBERATELY DOES NOT REACH (E03-D06)
// ============================================================================
//
// 048 §4.1 requires TOTP of `owner`, `manager` and `support_break_glass`, and
// places it in "a session established by password + TOTP within a freshness
// window". **That session does not exist in this tree, and this bead did not
// invent it.** 048 §3.1 models exactly two sessions — a device session and an
// operator session on top of it — and both are bound to an enrolled phone by
// `app_session`'s own CHECK and its two composite foreign keys (`migrations/020`).
// A person signing in on their own laptop has no row shape here, and the FIRST
// factor (`user_credential`, M3's other remainder) is assigned to no bead by 048
// §10.2 at all.
//
// So the split this module takes is the honest one: **the factor, its custody, its
// replay guard and its recovery land here; the session that carries them is named
// work with its own record** (048 §12.4 row 3a, added by this bead). The
// consequence is visible and deliberate — there is NO route in `src/routes/`
// reaching any function below, and the two `pending: true` rows on the auth
// allowlist stay pending. That follows the precedent E03-D07 set one bead earlier:
// *"a route that called itself privileged while nothing enforced privilege would be
// a worse artifact than an honest CLI"*. The CLI is `pnpm enroll-authenticator`.
//
// ============================================================================
// THE ANCHOR: MIRRORED FROM 048 §9.1, NOT EXTENDED (a ruling this bead had to make)
// ============================================================================
//
// 048 §9.1 fixes the lockout's shape — count and verify in ONE transaction under
// `SELECT … FOR UPDATE` on an anchor row, "because every reader of the count is a
// writer of the row it is a count about" — and names `operator_pin` as the anchor
// for a PIN. A TOTP verification cannot extend that anchor: an `operator_pin` row
// is keyed on `(device_id, app_user_id)` and a TOTP verification has no device, so
// there is no pair to lock and locking "the person's PIN rows" would serialise a
// second factor behind an unrelated credential on an unrelated phone.
//
// **So the construction is MIRRORED with `user_authenticator` as the anchor**, and
// it is the same row 048 R19's conditional UPDATE writes — which is what makes the
// mirror exact rather than merely similar: the row the count is about is the row
// the verification writes. The window is per `app_user_id` (§9.1's own key "for a
// password"), the count reads `now()` under §9.1's third sanctioned clock
// exception, and a blocked attempt records NO failure, for the reason the blocked
// PIN records none — the refusal happens before a credential is tested, and
// recording one would let a flooder ratchet the delay.
//
// **The TOTP and recovery-code windows are ONE budget, not two.** They are two
// forms of the same factor, so separate budgets would hand an attacker double the
// attempts for the price of alternating.
//
// ============================================================================
// AND ONE RULING FOR THE BEAD THAT LANDS THE ROUTE (042 §5.1, at v1.4.2)
// ============================================================================
//
// A TOTP verification **qualifies for the authentication-act exemption**, so the
// route that eventually reaches `verifyTotp` takes the `Idempotency-Key` header
// and does NOT take a `request_idempotency` row. Clause (a) holds — the only row
// a failed verification writes is `auth_attempt`, and a failed act mints no
// credential — and clause **(b1)** holds outright: the act's entire externally
// visible effect is a `Set-Cookie`, it hands back no shown-once secret, and it
// therefore owes no named UNIQUE. It has one anyway, and it is worth naming:
// R19's conditional UPDATE on `user_authenticator (last_used_step)` makes the act
// exactly-once at the database. **What is NOT done here is the enumeration** —
// 042 v1.4.2 lists the class's members by name, and a member cannot be listed
// before its route exists, so the PR that registers the route adds the row.
import { randomUUID } from "node:crypto";
import type { Queryable, Tx } from "../../db.js";
import type { AuthenticatorKeyring, SealedSecret } from "./aead.js";
import { decoySecret, open, seal } from "./aead.js";
import { liveRolesOf, type Role } from "./memberships.js";
import { recordFailure } from "./pin.js";
import { LOCKOUT_WINDOW_MS, secondFactorWaitMs } from "./policy.js";
import { hashRecoveryCode } from "./secrets.js";
import { mintRecoveryCode } from "./codes.js";
import { TOTP_DIGITS, TOTP_PERIOD_SECONDS, verifyTotpCode } from "./totp.js";

/** 048 §4.1's three. `operator` is exempt and is never enrolled here. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ["owner", "manager", "support_break_glass"];

/**
 * How many recovery codes a set holds (048 §8.1).
 *
 * A PROVISIONAL floor (042 A3) with its derivation stated and no measurement
 * behind it: enough that an owner who uses one — which forces re-enrollment and a
 * fresh set — is not on their last, and few enough that verifying a WRONG code,
 * which tries the live codes in turn, costs eight argon2id runs rather than forty.
 * It is never quoted as a security property.
 */
export const RECOVERY_CODE_COUNT = 8;

export interface AuthenticatorRow {
  id: string;
  app_user_id: string;
  kind: string;
  secret_ciphertext: Buffer;
  secret_nonce: Buffer;
  key_version: number;
  digits: number;
  period_seconds: number;
  algorithm: string;
  /** `bigint` arrives from `pg` as a string; the caller compares numerically. */
  last_used_step: string | null;
  enrolled_at: Date;
}

/**
 * The projection every read of this row uses — 042 I5(b) requires every projection
 * to name its columns, and one spelled once cannot disagree with itself.
 *
 * ⚠ It names `secret_ciphertext` and `secret_nonce`, which is the one place in
 * this system a projection deliberately carries credential material: they are the
 * inputs to `open()` and they never leave this module in any other direction. No
 * response DTO declares them, nothing logs them, and the plaintext they produce is
 * held for the length of one comparison.
 */
const AUTHENTICATOR_COLUMNS = `a.id, a.app_user_id, a.kind, a.secret_ciphertext, a.secret_nonce,
       a.key_version, a.digits, a.period_seconds, a.algorithm, a.last_used_step, a.enrolled_at`;

/** Live: the newest authenticator for this person that no retirement fact names. */
const LIVE_PREDICATE = `a.app_user_id = $1
     AND NOT EXISTS (SELECT 1 FROM user_authenticator_retirement r
                      WHERE r.authenticator_id = a.id)
   ORDER BY a.enrolled_at DESC, a.id DESC
   LIMIT 1`;

export async function liveAuthenticator(
  db: Queryable,
  appUserId: string
): Promise<AuthenticatorRow | undefined> {
  const res = await db.query(
    `SELECT ${AUTHENTICATOR_COLUMNS} FROM user_authenticator a WHERE ${LIVE_PREDICATE}`,
    [appUserId]
  );
  return res.rows[0] as AuthenticatorRow | undefined;
}

/**
 * The anchor, taken `FOR UPDATE` and held for the rest of the transaction.
 *
 * `FOR UPDATE` and not `FOR NO KEY UPDATE`, matching `verifyOperatorPin`: this row
 * is the subject of the count, and the retirement table's foreign key to it is
 * written by a path that must serialise against a verification anyway (a recovery
 * redemption retires the authenticator it just substituted for).
 */
export async function lockLiveAuthenticator(
  tx: Tx,
  appUserId: string
): Promise<AuthenticatorRow | undefined> {
  const res = await tx.query(
    `SELECT ${AUTHENTICATOR_COLUMNS} FROM user_authenticator a WHERE ${LIVE_PREDICATE} FOR UPDATE OF a`,
    [appUserId]
  );
  return res.rows[0] as AuthenticatorRow | undefined;
}

/**
 * 048 §8.1's forced re-enrollment, as a PREDICATE over facts rather than a flag.
 *
 * `must_reenroll` is "this person had a second factor, used a recovery code, and
 * has not enrolled a new one" — which is exactly "no live authenticator, and a
 * recovery-code use exists". There is no column to set, nothing to leave stale, and
 * the state cannot be escaped by anything except an enrollment. The route-level
 * half of §8.1 — that such a session "can reach NOTHING else until it has" — lands
 * with the session that carries it.
 */
export async function mfaState(
  db: Queryable,
  appUserId: string
): Promise<"unenrolled" | "enrolled" | "must_reenroll"> {
  const live = await liveAuthenticator(db, appUserId);
  if (live) return "enrolled";
  const used = await db.query(`SELECT 1 FROM recovery_code_use u WHERE u.app_user_id = $1 LIMIT 1`, [
    appUserId,
  ]);
  return used.rows.length > 0 ? "must_reenroll" : "unenrolled";
}

export type EnrollmentRefusal = "role_not_privileged" | "code_did_not_verify";

export interface EnrolledAuthenticator {
  authenticatorId: string;
  /** Shown ONCE, stored only as argon2id digests, and never recoverable. */
  recoveryCodes: readonly string[];
}

/**
 * Enrol a confirmed authenticator, and issue the recovery set in the same
 * transaction.
 *
 * **A secret that is never confirmed never becomes a row** (048 §4.3). The caller
 * mints the secret, shows it, and hands it back here WITH a code generated from it;
 * if the code does not verify, nothing is written and the secret dies with the
 * process. That is why this function takes the secret rather than minting it: an
 * enrollment that stored first and confirmed later would need somewhere to keep an
 * unconfirmed secret, and the only honest place for a secret nobody has proved they
 * hold is memory.
 *
 * **The role is checked here and not by the caller** (048 §4.1). `operator` is
 * exempt from MFA by decision, not by omission — "requiring a phone-based second
 * factor from a person standing at a shared phone is a ceremony that produces a
 * shared authenticator, which is worse than no second factor because it looks like
 * one" — so enrolling one would build exactly the thing the record refuses.
 *
 * **Enrollment RETIRES the previous authenticator and SUPERSEDES the previous
 * recovery set**, both by appending rather than editing: a `replaced` retirement
 * fact, and a new `batch_id` that makes every code in the old batch non-live by
 * predicate. 048 §8.1: "codes that survive a re-enrollment are codes that survive
 * whatever caused it".
 */
export async function enrollAuthenticator(
  tx: Tx,
  args: {
    appUserId: string;
    secret: Buffer;
    confirmationCode: string;
    keyring: AuthenticatorKeyring;
    pepper: string;
    now: Date;
    enrolledBy?: string | null;
  }
): Promise<{ ok: true; enrolled: EnrolledAuthenticator } | { ok: false; refusal: EnrollmentRefusal }> {
  const roles = await liveRolesOf(tx, args.appUserId);
  if (!roles.some((role) => MFA_REQUIRED_ROLES.includes(role))) {
    return { ok: false, refusal: "role_not_privileged" };
  }

  const step = verifyTotpCode({ secret: args.secret, code: args.confirmationCode, now: args.now });
  if (step === undefined) return { ok: false, refusal: "code_did_not_verify" };

  // The previous factor ends here, in the same transaction as the new one begins,
  // so there is never a moment with two live authenticators for one person — which
  // would make "the newest live one" a tie and the replay guard a per-row property
  // of whichever row the ORDER BY happened to pick.
  const previous = await lockLiveAuthenticator(tx, args.appUserId);
  if (previous) {
    await retireAuthenticator(tx, {
      authenticatorId: previous.id,
      appUserId: args.appUserId,
      reason: "replaced",
      retiredBy: args.enrolledBy ?? args.appUserId,
    });
  }

  // THE ID IS MINTED HERE BECAUSE IT IS THE AAD (048 R18). The ciphertext is bound
  // to the row it will sit in, so a ciphertext moved between rows fails to
  // authenticate instead of decrypting to a working secret — which is the only
  // property that distinguishes AEAD-with-AAD from AEAD-without.
  const id = randomUUID();
  const sealed = seal(args.keyring, args.secret, id);
  await tx.query(
    `INSERT INTO user_authenticator
       (id, app_user_id, kind, secret_ciphertext, secret_nonce, key_version,
        digits, period_seconds, algorithm, last_used_step, enrolled_at)
     VALUES ($1,$2,'totp',$3,$4,$5,$6,$7,'SHA1',$8,$9)`,
    [
      id,
      args.appUserId,
      sealed.ciphertext,
      sealed.nonce,
      sealed.keyVersion,
      TOTP_DIGITS,
      TOTP_PERIOD_SECONDS,
      // The confirming code is SPENT by the enrollment. Without this, the code the
      // owner just read off their phone is still valid for its remaining seconds
      // against a verification, which is the replay 048 R19 exists to refuse — and
      // it would be replayable by whoever was standing behind them.
      step,
      args.now,
    ]
  );

  const recoveryCodes = await issueRecoveryCodes(tx, {
    appUserId: args.appUserId,
    pepper: args.pepper,
  });
  return { ok: true, enrolled: { authenticatorId: id, recoveryCodes } };
}

/**
 * A fresh recovery set. The codes are returned ONCE and stored only as digests.
 *
 * The `batch_id` is what supersedes the previous set: liveness is "newest batch,
 * no use row", so issuing this row makes every earlier code non-live without
 * touching one of them.
 */
export async function issueRecoveryCodes(
  tx: Tx,
  args: { appUserId: string; pepper: string; count?: number }
): Promise<readonly string[]> {
  const batchId = randomUUID();
  const codes: string[] = [];
  for (let i = 0; i < (args.count ?? RECOVERY_CODE_COUNT); i += 1) codes.push(mintRecoveryCode());
  for (const code of codes) {
    await tx.query(`INSERT INTO recovery_code (app_user_id, batch_id, code_hash) VALUES ($1,$2,$3)`, [
      args.appUserId,
      batchId,
      await hashRecoveryCode(code, args.pepper),
    ]);
  }
  return codes;
}

/** The endings this schema has. A CLOSED set, matching the migration's CHECK. */
export type RetirementReason =
  "replaced" | "recovery_code_used" | "lost_authenticator" | "offboarding" | "compromise_suspected";

/**
 * End an authenticator. An INSERT, never an UPDATE.
 *
 * `ON CONFLICT DO NOTHING` on the one-ending index, so two paths that both decide
 * to retire the same factor — a recovery redemption and an enrollment racing, say —
 * produce one ending rather than a unique violation nobody planned for. The return
 * is the number of rows actually written, so a caller can tell "already retired"
 * from "retired now".
 */
export async function retireAuthenticator(
  tx: Tx,
  args: {
    authenticatorId: string;
    appUserId: string;
    reason: RetirementReason;
    retiredBy?: string | null;
  }
): Promise<number> {
  const res = await tx.query(
    `INSERT INTO user_authenticator_retirement (app_user_id, authenticator_id, reason, retired_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (authenticator_id) DO NOTHING`,
    [args.appUserId, args.authenticatorId, args.reason, args.retiredBy ?? null]
  );
  return (res as { rowCount?: number }).rowCount ?? 0;
}

export type TotpVerdict =
  | { ok: true; step: number }
  | { ok: false; reason: "wait" | "no_authenticator" | "wrong_code" | "replayed" | "unreadable" };

/**
 * Verify a TOTP code, consume its step, and record a failure if it is not one.
 *
 * **The transaction MUST commit whatever the verdict** — the caller's obligation,
 * as it is for `verifyOperatorPin`: the `auth_attempt` row this function appends is
 * what the delay is derived from, so throwing from inside the transaction would
 * roll the failure back and hand an attacker an unlimited budget through the very
 * mechanism designed to bound it.
 *
 * The order is the whole function:
 *
 *   1. **the anchor** — `FOR UPDATE` on the live authenticator, before anything is
 *      counted, so N concurrent attempts consume N budget rather than one;
 *   2. **the window count**, refused before any cryptography (§9.1, R5): a blocked
 *      attempt tests no credential, so it records no failure;
 *   3. **the same work in every case** (§9.3) — a person with no authenticator
 *      decrypts a decoy and evaluates the same three candidate steps, so "does this
 *      person have a second factor" is not answerable with a stopwatch;
 *   4. **the conditional UPDATE, whose affected-row count IS the authorization**
 *      (R19). Zero rows means another transaction already consumed this step, and
 *      the answer is a refusal rather than a retry.
 */
export async function verifyTotp(
  tx: Tx,
  args: { appUserId: string; code: string; keyring: AuthenticatorKeyring; now: Date }
): Promise<TotpVerdict> {
  const row = await lockLiveAuthenticator(tx, args.appUserId);

  const wait = await secondFactorWait(tx, args.appUserId, args.now);
  if (wait > 0) return { ok: false, reason: "wait" };

  const sealed: SealedSecret & { aad: string } = row
    ? {
        ciphertext: row.secret_ciphertext,
        nonce: row.secret_nonce,
        keyVersion: row.key_version,
        aad: row.id,
      }
    : decoySecret(args.keyring);

  let secret: Buffer;
  try {
    secret = open(args.keyring, sealed);
  } catch {
    // A row this process cannot open is an incident, not a verdict — a key removed
    // before its rows were re-encrypted, or a ciphertext that has been moved or
    // edited. The WIRE learns nothing that distinguishes it from a wrong code
    // (§9.3); the failure class is kept where only the lockout and an audited
    // break-glass query can read it.
    await recordFailure(tx, {
      appUserId: args.appUserId,
      method: "totp",
      failureClass: "authenticator_unreadable",
    });
    return { ok: false, reason: "unreadable" };
  }

  const step = verifyTotpCode({
    secret,
    code: args.code,
    now: args.now,
    digits: row?.digits ?? TOTP_DIGITS,
    period: row?.period_seconds ?? TOTP_PERIOD_SECONDS,
  });

  if (!row) {
    await recordFailure(tx, {
      appUserId: args.appUserId,
      method: "totp",
      failureClass: "no_authenticator",
    });
    return { ok: false, reason: "no_authenticator" };
  }
  if (step === undefined) {
    await recordFailure(tx, { appUserId: args.appUserId, method: "totp", failureClass: "wrong_code" });
    return { ok: false, reason: "wrong_code" };
  }

  // 048 R19, verbatim: "the verification succeeds only if that statement affected
  // exactly one row". The comparison is in SQL and not in TypeScript on purpose —
  // a read-then-write on a replay guard is a race, and this is the write that IS
  // the check.
  const consumed = await tx.query(
    `UPDATE user_authenticator
        SET last_used_step = $2, updated_at = now()
      WHERE id = $1 AND (last_used_step IS NULL OR last_used_step < $2)`,
    [row.id, step]
  );
  if (((consumed as { rowCount?: number }).rowCount ?? 0) !== 1) {
    await recordFailure(tx, {
      appUserId: args.appUserId,
      method: "totp",
      failureClass: "replayed_step",
    });
    return { ok: false, reason: "replayed" };
  }
  return { ok: true, step };
}

/**
 * The wait this person owes before a second-factor attempt is looked at.
 *
 * Counted from `auth_attempt` — a FACT, so it survives a restart and is not per
 * worker. Keyed on `app_user_id` alone (048 §9.1's key "for a password"), across
 * BOTH second-factor methods, because they are two forms of one factor and two
 * budgets would be one budget an attacker doubles by alternating.
 *
 * ⚠ There is no per-device ceiling above it, and the reason is that these attempts
 * have no device: 048 §9.1's device class exists to bound "an attacker holding the
 * phone walks the roster", which is a shared-counter-phone attack on PINs. The
 * class that bounds this one is the per-person delay itself.
 */
export async function secondFactorWait(db: Queryable, appUserId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
  const res = await db.query(
    `SELECT count(*)::int AS failures,
            extract(epoch from (now() - max(created_at))) AS age
       FROM auth_attempt
      WHERE app_user_id = $1 AND created_at >= $2 AND method IN ('totp','recovery_code')`,
    [appUserId, since]
  );
  const r = res.rows[0] as { failures: number; age: string | null };
  return secondFactorWaitMs({
    failures: r.failures,
    lastFailureAgeMs: r.age === null ? Number.POSITIVE_INFINITY : Number(r.age) * 1000,
  });
}
