// The operator PIN: setting one, and verifying one under the lockout anchor.
//
// **A PIN is a knowledge factor on a POSSESSION-BOUND CHANNEL** (048 §3.5). It is
// indefensible as a primary web credential and entirely defensible here, because
// the attacker must first hold an enrolled device with a live device session —
// a physical object behind a shop counter. Three controls make that argument
// hold, and they are obligations rather than assumptions:
//
//   1. argon2id **plus a process-environment pepper** (§9.2) — without the
//      pepper, a stolen `pg_dump` turns a million-entry keyspace into an offline
//      sweep, and "possession-bound" evaporates because a dump is not a phone;
//   2. the lockout is a **fact** and not an in-memory counter (§9.1), so it
//      survives a restart and is not per worker;
//   3. a PIN authenticates NOTHING but an operator session — it cannot sign in
//      on another device and cannot reach a privileged surface (§4.1).
//
// **The insider residual, stated rather than mitigated (048 R7).** A coworker who
// watches a PIN being entered on a shared counter phone can, from that moment,
// act as that person on that phone; the system will record the act as theirs and
// cannot distinguish it from the real thing. No control here prevents that and
// none is proposed. The RULE that follows binds every artifact this project
// produces: **no artifact, dissent, 021 registered claim, pilot-charter clause,
// partner-facing sentence or support answer may describe operator attribution in
// this system as non-repudiable, as tamper-proof, or as proof of who performed an
// act.** It is an attribution of record, and it is exactly as strong as the PIN,
// which is exactly as strong as who was watching.
import type { Queryable, Tx } from "../../db.js";
import {
  DEVICE_FREE_ATTEMPTS,
  LOCKOUT_WINDOW_MS,
  PAIR_FREE_ATTEMPTS,
  lockoutWaitMs,
  pinRefusal,
  type PinRefusal,
} from "./policy.js";
import { hashPin, verifyPin } from "./secrets.js";

export interface OperatorPinRow {
  id: string;
  shop_id: string;
  device_id: string;
  app_user_id: string;
  pin_hash: string;
  pepper_version: number;
  /**
   * `020`'s column. **Nothing writes it after E03-D07** — a retirement is an
   * `operator_pin_retirement` row — and it is still READ, so a row written by
   * the old mechanism before `024` is still honoured. See `retired` below.
   */
  retired_at: Date | null;
  /** The version of this row a retirement fact names (E03-D07). */
  updated_at: Date;
  /** `EXISTS` a retirement naming this row's current `updated_at`. */
  retired_by_fact: boolean;
  /**
   * **Retirement, as a PREDICATE over two facts** (048 §3.5, E03-D07).
   *
   * Either mechanism retires the PIN: a retirement row naming this row's current
   * version, or a non-null `retired_at` left by the pre-`024` `UPDATE`. It is
   * computed here, once, so no caller can read one half and miss the other —
   * which is the failure mode of replacing a column with a table.
   */
  retired: boolean;
}

/**
 * The projection every read of this row uses, and the retirement predicate spelled
 * ONCE. 042 I5(b) requires every projection to name its columns, and without
 * this constant the retirement predicate would be spelled twice — in the plain
 * read and in the anchor read — which is how two readers of one rule start
 * disagreeing.
 */
const PIN_COLUMNS = `p.id, p.shop_id, p.device_id, p.app_user_id, p.pin_hash, p.pepper_version,
       p.retired_at, p.updated_at,
       EXISTS (SELECT 1 FROM operator_pin_retirement r
                WHERE r.operator_pin_id = p.id
                  AND r.retired_pin_updated_at = p.updated_at) AS retired_by_fact`;

function hydrate(row: RawPinRow | undefined): OperatorPinRow | undefined {
  if (!row) return undefined;
  return { ...row, retired: row.retired_by_fact || row.retired_at !== null };
}

type RawPinRow = Omit<OperatorPinRow, "retired">;

/**
 * A decoy digest, verified when no PIN row exists for the pair, so an unknown
 * pair costs the same as a wrong PIN.
 *
 * 048 §9.3: "the same work is done in each case so the timing does not
 * distinguish them". Without this, an unknown `(device, person)` pair returns in
 * microseconds and a wrong PIN returns in argon2id time — which is a query
 * interface over who has a PIN on which phone, answered with a stopwatch.
 *
 * It is a hash of a value that is not a PIN and cannot be one (`pinRefusal`
 * refuses anything that is not six digits), so nothing can ever verify against it.
 */
let decoyDigest: string | undefined;
async function decoy(pepper: string): Promise<string> {
  decoyDigest ??= await hashPin("this-is-not-a-pin", pepper);
  return decoyDigest;
}

export async function readOperatorPin(
  db: Queryable,
  deviceId: string,
  appUserId: string
): Promise<OperatorPinRow | undefined> {
  const res = await db.query(
    `SELECT ${PIN_COLUMNS} FROM operator_pin p WHERE p.device_id = $1 AND p.app_user_id = $2`,
    [deviceId, appUserId]
  );
  return hydrate(res.rows[0] as RawPinRow | undefined);
}

/**
 * Set or replace a PIN.
 *
 * The denylist is enforced at SET time and never at verify time (048 §3.5): a
 * verify-time check leaks which PINs are impossible. `shopDigits` carries the
 * digits the shop itself publishes — its postcode, its phone number — which
 * anybody who can read the door can guess.
 */
export async function setOperatorPin(
  tx: Tx,
  args: {
    shopId: string;
    deviceId: string;
    appUserId: string;
    pin: string;
    pepper: string;
    shopDigits?: readonly string[];
  }
): Promise<{ ok: true } | { ok: false; refusal: PinRefusal }> {
  const refusal = pinRefusal(args.pin, args.shopDigits ?? []);
  if (refusal) return { ok: false, refusal };
  const hash = await hashPin(args.pin, args.pepper);
  await tx.query(
    `INSERT INTO operator_pin (shop_id, device_id, app_user_id, pin_hash)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (device_id, app_user_id)
     DO UPDATE SET pin_hash = EXCLUDED.pin_hash, retired_at = NULL, updated_at = now()`,
    [args.shopId, args.deviceId, args.appUserId, hash]
  );
  return { ok: true };
}

/**
 * **048 §3.5's retirement, as an append-only FACT** (E03-D07).
 *
 * A membership revocation retires that person's PIN rows at that scope, in the
 * same transaction as §3.4's rotation. Otherwise a fired employee's PIN sits
 * live on the counter phone against a membership that no longer exists, and the
 * only thing between it and an operator session is a membership check somebody
 * has to remember to write.
 *
 * **It is an INSERT and never an UPDATE**, and that is a change of mechanism
 * from `020`'s `retired_at` column with three reasons, each sufficient:
 *
 *   1. every other ending in this schema is a row — `membership_revocation`,
 *     `device_credential_revocation`, `app_session_revocation` — each with its
 *     own UNIQUE, and 047 §5.1's no-status-column rule is what they all express;
 *   2. `operator_pin` is **the lockout anchor** (048 §9.1). An `UPDATE`
 *     retirement writes the security-critical row from a path that is not a PIN
 *     verification, next to a `FOR UPDATE` sequence whose correctness argument
 *     assumes the row's only writer is a PIN change;
 *   3. an `UPDATE` keeps no record of WHEN or WHY, and "why was this PIN taken
 *     away" is precisely what a support conversation and 019 T35(c)'s
 *     reconciliation ask.
 *
 * **The rows are locked before they are read** (`FOR UPDATE`), for the same
 * reason `verifyOperatorPin` locks: `updated_at` is the version this retirement
 * names, and a PIN change committing between the read and the INSERT would
 * produce a retirement naming a version that no longer exists — a retirement
 * that retires nothing. Holding the anchor makes the two serial.
 *
 * `ON CONFLICT DO NOTHING` on `(operator_pin_id, retired_pin_updated_at)`: two
 * revocations of two overlapping memberships retire the same PIN version once.
 * That is the idempotence a status column cannot give — and the return value is
 * the number of rows this call actually WROTE, so a caller can tell "already
 * retired" from "retired now".
 */
export async function retireOperatorPins(
  tx: Tx,
  args: { appUserId: string; shopId: string; reason: string; membershipRevocationId?: string | null }
): Promise<number> {
  // The lock, taken first and on its own. It is what makes the `updated_at` the
  // INSERT below reads the same version this call decided to retire.
  await tx.query(`SELECT p.id FROM operator_pin p WHERE p.app_user_id = $1 AND p.shop_id = $2 FOR UPDATE`, [
    args.appUserId,
    args.shopId,
  ]);

  // **`updated_at` NEVER LEAVES POSTGRES, and that is not a style preference.**
  // `timestamptz` is microsecond-precision and a JavaScript `Date` is
  // millisecond-precision, so reading the column into the application and passing
  // it back as a parameter TRUNCATES it — the retirement would then name a
  // version that does not exist, `retired_pin_updated_at = p.updated_at` would be
  // false, and the PIN would read live with a retirement row sitting next to it.
  // Reproduced on postgres:16 while building this bead. So the value is carried
  // by an `INSERT … SELECT` and the round trip never happens.
  const res = await tx.query(
    `INSERT INTO operator_pin_retirement
       (shop_id, operator_pin_id, retired_pin_updated_at, membership_revocation_id, reason)
     SELECT p.shop_id, p.id, p.updated_at, $3, $4
       FROM operator_pin p
      WHERE p.app_user_id = $1 AND p.shop_id = $2
     ON CONFLICT (operator_pin_id, retired_pin_updated_at) DO NOTHING`,
    [args.appUserId, args.shopId, args.membershipRevocationId ?? null, args.reason]
  );
  return (res as { rowCount?: number }).rowCount ?? 0;
}

export type PinVerdict =
  { ok: true; row: OperatorPinRow } | { ok: false; reason: "wait" | "no_pin" | "wrong_pin" | "retired" };

/**
 * **Count and verify are ONE transaction, under ONE lock** (048 §9.1, R5).
 *
 * "Derive the lockout, then verify" is a read-then-write across a security
 * boundary, and it is the write-skew shape 041 §4.2 and §4.3 already named: N
 * concurrent attempts all read a count below the threshold, all proceed, and the
 * effective budget is N times the intended one. So the sequence takes
 * `SELECT … FOR UPDATE` on the `operator_pin` row for that `(device, person)`
 * pair BEFORE counting, and holds it through the verification and the failure
 * INSERT — **every reader of the count is a writer of the row the count is
 * about**, which is 041 §4.2's anchor pattern with `operator_pin` as the anchor.
 *
 * The window count reads `now()`, and 048 §9.1 declares that **the third
 * sanctioned exception** under 041 §2.6 (after 040 §3.4's `abandoned` predicate
 * and 041 §5.3's `session_seq`): "how many times has this pair failed in the last
 * interval" is a statement about now in exactly `abandoned`'s sense, not
 * replayable and not meant to be.
 *
 * **A blocked attempt records NO new failure**, and that is deliberate: the
 * refusal happens before the PIN is looked at, so there is no credential test to
 * record, and recording one would let a griefer ratchet the delay by hammering.
 * The delay grows with real failures only, is capped, and 048 R5's property holds
 * exactly — there is no state from which a correct PIN is refused, only a state
 * in which it is refused *until*.
 *
 * **A PIN is never compared across scopes** (048 §3.5): this function takes ONE
 * `(device_id, app_user_id)` pair and refuses any other. It does not try the
 * person's other PINs and does not fall back to another device's row — a
 * credential that is worthless off one device stops being worthless the moment
 * one code path compares it somewhere else.
 */
export async function verifyOperatorPin(
  tx: Tx,
  args: { shopId: string; deviceId: string; appUserId: string; pin: string; pepper: string; now: Date }
): Promise<PinVerdict> {
  // The anchor. `FOR UPDATE` rather than `FOR NO KEY UPDATE`: this row is the
  // subject of the count, nothing references it by foreign key, and the stronger
  // lock is the one 041 §4.2 specifies for an anchor.
  const anchor = await tx.query(
    `SELECT ${PIN_COLUMNS}
       FROM operator_pin p WHERE p.device_id = $1 AND p.app_user_id = $2
       FOR UPDATE OF p`,
    [args.deviceId, args.appUserId]
  );
  const row = hydrate(anchor.rows[0] as RawPinRow | undefined);

  const wait = await lockoutWait(tx, args.deviceId, args.appUserId, args.now);
  if (wait > 0) return { ok: false, reason: "wait" };

  // The same work in every case (§9.3). An unknown pair and a retired PIN both
  // verify the decoy, so neither returns faster than a wrong PIN does.
  const digest = row && !row.retired ? row.pin_hash : await decoy(args.pepper);
  const matched = await verifyPin(args.pin, args.pepper, digest);

  if (!row) {
    await recordFailure(tx, {
      shopId: args.shopId,
      deviceId: args.deviceId,
      appUserId: args.appUserId,
      method: "operator_pin",
      failureClass: "no_pin_for_pair",
    });
    return { ok: false, reason: "no_pin" };
  }
  if (row.retired) {
    await recordFailure(tx, {
      shopId: args.shopId,
      deviceId: args.deviceId,
      appUserId: args.appUserId,
      method: "operator_pin",
      failureClass: "pin_retired",
    });
    return { ok: false, reason: "retired" };
  }
  if (!matched) {
    await recordFailure(tx, {
      shopId: args.shopId,
      deviceId: args.deviceId,
      appUserId: args.appUserId,
      method: "operator_pin",
      failureClass: "wrong_pin",
    });
    return { ok: false, reason: "wrong_pin" };
  }
  return { ok: true, row };
}

/**
 * The two classes together (048 §9.1): the per-pair delay, and the per-device
 * ceiling that bounds a roster walk.
 *
 * Counted from `auth_attempt` — a FACT, so it survives a restart and is not per
 * worker, which is the whole of the argument against E5/046 E25's in-memory
 * `Map`s. Exposed so a caller can ask "how long" without attempting.
 */
export async function lockoutWait(
  db: Queryable,
  deviceId: string,
  appUserId: string,
  now: Date
): Promise<number> {
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
  const res = await db.query(
    `SELECT
       count(*) FILTER (WHERE app_user_id = $2)::int AS pair_failures,
       extract(epoch from (now() - max(created_at) FILTER (WHERE app_user_id = $2))) AS pair_age,
       count(*)::int AS device_failures,
       extract(epoch from (now() - max(created_at))) AS device_age
     FROM auth_attempt
     WHERE device_id = $1 AND created_at >= $3 AND method = 'operator_pin'`,
    [deviceId, appUserId, since]
  );
  const r = res.rows[0] as {
    pair_failures: number;
    pair_age: string | null;
    device_failures: number;
    device_age: string | null;
  };
  return lockoutWaitMs({
    pairFailures: r.pair_failures,
    pairLastFailureAgeMs: r.pair_age === null ? Number.POSITIVE_INFINITY : Number(r.pair_age) * 1000,
    deviceFailures: r.device_failures,
    deviceLastFailureAgeMs: r.device_age === null ? Number.POSITIVE_INFINITY : Number(r.device_age) * 1000,
  });
}

/** The free budgets, re-exported so a caller need not import two modules to explain a wait. */
export const FREE_ATTEMPTS = { pair: PAIR_FREE_ATTEMPTS, device: DEVICE_FREE_ATTEMPTS } as const;

export type AuthMethod =
  | "operator_pin"
  | "device_credential"
  | "session_token"
  | "password"
  | "totp"
  | "invitation"
  | "enrollment_code";

/**
 * One failure, appended.
 *
 * **FAILURES ONLY** (048 §9.1, R16). A success row here would be a second,
 * redundant record of an event `app_session` already holds, differing only in
 * being a per-operator log of when each person signed in — the surface 022 P3
 * forbids, built to serve a reconciliation (T35(c)) that derives from
 * `app_session` and does not need it.
 */
export async function recordFailure(
  tx: Tx,
  args: {
    shopId?: string | null;
    deviceId?: string | null;
    appUserId?: string | null;
    method?: AuthMethod;
    failureClass: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO auth_attempt (shop_id, device_id, app_user_id, method, failure_class)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      args.shopId ?? null,
      args.deviceId ?? null,
      args.appUserId ?? null,
      args.method ?? "operator_pin",
      args.failureClass,
    ]
  );
}
