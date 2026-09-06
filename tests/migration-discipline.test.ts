// L3: the expand/contract discipline, as pure logic (E02-B10, 000-docs/044 §2/§4).
//
// Every rule here has a NEGATIVE case, because 029 §5 move 8's standard applies to
// this gate as much as to the architecture one: "prove the gate can fail — an
// untested gate is not a gate."
import { describe, expect, it } from "vitest";
import {
  checksum,
  findContractingStatements,
  findNonConcurrentIndexBuilds,
  findTenantBoundaryStatements,
  G3_LIVE_SHOP_ROWS,
  lintMigration,
  lintMigrationDetailed,
  MIGRATION_LINT_GRANDFATHER,
  MigrationChecksumError,
  parseContractHeader,
  parseDeployUnitHeader,
  parseIndexLockHeader,
  planMigrations,
  readMigrations,
  stripSqlComments,
} from "../scripts/migrationDiscipline.js";

describe("checksum", () => {
  it("is SHA-256 hex over the exact bytes, and differs on a one-character edit", () => {
    const a = checksum("ALTER TABLE t ADD COLUMN c text;\n");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(checksum("ALTER TABLE t ADD COLUMN c text;\n")).toBe(a);
    expect(checksum("ALTER TABLE t ADD COLUMN c text ;\n")).not.toBe(a);
  });
});

describe("stripSqlComments", () => {
  // 003 and 006 quote `ALTER TABLE … DISABLE TRIGGER` and `UPDATE … SET` at length
  // in their headers. Not stripping comments would make the lint report nonsense.
  it("removes line and block comments so a quoted statement is not a statement", () => {
    expect(stripSqlComments("-- DROP TABLE shop\nSELECT 1;")).not.toMatch(/DROP TABLE/);
    expect(stripSqlComments("/* DROP COLUMN x */ SELECT 1;")).not.toMatch(/DROP COLUMN/);
    expect(stripSqlComments("-- a\nDROP TABLE shop;")).toMatch(/DROP TABLE/);
  });
});

describe("findContractingStatements", () => {
  it.each([
    ["DROP TABLE shop;", "drop table"],
    ["ALTER TABLE shop DROP COLUMN slug;", "drop column"],
    ["ALTER TABLE shop ALTER COLUMN slug TYPE citext;", "alter column type"],
    ["ALTER TABLE shop ALTER COLUMN slug SET NOT NULL;", "set not null"],
  ])("flags %s as %s", (sql, kind) => {
    expect(findContractingStatements(sql).map((c) => c.kind)).toContain(kind);
  });

  it("does NOT flag the expand shapes every migration in this repo uses", () => {
    const expand = [
      "ALTER TABLE shop ADD COLUMN IF NOT EXISTS note text;",
      "ALTER TABLE shop ADD COLUMN IF NOT EXISTS flag boolean NOT NULL DEFAULT false;",
      "ALTER TABLE shop DROP CONSTRAINT IF EXISTS shop_slug_check;",
      "CREATE TABLE IF NOT EXISTS t (id uuid PRIMARY KEY, name text NOT NULL);",
      "DROP TRIGGER IF EXISTS t_append_only ON t;",
      "DROP INDEX IF EXISTS t_idx;",
    ].join("\n");
    expect(findContractingStatements(expand)).toEqual([]);
  });
});

describe("parseContractHeader", () => {
  it("reads the retired migration and the 006 row", () => {
    expect(
      parseContractHeader("-- contract: retires 007_observation_envelope.sql; 006 row: 2026-09-04 E02-B08\n")
    ).toEqual({ retires: "007_observation_envelope.sql", row: "2026-09-04 E02-B08" });
  });
  it("returns undefined when either half is missing", () => {
    expect(parseContractHeader("-- contract: retires 007_x.sql\n")).toBeUndefined();
    expect(parseContractHeader("-- just a comment\n")).toBeUndefined();
  });
});

describe("lintMigration", () => {
  it("refuses a contracting statement with no header, and names the offending statement", () => {
    const errs = lintMigration("011_x.sql", "BEGIN;\nALTER TABLE scan_session DROP COLUMN status;\nCOMMIT;");
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("declares no `-- contract:` header");
    expect(errs[0]).toContain("DROP COLUMN status");
  });

  it("accepts the same statement once it declares what it retires and which row signed it", () => {
    expect(
      lintMigration(
        "011_x.sql",
        "-- contract: retires 010_scan_session_transition.sql; 006 row: 2026-09-04 E02-B08 drop status\n" +
          "ALTER TABLE scan_session DROP COLUMN status;"
      )
    ).toEqual([]);
  });

  it("refuses a header on a file that contracts nothing — a claim the file does not support", () => {
    const errs = lintMigration(
      "011_x.sql",
      "-- contract: retires 010_x.sql; 006 row: r\nALTER TABLE t ADD COLUMN IF NOT EXISTS c text;"
    );
    expect(errs[0]).toContain("contains no contracting statement");
  });

  it("refuses a header whose `retires` is not a migration filename", () => {
    const errs = lintMigration("011_x.sql", "-- contract: retires yesterday; 006 row: r\nDROP TABLE t;");
    expect(errs.some((e) => e.includes("does not name a migration file"))).toBe(true);
  });

  // The rule is only worth having if the tree obeys it.
  it("passes on every migration in migrations/", () => {
    const errs = readMigrations().flatMap((f) => lintMigration(f.filename, f.sql));
    expect(errs).toEqual([]);
  });
});

describe("planMigrations", () => {
  const files = [
    { filename: "001_a.sql", sql: "SELECT 1;" },
    { filename: "002_b.sql", sql: "SELECT 2;" },
  ];

  it("applies what the ledger does not have and skips what it does", () => {
    expect(
      planMigrations(files, [{ filename: "001_a.sql", checksum: checksum("SELECT 1;") }]).map((p) => [
        p.filename,
        p.action,
      ])
    ).toEqual([
      ["001_a.sql", "skip"],
      ["002_b.sql", "apply"],
    ]);
  });

  it("adopts a checksum for a row applied before the column existed, rather than guessing", () => {
    const plan = planMigrations(files, [{ filename: "001_a.sql", checksum: null }]);
    expect(plan[0]!.action).toBe("adopt-checksum");
    expect(plan[0]!.checksum).toBe(checksum("SELECT 1;"));
  });

  // The failure the checksum exists for. A shipped migration edited after it ran
  // gives a fresh database one schema and every existing database another, and the
  // runner's `skip` line looks identical in both cases.
  it("refuses loudly when an applied file's bytes have changed", () => {
    expect(() =>
      planMigrations(files, [{ filename: "001_a.sql", checksum: checksum("SELECT 999;") }])
    ).toThrow(MigrationChecksumError);
    try {
      planMigrations(files, [{ filename: "001_a.sql", checksum: checksum("SELECT 999;") }]);
    } catch (err) {
      expect((err as Error).message).toContain("A shipped migration is never edited");
      expect((err as Error).message).toContain("add a NEW migration");
    }
  });
});

// ============================================================================
// E03-D20 — the fifth shape and the index-lock rule (000-docs/044 §2 A1, §9, §10)
// ============================================================================

describe("findTenantBoundaryStatements", () => {
  it.each([
    ["ALTER TABLE shop ENABLE ROW LEVEL SECURITY;", "enable row level security"],
    ["ALTER TABLE shop FORCE ROW LEVEL SECURITY;", "force row level security"],
    ["CREATE POLICY tenant_isolation ON shop USING (id = current_shop_id());", "create policy"],
  ])("flags %s as %s", (sql, kind) => {
    expect(findTenantBoundaryStatements(sql).map((b) => b.kind)).toContain(kind);
  });

  it("does NOT flag a migration that only adds a table, a column or an index", () => {
    const expand = [
      "CREATE TABLE IF NOT EXISTS t (id uuid PRIMARY KEY, shop_id uuid NOT NULL);",
      "ALTER TABLE t ADD COLUMN IF NOT EXISTS note text;",
      "CREATE INDEX IF NOT EXISTS t_shop_idx ON t (shop_id);",
      "DROP POLICY IF EXISTS tenant_isolation ON t;",
    ].join("\n");
    expect(findTenantBoundaryStatements(expand)).toEqual([]);
  });

  it("sees the shape inside `format()` in a DO block, which is how 029 writes it", () => {
    const sql = readMigrations().find((f) => f.filename === "029_row_level_security.sql")!.sql;
    const kinds = new Set(findTenantBoundaryStatements(sql).map((b) => b.kind));
    expect([...kinds].sort()).toEqual(["create policy", "enable row level security"]);
  });

  it("does not mistake a comment quoting the shape for the shape", () => {
    expect(findTenantBoundaryStatements("-- 029 runs ENABLE ROW LEVEL SECURITY on every table\n")).toEqual(
      []
    );
  });

  // A RECORDED MISS, pinned so it stays a known gap rather than becoming a
  // discovered one (044 §2 A1). Every policy here is written DROP-then-CREATE for
  // the re-runnability §7 requires, so the CREATE half is caught and matching the
  // DROP would double every count — but a bare ALTER POLICY would slip past, and
  // what sees a reshape is the boot assertion's qual/with_check comparison
  // (src/services/roleSeparation.ts:343-346), never a regex.
  it("does NOT match ALTER POLICY or a bare DROP POLICY — stated in 044 §2 A1, not silently absent", () => {
    expect(findTenantBoundaryStatements("ALTER POLICY tenant_isolation ON shop USING (true);")).toEqual([]);
    expect(findTenantBoundaryStatements("DROP POLICY IF EXISTS tenant_isolation ON shop;")).toEqual([]);
  });
});

describe("parseDeployUnitHeader", () => {
  it("reads the deploy unit and the 006 row", () => {
    expect(
      parseDeployUnitHeader(
        "-- contract: deploy unit 029 + src/db/rowLevelSecurity.ts; 006 row: 2026-09-05 E03-B04\n"
      )
    ).toEqual({ deployUnit: "029 + src/db/rowLevelSecurity.ts", row: "2026-09-05 E03-B04" });
  });

  it("returns undefined when either half is missing", () => {
    expect(parseDeployUnitHeader("-- contract: deploy unit 029 + the boot assertion\n")).toBeUndefined();
    expect(parseDeployUnitHeader("-- contract: retires 010_x.sql; 006 row: r\n")).toBeUndefined();
  });
});

describe("lintMigration — the fifth contracting shape", () => {
  const enable = "BEGIN;\nALTER TABLE scan_photo ENABLE ROW LEVEL SECURITY;\nCOMMIT;";

  it("refuses a tenant boundary with no deploy-unit header, and says why the `retires` half will not do", () => {
    const errs = lintMigration("031_x.sql", enable);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("declares no `-- contract: deploy unit` header");
    expect(errs[0]).toContain("retires nothing");
    expect(errs[0]).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("accepts it once the deploy unit and the row that signed it are named", () => {
    expect(
      lintMigration(
        "031_x.sql",
        "-- contract: deploy unit 031 + the tenant context in src/db; roll back code first, then the policy;" +
          " 006 row: 2026-09-05 E03-D20\n" +
          enable
      )
    ).toEqual([]);
  });

  it("refuses a deploy-unit header on a file that moves no boundary", () => {
    const errs = lintMigration(
      "031_x.sql",
      "-- contract: deploy unit 031 + everything; 006 row: r\nALTER TABLE t ADD COLUMN IF NOT EXISTS c text;"
    );
    expect(errs.some((e) => e.includes("moves no tenant boundary"))).toBe(true);
  });

  it("treats `CREATE POLICY` as the same shape — a policy is what makes an enabled table readable", () => {
    const errs = lintMigration(
      "031_x.sql",
      "CREATE POLICY tenant_isolation ON scan_photo FOR ALL USING (shop_id = current_shop_id());"
    );
    expect(errs[0]).toContain("declares no `-- contract: deploy unit` header");
  });

  it("asks for BOTH halves when one file retires a column and moves a boundary", () => {
    const both =
      "-- contract: retires 010_scan_session_transition.sql; 006 row: r\n" +
      "ALTER TABLE scan_session DROP COLUMN status;\n" +
      "ALTER TABLE scan_session ENABLE ROW LEVEL SECURITY;";
    const errs = lintMigration("031_x.sql", both);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("deploy unit");
  });
});

describe("findNonConcurrentIndexBuilds", () => {
  it("flags a plain build on a table the file did not create, and names the table", () => {
    const found = findNonConcurrentIndexBuilds(
      "CREATE INDEX IF NOT EXISTS cost_log_shop_idx ON cost_log (shop_id);"
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.table).toBe("cost_log");
  });

  it("does NOT flag a build on a table created in the same file — that table has no rows to lock", () => {
    expect(
      findNonConcurrentIndexBuilds(
        "CREATE TABLE IF NOT EXISTS t (id uuid PRIMARY KEY, shop_id uuid NOT NULL);\n" +
          "CREATE INDEX IF NOT EXISTS t_shop_idx ON t (shop_id);"
      )
    ).toEqual([]);
  });

  it("does NOT flag a CONCURRENTLY build, with or without IF NOT EXISTS", () => {
    expect(
      findNonConcurrentIndexBuilds(
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS cost_log_shop_idx ON cost_log (shop_id);\n" +
          "CREATE UNIQUE INDEX CONCURRENTLY cost_log_u ON cost_log (id);"
      )
    ).toEqual([]);
  });

  it("reports an unreadable target rather than assuming it is safe (029's `format('… ON %I')`)", () => {
    const found = findNonConcurrentIndexBuilds("EXECUTE format('CREATE UNIQUE INDEX x ON %I (a)', t);");
    expect(found).toHaveLength(1);
    expect(found[0]!.table).toBeUndefined();
  });

  // A RECORDED MISS (044 §9). Both of these build an index under ACCESS EXCLUSIVE
  // exactly as a plain CREATE INDEX does. Matching them would mean telling the
  // `USING INDEX` form — which ADOPTS an index already built CONCURRENTLY — from
  // the building form, and that is parsing rather than matching.
  it("does NOT match ADD CONSTRAINT … UNIQUE or ADD PRIMARY KEY — stated in 044 §9, not silently absent", () => {
    expect(
      findNonConcurrentIndexBuilds("ALTER TABLE cost_log ADD CONSTRAINT cost_log_u UNIQUE (id);")
    ).toEqual([]);
    expect(findNonConcurrentIndexBuilds("ALTER TABLE cost_log ADD PRIMARY KEY (id);")).toEqual([]);
  });
});

describe("parseIndexLockHeader", () => {
  it("reads the justification, and refuses an empty one", () => {
    expect(parseIndexLockHeader("-- index lock: cost_log is empty before G3\n")).toBe(
      "cost_log is empty before G3"
    );
    expect(parseIndexLockHeader("-- index lock:\n")).toBeUndefined();
    expect(parseIndexLockHeader("-- an ordinary comment\n")).toBeUndefined();
  });
});

describe("lintMigration — the index-lock rule and the G3 cut-over", () => {
  const build = "CREATE INDEX IF NOT EXISTS cost_log_shop_idx ON cost_log (shop_id);";

  it("WARNS and does not refuse while no table can hold a live shop row", () => {
    const { errors, warnings } = lintMigrationDetailed("031_x.sql", build, { liveShopRows: false });
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("non-CONCURRENTLY index build(s)");
    expect(warnings[0]).toContain("REFUSAL when that flag flips");
  });

  // The gate has to be provably able to fail BEFORE the day it must (029 §5 move 8).
  it("REFUSES the same file once live shop rows exist, and names both remedies", () => {
    const { errors, warnings } = lintMigrationDetailed("031_x.sql", build, { liveShopRows: true });
    expect(warnings).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ACCESS EXCLUSIVE");
    expect(errors[0]).toContain("CONCURRENTLY");
    expect(errors[0]).toContain("-- index lock:");
  });

  it("accepts a declared lock in either world", () => {
    const declared = `-- index lock: cost_log holds no live shop row before G3 (034:421)\n${build}`;
    expect(lintMigrationDetailed("031_x.sql", declared, { liveShopRows: false }).warnings).toEqual([]);
    expect(lintMigrationDetailed("031_x.sql", declared, { liveShopRows: true }).errors).toEqual([]);
  });

  it("refuses an `-- index lock:` header on a file that takes no such lock", () => {
    const errs = lintMigration(
      "031_x.sql",
      "-- index lock: nothing here\nCREATE TABLE IF NOT EXISTS t (id uuid PRIMARY KEY);\n" +
        "CREATE INDEX IF NOT EXISTS t_idx ON t (id);"
    );
    expect(errs.some((e) => e.includes("builds no non-CONCURRENTLY index"))).toBe(true);
  });

  it("defaults to the repository's own PROVISIONAL flag, which is false today", () => {
    expect(G3_LIVE_SHOP_ROWS).toBe(false);
    expect(lintMigrationDetailed("031_x.sql", build).errors).toEqual([]);
    expect(lintMigrationDetailed("031_x.sql", build).warnings).toHaveLength(1);
  });
});

describe("the grandfather allowlist (044 §10)", () => {
  // A shipped migration is never edited, so a new rule can only be applied to old
  // bytes by naming them. Naming them without a reason is how an allowlist becomes
  // a place to put anything.
  it("names only 029 today, and 029 names a file that exists", () => {
    expect(MIGRATION_LINT_GRANDFATHER.map((g) => g.filename)).toEqual(["029_row_level_security.sql"]);
    const onDisk = new Set(readMigrations().map((f) => f.filename));
    for (const row of MIGRATION_LINT_GRANDFATHER) expect(onDisk.has(row.filename)).toBe(true);
  });

  it("gives every entry a non-trivial reason and at least one named shape", () => {
    for (const row of MIGRATION_LINT_GRANDFATHER) {
      expect(row.reason.length).toBeGreaterThan(80);
      expect(row.shapes.length).toBeGreaterThan(0);
      for (const shape of row.shapes) expect(["tenant boundary", "non-concurrent index"]).toContain(shape);
    }
  });

  it("is what makes 029 clean — its two shapes are real and would refuse without the row", () => {
    const sql = readMigrations().find((f) => f.filename === "029_row_level_security.sql")!.sql;
    expect(findTenantBoundaryStatements(sql).length).toBeGreaterThan(0);
    expect(findNonConcurrentIndexBuilds(sql)).toHaveLength(18);
    // Same bytes, a name the allowlist does not carry: both rules fire.
    const asNewFile = lintMigrationDetailed("031_row_level_security.sql", sql, { liveShopRows: true });
    expect(asNewFile.errors.some((e) => e.includes("deploy unit"))).toBe(true);
    expect(asNewFile.errors.some((e) => e.includes("ACCESS EXCLUSIVE"))).toBe(true);
    // …and under its real name, nothing does.
    expect(lintMigrationDetailed("029_row_level_security.sql", sql, { liveShopRows: true })).toEqual({
      errors: [],
      warnings: [],
    });
  });
});

describe("the tree obeys both new rules", () => {
  it("no migration refuses today", () => {
    const errs = readMigrations().flatMap((f) => lintMigrationDetailed(f.filename, f.sql).errors);
    expect(errs).toEqual([]);
  });

  // The count is EXACT, never a ceiling, on 044 §6's precedent: a new occurrence
  // fails this test, and a removed one also fails it until someone lowers the
  // number — which is what makes the list shrink deliberately instead of drifting.
  it("eleven shipped migrations carry an index-lock warning, and 029 is not one of them", () => {
    const warned = readMigrations()
      .filter((f) => lintMigrationDetailed(f.filename, f.sql).warnings.length > 0)
      .map((f) => f.filename);
    expect(warned).toEqual([
      "003_reserve_principle_slots.sql",
      "004_human_confirmation_outcome.sql",
      "007_observation_envelope.sql",
      "008_supersession_integrity.sql",
      "011_outbox.sql",
      "012_cost_log_outbox_id.sql",
      "023_cost_log_spend_owner.sql",
      "025_authenticator_recovery_and_nomination.sql",
      "026_connector_oauth.sql",
      "030_causal_reference_persistence.sql",
      // 034 arrived from E03-D19 WHILE THIS RULE WAS IN FLIGHT, and this exact
      // assertion is what reported it: one `CREATE UNIQUE INDEX … ON scan_session
      // (id, shop_id)` on a table it did not create. It WARNS rather than refuses
      // because the flag is false, which is the rule behaving as designed on the
      // first occurrence it ever saw that nobody wrote for it.
      "034_scan_session_composite_tenant_keys.sql",
    ]);
  });
});
