// Shared unit-test fakes. The pg.Pool seam is the only thing faked — the
// function under test is always the real implementation.
import type pg from "pg";
import type { Queryable } from "../src/db.js";
import type { Against } from "../src/contracts/v1/schemas.js";
import type { WitnessedReference } from "../src/services/witnessedReference.js";
import type { DraftProductInput, ShopifyClient, ShopifyDraftResult } from "../src/services/shopify.js";

/**
 * A `WitnessedReference` for a unit test (E02-D11).
 *
 * In `src/` the brand can only be produced by `assertWorldViewIsCurrent`, which
 * is the whole point: a request body cannot reach a column. The brand has no
 * runtime shape, so this cast is the ONE place a test may mint one, and it is
 * here rather than inline so the exception is visible and countable. What a
 * stored reference's PROVENANCE actually is gets proved against a database in
 * `tests/integration/stale-world-view.test.ts`, not here.
 */
export function witnessed(table: Against["table"], id: string): WitnessedReference {
  return { table, id } as WitnessedReference;
}

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

export interface FakeTx {
  /** The same recorder, typed as the two seams `src/catalog/` takes. */
  tx: pg.PoolClient;
  db: Queryable;
  /** Every statement, in order. */
  calls: QueryCall[];
  /** The statements whose text contains `fragment`, in order. */
  matching(fragment: string): QueryCall[];
  /** The single statement containing `fragment`; fails loudly on 0 or 2+. */
  only(fragment: string): QueryCall;
}

/**
 * A recording `pg.PoolClient` / `Queryable` that answers by statement text.
 *
 * ⚠ WHY THE CATALOG UNIT LANE FAKES THIS SEAM RATHER THAN USING POSTGRES.
 * `src/catalog/` splits cleanly in two, and the split is the reason both lanes
 * exist. The DATABASE's guarantees — the no-cycle trigger, the certification-class
 * trigger, the append-only refusal, the index-only plan on the projection, the
 * absence of a UNIQUE on `edition_signature` — are properties of Postgres and are
 * asserted against Postgres in `tests/integration/lcid-*.test.ts`,
 * `catalog-edition-write.test.ts` and `crosswalk-catalog-authority.test.ts`. What
 * is left over is the MODULE's own decisions: which of `resolve`'s five outcomes
 * a given read produces, that a split of one product is refused before any SQL is
 * issued, that a certification carries `decided_by_role` and a proposal carries
 * none, that a mint retries a payload collision on a savepoint and lets `40001`
 * propagate, that a rebuild leaves an anomalous chain OUT of the projection. Each
 * of those is a branch a database cannot be asked about, so a fake at this seam
 * is not a weaker version of the integration test — it is the only lane that
 * reaches them.
 *
 * The handler sees the real SQL, so a test asserts on the real statement and on
 * the real parameter list; nothing about the query is invented by the fake.
 */
export function fakeTx(
  handler: (text: string, values: unknown[] | undefined) => { rows: unknown[] } | undefined = () => undefined
): FakeTx {
  const calls: QueryCall[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return handler(text, values) ?? { rows: [] };
    },
    release() {},
  };
  const matching = (fragment: string) => calls.filter((c) => c.text.includes(fragment));
  return {
    tx: client as unknown as pg.PoolClient,
    db: client as unknown as Queryable,
    calls,
    matching,
    only(fragment: string) {
      const hits = matching(fragment);
      if (hits.length !== 1) {
        throw new Error(
          `expected exactly one statement containing ${JSON.stringify(fragment)}, saw ${hits.length}`
        );
      }
      return hits[0]!;
    },
  };
}
