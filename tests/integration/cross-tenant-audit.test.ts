// L4: 019 T24's DAILY CROSS-TENANT AUDIT QUERY, against a real cluster.
//
// T24 asks for two instruments and this is the second. Row-level security
// PREVENTS a cross-tenant read; it does not DETECT one, and the two are different
// jobs: prevention answers "can this happen from here", detection answers "did it
// happen at all — through a path nobody policied, a migration data statement, an
// operator CLI, a restored dump". 034 §3.4 fixes what a hit means: *"Any
// occurrence in the daily cross-tenant audit query is K1 — pause live batches
// until the P0 bead closes with an invariant-review PASS."*
//
// The acting head ruled this INTO E03-B04 rather than leaving it with the
// schedule: the bead's own directive (019 §3.0 / 020) names the query and the
// heartbeat separately, and a bead that shipped the prevention and deferred the
// detection would have closed a non-waivable threshold with one of its two halves.
// The daily SCHEDULE and the T34 heartbeat remain E13-B04.1's.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { buildEdgeAudit, runCrossTenantAudit } from "../../scripts/crossTenantAudit.js";
import {
  appUrl,
  asShop,
  createFreshDb,
  probeDb,
  restoreFixture,
  runMigrations,
  seedShop,
} from "./helpers.js";
import { lockScanSession } from "../../src/services/scanSession.js";

/**
 * The fixed uuids `tests/fixtures/schema/after-033.sql` seeds (its generator
 * emits them from `FIXTURE_SEED`, never `gen_random_uuid()`). Named here because
 * the anchor-lock comparison below runs against that fixture on BOTH sides.
 */
const FIXTURE_SHOP = "11111111-1111-4111-8111-111111111111";
const FIXTURE_SESSION = "22222222-2222-4222-8222-222222222221";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("the cross-tenant audit query (019 T24, 034 §3.4)", () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let shopA: string;
  let shopB: string;
  let sessionA: string;
  let sessionB: string;
  let candidateA: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_cross_tenant_audit");
    await runMigrations(url);
    // THE OWNER, and only the owner. An audit for rows that cross tenants cannot
    // run under a tenant context: the context is exactly what hides the rows it
    // is looking for (056 §4).
    ownerPool = new pg.Pool({ connectionString: url });
    // The APPLICATION role, for the one case below that proves the boundary
    // itself permits the shape this query detects.
    appPool = new pg.Pool({ connectionString: appUrl(url) });
    shopA = await seedShop(ownerPool, { name: "Audit A", slug: `audit-a-${randomUUID()}` });
    shopB = await seedShop(ownerPool, { name: "Audit B", slug: `audit-b-${randomUUID()}` });
    sessionA = (await ownerPool.query(`INSERT INTO scan_session (shop_id) VALUES ($1) RETURNING id`, [shopA]))
      .rows[0] as string;
    sessionA = (sessionA as unknown as { id: string }).id;
    // Shop B's OWN anchor. From migration `034` a child row must name a session
    // in its own shop, so every planted row below that is not itself the thing
    // under test needs a legitimate anchor to hang from.
    sessionB = (
      (await ownerPool.query(`INSERT INTO scan_session (shop_id) VALUES ($1) RETURNING id`, [shopB]))
        .rows[0] as { id: string }
    ).id;
    // A SIBLING of shop A's session, for the edge `034` does not close.
    candidateA = (
      (
        await ownerPool.query(
          `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates)
           VALUES ($1, $2, 'barcode', '[]'::jsonb) RETURNING id`,
          [sessionA, shopA]
        )
      ).rows[0] as { id: string }
    ).id;
  }, 180_000);

  afterAll(async () => {
    await appPool?.end();
    await ownerPool?.end();
  });

  it("derives its edges from the catalog rather than from a list", async () => {
    const result = await runCrossTenantAudit(ownerPool);
    // Every FK between two shop-scoped tables, including the composite ones that
    // carry `shop_id` on both sides and therefore always count zero — an audit
    // that skipped the edges the schema already makes safe could not prove they
    // still are.
    expect(result.edges).toBeGreaterThan(40);
    expect(result.findings.length).toBe(result.edges + 1);
  });

  it("counts ZERO on a clean seed, and says how many edges it looked at", async () => {
    const result = await runCrossTenantAudit(ownerPool);
    expect(result.clean).toBe(true);
    expect(result.findings.filter((f) => f.mismatches > 0)).toEqual([]);
  });

  it("FIRES on one planted cross-tenant row, and names the edge and nothing else", async () => {
    // ⚠ THIS CASE MOVED EDGES AT E03-D19, AND THE MOVE IS THE POINT.
    //
    // It used to plant a `scan_photo` naming another shop's session, because
    // `scan_photo → scan_session` was a SINGLE-column foreign key and the check
    // bypasses row-level security (056 §11 R7, 016 C46). Migration `034` re-points
    // all ten ANCHOR edges at `(scan_session_id, shop_id) → (id, shop_id)`, so that
    // row is now unrepresentable — for the owner as much as for the app role, since
    // a constraint has no `tgenabled` and no role exemption.
    //
    // So the plant moves to a SIBLING edge, which `034` deliberately does not
    // close: `llm_rerank.candidate_set_id → candidate_set(id)` is still a
    // single-column foreign key, and the row below is legitimate on the anchor
    // (shop B's own session) and crosses tenants on the sibling. That is exactly
    // the remainder 056 R11 records, and it is why this query is not a formality.
    const planted = (
      await ownerPool.query(
        `INSERT INTO llm_rerank
           (candidate_set_id, scan_session_id, shop_id, provider, model, prompt_hash, response, band)
         VALUES ($1, $2, $3, 'anthropic', 'stub', 'deadbeef', '{}'::jsonb, 'low') RETURNING id`,
        [candidateA, sessionB, shopB]
      )
    ).rows[0] as { id: string };
    try {
      const result = await runCrossTenantAudit(ownerPool);
      expect(result.clean).toBe(false);
      const hit = result.findings.find((f) => f.mismatches > 0);
      expect(hit).toBeDefined();
      expect(hit!.check).toBe("llm_rerank → candidate_set");
      expect(hit!.mismatches).toBe(1);
      // It reports a COUNT and an edge. Nothing in a finding could put one shop's
      // data — or a person's — into a log a scheduler collects (022 P3, 019 T35).
      expect(JSON.stringify(hit)).not.toContain(planted.id);
      expect(JSON.stringify(hit)).not.toContain(shopB);
    } finally {
      await ownerPool.query(`ALTER TABLE llm_rerank DISABLE TRIGGER llm_rerank_append_only`);
      await ownerPool.query(`DELETE FROM llm_rerank WHERE id = $1`, [planted.id]);
      await ownerPool.query(`ALTER TABLE llm_rerank ENABLE ALWAYS TRIGGER llm_rerank_append_only`);
    }
  });

  it("REFUSES the row the APPLICATION role used to be able to attach across tenants", async () => {
    // ⚠ THIS TEST FLIPPED AT E03-D19 (`longbox-e5b.3.29`, migration `034`). Until
    // then it DOCUMENTED a successful cross-tenant attachment and asserted that the
    // daily audit found it; now it asserts the write never lands.
    //
    // The old comment, which was true and is now history: the row's `shop_id` is B
    // so `tenant_isolation`'s WITH CHECK passes, and the foreign key resolved shop
    // A's session because an FK check runs with row-level security OFF (016 C46).
    // 056 R7's sentence — *"the boundary prevents READING across tenants and does
    // not prevent WRITING across them by reference"* — was the consequence.
    //
    // ⚠ **IT IS THE CONSTRAINT THAT REFUSES, NOT THE POLICY, AND THE DIFFERENCE
    // MATTERS.** The row is B's, so `WITH CHECK` still passes; what fails is
    // `scan_photo_session_same_shop`, because the pair `(shop A's session, shop B)`
    // is not in `scan_session`. So the SQLSTATE is `23503` (foreign_key_violation)
    // and NOT `42501` (the RLS refusal) — the third probe below is the one that
    // still answers `42501`, and keeping the two apart is what makes this an
    // assertion about the mechanism rather than about the outcome.
    await expect(
      asShop(appPool, shopB).query(
        `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url)
         VALUES ($1, $2, 'cover', '/tmp/attached.png') RETURNING id`,
        [sessionA, shopB]
      )
    ).rejects.toMatchObject({ code: "23503", constraint: "scan_photo_session_same_shop" });

    // Nothing landed, on either side of the boundary.
    const anywhere = await ownerPool.query(
      `SELECT count(*)::int AS n FROM scan_photo WHERE storage_url = '/tmp/attached.png'`
    );
    expect((anywhere.rows[0] as { n: number }).n).toBe(0);
    expect((await runCrossTenantAudit(ownerPool)).clean).toBe(true);
  });

  it("answers a FOREIGN session id and a NEVER-EXISTED one identically, byte for byte", async () => {
    // 056 §6.3's existence-oracle question, asked of the write path after `034`.
    //
    // Before `034` the two cases were DISTINGUISHABLE: naming another shop's
    // session SUCCEEDED and naming a uuid that exists nowhere raised `23503`, so
    // the pair was a one-bit oracle over a value the caller must already possess.
    // After `034` the constraint needs the PAIR, so a foreign session id combined
    // with the caller's own `shop_id` is absent from `scan_session` for exactly the
    // same reason a random uuid is — and the two errors are the same error.
    //
    // The comparison is over every field a client could see: SQLSTATE, message,
    // detail, schema, table and constraint. Two mechanisms compose to make it hold,
    // and only the first is this bead's:
    //
    //   1. the composite key makes both OUTCOMES a refusal;
    //   2. `029`'s policy on `scan_session` means the app role cannot read the
    //      referenced table, so PostgreSQL emits the generic *"Key is not present
    //      in table"* detail instead of echoing the key. Belt and braces: even the
    //      echoing form would only have repeated values the caller itself supplied.
    const attempt = async (sessionId: string): Promise<Record<string, unknown>> => {
      let caught: unknown;
      let landed = false;
      try {
        await asShop(appPool, shopB).query(
          `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url)
           VALUES ($1, $2, 'cover', '/tmp/oracle.png')`,
          [sessionId, shopB]
        );
        landed = true;
      } catch (err) {
        caught = err;
      }
      if (landed) throw new Error("expected the insert to be refused, and it was not");
      const e = caught as {
        code?: string;
        message?: string;
        detail?: string;
        schema?: string;
        table?: string;
        constraint?: string;
      };
      return {
        code: e.code,
        message: e.message,
        detail: e.detail,
        schema: e.schema,
        table: e.table,
        constraint: e.constraint,
      };
    };

    const foreignSession = await attempt(sessionA);
    const neverExisted = await attempt(randomUUID());
    expect(foreignSession).toEqual(neverExisted);
    expect(foreignSession["code"]).toBe("23503");
    // The detail names no key values, so it cannot carry the id back either.
    expect(String(foreignSession["detail"])).not.toContain(sessionA);
  });

  it("still answers 42501 when the row itself belongs to another tenant", async () => {
    // 016 C46 probe (iii), unchanged by `034` and asserted so it stays unchanged.
    // Here the row's OWN `shop_id` is A while the context is B, so the policy is
    // what refuses — the constraint is never reached. A change that collapsed this
    // into `23503` would mean the WITH CHECK had stopped running.
    await expect(
      asShop(appPool, shopB).query(
        `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url)
         VALUES ($1, $2, 'cover', '/tmp/wrong-tenant.png')`,
        [sessionA, shopA]
      )
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("does not let the same-shop write path regress — the pilot flow still inserts", async () => {
    // The control. A constraint that refused the legitimate write would pass every
    // assertion above and break the counter, so the happy path is asserted beside
    // the refusals rather than assumed from them.
    const ok = await asShop(appPool, shopB).query(
      `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url)
       VALUES ($1, $2, 'cover', '/tmp/legitimate.png') RETURNING id`,
      [sessionB, shopB]
    );
    expect(ok.rows).toHaveLength(1);
    expect((await runCrossTenantAudit(ownerPool)).clean).toBe(true);
  });

  it("keys every one of the ten scan_session children on the pair, per the catalog", async () => {
    // The schema assertion behind all of the above: read from `pg_constraint`
    // rather than from the migration text, because what protects the rows is what
    // the catalog holds — and a later migration that dropped one of these would
    // otherwise be caught by nothing.
    const rows = (
      await ownerPool.query(
        `SELECT c.relname::text AS child,
                (SELECT array_agg(a.attname::text ORDER BY x.ord)
                   FROM unnest(k.conkey) WITH ORDINALITY AS x(attnum, ord)
                   JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = x.attnum) AS cols,
                k.convalidated AS validated
           FROM pg_constraint k
           JOIN pg_class c ON c.oid = k.conrelid
           JOIN pg_class cf ON cf.oid = k.confrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE k.contype = 'f' AND n.nspname = 'public' AND cf.relname = 'scan_session'
          ORDER BY 1`
      )
    ).rows as Array<{ child: string; cols: string[]; validated: boolean }>;

    expect(rows.map((r) => r.child)).toEqual([
      "candidate_set",
      "condition_assessment",
      "cost_log",
      "human_confirmation",
      "llm_rerank",
      "outbox",
      "pricing_snapshot",
      "scan_photo",
      "scan_session_transition",
      "shopify_draft",
    ]);
    // Every edge composite, every edge VALIDATED. A constraint left `NOT VALID`
    // would refuse new rows and vouch for none of the existing ones, which is a
    // weaker guarantee wearing the same name.
    for (const row of rows) {
      expect(row.cols).toEqual(["scan_session_id", "shop_id"]);
      expect(row.validated).toBe(true);
    }
  });

  it("changes NOTHING about the anchor lock: a child INSERT waits exactly as it did at 033", async () => {
    // 042 §5.3(b) / I22. `034` widens `scan_session`'s KEY attribute set from
    // `{id}` to `{id, shop_id}`, which is the kind of change that can quietly move
    // a tuple lock, so the question is worth asking. **The answer is that it moves
    // nothing, and the honest form of that claim is a COMPARISON rather than an
    // outcome.**
    //
    // ⚠ **THE ANCHOR LOCK IS `FOR UPDATE`, NOT `FOR NO KEY UPDATE`** — 042:422,
    // I22 (042 §11), 041 §4.2, and `lockScanSession` itself, which this case takes
    // the lock THROUGH rather than hand-writing. `FOR NO KEY UPDATE` is
    // `app_session`'s lock, one position earlier in the same order. An earlier
    // draft of this case hand-wrote `FOR NO KEY UPDATE`, a mode no handler uses,
    // and therefore asserted PostgreSQL's conflict matrix rather than anything
    // about Longbox. Under the real `FOR UPDATE` a child INSERT **does** wait, and
    // asserting that it does not would have been asserting a falsehood.
    //
    // So the load-bearing property is the one this asserts: the wait is IDENTICAL
    // before and after `034`. The comparison is run against two live databases —
    // the `after-033` fixture restored untouched (single-column edges) and the same
    // fixture migrated to head (composite edges) — and both are given the same
    // session, the same held lock and the same 3-second `statement_timeout`.
    const probe = async (url: string): Promise<string> => {
      // A POOL, because `lockScanSession` takes the `Tx` the handlers take —
      // a `PoolClient` — and taking the lock through anything else would be
      // re-hand-writing the statement this case exists to stop hand-writing.
      const pool = new pg.Pool({ connectionString: url });
      const holder = await pool.connect();
      const waiter = await pool.connect();
      try {
        await holder.query("BEGIN");
        // THE REAL LOCK, through the real function (042 §5.3(b), 041 §4.2).
        const locked = await lockScanSession(holder, FIXTURE_SHOP, FIXTURE_SESSION);
        // Not merely "defined": the lock is shop-scoped by predicate (T24), so a
        // probe that locked NOTHING would sail past a presence check and then
        // report "no wait" for the wrong reason entirely.
        expect(locked?.id).toBe(FIXTURE_SESSION);
        expect(locked?.shop_id).toBe(FIXTURE_SHOP);

        await waiter.query(`SET statement_timeout = '3s'`);
        try {
          await waiter.query(
            `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url)
             VALUES ($1, $2, 'cover', '/tmp/concurrent.png')`,
            [FIXTURE_SESSION, FIXTURE_SHOP]
          );
          return "inserted";
        } catch (err) {
          return (err as { code?: string }).code ?? "unknown";
        }
      } finally {
        await holder.query("ROLLBACK").catch(() => undefined);
        holder.release();
        waiter.release();
        await pool.end().catch(() => undefined);
      }
    };

    const before = await createFreshDb("longbox_anchor_lock_033");
    await restoreFixture(before, "tests/fixtures/schema/after-033.sql");
    const after = await createFreshDb("longbox_anchor_lock_head");
    await restoreFixture(after, "tests/fixtures/schema/after-033.sql");
    await runMigrations(after);

    const atThirtyThree = await probe(before);
    const atHead = await probe(after);

    // `57014` — query_canceled. The INSERT waits on the parent tuple the anchor
    // holds, and the timeout is what ends the wait. It is the same answer on both
    // sides, which is the whole assertion: `034` did not make the write path wait
    // where it did not, and did not stop it waiting where it did.
    expect(atThirtyThree).toBe("57014");
    expect(atHead).toBe(atThirtyThree);
  }, 180_000);

  it("FIRES on an operator session standing on no grant at its own shop", async () => {
    // The second predicate the ruling asks for, and the one place it is definable:
    // an operator session names a person AND a shop, and 048 §6.1 says the person
    // must hold a membership there. A row failing it is either a session issued
    // for a shop its person never joined, or a membership that ended without its
    // sessions ending — both K1 under 034 §3.4.
    const person = (
      await ownerPool.query(
        `INSERT INTO app_user (email, display_name) VALUES ($1, 'Audit Person') RETURNING id`,
        [`audit-${randomUUID()}@example.invalid`]
      )
    ).rows[0] as { id: string };
    const location = (
      await ownerPool.query(
        `INSERT INTO location (shop_id, kind, name) VALUES ($1,'store','Counter') RETURNING id`,
        [shopA]
      )
    ).rows[0] as { id: string };
    const device = (
      await ownerPool.query(
        `INSERT INTO device (shop_id, location_id, label, kind) VALUES ($1,$2,'phone','phone') RETURNING id`,
        [shopA, location.id]
      )
    ).rows[0] as { id: string };
    const credential = (
      await ownerPool.query(
        `INSERT INTO device_credential (shop_id, device_id, token_hash) VALUES ($1,$2,$3) RETURNING id`,
        [shopA, device.id, randomUUID()]
      )
    ).rows[0] as { id: string };
    // An operator session STANDS ON a device session — `app_session_kind_shape`
    // makes any other pairing unrepresentable (048 §3.6) — so the fixture builds
    // the phone's session first and hangs the person's off it. That is the shape
    // the audit is about: the pairing is legal, the GRANT is what is missing.
    const deviceChain = randomUUID();
    const deviceSession = (
      await ownerPool.query(
        `INSERT INTO app_session
           (chain_id, kind, shop_id, location_id, device_id, device_credential_id,
            token_hash, rotate_after, idle_expires_at, absolute_expires_at)
         VALUES ($1,'device',$2,$3,$4,$5,$6, now() + interval '1 hour',
                 now() + interval '1 hour', now() + interval '2 hours')
         RETURNING id`,
        [deviceChain, shopA, location.id, device.id, credential.id, randomUUID()]
      )
    ).rows[0] as { id: string };
    const chain = randomUUID();
    const planted = (
      await ownerPool.query(
        `INSERT INTO app_session
           (chain_id, kind, shop_id, location_id, device_id, device_credential_id, app_user_id,
            parent_session_id, parent_chain_id,
            token_hash, rotate_after, idle_expires_at, absolute_expires_at)
         VALUES ($1,'operator',$2,$3,$4,$5,$6,$7,$8,$9, now() + interval '1 hour',
                 now() + interval '1 hour', now() + interval '2 hours')
         RETURNING id`,
        [
          chain,
          shopA,
          location.id,
          device.id,
          credential.id,
          person.id,
          deviceSession.id,
          deviceChain,
          randomUUID(),
        ]
      )
    ).rows[0] as { id: string };
    try {
      const result = await runCrossTenantAudit(ownerPool);
      expect(result.clean).toBe(false);
      const hit = result.findings.find((f) => f.check.includes("without a grant"));
      expect(hit?.mismatches).toBe(1);
    } finally {
      await ownerPool.query(`ALTER TABLE app_session DISABLE TRIGGER app_session_append_only`);
      await ownerPool.query(`DELETE FROM app_session WHERE id = ANY($1::uuid[])`, [
        [planted.id, deviceSession.id],
      ]);
      await ownerPool.query(`ALTER TABLE app_session ENABLE ALWAYS TRIGGER app_session_append_only`);
    }
  });

  it("builds each edge's query from the catalog's own column pairs", () => {
    // The query is generated, so this is the assertion that it is generated
    // CORRECTLY — a composite FK joins on every column pair, not on the first.
    const sql = buildEdgeAudit({
      constraint: "probe",
      child: "human_confirmation",
      parent: "scan_session",
      childColumns: ["scan_session_id", "shop_id"],
      parentColumns: ["id", "shop_id"],
    });
    expect(sql).toContain("c.scan_session_id = p.id AND c.shop_id = p.shop_id");
    expect(sql).toContain("c.shop_id IS DISTINCT FROM p.shop_id");
  });

  it("refuses an identifier the catalog could not have produced", () => {
    expect(() =>
      buildEdgeAudit({
        constraint: "probe",
        child: 'scan_photo"; DROP TABLE shop; --',
        parent: "scan_session",
        childColumns: ["scan_session_id"],
        parentColumns: ["id"],
      })
    ).toThrow(/unsafe identifier/);
  });
});
