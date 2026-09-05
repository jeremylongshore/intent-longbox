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
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_DECISION_WRITER,
  checkAuthorizationDecisionWriters,
  checkCostLogWriters,
  checkIdentityFunctionSeparation,
  checkIdentityPairEdit,
  checkLockOrder,
  checkNoVerticalBranching,
  checkRouteDbAccess,
  checkScanSessionStatusWriters,
  checkSelectStar,
  checkSupersedesWriters,
  findSupersedesWriters,
  SUPERSEDES_WRITER,
  COST_LOG_WRITER,
  CATALOG_IDENTITY_FILES,
  DECISION_LOG_FILE,
  EDITION_SIGNATURE_FILE,
  IDENTITY_KEY_FILE,
  ROUTE_DB_ROWS,
  SELECT_STAR_ROWS,
  VERTICAL_LITERALS,
  VERTICAL_PACK_FILES,
  splitMutatingHandlers,
  type SourceFile,
  collectSources,
} from "../../scripts/architectureRules.js";
import { REGISTERED_VERTICALS } from "../../src/catalog/index.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG = ".dependency-cruiser.cjs";

/** depcruise on the real tree, through the exact command `pnpm depcruise` runs. */
async function depcruise(): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await execFileAsync("pnpm", ["exec", "depcruise", "src", "--config", CONFIG], {
      cwd: repoRoot,
    });
    return { code: 0, out: stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

// ---------------------------------------------------------------------------
// THE NEGATIVE FIXTURES RUN OUTSIDE THE REPOSITORY (E02-D15).
//
// Proving a graph rule can fail means putting a violating file exactly where the
// rule looks: `routes-do-not-touch-the-database` is scoped to `^src/routes/`, so
// a fixture that violates it has to sit at that path. Until this bead it sat at
// that path IN THE REAL TREE — written, cruised, deleted in a `finally`. Vitest
// runs test FILES in parallel workers, so for the width of that `try` every
// other suite was reading a `src/` with one extra file in it. E02-D14 is the
// instance it cost: a `readdirSync` of `src/routes` in
// `outbox-declarations.test.ts` saw two entries on some runs and three on
// others, `it.each` sized itself accordingly, and `pnpm test` reported 1049 or
// 1050 cases on a byte-identical tree while staying green throughout. Two
// suites still read the live tree through `collectSources`
// (`catalog-surface.test.ts`, `server-emits-no-operator-copy.test.ts`); neither
// trips on a phantom today, and after this bead neither has to depend on that.
//
// So `src/` is COPIED into a scratch cwd under `os.tmpdir()` and the fixture is
// written into the COPY. `.dependency-cruiser.cjs` is the one thing that must
// never be copied: a negative test run against a duplicated config proves the
// duplicate can fail, which is worth nothing. It — and everything else the
// cruise resolves relative to its cwd — is SYMLINKED, and the first test below
// asserts BOTH that the link's realpath is the repository's file AND that the
// bytes read through the scratch path hash to the same sha-256. Convert that
// symlink to a `cpSync` and this file fails rather than quietly proving a copy.
//
// `scripts/architectureRules.ts` needs no such treatment: the non-graph rules
// below are pure functions over in-memory `SourceFile` records, so this file
// imports the real module and never has a copy of it to drift from.
// ---------------------------------------------------------------------------

/**
 * Everything `.dependency-cruiser.cjs` resolves relative to the cwd, REFERENCED
 * rather than copied:
 *   - the config itself, since `--config` is a cwd-relative path in `pnpm depcruise`;
 *   - `tsconfig.json`, named by `options.tsConfig.fileName`;
 *   - `package.json`, which is how dependency-cruiser classifies a resolved module
 *     as `dependencyTypes: ["npm"]` — the discriminator
 *     `routes-do-not-touch-the-database` is written against;
 *   - `node_modules`, without which `pg` does not resolve to a path that rule's
 *     `(^|/)node_modules/pg/` can match and the negative fixture proves nothing.
 *
 * LINUX (AND macOS) ONLY, DELIBERATELY UNGUARDED. `symlinkSync` throws `EPERM` on
 * a stock Windows runner without Developer Mode, and it throws inside
 * `makeScratchTree` before any assertion runs — so this whole file goes red
 * rather than quietly cruising a COPY of the config, which is the failure this
 * bead exists to prevent. CI is `ubuntu-latest` and the estate develops on Linux,
 * so nothing is skipped and nothing is branched on `process.platform`: a
 * platform gate here would be a way to make the gate stop proving anything on the
 * platform that could not run it.
 *
 * ONE CONSEQUENCE FOR ANYONE WRITING A RULE THIS HARNESS MUST PROVE: the rule has
 * to be SHAPE-TOLERANT about resolved dependency paths. A cruise from the scratch
 * cwd reaches an npm module through the symlink, so dependency-cruiser reports it
 * relative to that cwd and the path comes back as
 * `../../home/…/node_modules/.pnpm/pg@8.23.0/node_modules/pg/esm/index.mjs`,
 * where the same cruise in the repository reports
 * `node_modules/.pnpm/pg@8.23.0/…`. A rule anchored with `^node_modules/` would
 * be green here and red there — which is why the shipped rule is anchored
 * `(^|/)node_modules/pg/` and why the census test below compares COUNTS
 * (`90 modules, 286 dependencies`) rather than the module NAMES: the set is the
 * same, the strings that address it are not.
 */
const REFERENCED = [CONFIG, "tsconfig.json", "package.json", "node_modules"] as const;

/** The cruiser binary, addressed absolutely so a scratch cwd needs no package manager. */
const DEPCRUISE_BIN = join(repoRoot, "node_modules", ".bin", "depcruise");

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** A cwd depcruise can run in: `src/` copied, everything else symlinked back here. */
function makeScratchTree(): string {
  const scratch = mkdtempSync(join(tmpdir(), "longbox-arch-gate-"));
  cpSync(join(repoRoot, "src"), join(scratch, "src"), { recursive: true });
  for (const name of REFERENCED) symlinkSync(join(repoRoot, name), join(scratch, name));
  return scratch;
}

/** The same cruise, in a scratch cwd, against the SAME config file. */
async function depcruiseIn(cwd: string): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await execFileAsync(DEPCRUISE_BIN, ["src", "--config", CONFIG], { cwd });
    return { code: 0, out: stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** `(90 modules, 286 dependencies cruised)` -> `"90/286"`; throws rather than guessing. */
function cruiseCensus(out: string): string {
  const m = /\((\d+) modules, (\d+) dependencies cruised\)/.exec(out);
  if (m === null) throw new Error(`no module census in depcruise output:\n${out}`);
  return `${m[1]}/${m[2]}`;
}

// NO `inScratchTree(async (scratch) => …)` HELPER, DELIBERATELY. The DRY version
// existed and was deleted: `no-test-writes-into-src.test.ts` resolves a write
// destination by expanding same-file constants, and behind a lambda the constant
// it lands on is the one inside the helper — so the sweep only saw a `mkdtemp`
// while the callback parameter happened to share that name. A rename would have
// blinded the rule on the very file it polices, and the guard against that was a
// COMMENT. Each test below makes its own scratch tree and removes it in a
// `finally`: three more lines, and nothing for the rule to see through.

describe("dependency-cruiser (the import-graph half)", () => {
  it("exits 0 on the tree as it stands", async () => {
    const { code, out } = await depcruise();
    expect(out).toContain("no dependency violations found");
    expect(code).toBe(0);
  }, 60_000);

  // THE INVARIANT THAT MAKES EVERY NEGATIVE BELOW MEAN SOMETHING. If the config
  // at the scratch cwd is a COPY, the fixtures prove that a copy can fail and the
  // repository's own gate stays untested. Realpath identity is the assertion; the
  // sha-256 equality is the one that still fires if a future author replaces the
  // symlink with a copy — on a platform without symlinks, say — and lets it drift.
  it("runs its fixtures against a scratch cwd whose config IS the repository's file", () => {
    const scratch = makeScratchTree();
    try {
      const linked = join(scratch, CONFIG);
      expect(lstatSync(linked).isSymbolicLink()).toBe(true);
      expect(realpathSync(linked)).toBe(realpathSync(join(repoRoot, CONFIG)));
      expect(sha256(readFileSync(linked))).toBe(sha256(readFileSync(join(repoRoot, CONFIG))));
      // …and the tree the fixtures are written into is NOT a link back: it is a
      // copy, which is the whole point of the move.
      expect(lstatSync(join(scratch, "src")).isSymbolicLink()).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  // A copy that cruises to different numbers is not the tree under test. This is
  // the assertion that fails the day `makeScratchTree` stops copying something the
  // cruise needs: an untested fixture harness is worth exactly what an untested
  // gate is worth.
  it("cruises the scratch copy to the same census as the real tree", async () => {
    const real = await depcruise();
    const scratch = makeScratchTree();
    try {
      const copied = await depcruiseIn(scratch);
      expect(copied.out).toContain("no dependency violations found");
      expect(copied.code).toBe(0);
      expect(cruiseCensus(copied.out)).toBe(cruiseCensus(real.out));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 120_000);

  // 029 §5 move 8: "a deliberately-added forbidden import exits non-zero".
  it("exits non-zero on a deliberately violating file", async () => {
    const scratch = makeScratchTree();
    try {
      writeFileSync(
        join(scratch, "src", "routes", "__arch_fixture_violation__.ts"),
        "// TEMPORARY negative fixture, written into a scratch COPY of src/ (E02-D15).\n" +
          "// It violates `routes-do-not-touch-the-database` by importing pg at the edge.\n" +
          'import pg from "pg";\nexport const pool = new pg.Pool();\n'
      );
      const { code, out } = await depcruiseIn(scratch);
      expect(out).toContain("routes-do-not-touch-the-database");
      expect(code).not.toBe(0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  // 029 §5 move 8: "a sibling import inside one module keeps it green (proves N1
  // fixed)". Without the `$1` backreference in `module-public-surface-only`, this
  // exact shape is forbidden and the rule is unsatisfiable.
  //
  // The old version wrote `src/modules/__arch_fixture__/` into the real tree and
  // needed a paragraph of care not to delete a colleague's module barrels on the
  // day E02-B03 move 1 lands. In a scratch tree there is nothing to be careful
  // about: the directory it creates is one nobody else can see.
  it("stays green when one module file imports a sibling (N1 fixed)", async () => {
    const scratch = makeScratchTree();
    try {
      const fixtureDir = join(scratch, "src", "modules", "__arch_fixture__");
      mkdirSync(fixtureDir, { recursive: true });
      writeFileSync(join(fixtureDir, "sibling.ts"), "export const answer = 42;\n");
      writeFileSync(join(fixtureDir, "index.ts"), 'export { answer } from "./sibling.js";\n');
      const { code, out } = await depcruiseIn(scratch);
      expect(out).toContain("no dependency violations found");
      expect(code).toBe(0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("the non-graph rules, against the real tree", () => {
  const files = collectSources(join(repoRoot, "src"));

  it("collects the source tree it claims to", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.map((f) => f.path)).toContain("src/routes/scanSessions.ts");
  });

  it("finds no violation of any of the seven rules", () => {
    expect(checkSelectStar(files)).toEqual([]);
    expect(checkRouteDbAccess(files)).toEqual([]);
    expect(checkCostLogWriters(files)).toEqual([]);
    // E03-B03's rule 3b, asserted against the REAL tree for the same reason the
    // `cost_log` one is: the single writer is a property of the tree, not of a
    // comment on the writer.
    expect(checkAuthorizationDecisionWriters(files)).toEqual([]);
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
  // `.dependency-cruiser.cjs` — was prose in the doc and nothing anywhere else,
  // and it counted THREE. E02-D08 removed all three with the statements that
  // needed them, so the assertion inverts: the config must name that file in NO
  // `pathNot` at all. Kept rather than deleted, because the row it guards is the
  // one that would silently come back — a future author who needs "just one"
  // exemption fails here.
  it("names src/routes/scanSessions.ts in no depcruise pathNot exemption (E02-D08)", () => {
    const config = readFileSync(join(repoRoot, ".dependency-cruiser.cjs"), "utf8");
    const occurrences = config.match(/\^src\/routes\/scanSessions\\\\\.ts\$/g) ?? [];
    expect(occurrences).toHaveLength(0);
    // The three rules that carried them still exist and still apply — to every
    // route file now, with no exception.
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
    { path: "src/services/scanSession.ts", text: "SELECT * UPDATE scan_session SET" },
  ];

  it("the fixture baseline is itself clean, so each negative below isolates one rule", () => {
    // scanSession.ts appears twice above (once from SELECT_STAR_ROWS); keep the
    // richer one, which carries both the trail read and the status writer.
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
    const grew = checkSelectStar([{ path: "src/services/scanSession.ts", text: "SELECT * SELECT *" }]);
    expect(grew[0]!.message).toContain("declared 1");
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

  it("054 §4.4: a second writer of authorization_decision is a violation", () => {
    // The negative direction, because a rule that has never failed is
    // indistinguishable from one that cannot. A handler appending its own
    // decision row would be recording an authorization no decision function took.
    const findings = checkAuthorizationDecisionWriters([
      { path: AUTHORIZATION_DECISION_WRITER, text: "INSERT INTO authorization_decision (a)" },
      { path: "src/routes/scanSessions.ts", text: "INSERT INTO authorization_decision (a)" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/routes/scanSessions.ts");
  });

  it("054 §4.4: the audit table with NO writer is also a violation — the rule is an equality", () => {
    // The failure that matters more in practice: a refactor that quietly stops
    // recording decisions leaves an empty audit behind a green gate.
    expect(
      checkAuthorizationDecisionWriters([{ path: AUTHORIZATION_DECISION_WRITER, text: "nothing" }])
    ).toHaveLength(1);
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

  it("also splits a SERVICE file into one chunk per exported handler", () => {
    // The reach the rule was missing. Handlers moved out of `src/routes/` at
    // E02-D08, and a rule keyed on `.post(` sees nothing in the file they moved
    // to — which is how a gate stays green while the property it guards stops
    // holding.
    const chunks = splitMutatingHandlers(
      "export async function confirm(a) { return 1; } export async function price(b) { return 2; }"
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain("confirm");
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

  // 048 K1 inserted a THIRD position between 042's two, and the same reasoning
  // applies to it: a rule that has never failed is indistinguishable from one
  // that cannot. Both new pairs get a fixture.
  it("fails on a handler that locks the session BEFORE its idempotency INSERT (048 K1)", () => {
    const findings = checkLockOrder([
      {
        path: "src/services/sessionApi.ts",
        text:
          "export async function confirm(deps, ctx, body) {\n" +
          "  await lockAndRotate(tx, ctx.session, new Date());\n" +
          "  return runIdempotent(deps.pool, idem, async (tx) => ({ status: 201 }));\n" +
          "}\n",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("the app_session lock BEFORE its request_idempotency INSERT");
  });

  // THE FOURTH POSITION (E03-D06, 048 §4.3/§9.1). Nothing in the tree matches
  // `AUTHENTICATOR_LOCK` today — the second factor has no route — so these three
  // fixtures are the ONLY evidence the position works at all. A rule added ahead
  // of its first caller and never exercised is a rule that will be wrong the day
  // it fires, which is precisely how the position before it earned its fixtures.
  it("passes when the authenticator lock sits between the session lock and the anchor", () => {
    expect(
      checkLockOrder([
        {
          path: "src/services/mfaApi.ts",
          text:
            "export async function verify(deps, ctx, body) {\n" +
            "  return runIdempotent(deps.pool, idem, async (tx) => {\n" +
            "    await lockAndRotate(tx, ctx.session, new Date());\n" +
            "    await verifyTotp(tx, { appUserId: ctx.operatorId, code: body.code });\n" +
            "    await lockScanSession(tx, s, i);\n" +
            "    return { status: 200 };\n" +
            "  });\n" +
            "}\n",
        },
      ])
    ).toEqual([]);
  });

  it("fails on a handler that verifies a second factor BEFORE its idempotency INSERT", () => {
    const findings = checkLockOrder([
      {
        path: "src/services/mfaApi.ts",
        text:
          "export async function verify(deps, ctx, body) {\n" +
          "  await verifyTotp(tx, { appUserId: ctx.operatorId, code: body.code });\n" +
          "  return runIdempotent(deps.pool, idem, async (tx) => ({ status: 200 }));\n" +
          "}\n",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain(
      "the user_authenticator lock BEFORE its request_idempotency INSERT"
    );
  });

  it("fails on a handler that takes the scan_session anchor BEFORE the authenticator lock", () => {
    // The pair that matters operationally: a handler holding a book's anchor
    // through an argon2id verification is a lock held for the length of a KDF.
    const findings = checkLockOrder([
      {
        path: "src/services/mfaApi.ts",
        text:
          "export async function verify(deps, ctx, body) {\n" +
          "  return runIdempotent(deps.pool, idem, async (tx) => {\n" +
          "    await lockScanSession(tx, s, i);\n" +
          "    await redeemRecoveryCode(tx, { appUserId: ctx.operatorId, code: body.code });\n" +
          "    return { status: 200 };\n" +
          "  });\n" +
          "}\n",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("the scan_session anchor lock BEFORE the user_authenticator lock");
  });

  it("fails on a handler that takes the scan_session anchor BEFORE the session lock (048 K1)", () => {
    const findings = checkLockOrder([
      {
        path: "src/services/sessionApi.ts",
        text:
          "export async function confirm(deps, ctx, body) {\n" +
          "  return runIdempotent(deps.pool, idem, async (tx) => {\n" +
          "    await lockOrRefuse(tx, ctx.shopId, session.id);\n" +
          "    await lockAndRotate(tx, ctx.session, new Date());\n" +
          "  });\n" +
          "}\n",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("the scan_session anchor lock BEFORE the app_session lock");
  });

  it("passes on the real three-position order (idempotency → session → anchor)", () => {
    // The order the tree actually takes, spelled the way `runIdempotent` reaches
    // it: the session lock is a closure the idempotent request carries, run
    // immediately after the INSERT and before `fn`.
    expect(
      checkLockOrder([
        {
          path: "src/services/sessionApi.ts",
          text:
            "export async function confirm(deps, ctx, body) {\n" +
            "  return runIdempotent(deps.pool, { ...idem, sessionLock: ctx.sessionLock }, async (tx) => {\n" +
            "    await lockOrRefuse(tx, ctx.shopId, session.id);\n" +
            "  });\n" +
            "}\n",
        },
      ])
    ).toEqual([]);
  });

  it("passes on a handler that takes only one of the two locks", () => {
    // Nothing to order. This is not the same as a rule with nothing to see: the
    // case below is.
    expect(
      checkLockOrder([
        { path: "src/routes/x.ts", text: 'app.post("/x", async () => { await lockScanSession(tx); });' },
      ])
    ).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // The BLIND-RULE regression, which is the reason this section grew.
  //
  // Until E02-D08 widened it, `checkLockOrder` scanned `src/routes/` and split on
  // `.post(`. This PR moved every handler into `src/services/sessionApi.ts` and
  // reached both locks through helpers, so the rule read ZERO markers and a
  // reversed-order handler produced ZERO findings while the gate stayed green.
  // Each assertion below fails if any part of that reach is lost again.
  // ---------------------------------------------------------------------------

  it("SEES the service layer: a reversed-order SERVICE handler fails the rule", () => {
    const findings = checkLockOrder([
      {
        path: "src/services/sessionApi.ts",
        text:
          "export async function confirm(deps, ctx, body) {\n" +
          "  await lockOrRefuse(tx, ctx.shopId, session.id);\n" +
          "  return runIdempotent(deps.pool, idem, async (tx) => ({ status: 201 }));\n" +
          "}\n",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/services/sessionApi.ts");
  });

  it("recognises each lock through its HELPER, not only through its SQL", () => {
    // `runIdempotent` holds the INSERT and `lockOrRefuse` holds the `FOR UPDATE`;
    // a rule that reads only SQL is one refactor away from blind.
    expect(
      checkLockOrder([
        {
          path: "src/services/sessionApi.ts",
          text: "export async function ok() { await runIdempotent(p, r, async (tx) => { await lockOrRefuse(tx); }); }",
        },
      ])
    ).toEqual([]);
  });

  it("finds REAL handlers in the shipped tree, so the green above is not vacuous", () => {
    // The assertion that would have caught the blindness: the file the handlers
    // live in must contain chunks carrying BOTH markers. If this drops to zero,
    // `checkLockOrder(files) === []` above stops being evidence of anything.
    const tree = collectSources(join(repoRoot, "src"));
    const api = tree.find((f) => f.path === "src/services/sessionApi.ts")!;
    const ordered = splitMutatingHandlers(api.text).filter(
      (chunk) => /\brunIdempotent\s*\(/.test(chunk) && /\blockOrRefuse\s*\(/.test(chunk)
    );
    expect(ordered.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Rule 7 — 047 A8: `identityKey` and `edition_signature` stay two functions.
//
// The rule exists because the two functions LOOK alike and the drift between
// them is silent: both still compile. 047 §9.3 rules they stay apart because
// merging them would move a 019 measurement rule — `identityKey` decides T3's
// confirm-versus-correct and deliberately excludes publisher and year, and
// `019:57` makes that exclusion non-editable without a 000-docs/006 row.
//
// Both halves are exercised twice, real tree and fixture, for this file's
// standing reason: a rule that has never failed is indistinguishable from one
// that cannot.
// ---------------------------------------------------------------------------
describe("rule 7 — identityKey and edition_signature stay apart (047 A8)", () => {
  const identity = (text: string): SourceFile => ({ path: IDENTITY_KEY_FILE, text });
  const signature = (text: string): SourceFile => ({ path: EDITION_SIGNATURE_FILE, text });
  const comicIdentity = (text: string): SourceFile => ({ path: "src/catalog/comicIdentity.ts", text });
  /** Every subject file present and inert, so a fixture can vary exactly one. */
  const tree = (...overrides: SourceFile[]): SourceFile[] => {
    const base = new Map<string, SourceFile>(
      [IDENTITY_KEY_FILE, ...CATALOG_IDENTITY_FILES].map((path) => [path, { path, text: "const x = 1;" }])
    );
    for (const file of overrides) base.set(file.path, file);
    return [...base.values()];
  };

  it("passes on the real tree", () => {
    expect(checkIdentityFunctionSeparation(collectSources(join(repoRoot, "src")))).toEqual([]);
  });

  it("FAILS when the workflow function imports the catalog one", () => {
    const findings = checkIdentityFunctionSeparation(
      tree(identity('import { comicEditionSignature } from "../catalog/editionSignature.js";'))
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("import each other");
  });

  it("FAILS when the catalog function imports the workflow one", () => {
    const findings = checkIdentityFunctionSeparation(
      tree(signature('import { identityKey } from "../services/confirmationOutcome.js";'))
    );
    expect(findings).toHaveLength(1);
  });

  // THE FIXTURE A8 NAMES BY NAME: "one exported FIELDS array imported by both".
  it("FAILS on a shared field-list module imported by both — the mechanical merge", () => {
    const findings = checkIdentityFunctionSeparation(
      tree(
        identity('import { FIELDS } from "../identityFields.js";'),
        signature('import { FIELDS } from "../identityFields.js";')
      )
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/identityFields.ts");
  });

  it("FAILS when either file exports a field-list-shaped constant", () => {
    expect(
      checkIdentityFunctionSeparation(tree(identity('export const IDENTITY_FIELDS = ["title"];')))
    ).toHaveLength(1);
    expect(
      checkIdentityFunctionSeparation(tree(signature('export const SIGNATURE_FIELDS = ["series"];')))
    ).toHaveLength(1);
  });

  it("FAILS LOUDLY when either file is missing, rather than passing vacuously", () => {
    // A rule whose subject was renamed must be moved deliberately. Silence here
    // is the blind-rule failure `checkLockOrder`'s history records.
    expect(checkIdentityFunctionSeparation([identity("const x = 1;")])).toHaveLength(1);
    // Dropping the SECOND catalog subject is just as blinding as dropping the first.
    expect(
      checkIdentityFunctionSeparation([identity("const x = 1;"), signature("const x = 1;")])
    ).toHaveLength(1);
  });

  it("FAILS on an import edge to the SECOND catalog subject, comicIdentity.ts", () => {
    // `comicSignatureInput` and `comicSignatureClaim` carry the same four-field
    // list, so an edge to that file is the same merge by another route.
    const findings = checkIdentityFunctionSeparation(
      tree(identity('import { comicSignatureClaim } from "../catalog/comicIdentity.js";'))
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/catalog/comicIdentity.ts");
  });

  it("FAILS on a field list shared with comicIdentity.ts", () => {
    const findings = checkIdentityFunctionSeparation(
      tree(
        identity('import { FIELDS } from "../identityFields.js";'),
        comicIdentity('import { FIELDS } from "../identityFields.js";')
      )
    );
    expect(findings).toHaveLength(1);
  });

  it("does NOT fire on the catalog subjects importing each other", () => {
    // `comicIdentity.ts` imports `editionSignature.ts` on purpose — that edge is
    // the pack reusing its OWN normalisation, which 047 §9.3 says to reuse. Only
    // an edge crossing to the workflow side is the merge.
    expect(
      checkIdentityFunctionSeparation(
        tree(comicIdentity('import { normalizeField } from "./editionSignature.js";'))
      )
    ).toEqual([]);
  });

  it("does NOT fire on a denylist export like COPY_FACT_KEYS", () => {
    // The regression the gate itself caught during this bead: `COPY_FACT_KEYS` is
    // a list of attribute names an edition may NEVER carry (047 A6) — the
    // opposite of an identity field list, and it must stay exported.
    expect(
      checkIdentityFunctionSeparation(tree(comicIdentity('export const COPY_FACT_KEYS = ["grader"];')))
    ).toEqual([]);
  });

  it("permits an unrelated import on one side only", () => {
    expect(
      checkIdentityFunctionSeparation(tree(identity('import type { Queryable } from "../db.js";')))
    ).toEqual([]);
  });

  it("FAILS on an import edge to the THIRD catalog subject, cardIdentity.ts (E04-B03)", () => {
    // `cardSignatureClaim` maps a flat payload onto the card field list, so it is
    // a field list by the same argument that put `comicIdentity.ts` in the set. A
    // subject set that grew a pack and not a row would watch the wrong files.
    const findings = checkIdentityFunctionSeparation(
      tree(identity('import { cardSignatureClaim } from "../catalog/cardIdentity.js";'))
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/catalog/cardIdentity.ts");
  });

  it("holds every pack module in the subject set, so a fourth vertical cannot slip past", () => {
    expect(CATALOG_IDENTITY_FILES).toContain("src/catalog/cardIdentity.ts");
    for (const path of VERTICAL_PACK_FILES) expect(CATALOG_IDENTITY_FILES).toContain(path);
  });
});

// ---------------------------------------------------------------------------
// Rule 8 — 014 §3.4 / 030 §6 rule 1: no core code branches on a vertical.
//
// "Plug-and-play requires a vertical pack, not scattered `if comic` statements."
// The rule is the mechanical half of E04-B03's acceptance line — that card
// examples resolve through the same core contract as comics WITHOUT core-code
// branching — and, like every rule here, it is exercised on the real tree and on
// a fixture, because a rule that has never failed is indistinguishable from one
// that cannot.
// ---------------------------------------------------------------------------
describe("rule 8 — no vertical branching in core (014 §3.4, 030 §6 rule 1)", () => {
  const file = (path: string, text: string): SourceFile[] => [{ path, text }];

  it("passes on the real tree", () => {
    expect(checkNoVerticalBranching(collectSources(join(repoRoot, "src")))).toEqual([]);
  });

  it("FAILS on the canonical form 030 §6 rule 1 names", () => {
    const findings = checkNoVerticalBranching(
      file("src/services/identify.ts", 'if (vertical === "comic") { return comicOnly(); }')
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe("no-vertical-branching-in-core");
    expect(findings[0]!.message).toContain("ONLY to select a pack");
  });

  it("FAILS on the reversed comparison, the loose one, and a switch label", () => {
    expect(
      checkNoVerticalBranching(file("src/services/x.ts", 'if ("sports-card" === v) return 1;'))
    ).toHaveLength(1);
    expect(
      checkNoVerticalBranching(file("src/services/x.ts", 'if (v != "tcg-card") return 1;'))
    ).toHaveLength(1);
    expect(
      checkNoVerticalBranching(file("src/services/x.ts", 'switch (v) { case "comic": return 1; }'))
    ).toHaveLength(1);
  });

  it("does NOT fire on a MAP KEY, which is a pack being selected", () => {
    // §6 rule 1 permits reading `vertical` to select a pack; `packRegistry.ts`
    // does nothing else, and a rule that fired on it would forbid the fix.
    expect(
      checkNoVerticalBranching(file("src/catalog/packRegistry.ts", 'const P = { "comic": comicPack };'))
    ).toEqual([]);
    expect(checkNoVerticalBranching(file("src/services/x.ts", 'const v = "comic";'))).toEqual([]);
  });

  it("does NOT fire on a comment quoting the prohibition", () => {
    // Every neighbouring rule's header explains itself by quoting the thing it
    // forbids. A rule that could not tell code from prose would make its own
    // documentation unwritable.
    expect(
      checkNoVerticalBranching(file("src/services/x.ts", '// forbidden: if (vertical === "comic")'))
    ).toEqual([]);
  });

  it("does NOT fire inside a pack module, which owns its own vertical", () => {
    expect(
      checkNoVerticalBranching(file("src/catalog/cardIdentity.ts", 'if (v === "tcg-card") return a;'))
    ).toEqual([]);
    // …and the exemption is by PATH, so the same line elsewhere still fails.
    expect(
      checkNoVerticalBranching(file("src/catalog/dedupe.ts", 'if (v === "tcg-card") return a;'))
    ).toHaveLength(1);
  });

  it("watches every registered vertical, so a new pack cannot arrive unwatched", () => {
    expect([...VERTICAL_LITERALS].sort()).toEqual([...REGISTERED_VERTICALS].sort());
  });
});

describe("rule 7's second half — a paired edit needs a 006 row (047 A8)", () => {
  it("FAILS when identityKey and comicIdentity.ts are edited without a 006 row", () => {
    // The gap the invariant review found: a diff editing `comicSignatureClaim`
    // beside `identityKey` is the same paired edit, and the first version of this
    // rule watched only `editionSignature.ts`.
    const findings = checkIdentityPairEdit([IDENTITY_KEY_FILE, "src/catalog/comicIdentity.ts"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/catalog/comicIdentity.ts");
  });

  it("passes when that pair IS accompanied by a 006 row", () => {
    expect(
      checkIdentityPairEdit([IDENTITY_KEY_FILE, "src/catalog/comicIdentity.ts", DECISION_LOG_FILE])
    ).toEqual([]);
  });

  it("passes when two CATALOG subjects are edited together without the workflow one", () => {
    // Both sit inside the pack and are versioned together; only a diff crossing
    // to `identityKey` is a measurement change.
    expect(checkIdentityPairEdit(CATALOG_IDENTITY_FILES)).toEqual([]);
  });

  it("passes when only ONE of the two functions is edited", () => {
    expect(checkIdentityPairEdit([IDENTITY_KEY_FILE, "src/routes/scanSessions.ts"])).toEqual([]);
    expect(checkIdentityPairEdit([EDITION_SIGNATURE_FILE])).toEqual([]);
  });

  it("FAILS when BOTH are edited and no 006 row is filed", () => {
    const findings = checkIdentityPairEdit([IDENTITY_KEY_FILE, EDITION_SIGNATURE_FILE]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe("identity-pair-edit-needs-a-006-row");
  });

  it("passes when BOTH are edited AND the decision log is amended in the same diff", () => {
    expect(checkIdentityPairEdit([IDENTITY_KEY_FILE, EDITION_SIGNATURE_FILE, DECISION_LOG_FILE])).toEqual([]);
  });

  it("tolerates the whitespace a `git diff --name-only` pipe leaves behind", () => {
    expect(
      checkIdentityPairEdit([`  ${IDENTITY_KEY_FILE}  `, `${EDITION_SIGNATURE_FILE}\r`, ""])
    ).toHaveLength(1);
  });

  it("names files that exist, so a rename cannot quietly retire the rule", () => {
    // The paired-edit check compares strings; if a path constant drifts from the
    // tree it would stop matching any real diff and never fire again.
    const paths = collectSources(join(repoRoot, "src")).map((f) => f.path);
    expect(paths).toContain(IDENTITY_KEY_FILE);
    for (const path of CATALOG_IDENTITY_FILES) expect(paths).toContain(path);
    expect(CATALOG_IDENTITY_FILES).toContain(EDITION_SIGNATURE_FILE);
    expect(existsSync(join(repoRoot, DECISION_LOG_FILE))).toBe(true);
  });
});
