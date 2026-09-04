// `pnpm arch` — the non-graph half of the architecture gate, as a CLI.
//
// `pnpm depcruise` checks the import graph; this checks what files SAY (029 §5
// move 8's defect N2, 042 I5 and I22, 040 §8.2 step 1). CI runs both in the
// `Architecture gate` job; the rules themselves live in `architectureRules.ts` as
// pure functions so every one of them has a negative fixture in
// `tests/contract/architecture-gate.test.ts`.
import { join } from "node:path";
import { collectSources, REPO_ROOT, runArchitectureRules } from "./architectureRules.js";

const files = collectSources(join(REPO_ROOT, "src"));
const findings = runArchitectureRules(files);

if (findings.length === 0) {
  console.log(`architecture gate: ok (${files.length} files, 5 rules)`);
  process.exit(0);
}
console.error(`architecture gate: ${findings.length} violation(s)\n`);
for (const f of findings) console.error(`  [${f.rule}] ${f.message}\n`);
process.exit(1);
