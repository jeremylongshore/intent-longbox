// Contract — E02-D15: NO TEST MAY CREATE OR DELETE A FILE UNDER THE REPOSITORY'S
// `src/`.
//
// The rule is E02-D14's, generalised. That bead's instance was a case count that
// moved on its own: `tests/contract/architecture-gate.test.ts` wrote a negative
// fixture into `src/routes/`, vitest runs test FILES in parallel workers, and the
// `readdirSync` another suite used to size an `it.each` saw two entries on some
// runs and three on others. `pnpm test` reported 1049 or 1050 cases on a
// byte-identical tree, green every time — which is the failure mode, because a
// count that moves on its own says "some case ran somewhere", not "this named
// case ran here".
//
// E02-D14 fixed the READER (enumerate from `git ls-files`, which reads the index
// and cannot see an untracked write). E02-D15 fixes the WRITER: the fixtures now
// run against a scratch copy of `src/` under `os.tmpdir()`. This file is what
// stops the writer coming back. Without it the rule is a paragraph in
// `tests/TESTING.md`, and a rule nothing checks is a comment.
//
// WHAT IT CHECKS, precisely. For every tracked `.ts` file under `tests/`, two
// families of call site are located and their subject expanded through local
// `const`s, exported constants, same-file helper bodies and rename bindings:
//
//   A. A FILESYSTEM MUTATOR — `writeFileSync`, `mkdirSync`, `rmSync`,
//      `createWriteStream`, `openSync`, the promise spellings, and so on. Its
//      subject is the DESTINATION argument: argument 2 for the two-path calls
//      (`cpSync`, `renameSync`, `symlinkSync`, `linkSync`, `copyFileSync`) and
//      argument 1 for the rest.
//   B. A PROCESS SPAWN — `execSync`, `execFileSync`, `spawnSync`, `execFile`,
//      `spawn`, `exec`, and any local alias of one (`const execFileAsync =
//      promisify(execFile)`). Its subject is the WHOLE argument list, because
//      `execSync("touch src/x.ts")` hides the path in a command string and there
//      is no destination position to read.
//
// The subject must not name a `src` path segment. Two escapes, both narrow:
// the subject is also rooted at a `mkdtempSync`/`tmpdir()` scratch directory, or
// — for a spawn only — the command is one of the READ-ONLY tools named below.
//
// Reading `src/` stays entirely free: `collectSources(join(repoRoot, "src"))` is
// not a mutation, and `cpSync(join(repoRoot, "src"), join(scratch, "src"))`
// copies OUT of the tree, which is why the DESTINATION argument — not "any
// argument" — is the subject for family A.
//
// FOUR KNOWN LIMITS, stated rather than hidden. Three more were found by the
// invariant review of PR #84 and CLOSED rather than documented (`execSync`,
// `createWriteStream`, and `import { writeFileSync as wfs }`); what remains is:
//   1. A path built in one `tests/` module and mutated in another is only caught
//      when the constant is `export`ed (exported constants are merged into every
//      file's alias map). A non-exported cross-module path cannot be imported,
//      so the hole needs deliberate work to reach.
//   2. A path assembled by string arithmetic (`"s" + "rc"`) is invisible. That is
//      obfuscation, not the shape that recurs; the shape that recurs is a named
//      constant beside the write, which is exactly what E02-D15 removed.
//   3. A spawn that mutates `src/` WITHOUT naming it — `execSync("make")`, where
//      the writing happens inside a Makefile — is invisible for the same reason.
//   4. The READ-ONLY tool list is a list of tools, not of files. A read-only
//      command that is not on it produces a FALSE POSITIVE, loudly, and the fix
//      is to name the tool. That polarity is deliberate: an unknown command that
//      names a `src` path fails closed.
// No limit weakens the assertion for any file in the tree today, and the vacuity
// guards below prove the sweep is looking at real call sites of both families.
//
// Bead: longbox-e5b.2.25 (E02-D15). Docs: 000-docs/044 §6; tests/TESTING.md
// operational notes ("Never build cases from a live `readdir` of `src/`").
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The mutating half of `node:fs`, mapped to the 1-BASED INDEX OF THE ARGUMENT
 * THAT NAMES THE PATH BEING WRITTEN. Two-path calls put the destination second,
 * and that distinction is the whole reason this table exists rather than a flat
 * list: `cpSync(<repo src>, <scratch src>)` is the copy E02-D15 depends on, and a
 * rule that read argument 1 would forbid it.
 *
 * Both the `…Sync` and the promise spellings are listed. `readFileSync`,
 * `readdirSync`, `statSync` and friends are deliberately absent: reading the tree
 * is not the hazard — a concurrent WRITE into a directory another worker is
 * enumerating is. So are the METADATA calls (`utimesSync`, `chmodSync`,
 * `chownSync`): the invariant this bead states is that no test CREATES OR DELETES
 * a file under `src/`, and a mode change moves nothing in a directory listing.
 * Read the list as exactly that scope, not as "every export of `node:fs`".
 *
 * `createWriteStream` and `openSync`/`open` are here because a file descriptor
 * writes exactly as well as `writeFileSync` does; the invariant review of PR #84
 * found `createWriteStream` missing. Their FLAGS argument is not inspected, so an
 * `openSync(<repo src path>, "r")` fires too. That is deliberate: reading is what
 * `readFileSync` is for, nothing in the tree opens a descriptor onto `src/`, and
 * this rule prefers a loud false positive to a quiet hole.
 */
const DESTINATION_ARGUMENT: Readonly<Record<string, number>> = {
  writeFileSync: 1,
  appendFileSync: 1,
  mkdirSync: 1,
  rmSync: 1,
  rmdirSync: 1,
  unlinkSync: 1,
  truncateSync: 1,
  createWriteStream: 1,
  openSync: 1,
  cpSync: 2,
  copyFileSync: 2,
  renameSync: 2,
  symlinkSync: 2,
  linkSync: 2,
  writeFile: 1,
  appendFile: 1,
  mkdir: 1,
  rm: 1,
  rmdir: 1,
  unlink: 1,
  truncate: 1,
  open: 1,
  cp: 2,
  copyFile: 2,
  rename: 2,
  symlink: 2,
};

/**
 * The process-spawning half, found by the same review: `execSync("touch
 * src/x.ts")` writes into the tree without touching `node:fs` at all.
 *
 * A spawn has no destination POSITION — the path can be anywhere in a command
 * string — so the subject is the whole argument list. `exec` is in the set and is
 * the one name that needs care: `/re/.exec(s)` is `RegExp.prototype.exec`, so a
 * match preceded by a `.` is skipped. Every `child_process` import in this tree
 * is a named import, so nothing real is lost; `child_process.exec(…)` would be,
 * and that is limit 3's neighbourhood rather than a hole worth a parser.
 */
const SPAWNS = ["execSync", "execFileSync", "spawnSync", "execFile", "spawn", "exec"] as const;

/**
 * Tools that cannot write, so naming a `src` path in their arguments is a READ.
 *
 * A LIST OF TOOLS, NOT OF FILES — which is the whole reason it is acceptable. An
 * unknown command that names a `src` path FAILS CLOSED, and the way to clear it
 * is to say which tool is read-only and why, in a diff a reviewer can see.
 * `depcruise` earns its row only without `--output-to`, which is the one flag
 * that makes it write.
 */
const READ_ONLY_SPAWNS: ReadonlyArray<{ readonly tool: string; readonly test: (s: string) => boolean }> = [
  { tool: "git ls-files", test: (s) => /\bgit\b/.test(s) && /\bls-files\b/.test(s) },
  {
    tool: "git show / cat-file / rev-parse",
    test: (s) => /\bgit\b/.test(s) && /\b(show|cat-file|rev-parse)\b/.test(s),
  },
  { tool: "depcruise (without --output-to)", test: (s) => /\bdepcruise\b/.test(s) && !/--output-to/.test(s) },
];

/**
 * Names a `src` PATH SEGMENT: `"src"`, `"src/routes/x.ts"`, `"a/src/b"`, a bare
 * identifier `src`.
 *
 * The boundary class is a path/expression boundary — quote, slash, bracket,
 * comma, whitespace — and NOT "any non-identifier character". The looser version
 * matched a HYPHEN, so `"user-src-token.json"` read as a write into the source
 * tree: a confusing failure naming a phantom violation, on a file that has
 * nothing to do with `src/`. Found by the advisory review of PR #84; nothing in
 * the tree writes such a path today, which is exactly why it would have been
 * discovered by whoever first did.
 */
const NAMES_SRC = /(?:^|[\s"'`(,[/])src(?:[\s"'`),\]/]|$)/;

/** Rooted at a scratch directory nobody else can see. */
const SCRATCH_ROOTED = /\bmkdtempSync?\s*\(|\bmkdtemp\s*\(|\btmpdir\s*\(\s*\)/;

/**
 * A same-length copy of `text` with COMMENT and STRING-LITERAL CONTENT blanked.
 *
 * Same length so every index found here addresses the original. Blanked because a
 * call is code, not prose or data: this file quotes violating fixtures as string
 * literals, and a scanner that could not tell the difference would flag itself —
 * which is how a guard acquires an allowlist with its own name in it.
 */
function maskLiterals(text: string): string {
  const out = text.split("");
  let i = 0;
  const blankTo = (end: number): void => {
    for (let k = i; k < end && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      blankTo(end === -1 ? text.length : end);
      i = end === -1 ? text.length : end;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blankTo(stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") j += 2;
        else if (text[j] === c) break;
        else j++;
      }
      i += 1;
      blankTo(Math.min(j, text.length));
      i = Math.min(j, text.length) + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

/** Top-level argument ranges of the call whose `(` sits at `open`, or `null` if unbalanced. */
function argumentRanges(masked: string, open: number): Array<[number, number]> | null {
  const ranges: Array<[number, number]> = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        ranges.push([start, i]);
        return ranges;
      }
    } else if (c === "," && depth === 1) {
      ranges.push([start, i]);
      start = i + 1;
    }
  }
  return null;
}

/** The index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "{") depth++;
    else if (masked[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * The `{` that opens a function BODY, given the index of its `(` or `<`.
 *
 * Not `indexOf("{")`: a return-type annotation gets there first, in two shapes —
 * `Promise<{ code: number }>` and a bare `{ path: string }` — and brace matching
 * from inside a type takes the type for the body, which reads the function as
 * empty and lets a helper that hands back the real tree pass. Braces inside
 * parens and angle brackets are skipped, and a top-level `{ … }` FOLLOWED BY
 * ANOTHER `{` was an object return type rather than a body.
 *
 * That last step is a heuristic and it has an edge: an intersection return type,
 * `function f(): { a: 1 } & { b: 2 } { … }`, puts an `&` between the two braces
 * and the second one is read as the body. Nothing in the tree writes one, and the
 * consequence is a false NEGATIVE for one helper rather than a false green for the
 * sweep — but it is named here rather than discovered later, and the day a test
 * needs that shape it needs a fixture with it.
 */
function bodyBrace(masked: string, from: number): number {
  let parens = 0;
  let angles = 0;
  for (let i = from; i < masked.length; i++) {
    const c = masked[i]!;
    if (c === "(") parens++;
    else if (c === ")") parens--;
    else if (c === "<") angles++;
    else if (c === ">") angles = Math.max(0, angles - 1);
    else if (c === ";" && parens === 0 && angles === 0) return -1;
    else if (c === "{" && parens === 0 && angles === 0) {
      const close = matchBrace(masked, i);
      if (close === -1) return -1;
      const rest = masked.slice(close + 1).trimStart();
      if (rest.startsWith("{")) {
        i = close;
        continue;
      }
      return i;
    }
  }
  return -1;
}

/**
 * `const NAME = <expr>;` and `function NAME(…) { … }` in one file, values sliced
 * from the ORIGINAL text.
 *
 * FUNCTIONS ARE IN THE MAP FOR A REASON. A scratch directory is normally built by
 * a helper — `const scratch = makeScratchTree()` — so a resolver that expanded
 * only constants would stop at the call and read the destination as unrooted.
 * That is a FALSE POSITIVE that would make the honest fix unlandable, which is
 * how a guard gets an exemption written into it. Inlining the helper's body
 * instead keeps the rule mechanical: the destination is scratch-rooted iff a
 * `mkdtempSync`/`tmpdir()` is reachable from the expression that names it.
 */
function aliasMap(text: string, masked: string): Map<string, string> {
  const map = new Map<string, string>();
  const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=(?!=)/g;
  let m: RegExpExecArray | null;
  while ((m = declaration.exec(masked)) !== null) {
    const from = m.index + m[0].length;
    let depth = 0;
    let end = -1;
    for (let i = from; i < masked.length; i++) {
      const c = masked[i]!;
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === ";" && depth === 0) {
        end = i;
        break;
      }
      if (depth < 0) break;
    }
    if (end !== -1) map.set(m[1]!, text.slice(from, end).trim());
  }
  const fn = /\bfunction\s+([A-Za-z_$][\w$]*)\s*[(<]/g;
  while ((m = fn.exec(masked)) !== null) {
    if (map.has(m[1]!)) continue;
    const open = bodyBrace(masked, m.index + m[0].length - 1);
    if (open === -1) continue;
    let depth = 0;
    for (let i = open; i < masked.length; i++) {
      const c = masked[i]!;
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          map.set(m[1]!, text.slice(open, i + 1).trim());
          break;
        }
      }
    }
  }
  return map;
}

/** Exported constants, visible to every file that could import them. */
function exportedAliases(files: readonly SweptFile[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files) {
    const masked = maskLiterals(file.text);
    const declaration = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=(?!=)/g;
    let m: RegExpExecArray | null;
    while ((m = declaration.exec(masked)) !== null) {
      const local = aliasMap(file.text, masked).get(m[1]!);
      if (local !== undefined) map.set(m[1]!, local);
    }
  }
  return map;
}

/** Substitute known aliases, outside string literals only, to a bounded depth. */
function expand(expr: string, aliases: ReadonlyMap<string, string>): string {
  let current = expr;
  for (let round = 0; round < 6; round++) {
    const masked = maskLiterals(current);
    const identifier = /[A-Za-z_$][\w$]*/g;
    const edits: Array<[number, number, string]> = [];
    let m: RegExpExecArray | null;
    while ((m = identifier.exec(masked)) !== null) {
      const value = aliases.get(m[0]);
      if (value !== undefined && value !== m[0]) edits.push([m.index, m.index + m[0].length, `(${value})`]);
    }
    if (edits.length === 0) return current;
    let next = current;
    for (const [from, to, replacement] of edits.reverse()) {
      next = next.slice(0, from) + replacement + next.slice(to);
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

interface SweptFile {
  readonly path: string;
  readonly text: string;
}

/**
 * Local name → canonical name, for every RENAME BINDING of a watched function.
 *
 * `import { writeFileSync as wfs } from "node:fs"` was a hole the invariant
 * review of PR #84 found: the sweep watched the canonical names and `wfs(…)` is
 * neither. Both rename spellings are read — `A as B` (import) and `A: B`
 * (destructuring) — and the module specifier is deliberately NOT checked, which
 * makes this an over-approximation: `{ writeFileSync: myWriter }` in a plain
 * object literal adds `myWriter` to the watched set too. Over-approximating adds
 * names to watch and can only cost a loud false positive; under-approximating
 * loses the rule, which is the mistake being repaired here.
 */
function renameBindings(text: string, masked: string): Map<string, string> {
  const map = new Map<string, string>();
  const watched = [...Object.keys(DESTINATION_ARGUMENT), ...SPAWNS].join("|");
  for (const pattern of [
    new RegExp(`\\b(${watched})\\s+as\\s+([A-Za-z_$][\\w$]*)`, "g"),
    new RegExp(`\\b(${watched})\\s*:\\s*([A-Za-z_$][\\w$]*)\\s*[,}]`, "g"),
  ]) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(masked)) !== null) map.set(m[2]!, m[1]!);
  }
  return map;
}

/**
 * Locals that ARE a spawn: `const execFileAsync = promisify(execFile)`.
 *
 * Three suites reach `child_process` exactly that way, so a rule keyed only on
 * the imported names would see none of them.
 */
function spawnAliases(aliases: ReadonlyMap<string, string>): Set<string> {
  // ANCHORED, and that is load-bearing: the alias map also holds function BODIES
  // (so a scratch builder resolves), and an unanchored `\bexec\b` matches
  // `pattern.exec(masked)` inside one of them — which would turn every helper
  // that runs a regex into a "process spawn" and re-subject its callers' whole
  // argument list. The initializer must BE a spawn, not merely mention one.
  const spawnLike = new RegExp(`^\\s*(?:promisify\\s*\\(\\s*)?(?:${SPAWNS.join("|")})\\s*\\)?\\s*$`);
  const out = new Set<string>();
  for (const [name, value] of aliases) if (spawnLike.test(value)) out.add(name);
  return out;
}

interface WriteSite {
  readonly file: string;
  readonly fn: string;
  readonly kind: "fs" | "spawn";
  /** The destination argument for an fs call, the whole argument list for a spawn. */
  readonly destination: string;
  readonly namesSrc: boolean;
  readonly scratchRooted: boolean;
  /** Set for a spawn whose command is a named read-only tool. */
  readonly readOnlyTool: string | null;
}

/** Every mutating call site in `files` — both families — with its subject resolved. */
function writeSites(files: readonly SweptFile[]): WriteSite[] {
  const shared = exportedAliases(files);
  const sites: WriteSite[] = [];
  for (const file of files) {
    const masked = maskLiterals(file.text);
    const aliases = new Map(shared);
    for (const [key, value] of aliasMap(file.text, masked)) aliases.set(key, value);
    const renames = renameBindings(file.text, masked);
    const spawnLocals = new Set<string>([...SPAWNS, ...spawnAliases(aliases)]);
    for (const [local, canonical] of renames) {
      if ((SPAWNS as readonly string[]).includes(canonical)) spawnLocals.add(local);
    }
    const names = [
      ...new Set([...Object.keys(DESTINATION_ARGUMENT), ...spawnLocals, ...renames.keys()]),
    ].sort((a, b) => b.length - a.length);
    const call = new RegExp(`\\b(${names.join("|")})\\s*\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = call.exec(masked)) !== null) {
      const local = m[1]!;
      // `/re/.exec(s)` is RegExp.prototype.exec, not a process spawn.
      if (local === "exec" && masked[m.index - 1] === ".") continue;
      const canonical = renames.get(local) ?? local;
      const open = m.index + m[0].length - 1;
      const ranges = argumentRanges(masked, open);
      if (ranges === null) continue;
      const isSpawn = spawnLocals.has(local) || spawnLocals.has(canonical);
      const raw = isSpawn
        ? ranges.map(([from, to]) => file.text.slice(from, to)).join(" , ")
        : (() => {
            const range = ranges[DESTINATION_ARGUMENT[canonical]! - 1];
            return range === undefined ? null : file.text.slice(range[0], range[1]);
          })();
      if (raw === null) continue;
      const destination = expand(raw.trim(), aliases);
      sites.push({
        file: file.path,
        fn: local,
        kind: isSpawn ? "spawn" : "fs",
        destination,
        namesSrc: NAMES_SRC.test(destination),
        scratchRooted: SCRATCH_ROOTED.test(destination),
        readOnlyTool: isSpawn ? (READ_ONLY_SPAWNS.find((t) => t.test(destination))?.tool ?? null) : null,
      });
    }
  }
  return sites;
}

/** The rule: a write that names `src` must be a scratch write or a read-only tool. */
function checkNoTestWritesIntoSrc(files: readonly SweptFile[]): string[] {
  return writeSites(files)
    .filter((site) => site.namesSrc && !site.scratchRooted && site.readOnlyTool === null)
    .map((site) =>
      site.kind === "spawn"
        ? `${site.file}: ${site.fn}() spawns a process whose arguments name a \`src\` path, and the ` +
          `command is not a named read-only tool (resolves to ` +
          `\`${site.destination.replace(/\s+/g, " ").slice(0, 160)}\`). Point it at a mkdtemp copy, ` +
          `or add the tool to READ_ONLY_SPAWNS with a reason — E02-D15.`
        : `${site.file}: ${site.fn}() writes into a \`src\` path that is not a mkdtemp scratch ` +
          `(destination resolves to \`${site.destination.replace(/\s+/g, " ").slice(0, 160)}\`). ` +
          `Copy src/ into os.tmpdir() and write the fixture there — E02-D15.`
    );
}

/**
 * The files swept: tracked `.ts` under `tests/`, FROM GIT'S INDEX.
 *
 * `git ls-files` for the same reason `outbox-declarations.test.ts` uses it — a
 * live `readdirSync` is exactly the enumeration this bead exists to make safe,
 * and a guard that reproduced the bug it guards would be a joke. It is not a
 * narrower sweep: a new test file is in the index the moment it is staged, which
 * is when husky's pre-commit lane and CI both see it.
 */
const swept: SweptFile[] = execFileSync("git", ["ls-files", "-z", "--", "tests"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter((path) => path.endsWith(".ts"))
  .sort()
  .map((path) => ({ path, text: readFileSync(join(repoRoot, path), "utf8") }));

describe("no test writes into the repository's src/ (E02-D15)", () => {
  it("sweeps the whole tracked test tree, so the green below is not a small green", () => {
    expect(swept.length).toBeGreaterThan(80);
    expect(swept.map((f) => f.path)).toContain("tests/contract/architecture-gate.test.ts");
  });

  it("finds no test that creates or deletes a file under src/", () => {
    expect(checkNoTestWritesIntoSrc(swept)).toEqual([]);
  });

  // THE VACUITY GUARD. `[]` is what a broken scanner returns too. These two
  // assertions say the sweep is looking at real call sites and really does
  // resolve a `src` destination when one is there — without them, the assertion
  // above would survive a regex that matched nothing.
  it("sees the real mutating call sites in the tree", () => {
    const sites = writeSites(swept);
    expect(sites.length).toBeGreaterThan(40);
    expect(new Set(sites.map((s) => s.fn))).toContain("writeFileSync");
    expect(new Set(sites.map((s) => s.fn))).toContain("rmSync");
  });

  it("resolves the architecture gate's scratch fixtures as scratch-rooted src writes", () => {
    // The one file in the tree that legitimately names a `src` path in both
    // families. If either count drops to zero, either the fixtures stopped being
    // written or the resolver stopped seeing them — and in the second case the
    // rule above went blind, which is the only way it can lie.
    const gate = writeSites(swept).filter(
      (s) => s.file === "tests/contract/architecture-gate.test.ts" && s.namesSrc
    );
    const written = gate.filter((s) => s.kind === "fs");
    const spawned = gate.filter((s) => s.kind === "spawn");
    expect(written.length).toBeGreaterThanOrEqual(3);
    for (const site of written) expect(site.scratchRooted).toBe(true);
    // The two depcruise runs name `src` as the directory to cruise. They are
    // cleared by the TOOL, not by a scratch root — the real-tree run has no
    // scratch at all — which is the case READ_ONLY_SPAWNS exists for.
    expect(spawned.length).toBeGreaterThanOrEqual(2);
    for (const site of spawned) expect(site.readOnlyTool).toContain("depcruise");
  });

  it("sees both families in the tree, so neither half of the rule is vacuous", () => {
    const sites = writeSites(swept);
    expect(sites.filter((s) => s.kind === "fs").length).toBeGreaterThan(40);
    expect(sites.filter((s) => s.kind === "spawn").length).toBeGreaterThanOrEqual(5);
    // …and the read-only escape is exercised by real call sites rather than only
    // by fixtures: `git ls-files -- src/routes` in outbox-declarations.test.ts.
    expect(sites.some((s) => s.kind === "spawn" && s.namesSrc && s.readOnlyTool === "git ls-files")).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------------------
// The negative fixtures. Same standing reason as every rule in
// `architecture-gate.test.ts`: a rule that has never failed is indistinguishable
// from a rule that cannot.
//
// Each fixture is a string literal, and `maskLiterals` blanks string content
// before looking for calls — so quoting a violation here does not make this file
// violate the rule it states. That is a property, not a convenience: it is why
// the sweep above can include this file rather than exempt it.
// ---------------------------------------------------------------------------
describe("the rule itself, against fixtures that violate it", () => {
  const file = (text: string): SweptFile[] => [{ path: "tests/fixture.test.ts", text }];

  it("FAILS on the exact shape E02-D15 removed — a const alias, then a write", () => {
    const findings = checkNoTestWritesIntoSrc(
      file(
        [
          'const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");',
          'const fixture = join(repoRoot, "src/routes/__arch_fixture_violation__.ts");',
          'writeFileSync(fixture, "import pg from \\"pg\\";");',
        ].join("\n")
      )
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("writeFileSync()");
    expect(findings[0]).toContain("src/routes/__arch_fixture_violation__.ts");
  });

  it("FAILS on a direct literal, with no alias to expand", () => {
    const findings = checkNoTestWritesIntoSrc(
      file('mkdirSync(join(repoRoot, "src", "modules", "__arch_fixture__"), { recursive: true });')
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("mkdirSync()");
  });

  it("FAILS on a DELETE as loudly as on a write — the hazard is the window, not the byte", () => {
    const findings = checkNoTestWritesIntoSrc(
      file('rmSync(join(repoRoot, "src/modules"), { recursive: true, force: true });')
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("rmSync()");
  });

  it("FAILS on a two-path call whose DESTINATION is the real tree", () => {
    const findings = checkNoTestWritesIntoSrc(
      file('cpSync(join(scratch, "src"), join(repoRoot, "src"), { recursive: true });')
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("cpSync()");
  });

  it("PASSES the same call in the direction E02-D15 actually uses", () => {
    // Argument 1 is the repository's `src/`; argument 2 is the scratch copy. A
    // rule that read "any argument" would forbid the fix it exists to protect.
    expect(
      checkNoTestWritesIntoSrc(
        file(
          [
            'const scratch = mkdtempSync(join(tmpdir(), "longbox-arch-gate-"));',
            'cpSync(join(repoRoot, "src"), join(scratch, "src"), { recursive: true });',
            'writeFileSync(join(scratch, "src", "routes", "x.ts"), "boom");',
            "rmSync(scratch, { recursive: true, force: true });",
          ].join("\n")
        )
      )
    ).toEqual([]);
  });

  it("PASSES a write that has nothing to do with src", () => {
    expect(
      checkNoTestWritesIntoSrc(
        file("mkdirSync(UPLOADS_DIR, { recursive: true });\nrmSync(UPLOADS_DIR, { force: true });")
      )
    ).toEqual([]);
  });

  it("PASSES a READ of the real tree — reading is not the hazard", () => {
    expect(checkNoTestWritesIntoSrc(file('const files = collectSources(join(repoRoot, "src"));'))).toEqual(
      []
    );
  });

  it("does NOT fire on a violation quoted in a comment or a string", () => {
    // This is the property that lets the sweep include this very file.
    expect(
      checkNoTestWritesIntoSrc(
        file(
          [
            '// it used to call writeFileSync(join(repoRoot, "src/routes/x.ts"), "…")',
            "const doc = 'rmSync(join(repoRoot, \"src/modules\"))';",
          ].join("\n")
        )
      )
    ).toEqual([]);
  });

  it("expands an alias built from another alias", () => {
    const findings = checkNoTestWritesIntoSrc(
      file(
        [
          'const routes = join(repoRoot, "src", "routes");',
          'const target = join(routes, "phantom.ts");',
          'writeFileSync(target, "x");',
        ].join("\n")
      )
    );
    expect(findings).toHaveLength(1);
  });

  it("inlines a same-file helper, so a scratch BUILDER is not misread as the real tree", () => {
    // The false positive that would have made E02-D15's own fix unlandable: the
    // scratch directory is built by a helper, and a resolver that stopped at the
    // call would report the honest fix as a violation.
    expect(
      checkNoTestWritesIntoSrc(
        file(
          [
            "function makeScratchTree(): string {",
            '  const dir = mkdtempSync(join(tmpdir(), "longbox-"));',
            '  cpSync(join(repoRoot, "src"), join(dir, "src"), { recursive: true });',
            "  return dir;",
            "}",
            "const scratch = makeScratchTree();",
            'writeFileSync(join(scratch, "src", "routes", "x.ts"), "boom");',
          ].join("\n")
        )
      )
    ).toEqual([]);
  });

  it("…and a helper that hands back the REAL tree still fails", () => {
    // The same inlining, with the opposite answer. A rule that said "there is a
    // helper, therefore it is fine" would be an exemption wearing a resolver's
    // clothes. The return type is generic on purpose: the body brace has to be
    // found past `Promise<{ … }>`, not inside it.
    const findings = checkNoTestWritesIntoSrc(
      file(
        [
          "function target(): { path: string } {",
          '  return { path: join(repoRoot, "src", "routes") };',
          "}",
          'writeFileSync(join(target().path, "phantom.ts"), "boom");',
        ].join("\n")
      )
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("writeFileSync()");
  });

  it("follows an EXPORTED alias across files, so a helper cannot launder the path", () => {
    const findings = checkNoTestWritesIntoSrc([
      { path: "tests/helpers.ts", text: 'export const PHANTOM = join(repoRoot, "src/routes/p.ts");' },
      { path: "tests/uses.test.ts", text: 'writeFileSync(PHANTOM, "x");' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("tests/uses.test.ts");
  });

  // -------------------------------------------------------------------------
  // The three misses the invariant review of PR #84 found. Each was a way to
  // write into `src/` that the first version of this rule could not see, and
  // each is now detected rather than documented — because a limit you can close
  // in twenty lines is not a limit, it is an unfinished rule.
  // -------------------------------------------------------------------------

  it("FAILS on a SHELL command that writes into src, which touches no fs function", () => {
    const findings = checkNoTestWritesIntoSrc(file('execSync("touch src/routes/__phantom__.ts");'));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("spawns a process");
  });

  it("FAILS on the same thing through spawnSync's argument array", () => {
    const findings = checkNoTestWritesIntoSrc(
      file('spawnSync("rm", ["-f", join(repoRoot, "src/routes/x.ts")]);')
    );
    expect(findings).toHaveLength(1);
  });

  it("FAILS through a promisified spawn alias, which is how this tree reaches child_process", () => {
    const findings = checkNoTestWritesIntoSrc(
      file(
        [
          "const execFileAsync = promisify(execFile);",
          'await execFileAsync("sed", ["-i", "s/a/b/", "src/routes/scanSessions.ts"]);',
        ].join("\n")
      )
    );
    expect(findings).toHaveLength(1);
  });

  it("PASSES a read-only tool that names a src path, and names WHICH tool", () => {
    // `git ls-files -- src/routes` and `depcruise src` are reads. The escape is a
    // list of TOOLS, so clearing one is a visible act naming a command.
    expect(
      checkNoTestWritesIntoSrc(
        file(
          [
            'const routeFiles = execFileSync("git", ["ls-files", "-z", "--", "src/routes"]);',
            'await execFileAsync("pnpm", ["exec", "depcruise", "src", "--config", CONFIG]);',
          ].join("\n")
        )
      )
    ).toEqual([]);
  });

  it("FAILS on an UNKNOWN command naming a src path — the escape is a list, not a class", () => {
    const findings = checkNoTestWritesIntoSrc(
      file('execFileSync("some-codemod", ["--write", "src/services/pricing.ts"]);')
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("add the tool to READ_ONLY_SPAWNS");
  });

  it("does NOT treat `/re/.exec(s)` as a process spawn", () => {
    // The one name in the spawn set that collides with a method. A rule that read
    // every `.exec(` as a spawn would re-subject half the repository's regex code.
    expect(
      checkNoTestWritesIntoSrc(
        file(
          [
            'const line = readFileSync(join(repoRoot, "src/routes/x.ts"), "utf8");',
            "const m = /(\\d+)/.exec(line);",
          ].join("\n")
        )
      )
    ).toEqual([]);
  });

  it("FAILS on createWriteStream, because a descriptor writes as well as writeFileSync", () => {
    const findings = checkNoTestWritesIntoSrc(
      file('const out = createWriteStream(join(repoRoot, "src/routes/__phantom__.ts"));')
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("createWriteStream()");
  });

  it("FAILS on an ALIASED fs import, which the canonical-name sweep could not see", () => {
    const findings = checkNoTestWritesIntoSrc(
      file(
        [
          'import { writeFileSync as wfs } from "node:fs";',
          'wfs(join(repoRoot, "src/routes/__phantom__.ts"), "boom");',
        ].join("\n")
      )
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("wfs()");
  });

  it("FAILS on a destructuring rename too, and keeps the destination INDEX of the original", () => {
    // `cp` puts its destination second; the alias must inherit that, or the rule
    // would read the SOURCE and clear a write into the real tree.
    const findings = checkNoTestWritesIntoSrc(
      file(
        [
          "const { cpSync: copyTree } = fs;",
          'copyTree(mkdtempSync(join(tmpdir(), "x-")), join(repoRoot, "src"), { recursive: true });',
        ].join("\n")
      )
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("copyTree()");
  });

  it("does not mistake `srcish` names for the directory", () => {
    expect(checkNoTestWritesIntoSrc(file('writeFileSync(join(dir, "srcmap.json"), "{}");'))).toEqual([]);
  });

  it("does not mistake a HYPHENATED name for the directory either", () => {
    // The advisory review of PR #84 found this: a boundary class of "any
    // non-identifier character" includes `-`, so `user-src-token.json` read as a
    // write into the source tree. A guard that cries wolf on an unrelated file is
    // a guard people learn to route around.
    expect(
      checkNoTestWritesIntoSrc(
        file(
          [
            'writeFileSync(join(dir, "user-src-token.json"), "{}");',
            'mkdirSync(join(dir, "pre-src-cache"), { recursive: true });',
          ].join("\n")
        )
      )
    ).toEqual([]);
  });

  it("…and still sees the real segment in every spelling it appears in", () => {
    // The tightening must not cost the rule its subject. Four spellings, one
    // finding each: a bare segment, a joined path, an embedded segment, and a
    // concatenated absolute path.
    for (const call of [
      'writeFileSync(join(repoRoot, "src", "x.ts"), "b");',
      'writeFileSync(join(repoRoot, "src/routes/x.ts"), "b");',
      'writeFileSync(join(repoRoot, "packages/app/src/x.ts"), "b");',
      'writeFileSync(repoRoot + "/src/x.ts", "b");',
    ]) {
      expect(checkNoTestWritesIntoSrc(file(call)), call).toHaveLength(1);
    }
  });
});
