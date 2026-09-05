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
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("the cross-tenant audit query (019 T24, 034 §3.4)", () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let shopA: string;
  let shopB: string;
  let sessionA: string;

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
    // `scan_photo → scan_session` is a SINGLE-column FK, so a row bound to another
    // shop's session is insertable by the owner — which is 056 §11 R7's residual
    // seen from the detection side: the FK check bypasses row-level security, so
    // prevention alone does not cover this and detection is the instrument.
    const planted = (
      await ownerPool.query(
        `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url)
         VALUES ($1, $2, 'cover', '/tmp/x.png') RETURNING id`,
        [sessionA, shopB]
      )
    ).rows[0] as { id: string };
    try {
      const result = await runCrossTenantAudit(ownerPool);
      expect(result.clean).toBe(false);
      const hit = result.findings.find((f) => f.mismatches > 0);
      expect(hit).toBeDefined();
      expect(hit!.check).toBe("scan_photo → scan_session");
      expect(hit!.mismatches).toBe(1);
      // It reports a COUNT and an edge. Nothing in a finding could put one shop's
      // data — or a person's — into a log a scheduler collects (022 P3, 019 T35).
      expect(JSON.stringify(hit)).not.toContain(planted.id);
      expect(JSON.stringify(hit)).not.toContain(shopB);
    } finally {
      await ownerPool.query(`ALTER TABLE scan_photo DISABLE TRIGGER scan_photo_append_only`);
      await ownerPool.query(`DELETE FROM scan_photo WHERE id = $1`, [planted.id]);
      await ownerPool.query(`ALTER TABLE scan_photo ENABLE ALWAYS TRIGGER scan_photo_append_only`);
    }
  });

  it("FIRES on a row the APPLICATION role attached across tenants under its own context", async () => {
    // The sharpest form of 056 R7, and the reason this query is not a formality.
    // The case above plants the row as the schema owner, which proves the query
    // works. This one plants it as `longbox_app` inside shop B's own tenant
    // context — every policy in force, nothing bypassed:
    //
    //   the row's `shop_id` is B, so `tenant_isolation`'s WITH CHECK passes;
    //   the FK resolves shop A's session, because a foreign-key check runs with
    //   row-level security OFF and therefore cannot see the policy.
    //
    // So the boundary PREVENTS reading across tenants and does NOT prevent
    // writing across them by reference. Detection is the only instrument that
    // covers it until proposed E03-D19 re-points the FK at `(id, shop_id)`.
    const planted = (
      await asShop(appPool, shopB).query(
        `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url)
         VALUES ($1, $2, 'cover', '/tmp/attached.png') RETURNING id`,
        [sessionA, shopB]
      )
    ).rows[0] as { id: string };
    try {
      // The app role cannot even SEE the parent it just pointed at.
      const parent = await asShop(appPool, shopB).query(`SELECT id FROM scan_session WHERE id = $1`, [
        sessionA,
      ]);
      expect(parent.rows).toEqual([]);

      const result = await runCrossTenantAudit(ownerPool);
      expect(result.clean).toBe(false);
      const hit = result.findings.find((f) => f.check === "scan_photo → scan_session");
      expect(hit?.mismatches).toBe(1);
      expect(JSON.stringify(hit)).not.toContain(planted.id);
    } finally {
      await ownerPool.query(`ALTER TABLE scan_photo DISABLE TRIGGER scan_photo_append_only`);
      await ownerPool.query(`DELETE FROM scan_photo WHERE id = $1`, [planted.id]);
      await ownerPool.query(`ALTER TABLE scan_photo ENABLE ALWAYS TRIGGER scan_photo_append_only`);
    }
  });

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
