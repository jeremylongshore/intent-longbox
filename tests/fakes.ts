// Shared unit-test fakes. The pg.Pool seam is the only thing faked — the
// function under test is always the real implementation.
import type pg from "pg";

export interface QueryCall {
  text: string;
  values: unknown[] | undefined;
}

export interface FakePool {
  pool: pg.Pool;
  calls: QueryCall[];
}

/**
 * A fake pg.Pool whose query() records every call and answers via the handler.
 * Handler returns rows for a matched statement, or undefined for `{ rows: [] }`.
 */
export function fakePool(
  handler: (text: string, values: unknown[] | undefined) => { rows: unknown[] } | undefined = () => undefined
): FakePool {
  const calls: QueryCall[] = [];
  const pool = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return handler(text, values) ?? { rows: [] };
    },
  };
  return { pool: pool as unknown as pg.Pool, calls };
}

export interface FakeTxPool {
  pool: pg.Pool;
  /** Every statement seen on every checked-out client, in order. */
  calls: QueryCall[];
  /**
   * One entry per `pool.connect()`. `released` flips on `client.release()`;
   * `releasedWith` carries the argument, which is how node-postgres is told to
   * DESTROY the connection rather than return it to the pool.
   */
  clients: Array<{ released: boolean; releasedWith: unknown; calls: QueryCall[] }>;
}

/**
 * A fake `pg.Pool` whose `connect()` hands out recording clients, so the
 * transaction helper's BEGIN/COMMIT/ROLLBACK sequence, its retry behaviour and
 * its release discipline are all observable without a database.
 *
 * The handler may throw to simulate a failing statement (pass a pg-shaped error
 * with a `code` to exercise the retry paths).
 */
export function fakeTxPool(
  handler: (text: string, values: unknown[] | undefined) => { rows: unknown[] } | undefined = () => undefined
): FakeTxPool {
  const calls: QueryCall[] = [];
  const clients: FakeTxPool["clients"] = [];
  const pool = {
    async connect() {
      const entry = { released: false, releasedWith: undefined as unknown, calls: [] as QueryCall[] };
      clients.push(entry);
      return {
        async query(text: string, values?: unknown[]) {
          const call = { text, values };
          calls.push(call);
          entry.calls.push(call);
          return handler(text, values) ?? { rows: [] };
        },
        release(err?: unknown) {
          entry.released = true;
          entry.releasedWith = err;
        },
      };
    },
  };
  return { pool: pool as unknown as pg.Pool, calls, clients };
}

/** A pg-shaped error: `withTransaction` retries only on the SQLSTATE `code`. */
export function pgError(code: string, message = `simulated ${code}`): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/** Minimal Response-like object for stubbing global fetch. */
export function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}
