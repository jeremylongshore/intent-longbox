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

/** Minimal Response-like object for stubbing global fetch. */
export function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}
