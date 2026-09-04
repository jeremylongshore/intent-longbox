// L4: the Hickey model is enforced IN THE DATABASE (R1) — UPDATE and DELETE on
// event tables must be rejected by trigger, while the one permitted mutation
// (scan_session.status) still works.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createScanSession } from "../../src/services/scanSession.js";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { APPEND_ONLY_TABLES } from "../../src/db/appendOnlyTables.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("append-only triggers", () => {
  let pool: pg.Pool;
  let shopId: string;
  let sessionId: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_append_only_e02d05");
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
      // 003 (E02-D01): the 022 P7 lifecycle tables are event tables too.
      case "media_deletion": {
        // The tombstone names the SAME storage key as the photo it deletes —
        // a deletion pointing at some other key would tombstone nothing.
        const key = `key/${randomUUID()}`;
        const photo = await pool.query(
          `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url, storage_key, content_hash)
           VALUES ($1,$2,'cover','x.jpg',$3,'sha256:deadbeef') RETURNING id`,
          [sessionId, shopId, key]
        );
        const photoRow = photo.rows[0] as { id: string };
        const r = await pool.query(
          `INSERT INTO media_deletion (shop_id, scan_photo_id, storage_key, reason_code)
           VALUES ($1,$2,$3,'retention_sweep') RETURNING id`,
          [shopId, photoRow.id, key]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "retention_policy": {
        const r = await pool.query(
          `INSERT INTO retention_policy (shop_id, artifact_class, anchor, window_days, ceiling_days)
           VALUES ($1,'originals','draft_created',30,90) RETURNING id`,
          [shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "retention_hold": {
        const r = await pool.query(
          `INSERT INTO retention_hold (shop_id, target_table, target_id, reason, review_date)
           VALUES ($1,'scan_session',$2,'open return','2027-01-01') RETURNING id`,
          [shopId, sessionId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "retention_hold_release": {
        const hold = await pool.query(
          `INSERT INTO retention_hold (shop_id, target_table, target_id, reason, review_date)
           VALUES ($1,'scan_session',$2,'dispute closed','2027-01-01') RETURNING id`,
          [shopId, sessionId]
        );
        const r = await pool.query(
          `INSERT INTO retention_hold_release (hold_id, released_by) VALUES ($1,'tester') RETURNING id`,
          [(hold.rows[0] as { id: string }).id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      // E02-D05: 041 §1 E11 found this recipe set short of the declared trigger
      // list by exactly these three. A behavioural test that skips a table is a
      // table whose immutability nothing exercises, so they are covered now and
      // `eventTables` is derived from the declared list rather than hand-kept.
      case "corpus_version": {
        const r = await pool.query(
          `INSERT INTO corpus_version (source_set, notes) VALUES ('{}','test') RETURNING id`
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "llm_rerank": {
        const cs = await pool.query(
          `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates) VALUES ($1,$2,'barcode','[]') RETURNING id`,
          [sessionId, shopId]
        );
        const r = await pool.query(
          `INSERT INTO llm_rerank (candidate_set_id, scan_session_id, shop_id, provider, model, prompt_hash, response, confidence, band)
           VALUES ($1,$2,$3,'anthropic','claude-sonnet-5','sha256:abc','{}',0.9,'high') RETURNING id`,
          [(cs.rows[0] as { id: string }).id, sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "listing_status_observation": {
        const draft = await pool.query(
          `INSERT INTO shopify_draft (scan_session_id, shop_id, status) VALUES ($1,$2,'draft') RETURNING id`,
          [sessionId, shopId]
        );
        const r = await pool.query(
          `INSERT INTO listing_status_observation (shop_id, shopify_draft_id, observed_status, source)
           VALUES ($1,$2,'draft','watcher') RETURNING id`,
          [shopId, (draft.rows[0] as { id: string }).id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      default:
        throw new Error(`no insert recipe for ${table}`);
    }
  }

  // One declared list, three readers (041 §2.2 / §9.2 item 4): this suite is one of
  // them. Deriving the loop from APPEND_ONLY_TABLES means a new append-only table
  // cannot be added without either an insert recipe here or a red build.
  const eventTables = APPEND_ONLY_TABLES.map((t) => t.table);

  for (const table of eventTables) {
    it(`rejects UPDATE and DELETE on ${table}`, async () => {
      const id = await insertRow(table);
      await expect(pool.query(`UPDATE ${table} SET id = id WHERE id = $1`, [id])).rejects.toThrow(
        /append-only/
      );
      await expect(pool.query(`DELETE FROM ${table} WHERE id = $1`, [id])).rejects.toThrow(/append-only/);
      // The row is still there, untouched.
      const check = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE id = $1`, [id]);
      expect((check.rows[0] as { n: number }).n).toBe(1);
    });
  }

  // E02-D05 / 041 §9.2 item 1. Before migration 006 every trigger sat at the
  // Postgres default tgenabled='O' — "fire in ORIGIN role" — so the role that owns
  // the tables (today the same role the server uses: one DATABASE_URL) could turn
  // the whole Hickey guarantee off for a session with `SET
  // session_replication_role='replica'` and then UPDATE freely. At 'A' the trigger
  // fires in every replication role. The mirror-image negative — the same sequence
  // SUCCEEDING against an 'O' trigger, so this is not a claim that replica role is
  // simply inert here — is in migrations.test.ts.
  for (const table of eventTables) {
    it(`refuses UPDATE and DELETE on ${table} even in session_replication_role='replica'`, async () => {
      const id = await insertRow(table);
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await expect(client.query(`UPDATE ${table} SET id = id WHERE id = $1`, [id])).rejects.toThrow(
          /append-only \(Hickey model\): UPDATE not allowed/
        );
        await expect(client.query(`DELETE FROM ${table} WHERE id = $1`, [id])).rejects.toThrow(
          /append-only \(Hickey model\): DELETE not allowed/
        );
      } finally {
        await client.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
        client.release();
      }
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
