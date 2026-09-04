// L3 unit: a conflict marker never reaches a commit.
//
// The rule exists because it already failed once. A three-way rebase of the
// E03-D09 branch left all four `diff3` markers inside `000-docs/000-INDEX.md`,
// the commit was made, and nothing noticed: prettier reformats markdown without
// parsing it, eslint does not read `.md`, the typecheck does not read `.md`, and
// every test asserts about content nobody had touched. **The file that carried it
// is the document index** — the one artifact whose whole job is to be read by a
// person looking for something else.
//
// The check is wired at `lint-staged`, which runs on every commit, and the
// function is pure so this file can prove it refuses rather than trusting that
// it does.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONFLICT_SCAN_EXTENSIONS,
  findConflictMarkers,
  refusalMessage,
  shouldScan,
} from "../scripts/conflictMarkers.js";

const FIXTURE = "tests/fixtures/conflict/unresolved.md.fixture";

describe("the conflict-marker check (E03-D09 re-verification)", () => {
  const fixture = readFileSync(FIXTURE, "utf8");

  it("REFUSES the shape that actually reached a commit — all four diff3 markers", () => {
    const findings = findConflictMarkers(FIXTURE, fixture);
    // `diff3` writes four, and `|||||||` is the one a two-marker regex misses.
    expect(findings.map((f) => f.text.slice(0, 7)).sort()).toEqual([
      "<<<<<<<",
      "=======",
      ">>>>>>>",
      "|||||||",
    ]);
    for (const finding of findings) expect(finding.line).toBeGreaterThan(0);
  });

  it("names the file and the line, because a refusal that does not is a puzzle", () => {
    const message = refusalMessage(findConflictMarkers(FIXTURE, fixture));
    expect(message).toContain("4 conflict marker(s)");
    expect(message).toContain(`${FIXTURE}:`);
    expect(message).toContain("<<<<<<< HEAD");
  });

  it("flags NONE of the shapes that merely look like markers", () => {
    // A check whose false positives are routine is a check people learn to
    // bypass — and `=======` under a heading, `---`, and a nested blockquote are
    // all ordinary markdown.
    const innocent = ["=====", "---", "> quote", ">>> nested", "======= trailing text is a MARKER"];
    const flagged = innocent.filter((line) => findConflictMarkers("x.md", line).length > 0);
    expect(flagged).toEqual(["======= trailing text is a MARKER"]);
  });

  it("matches only at the START of a line, so prose about markers is safe", () => {
    // This very file, and `scripts/conflictMarkers.ts`, both discuss the markers
    // in prose. Neither may trip the check that reads them.
    expect(findConflictMarkers("x.md", "the rebase left <<<<<<< HEAD in the file")).toEqual([]);
    expect(
      findConflictMarkers("scripts/conflictMarkers.ts", readFileSync("scripts/conflictMarkers.ts", "utf8"))
    ).toEqual([]);
    expect(
      findConflictMarkers(
        "tests/conflict-markers.test.ts",
        readFileSync("tests/conflict-markers.test.ts", "utf8")
      )
    ).toEqual([]);
  });

  it("scans the five extensions a merge can break and nothing else reads", () => {
    expect([...CONFLICT_SCAN_EXTENSIONS].sort()).toEqual([".js", ".json", ".md", ".sql", ".ts"]);
    for (const file of ["000-docs/x.md", "src/x.ts", "migrations/001_x.sql", "a.json", "public/app.js"]) {
      expect(shouldScan(file), file).toBe(true);
    }
    // A `.fixture` is deliberately outside the set: it is how this suite keeps a
    // file full of markers in the tree without the check refusing its own fixture.
    for (const file of ["tests/fixtures/conflict/unresolved.md.fixture", "a.yml", "a.png"]) {
      expect(shouldScan(file), file).toBe(false);
    }
  });

  it("passes the tree it ships with", () => {
    // The regression, asserted where it happened: the document index is clean.
    for (const file of ["000-docs/000-INDEX.md", "000-docs/006-OD-STAT-status.md", "tests/RTM.md"]) {
      expect(findConflictMarkers(file, readFileSync(file, "utf8")), file).toEqual([]);
    }
  });
});
