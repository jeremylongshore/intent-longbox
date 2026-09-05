// L4: the migration runner applies clean to a fresh database and is idempotent
// on re-run (R1 substrate: the schema is how append-only gets enforced).
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createFreshDb, probeDb, runMigrations, superuserUrl } from "./helpers.js";
import {
  APPEND_ONLY_EXEMPTIONS,
  APPEND_ONLY_TABLES,
  SESSION_SEQ_TABLE_NAMES,
} from "../../src/db/appendOnlyTables.js";
import { checksum, readMigrations } from "../../scripts/migrationDiscipline.js";
import {
  assertAppendOnlyTriggersOrThrow,
  checkAppendOnlyTriggers,
  describeAppendOnlyFailure,
} from "../../src/services/appendOnlyDetector.js";

const dbUp = await probeDb();

/** One migration's bytes, by filename — for the ledger-checksum assertion. */
function readMigrationSql(filename: string): string {
  const file = readMigrations().find((f) => f.filename === filename);
  if (!file) throw new Error(`ledger names a migration that is not on disk: ${filename}`);
  return file.sql;
}

/** The boot assertion logs before it throws; keep the expected failure out of the report. */
const silentLogger = { error: () => undefined, info: () => undefined };

describe.skipIf(!dbUp)("migration runner", () => {
  let pool: pg.Pool | undefined;
  /** E02-D06: only a superuser can reach `session_replication_role` — see the probe below. */
  let superuserPool: pg.Pool | undefined;

  afterAll(async () => {
    await superuserPool?.end();
    await pool?.end();
  });

  it("applies migrations/*.sql clean to a fresh database, then skips on re-run", async () => {
    const url = await createFreshDb("longbox_migrations_e02d05");

    const firstRun = await runMigrations(url);
    expect(firstRun).toContain("apply 001_init.sql");
    expect(firstRun).toContain("migrations up to date");

    pool = new pg.Pool({ connectionString: url });
    superuserPool = new pg.Pool({ connectionString: superuserUrl(url) });
    const applied = await pool.query(`SELECT filename FROM schema_migrations ORDER BY filename`);
    expect(applied.rows.map((r: { filename: string }) => r.filename)).toEqual([
      "001_init.sql",
      "002_ebay_credential_kind.sql",
      "003_reserve_principle_slots.sql",
      "004_human_confirmation_outcome.sql",
      "005_listing_status_observation.sql",
      "006_append_only_enable_always.sql",
      "007_observation_envelope.sql",
      "008_supersession_integrity.sql",
      "009_request_idempotency.sql",
      "010_scan_session_transition.sql",
      "011_outbox.sql",
      "012_cost_log_outbox_id.sql",
      "013_supersession_forward_ordering.sql",
      "014_credential_namespace_and_host_allowlist.sql",
      "015_llm_rerank_band_inputs.sql",
      "016_catalog_core.sql",
      "017_lcid_lifecycle_and_resolution.sql",
      "018_scan_photo_bytes_and_hash.sql",
      "019_identity_core.sql",
      "020_sessions_pin_and_auth_attempt.sql",
      "021_shop_credential_version.sql",
      "022_shop_credential_retirement.sql",
      "023_cost_log_spend_owner.sql",
      "024_invitations_and_device_enrollment.sql",
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
      // 005 (E02-D02): the observed listing lifecycle T19's detector reads.
      "listing_status_observation",
      // 009 / 010 (E02-B10): 042 §5.2's replay cache and 040 §3.3's transitions.
      "request_idempotency",
      "scan_session_transition",
      // 011 (E02-D07): the transactional outbox — the record that an effect is
      // OWED, and the attempt log the lease is derived from (043 §2).
      "outbox",
      "outbox_attempt",
      // 014 / 015 (E04-D01): 030 §7's catalog and 047's LCID namespace, lifecycle
      // facts, crosswalk and survivor projection — the first time this system can
      // name what a comic IS. Until they existed, identity was an untyped jsonb
      // blob on one immutable row (047 §1 E4) and the wire contract typed it
      // `z.unknown()` because there was nothing to describe it as (E5).
      "vertical_pack",
      "vertical_pack_version",
      "data_source",
      "lcid_registry",
      "collectible_definition",
      "edition",
      "edition_signature",
      "edition_external_id",
      "lcid_merge",
      "lcid_split",
      "lcid_split_outcome",
      "lcid_retirement",
      "lcid_current_survivor",
      "identity_resolution",
    ]) {
      expect(names).toContain(expected);
    }

    // Idempotent second run: skips, adds no rows, throws nothing.
    const secondRun = await runMigrations(url);
    expect(secondRun).toContain("skip  001_init.sql");
    expect(secondRun).toContain("skip  002_ebay_credential_kind.sql");
    expect(secondRun).toContain("skip  003_reserve_principle_slots.sql");
    expect(secondRun).toContain("skip  004_human_confirmation_outcome.sql");
    expect(secondRun).toContain("skip  005_listing_status_observation.sql");
    expect(secondRun).toContain("skip  006_append_only_enable_always.sql");
    expect(secondRun).toContain("skip  007_observation_envelope.sql");
    expect(secondRun).toContain("skip  008_supersession_integrity.sql");
    expect(secondRun).toContain("skip  009_request_idempotency.sql");
    expect(secondRun).toContain("skip  010_scan_session_transition.sql");
    expect(secondRun).toContain("skip  011_outbox.sql");
    expect(secondRun).toContain("skip  012_cost_log_outbox_id.sql");
    expect(secondRun).toContain("skip  013_supersession_forward_ordering.sql");
    expect(secondRun).toContain("skip  014_credential_namespace_and_host_allowlist.sql");
    expect(secondRun).toContain("skip  015_llm_rerank_band_inputs.sql");
    expect(secondRun).toContain("skip  016_catalog_core.sql");
    expect(secondRun).toContain("skip  017_lcid_lifecycle_and_resolution.sql");
    expect(secondRun).toContain("skip  018_scan_photo_bytes_and_hash.sql");
    expect(secondRun).toContain("skip  019_identity_core.sql");
    expect(secondRun).toContain("skip  020_sessions_pin_and_auth_attempt.sql");
    const appliedAgain = await pool.query(`SELECT count(*)::int AS n FROM schema_migrations`);
    expect((appliedAgain.rows[0] as { n: number }).n).toBe(24);

    // 015 (E06-D01): the band's derivation is recorded beside the band, and the
    // model's self-reported number may be absent — a model that declines to guess
    // one is answering correctly, because nothing depends on it any more.
    const rerankCols = await pool.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'llm_rerank' AND column_name IN ('band_inputs','confidence')`
    );
    const byName = Object.fromEntries(
      (rerankCols.rows as Array<{ column_name: string; data_type: string; is_nullable: string }>).map((r) => [
        r.column_name,
        r,
      ])
    );
    expect(byName["band_inputs"]?.data_type).toBe("jsonb");
    expect(byName["confidence"]?.is_nullable).toBe("YES");

    // E02-B10: the ledger records a checksum for every file it applied, and a
    // second run skips WITHOUT adopting anything — an adoption on a database this
    // runner created would mean the INSERT path forgot to record the digest.
    const sums = await pool.query(`SELECT filename, checksum FROM schema_migrations ORDER BY filename`);
    for (const row of sums.rows as Array<{ filename: string; checksum: string | null }>) {
      expect(row.checksum, `${row.filename} has no checksum`).toMatch(/^[0-9a-f]{64}$/);
      expect(row.checksum).toBe(checksum(readMigrationSql(row.filename)));
    }
    expect(secondRun).not.toContain("adopted checksum");
  });

  // E02-B10 / 041 §5.3. `migrations/007` restates the session_seq table list inline
  // because SQL cannot import TypeScript — the same bounded duplication `006`
  // documents for the trigger set. This is the assertion that makes a drift between
  // the two a red build rather than a silent hole, in BOTH directions.
  it("gives session_seq to exactly the declared session-scoped tables, and to nothing else", async () => {
    expect(pool).toBeDefined();
    // BASE TABLEs only. `migrations/013` re-created the three `_current` views on
    // 041 §5's canonical order, which refreshed their frozen column lists — so the
    // views now expose `session_seq` too, as a projection of the table's column
    // rather than as a column of their own. Including them here would make the
    // declared list a list of relations rather than of tables, which is not what
    // 041 §5.3 or `SESSION_SEQ_TABLE_NAMES` mean.
    const res = await pool!.query(
      `SELECT c.table_name FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND c.column_name = 'session_seq'
          AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name`
    );
    const live = (res.rows as Array<{ table_name: string }>).map((r) => r.table_name);
    expect(live).toEqual([...SESSION_SEQ_TABLE_NAMES].sort());

    // And every one of them carries the UNIQUE (scan_session_id, session_seq) guard
    // that turns a race into a loud failure rather than a duplicate.
    const idx = await pool!.query(
      `SELECT tablename FROM pg_indexes
        WHERE schemaname = 'public' AND indexname LIKE '%\\_session\\_seq\\_idx'
        ORDER BY tablename`
    );
    expect((idx.rows as Array<{ tablename: string }>).map((r) => r.tablename)).toEqual(
      [...SESSION_SEQ_TABLE_NAMES].sort()
    );
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

    // E02-D05, found by running this: 003's trigger loop is DROP-then-CREATE, and
    // CREATE TRIGGER always lands at the bypassable 'O' default. So a HAND re-run of
    // any pre-006 migration silently un-does 006 for the tables it touches. That is
    // not a defect in 003 — it is the reason the guarantee needs a RUNTIME detector
    // and not only a merge-time gate, and it is exactly the failure the detector
    // sees. Asserted rather than merely noted, then repaired by re-running 006,
    // which is re-runnable for this reason.
    const downgraded = await checkAppendOnlyTriggers(pool!);
    expect(downgraded.ok).toBe(false);
    expect(downgraded.disabled.map((d) => d.table).sort()).toEqual([
      "media_deletion",
      "retention_hold",
      "retention_hold_release",
      "retention_policy",
    ]);
    expect(downgraded.disabled.every((d) => d.tgenabled === "O")).toBe(true);

    const six = await readFile(
      new URL("../../migrations/006_append_only_enable_always.sql", import.meta.url),
      "utf8"
    );
    await pool!.query(six);
    expect((await checkAppendOnlyTriggers(pool!)).ok).toBe(true);
  });

  // E02-D05 / 041 §9.2. The previous version of this test read
  // information_schema.triggers, which has no column for tgenabled and so lists a
  // DISABLED trigger identically to an enabled one — it passed with every
  // append-only trigger switched off. It reads pg_trigger now, and asserts the
  // enabled STATE, not merely existence.
  it("attaches an ENABLE ALWAYS append-only trigger to every declared table, and to nothing else", async () => {
    expect(pool).toBeDefined();
    const res = await pool!.query(
      `SELECT c.relname AS table_name, tg.tgname AS trigger_name, tg.tgenabled
         FROM pg_trigger tg
         JOIN pg_class c ON c.oid = tg.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE NOT tg.tgisinternal AND n.nspname = 'public'
          AND tg.tgname LIKE '%\\_append\\_only'
        ORDER BY c.relname`
    );
    const rows = res.rows as Array<{ table_name: string; trigger_name: string; tgenabled: string }>;

    // Direction 1: every declared trigger exists AND is 'A' (ENABLE ALWAYS).
    expect(
      rows.map((r) => ({ table: r.table_name, trigger: r.trigger_name, tgenabled: r.tgenabled }))
    ).toEqual(
      [...APPEND_ONLY_TABLES]
        .map((t) => ({ table: t.table, trigger: t.trigger, tgenabled: "A" }))
        .sort((a, b) => a.table.localeCompare(b.table))
    );

    // Direction 2 (041 §9.2 item 4): no table carries a `%_append_only` trigger
    // without being declared — an undeclared one is a migration that added an
    // append-only table and forgot src/db/appendOnlyTables.ts, which means nothing
    // would have caught it being created at the bypassable default.
    const declared = new Set(APPEND_ONLY_TABLES.map((t) => t.trigger));
    expect(rows.filter((r) => !declared.has(r.trigger_name))).toEqual([]);

    // The declared exemptions are real tables, not typos guarding nothing — and a
    // PENDING exemption (a table 041 has decided about but the tree does not contain
    // yet: request_idempotency per §8.5/A11, physical_item_active_listing per §9.2)
    // is asserted ABSENT, so `pending` cannot quietly go stale. When the migration
    // that creates one lands, this test fails until someone drops the flag on purpose.
    const present = await pool!.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = new Set((present.rows as Array<{ table_name: string }>).map((r) => r.table_name));
    for (const ex of APPEND_ONLY_EXEMPTIONS) {
      expect(
        { table: ex.table, inSchema: names.has(ex.table) },
        `exemption ${ex.table} (${ex.pending ? "pending" : "present"})`
      ).toEqual({ table: ex.table, inSchema: !ex.pending });
    }
  });

  // The whole point of migration 006, proved as a NEGATIVE. The positive half —
  // every declared table still refuses UPDATE/DELETE in replica role, with a real
  // row present so the row-level trigger actually fires — lives in
  // append-only.test.ts, which owns the insert recipes. Without this negative that
  // assertion would be a tautology: it would also pass on a server where
  // session_replication_role happened to be inert.
  describe("session_replication_role='replica' bypasses an 'O' trigger and not an 'A' one", () => {
    it("succeeds on a scratch table whose identical trigger is left at the 'O' default", async () => {
      // E02-D06: `SET session_replication_role` is now denied to the migrate role
      // (it is not a superuser), so this probe — whose whole purpose is to reach
      // replica role and show what happens there — runs as the superuser. The
      // denial to the ordinary roles is asserted in role-separation.test.ts.
      expect(superuserPool).toBeDefined();
      const client = await superuserPool!.connect();
      try {
        // The probe's trigger is named `_guard`, NOT `_append_only`, deliberately: the
        // detector and the gate-test scan by that name pattern, so a probe matching it
        // would make this test's ordering relative to the `undeclared === []` assertion
        // load-bearing. Same function, same behaviour, no coupling.
        await client.query(`DROP TABLE IF EXISTS bypass_probe`);
        await client.query(`CREATE TABLE bypass_probe (id int primary key, note text)`);
        await client.query(
          `CREATE TRIGGER bypass_probe_guard BEFORE UPDATE OR DELETE ON bypass_probe
             FOR EACH ROW EXECUTE FUNCTION forbid_mutation()`
        );
        await client.query(`INSERT INTO bypass_probe VALUES (1, 'a')`);

        // In ORIGIN role the trigger fires: same function, same message.
        await expect(client.query(`UPDATE bypass_probe SET note = 'b'`)).rejects.toThrow(
          /append-only \(Hickey model\): UPDATE not allowed/
        );

        // In replica role, an 'O' trigger does NOT fire — this is the hole.
        await client.query(`SET session_replication_role = 'replica'`);
        const updated = await client.query(`UPDATE bypass_probe SET note = 'b'`);
        expect(updated.rowCount).toBe(1);

        // And ENABLE ALWAYS — what 006 does — closes it on this very table.
        await client.query(`SET session_replication_role = 'origin'`);
        await client.query(`ALTER TABLE bypass_probe ENABLE ALWAYS TRIGGER bypass_probe_guard`);
        await client.query(`SET session_replication_role = 'replica'`);
        await expect(client.query(`UPDATE bypass_probe SET note = 'c'`)).rejects.toThrow(
          /append-only \(Hickey model\): UPDATE not allowed/
        );
      } finally {
        await client.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
        await client.query(`DROP TABLE IF EXISTS bypass_probe`).catch(() => undefined);
        client.release();
      }
    });
  });

  // The runtime detector reads the same state the gate-test just asserted.
  describe("runtime append-only detector against the real database", () => {
    it("reports ok on the migrated schema", async () => {
      expect(pool).toBeDefined();
      const result = await checkAppendOnlyTriggers(pool!);
      expect(result).toEqual({ ok: true, missing: [], disabled: [], undeclared: [] });
    });

    it("reports the disabled trigger when one is switched off, and ok again once restored", async () => {
      expect(pool).toBeDefined();
      await pool!.query(`ALTER TABLE cost_log DISABLE TRIGGER cost_log_append_only`);
      try {
        const bad = await checkAppendOnlyTriggers(pool!);
        expect(bad.ok).toBe(false);
        expect(bad.missing).toEqual([]);
        expect(bad.undeclared).toEqual([]);
        expect(bad.disabled).toEqual([
          { table: "cost_log", trigger: "cost_log_append_only", tgenabled: "D" },
        ]);
        expect(describeAppendOnlyFailure(bad)).toContain("cost_log_append_only=D");
        await expect(assertAppendOnlyTriggersOrThrow(pool!, silentLogger)).rejects.toThrow(
          /refusing to serve/
        );
      } finally {
        await pool!.query(`ALTER TABLE cost_log ENABLE ALWAYS TRIGGER cost_log_append_only`);
      }
      const restored = await checkAppendOnlyTriggers(pool!);
      expect(restored.ok).toBe(true);
    });
  });
});
