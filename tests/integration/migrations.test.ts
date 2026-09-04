// L4: the migration runner applies clean to a fresh database and is idempotent
// on re-run (R1 substrate: the schema is how append-only gets enforced).
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createFreshDb, probeDb, runMigrations } from "./helpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("migration runner", () => {
  let pool: pg.Pool | undefined;

  afterAll(async () => {
    await pool?.end();
  });

  it("applies migrations/*.sql clean to a fresh database, then skips on re-run", async () => {
    const url = await createFreshDb("longbox_migrations_test");

    const firstRun = await runMigrations(url);
    expect(firstRun).toContain("apply 001_init.sql");
    expect(firstRun).toContain("migrations up to date");

    pool = new pg.Pool({ connectionString: url });
    const applied = await pool.query(`SELECT filename FROM schema_migrations ORDER BY filename`);
    expect(applied.rows.map((r: { filename: string }) => r.filename)).toEqual([
      "001_init.sql",
      "002_ebay_credential_kind.sql",
      "003_reserve_principle_slots.sql",
    ]);

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const names = tables.rows.map((r: { table_name: string }) => r.table_name);
    for (const expected of [
      "shop",
      "shop_credentials",
      "shop_pricing_policy",
      "corpus_version",
      "scan_session",
      "scan_photo",
      "candidate_set",
      "llm_rerank",
      "human_confirmation",
      "condition_assessment",
      "pricing_snapshot",
      "shopify_draft",
      "cost_log",
      "schema_migrations",
      // 003 (E02-D01): the slots 022 P7 depends on.
      "media_deletion",
      "retention_policy",
      "retention_hold",
      "retention_hold_release",
    ]) {
      expect(names).toContain(expected);
    }

    // Idempotent second run: skips, adds no rows, throws nothing.
    const secondRun = await runMigrations(url);
    expect(secondRun).toContain("skip  001_init.sql");
    expect(secondRun).toContain("skip  002_ebay_credential_kind.sql");
    expect(secondRun).toContain("skip  003_reserve_principle_slots.sql");
    const appliedAgain = await pool.query(`SELECT count(*)::int AS n FROM schema_migrations`);
    expect((appliedAgain.rows[0] as { n: number }).n).toBe(3);
  });

  // 003 is written to survive a hand re-run (IF NOT EXISTS / DROP-then-ADD),
  // not just to be skipped by the runner's ledger. Prove that directly.
  it("003 re-applies by hand without error and without duplicating seeded policy rows", async () => {
    expect(pool).toBeDefined();
    const before = await pool!.query(`SELECT count(*)::int AS n FROM retention_policy`);
    const sql = await readFile(
      new URL("../../migrations/003_reserve_principle_slots.sql", import.meta.url),
      "utf8"
    );
    await pool!.query(sql);
    const after = await pool!.query(`SELECT count(*)::int AS n FROM retention_policy`);
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);
  });

  it("attaches append-only triggers to every event table", async () => {
    expect(pool).toBeDefined();
    const res = await pool!.query(
      `SELECT event_object_table FROM information_schema.triggers
       WHERE trigger_name LIKE '%_append_only' GROUP BY event_object_table ORDER BY event_object_table`
    );
    expect(res.rows.map((r: { event_object_table: string }) => r.event_object_table)).toEqual([
      "candidate_set",
      "condition_assessment",
      "corpus_version",
      "cost_log",
      "human_confirmation",
      "llm_rerank",
      "media_deletion",
      "pricing_snapshot",
      "retention_hold",
      "retention_hold_release",
      "retention_policy",
      "scan_photo",
      "shopify_draft",
    ]);
  });
});
