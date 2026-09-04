// Rebuild `lcid_current_survivor` from `lcid_merge` in one pass (047 A2, I18).
//
//   pnpm rebuild-survivor-projection
//
// NOT A REQUEST-PATH OPERATION. The projection is maintained incrementally inside
// each merge's own transaction by `migrations/017`'s trigger; this script exists
// for 041 §6.4's replay drill ("a derivation nobody replays is not a
// derivation"), for the I18 invariant test, and for an operator recovering from a
// restore in which the projection is suspect.
//
// It runs as the APPLICATION role, not the migrate role: `lcid_current_survivor`
// is a declared-exempt table with full DML for the app (E02-D06), and a rebuild
// that needed the schema owner would be a rebuild nobody could run in production
// without handing out the one privileged principal.

import { closePool, getPool, withTransaction } from "../src/db.js";
import { rebuildSurvivorProjection } from "../src/catalog/index.js";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("rebuild-survivor-projection: DATABASE_URL is not set");
    process.exit(1);
  }
  const pool = getPool(url);
  try {
    const result = await withTransaction(pool, (tx) => rebuildSurvivorProjection(tx), {
      label: "rebuild-survivor-projection",
    });
    console.log(`rebuilt lcid_current_survivor: ${result.rows} row(s) from ${result.merges} merge fact(s)`);
    if (result.anomalies.length > 0) {
      // A non-zero exit, because this script's caller is an operator recovering a
      // suspect database and a silent success would be the wrong answer to the
      // question they are actually asking.
      console.error(
        `refused to place ${result.anomalies.length} lcid(s): their merge chain is cyclic or deeper ` +
          `than the bound. See the warning above for the ids; migrations/015's lcid_merge_no_cycle ` +
          `trigger should have made this impossible, so investigate how those rows were written.`
      );
      process.exitCode = 1;
    }
  } finally {
    await closePool();
  }
}

await main();
