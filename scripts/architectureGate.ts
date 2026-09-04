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
import {
  checkIdentityPairEdit,
  collectSources,
  REPO_ROOT,
  runArchitectureRules,
} from "./architectureRules.js";

function changedFilesPath(): string | null {
  const flag = process.argv.indexOf("--changed");
  if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1]!;
  return process.env.LONGBOX_CHANGED_FILES ?? null;
}

const files = collectSources(join(REPO_ROOT, "src"));
const findings = [...runArchitectureRules(files)];

const changedPath = changedFilesPath();
if (changedPath !== null) {
  const changed = readFileSync(changedPath, "utf8").split("\n");
  findings.push(...checkIdentityPairEdit(changed));
}

if (findings.length === 0) {
  console.log(
    `architecture gate: ok (${files.length} files, 8 tree rules` +
      (changedPath === null
        ? `; paired-edit rule SKIPPED — no changed-file list supplied)`
        : `, plus the paired-edit rule over ${changedPath})`)
  );
  process.exit(0);
}
console.error(`architecture gate: ${findings.length} violation(s)\n`);
for (const f of findings) console.error(`  [${f.rule}] ${f.message}\n`);
process.exit(1);
