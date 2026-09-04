// Shared unit-test fakes. The pg.Pool seam is the only thing faked — the
// function under test is always the real implementation.
import type pg from "pg";
import type { DraftProductInput, ShopifyClient, ShopifyDraftResult } from "../src/services/shopify.js";

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
    // A real `pg.Pool` answers BOTH `connect()` and `query()`, and code under
    // test legitimately uses both: the outbox claim takes a held connection
    // (043 A1) while the attempt writer runs on the pool. A fake that offered
    // only `connect` would force a test to prove the transactional half against
    // one seam and the non-transactional half against another, which is how two
    // fakes start to disagree about the same pool. Pool-level statements land in
    // `calls` and in no client, which is itself the observable difference.
    async query(text: string, values?: unknown[]) {
      const call = { text, values };
      calls.push(call);
      return handler(text, values) ?? { rows: [] };
    },
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

/**
 * A fake `ShopifyClient` that behaves like `productSet`'s `customId` UPSERT:
 * one product per copy key, however many times it is called.
 *
 * THIS IS THE PROVIDER SEAM, NOT THE FUNCTION UNDER TEST. The consumer, the
 * fail-closed guard, the recording transaction and the unique constraint are all
 * the real implementations; only the HTTP call to somebody else's server is
 * replaced — which is the one thing an integration test cannot make and must not
 * pretend to.
 *
 * IT MODELS THE UPSERT RATHER THAN A COUNTER, deliberately. 043 §4.3's safety
 * property is that a second `productSet` with the same `customId` returns the
 * SAME product, and a fake whose id moved every call would let a retry test pass
 * against the fake while the equivalent real call duplicated. ⚠ Whether Shopify
 * really behaves this way IMMEDIATELY after a create is 043 A11's OPEN
 * assumption, closed by a dev-store measurement and not by this fake — see
 * `tests/integration/shopify-customid-consistency.test.ts`.
 */
export function fakeShopifyClient(
  opts: { fail?: { status: number; permanent?: boolean }; onCall?: (copyKey: string) => void } = {}
): {
  client: ShopifyClient;
  /** Every copy key the consumer asked for, in order. */
  calls: string[];
  /** Every INPUT, in order — the composed title is how a caller checks WHAT was drafted. */
  inputs: DraftProductInput[];
  /** The "store": copy key → product GID. Its SIZE is the duplicate-product count. */
  products: Map<string, string>;
} {
  const calls: string[] = [];
  const inputs: DraftProductInput[] = [];
  const products = new Map<string, string>();
  return {
    calls,
    inputs,
    products,
    client: {
      async createDraft(input: DraftProductInput): Promise<ShopifyDraftResult> {
        calls.push(input.copyKey);
        inputs.push(input);
        opts.onCall?.(input.copyKey);
        if (opts.fail) {
          return {
            ok: false,
            status: opts.fail.status,
            ...(opts.fail.permanent === true ? { permanent: true } : {}),
          };
        }
        if (!products.has(input.copyKey)) {
          products.set(input.copyKey, `gid://shopify/Product/${products.size + 1}`);
        }
        return { ok: true, status: 200, productGid: products.get(input.copyKey)! };
      },
    },
  };
}

/** Minimal Response-like object for stubbing global fetch. */
export function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}
