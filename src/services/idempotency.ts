// `Idempotency-Key` on every mutating route (042 §5), executed by E02-D08
// against the table `migrations/009` landed.
//
// THE CONSTRAINT DOES THE SERIALISING — THERE IS NO IN-FLIGHT STATE (042 §5.3).
// The obvious design has three states and a status column to hold them. That
// column is not built, and the reason is a ratified rule rather than a
// preference: 041 §4.2(i) prefers a constraint "always… the cheapest correct
// answer, and correct under every isolation level". Applied here:
//
//   1. The handler INSERTs the `request_idempotency` row FIRST, inside
//      `withTransaction`, then does the work, then updates the response fields —
//      one transaction, one commit.
//   2. A concurrent request with the same key BLOCKS on
//      `UNIQUE (shop_id, idempotency_key)`: Postgres holds the second inserter
//      until the first transaction resolves.
//   3. First COMMITS → the second gets a unique violation, re-reads the row in
//      its own transaction, and returns the stored response.
//   4. First ROLLS BACK → the second's insert succeeds and it does the work.
//      Also correct: nothing happened, so nothing should be replayed.
//
// TWO MECHANICAL PRECONDITIONS THE ARGUMENT SILENTLY ASSUMES (A5, A6, both
// REQUIRED, both E02-D04 acceptance lines):
//
//   (a) ONE CONNECTION, HELD FOR THE REQUEST'S LIFETIME (I21). `withTransaction`
//       checks out one `PoolClient` and every statement runs on it. A
//       `pool.query` per statement would scatter the sequence across
//       connections, each in its own implicit transaction: the uncommitted
//       INSERT's lock would be released at the first statement boundary, step 2
//       would not block, and a concurrent request could observe a PARTIALLY
//       WRITTEN row — the in-flight state §5.3 claims does not exist. **"There
//       is no in-flight state" is FALSE if the connection is not held.**
//
//   (b) ONE FIXED LOCK ORDER (I22). The idempotency INSERT is taken BEFORE the
//       anchor `SELECT … FROM scan_session … FOR UPDATE`, in every handler,
//       always — enforced by the lint in `scripts/architectureRules.ts`, which
//       E02-D08 had to WIDEN before it could see this: the handlers moved to
//       `src/services/` and reach both locks through helpers, so the rule as
//       shipped had no markers to read. It now scans both layers, recognises
//       each lock through its helper, and fails on a reversed-order fixture.
//       The order is not arbitrary: the idempotency row is the
//       request's IDENTITY and the session is its SUBJECT, so a replay is
//       recognised before it takes any lock on domain state, and the cheapest
//       rejection path touches no session row at all.
import { createHash } from "node:crypto";
import type pg from "pg";
import { tenantDb, withTransaction, type Queryable, type Tx } from "../db.js";
import { LongboxError } from "../contracts/v1/errors.js";

/** What a handler hands back for the wire, and what a replay stores. */
export interface HandlerResult {
  status: number;
  body: unknown;
}

export interface IdempotentRequest {
  shopId: string;
  idempotencyKey: string;
  /** The route TEMPLATE, never the resolved path (042 §5.2). */
  route: string;
  method: string;
  /** Resolved path parameters, part of the hash (042 §5.4). */
  params: Record<string, string>;
  /**
   * The request body. For multipart (042 §5.5) this is the non-file fields plus
   * the SHA-256 of the file bytes, computed on the stream already being written
   * to disk — no second read, no buffering, and the same digest
   * `scan_photo.content_hash` will want.
   */
  body: unknown;
  /**
   * 048 §3.3(a) / K1 — THE SESSION LOCK, AT ITS DECLARED POSITION.
   *
   * Set by the authentication hook when the request's session is due to rotate.
   * `runIdempotent` runs it immediately after the `request_idempotency` INSERT
   * and before `fn` (which takes the `scan_session` anchor), which is the
   * three-position order 048 K1 inserts into 042 §5.3(b):
   *
   *   `request_idempotency` INSERT → `app_session` (`FOR NO KEY UPDATE`) →
   *   `scan_session` anchor (`FOR UPDATE`)
   *
   * It is NOT part of the request hash: it is a function, and the hash covers
   * (method, route, params, body). A rotation is a fact about the CONNECTION,
   * not about the act, and two retries of one act must still be one act.
   */
  sessionLock?: (tx: Tx) => Promise<void>;
}

/**
 * Canonical JSON: object keys sorted at every depth, no insignificant
 * whitespace. Part of the `v1` contract — changing it changes WHICH RETRIES ARE
 * RECOGNISED, which is why 042 §5.4 makes it a `v2` change rather than an
 * implementation detail.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/**
 * SHA-256 over (method, route template, resolved path params, body).
 *
 * The hash CLASS is pinned the way 041 A5 pins `content_hash`: SHA-256 of exact
 * bytes, **no perceptual or fuzzy comparison, ever**. A hash whose matching rule
 * is negotiable is a hash whose meaning drifts.
 *
 * `Idempotency-Key` and `correlation_id` are deliberately NOT in it — the first
 * IS the key, and the second differs by construction on every retry (042 §5.4).
 */
export function requestHash(req: Pick<IdempotentRequest, "method" | "route" | "params" | "body">): string {
  return createHash("sha256")
    .update(
      canonicalize({ method: req.method.toUpperCase(), route: req.route, params: req.params, body: req.body })
    )
    .digest("hex");
}

export interface StoredResponse {
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

const IDEMPOTENCY_INSERT_SQL = `INSERT INTO request_idempotency (shop_id, idempotency_key, route, request_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`;

/**
 * Step 1 — and it is the FIRST statement inside every mutating transaction.
 *
 * Keeping the SQL literal in this function (rather than passing a table name or
 * building it) is what lets the I22 lint see `INSERT INTO request_idempotency`
 * in a handler's transaction body and order it against the anchor lock.
 */
export async function beginIdempotency(tx: Tx, req: IdempotentRequest, hash: string): Promise<string> {
  const res = await tx.query(IDEMPOTENCY_INSERT_SQL, [req.shopId, req.idempotencyKey, req.route, hash]);
  return (res.rows[0] as { id: string }).id;
}

/**
 * Step 3 — the response fields, in the SAME transaction as the effect.
 *
 * THE BODY IS STORED AS ITS SERIALIZED BYTES, wrapped in a `jsonb` string, and
 * not as a `jsonb` OBJECT. 042 I11 requires a replay to return "a byte-identical
 * response body", and `jsonb` does not preserve key order — it normalises it, so
 * an object round-tripped through the column comes back with its keys in
 * Postgres's order and a client diffing two responses sees a difference nobody
 * made. Storing the exact bytes keeps the guarantee the invariant asks for
 * without a migration: `migrations/009` fixed the column as `jsonb` and a
 * `jsonb` string is still `jsonb`.
 */
export async function completeIdempotency(tx: Tx, id: string, result: HandlerResult): Promise<void> {
  await tx.query(
    `UPDATE request_idempotency SET response_status = $2, response_body = to_jsonb($3::text) WHERE id = $1`,
    [id, result.status, JSON.stringify(result.body ?? null)]
  );
}

export async function readIdempotency(
  db: Queryable,
  shopId: string,
  key: string
): Promise<StoredResponse | undefined> {
  const res = await db.query(
    `SELECT request_hash, response_status, response_body FROM request_idempotency
      WHERE shop_id = $1 AND idempotency_key = $2`,
    [shopId, key]
  );
  return res.rows[0] as StoredResponse | undefined;
}

/** Postgres `unique_violation`, which is how step 3 learns it lost the race. */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "23505";
}

function replayOrRefuse(
  stored: StoredResponse,
  hash: string,
  key: string
): HandlerResult & { replayed: true } {
  if (stored.request_hash !== hash) {
    // 042 §5.4 / §5.1 A9. A client that got 409 STALE_WORLD_VIEW, refreshed and
    // re-submitted with a different `against` is performing a NEW ACT and must
    // mint a NEW key — `against` is inside the body, so the hash moves and the
    // old key is invalidated by construction rather than by a rule someone
    // remembers.
    throw new LongboxError("IDEMPOTENCY_KEY_REUSED", { idempotency_key_prefix: key.slice(0, 8) });
  }
  if (stored.response_status === null) {
    // Unreachable by construction outside the writing transaction (§5.3): a
    // same-key request BLOCKS until the first resolves and then sees either a
    // committed row or no row. Reaching it means (a) was violated — the
    // connection was not held — so the failure is loud rather than a silent
    // duplicate.
    throw new LongboxError("INTERNAL_ERROR");
  }
  return { status: stored.response_status, body: parseStoredBody(stored.response_body), replayed: true };
}

/**
 * The inverse of `completeIdempotency`'s wrapper: the column holds the response's
 * exact bytes as a `jsonb` string, so a replay re-parses them and Fastify
 * re-serialises the same object in the same key order.
 *
 * A row written before this shape existed would come back as an object rather
 * than a string; it is returned as-is rather than rejected, because refusing to
 * replay a legitimately stored response would turn a retry into a duplicate.
 */
function parseStoredBody(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export interface IdempotentOutcome extends HandlerResult {
  replayed: boolean;
}

/**
 * Run `fn` exactly once per (shop, key), inside ONE transaction on ONE held
 * connection, with the idempotency INSERT before any domain lock.
 *
 * The pre-read (`replayIfSettled`) is an OPTIMISATION AND NOT THE GUARANTEE, and
 * the distinction matters: it returns a committed replay without opening a
 * transaction, but two simultaneous first calls both miss it, and what makes THAT
 * correct is the unique constraint below rather than the read.
 *
 * **It is also exported, because a caller that SPENDS before it calls this has
 * already lost.** `runIdempotent` recognises a replay only once the caller has
 * done its non-transactional work — and for `identify` that work is a paid model
 * call. Such a caller runs `replayIfSettled` FIRST and returns; the pre-read here
 * then costs one more cheap SELECT on the paths that did not.
 *
 * `fn` MUST NOT perform a side effect outside the transaction (041 §4.1, I13):
 * no provider call, no Shopify mutation, no file write. That rule is what makes
 * `withTransaction`'s retry on `40001`/`40P01` sound, and the two are one rule.
 */
export async function replayIfSettled(
  pool: Queryable,
  req: IdempotentRequest
): Promise<IdempotentOutcome | undefined> {
  const hash = requestHash(req);
  const stored = await readIdempotency(pool, req.shopId, req.idempotencyKey);
  if (!stored) return undefined;
  // A different body under a used key is a 422 whether the first call has
  // finished or not; a matching body on a COMMITTED row is the replay. A matching
  // body on a row this connection can see with a NULL response can only be a row
  // committed with no response (which §5.3 forbids) — so it falls through to the
  // transaction, where the INSERT blocks or conflicts and the constraint gives
  // the real answer.
  if (stored.request_hash !== hash || stored.response_status !== null) {
    return replayOrRefuse(stored, hash, req.idempotencyKey);
  }
  return undefined;
}

export async function runIdempotent(
  pool: pg.Pool,
  req: IdempotentRequest,
  fn: (tx: Tx) => Promise<HandlerResult>
): Promise<IdempotentOutcome> {
  const hash = requestHash(req);

  // `request_idempotency` carries a `shop_id` and therefore a tenant policy
  // (E03-B04), so the two reads OUTSIDE the transaction below need a context of
  // their own or they would find nothing and turn every replay into a repeat.
  // Both take it from `req.shopId` — the same value the transaction sets, which
  // the hook took from the session (048 §6.1).
  const db = tenantDb(pool, req.shopId);

  const settled = await replayIfSettled(db, req);
  if (settled) return settled;

  try {
    return await withTransaction(
      pool,
      async (tx) => {
        const id = await beginIdempotency(tx, req, hash);
        // 048 K1: the session row is locked and rotated HERE — after the
        // request's identity is established and before `fn` takes any lock on
        // domain state. A request that is going to be refused for a dead session
        // must not first take a lock on a live session's anchor; a request that
        // ROLLS BACK must issue no successor, and this closure rolling back with
        // the rest of the transaction is what makes that true.
        if (req.sessionLock) await req.sessionLock(tx);
        const result = await fn(tx);
        await completeIdempotency(tx, id, result);
        return { ...result, replayed: false };
      },
      // THE TENANT CONTEXT OF EVERY MUTATING REQUEST IN THE SYSTEM (E03-B04).
      // Taken from `req.shopId`, which the caller took from `ctx.shopId`, which
      // the authentication hook took from the SESSION and never from a body or a
      // URL (048 §6.1) — so the value the row-level-security policies read is the
      // value the request was authorized against. Set here rather than in fourteen
      // handlers for 048 R10's reason: a rule enforced by fourteen copies has
      // thirteen places to be forgotten. It travels with `BEGIN`, so it precedes
      // the idempotency INSERT and therefore every lock in 042 §5.3(b)'s order.
      { label: req.route, tenant: { shopId: req.shopId } }
    );
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const stored = await readIdempotency(db, req.shopId, req.idempotencyKey);
    if (!stored) throw err;
    return replayOrRefuse(stored, hash, req.idempotencyKey);
  }
}
