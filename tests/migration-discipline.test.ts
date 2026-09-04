// L3: the expand/contract discipline, as pure logic (E02-B10, 000-docs/044 §2/§4).
//
// Every rule here has a NEGATIVE case, because 029 §5 move 8's standard applies to
// this gate as much as to the architecture one: "prove the gate can fail — an
// untested gate is not a gate."
import { describe, expect, it } from "vitest";
import {
  checksum,
  findContractingStatements,
  lintMigration,
  MigrationChecksumError,
  parseContractHeader,
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
