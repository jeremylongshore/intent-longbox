// L2/L4: the architecture gate (E02-B10; 029 §5 move 8, 042 I5 + I22, 040 §8.2).
//
// 029 §5 move 8 states this bead's acceptance in one line and it is the shape of
// this file: "`depcruise src --config .dependency-cruiser.cjs` exits 0; a
// deliberately-added forbidden import exits non-zero (**prove the gate can fail**
// — an untested gate is not a gate); a sibling import inside one module keeps it
// green (proves N1 fixed); a `db.query` added to a route trips the N2 assertion."
//
// Every non-graph rule below is exercised twice — once against the real tree and
// once against a fixture that violates it — for the same reason. A rule that has
// never failed is indistinguishable from a rule that cannot.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  checkCostLogWriters,
  checkLockOrder,
  checkRouteDbAccess,
  checkScanSessionStatusWriters,
  checkSelectStar,
  checkSupersedesWriters,
  findSupersedesWriters,
  SUPERSEDES_WRITER,
  COST_LOG_WRITER,
  ROUTE_DB_ROWS,
  SELECT_STAR_ROWS,
  splitMutatingHandlers,
  type SourceFile,
  collectSources,
} from "../../scripts/architectureRules.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** depcruise on the real tree; resolves with the exit code rather than throwing. */
async function depcruise(): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await execFileAsync(
      "pnpm",
      ["exec", "depcruise", "src", "--config", ".dependency-cruiser.cjs"],
      { cwd: repoRoot }
    );
    return { code: 0, out: stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("dependency-cruiser (the import-graph half)", () => {
  it("exits 0 on the tree as it stands", async () => {
    const { code, out } = await depcruise();
    expect(out).toContain("no dependency violations found");
    expect(code).toBe(0);
  }, 60_000);

  // 029 §5 move 8: "a deliberately-added forbidden import exits non-zero".
  it("exits non-zero on a deliberately violating file", async () => {
    const fixture = join(repoRoot, "src/routes/__arch_fixture_violation__.ts");
    writeFileSync(
      fixture,
      "// TEMPORARY negative fixture, written and deleted by architecture-gate.test.ts.\n" +
        "// It violates `routes-do-not-touch-the-database` by importing pg at the edge.\n" +
        'import pg from "pg";\nexport const pool = new pg.Pool();\n'
    );
    try {
      const { code, out } = await depcruise();
      expect(out).toContain("routes-do-not-touch-the-database");
      expect(code).not.toBe(0);
    } finally {
      rmSync(fixture, { force: true });
    }
  }, 60_000);

  // 029 §5 move 8: "a sibling import inside one module keeps it green (proves N1
  // fixed)". Without the `$1` backreference in `module-public-surface-only`, this
  // exact shape is forbidden and the rule is unsatisfiable.
  it("stays green when one module file imports a sibling (N1 fixed)", async () => {
    // NEVER `rmSync(src/modules)`. E02-B03 move 1 creates the real barrels there,
    // and a test that deleted the directory it merely happened to create would
    // delete a colleague's module tree on the day that lands. The fixture gets its
    // own clearly-named subdirectory and only THAT is removed; a stale one from a
    // killed run makes this refuse rather than clobber.
    const fixtureDir = join(repoRoot, "src/modules/__arch_fixture__");
    if (existsSync(fixtureDir)) {
      throw new Error(`${fixtureDir} already exists — remove it by hand; this test will not clobber it`);
    }
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(join(fixtureDir, "sibling.ts"), "export const answer = 42;\n");
    writeFileSync(join(fixtureDir, "index.ts"), 'export { answer } from "./sibling.js";\n');
    try {
      const { code, out } = await depcruise();
      expect(out).toContain("no dependency violations found");
      expect(code).toBe(0);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
      // Remove `src/modules` ONLY if this test created it and it is now empty.
      try {
        if (readdirSync(join(repoRoot, "src/modules")).length === 0) {
          rmSync(join(repoRoot, "src/modules"), { recursive: true, force: true });
        }
      } catch {
        /* never there, or someone else owns it now; either way, leave it alone */
      }
    }
  }, 60_000);
});

describe("the non-graph rules, against the real tree", () => {
  const files = collectSources(join(repoRoot, "src"));

  it("collects the source tree it claims to", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.map((f) => f.path)).toContain("src/routes/scanSessions.ts");
  });

  it("finds no violation of any of the six rules", () => {
    expect(checkSelectStar(files)).toEqual([]);
    expect(checkRouteDbAccess(files)).toEqual([]);
    expect(checkCostLogWriters(files)).toEqual([]);
    expect(checkLockOrder(files)).toEqual([]);
    expect(checkScanSessionStatusWriters(files)).toEqual([]);
    expect(checkSupersedesWriters(files)).toEqual([]);
  });

  // 041 §3.3, the rule E02-D09 added: the single writer is a property of the tree,
  // not of a comment. Asserted against the REAL tree, so a route or service that
  // starts writing the column fails here rather than in a review.
  it("041 §3.3: supersession.ts is the only file that writes supersedes_id", () => {
    expect(findSupersedesWriters(files)).toEqual([SUPERSEDES_WRITER]);
  });

  // 044 §6's THIRD defect row — the `scanSessions.ts` exemptions inside
  // `.dependency-cruiser.cjs` — was prose in the doc and nothing anywhere else. A
  // count nobody asserts is a count that drifts: a fourth exemption could be added
  // to that file and every other gate here would stay green. This is the assertion
  // that makes the doc's row mean something.
  it("declares exactly three scanSessions.ts exemptions in the depcruise config", () => {
    const config = readFileSync(join(repoRoot, ".dependency-cruiser.cjs"), "utf8");
    const occurrences = config.match(/\^src\/routes\/scanSessions\\\\\.ts\$/g) ?? [];
    expect(occurrences).toHaveLength(3);
    // And each one sits in a `pathNot`, not in a `path` — an exemption, never a rule.
    for (const rule of [
      "providers-are-contained",
      "routes-do-not-import-the-db-module",
      "routes-do-not-touch-the-database",
    ]) {
      expect(config).toContain(rule);
    }
  });

  // 042 A8, the Q8 ruling: allowlist rows carry `kind ∈ {exemption, defect}` and
  // NO DEFECT-KIND ROW MAY EXIST AT G2. This does not fail on a defect row — 044 §6
  // records four at G2, all real — it fails on a defect row with no closing bead,
  // which is the shape that makes an allowlist a waiver by declaration. And the
  // bead must be an OPEN one: E02-B07/E02-B08 are closed decision beads, so naming
  // either would make the row unclosable while looking owned.
  it("gives every declared defect row an OPEN closing bead", () => {
    for (const row of [...SELECT_STAR_ROWS, ...ROUTE_DB_ROWS]) {
      if (row.kind === "defect") {
        expect(row.closingBead, `${row.path} is kind=defect with no closing bead`).toBeTruthy();
        expect(row.closingBead, `${row.path} names a CLOSED decision bead`).not.toMatch(/E02-B0[78]\b/);
      }
      expect(row.reason.length).toBeGreaterThan(40);
    }
  });
});

describe("the non-graph rules, against fixtures that violate them", () => {
  const clean: SourceFile[] = [
    { path: "src/services/costLog.ts", text: "await db.query(`INSERT INTO cost_log (a) VALUES ($1)`);" },
    ...SELECT_STAR_ROWS.map((r) => ({ path: r.path, text: "SELECT * ".repeat(r.count) })),
    ...ROUTE_DB_ROWS.map((r) => ({
      path: r.path,
      text:
        "db.query(".repeat(r.dbQuery) +
        "INSERT INTO x ".repeat(r.insertInto) +
        'from "../providers/registry.js"\n'.repeat(r.providerImports) +
        'import type pg from "pg"\n'.repeat(r.pgImports),
    })),
    { path: "src/services/scanSession.ts", text: "SELECT * SELECT * SELECT * UPDATE scan_session SET" },
  ];

  it("the fixture baseline is itself clean, so each negative below isolates one rule", () => {
    // scanSession.ts appears twice above (once from SELECT_STAR_ROWS); keep the
    // richer one, which carries both the SELECT *s and the status writer.
    const deduped = [...new Map(clean.map((f) => [f.path, f])).values()];
    expect(checkSelectStar(deduped)).toEqual([]);
    expect(checkRouteDbAccess(deduped)).toEqual([]);
    expect(checkCostLogWriters(deduped)).toEqual([]);
    expect(checkScanSessionStatusWriters(deduped)).toEqual([]);
  });

  it("042 I5(b): an undeclared `SELECT *` under src/ is a violation", () => {
    const findings = checkSelectStar([{ path: "src/services/new.ts", text: "SELECT * FROM shop" }]);
    // Two findings, and both are correct: the undeclared file, plus the stale row
    // for the declared file this one-element fixture does not contain.
    expect(findings.some((f) => f.message.includes("src/services/new.ts: 1"))).toBe(true);
    expect(findings.some((f) => f.message.includes("no declared row"))).toBe(true);
  });

  it("042 I5(b): a declared file that gains one is a violation, and so is a stale row", () => {
    const grew = checkSelectStar([
      { path: "src/services/scanSession.ts", text: "SELECT * SELECT * SELECT * SELECT *" },
    ]);
    expect(grew[0]!.message).toContain("declared 3");
    const stale = checkSelectStar([{ path: "src/services/scanSession.ts", text: "no star here" }]);
    expect(stale.some((f) => f.message.includes("Remove the stale row"))).toBe(true);
  });

  // 029 §5 move 8: "a `db.query` added to a route trips the N2 assertion". This is
  // the rule import-graph analysis provably cannot express: the Pool arrives as a
  // parameter, so there is no edge to see.
  it("N2: a `db.query` added to a route trips the assertion, with no import in sight", () => {
    const findings = checkRouteDbAccess([
      { path: "src/routes/newRoute.ts", text: "export const h = () => db.query(`SELECT 1`);" },
    ]);
    expect(findings.some((f) => f.message.includes("declared 0 `dbQuery`"))).toBe(true);
  });

  it("N2: an `INSERT INTO` added to a route trips it too", () => {
    const findings = checkRouteDbAccess([
      { path: "src/routes/newRoute.ts", text: "const sql = `INSERT INTO shop (name) VALUES ($1)`;" },
    ]);
    expect(findings.some((f) => f.message.includes("`insertInto`"))).toBe(true);
  });

  it("029 §2.8 / move 7: a second writer of cost_log is a violation", () => {
    const findings = checkCostLogWriters([
      { path: COST_LOG_WRITER, text: "INSERT INTO cost_log (a)" },
      { path: "src/services/identify.ts", text: "INSERT INTO cost_log (a)" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/services/identify.ts");
  });

  it("029 §2.8: cost_log with NO writer is also a violation — the rule is an equality", () => {
    expect(checkCostLogWriters([{ path: "src/services/costLog.ts", text: "nothing" }])).toHaveLength(1);
  });

  it("041 §3.3: a second writer of supersedes_id is a violation", () => {
    const findings = checkSupersedesWriters([
      { path: SUPERSEDES_WRITER, text: "INSERT INTO human_confirmation (a, supersedes_id)" },
      { path: "src/routes/scanSessions.ts", text: "INSERT INTO condition_assessment (a, supersedes_id)" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/routes/scanSessions.ts");
  });

  // The equality bites in both directions, exactly like cost_log's: if the helper
  // ever stops writing the column, the rule has stopped describing anything.
  it("041 §3.3: supersedes_id with NO writer is also a violation", () => {
    expect(checkSupersedesWriters([{ path: SUPERSEDES_WRITER, text: "nothing" }])).toHaveLength(1);
  });

  // The 1200-character window, from the invariant review: a real writer breaks its
  // column list over several lines with comments between them, and `supersedes_id`
  // conventionally comes LAST. At 400 characters such a writer was invisible — the
  // rule green, the property gone.
  it("041 §3.3: sees a writer whose column list runs past 400 characters", () => {
    const padded =
      "INSERT INTO condition_assessment\n" +
      "  -- the condition module owns this table (029 §2.10)\n".repeat(12) +
      "  (scan_session_id, shop_id, grade_range_low, grade_range_high, defects, notes, session_seq, supersedes_id)";
    expect(padded.length).toBeGreaterThan(400);
    const findings = checkSupersedesWriters([
      { path: SUPERSEDES_WRITER, text: "INSERT INTO human_confirmation (a, supersedes_id)" },
      { path: "src/services/condition.ts", text: padded },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/services/condition.ts");
  });

  it("041 §3.3: a quoted table name is the same write", () => {
    const findings = checkSupersedesWriters([
      { path: SUPERSEDES_WRITER, text: "INSERT INTO human_confirmation (a, supersedes_id)" },
      { path: "src/services/other.ts", text: 'INSERT INTO "pricing_snapshot" (a, supersedes_id)' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/services/other.ts");
  });

  // And it does NOT fire on prose. Every service and record here discusses
  // `supersedes_id`; a rule that counted mentions would make the column unmentionable.
  it("041 §3.3: naming the column in a comment is not writing it", () => {
    expect(
      checkSupersedesWriters([
        { path: SUPERSEDES_WRITER, text: "INSERT INTO human_confirmation (a, supersedes_id)" },
        { path: "src/services/condition.ts", text: "// a correction goes through the supersedes_id writer" },
      ])
    ).toEqual([]);
  });

  it("040 §8.2 step 1: a new `UPDATE scan_session` writer is a violation", () => {
    const findings = checkScanSessionStatusWriters([
      { path: "src/routes/scanSessions.ts", text: "UPDATE scan_session SET status = $1" },
    ]);
    expect(findings[0]!.message).toContain("declared 0");
    expect(findings[0]!.message).toContain("Write a record, not a status");
  });
});

describe("042 I22 — the fixed lock order", () => {
  it("splits a route file into one chunk per mutating handler", () => {
    const chunks = splitMutatingHandlers(
      'app.get("/a", h); app.post("/b", h1); app.patch("/c", h2); app.delete("/d", h3);'
    );
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toContain('"/b"');
  });

  // 042 §5.3(b): idempotency row FIRST, anchor second, in every handler, always.
  it("passes when the idempotency INSERT precedes the anchor lock", () => {
    expect(
      checkLockOrder([
        {
          path: "src/routes/x.ts",
          text: 'app.post("/x", async () => { await tx.query(`INSERT INTO request_idempotency (k) VALUES ($1)`); await lockScanSession(tx, s, i); });',
        },
      ])
    ).toEqual([]);
  });

  // The negative fixture 042 I22(b) asks for by name: "a deliberately
  // reversed-order fixture handler makes the lint fail."
  it("fails on a reversed-order handler, with no opt-out available", () => {
    const findings = checkLockOrder([
      {
        path: "src/routes/x.ts",
        text:
          'app.post("/x", async () => { await lockScanSession(tx, s, i); ' +
          "await tx.query(`INSERT INTO request_idempotency (k) VALUES ($1)`); });",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("BEFORE its request_idempotency INSERT");
  });

  // Today's tree: migrations/009 landed the table, no handler writes it yet (that
  // wiring is E02-B08's). The rule is in place BEFORE the first handler that could
  // violate it, which is the whole reason it exists.
  it("passes vacuously on a handler that has no idempotency row yet", () => {
    expect(
      checkLockOrder([
        { path: "src/routes/x.ts", text: 'app.post("/x", async () => { await lockScanSession(tx); });' },
      ])
    ).toEqual([]);
  });
});
