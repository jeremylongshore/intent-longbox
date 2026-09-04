// STATIC CONTRACTS OVER THE CATALOG MODULE — 047 I4, I11, I14, I16 and the
// module boundary 029 §5 move 8 asks for. All of these read the tree; none needs
// a database.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, collectSources } from "../../scripts/architectureRules.js";
import { APPEND_ONLY_TABLES, APPEND_ONLY_EXEMPTIONS } from "../../src/db/appendOnlyTables.js";

const src = collectSources(join(REPO_ROOT, "src"));
const migrationsDir = join(REPO_ROOT, "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ file: f, text: readFileSync(join(migrationsDir, f), "utf8") }));

const catalogFiles = src.filter((f) => f.path.startsWith("src/catalog/"));
const nonCatalogFiles = src.filter((f) => !f.path.startsWith("src/catalog/"));

describe("047 I4 — one parser, one constructor, one canonical form", () => {
  it("keeps the `lb.` literal inside src/catalog/lcid.ts", () => {
    // A second place that builds or reads the string is a second definition of the
    // canonical form, and the two diverge silently because both still compile.
    const offenders = src
      .filter((f) => f.path !== "src/catalog/lcid.ts")
      .filter((f) => /["'`]lb\./.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("exports exactly one constructor and one parser from the module surface", () => {
    const index = readFileSync(join(REPO_ROOT, "src/catalog/index.ts"), "utf8");
    expect(index).toMatch(/mintLcidString/);
    expect(index).toMatch(/\bparseLcid\b/);
    // `tryParseLcid` is the SAME parser wrapped for the read paths that must not
    // throw (047 A10), not a second one — it is defined in terms of parseLcid.
    const lcid = readFileSync(join(REPO_ROOT, "src/catalog/lcid.ts"), "utf8");
    expect(lcid).toMatch(/export function tryParseLcid[\s\S]{0,200}return parseLcid\(value\)/);
  });
});

describe("047 I16 — only `catalog` mints", () => {
  it("puts every `INSERT INTO lcid_registry` inside src/catalog/", () => {
    const offenders = nonCatalogFiles
      .filter((f) => /INSERT\s+INTO\s+lcid_registry\b/i.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("puts the mint helper behind the module surface, so the import graph can police it", () => {
    // `.dependency-cruiser.cjs`'s `catalog-public-surface-only` rule is the
    // enforcement; this asserts the precondition it depends on — that mint.ts is
    // not itself the surface.
    const offenders = nonCatalogFiles
      .filter((f) => /from\s+["'][^"']*catalog\/(?!index)/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("047 I11 — identity resolution is a fact, not a column", () => {
  // "The cheapest way to break this design is for a well-meaning future migration
  // to add one." 030 A1 rejected a nullable `confirmed_edition_lcid`, and
  // `migrations/004:43-48` records why: the NULL would carry TWO meanings the
  // reader cannot separate, and the row cannot be updated to repair it.
  const FORBIDDEN = ["confirmed_edition_lcid", "resolved_edition_lcid"];
  const HOST_TABLES = ["human_confirmation", "condition_assessment", "scan_session"];

  it("adds no resolved-edition column to any workflow witness table", () => {
    const offenders: string[] = [];
    for (const { file, text: raw } of migrations) {
      // COMMENTS ARE STRIPPED FIRST, and that is not a loophole — it is the same
      // move `scripts/migrationDiscipline.ts` makes for the same reason. Both
      // `004` and `015` NAME the rejected column at length in their headers,
      // because a rule nobody can find the reasoning for is a rule someone
      // reinstates. A scan that could not tell a prohibition from its explanation
      // would force the explanation out of the file.
      const text = raw
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .replace(/COMMENT ON [\s\S]*?;/g, "");
      for (const column of FORBIDDEN) {
        if (new RegExp(`\\b${column}\\b`).test(text)) offenders.push(`${file}: ${column}`);
      }
      // And no bare `edition_lcid` column added to one of the three host tables.
      for (const table of HOST_TABLES) {
        const re = new RegExp(
          `ALTER\\s+TABLE\\s+${table}[\\s\\S]{0,200}?ADD\\s+COLUMN[^;]{0,120}edition_lcid`,
          "i"
        );
        if (re.test(text)) offenders.push(`${file}: ${table}.edition_lcid`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("047 I14 — no numeric grade touches the identity path", () => {
  const IDENTITY_TABLES = [
    "lcid_registry",
    "lcid_merge",
    "lcid_split",
    "lcid_retirement",
    "edition_signature",
    "identity_resolution",
  ];

  it("declares no numeric column on any identity table", () => {
    const catalogSql = migrations
      .filter((m) => m.file.startsWith("016_") || m.file.startsWith("017_"))
      .map((m) => m.text)
      .join("\n");

    const offenders: string[] = [];
    for (const table of IDENTITY_TABLES) {
      const block = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(catalogSql);
      expect(block, `no CREATE TABLE block found for ${table}`).not.toBeNull();
      for (const rawLine of block![1]!.split("\n")) {
        const line = rawLine.trim();
        if (line.startsWith("--") || line.startsWith("CONSTRAINT") || line.startsWith("CHECK")) continue;
        // `normalization_version integer` is a RULE version, not a grade, and it
        // is the one integer any of these tables carries. Everything else numeric
        // is a defect (022 P1, 019 T7 non-waivable, locked decision 5).
        if (/\b(numeric|integer|int|bigint|smallint|real|double precision|decimal)\b/i.test(line)) {
          if (!line.startsWith("normalization_version")) offenders.push(`${table}: ${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps identity_resolution.confidence textual (030 §7.1)", () => {
    const sql = migrations.find((m) => m.file.startsWith("017_"))!.text;
    expect(sql).toMatch(/confidence\s+text/);
  });

  it("encodes no grade in the LCID payload", () => {
    // The payload is 80 CSPRNG bits and the prefix carries kind and vertical only
    // (047 §3.2: "an LCID may encode only what can never be corrected"). A grade is
    // neither, and 019 T7 is non-waivable.
    const lcid = readFileSync(join(REPO_ROOT, "src/catalog/lcid.ts"), "utf8");
    expect(lcid).not.toMatch(/\bgrade\b/i);
  });
});

describe("the catalog cluster is declared, in both directions (041 §9.2 item 4)", () => {
  const CATALOG_TABLES = [
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
    "identity_resolution",
  ];

  it("declares every immutable catalog table in APPEND_ONLY_TABLES", () => {
    const declared = new Set(APPEND_ONLY_TABLES.map((t) => t.table));
    expect(CATALOG_TABLES.filter((t) => !declared.has(t))).toEqual([]);
  });

  it("declares the survivor projection as an EXEMPTION with a reason, not as an absence", () => {
    // An absence is indistinguishable from an oversight. `lcid_current_survivor`
    // is deliberately mutable — it is written by the merge trigger — so it is a
    // row somebody can argue with.
    const row = APPEND_ONLY_EXEMPTIONS.find((e) => e.table === "lcid_current_survivor");
    expect(row).toBeDefined();
    expect(row!.kind).toBe("permanent");
    expect(row!.reason.length).toBeGreaterThan(80);
  });

  it("gives every catalog table an ENABLE ALWAYS trigger in the migration that creates it", () => {
    for (const file of ["016_catalog_core.sql", "017_lcid_lifecycle_and_resolution.sql"]) {
      const text = migrations.find((m) => m.file === file)!.text;
      // `CREATE TRIGGER` always lands at the bypassable tgenabled='O'; deferring
      // the promotion to a later migration is the E02-D05 downgrade hazard.
      expect(text, file).toMatch(/ENABLE ALWAYS TRIGGER/);
      expect(text, file).toMatch(/forbid_mutation\(\)/);
    }
  });
});

describe("the catalog module has one door", () => {
  it("re-exports every sibling from index.ts, so none of them is an orphan", () => {
    const index = readFileSync(join(REPO_ROOT, "src/catalog/index.ts"), "utf8");
    const siblings = readdirSync(join(REPO_ROOT, "src/catalog"))
      .filter((f) => f.endsWith(".ts") && f !== "index.ts")
      .filter((f) => statSync(join(REPO_ROOT, "src/catalog", f)).isFile());
    expect(siblings.length).toBeGreaterThan(0);
    for (const sibling of siblings) {
      expect(index, `${sibling} is not re-exported`).toContain(`./${sibling.replace(/\.ts$/, ".js")}`);
    }
  });

  it("keeps the module a leaf — it imports platform and nothing else", () => {
    for (const file of catalogFiles) {
      const imports = [...file.text.matchAll(/from\s+["'](\.[^"']*)["']/g)].map((m) => m[1]!);
      for (const spec of imports) {
        const ok = spec.startsWith("./") || spec === "../db.js" || spec.startsWith("../db/");
        expect(ok, `${file.path} imports ${spec}`).toBe(true);
      }
    }
  });
});
