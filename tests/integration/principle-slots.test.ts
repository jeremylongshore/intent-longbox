// L4: the slots migration 003 reserves for the ratified workplace principles
// actually behave the way 022 says they do — because a principle whose mechanism
// the schema cannot execute is a sentence, not a control (022 P7 NOT-YET-ENFORCED).
//
// Bead longbox-e5b.2.11 (E02-D01). Traced to R1 (append-only event trail) in
// tests/RTM.md; docs 022 P2/P3/P7, 019 T32/T33/T35.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createScanSession } from "../../src/services/scanSession.js";
import { DEFAULT_RETENTION } from "../../scripts/retention-defaults.js";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const execFileAsync = promisify(execFile);

const dbUp = await probeDb();

describe.skipIf(!dbUp)("003 principle slots", () => {
  let pool: pg.Pool;
  let shopId: string;
  let sessionId: string;
  let dbUrl: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_principle_slots_test");
    dbUrl = url;
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    shopId = await seedShop(pool);
    sessionId = (await createScanSession(pool, shopId)).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  // --- P7: scan_photo storage key + content hash -----------------------------
  it("accepts a legacy scan_photo with neither storage_key nor content_hash", async () => {
    const r = await pool.query(
      `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url)
       VALUES ($1,$2,'cover','legacy.jpg') RETURNING storage_key, content_hash`,
      [sessionId, shopId]
    );
    const row = r.rows[0] as { storage_key: string | null; content_hash: string | null };
    expect(row.storage_key).toBeNull();
    expect(row.content_hash).toBeNull();
  });

  it("rejects a scan_photo with a storage_key but no content_hash", async () => {
    await expect(
      pool.query(
        `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url, storage_key)
         VALUES ($1,$2,'cover','x.jpg','key/no-hash')`,
        [sessionId, shopId]
      )
    ).rejects.toThrow(/scan_photo_storage_key_hashed/);
  });

  // --- P3: actor attribution slots ------------------------------------------
  it("defaults actor_verified to false on every actor-bearing table (pre-G2 rows are not attributable)", async () => {
    const session = await pool.query(`SELECT operator_id, actor_verified FROM scan_session WHERE id = $1`, [
      sessionId,
    ]);
    const row = session.rows[0] as { operator_id: string | null; actor_verified: boolean };
    expect(row.operator_id).toBeNull();
    expect(row.actor_verified).toBe(false);

    for (const table of ["human_confirmation", "condition_assessment", "pricing_snapshot"]) {
      const cols = await pool.query(
        `SELECT column_name, is_nullable, column_default FROM information_schema.columns
         WHERE table_name = $1 AND column_name IN ('operator_id','actor_verified')
         ORDER BY column_name`,
        [table]
      );
      const got = cols.rows as { column_name: string; is_nullable: string; column_default: string | null }[];
      expect(got.map((c) => c.column_name)).toEqual(["actor_verified", "operator_id"]);
      expect(got[0]!.is_nullable).toBe("NO");
      expect(got[0]!.column_default).toContain("false");
      expect(got[1]!.is_nullable).toBe("YES");
    }
  });

  // --- P2: supersession + current read model --------------------------------
  it("supersedes a condition_assessment with a new row; only the newer one is current", async () => {
    const session = (await createScanSession(pool, shopId)).id;
    const first = await pool.query(
      `INSERT INTO condition_assessment (scan_session_id, shop_id, grade_range_low, grade_range_high)
       VALUES ($1,$2,'GD','VG') RETURNING id`,
      [session, shopId]
    );
    const firstId = (first.rows[0] as { id: string }).id;
    const second = await pool.query(
      // `session_seq` is set because `migrations/013` refuses a superseding row
      // without one (041 §3.3's single writer, stated in the database).
      `INSERT INTO condition_assessment (scan_session_id, shop_id, grade_range_low, grade_range_high,
                                         supersedes_id, session_seq)
       VALUES ($1,$2,'FN','VF',$3,
               (SELECT coalesce(max(session_seq), 0) + 1 FROM condition_assessment WHERE scan_session_id = $1))
       RETURNING id`,
      [session, shopId, firstId]
    );
    const secondId = (second.rows[0] as { id: string }).id;

    // History is intact: both rows are still there.
    const all = await pool.query(
      `SELECT count(*)::int AS n FROM condition_assessment WHERE scan_session_id = $1`,
      [session]
    );
    expect((all.rows[0] as { n: number }).n).toBe(2);

    const current = await pool.query(
      `SELECT id, grade_range_low, grade_range_high FROM condition_assessment_current WHERE scan_session_id = $1`,
      [session]
    );
    expect(current.rows).toHaveLength(1);
    const row = current.rows[0] as { id: string; grade_range_low: string; grade_range_high: string };
    expect(row.id).toBe(secondId);
    expect(row.grade_range_low).toBe("FN");
    expect(row.grade_range_high).toBe("VF");
  });

  it("lets a row be superseded at most once", async () => {
    const session = (await createScanSession(pool, shopId)).id;
    const first = await pool.query(
      `INSERT INTO pricing_snapshot (scan_session_id, shop_id, query, suggested_cents)
       VALUES ($1,$2,'q',100) RETURNING id`,
      [session, shopId]
    );
    const firstId = (first.rows[0] as { id: string }).id;
    await pool.query(
      `INSERT INTO pricing_snapshot (scan_session_id, shop_id, query, suggested_cents, supersedes_id, session_seq)
       VALUES ($1,$2,'q',200,$3,
               (SELECT coalesce(max(session_seq), 0) + 1 FROM pricing_snapshot WHERE scan_session_id = $1))`,
      [session, shopId, firstId]
    );
    await expect(
      pool.query(
        `INSERT INTO pricing_snapshot (scan_session_id, shop_id, query, suggested_cents, supersedes_id, session_seq)
         VALUES ($1,$2,'q',300,$3,
                 (SELECT coalesce(max(session_seq), 0) + 1 FROM pricing_snapshot WHERE scan_session_id = $1))`,
        [session, shopId, firstId]
      )
    ).rejects.toThrow(/pricing_snapshot_supersedes_once_idx/);

    const current = await pool.query(
      `SELECT suggested_cents FROM pricing_snapshot_current WHERE scan_session_id = $1`,
      [session]
    );
    expect(current.rows).toHaveLength(1);
    expect((current.rows[0] as { suggested_cents: number }).suggested_cents).toBe(200);
  });

  it("resolves a supersession chain deeper than one hop: A <- B <- C returns C only", async () => {
    const session = (await createScanSession(pool, shopId)).id;
    const insert = async (source: string, supersedes: string | null): Promise<string> => {
      const r = await pool.query(
        `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source, supersedes_id, session_seq)
         VALUES ($1,$2,$3,$4,$5,
                 (SELECT coalesce(max(session_seq), 0) + 1 FROM human_confirmation WHERE scan_session_id = $1))
         RETURNING id`,
        [session, shopId, JSON.stringify({ pick: source }), source, supersedes]
      );
      return (r.rows[0] as { id: string }).id;
    };
    const a = await insert("one_tap", null);
    const b = await insert("grid_pick", a);
    const c = await insert("manual_search", b);

    // All three survive; only the tail of the chain is current.
    const all = await pool.query(
      `SELECT count(*)::int AS n FROM human_confirmation WHERE scan_session_id = $1`,
      [session]
    );
    expect((all.rows[0] as { n: number }).n).toBe(3);

    const current = await pool.query(
      `SELECT id, source FROM human_confirmation_current WHERE scan_session_id = $1`,
      [session]
    );
    expect(current.rows).toHaveLength(1);
    const row = current.rows[0] as { id: string; source: string };
    expect(row.id).toBe(c);
    expect(row.source).toBe("manual_search");
    expect([a, b]).not.toContain(row.id);
  });

  // --- P7: media_deletion ----------------------------------------------------
  it("makes deletion idempotent per storage object (UNIQUE storage_key)", async () => {
    const key = `key/${randomUUID()}`;
    const photo = await pool.query(
      `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url, storage_key, content_hash)
       VALUES ($1,$2,'cover','x.jpg',$3,'sha256:abc') RETURNING id`,
      [sessionId, shopId, key]
    );
    const photoId = (photo.rows[0] as { id: string }).id;
    await pool.query(
      `INSERT INTO media_deletion (shop_id, scan_photo_id, storage_key, reason_code, requested_by)
       VALUES ($1,$2,$3,'seller_revocation','counter')`,
      [shopId, photoId, key]
    );
    await expect(
      pool.query(
        `INSERT INTO media_deletion (shop_id, scan_photo_id, storage_key, reason_code)
         VALUES ($1,$2,$3,'retention_sweep')`,
        [shopId, photoId, key]
      )
    ).rejects.toThrow(/media_deletion_storage_key_key|duplicate key/);

    // The scan_photo row survives the deletion of its object (018 C5).
    const still = await pool.query(`SELECT count(*)::int AS n FROM scan_photo WHERE id = $1`, [photoId]);
    expect((still.rows[0] as { n: number }).n).toBe(1);
  });

  it("accepts an unregistered reason_code (open world, no CHECK enum)", async () => {
    const key = `key/${randomUUID()}`;
    const photo = await pool.query(
      `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url, storage_key, content_hash)
       VALUES ($1,$2,'cover','x.jpg',$3,'sha256:abc') RETURNING id`,
      [sessionId, shopId, key]
    );
    const r = await pool.query(
      `INSERT INTO media_deletion (shop_id, scan_photo_id, storage_key, reason_code)
       VALUES ($1,$2,$3,'a_reason_nobody_wrote_down_yet') RETURNING reason_code`,
      [shopId, (photo.rows[0] as { id: string }).id, key]
    );
    expect((r.rows[0] as { reason_code: string }).reason_code).toBe("a_reason_nobody_wrote_down_yet");
  });

  // --- P7: listing lifecycle states -----------------------------------------
  it("accepts the delisted and archived shopify_draft states the T19 watcher needs", async () => {
    for (const status of ["delisted", "archived"]) {
      const r = await pool.query(
        `INSERT INTO shopify_draft (scan_session_id, shop_id, status) VALUES ($1,$2,$3) RETURNING status`,
        [sessionId, shopId, status]
      );
      expect((r.rows[0] as { status: string }).status).toBe(status);
    }
    await expect(
      pool.query(`INSERT INTO shopify_draft (scan_session_id, shop_id, status) VALUES ($1,$2,'sold')`, [
        sessionId,
        shopId,
      ])
    ).rejects.toThrow(/shopify_draft_status_check/);
  });

  // --- P7 Q6: retention policy + holds ---------------------------------------
  // The seed block backfills shops that existed WHEN THE MIGRATION RAN (a fresh
  // test database has none, which is why `shopId` above has no policies).
  // scripts/register-shop.ts covers shops created afterwards. Re-applying the
  // file is how we exercise the seed and its WHERE NOT EXISTS guard together.
  it("seeds the three default retention policies for every existing shop, once", async () => {
    const seeded = await seedShop(pool, { slug: `retention-${randomUUID()}` });
    const sql = await readFile(
      new URL("../../migrations/003_reserve_principle_slots.sql", import.meta.url),
      "utf8"
    );
    await pool.query(sql);

    // The expectation is DEFAULT_RETENTION itself, not a hand-copied literal:
    // if the migration's §8 seed and the register-shop path ever disagree, this
    // fails. Item 7 of the E02-D01 review.
    const expected = [...DEFAULT_RETENTION]
      .map((p) => ({
        artifact_class: p.artifactClass,
        anchor: p.anchor,
        window_days: p.windowDays,
        ceiling_days: p.ceilingDays,
      }))
      .sort((a, b) => a.artifact_class.localeCompare(b.artifact_class));
    const read = async (): Promise<unknown[]> =>
      (
        await pool.query(
          `SELECT artifact_class, anchor, window_days, ceiling_days FROM retention_policy
           WHERE shop_id = $1 ORDER BY artifact_class`,
          [seeded]
        )
      ).rows;
    expect(await read()).toEqual(expected);

    // Second application seeds nothing further.
    await pool.query(sql);
    expect(await read()).toEqual(expected);
  });

  it("seeds identical policies whether the shop came from the migration or register-shop", async () => {
    // Two shops, two code paths: one seeded by re-applying migration 003's §8
    // block, one seeded by running scripts/register-shop.ts against the same
    // database. The rows must be indistinguishable.
    const migrated = await seedShop(pool, { slug: `via-migration-${randomUUID()}` });
    const sql = await readFile(
      new URL("../../migrations/003_reserve_principle_slots.sql", import.meta.url),
      "utf8"
    );
    await pool.query(sql);

    const slug = `via-script-${randomUUID()}`.slice(0, 40);
    // `--no-recovery-contact` is REQUIRED from E03-D06 (048 §8.2): the recovery
    // nomination is asked at registration and may be DECLINED, but it may not be
    // skipped — the difference between "this owner has no second person" and
    // "nobody asked" is the difference between a known residual and a surprise
    // during an outage. A fixture shop declines, explicitly.
    await execFileAsync(
      "pnpm",
      ["exec", "tsx", "scripts/register-shop.ts", "--name", slug, "--slug", slug, "--no-recovery-contact"],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: dbUrl },
      }
    );

    const rowsFor = async (where: string, param: string): Promise<unknown[]> =>
      (
        await pool.query(
          `SELECT rp.artifact_class, rp.anchor, rp.window_days, rp.ceiling_days
           FROM retention_policy rp JOIN shop s ON s.id = rp.shop_id
           WHERE ${where} ORDER BY rp.artifact_class`,
          [param]
        )
      ).rows;

    const fromMigration = await rowsFor("s.id = $1", migrated);
    const fromScript = await rowsFor("s.slug = $1", slug);
    expect(fromScript).toHaveLength(3);
    expect(fromScript).toEqual(fromMigration);
  });

  it("records a policy change as a new row rather than an edit", async () => {
    const shop = await seedShop(pool, { slug: `policy-change-${randomUUID()}` });
    // Two separate statements so the rows get distinct transaction timestamps and
    // "newest wins" is decided by created_at alone — no value-based tiebreak.
    await pool.query(
      `INSERT INTO retention_policy (shop_id, artifact_class, anchor, window_days, ceiling_days)
       VALUES ($1,'originals','draft_created',30,90)`,
      [shop]
    );
    const changed = await pool.query(
      `INSERT INTO retention_policy (shop_id, artifact_class, anchor, window_days, ceiling_days)
       VALUES ($1,'originals','draft_created',14,90) RETURNING id`,
      [shop]
    );
    const changedId = (changed.rows[0] as { id: string }).id;

    const r = await pool.query(
      `SELECT id, window_days FROM retention_policy
       WHERE shop_id = $1 AND artifact_class = 'originals' ORDER BY created_at DESC`,
      [shop]
    );
    expect(r.rows).toHaveLength(2);
    const newest = r.rows[0] as { id: string; window_days: number };
    expect(newest.id).toBe(changedId);
    expect(newest.window_days).toBe(14);
  });

  it("releases a hold by appending a release row, never by updating the hold", async () => {
    const hold = await pool.query(
      `INSERT INTO retention_hold (shop_id, target_table, target_id, reason, review_date)
       VALUES ($1,'scan_session',$2,'chargeback','2027-06-01') RETURNING id`,
      [shopId, sessionId]
    );
    const holdId = (hold.rows[0] as { id: string }).id;

    // There is no released_at column to update, and the row itself is immutable.
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'retention_hold'`
    );
    expect(cols.rows.map((c: { column_name: string }) => c.column_name)).not.toContain("released_at");

    // Open holds = holds with no release row.
    const openBefore = await pool.query(
      `SELECT count(*)::int AS n FROM retention_hold h
       WHERE h.id = $1 AND NOT EXISTS (SELECT 1 FROM retention_hold_release r WHERE r.hold_id = h.id)`,
      [holdId]
    );
    expect((openBefore.rows[0] as { n: number }).n).toBe(1);

    await pool.query(`INSERT INTO retention_hold_release (hold_id, released_by) VALUES ($1,'tester')`, [
      holdId,
    ]);
    const openAfter = await pool.query(
      `SELECT count(*)::int AS n FROM retention_hold h
       WHERE h.id = $1 AND NOT EXISTS (SELECT 1 FROM retention_hold_release r WHERE r.hold_id = h.id)`,
      [holdId]
    );
    expect((openAfter.rows[0] as { n: number }).n).toBe(0);

    // A hold is released at most once.
    await expect(
      pool.query(`INSERT INTO retention_hold_release (hold_id) VALUES ($1)`, [holdId])
    ).rejects.toThrow(/retention_hold_release_once_idx/);
  });

  it("makes a hold with no review date unrepresentable (022: no review date is a T32 failure)", async () => {
    await expect(
      pool.query(
        `INSERT INTO retention_hold (shop_id, target_table, target_id, reason)
         VALUES ($1,'scan_session',$2,'litigation')`,
        [shopId, sessionId]
      )
    ).rejects.toThrow(/review_date/);
  });
});
