import pg from "pg";

let pool: pg.Pool | undefined;

export function getPool(databaseUrl: string): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

/**
 * Anything that can run a statement. A `pg.Pool` takes a connection per call;
 * a `pg.PoolClient` is one connection held for the request. Read helpers accept
 * either. **Every writing function on a transactional path takes a `Tx` as its
 * FIRST parameter** (041 §4.1) so the handle travels explicitly and a writer can
 * never silently fall back to the pool.
 */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** A connection held for one request's lifetime, inside `withTransaction`. */
export type Tx = pg.PoolClient;

/**
 * Postgres SQLSTATEs that mean "nothing happened; the same work may be retried
 * verbatim". `40001` serialization_failure, `40P01` deadlock_detected. Nothing
 * else is retried — 041 §4.5: "and on nothing else".
 */
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);

export function isRetryablePgError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && RETRYABLE_SQLSTATES.has(code);
}

export interface TransactionOptions {
  /**
   * 041 §4.2: `READ COMMITTED` is the default, with explicit locks (a constraint
   * first, then `SELECT … FOR UPDATE` on the anchor row). `SERIALIZABLE` is
   * opt-in and reserved for a guard with no single anchor row — the purge sweep
   * and the daily reconciliation. §4.2's clause (ii) is signed OPEN, so this
   * option exists to make the choice per-path and visible rather than global.
   */
  isolation?: "read committed" | "serializable";
  /**
   * Names the path in the retry log — `'confirm'`, `'draft'`. Never sent to
   * Postgres. A retry line with no label says a retry happened somewhere, which
   * is not the same fact as which path is contending.
   */
  label?: string;
  /** Sink for the retry lines. Injected so the counting is unit-testable. */
  log?: (message: string) => void;
  /**
   * Attempts, not retries: 3 means one try plus two retries. `tx_max_retries` is
   * a signed OPEN parameter (041 §4.5) — the number here is provisional per
   * 042 A3 and is closed by O-A's measurement, not by this file. What is NOT
   * provisional is that every retry is counted from day one (§4.5's guard).
   */
  maxAttempts?: number;
}

/**
 * Where retry lines go when the caller injects nothing. `console.warn` rather
 * than the Fastify logger because `src/db.ts` owns no request context — E13's
 * observability bead is what routes this into structured logging and the
 * retry-rate metric 041 §4.5's OPEN `tx_max_retries` is closed from.
 */
const defaultTransactionLog = (message: string): void => console.warn(message);

export interface TransactionResult<T> {
  value: T;
  /** 1 on a clean first commit. >1 means `fn` was retried; log it (041 §4.5). */
  attempts: number;
}

/**
 * Run `fn` inside one transaction on ONE connection held for the whole request.
 *
 * 029 §12 / 041 §4.1. The helper checks out a single `PoolClient`, `BEGIN`s,
 * runs `fn`, `COMMIT`s, and on any throw `ROLLBACK`s — then always releases.
 * Holding one connection for the request's lifetime is not an optimisation: it
 * is the precondition that makes an uncommitted row's lock outlive the statement
 * that took it (042 §5.3(a), A5). A `pool.query` per statement would scatter the
 * sequence across connections, each in its own implicit transaction, and a
 * concurrent request could then observe a partially written chain.
 *
 * **`fn` performs no side effect outside the transaction** — no provider call,
 * no Shopify mutation, no file write (041 §4.1, I13). That rule is what makes
 * the retry below sound; the two are one rule. The draft path's external
 * `createDraft` therefore stays OUTSIDE `fn`, before it, exactly as it is today.
 *
 * Retries `fn` from the top on `40001` / `40P01` only, up to `maxAttempts`.
 * A retried attempt gets a fresh connection: the poisoned one is rolled back and
 * released first.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (tx: Tx) => Promise<T>,
  opts?: TransactionOptions
): Promise<T> {
  const { value } = await withTransactionResult(pool, fn, opts);
  return value;
}

/**
 * `withTransaction` with the attempt count exposed. 041 §4.5's guard — "every
 * retry is counted from day one, whatever the limit turns out to be" — needs the
 * number at the call site, and the ratified signature in §4.1 returns `T`. So
 * the counting variant is a second export rather than a changed return type, and
 * `withTransaction` delegates to it.
 */
export async function withTransactionResult<T>(
  pool: pg.Pool,
  fn: (tx: Tx) => Promise<T>,
  opts?: TransactionOptions
): Promise<TransactionResult<T>> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(`withTransaction: maxAttempts must be a positive integer, got ${String(maxAttempts)}`);
  }
  const isolation = opts?.isolation ?? "read committed";

  const log = opts?.log ?? defaultTransactionLog;
  const label = opts?.label ?? "transaction";

  let attempts = 0;
  for (;;) {
    attempts += 1;
    const client = await pool.connect();
    // A failed ROLLBACK means the connection is still inside an ABORTED
    // transaction. Returning it to the pool clean would hand the next request a
    // connection that answers every statement with 25P02 — so the rollback error
    // is carried to release(), which destroys the connection instead.
    let destroyWith: Error | undefined;
    try {
      await client.query(isolation === "serializable" ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN");
      const value = await fn(client);
      await client.query("COMMIT");
      if (attempts > 1) log(`[tx] ${label}: committed after ${attempts} attempts (retried)`);
      return { value, attempts };
    } catch (err) {
      // A rollback on an already-dead connection must not mask the real error.
      await client.query("ROLLBACK").catch((rollbackErr: unknown) => {
        destroyWith = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
      });
      if (isRetryablePgError(err) && attempts < maxAttempts) {
        // 041 §4.5's guard: every retry is counted from day one, whatever
        // `tx_max_retries` turns out to be. A retry rate nobody measures is a
        // latency problem that arrives as a mystery.
        log(
          `[tx] ${label}: retrying after ${(err as { code?: string }).code} ` +
            `(attempt ${attempts} of ${maxAttempts})`
        );
        continue;
      }
      throw err;
    } finally {
      // Always, on every path — a leaked client is a pool that stops answering.
      // With an error argument, node-postgres DESTROYS the connection rather
      // than returning it to the pool.
      client.release(destroyWith);
    }
  }
}
