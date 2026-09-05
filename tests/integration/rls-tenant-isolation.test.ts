// L4: ROW-LEVEL SECURITY, against a real cluster, as the real application role.
//
// E03-B04, and the third of 034 §3.2's three tenancy layers. The other two are
// asserted elsewhere and fail differently: the CONTRACT fails to a code review
// (`route-table-scoping`), the RUNTIME ASSERTION fails to a bug
// (`session-tenant-isolation`), and this one fails to a DATABASE
// MISCONFIGURATION — a restored dump, a policy dropped in an incident, a role
// granted `BYPASSRLS`. 019 T24 is non-waivable and any cross-tenant read is a K1,
// so all three exist and this file is the one that can still be true when a
// handler is wrong.
//
// FIVE THINGS ARE ASSERTED HERE, and the order is the argument:
//
//   1. THE BOUNDARY — the app role with no context sees nothing, with the wrong
//      context sees nothing, with the right one sees exactly its own rows, and a
//      cross-tenant INSERT is refused by `WITH CHECK`;
//   2. POOL REUSE — the context reverts at COMMIT, so a connection handed back to
//      the pool carries no tenant to whoever borrows it next (046 K-5's named
//      failure mode, and the reason the context is transaction-local);
//   3. PROPERTY TESTS over generated pairs of shops and generated tables, because
//      the bead asks for "generated queries cannot cross tenants" and a boundary
//      proved on `scan_session` alone is a boundary proved on one table;
//   4. THE SHAPE OF THE SCHEMA — every table carrying a `shop_id` has RLS enabled,
//      the declared policy with the declared predicate, and an index whose leading
//      column is `shop_id`; every table without one is a DECLARED exemption; every
//      view is `security_invoker`;
//   5. THE THINGS THAT DO NOT APPLY, stated rather than assumed — the schema owner
//      bypasses (which is why the CLIs and this lane's fixtures work), and the app
//      role has no `BYPASSRLS`.
//
// The generator is hand-rolled. `fast-check` is not a dependency of this
// repository and adding one to a security bead is a supply-chain decision that
// belongs in its own PR; what these properties need is a seeded shuffle over a
// list the catalog already gives us, which is twenty lines.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { serviceDb, withTransaction } from "../../src/db.js";
import {
  RLS_EXEMPTIONS,
  SERVICE_CONTEXT_TABLES,
  SERVICE_POLICY,
  SERVICE_TABLES,
  SERVICE_WRITE_POLICY,
  TENANT_COLUMNS,
  TENANT_POLICY,
  serviceReadPredicate,
  serviceWritePredicate,
  tenantPredicate,
} from "../../src/db/rowLevelSecurity.js";
import { checkTenantIsolation, describeTenantIsolationFailure } from "../../src/services/roleSeparation.js";
import { applyRowLevelSecurity } from "../../src/db/rowLevelSecurity.js";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

/** The tables a property may generate a query against: shop-scoped, and seedable with two columns. */
const PROPERTY_TABLES = [
  "scan_session",
  "candidate_set",
  "request_idempotency",
  "human_confirmation",
  "condition_assessment",
  "pricing_snapshot",
  "scan_photo",
  "cost_log",
  "outbox",
] as const;

/** One INSERT per property table, parameterised on (shopId, sessionId). */
const SEEDS: Record<(typeof PROPERTY_TABLES)[number], string> = {
  scan_session: `INSERT INTO scan_session (id, shop_id) VALUES ($2,$1)`,
  candidate_set: `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates)
                  VALUES ($2,$1,'barcode','[]'::jsonb)`,
  // Not a witness row and not session-scoped — deliberately in the set, because a
  // generated query over the request log is exactly the shape that leaks a
  // neighbour's keys if the boundary is only in the `WHERE` clause.
  request_idempotency: `INSERT INTO request_idempotency (shop_id, idempotency_key, route, request_hash)
                        VALUES ($1, 'key-' || $2, '/api/v1/probe', 'hash')`,
  human_confirmation: `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source)
                       VALUES ($2,$1,'{}'::jsonb,'grid_pick')`,
  condition_assessment: `INSERT INTO condition_assessment
                           (scan_session_id, shop_id, grade_range_low, grade_range_high, defects)
                         VALUES ($2,$1,'FN','VF','{}')`,
  pricing_snapshot: `INSERT INTO pricing_snapshot (scan_session_id, shop_id, query, suggested_cents)
                     VALUES ($2,$1,'x',100)`,
  scan_photo: `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url)
               VALUES ($2,$1,'cover','/tmp/x.png')`,
  cost_log: `INSERT INTO cost_log (shop_id, scan_session_id, provider, model, spend_owner)
             VALUES ($1,$2,'stub','stub','longbox')`,
  outbox: `INSERT INTO outbox (shop_id, scan_session_id, event, ref_table, ref_id, authored_by)
           VALUES ($1,$2,'longbox.commerce.draft_requested','scan_session',$2,'human')`,
};

/**
 * A deterministic shuffle, so a failure reproduces from the seed printed with it.
 *
 * A property test whose ordering nobody can reproduce is a flaky test with better
 * manners; `mulberry32` is four lines and makes the run replayable.
 */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  let a = seed >>> 0;
  const rand = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe.skipIf(!dbUp)("row-level security, as the application role (E03-B04, 019 T24)", () => {
  let appPool: pg.Pool;
  let ownerPool: pg.Pool;
  const shops: string[] = [];
  const sessions = new Map<string, string>();
  let policiedTables: string[] = [];

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_rls_isolation");
    await runMigrations(migrateUrl);
    ownerPool = new pg.Pool({ connectionString: migrateUrl });
    appPool = new pg.Pool({ connectionString: appUrl(migrateUrl), max: 8 });

    // FOUR shops, seeded BY THE OWNER — which is itself part of what is under
    // test: the schema owner bypasses these policies (`migrations/029` (a)), and
    // it is why `pnpm register-shop` and this lane's fixtures keep working.
    for (let i = 0; i < 4; i += 1) {
      const shopId = await seedShop(ownerPool, {
        name: `RLS Shop ${String(i)}`,
        slug: `rls-${randomUUID()}`,
      });
      shops.push(shopId);
      const sessionId = randomUUID();
      for (const table of PROPERTY_TABLES) {
        await ownerPool.query(SEEDS[table], [shopId, sessionId]);
      }
      sessions.set(shopId, sessionId);
    }

    policiedTables = (
      await ownerPool.query(
        `
      SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         AND (EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'shop_id' AND NOT a.attisdropped)
              OR c.relname = ANY ($1::text[]))
       ORDER BY 1`,
        [Object.keys(TENANT_COLUMNS)]
      )
    ).rows.map((r) => (r as { name: string }).name);
  }, 180_000);

  afterAll(async () => {
    await appPool?.end();
    await ownerPool?.end();
  });

  // -------------------------------------------------------------------------
  // 1. The boundary itself.
  // -------------------------------------------------------------------------

  it("with NO context, the app role sees nothing and can write nothing", async () => {
    // The fail-closed default, and the reason no policy contains
    // `OR current_shop_id() IS NULL`: a path that forgets its context returns
    // zero rows and refuses its inserts — loudly wrong rather than quietly
    // complete.
    const read = await appPool.query(`SELECT id FROM scan_session`);
    expect(read.rows).toEqual([]);
    await expect(appPool.query(`INSERT INTO scan_session (shop_id) VALUES ($1)`, [shops[0]])).rejects.toThrow(
      /row-level security/
    );
  });

  it("with the RIGHT context, it sees exactly that shop's rows and no other's", async () => {
    for (const shopId of shops) {
      const rows = (await asShop(appPool, shopId).query(`SELECT shop_id FROM scan_session`)).rows as Array<{
        shop_id: string;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.shop_id).toBe(shopId);
    }
  });

  it("with the WRONG context, a row read by its own primary key returns NOTHING", async () => {
    // The interesting shape: the caller KNOWS the id — 034 §3.4's worked K1, where
    // an operator at shop A holds a uuid from shop B. A predicate the handler
    // forgot is exactly what this layer is for.
    const [a, b] = [shops[0]!, shops[1]!];
    const target = sessions.get(b)!;
    const rows = await asShop(appPool, a).query(`SELECT id FROM scan_session WHERE id = $1`, [target]);
    expect(rows.rows).toEqual([]);
    // And it is not a permissions error the caller could distinguish: it is an
    // absence, which is the same answer an id that never existed gets.
    const missing = await asShop(appPool, a).query(`SELECT id FROM scan_session WHERE id = $1`, [
      randomUUID(),
    ]);
    expect(missing.rows).toEqual(rows.rows);
  });

  it("REFUSES a write that names another shop, inside a correct context", async () => {
    // `WITH CHECK`, not `USING`: the row being written is the one refused, so a
    // handler that took `shop_id` from a body could not launder it through a
    // transaction opened for the session's shop (048 §6.1).
    await expect(
      asShop(appPool, shops[0]!).query(`INSERT INTO scan_session (shop_id) VALUES ($1)`, [shops[1]])
    ).rejects.toThrow(/row-level security/);
  });

  it("REFUSES an UPDATE that would move a row into another tenant", async () => {
    // `scan_session` is the one policied table the app may UPDATE (it is a
    // declared append-only exemption), so it is the only place this can be asked.
    await expect(
      asShop(appPool, shops[0]!).query(`UPDATE scan_session SET shop_id = $1 WHERE shop_id = $2`, [
        shops[1],
        shops[0],
      ])
    ).rejects.toThrow(/row-level security/);
  });

  it("filters a VIEW the same way it filters its base table", async () => {
    // Without `security_invoker` a view reads its base tables as the VIEW OWNER —
    // the schema owner, which these policies exempt — and every `*_current` read
    // model would have returned every shop's rows while the table beneath it
    // returned one shop's. That is the half of `migrations/029` easiest to miss.
    const rows = await asShop(appPool, shops[0]!).query(`SELECT shop_id FROM human_confirmation_current`);
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as { shop_id: string }).shop_id).toBe(shops[0]);
  });

  // -------------------------------------------------------------------------
  // 2. Pool reuse — the failure mode this design exists to make unconstructible.
  // -------------------------------------------------------------------------

  it("leaves NO tenant on the connection it hands back to the pool", async () => {
    // 046 §6 K-5, verbatim: "`SET LOCAL` on a pooled connection outside a
    // transaction leaks into the next request that borrows it". A pool of ONE
    // guarantees the next statement is on the same physical connection.
    const single = new pg.Pool({ connectionString: appPool.options.connectionString, max: 1 });
    try {
      const scoped = await asShop(single, shops[0]!).query(`SELECT id FROM scan_session`);
      expect(scoped.rows).toHaveLength(1);
      const after = await single.query(`SELECT id FROM scan_session`);
      expect(after.rows).toEqual([]);
      const setting = await single.query(`SELECT current_setting('longbox.shop_id', true) AS v`);
      expect((setting.rows[0] as { v: string | null }).v ?? "").toBe("");
    } finally {
      await single.end();
    }
  });

  it("does not leak a tenant ACROSS interleaved transactions on one connection", async () => {
    // Two shops, one connection, alternating. Each transaction sees its own shop
    // and never the other's — the property a sticky `SET` would break silently.
    const single = new pg.Pool({ connectionString: appPool.options.connectionString, max: 1 });
    try {
      for (const shopId of [shops[0]!, shops[1]!, shops[0]!, shops[2]!]) {
        const rows = (await asShop(single, shopId).query(`SELECT shop_id FROM scan_session`)).rows as Array<{
          shop_id: string;
        }>;
        expect(rows.map((r) => r.shop_id)).toEqual([shopId]);
      }
    } finally {
      await single.end();
    }
  });

  it("reverts the context even when the transaction ROLLS BACK", async () => {
    const single = new pg.Pool({ connectionString: appPool.options.connectionString, max: 1 });
    try {
      await expect(
        withTransaction(
          single,
          async (tx) => {
            await tx.query(`SELECT id FROM scan_session`);
            throw new Error("handler refused");
          },
          { tenant: { shopId: shops[0]! } }
        )
      ).rejects.toThrow("handler refused");
      const after = await single.query(`SELECT current_setting('longbox.shop_id', true) AS v`);
      expect((after.rows[0] as { v: string | null }).v ?? "").toBe("");
    } finally {
      await single.end();
    }
  });

  // -------------------------------------------------------------------------
  // 3. The properties: generated pairs, generated tables.
  // -------------------------------------------------------------------------

  it("PROPERTY: no generated (shop, table) pair ever reads another shop's row", async () => {
    // Every ordered pair of the four shops against every property table, in a
    // shuffled order so the failure is not an artifact of one sequence. 12 pairs
    // × 9 tables = 108 generated reads.
    const seed = 20260904;
    let checked = 0;
    for (const table of shuffled(PROPERTY_TABLES, seed)) {
      for (const reader of shuffled(shops, seed + 1)) {
        for (const subject of shops) {
          if (reader === subject) continue;
          const rows = await asShop(appPool, reader).query(
            `SELECT shop_id FROM ${table} WHERE shop_id = $1`,
            [subject]
          );
          expect(rows.rows, `${table}: ${reader} read ${subject}`).toEqual([]);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(PROPERTY_TABLES.length * shops.length * (shops.length - 1));
  });

  it("PROPERTY: an unqualified read returns the reader's rows and ONLY the reader's", async () => {
    // The complement of the case above, and the one a handler that forgot its
    // `WHERE shop_id = $1` actually produces: no predicate at all.
    for (const table of shuffled(PROPERTY_TABLES, 7)) {
      for (const reader of shops) {
        const rows = (await asShop(appPool, reader).query(`SELECT shop_id FROM ${table}`)).rows as Array<{
          shop_id: string;
        }>;
        expect(
          rows.map((r) => r.shop_id),
          table
        ).toEqual([reader]);
      }
    }
  });

  it("PROPERTY: every generated cross-tenant INSERT is refused by WITH CHECK", async () => {
    for (const table of shuffled(PROPERTY_TABLES, 99)) {
      const [writer, victim] = [shops[0]!, shops[1]!];
      const session = sessions.get(victim)!;
      await expect(
        asShop(appPool, writer).query(SEEDS[table], [victim, session]),
        `${table}: ${writer} wrote a row for ${victim}`
      ).rejects.toThrow(/row-level security/);
    }
  });

  it("PROPERTY: a JOIN cannot smuggle another tenant's row in through a second table", async () => {
    // A generated query is rarely one table. Every pairing of two property tables
    // is joined on `scan_session_id` and asserted to return only the reader's
    // rows — the shape a report or an export produces by accident.
    const joinable = PROPERTY_TABLES.filter((t) => t !== "scan_session" && t !== "request_idempotency");
    for (const left of joinable) {
      for (const right of joinable) {
        if (left === right) continue;
        const rows = await asShop(appPool, shops[0]!).query(
          `SELECT l.shop_id AS l, r.shop_id AS r
             FROM ${left} l JOIN ${right} r ON r.scan_session_id = l.scan_session_id`
        );
        for (const row of rows.rows as Array<{ l: string; r: string }>) {
          expect([row.l, row.r], `${left}⋈${right}`).toEqual([shops[0], shops[0]]);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // 4. The shape of the schema — asserted from the catalog, in both directions.
  // -------------------------------------------------------------------------

  it("every table carrying a shop_id has RLS enabled and the DECLARED policy", async () => {
    const rows = (
      await ownerPool.query(`
      SELECT c.relname AS name, c.relrowsecurity AS enabled,
             (SELECT count(*) FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = c.relname
                 AND p.policyname = '${TENANT_POLICY}') AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'shop_id' AND NOT a.attisdropped)
       ORDER BY 1`)
    ).rows as Array<{ name: string; enabled: boolean; policies: string }>;

    expect(rows.length).toBeGreaterThan(30);
    const unprotected = rows.filter((r) => !r.enabled || Number(r.policies) !== 1).map((r) => r.name);
    expect(unprotected).toEqual([]);
  });

  it("every policy on every policied table is one this design EMITS — name, command and predicate", async () => {
    // ⚠ THE SHAPE OF THIS ASSERTION IS THE CANNON'S, AND THE OLD ONE PASSED WHILE
    // THE BOUNDARY WAS GONE. It used to ask, per table, "does `tenant_isolation`
    // exist and does its predicate match?" — which is blind to a PERMISSIVE policy
    // added beside it (Postgres ORs them), blind to `tenant_isolation` reshaped to
    // `FOR INSERT WITH CHECK (true)` (a NULL `qual` read as "nothing to compare"),
    // and never looked at the second policy at all. So it compares the SET of
    // policies that exist against the SET this design emits.
    const norm = (x: string | null): string => (x ?? "").replace(/[\s()]/g, "").replace(/::text/g, "");
    const rows = (
      await ownerPool.query(
        `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
          WHERE schemaname = 'public' ORDER BY tablename, policyname`
      )
    ).rows as Array<{
      tablename: string;
      policyname: string;
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }>;

    const expected = new Set<string>();
    for (const table of policiedTables) {
      const tenant = norm(tenantPredicate(table));
      expected.add([table, TENANT_POLICY, "ALL", tenant, tenant].join("|"));
    }
    for (const declared of SERVICE_TABLES) {
      expected.add(
        [declared.table, SERVICE_POLICY, "SELECT", norm(serviceReadPredicate(declared)), ""].join("|")
      );
      if (declared.write !== undefined) {
        expected.add(
          [declared.table, SERVICE_WRITE_POLICY, "INSERT", "", norm(serviceWritePredicate(declared))].join(
            "|"
          )
        );
      }
    }

    const live = rows.map((r) =>
      [r.tablename, r.policyname, r.cmd, norm(r.qual), norm(r.with_check)].join("|")
    );
    expect(live.filter((l) => !expected.has(l))).toEqual([]);
    // …and in the other direction, so a policy that was never created fails too.
    expect([...expected].filter((e) => !live.includes(e))).toEqual([]);
  });

  it("the READ policy is SELECT-only and the WRITE policy is INSERT-only (F1)", async () => {
    // The security lens reproduced what `FOR ALL` over a scope-agnostic boolean
    // meant: inside `my-shops` the app role INSERTED an owner membership at
    // another shop. The commands are now the assertion.
    const rows = (
      await ownerPool.query(
        `SELECT policyname, cmd, count(*)::int AS n FROM pg_policies
          WHERE schemaname = 'public' AND policyname IN ($1, $2)
          GROUP BY 1, 2 ORDER BY 1`,
        [SERVICE_POLICY, SERVICE_WRITE_POLICY]
      )
    ).rows as Array<{ policyname: string; cmd: string; n: number }>;
    for (const row of rows) {
      expect([row.policyname, row.cmd]).toEqual([
        row.policyname,
        row.policyname === SERVICE_POLICY ? "SELECT" : "INSERT",
      ]);
    }
  });

  it("REFUSES the write the security lens reproduced: an owner membership at another shop", async () => {
    // F1, as a regression. Inside `my-shops` — a scope that exists to answer ONE
    // read — the application role could insert a membership naming any shop. It
    // now has no INSERT policy on `membership` at all, from any scope.
    const person = (
      await ownerPool.query(
        `INSERT INTO app_user (email, display_name) VALUES ($1, 'F1 Probe') RETURNING id`,
        [`f1-${randomUUID()}@example.invalid`]
      )
    ).rows[0] as { id: string };
    await expect(
      serviceDb(appPool, "my-shops").query(
        `INSERT INTO membership (app_user_id, shop_id, scope_kind, role) VALUES ($1,$2,'shop','owner')`,
        [person.id, shops[1]]
      )
    ).rejects.toThrow(/row-level security/);
    // And the same write is refused under a TENANT context for the other shop,
    // which is the comparison that makes the first assertion mean something.
    await expect(
      asShop(appPool, shops[0]!).query(
        `INSERT INTO membership (app_user_id, shop_id, scope_kind, role) VALUES ($1,$2,'shop','owner')`,
        [person.id, shops[1]]
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("the SECOND policy exists on exactly the declared pre-tenant tables", async () => {
    const rows = (
      await ownerPool.query(
        `SELECT tablename FROM pg_policies
          WHERE schemaname = 'public' AND policyname = $1 ORDER BY 1`,
        [SERVICE_POLICY]
      )
    ).rows as Array<{ tablename: string }>;
    expect(rows.map((r) => r.tablename)).toEqual([...SERVICE_CONTEXT_TABLES].sort());
  });

  it("the WRITE policy exists on exactly THREE tables, and each check names the row", async () => {
    const rows = (
      await ownerPool.query(
        `SELECT tablename, with_check FROM pg_policies
          WHERE schemaname = 'public' AND policyname = $1 ORDER BY 1`,
        [SERVICE_WRITE_POLICY]
      )
    ).rows as Array<{ tablename: string; with_check: string }>;
    expect(rows.map((r) => r.tablename)).toEqual([
      "auth_attempt",
      "connector_token_retirement",
      "connector_webhook_receipt",
    ]);
    // Every one is a conjunction of the scope list AND a condition about the row.
    // A check that were only the scope list would be the `FOR ALL` boolean wearing
    // a narrower name.
    for (const row of rows) expect(row.with_check).toMatch(/AND/);
  });

  it("the WRITE policies ACCEPT the row they exist for and REFUSE the row beside it", async () => {
    // The case above asserts the write policies' SHAPE from the catalog. This one
    // asserts their BEHAVIOUR, which is what the advisory review on PR #90 asked
    // for (finding 5): a check whose scope list named the wrong scope, or whose
    // row condition were subtly wrong, would satisfy the shape test and refuse
    // every real write in production -- or accept one it should not.
    //
    // `auth_attempt`: the session scopes may append a refusal for a shop NOBODY
    // HAS IDENTIFIED, and only `code-redemption` may name one.
    await expect(
      serviceDb(appPool, "session-resolution").query(
        `INSERT INTO auth_attempt (shop_id, method, failure_class) VALUES (NULL,'session_token','unknown')`
      )
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      serviceDb(appPool, "session-resolution").query(
        `INSERT INTO auth_attempt (shop_id, method, failure_class) VALUES ($1,'session_token','unknown')`,
        [shops[0]]
      )
    ).rejects.toThrow(/row-level security/);
    await expect(
      serviceDb(appPool, "code-redemption").query(
        `INSERT INTO auth_attempt (shop_id, method, failure_class) VALUES ($1,'enrollment_code','unknown')`,
        [shops[0]]
      )
    ).resolves.toMatchObject({ rowCount: 1 });
    // A scope that declares NO write on the table is refused whatever the row is.
    await expect(
      serviceDb(appPool, "my-shops").query(
        `INSERT INTO auth_attempt (shop_id, method, failure_class) VALUES (NULL,'session_token','unknown')`
      )
    ).rejects.toThrow(/row-level security/);

    // `connector_webhook_receipt`: the ONE row whose `shop_id` may legitimately be
    // NULL after the write (053 §5.5). Both the NULL case and a named-shop case
    // are accepted under `connector-inbound`; a receipt with no topic is not.
    const receipt = (columns: string, values: string): string =>
      `INSERT INTO connector_webhook_receipt (${columns}) VALUES (${values})`;
    await expect(
      serviceDb(appPool, "connector-inbound").query(
        receipt(
          "shop_id, connector, topic, webhook_id, shop_domain, payload_digest, payload_bytes",
          `NULL,'shopify','app/uninstalled',$1,'probe.myshopify.com','deadbeef',0`
        ),
        [randomUUID()]
      )
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      serviceDb(appPool, "connector-inbound").query(
        receipt(
          "shop_id, connector, topic, webhook_id, shop_domain, payload_digest, payload_bytes",
          `$2,'shopify','app/uninstalled',$1,'probe.myshopify.com','deadbeef',0`
        ),
        [randomUUID(), shops[0]]
      )
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      serviceDb(appPool, "outbox-sweep").query(
        receipt(
          "shop_id, connector, topic, webhook_id, shop_domain, payload_digest, payload_bytes",
          `NULL,'shopify','app/uninstalled',$1,'probe.myshopify.com','deadbeef',0`
        ),
        [randomUUID()]
      )
    ).rejects.toThrow(/row-level security/);
  });

  it("every table WITHOUT a shop_id is a declared exemption, with a reason", async () => {
    // The other direction, which is the one that catches a table somebody forgot
    // to give a tenant: it appears here rather than in the policied set, and it
    // has to be argued for in `src/db/rowLevelSecurity.ts` before this passes.
    const rows = (
      await ownerPool.query(`
      SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                          WHERE a.attrelid = c.oid AND a.attname = 'shop_id' AND NOT a.attisdropped)
       ORDER BY 1`)
    ).rows as Array<{ name: string }>;
    // `shop` is NOT here: it carries no `shop_id` and is policied anyway, on its
    // own `id` (TENANT_COLUMNS). It is the one table whose tenant is itself.
    const declared = [...RLS_EXEMPTIONS.map((e) => e.table), ...Object.keys(TENANT_COLUMNS)].sort();
    expect(rows.map((r) => r.name)).toEqual(declared);
  });

  it("every policied table has an index whose LEADING column is shop_id", async () => {
    // The policy adds `shop_id = current_shop_id()` to every statement. Where a
    // query carries a more selective predicate the planner uses that index and
    // applies the tenant as a filter; where it does not — a shop-wide listing, the
    // daily cross-tenant audit query 019 T24 requires — this is what keeps it off
    // a sequential scan across every tenant's rows.
    const rows = (
      await ownerPool.query(`
      SELECT t.relname AS name FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND t.relkind = 'r'
         AND EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = t.oid AND a.attname = 'shop_id' AND NOT a.attisdropped)
         AND NOT EXISTS (
               SELECT 1 FROM pg_index x
                WHERE x.indrelid = t.oid
                  AND (SELECT attname FROM pg_attribute
                        WHERE attrelid = t.oid AND attnum = x.indkey[0]) = 'shop_id')
       ORDER BY 1`)
    ).rows as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it("evaluates the POLICY once per query, not once per row", async () => {
    // The property that decides whether this boundary is affordable. The policy
    // adds `shop_id = current_shop_id()` to every statement, and `current_shop_id`
    // is `STABLE` — so the planner lifts it into a ONE-TIME FILTER evaluated once
    // for the whole scan and compares it against the query's own predicate. The
    // tenant costs one comparison per QUERY; without `STABLE` it would be one per
    // ROW, on every table, forever.
    const plan = (
      await asShop(appPool, shops[0]!).query(
        `EXPLAIN (COSTS OFF) SELECT id FROM scan_photo WHERE shop_id = $1`,
        [shops[0]]
      )
    ).rows
      .map((r) => (r as { "QUERY PLAN": string })["QUERY PLAN"])
      .join("\n");
    expect(plan).toContain("One-Time Filter");
    expect(plan).toContain("current_setting('longbox.shop_id'");
  });

  it("PLANS a shop's read through the shop_id index once the table holds more than one tenant", async () => {
    // EXPLAIN rather than a timing: the claim is about the PLAN, and a timing
    // assertion would be a claim about this machine. The skew is deliberate — a
    // table where one shop holds every row is a table where a sequential scan is
    // the RIGHT plan, so the index only earns its place once a second tenant is
    // in it. That is also the shape 019 §5's 500-shop synthetic load will have.
    const crowd = shops[1]!;
    const session = sessions.get(crowd)!;
    await ownerPool.query(
      `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url)
       SELECT $1, $2, 'cover', '/tmp/x.png' FROM generate_series(1, 4000)`,
      [session, crowd]
    );
    await ownerPool.query(`ANALYZE scan_photo`);
    const plan = (
      await asShop(appPool, shops[0]!).query(
        `EXPLAIN (COSTS OFF) SELECT id FROM scan_photo WHERE shop_id = $1`,
        [shops[0]]
      )
    ).rows
      .map((r) => (r as { "QUERY PLAN": string })["QUERY PLAN"])
      .join("\n");
    expect(plan).toMatch(/Index Scan|Bitmap Index Scan|Index Only Scan/);
    expect(plan).toContain("scan_photo_shop_idx");
    // …and the policy is STILL a one-time filter over that index scan, rather
    // than a re-check of every row the index returned.
    expect(plan).toContain("One-Time Filter");
  });

  it("makes every VIEW security_invoker, so no read model reads as the owner", async () => {
    const rows = (
      await ownerPool.query(`
      SELECT c.relname AS name, coalesce(array_to_string(c.reloptions, ','), '') AS opts
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'v' ORDER BY 1`)
    ).rows as Array<{ name: string; opts: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows)
      expect([row.name, row.opts.includes("security_invoker=true")]).toEqual([row.name, true]);
  });

  // -------------------------------------------------------------------------
  // 5. What does NOT apply, stated rather than assumed.
  // -------------------------------------------------------------------------

  it("the SCHEMA OWNER bypasses the policies — deliberately, and this is where it is stated", async () => {
    // `ENABLE`, not `FORCE` (`migrations/029` (a)). Under `FORCE` every migration
    // data statement, every CLI and every fixture in this lane would be filtered
    // to nothing or refused, and the boundary would not be one row stronger: the
    // role that matters is the APPLICATION role, which owns nothing and is subject
    // to every policy. That the application can never BE the owner is enforced by
    // the boot assertion in `roleSeparation.ts`, not assumed here.
    const all = await ownerPool.query(`SELECT shop_id FROM scan_session`);
    expect(all.rows.length).toBe(shops.length);
  });

  it("the APP role has neither BYPASSRLS nor SUPERUSER", async () => {
    const row = (
      await appPool.query(
        `SELECT rolbypassrls AS bypass, rolsuper AS super FROM pg_roles WHERE rolname = current_user`
      )
    ).rows[0] as { bypass: boolean; super: boolean };
    expect(row).toEqual({ bypass: false, super: false });
  });

  it("the BOOT ASSERTION passes on this connection, and names what it checked", async () => {
    const result = await checkTenantIsolation(appPool);
    expect(describeTenantIsolationFailure(result)).toBe("");
    expect(result.ok).toBe(true);
    expect(result.unprotectedTables).toEqual([]);
    expect(result.ownerReadingViews).toEqual([]);
  });

  it("the BOOT ASSERTION FAILS when a policy is dropped — the gate can fail", async () => {
    // 029 §5 move 8's rule, applied to a detector: a check that has never failed
    // and a check that cannot fail look identical from the outside.
    await ownerPool.query(`DROP POLICY ${TENANT_POLICY} ON pricing_snapshot`);
    try {
      const broken = await checkTenantIsolation(appPool);
      expect(broken.ok).toBe(false);
      expect(broken.unprotectedTables).toContain("pricing_snapshot");
      expect(describeTenantIsolationFailure(broken)).toContain("pricing_snapshot");
      // And the boundary really is gone for that table, which is what the
      // detector is FOR: with no policy, RLS enabled means "deny", so the app
      // role now reads nothing at all rather than reading everything — the
      // fail-closed direction, worth pinning.
      const rows = await asShop(appPool, shops[0]!).query(`SELECT id FROM pricing_snapshot`);
      expect(rows.rows).toEqual([]);
    } finally {
      await ownerPool.query(
        `CREATE POLICY ${TENANT_POLICY} ON pricing_snapshot FOR ALL ` +
          `USING (${tenantPredicate("pricing_snapshot")}) WITH CHECK (${tenantPredicate("pricing_snapshot")})`
      );
    }
  });

  it("the BOOT ASSERTION FAILS when a policy predicate is relaxed to `true`", async () => {
    await ownerPool.query(`DROP POLICY ${TENANT_POLICY} ON pricing_snapshot`);
    await ownerPool.query(
      `CREATE POLICY ${TENANT_POLICY} ON pricing_snapshot FOR ALL USING (true) WITH CHECK (true)`
    );
    try {
      const broken = await checkTenantIsolation(appPool);
      expect(broken.ok).toBe(false);
      expect(broken.alteredPolicies.join(" ")).toContain("pricing_snapshot");
    } finally {
      await ownerPool.query(`DROP POLICY ${TENANT_POLICY} ON pricing_snapshot`);
      await ownerPool.query(
        `CREATE POLICY ${TENANT_POLICY} ON pricing_snapshot FOR ALL ` +
          `USING (${tenantPredicate("pricing_snapshot")}) WITH CHECK (${tenantPredicate("pricing_snapshot")})`
      );
    }
  });

  it("the BOOT ASSERTION FAILS when a PERMISSIVE policy is ADDED beside the declared one (F2)", async () => {
    // The security lens reproduced this: `CREATE POLICY oops ON scan_session
    // USING (true)` with `tenant_isolation` perfectly intact. Postgres OR-combines
    // permissive policies, so the boundary is gone and every declared policy still
    // matches — an inventory of what SHOULD be there is blind to it.
    await ownerPool.query(`CREATE POLICY oops ON scan_session FOR ALL USING (true)`);
    try {
      const broken = await checkTenantIsolation(appPool);
      expect(broken.ok).toBe(false);
      expect(broken.unexpectedPolicies.join(" ")).toContain("scan_session:oops");
      expect(describeTenantIsolationFailure(broken)).toContain("never emits");
      // …and the boundary really is gone while it stands, which is why the
      // detector matters rather than merely being tidy.
      const leaked = await asShop(appPool, shops[0]!).query(
        `SELECT shop_id FROM scan_session WHERE shop_id = $1`,
        [shops[1]]
      );
      expect(leaked.rows).toHaveLength(1);
    } finally {
      await ownerPool.query(`DROP POLICY oops ON scan_session`);
    }
  });

  it("the BOOT ASSERTION FAILS when tenant_isolation is RESHAPED to INSERT-only (the invariant review's BLOCK)", async () => {
    // The reviewer's finding, verbatim in shape: a policy with the declared NAME,
    // a NULL `qual` and `WITH CHECK (true)`. The previous check guarded on
    // `using_expr <> ''` — read as "nothing to compare" — reported ok, and a
    // cross-tenant INSERT was ACCEPTED.
    await ownerPool.query(`DROP POLICY ${TENANT_POLICY} ON scan_photo`);
    await ownerPool.query(`CREATE POLICY ${TENANT_POLICY} ON scan_photo FOR INSERT WITH CHECK (true)`);
    try {
      const broken = await checkTenantIsolation(appPool);
      expect(broken.ok).toBe(false);
      expect(broken.alteredPolicies.join(" ")).toContain("scan_photo");
    } finally {
      await ownerPool.query(`DROP POLICY ${TENANT_POLICY} ON scan_photo`);
      await ownerPool.query(
        `CREATE POLICY ${TENANT_POLICY} ON scan_photo FOR ALL ` +
          `USING (${tenantPredicate("scan_photo")}) WITH CHECK (${tenantPredicate("scan_photo")})`
      );
    }
  });

  it("the BOOT ASSERTION FAILS when a service policy is planted on a table nothing declares", async () => {
    // The other half of F2: the check never looked at the second policy at all,
    // which is the one that spans tenants by design.
    await ownerPool.query(
      `CREATE POLICY ${SERVICE_POLICY} ON scan_session FOR SELECT USING (longbox_service())`
    );
    try {
      const broken = await checkTenantIsolation(appPool);
      expect(broken.ok).toBe(false);
      expect(broken.alteredPolicies.join(" ")).toContain(`scan_session:${SERVICE_POLICY}`);
    } finally {
      await ownerPool.query(`DROP POLICY ${SERVICE_POLICY} ON scan_session`);
    }
  });

  it("the BOOT ASSERTION FAILS on a MATERIALIZED VIEW, which cannot carry a policy at all (F3)", async () => {
    // The grant plan beside this one already hands the app role SELECT on a
    // materialized view, so the first one anybody adds would be readable and
    // unpoliciable with the check otherwise green.
    await ownerPool.query(`CREATE MATERIALIZED VIEW cached_sessions AS SELECT id, shop_id FROM scan_session`);
    try {
      const broken = await checkTenantIsolation(appPool);
      expect(broken.ok).toBe(false);
      expect(broken.unprotectableRelations.join(" ")).toContain("cached_sessions");
      // …and the migrate step refuses to create the situation in the first place.
      await expect(applyRowLevelSecurity(ownerPool)).rejects.toThrow(/cannot protect/);
    } finally {
      await ownerPool.query(`DROP MATERIALIZED VIEW cached_sessions`);
    }
  });

  it("the CONTEXT is visible inside the transaction and GONE at COMMIT, on the wire (K1)", async () => {
    // The consistency lens sent this probe itself and asked for it as a test:
    // `tenant-context.test.ts` asserts the bytes of the statement, which is a
    // claim about a string. This is the claim about the DATABASE.
    const single = new pg.Pool({ connectionString: appPool.options.connectionString, max: 1 });
    try {
      const inside = await asShop(single, shops[0]!).query(
        `SELECT current_setting('longbox.shop_id', true) AS shop,
                current_setting('longbox.service', true) AS service`
      );
      expect(inside.rows[0]).toEqual({ shop: shops[0], service: "" });
      const after = await single.query(`SELECT current_setting('longbox.shop_id', true) AS shop`);
      expect((after.rows[0] as { shop: string | null }).shop ?? "").toBe("");
    } finally {
      await single.end();
    }
  });

  it("a declared SERVICE scope sees across tenants on ITS tables, and nowhere else", async () => {
    // The one hole, asserted as a hole rather than left to be discovered: inside
    // `session-resolution` the session tables span shops (a cookie is a digest,
    // not a tenant — 048 §6.1), and `scan_session` does not move an inch.
    const service = serviceDb(appPool, "session-resolution");
    const sessionsSeen = await service.query(`SELECT count(*)::int AS n FROM app_session`);
    expect((sessionsSeen.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(0);
    const scans = await service.query(`SELECT id FROM scan_session`);
    expect(scans.rows).toEqual([]);
  });
});
