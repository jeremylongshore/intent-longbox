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
  ORIGIN_DESIGNATION_WRITER,
  checkAuthorizationDecisionCountNouns,
  checkAuthorizationDecisionWriters,
  checkAuthAttemptReads,
  checkIdentityAccessWriters,
  checkIdentityImportSurface,
  checkIdentityPersonJoins,
  IDENTITY_ACCESS_WRITER,
  PERSON_JOIN_ROWS,
  PERSON_PROJECTION_COLUMNS,
  AUTH_ATTEMPT_READ_ROWS,
  projectionText,
  checkOriginDesignationWriters,
  checkCostLogWriters,
  checkMigrationNumbers,
  checkNoFreshnessColumn,
  checkServiceScopeSites,
  checkTenantGucWriters,
  checkTransactionsDeclareTenant,
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
  stripJsComments,
  type SourceFile,
  collectSources,
} from "../../scripts/architectureRules.js";
import { readMigrations } from "../../scripts/migrationDiscipline.js";
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

  // E03-D17: the import-graph half of 019 T35(b). `pnpm arch`'s text rule stops
  // the SQL being COPIED; this stops the accessor being imported past its barrel,
  // which would take the person query without the audit fact — the whole control,
  // and no layer rule would notice.
  it("refuses an import that reaches past src/identity/index.ts", async () => {
    const scratch = makeScratchTree();
    try {
      writeFileSync(
        join(scratch, "src", "services", "__identity_fixture_violation__.ts"),
        "// TEMPORARY negative fixture in a scratch COPY of src/ (E03-D17).\n" +
          "// It violates `identity-public-surface-only` by reaching into the module.\n" +
          'import { resolveShopRoster } from "../identity/accessors.js";\n' +
          "export const leak = resolveShopRoster;\n"
      );
      const { code, out } = await depcruiseIn(scratch);
      expect(out).toContain("identity-public-surface-only");
      expect(code).not.toBe(0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses the accessor reaching back into the rest of identity", async () => {
    // The other direction, and the one that keeps the accessor a leaf: the
    // accessor is imported BY the rest of identity and imports none of it back,
    // so it cannot acquire a session, a permission or a membership concern.
    const scratch = makeScratchTree();
    try {
      writeFileSync(
        join(scratch, "src", "identity", "__identity_fixture_violation__.ts"),
        "// TEMPORARY negative fixture in a scratch COPY of src/ (E03-D17).\n" +
          "// It violates `identity-reaches-only-platform`.\n" +
          'import { tokenHash } from "../services/auth/secrets.js";\n' +
          "export const leak = tokenHash;\n"
      );
      const { code, out } = await depcruiseIn(scratch);
      expect(out).toContain("identity-reaches-only-platform");
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
    // E03-B04's three, against the REAL tree for the same reason: a transaction
    // that names no tenant sees no rows and writes none, and it fails as an empty
    // result rather than as an error — so the tree is where it has to be asked.
    expect(checkTransactionsDeclareTenant(files)).toEqual([]);
    expect(checkTenantGucWriters(files)).toEqual([]);
  });

  // The scope inventory reads `scripts/` as well as `src/`, because three of the
  // six scopes are named only by CLIs today (the MFA trio, whose routes are
  // E03-D11's). Asserted against both trees rather than against a list.
  it("E03-B04: every cross-tenant scope is named exactly as often as declared", () => {
    const all = [...files, ...collectSources(join(repoRoot, "scripts"))];
    expect(checkServiceScopeSites(all)).toEqual([]);
  });

  // E03-D14's rule 3c reads BOTH trees for the same reason and a sharper one
  // (058 F6): the only writers of an origin designation are reached from
  // `scripts/`, so a rule handed `src/` alone was blind to the tree the act
  // lives in. Asserted over the union the gate itself passes.
  it("E03-D14: the origin designation has one writer, across src/ AND scripts/", () => {
    const all = [...files, ...collectSources(join(repoRoot, "scripts"))];
    expect(checkOriginDesignationWriters(all)).toEqual([]);
  });

  // E03-D15's rule 3d, over BOTH trees for the reason the scope inventory is: a
  // CLI that printed "three acts" from the actor audit would be exactly as wrong
  // as a service that returned it.
  it("059 §5: no file that reads the actor audit types a count as acts, effects or requests", () => {
    const all = [...files, ...collectSources(join(repoRoot, "scripts"))];
    expect(checkAuthorizationDecisionCountNouns(all)).toEqual([]);
    // …and the rule is not vacuous: files that name the table DO exist, so an
    // empty result is a pass rather than an empty input.
    expect(all.filter((f) => f.text.includes("authorization_decision")).length).toBeGreaterThan(0);
  });

  // E03-D17's three, over BOTH trees — 058 F6's reason with more force, because
  // one of the five migrated accessor callers IS a CLI.
  it("019 T35(b): src/identity/ is the only place in either tree that joins a row to a person", () => {
    const all = [...files, ...collectSources(join(repoRoot, "scripts"))];
    expect(checkIdentityPersonJoins(all)).toEqual([]);
    // Not vacuous: the accessor module exists and holds the statements.
    expect(all.filter((f) => f.path.startsWith("src/identity/")).length).toBeGreaterThan(0);
    // The rule is per-scanned-file, so the "no stale exemption" property is
    // asserted HERE, against the real tree, rather than by a rule reporting on
    // files it was never handed. A declared path that no longer exists is a hole
    // nobody is looking at.
    const paths = new Set(all.map((f) => f.path));
    for (const row of PERSON_JOIN_ROWS) expect(paths.has(row.path), row.path).toBe(true);
    for (const row of AUTH_ATTEMPT_READ_ROWS) expect(paths.has(row.path), row.path).toBe(true);
  });

  it("000-docs/060 §3: identity_access has exactly one writer, across src/ AND scripts/", () => {
    const all = [...files, ...collectSources(join(repoRoot, "scripts"))];
    expect(checkIdentityAccessWriters(all)).toEqual([]);
  });

  it("048 R17/I7: every FROM auth_attempt in either tree is a declared lockout derivation", () => {
    const all = [...files, ...collectSources(join(repoRoot, "scripts"))];
    expect(checkAuthAttemptReads(all)).toEqual([]);
    // The inventory is not empty, so an empty finding list is a pass and not an
    // empty input — the same non-vacuity check rule 3d carries.
    expect(AUTH_ATTEMPT_READ_ROWS.length).toBeGreaterThan(0);
  });

  it("security F3b: no file in EITHER tree imports past the accessor's barrel", () => {
    const all = [...files, ...collectSources(join(repoRoot, "scripts"))];
    expect(checkIdentityImportSurface(all)).toEqual([]);
    // Not vacuous: files that import the barrel DO exist in both trees.
    expect(all.filter((f) => /identity\/index\.js/.test(f.text)).length).toBeGreaterThan(1);
  });

  it("000-docs/060 §3.4: NOTHING under src/ reads identity_access — the audit is a CLI", () => {
    // A stronger statement than a convention, and the database backs it: the app
    // role holds INSERT and no SELECT (`appGrant: "insert-only"`), so a reader
    // inside the running server would fail at runtime. This asserts the source
    // half, so the failure is a red build rather than a red request.
    const readers = files.filter((f) => /\bFROM\s+identity_access\b/i.test(f.text));
    expect(readers.map((f) => f.path)).toEqual([]);
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

  it("E03-B04: a transaction with no tenant is a violation, and the message names the line", () => {
    const findings = checkTransactionsDeclareTenant([
      {
        path: "src/services/newThing.ts",
        text: "await withTransaction(pool, async (tx) => {\n  await tx.query('SELECT 1');\n});",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/services/newThing.ts:1");
  });

  it("E03-B04: the SAME call with a tenant is green, however long its callback", () => {
    const filler = "  // padding\n".repeat(80);
    expect(
      checkTransactionsDeclareTenant([
        {
          path: "src/services/newThing.ts",
          text: `await withTransaction(\n  pool,\n  async (tx) => {\n${filler}  },\n  { tenant: { shopId } }\n);`,
        },
      ])
    ).toEqual([]);
  });

  it("E03-B04: the option object of the NEXT call cannot satisfy the previous one", () => {
    // The window this rule used to use was a fixed number of characters, which a
    // long callback pushed past — and the next call's `{ tenant: … }` then fell
    // inside it. Paren-balanced extraction is what makes this case fail.
    const findings = checkTransactionsDeclareTenant([
      {
        path: "src/services/two.ts",
        text: "await withTransaction(pool, async () => 1);\nawait withTransaction(pool, async () => 2, { tenant: { shopId } });",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/services/two.ts:1");
  });

  it("E03-B04: a second file that sets the tenant GUC is a violation", () => {
    const findings = checkTenantGucWriters([
      { path: "src/db/tenantContext.ts", text: "set_config('longbox.shop_id', x, true)" },
      { path: "src/services/sneaky.ts", text: "await tx.query(`SET LOCAL longbox.shop_id = '${id}'`);" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/services/sneaky.ts");
  });

  it("E03-B04: PROSE about the GUC is not a writer — comments are stripped first", () => {
    expect(
      checkTenantGucWriters([
        { path: "src/db/tenantContext.ts", text: "set_config('longbox.shop_id', x, true)" },
        { path: "src/db.ts", text: "// Set as `SET LOCAL longbox.shop_id` in the same round trip." },
      ])
    ).toEqual([]);
  });

  it("E03-B04: one more site naming a service scope fails the inventory", () => {
    // TWO legitimate sites since E03-D11 (`resolvePrincipal` and
    // `resolvePrivileged`), so the fixture carries two and the violation is the
    // THIRD. The number moves with the declaration on purpose: a negative
    // fixture pinned to a stale count is a negative fixture that stops firing.
    const findings = checkServiceScopeSites([
      { path: "src/services/auth/principal.ts", text: 'serviceDb(pool, "session-resolution")' },
      { path: "src/services/auth/principal.ts", text: 'serviceDb(pool, "session-resolution")' },
      { path: "src/services/elsewhere.ts", text: 'serviceDb(pool, "session-resolution")' },
    ]);
    const site = findings.find((f) => f.message.includes("session-resolution"));
    expect(site).toBeDefined();
    expect(site!.message).toContain("src/services/elsewhere.ts");
  });

  it("029 §2.8: cost_log with NO writer is also a violation — the rule is an equality", () => {
    expect(checkCostLogWriters([{ path: "src/services/costLog.ts", text: "nothing" }])).toHaveLength(1);
  });

  // =========================================================================
  // E03-D11's two rules. Both guard an ABSENCE, which is the one class of
  // property no behavioural test can reach: the system does exactly the same
  // thing with a redundant column present or a second `031` applied, right up
  // until it does not.
  // =========================================================================

  it("057 §4.3 (brief question K3): an `mfa_verified_at` column anywhere is a violation", () => {
    // The edit this exists to stop is one that READS like an improvement — "add
    // `mfa_verified_at` so the freshness check is explicit" — and that ships
    // green, because every behavioural test passes with the column present.
    expect(
      checkNoFreshnessColumn([
        {
          path: "migrations/099_freshness.sql",
          text: "ALTER TABLE app_session ADD mfa_verified_at timestamptz;",
        },
      ])
    ).toHaveLength(1);
    expect(
      checkNoFreshnessColumn([{ path: "src/services/auth/sessions.ts", text: "row.mfa_verified_at" }])
    ).toHaveLength(1);
  });

  it("057 §4.3 (brief question K3): NAMING it in prose is not a violation, in either dialect", () => {
    // 048, 057, `policy.ts`, `sessions.ts` and `migrations/031` all name the
    // column to explain why it does not exist. A rule that punished saying so
    // would push the reasoning out of the tree, which is the opposite of the job.
    expect(
      checkNoFreshnessColumn([
        {
          path: "migrations/031_x.sql",
          text: "-- It does not add a mfa_verified_at column, and that is a decision.",
        },
        {
          path: "src/services/auth/policy.ts",
          text: "// no mfa_verified_at: the expiry IS the window\nconst x = 1;",
        },
        {
          path: "src/services/auth/policy.ts",
          text: "/* mfa_verified_at would be a second truth */\nconst y = 2;",
        },
      ])
    ).toEqual([]);
  });

  it("041 §10 (K6): two migration files sharing a number is a violation, and names both", () => {
    // The ORDINARY outcome of two branches in flight: each reads the tree, sees
    // the same highest number, takes the next one. Nothing downstream says so —
    // the ledger keys on the FILENAME, so both apply in directory order.
    const findings = checkMigrationNumbers([
      "030_causal_reference_persistence.sql",
      "031_first_factor_and_privileged_session.sql",
      "031_something_else.sql",
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("031_first_factor_and_privileged_session.sql");
    expect(findings[0]!.message).toContain("031_something_else.sql");
  });

  it("041 §10 (K6): a gap in the numbering is NOT a violation", () => {
    // `027` was reserved by E03-B06 and never written, and the runner reads no
    // contiguity (tests/integration/migrations.test.ts says so in its own words).
    // A rule that demanded a dense sequence would fail the tree as it stands.
    expect(checkMigrationNumbers(["026_a.sql", "028_b.sql", "029_c.sql"])).toEqual([]);
  });

  it("041 §10 (K6): the REAL migrations directory has one file per number", () => {
    expect(checkMigrationNumbers(readMigrations().map((m) => m.filename))).toEqual([]);
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

  it("059 §5: a numeric `acts` field in a file that reads the audit table is a violation", () => {
    // The negative direction, because a rule that has never failed is
    // indistinguishable from one that cannot. This is the shape the data-model
    // lens said a convention decays into: a reader that quietly starts reporting
    // ACTS, in a table where two rows may be one act replayed.
    const findings = checkAuthorizationDecisionCountNouns([
      {
        path: "src/services/reports/shiftSummary.ts",
        text: "SELECT count(*) FROM authorization_decision\ninterface Row { acts: number }",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/services/reports/shiftSummary.ts");
    expect(findings[0]!.rule).toBe("authorization-decision-counts-are-decisions");
  });

  it("059 §5: it catches a CLI too, and it does NOT fire on prose or on the right noun", () => {
    // `scripts/` is in scope: a CLI printing "three effects" is the same error.
    expect(
      checkAuthorizationDecisionCountNouns([
        {
          path: "scripts/breakGlassReport.ts",
          text: "FROM authorization_decision\ntype Out = { effects: number }",
        },
      ])
    ).toHaveLength(1);
    // Prose that DISCUSSES the nouns is not a declaration — this repository
    // explains itself at length, and a checker that counted explanation would
    // teach the next author to stop.
    expect(
      checkAuthorizationDecisionCountNouns([
        {
          path: "src/services/auth/authorizationAudit.ts",
          text: "// a count of authorization_decision rows is not a count of acts or effects\ninterface C { decisions: number }",
        },
      ])
    ).toEqual([]);
    // And a file that never names the table is none of this rule's business.
    expect(
      checkAuthorizationDecisionCountNouns([{ path: "src/services/pricing.ts", text: "acts: number" }])
    ).toEqual([]);
  });

  it("054 §4.4: the audit table with NO writer is also a violation — the rule is an equality", () => {
    // The failure that matters more in practice: a refactor that quietly stops
    // recording decisions leaves an empty audit behind a green gate.
    expect(
      checkAuthorizationDecisionWriters([{ path: AUTHORIZATION_DECISION_WRITER, text: "nothing" }])
    ).toHaveLength(1);
  });

  it("058 §3: a second writer of the origin designation is a violation", () => {
    // E03-D14's rule 3c, in the direction that matters most: a second writer of
    // the RETIREMENT can take a person out of 019 T35(c)'s audited population
    // from a call site nobody reviewed as a security change.
    const findings = checkOriginDesignationWriters([
      { path: ORIGIN_DESIGNATION_WRITER, text: "INSERT INTO app_user_origin (a)" },
      { path: "src/services/scanSession.ts", text: "INSERT INTO app_user_origin_retirement (a)" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/services/scanSession.ts");
  });

  it("058 F6: a second writer in `scripts/` is a violation too — the tree the act lives in", () => {
    // The direction the first version of this rule was blind to. Both CLIs that
    // designate a person run from `scripts/`, so a writer added beside them
    // passed a rule scoped to `src/`.
    const findings = checkOriginDesignationWriters([
      { path: ORIGIN_DESIGNATION_WRITER, text: "INSERT INTO app_user_origin (a)" },
      { path: "scripts/designate-staff.ts", text: "INSERT INTO app_user_origin (a)" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("scripts/designate-staff.ts");
  });

  // -------------------------------------------------------------------------
  // E03-D17 — 019 T35(b)'s gate-test half, proven able to fail.
  //
  // 029 §5 move 8's standard: a rule with no negative fixture is a rule that has
  // never been shown to bite, and rule N3 in `.dependency-cruiser.cjs` is this
  // repository's own reminder that a rule can be green BY CONSTRUCTION. Each
  // fixture below is a statement somebody would plausibly write.
  // -------------------------------------------------------------------------
  it("019 T35(b): a display_name projected outside the accessor is a violation", () => {
    // The one that matters: a surface needs a NAME, and this is where one is
    // produced. Exactly the shape `readUser` and `readPerson` had before this
    // bead — two copies of it, in two files, neither audited.
    const findings = checkIdentityPersonJoins([
      {
        path: "src/routes/scanSessions.ts",
        text: "const r = await db.query(`SELECT s.id, u.display_name FROM scan_session s JOIN x u ON 1=1`);",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe("identity-is-the-only-person-join");
    expect(findings[0]!.message).toContain("src/routes/scanSessions.ts");
  });

  it("034 §3.3 A5: operator_id, created_by and confirmed_by are each a violation in a projection", () => {
    // A5 puts the two LEGACY strings inside the contract: T35 keys on operator
    // identifiers of ANY shape, and an unverified one is per-operator data that
    // is also unreliable. All three are asserted by name rather than testing
    // `operator_id` and trusting the others to follow (034 I9's own standard).
    for (const column of ["operator_id", "created_by", "confirmed_by"]) {
      const findings = checkIdentityPersonJoins([
        { path: "src/services/scanSession.ts", text: "`SELECT id, " + column + " FROM scan_session`" },
      ]);
      expect(findings, column).toHaveLength(1);
    }
    // …and the column list the rule enforces is the one the record names.
    // The list grew by three at v1.1.0 (the security lens's F1): a person's
    // attributes are not the property of one table, and `contact_name` /
    // `contact_note` were being projected out of `shop_recovery_nomination`.
    expect([...PERSON_PROJECTION_COLUMNS].sort()).toEqual(
      [
        "confirmed_by",
        "contact_name",
        "contact_note",
        "created_by",
        "display_name",
        "email",
        "operator_id",
      ].sort()
    );
  });

  it("security F1: a contact_name projection from ANY table is a violation", () => {
    // THE FINDING THAT MADE I1 FALSE IN THE TREE IT GOVERNS. v1.0.0's rule keyed
    // on the person TABLE plus four column names, and
    // `src/services/auth/recovery.ts` projected a named human's name and a note
    // about how to reach them out of `shop_recovery_nomination` — a different
    // table — with no audit fact, no caller, and a green gate. The read is
    // deleted; this is the fixture that stops it coming back.
    const findings = checkIdentityPersonJoins([
      {
        path: "src/services/auth/recovery.ts",
        text: "`SELECT n.id, n.kind, n.contact_name, n.contact_note FROM shop_recovery_nomination n`",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe("identity-is-the-only-person-join");
  });

  it("security F1: the deleted read is GONE from the real tree, not merely forbidden", () => {
    // The rule and the deletion are two claims and this asserts the second one.
    // A rule that forbids a statement still present somewhere is a rule with an
    // exemption nobody wrote down.
    // Comments are stripped first: `recovery.ts` and the identity barrel both
    // RECORD the deletion in prose, and a check that counted explanations would
    // teach the next author to stop writing them (`stripJsComments`' own reason).
    const all = [...collectSources(join(repoRoot, "src")), ...collectSources(join(repoRoot, "scripts"))];
    const offenders = all.filter((f) => /currentRecoveryNomination/.test(stripJsComments(f.text)));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("019 T35(b): reading the person TABLE at all is a violation, even projecting only an id", () => {
    // The stronger half of the boundary. `SELECT u.id FROM app_user` discloses
    // nothing — and it is still refused outside the accessor, because a rule that
    // only watched columns would let a person-read grow one column at a time.
    const findings = checkIdentityPersonJoins([
      { path: "src/services/sessionApi.ts", text: "`SELECT u.id FROM app_user u WHERE u.id = $1`" },
    ]);
    expect(findings).toHaveLength(1);
  });

  it("E03-D17: an INSERT INTO app_user is NOT a violation — a write is the other direction", () => {
    // `register-shop` and `upsertPerson` carry a name INTO the database that the
    // caller already holds. Flagging that would push the shop-registration write
    // into an accessor whose audit row would record nothing worth having.
    expect(
      checkIdentityPersonJoins([
        {
          path: "scripts/register-shop.ts",
          text: "`INSERT INTO app_user (email, display_name) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET display_name = app_user.display_name RETURNING id`",
        },
      ])
    ).toEqual([]);
  });

  it("E03-D17: RETURNING a display_name IS a violation — a write that hands one back is a read", () => {
    // The exact edit this bead made to `upsertPerson`: `RETURNING id,
    // display_name` became `RETURNING id`. The projection walker reads the
    // RETURNING tail as well as every SELECT list, which is what makes this
    // distinguishable from the case above.
    const findings = checkIdentityPersonJoins([
      {
        path: "src/services/auth/people.ts",
        text: "`INSERT INTO app_user (email, display_name) VALUES (lower($1), $2) RETURNING id, display_name`",
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it("E03-D17: app_user_origin and app_user_id are NOT the person table", () => {
    // The negative lookahead earns its keep: 058's designation tables and every
    // `m.app_user_id = s.app_user_id` join would otherwise be swept up, and a
    // rule that fires on the audits is a rule somebody disables.
    expect(
      checkIdentityPersonJoins([
        {
          path: "src/services/auth/origin.ts",
          text: "`SELECT o.id FROM app_user_origin o WHERE o.app_user_id = $1`",
        },
      ])
    ).toEqual([]);
  });

  it("E03-D17: the exemption is an EQUALITY — a declared file that stops violating fails too", () => {
    // `SELECT_STAR_ROWS`' discipline, one rule over: a stale exemption is a hole
    // nobody is looking at.
    const findings = checkIdentityPersonJoins([
      { path: PERSON_JOIN_ROWS[0]!.path, text: "// nothing at all" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("0 statement(s)");
    expect(findings[0]!.message).toContain("1 declared");
  });

  it("E03-D17: the projection walker reads SELECT lists and RETURNING tails, not WHERE clauses", () => {
    // The unit behind the two cases above, asserted directly so a future edit to
    // the walker fails here rather than silently widening or narrowing the rule.
    expect(projectionText("SELECT a, b FROM t WHERE display_name = $1")).toContain("a, b");
    expect(projectionText("SELECT a, b FROM t WHERE display_name = $1")).not.toContain("display_name");
    expect(projectionText("INSERT INTO t (x) VALUES ($1) RETURNING id, display_name")).toContain(
      "display_name"
    );
  });

  it("security F3b: a CLI importing past the barrel is a violation", () => {
    // depcruise cruises `src` only, so the strongest boundary in this bead
    // stopped at a directory edge — and `scripts/` imports the module. A CLI
    // reaching `accessors.ts` directly takes the person query WITHOUT the fact.
    const findings = checkIdentityImportSurface([
      {
        path: "scripts/enroll-authenticator.ts",
        text: 'import { resolvePersonByKey } from "../src/identity/accessors.js";',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe("identity-public-surface-only");
  });

  it("security F3b: importing the BARREL is not a violation", () => {
    expect(
      checkIdentityImportSurface([
        {
          path: "scripts/enroll-authenticator.ts",
          text: 'import { resolvePersonByKey } from "../src/identity/index.js";',
        },
      ])
    ).toEqual([]);
  });

  it("000-docs/060 §3: a second writer of identity_access is a violation", () => {
    const findings = checkIdentityAccessWriters([
      { path: IDENTITY_ACCESS_WRITER, text: "INSERT INTO identity_access (a)" },
      { path: "src/services/auth/api.ts", text: "INSERT INTO identity_access (a)" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("src/services/auth/api.ts");
  });

  it("000-docs/060 §3: NO writer of identity_access is a violation too — an equality", () => {
    // The direction that matters more than a second writer: an accessor module
    // whose audit call was deleted would pass every other rule in this file.
    expect(checkIdentityAccessWriters([{ path: IDENTITY_ACCESS_WRITER, text: "nothing" }])).toHaveLength(1);
  });

  it("048 R17: an undeclared read of auth_attempt is a violation", () => {
    // The substrate/surface line as a rule rather than an assertion (048 §13 Q9).
    // A reporting query over the failure log is a per-operator surface.
    const findings = checkAuthAttemptReads([
      { path: "src/services/costLog.ts", text: "`SELECT count(*) FROM auth_attempt`" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe("auth-attempt-is-substrate-not-surface");
  });

  it("058 §3: the designation with NO writer is also a violation — the rule is an equality", () => {
    expect(
      checkOriginDesignationWriters([{ path: ORIGIN_DESIGNATION_WRITER, text: "nothing" }])
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

  it("fails on a handler that takes the SECOND factor's anchor BEFORE the FIRST's (E03-D11)", () => {
    // ⚠ **THE FIFTH POSITION'S OWN NEGATIVE FIXTURE**, which the invariant review
    // found missing — the rule was proved to fire in three directions and not in
    // the one this bead added, and a rule that has never failed on its own new
    // pair is indistinguishable from one that cannot.
    //
    // The pair is load-bearing rather than notional, which is why it needs a
    // fixture at all: 048 §4.3's per-person lockout budget is SHARED across all
    // three factors, so the sign-in holds `user_credential` and
    // `user_authenticator` in ONE transaction — two anchors over one count is the
    // write skew §9.1 exists to close. Two handlers taking them in opposite
    // orders deadlock the moment two people sign in at once.
    const findings = checkLockOrder([
      {
        path: "src/services/auth/backwards.ts",
        text:
          "export async function signIn(deps, input) {\n" +
          "  await verifyTotp(tx, { appUserId: id, code: input.code });\n" +
          "  await verifyPassword(tx, { email: input.email, password: input.password });\n" +
          "  return { status: 201 };\n" +
          "}\n",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("the user_authenticator lock BEFORE the user_credential lock");
  });

  it("passes the SAME two anchors in the declared order", () => {
    // The positive direction, because a rule that only ever fails is a rule
    // nobody can tell from a broken matcher. This is the sign-in's real shape.
    expect(
      checkLockOrder([
        {
          path: "src/services/auth/forwards.ts",
          text:
            "export async function signIn(deps, input) {\n" +
            "  await verifyPassword(tx, { email: input.email, password: input.password });\n" +
            "  await verifyTotp(tx, { appUserId: id, code: input.code });\n" +
            "  return { status: 201 };\n" +
            "}\n",
        },
      ])
    ).toEqual([]);
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

  // THE FIFTH POSITION IN THE ORDER, AND THE SIXTH ADDED TO IT (E03-D22, 056 §11
  // R10, 042 v1.6.1, 000-docs/061 §5). Nothing in the tree takes it TOGETHER with
  // any other position today — `completeInstall` is a provider callback with no
  // idempotency key, no cookie and no scan session — so these FOUR fixtures (one
  // positive, three negative, the last of them the SHAPE case) are the only
  // evidence the position works, on exactly the reasoning the fourth position's
  // fixtures were written under.
  it("passes when the store claim sits between the authenticator lock and the anchor (E03-D22)", () => {
    expect(
      checkLockOrder([
        {
          path: "src/services/shopConfigApi.ts",
          text:
            "export async function attach(deps, ctx, body) {\n" +
            "  return runIdempotent(deps.pool, idem, async (tx) => {\n" +
            "    await lockAndRotate(tx, ctx.session, new Date());\n" +
            "    await verifyTotp(tx, { appUserId: ctx.operatorId, code: body.code });\n" +
            "    await claimStoreDomain(tx, ctx.shopId, body.domain);\n" +
            "    await lockScanSession(tx, s, i);\n" +
            "    return { status: 200 };\n" +
            "  });\n" +
            "}\n",
        },
      ])
    ).toEqual([]);
  });

  it("fails on a handler that takes the scan_session anchor BEFORE the store claim (E03-D22)", () => {
    // Coarse before fine, and the hierarchy is real: a `scan_session` belongs to
    // a shop. A handler holding the finer lock while reaching for the tenant row
    // deadlocks against the install callback, which takes the tenant row first.
    const findings = checkLockOrder([
      {
        path: "src/services/shopConfigApi.ts",
        text:
          "export async function attach(deps, ctx, body) {\n" +
          "  await lockScanSession(tx, s, i);\n" +
          "  await tx.query(`UPDATE shop SET shopify_domain = $1 WHERE id = $2`, [d, id]);\n" +
          "  return { status: 200 };\n" +
          "}\n",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("the scan_session anchor lock BEFORE the shop store-claim lock");
  });

  it("takes the position from a SELECT … FROM shop … FOR UPDATE too — the shape, not the name (E03-D22)", () => {
    // ⚠ The invariant review's finding. The claim's guarantee is the btree
    // unique, not the row lock (000-docs/061 §3.1), so the plausible wrong
    // refactor is "optimise" it into an explicit `SELECT … FOR UPDATE` on the
    // shop row. That would remove the guarantee — and, if the lint matched only
    // `claimStoreDomain` and the `UPDATE`, it would also take the lock position
    // INVISIBLY, so the rule would stop policing the handler it exists for.
    const findings = checkLockOrder([
      {
        path: "src/services/shopConfigApi.ts",
        text:
          "export async function attach(deps, ctx, body) {\n" +
          "  await lockScanSession(tx, s, i);\n" +
          "  await tx.query(`SELECT id FROM shop WHERE id = $1 FOR NO KEY UPDATE`, [id]);\n" +
          "  return { status: 200 };\n" +
          "}\n",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("the scan_session anchor lock BEFORE the shop store-claim lock");
  });

  it("fails on a handler that claims the store BEFORE its idempotency INSERT (E03-D22)", () => {
    // The identity of the request is recognised before it writes tenant config,
    // for 042 §5.3(b)'s original reason: a replay must be answered from the
    // stored response having taken no lock at all.
    const findings = checkLockOrder([
      {
        path: "src/routes/shopConfig.ts",
        text:
          'app.post("/x", async () => { await claimStoreDomain(tx, shopId, domain); ' +
          "await tx.query(`INSERT INTO request_idempotency (k) VALUES ($1)`); });",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("the shop store-claim lock BEFORE its request_idempotency INSERT");
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
