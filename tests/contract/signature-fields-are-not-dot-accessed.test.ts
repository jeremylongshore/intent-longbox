// Contract — E02-D13: A PACK'S FIELD NAME CANNOT BE DOT-ACCESSED THROUGH
// `SignatureFields`, ANYWHERE, BECAUSE THE COMPILER REFUSES IT.
//
// 049 §6.2 is the finding this file discharges, and it is worth quoting because
// it names precisely what was NOT true before this bead: E04-B03 removed the four
// comic field names from `SignatureFields`, leaving a bare index signature, and
// the record then corrected its own first draft —
//
//   "⚠ AND THAT REMOVES THE ADVERTISEMENT, NOT THE ERROR. `tsconfig.json` does
//    not set `noPropertyAccessFromIndexSignature`, so `fields.series` on a card
//    claim **still compiles** — it resolves through the index signature to
//    `string | null | undefined` and evaluates to `undefined`, exactly as
//    before."
//
// That `undefined` is the whole danger. A core-code caller reading `fields.series`
// off a CARD claim gets a well-typed `undefined` and treats a real claim as an
// empty one: no exception, no type error, no failing test — the same silent shape
// 049 §6.3 found in `identityResolution.ts`'s `!fields.series && !fields.issue`,
// which would have skipped every card lookup forever. 030 §6 rule 1 forbids `if
// (vertical === "comic")` in core code; a comic field name read off a shared type
// is that branch wearing a different costume, and `pnpm arch`'s rule 8 cannot see
// it because there is no vertical literal to match.
//
// WHY A COMPILE AND NOT A TEXT RULE. `scripts/architectureRules.ts` is the right
// home for a rule about what a file SAYS. This is a rule about what a TYPE MEANS:
// whether `fields.series` is legal depends on the declared type of `fields`, which
// is a question only the type checker can answer. A regex for `\.series\b` would
// fire on `ComicEditionFields.series` — a genuinely declared property, read
// legitimately inside the pack — and miss `claim.set` on a `Record<string,
// unknown>` alias. So the assertion is the compiler's, run over a copy of the tree
// with a fixture added.
//
// WHY A SCRATCH COPY (E02-D15). The negative fixture is a `.ts` file under `src/`,
// and E02-D14/D15 ruled that no test may create or delete a file in the
// repository's own `src/`: `tests/contract/no-test-writes-into-src.test.ts`
// enforces it, and the case count that moved on its own is why. So `src/` is
// COPIED under `os.tmpdir()` and the fixture is written there; `tsconfig.json`,
// `package.json` and `node_modules` are SYMLINKED back, so the compile that
// judges the fixture is governed by the repository's real config and not by a
// copy that could drift.
//
// SIX CASES, OF WHICH THREE RUN A COMPILER, EACH CLOSING A DIFFERENT WAY THIS
// COULD BE A THEATRE. They are referred to by NAME everywhere, here and in
// `tests/TESTING.md`, because numbering across two `describe` blocks is a count a
// reader cannot check against the file — the first version of that note numbered
// them and was wrong twice, which the MiniMax adversarial review of PR #89 caught.
//
//   `is set in the repository's tsconfig` — the flag is actually on. No compiler:
//      it fails FIRST and READABLY on the day somebody deletes the line.
//   `reaches scripts/ and tests/ by inheritance, with no override` — the lane that
//      typechecks `scripts/` and `tests/` inherits the flag rather than overriding
//      it. No compiler.
//   `compiles the scratch tree against the repository's own tsconfig` — the
//      harness is honest: the config is a symlink whose realpath and sha-256 match
//      the repository's file, and `src/` is a COPY rather than a link back. NO
//      COMPILER IS INVOKED HERE, which is why flipping the flag cannot turn it red.
//   `compiles clean with no fixture` — the scratch tree exits 0 untouched, so a red
//      negative below is the fixture and not a broken harness.
//   `refuses fields.series in src/services with TS4111` — the negative. Prove the
//      gate can fail, or it is not a gate.
//   `accepts the same read through brackets` — the identical read spelled
//      `["series"]` still compiles, so what the negative proves is the DOT and not
//      the file, the import or the type.
//
// Setting the flag to `false` turns EXACTLY TWO of these red — the first and the
// negative — and leaves the other four green.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  lstatSync,
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

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const TSCONFIG = "tsconfig.json";
const CHECK_TSCONFIG = "tsconfig.check.json";
const FLAG = "noPropertyAccessFromIndexSignature";

/**
 * Everything the compile resolves relative to the cwd, REFERENCED rather than
 * copied: the config itself (so the fixture is judged by the repository's rule),
 * `package.json` (`"type": "module"`, which decides how `NodeNext` reads every
 * `.js` specifier in the tree), and `node_modules` (`zod`, `pg`, `fastify` and
 * the `@types` packages `src/` imports — without them the scratch compile is a
 * wall of TS2307s and case 2 can never be green).
 *
 * Linux/macOS only, deliberately unguarded, on `architecture-gate.test.ts`'s
 * precedent: `symlinkSync` throws `EPERM` on a stock Windows runner and it throws
 * inside `makeScratchTree` before any assertion, so this file goes RED rather than
 * quietly compiling against a COPY of the config. CI is `ubuntu-latest`.
 */
const REFERENCED = [TSCONFIG, "package.json", "node_modules"] as const;

/** The compiler binary, addressed absolutely so a scratch cwd needs no package manager. */
const TSC_BIN = join(repoRoot, "node_modules", ".bin", "tsc");

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** A cwd `tsc` can run in: `src/` copied, everything else symlinked back here. */
function makeScratchTree(): string {
  const scratch = mkdtempSync(join(tmpdir(), "longbox-sigfields-"));
  cpSync(join(repoRoot, "src"), join(scratch, "src"), { recursive: true });
  for (const name of REFERENCED) symlinkSync(join(repoRoot, name), join(scratch, name));
  return scratch;
}

/**
 * `tsc --noEmit -p tsconfig.json` in the scratch cwd.
 *
 * `-p tsconfig.json` and not the absolute path, and the difference is not
 * cosmetic: TypeScript resolves `include: ["src/**\/*.ts"]` against the directory
 * of the config file AS ADDRESSED, so a cwd-relative name reaches the scratch
 * `src/` while an absolute path through the symlink would resolve to the
 * repository's and compile a tree with no fixture in it — green, and proving
 * nothing. Case 3 failing on a fixture that was never compiled would be
 * indistinguishable from case 3 passing, which is why case 2 exists.
 */
async function typecheckIn(cwd: string): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await execFileAsync(TSC_BIN, ["--noEmit", "-p", TSCONFIG], { cwd });
    return { code: 0, out: stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/**
 * The fixture, in the shape a core-code caller would actually write it.
 *
 * It lives under `src/services/` — OUTSIDE `src/catalog/` — because that is where
 * 049 §6.3's real instance was, and it reaches `SignatureFields` through
 * `src/catalog/index.js`, the module's only public surface (029 §3.3), so the
 * import itself is the legal one. The only illegal thing in the file is the dot.
 */
const fixture = (access: string): string =>
  "// TEMPORARY fixture for tests/contract/signature-fields-are-not-dot-accessed.test.ts,\n" +
  "// written into a scratch COPY of src/ (E02-D15). It is never in the repository.\n" +
  'import type { SignatureFields } from "../catalog/index.js";\n' +
  "export function readSeries(fields: SignatureFields): string | null | undefined {\n" +
  `  return ${access};\n` +
  "}\n";

const FIXTURE_PATH = ["src", "services", "__signature_fields_fixture__.ts"] as const;

describe("noPropertyAccessFromIndexSignature is on and stays on", () => {
  // The cheap, direct assertion, and the one that fails FIRST and READABLY on the
  // day somebody removes the line. The three compiles below would also go red, but
  // they would go red slowly and with a message about a fixture.
  it("is set in the repository's tsconfig", () => {
    const config = JSON.parse(readFileSync(join(repoRoot, TSCONFIG), "utf8")) as {
      compilerOptions?: Record<string, unknown>;
    };
    expect(config.compilerOptions?.[FLAG]).toBe(true);
  });

  // `pnpm typecheck` runs `tsconfig.check.json`, which is what puts `scripts/` and
  // `tests/` under the flag. It inherits by `extends`, and an override there would
  // switch the flag off for two thirds of the files the CI check reads while
  // `tsconfig.json` still said `true` — the failure this case exists to catch.
  it("reaches scripts/ and tests/ by inheritance, with no override", () => {
    const check = JSON.parse(readFileSync(join(repoRoot, CHECK_TSCONFIG), "utf8")) as {
      extends?: string;
      compilerOptions?: Record<string, unknown>;
      include?: string[];
    };
    expect(check.extends).toBe("./tsconfig.json");
    expect(check.compilerOptions ?? {}).not.toHaveProperty(FLAG);
    expect(check.include).toEqual(
      expect.arrayContaining(["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"])
    );
  });
});

// NO `inScratchTree(async (scratch) => …)` HELPER, DELIBERATELY, on
// `architecture-gate.test.ts`'s precedent: behind a lambda,
// `no-test-writes-into-src.test.ts` resolves a write destination to the constant
// inside the helper, so a rename would blind that rule on the very file it
// polices. Each case below makes its own tree and removes it in a `finally`.
describe("a dot-access on SignatureFields outside src/catalog fails typecheck", () => {
  // The invariant that makes the two compiles below mean anything. If the config
  // at the scratch cwd were a COPY, the fixtures would prove that a copy can fail
  // while the repository's own rule stayed untested.
  it("compiles the scratch tree against the repository's own tsconfig", () => {
    const scratch = makeScratchTree();
    try {
      const linked = join(scratch, TSCONFIG);
      expect(lstatSync(linked).isSymbolicLink()).toBe(true);
      expect(realpathSync(linked)).toBe(realpathSync(join(repoRoot, TSCONFIG)));
      expect(sha256(readFileSync(linked))).toBe(sha256(readFileSync(join(repoRoot, TSCONFIG))));
      // …and the tree the fixture is written into is NOT a link back: it is a
      // copy, which is the whole point of the move (E02-D15).
      expect(lstatSync(join(scratch, "src")).isSymbolicLink()).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  // The control. A scratch tree with no fixture in it compiles clean, so a
  // non-zero exit below is the dot and not the harness.
  it("compiles clean with no fixture", async () => {
    const scratch = makeScratchTree();
    try {
      const { code, out } = await typecheckIn(scratch);
      expect(out).toBe("");
      expect(code).toBe(0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 120_000);

  // The gate itself: prove it can fail.
  it("refuses `fields.series` in src/services with TS4111", async () => {
    const scratch = makeScratchTree();
    try {
      writeFileSync(join(scratch, ...FIXTURE_PATH), fixture("fields.series"));
      const { code, out } = await typecheckIn(scratch);
      // THREE STABLE ASSERTIONS, AND THE ENGLISH SENTENCE IS DELIBERATELY NOT ONE
      // OF THEM. The diagnostic CODE, the quoted property and the fixture's own
      // filename are contract; the prose around them is TypeScript's to reword.
      // The first version asserted the full sentence "Property 'series' comes from
      // an index signature", which would turn this case red on a compiler upgrade
      // that rephrased TS4111 while the behaviour under test was unchanged — a
      // gate that fails for a reason other than the one it is watching is worse
      // than no gate, because the next person deletes it. Flagged by the MiniMax
      // adversarial review of PR #89 (F5).
      expect(out).toContain("error TS4111");
      expect(out).toContain("'series'");
      expect(out).toContain("__signature_fields_fixture__.ts");
      expect(code).not.toBe(0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 120_000);

  // …and the flag forbids the DOT, not the read. Bracket access stays legal, which
  // is what every call site this bead changed now uses, and what a pack's own
  // `claimIsUsable` uses on its own field names. Without this case the suite could
  // not tell "the flag is on" from "the fixture import is broken".
  it("accepts the same read through brackets", async () => {
    const scratch = makeScratchTree();
    try {
      writeFileSync(join(scratch, ...FIXTURE_PATH), fixture('fields["series"]'));
      const { code, out } = await typecheckIn(scratch);
      expect(out).toBe("");
      expect(code).toBe(0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 120_000);
});
