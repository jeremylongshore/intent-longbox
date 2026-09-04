// A conflict marker must never reach a commit.
//
// WHY THIS EXISTS, AND IT IS NOT HYPOTHETICAL (E03-D09 re-verification). A three-
// way rebase of this branch left `<<<<<<< HEAD`, `|||||||`, `=======` and
// `>>>>>>>` inside `000-docs/000-INDEX.md`, the commit was made, and **nothing in
// the repository noticed**: prettier reformats markdown without parsing it,
// eslint does not read `.md`, the typecheck does not read `.md`, and the tests
// assert about content nobody had changed. The file that carried it is the
// document index — the one artifact whose whole job is to be read by a person
// looking for something else.
//
// The class is broader than markdown. A marker in a `.sql` migration would fail
// at apply time with a syntax error nobody can read; in a `.json` it would break
// the parse; in a `.ts` the typecheck would catch it — but only for the files the
// typecheck reads, and `tests/fixtures/**` is full of files it does not.
//
// **WHY NOT THE HARNESS'S ESCAPE-SCAN.** `@intentsolutions/audit-harness` owns
// that step and its policy files are hash-pinned (`.harness-hash`,
// `tests/TESTING.md` L0/L1): adding a repo-specific pattern there would mean
// editing a protected file and re-pinning a manifest whose whole purpose is that
// this repository does not edit it. So the check is the repo's own, wired at the
// cheapest layer that runs on every commit — lint-staged — and the FUNCTION is
// pure so a unit test can prove it refuses.
import { readFileSync } from "node:fs";

/**
 * The four markers `git` writes, anchored to the start of a line.
 *
 * `diff3` conflict style — which this repository's rebases produce — emits all
 * four, and `|||||||` is the one a two-marker regex misses. The trailing
 * `( |$)` is what keeps a markdown horizontal rule (`=======`), a Python heading
 * underline and a `>>>` prompt out of the match: a real marker is either exactly
 * seven characters on its own line or seven followed by a space and a label.
 */
const MARKER = /^(<{7}|={7}|>{7}|\|{7})( |$)/;

/** Extensions worth scanning: everything a merge can break that nothing else reads. */
export const CONFLICT_SCAN_EXTENSIONS = [".md", ".ts", ".sql", ".json", ".js"] as const;

export interface ConflictFinding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** Every conflict marker in `text`, with its 1-based line number. */
export function findConflictMarkers(file: string, text: string): ConflictFinding[] {
  const findings: ConflictFinding[] = [];
  text.split("\n").forEach((line, i) => {
    if (MARKER.test(line)) findings.push({ file, line: i + 1, text: line.slice(0, 80) });
  });
  return findings;
}

export function shouldScan(file: string): boolean {
  return CONFLICT_SCAN_EXTENSIONS.some((ext) => file.endsWith(ext));
}

/** The message a refusal prints. Written once so the test can assert it. */
export function refusalMessage(findings: readonly ConflictFinding[]): string {
  const lines = findings.map((f) => `  ${f.file}:${String(f.line)}  ${f.text}`);
  return (
    `refusing to commit: ${String(findings.length)} conflict marker(s) survived a merge or rebase.\n` +
    `${lines.join("\n")}\n` +
    `Resolve the conflict and stage the result. A marker in a committed file is a merge nobody ` +
    `finished — in a .sql it breaks the migration at apply time, in a .json the parse, and in a .md ` +
    `nothing at all until a person reads it.`
  );
}

/** CLI: every path given, refusing on the first file that carries one. */
function main(paths: readonly string[]): void {
  const findings = paths
    .filter(shouldScan)
    .flatMap((file) => findConflictMarkers(file, readFileSync(file, "utf8")));
  if (findings.length > 0) {
    console.error(refusalMessage(findings));
    process.exit(1);
  }
}

// `process.argv[1]` is this file when run as a CLI and something else when a test
// imports it — the same guard `scripts/architectureGate.ts` uses.
if (process.argv[1]?.endsWith("conflictMarkers.ts")) main(process.argv.slice(2));
