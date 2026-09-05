// L3: the causal reference as a SHAPE — the migration's constraints and the read
// model's fields (E02-D11; 040 A1 and §3.3, 041 §3.5 and §10 row 2, 042 §6).
//
// This file reads `migrations/030` as TEXT and the DTOs as values. It proves
// nothing about a running database — `tests/integration/migrations.test.ts` and
// `tests/integration/stale-world-view.test.ts` do that, against Postgres. What it
// buys is that the two properties a reviewer would otherwise check by eye — the
// vocabulary matches `010`'s, and nothing here backfills — fail a build the
// moment they stop holding, on every machine, without a database.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGAINST_TABLES, eventDtos } from "../src/contracts/v1/schemas.js";

const sql = readFileSync("migrations/030_causal_reference_persistence.sql", "utf8");
const transitionSql = readFileSync("migrations/010_scan_session_transition.sql", "utf8");

/**
 * The file with its `--` comments removed.
 *
 * `scripts/migrationDiscipline.ts` strips comments before it looks for a
 * contracting statement, and for the same reason: this repository's migrations
 * QUOTE the shapes they must not contain, at length, in their headers. A test
 * that searched the raw text would fail on a file for saying what it does not do.
 */
const statements = (text: string): string =>
  text
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

/** The two tables 041 §3.5 names, and the two the CHECKs therefore land on. */
const TABLES = ["human_confirmation", "condition_assessment"] as const;

/** Every quoted value inside the first `against_table IN (…)` list of a file. */
function enumeratedTables(text: string): string[] {
  const list = /against_table IN \(([^)]*)\)/.exec(text);
  expect(list, "no against_table IN (…) list found").not.toBeNull();
  return [...list![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
}

describe("migration 030 — the causal reference's shape", () => {
  it.each(TABLES)("gives %s both columns, nullable and with no DEFAULT", (table) => {
    expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} +ADD COLUMN IF NOT EXISTS against_table +text;`));
    expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} +ADD COLUMN IF NOT EXISTS against_id +uuid;`));
    // A DEFAULT would reach every existing row (007's own idiom for a value that
    // IS derivable) and would therefore state what a person was looking at
    // before anybody recorded it. 041 §10.1's rule, applied: not derivable means
    // NULL, never a guess.
    expect(sql).not.toMatch(new RegExp(`against_\\w+ (text|uuid) DEFAULT`));
  });

  it.each(TABLES)("makes %s's reference WHOLE OR ABSENT (040 §3.3)", (table) => {
    // Half a reference claims a rung with no row to check it against, and 040
    // §3.4 clause 2 would compare something it can neither confirm nor refute.
    expect(sql).toContain(
      `ALTER TABLE ${table} ADD CONSTRAINT ${table}_reference_is_whole\n` +
        `  CHECK ((against_table IS NULL) = (against_id IS NULL));`
    );
  });

  it("closes the table vocabulary on EXACTLY the set `010` already shipped", () => {
    // One column pair with two vocabularies is two column pairs wearing one
    // name. The comparison is against the migration that owns the other copy,
    // so a future widening in either file fails here rather than being noticed
    // by whoever reads both.
    const mine = enumeratedTables(sql);
    expect(mine).toEqual(enumeratedTables(transitionSql));
    expect(mine).toContain("scan_session");
  });

  it("accepts every table the WIRE can name (the enum is a superset of AGAINST_TABLES)", () => {
    // The wire's seven omit `scan_session` — a body never names the anchor,
    // because a session with no records is `intake` and there was no witness to
    // be shown. A value Zod accepts and the CHECK refuses would be a 500 on a
    // legal request, which is the failure this asserts away.
    for (const table of AGAINST_TABLES) expect(enumeratedTables(sql)).toContain(table);
  });

  it("writes NOTHING to an existing row — no backfill, no UPDATE, no data statement", () => {
    // 041 §10.1: a value invented here would be a fabricated observation about
    // what a person was looking at, in the one column that exists to answer that.
    expect(statements(sql)).not.toMatch(/^\s*UPDATE\s/im);
    expect(statements(sql)).not.toMatch(/^\s*INSERT\s/im);
  });

  it("leaves the append-only triggers alone (the E02-D05 downgrade hazard)", () => {
    // `CREATE TRIGGER` always lands at the bypassable 'O' default, so a
    // migration that re-creates one silently downgrades the sole enforcement of
    // locked decision 4. The safe move is not to touch them.
    expect(statements(sql)).not.toMatch(/CREATE TRIGGER|DROP TRIGGER|ENABLE ALWAYS/);
  });

  it("re-creates the two `_current` views so the read model matches its table", () => {
    // A view's column list is frozen at CREATE time (004:95-101, 013:91-96).
    // `pricing_snapshot_current` is NOT re-created, because that table gains no
    // column here — 041 §3.5 keeps the reference off machine-authored records.
    expect(sql).toContain("CREATE OR REPLACE VIEW human_confirmation_current AS");
    expect(sql).toContain("CREATE OR REPLACE VIEW condition_assessment_current AS");
    expect(sql).not.toContain("CREATE OR REPLACE VIEW pricing_snapshot_current");
  });

  it("declares no contract step, because it retires nothing (044 §2)", () => {
    expect(sql).not.toMatch(/^-- contract:/m);
    expect(statements(sql)).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER COLUMN .* TYPE|SET NOT NULL/);
  });
});

describe("the read model publishes the reference (042 §3.3, §6)", () => {
  it.each(TABLES)("declares against_table and against_id on %s's event DTO", (table) => {
    const keys = Object.keys(eventDtos[table].shape);
    expect(keys).toContain("against_table");
    expect(keys).toContain("against_id");
  });

  it("publishes it ONLY where the columns exist (041 §3.5)", () => {
    // A DTO field with no column would publish `null` forever and read as "the
    // person was shown nothing" — a claim, not an omission.
    for (const table of [
      "scan_photo",
      "candidate_set",
      "llm_rerank",
      "pricing_snapshot",
      "shopify_draft",
    ] as const) {
      expect(Object.keys(eventDtos[table].shape)).not.toContain("against_table");
      expect(Object.keys(eventDtos[table].shape)).not.toContain("against_id");
    }
  });

  it("adds no confidence, provider, cost, operator or storage field with it (042 I9, 019 T35)", () => {
    // The reference is a pointer to another record of this session, the same
    // kind of field as `supersedes_id`. It is not a doorway for the fields the
    // contract keeps out.
    for (const table of TABLES) {
      const keys = Object.keys(eventDtos[table].shape);
      expect(keys.filter((k) => /confidence|provider|model|cost|operator|storage/i.test(k))).toEqual([]);
    }
  });
});
