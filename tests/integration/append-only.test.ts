// L4: the Hickey model is enforced IN THE DATABASE (R1) — UPDATE and DELETE on
// event tables must be rejected by trigger, while the one permitted mutation
// (scan_session.status) still works.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createScanSession } from "../../src/services/scanSession.js";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("append-only triggers", () => {
  let pool: pg.Pool;
  let shopId: string;
  let sessionId: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_append_only_test");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    shopId = await seedShop(pool);
    sessionId = (await createScanSession(pool, shopId, "tester")).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function insertRow(table: string): Promise<string> {
    switch (table) {
      case "scan_photo": {
        const r = await pool.query(
          `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url) VALUES ($1,$2,'cover','x.jpg') RETURNING id`,
          [sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "candidate_set": {
        const r = await pool.query(
          `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates) VALUES ($1,$2,'barcode','[]') RETURNING id`,
          [sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "human_confirmation": {
        const r = await pool.query(
          `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source) VALUES ($1,$2,'{}','one_tap') RETURNING id`,
          [sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "condition_assessment": {
        const r = await pool.query(
          `INSERT INTO condition_assessment (scan_session_id, shop_id, grade_range_low, grade_range_high) VALUES ($1,$2,'FN','VF') RETURNING id`,
          [sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "pricing_snapshot": {
        const r = await pool.query(
          `INSERT INTO pricing_snapshot (scan_session_id, shop_id, query, suggested_cents) VALUES ($1,$2,'q',100) RETURNING id`,
          [sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "shopify_draft": {
        const r = await pool.query(
          `INSERT INTO shopify_draft (scan_session_id, shop_id, status) VALUES ($1,$2,'draft') RETURNING id`,
          [sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "cost_log": {
        const r = await pool.query(
          `INSERT INTO cost_log (shop_id, scan_session_id, provider, model) VALUES ($1,$2,'anthropic','claude-sonnet-5') RETURNING id`,
          [shopId, sessionId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      default:
        throw new Error(`no insert recipe for ${table}`);
    }
  }

  const eventTables = [
    "scan_photo",
    "candidate_set",
    "human_confirmation",
    "condition_assessment",
    "pricing_snapshot",
    "shopify_draft",
    "cost_log",
  ];

  for (const table of eventTables) {
    it(`rejects UPDATE and DELETE on ${table}`, async () => {
      const id = await insertRow(table);
      await expect(pool.query(`UPDATE ${table} SET shop_id = shop_id WHERE id = $1`, [id])).rejects.toThrow(
        /append-only/
      );
      await expect(pool.query(`DELETE FROM ${table} WHERE id = $1`, [id])).rejects.toThrow(/append-only/);
      // The row is still there, untouched.
      const check = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE id = $1`, [id]);
      expect((check.rows[0] as { n: number }).n).toBe(1);
    });
  }

  it("still allows the one permitted mutation: scan_session.status", async () => {
    await pool.query(`UPDATE scan_session SET status = 'confirmed' WHERE id = $1`, [sessionId]);
    const res = await pool.query(`SELECT status FROM scan_session WHERE id = $1`, [sessionId]);
    expect((res.rows[0] as { status: string }).status).toBe("confirmed");
  });
});
