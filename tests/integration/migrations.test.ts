// L4: the migration runner applies clean to a fresh database and is idempotent
// on re-run (R1 substrate: the schema is how append-only gets enforced).
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
    ]) {
      expect(names).toContain(expected);
    }

    // Idempotent second run: skips, adds no rows, throws nothing.
    const secondRun = await runMigrations(url);
    expect(secondRun).toContain("skip  001_init.sql");
    expect(secondRun).toContain("skip  002_ebay_credential_kind.sql");
    const appliedAgain = await pool.query(`SELECT count(*)::int AS n FROM schema_migrations`);
    expect((appliedAgain.rows[0] as { n: number }).n).toBe(2);
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
      "pricing_snapshot",
      "scan_photo",
      "shopify_draft",
    ]);
  });
});
