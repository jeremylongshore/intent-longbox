// `pnpm arch` — the non-graph half of the architecture gate, as a CLI.
//
// `pnpm depcruise` checks the import graph; this checks what files SAY (029 §5
// move 8's defect N2, 042 I5 and I22, 040 §8.2 step 1, 047 A8). CI runs both in
// the `Architecture gate` job; the rules themselves live in
// `architectureRules.ts` as pure functions so every one of them has a negative
// fixture in `tests/contract/architecture-gate.test.ts`.
//
// TWO MODES, because rule 7 has two halves and they are asked at different times.
// The tree rules run on every invocation. The PAIRED-EDIT rule (047 A8's second
// half — a PR that edits both `identityKey` and `edition_signature` without a
// 000-docs/006 row fails) is a property of a DIFF, not of a tree, so it runs only
// when a changed-file list is supplied:
//
//     LONGBOX_CHANGED_FILES=<path-to-newline-separated-list> pnpm arch
//     pnpm arch --changed <path>
//
// Absent that list the rule is SKIPPED and the gate says so, rather than passing
// silently — a rule that reports green when it was never asked is the blind-rule
// failure `checkLockOrder`'s history records.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "node:fs";
import {
  checkAuthAttemptReads,
  checkAuthorizationDecisionCountNouns,
  checkIdentityAccessWriters,
  checkBreakGlassScriptsAreUnreachable,
  checkIdentityImportSurface,
  checkIdentityPairEdit,
  checkIdentityPersonJoins,
  checkMigrationNumbers,
  checkNoFreshnessColumn,
  checkOriginDesignationWriters,
  checkServiceScopeSites,
  collectSources,
  REPO_ROOT,
  runArchitectureRules,
} from "./architectureRules.js";

function changedFilesPath(): string | null {
  const flag = process.argv.indexOf("--changed");
  if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1]!;
  return process.env["LONGBOX_CHANGED_FILES"] ?? null;
}

const files = collectSources(join(REPO_ROOT, "src"));
// The scope inventory spans BOTH trees — three of the six scopes are named only by
// CLIs today — and it is called from here rather than from inside the rule set so
// that no rule reads the filesystem itself (the invariant review's NOTE 5).
const scriptFiles = collectSources(join(REPO_ROOT, "scripts"));
const bothTrees = [...files, ...scriptFiles];
// E03-D11's freshness refusal reaches one tree further: a column arrives in a
// MIGRATION before any TypeScript reads it, so the file that would introduce the
// thing the rule refuses is the one the rule has to see.
const migrationFiles = collectSources(join(REPO_ROOT, "migrations"), [".sql"]);
// FIVE rules span more than `src/` and are called from here rather than from
// inside the rule set, so that no rule reads the filesystem itself (the
// invariant review's NOTE 5): the scope inventory (three of the six scopes are
// named only by CLIs); since 058 F6, the origin-designation single-writer rule,
// whose only writers today are reached from `scripts/`; since 059 §5, rule 3d —
// a CLI that printed "three acts" from the actor audit would be exactly as wrong
// as a service that returned it; and E03-D11's two — K3's freshness-column
// refusal over all three trees, and K6's number-collision guard, which reads
// FILENAMES rather than contents because the collision it refuses is in the name.
const findings = [
  ...runArchitectureRules(files),
  ...checkServiceScopeSites(bothTrees),
  ...checkOriginDesignationWriters(bothTrees),
  ...checkAuthorizationDecisionCountNouns(bothTrees),
  // E03-D17's three, all over BOTH trees and for 058 F6's reason with more force:
  // one of the five migrated accessor callers IS a CLI (`pnpm enroll-authenticator`),
  // so a rule handed `src/` alone would be blind to the only accessor that reads
  // an email.
  ...checkIdentityPersonJoins(bothTrees),
  ...checkIdentityAccessWriters(bothTrees),
  ...checkIdentityImportSurface(bothTrees),
  // E03-D24 (the consistency lens's H6): "these two CLIs are break-glass" was a
  // comment, and a comment is a sentence a reviewer is trusted to keep noticing.
  // It is now an assertion over the SERVER TREE — a service imported by a route
  // is as reachable as the route.
  ...checkBreakGlassScriptsAreUnreachable(files),
  ...checkAuthAttemptReads(bothTrees),
  ...checkNoFreshnessColumn([...bothTrees, ...migrationFiles]),
  ...checkMigrationNumbers(readdirSync(join(REPO_ROOT, "migrations")).filter((f) => f.endsWith(".sql"))),
];

const changedPath = changedFilesPath();
if (changedPath !== null) {
  const changed = readFileSync(changedPath, "utf8").split("\n");
  findings.push(...checkIdentityPairEdit(changed));
}

if (findings.length === 0) {
  console.log(
    `architecture gate: ok (${files.length} files, 12 tree rules over src/, ` +
      `8 rules over src/ + scripts/ (one of them also over migrations/), ` +
      `1 rule over migrations/ filenames` +
      (changedPath === null
        ? `; paired-edit rule SKIPPED — no changed-file list supplied)`
        : `, plus the paired-edit rule over ${changedPath})`)
  );
  process.exit(0);
}
console.error(`architecture gate: ${findings.length} violation(s)\n`);
for (const f of findings) console.error(`  [${f.rule}] ${f.message}\n`);
process.exit(1);
