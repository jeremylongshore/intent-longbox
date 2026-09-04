// The two session chains, in SQL: issuance, the liveness predicate, rotation
// under the request transaction's lock, the cross-chain formula, and revocation.
//
// Every function that WRITES takes a `Tx` (the held connection) as its FIRST
// parameter, per 041 §4.1; the liveness READ takes a `Queryable`, because the
// authentication hook resolves a principal on the pool before any transaction
// exists and the same statement runs inside one when the lock is taken.
import type { Queryable, Tx } from "../../db.js";
import {
  DEVICE_ABSOLUTE_MS,
  DEVICE_IDLE_MS,
  DEVICE_ROTATE_MS,
  OPERATOR_ABSOLUTE_MS,
  OPERATOR_IDLE_MS,
  OPERATOR_ROTATE_MS,
  shouldRotate,
  spentTokenVerdict,
  timingVerdict,
  type LivenessVerdict,
} from "./policy.js";
import { randomUUID } from "node:crypto";
import { mintToken, tokenHash } from "./secrets.js";

export type SessionKind = "device" | "operator";

/**
 * The columns the security model reads. A NAMED list, never a star: a star
 * projection here is a standing commitment to publish every future column of the
 * one table whose contents decide who the caller is (042 I5, and the same
 * argument `scanSession.ts` makes for its own read model).
 */
const SESSION_COLUMNS = `id, chain_id, kind, shop_id, location_id, device_id, device_credential_id,
  app_user_id, parent_session_id, parent_chain_id, issued_at, rotate_after, idle_expires_at,
  absolute_expires_at`;

export interface SessionRow {
  id: string;
  chain_id: string;
  kind: SessionKind;
  shop_id: string;
  location_id: string;
  device_id: string;
  device_credential_id: string;
  app_user_id: string | null;
  parent_session_id: string | null;
  parent_chain_id: string | null;
  issued_at: Date;
  rotate_after: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
}

/** What one liveness read answers, in one statement. */
interface LivenessRow extends SessionRow {
  chain_revoked: boolean;
  successor_id: string | null;
  successor_app_user_id: string | null;
  successor_device_id: string | null;
  successor_issued_at: Date | null;
}

/**
 * **048 §3.3's predicate, as ONE indexed read plus two indexed probes — constant
 * in rotation depth (R2).**
 *
 *   1. `WHERE s.token_hash = $1` — the `UNIQUE (token_hash)` index.
 *   2. `NOT EXISTS (… app_session_revocation WHERE chain_id = s.chain_id)` — the
 *      `UNIQUE (chain_id)` index on the revocation table. This is what makes
 *      revocation **O(1) instead of O(chain)**: revoking a chain is one row, not
 *      one row per session ever issued in it. (The column is the negation of
 *      the record's `NOT EXISTS` — the same probe, spelled so the caller reads
 *      `chain_revoked` rather than a double negative.)
 *   3. the successor probe — the `UNIQUE (rotated_from)` index that has to exist
 *      anyway.
 *
 * Probe 3 is written as a LEFT JOIN rather than as a second `NOT EXISTS`, and
 * the difference is nil to the planner (the same unique index, the same single
 * probe, `successor_id IS NULL` ≡ `NOT EXISTS`) while the join also carries the
 * successor's BINDING and `issued_at` — which K2's grace-window verdict needs.
 * The alternative was a `NOT EXISTS` followed by a fourth statement to fetch the
 * row it just proved existed.
 *
 * **What is NOT here, deliberately: a walk.** v1.0.0 of 048 expressed liveness as
 * "no successor supersedes it" over `rotated_from`, which is a walk back up the
 * chain on every request — and a phone worked all day is a chain hundreds of rows
 * long. A security check whose cost grows with how long the shift has been is a
 * security check that gets cached, and a cache of liveness is the status column
 * arriving through the side door.
 */
const QUALIFIED_SESSION_COLUMNS = SESSION_COLUMNS.split(",")
  .map((c) => `s.${c.trim()}`)
  .join(", ");

const LIVENESS_SQL = `
  SELECT ${QUALIFIED_SESSION_COLUMNS},
         EXISTS (SELECT 1 FROM app_session_revocation r WHERE r.chain_id = s.chain_id)
           AS chain_revoked,
         n.id AS successor_id,
         n.app_user_id AS successor_app_user_id,
         n.device_id AS successor_device_id,
         n.issued_at AS successor_issued_at
    FROM app_session s
    LEFT JOIN app_session n ON n.rotated_from = s.id
   WHERE s.token_hash = $1`;

async function readLiveness(db: Queryable, hash: string): Promise<LivenessRow | undefined> {
  const res = await db.query(LIVENESS_SQL, [hash]);
  return res.rows[0] as LivenessRow | undefined;
}

/** Why a presented token did not authenticate. Never rendered; see 048 §9.3. */
export type SessionRefusal =
  "unknown_token" | "chain_revoked" | "idle_expired" | "absolutely_expired" | "token_reuse";

export interface SessionResolution {
  /** The row this request is authenticated as — the presented one, or K2's successor. */
  row: SessionRow;
  /**
   * True when the presented token was already spent and this request adopted its
   * successor inside the grace window (048 K2). The caller sets NO cookie: the
   * winner's response already carried it, and the server never holds the token.
   */
  adoptedSuccessor: boolean;
}

/**
 * Resolve one opaque token to a live session, or say why not.
 *
 * The reuse branch is the one worth reading twice. Presenting a token whose row
 * already has a successor is EVIDENCE the cookie was copied — the legitimate
 * client received the successor — but 048 R4 struck the claim that this is a
 * defence: the detector fires only when the legitimate client subsequently
 * rotates, so an attacker who uses a copied cookie BEFORE the victim's next
 * rotation is indistinguishable from the victim. **Idle expiry is the control;
 * this is a second, later signal that the theft happened.** No artifact may
 * describe it as a barrier.
 */
export async function resolveToken(
  db: Queryable,
  token: string,
  now: Date
): Promise<SessionResolution | { refusal: SessionRefusal; row?: SessionRow }> {
  const row = await readLiveness(db, tokenHash(token));
  if (!row) return { refusal: "unknown_token" };
  if (row.chain_revoked) return { refusal: "chain_revoked", row };

  if (row.successor_id !== null) {
    const verdict = spentTokenVerdict({
      successorIssuedAt: row.successor_issued_at!,
      sameDevice: row.successor_device_id === row.device_id,
      sameUser: row.successor_app_user_id === row.app_user_id,
      now,
    });
    if (verdict === "reuse") return { refusal: "token_reuse", row };
    const successor = await readSessionById(db, row.successor_id);
    if (!successor) return { refusal: "token_reuse", row };
    const timing = timingVerdictOf(successor, now);
    if (timing !== "live") return { refusal: refusalOf(timing), row: successor };
    return { row: successor, adoptedSuccessor: true };
  }

  const timing = timingVerdictOf(row, now);
  if (timing !== "live") return { refusal: refusalOf(timing), row };
  return { row, adoptedSuccessor: false };
}

function timingVerdictOf(row: SessionRow, now: Date): LivenessVerdict {
  return timingVerdict(
    {
      issuedAt: row.issued_at,
      rotateAfter: row.rotate_after,
      idleExpiresAt: row.idle_expires_at,
      absoluteExpiresAt: row.absolute_expires_at,
    },
    now
  );
}

function refusalOf(v: LivenessVerdict): SessionRefusal {
  return v === "absolutely_expired" ? "absolutely_expired" : "idle_expired";
}

export async function readSessionById(db: Queryable, id: string): Promise<SessionRow | undefined> {
  const res = await db.query(`SELECT ${SESSION_COLUMNS} FROM app_session WHERE id = $1`, [id]);
  return res.rows[0] as SessionRow | undefined;
}

/**
 * **048 §3.5's cross-chain formula (K4), in one indexed read.**
 *
 *   `live(op) := live(op.row) ∧ live(current-successor-closure of op.parent_session_id)`
 *
 * The parent's NAMED row goes spent at the device chain's next rotation, so
 * checking it directly would kill every operator session on the phone once per
 * rotation period. The closure resolves by `chain_id` instead: the one row in
 * the parent's chain that has no successor. A parent that has ROTATED is still
 * live; a parent whose CHAIN is revoked or expired is not, and every operator
 * session on it dies at the next request with no sweep.
 */
export async function chainHead(db: Queryable, chainId: string): Promise<SessionRow | undefined> {
  const res = await db.query(
    `SELECT ${SESSION_COLUMNS} FROM app_session s
      WHERE s.chain_id = $1
        AND NOT EXISTS (SELECT 1 FROM app_session n WHERE n.rotated_from = s.id)`,
    [chainId]
  );
  return res.rows[0] as SessionRow | undefined;
}

export async function chainIsRevoked(db: Queryable, chainId: string): Promise<boolean> {
  const res = await db.query(`SELECT 1 FROM app_session_revocation WHERE chain_id = $1`, [chainId]);
  return res.rows.length > 0;
}

/** Is the device chain behind an operator session still live? (K4's right conjunct.) */
export async function parentChainIsLive(db: Queryable, parentChainId: string, now: Date): Promise<boolean> {
  if (await chainIsRevoked(db, parentChainId)) return false;
  const head = await chainHead(db, parentChainId);
  if (!head) return false;
  return timingVerdictOf(head, now) === "live";
}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

export interface IssuedSession {
  row: SessionRow;
  /** The only moment this value exists anywhere. It is set as a cookie and dropped. */
  token: string;
  expiresAt: Date;
}

const INSERT_SESSION_SQL = `
  INSERT INTO app_session
    (chain_id, kind, shop_id, location_id, device_id, device_credential_id, app_user_id,
     parent_session_id, parent_chain_id, token_hash, rotated_from,
     rotate_after, idle_expires_at, absolute_expires_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  RETURNING ${SESSION_COLUMNS}`;

interface IssueArgs {
  chainId: string;
  kind: SessionKind;
  shopId: string;
  locationId: string;
  deviceId: string;
  deviceCredentialId: string;
  appUserId: string | null;
  parentSessionId: string | null;
  parentChainId: string | null;
  rotatedFrom: string | null;
  /** Carried unchanged across a rotation: the ceiling belongs to the CHAIN. */
  absoluteExpiresAt: Date;
  now: Date;
}

async function insertSession(tx: Tx, args: IssueArgs): Promise<IssuedSession> {
  const token = mintToken();
  const rotateMs = args.kind === "device" ? DEVICE_ROTATE_MS : OPERATOR_ROTATE_MS;
  const idleMs = args.kind === "device" ? DEVICE_IDLE_MS : OPERATOR_IDLE_MS;
  const now = args.now.getTime();
  const res = await tx.query(INSERT_SESSION_SQL, [
    args.chainId,
    args.kind,
    args.shopId,
    args.locationId,
    args.deviceId,
    args.deviceCredentialId,
    args.appUserId,
    args.parentSessionId,
    args.parentChainId,
    tokenHash(token),
    args.rotatedFrom,
    new Date(now + rotateMs),
    new Date(now + idleMs),
    args.absoluteExpiresAt,
  ]);
  const row = res.rows[0] as SessionRow;
  return { row, token, expiresAt: args.absoluteExpiresAt };
}

/** A phone presents its device credential and gets the long-lived chain's first row. */
export async function issueDeviceSession(
  tx: Tx,
  args: {
    shopId: string;
    locationId: string;
    deviceId: string;
    deviceCredentialId: string;
    now: Date;
  }
): Promise<IssuedSession> {
  return insertSession(tx, {
    chainId: randomUUID(),
    kind: "device",
    shopId: args.shopId,
    locationId: args.locationId,
    deviceId: args.deviceId,
    deviceCredentialId: args.deviceCredentialId,
    appUserId: null,
    parentSessionId: null,
    parentChainId: null,
    rotatedFrom: null,
    absoluteExpiresAt: new Date(args.now.getTime() + DEVICE_ABSOLUTE_MS),
    now: args.now,
  });
}

/**
 * A person taps their name and enters a PIN, and gets a SHORT session on top of
 * the device's.
 *
 * `shop_id` and `location_id` are copied from the parent AT ISSUANCE (048 §3.5):
 * immutable facts about an issuance, not a cache of a mutable elsewhere — the
 * device's enrollment cannot change under a live session, because re-enrolling a
 * device is a new `device_credential` and §7.3's revocation kills the chain. So a
 * parent rotation is harmless to tenancy resolution.
 */
export async function issueOperatorSession(
  tx: Tx,
  args: { parent: SessionRow; appUserId: string; now: Date }
): Promise<IssuedSession> {
  return insertSession(tx, {
    chainId: randomUUID(),
    kind: "operator",
    shopId: args.parent.shop_id,
    locationId: args.parent.location_id,
    deviceId: args.parent.device_id,
    deviceCredentialId: args.parent.device_credential_id,
    appUserId: args.appUserId,
    parentSessionId: args.parent.id,
    parentChainId: args.parent.chain_id,
    rotatedFrom: null,
    absoluteExpiresAt: new Date(args.now.getTime() + OPERATOR_ABSOLUTE_MS),
    now: args.now,
  });
}

// ---------------------------------------------------------------------------
// Rotation, inside the request transaction (048 §3.3(a), R3; 042 §5.3(b), K1)
// ---------------------------------------------------------------------------

/**
 * **The lock, and its position in the declared order.**
 *
 * 042 §5.3(b) fixes one order in every mutating handler with no exceptions: the
 * `request_idempotency` INSERT before the anchor `SELECT … FOR UPDATE`. 048 K1
 * inserts this lock BETWEEN them:
 *
 *   `request_idempotency` INSERT → **`app_session` row (`FOR NO KEY UPDATE`)** →
 *   `scan_session` anchor (`FOR UPDATE`)
 *
 * The position is argued, not assumed. Identity-of-the-request stays first for
 * 042's own reason — a replay must be recognised before it locks any domain
 * state. The session lock comes second because authentication is a precondition
 * of touching the subject at all: a request that is going to be refused for a
 * dead session must not first take a lock on a live session's anchor.
 *
 * **`FOR NO KEY UPDATE` and not `FOR UPDATE`**: the weakest lock that serialises
 * writers against this row while still permitting readers that take no
 * conflicting lock — the same choice 041 §4.2 makes for the `scan_session`
 * anchor, and for the same reason: a plain `FOR UPDATE` would block foreign-key
 * checks referencing the row for no benefit. This row is referenced by
 * `rotated_from` and by `parent_session_id`, so that is not hypothetical here.
 *
 * The lint in `scripts/architectureRules.ts` polices all three positions.
 */
export async function lockSession(tx: Tx, id: string): Promise<SessionRow | undefined> {
  const res = await tx.query(`SELECT ${SESSION_COLUMNS} FROM app_session WHERE id = $1 FOR NO KEY UPDATE`, [
    id,
  ]);
  return res.rows[0] as SessionRow | undefined;
}

/**
 * Take the lock and, if the session is older than its rotation period, re-issue
 * it — in the transaction the caller already opened, so **a request that rolls
 * back issues no successor** and the original token still works (048 I3(viii)).
 *
 * Returns the new token when it rotated, and nothing when it did not.
 */
export async function lockAndRotate(
  tx: Tx,
  session: SessionRow,
  now: Date
): Promise<IssuedSession | undefined> {
  const locked = await lockSession(tx, session.id);
  if (!locked) return undefined;
  if (!shouldRotate(timingOf(locked), now)) return undefined;
  // A concurrent rotation may have won between the read and here; `UNIQUE
  // (rotated_from)` decides it, and the loser's own next request takes K2's
  // grace path rather than an exception the caller has to interpret.
  const already = await tx.query(`SELECT 1 FROM app_session WHERE rotated_from = $1`, [locked.id]);
  if (already.rows.length > 0) return undefined;
  return insertSession(tx, {
    chainId: locked.chain_id,
    kind: locked.kind,
    shopId: locked.shop_id,
    locationId: locked.location_id,
    deviceId: locked.device_id,
    deviceCredentialId: locked.device_credential_id,
    appUserId: locked.app_user_id,
    parentSessionId: locked.parent_session_id,
    parentChainId: locked.parent_chain_id,
    rotatedFrom: locked.id,
    // The ceiling belongs to the CHAIN: rotation refreshes the idle window and
    // never the absolute one, or a phone worked continuously would never expire.
    absoluteExpiresAt: locked.absolute_expires_at,
    now,
  });
}

function timingOf(row: SessionRow) {
  return {
    issuedAt: row.issued_at,
    rotateAfter: row.rotate_after,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

export type RevocationReason =
  "signed_out" | "token_reuse" | "membership_change" | "device_revoked" | "operator_switch";

/**
 * End a chain. Idempotent by constraint: `UNIQUE (chain_id)` means a second
 * revocation of the same chain is a no-op rather than a second row, so a reuse
 * detected twice does not need a read-then-write to stay correct.
 */
export async function revokeChain(
  tx: Tx,
  args: { chainId: string; shopId: string; reason: RevocationReason; revokedBy?: string | null }
): Promise<void> {
  await tx.query(
    `INSERT INTO app_session_revocation (shop_id, chain_id, reason, revoked_by)
     VALUES ($1,$2,$3,$4) ON CONFLICT (chain_id) DO NOTHING`,
    [args.shopId, args.chainId, args.reason, args.revokedBy ?? null]
  );
}

/**
 * **Reuse revokes the OPERATOR chain, never the device chain** (048 §3.3, K2).
 *
 * A false positive that signs out an operator costs one PIN. A false positive
 * that signs out a DEVICE costs an owner in a privileged session, an enrollment
 * code and a walk to the back room — during trading hours, on the shared counter
 * phone, for a race the operator caused by tapping twice. The blast radius of the
 * detector is deliberately smaller than the blast radius of a lost phone.
 *
 * When the reused token is itself a DEVICE token, the record's rule still holds
 * and this is what it means in code, stated because 048 does not spell it: the
 * device chain is left alone and every OPERATOR chain sitting on it is revoked,
 * so the phone keeps its enrollment and whoever is holding it re-enters a PIN.
 */
export async function revokeForReuse(tx: Tx, spent: SessionRow): Promise<void> {
  if (spent.kind === "operator") {
    await revokeChain(tx, { chainId: spent.chain_id, shopId: spent.shop_id, reason: "token_reuse" });
    return;
  }
  const rows = await tx.query(
    `SELECT DISTINCT chain_id, shop_id FROM app_session
      WHERE parent_chain_id = $1 AND kind = 'operator'`,
    [spent.chain_id]
  );
  for (const row of rows.rows as Array<{ chain_id: string; shop_id: string }>) {
    await revokeChain(tx, { chainId: row.chain_id, shopId: row.shop_id, reason: "token_reuse" });
  }
}

/**
 * 048 §3.4 (K3) — a membership write rotates every live session of that person,
 * and takes the lock FIRST.
 *
 * "Same transaction" orders the membership write against the rotation; it orders
 * NEITHER against an in-flight request. So this locks every live session of the
 * affected person — across every shop and both chains — BEFORE the membership
 * row is inserted, **in `chain_id` order**, which makes a deadlock between two
 * concurrent membership writes unconstructible rather than merely rare (the same
 * move 042 §5.3(b) makes for its two locks).
 *
 * The cost is stated rather than buried (048 §12.2): a membership write blocks
 * behind that person's in-flight requests and every request of that person blocks
 * behind a membership write. Both are correct and both are rare — a membership
 * write is a hiring, a firing or a promotion, and the alternative is a fired
 * employee's phone working until its next rotation.
 */
export async function lockLiveSessionsOf(tx: Tx, appUserId: string): Promise<SessionRow[]> {
  const res = await tx.query(
    `SELECT ${SESSION_COLUMNS} FROM app_session s
      WHERE s.app_user_id = $1
        AND NOT EXISTS (SELECT 1 FROM app_session_revocation r WHERE r.chain_id = s.chain_id)
        AND NOT EXISTS (SELECT 1 FROM app_session n WHERE n.rotated_from = s.id)
        AND s.idle_expires_at > now()
        AND s.absolute_expires_at > now()
      ORDER BY s.chain_id
      FOR NO KEY UPDATE`,
    [appUserId]
  );
  return res.rows as SessionRow[];
}

/**
 * Revoke every live chain of a person, in `chain_id` order, under the same lock.
 *
 * 048 §3.4 says ROTATE rather than expire, "so the person keeps working and the
 * new session carries the new scope" — and that is right for a session whose
 * scope survives the change. What this function is for is the case §3.4 sends to
 * the other end: a revocation of the LAST membership at a shop, where the new
 * scope is "no shops", which the client renders as signed out. Rotating to a
 * session that resolves nothing and revoking are the same fact; the second is one
 * row instead of two and cannot leave a token live by accident.
 */
export async function revokeSessionsOf(tx: Tx, appUserId: string): Promise<number> {
  const sessions = await lockLiveSessionsOf(tx, appUserId);
  for (const session of sessions) {
    await revokeChain(tx, {
      chainId: session.chain_id,
      shopId: session.shop_id,
      reason: "membership_change",
    });
  }
  return sessions.length;
}
