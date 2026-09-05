// Redeem one recovery code in place of a lost second factor.
//
//   pnpm redeem-recovery-code --user <app-user-uuid>
//
// ⚠ THE FIRST FACTOR IS NOT CHECKED HERE, AND THAT IS WHY THIS IS AN OPERATOR
// TOOL RATHER THAN A ROUTE (048 §8.1, R20).
//
// *"A recovery code is never accepted without the password, is never accepted on
// its own, and is never accepted in place of the password."* This script cannot
// enforce the first half, because `user_credential` does not exist in this tree —
// so what stands in for the password is that running it requires the schema
// owner's database URL and shell access to the host. That is a stronger check than
// a password and a worse user experience, which is the correct trade for a flow
// that runs when somebody's phone is at the bottom of a lake, and it is the reason
// there is no route: a route would be the single-factor bearer credential R20
// exists to forbid.
//
// **Using a code retires the authenticator it substituted for**, in the same
// transaction as the use. After this runs, `mfaState` reads `must_reenroll` and the
// only way out is `pnpm enroll-authenticator`, which also supersedes every
// remaining code in the set — because codes that survive a re-enrollment are codes
// that survive whatever caused it.
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveMigrateUrl } from "./migrateUrl.js";
import { withTransaction } from "../src/db.js";
import {
  RecoveryCodeAlreadyUsed,
  liveRecoveryCodeCount,
  redeemRecoveryCode,
  requirePinPepper,
} from "../src/services/auth/index.js";

const { values } = parseArgs({ options: { user: { type: "string" } } });

async function main(): Promise<void> {
  const user = values.user;
  if (!user) throw new Error("usage: pnpm redeem-recovery-code --user <app-user-uuid>");
  const pepper = requirePinPepper();

  const pool = new pg.Pool({ connectionString: resolveMigrateUrl() });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const code = await rl.question("Recovery code: ");

    // THE TRANSACTION COMMITS WHATEVER THE VERDICT (048 §9.1, R5): the
    // `auth_attempt` row a failure appends is what the growing delay is derived
    // from, and rolling it back would hand an unlimited budget to whoever is
    // guessing. The refusal is raised out here, after the commit.
    const verdict = await withTransaction(pool, (tx) =>
      redeemRecoveryCode(tx, { appUserId: user, code, pepper, now: new Date() })
    ).catch((err: unknown) => {
      // The loser of a concurrent redemption: `UNIQUE (code_id)` refused the use row
      // and the transaction rolled back with it, so nothing was retired.
      if (err instanceof RecoveryCodeAlreadyUsed) return { ok: false as const, reason: "wrong_code" };
      throw err;
    });

    if (!verdict.ok) {
      // ONE answer for every refusal (048 §9.3). An unknown person, a wrong code, a
      // spent code, a person with no second factor and a person inside their delay
      // all say the same thing, because a helpful error at an authentication
      // boundary is a query interface over who holds what.
      throw new Error(
        "that recovery code was not accepted. If several attempts have just failed, the delay " +
          "grows and never closes — wait and try again (048 §9.1)."
      );
    }

    const left = await liveRecoveryCodeCount(pool, user);
    console.log("");
    console.log("Accepted. The lost authenticator is retired and a new one is REQUIRED:");
    console.log("");
    console.log(`  pnpm enroll-authenticator --user ${user}`);
    console.log("");
    console.log(`Codes left in the current set: ${String(left)}. Enrolling issues a fresh set and`);
    console.log("supersedes every one of them (048 §8.1).");
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
