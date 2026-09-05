// Redeem one recovery code in place of a lost second factor.
//
//   pnpm redeem-recovery-code --user <app-user-uuid>
//
// ⚠ THE FIRST FACTOR IS NOT CHECKED HERE, AND THAT IS WHY THIS IS AN OPERATOR
// TOOL RATHER THAN A ROUTE (048 §8.1, R20).
//
// *"A recovery code is never accepted without the password, is never accepted on
// its own, and is never accepted in place of the password."* This script does not
// enforce the first half. **The reason it gives used to be that `user_credential`
// did not exist in this tree; E03-D11 built it, and the reason is now a different
// and better one** — a shell tool has no session, no browser and no way to hold a
// password-verification transaction open across the operator's own decision, so
// asking for one here would be a check whose whole strength is that somebody typed
// something into a terminal they were already trusted with. What stands in for the
// password is that running this requires the schema owner's database URL AND shell
// access on the host. That is a stronger access requirement than a password and a
// worse user experience, which is the correct trade for a flow that runs when
// somebody's phone is at the bottom of a lake, and it is the reason there is no
// route: a route would be the single-factor bearer credential R20 exists to forbid.
//
// ⚠ **TWO CONSEQUENCES, BOTH RECORDED WHERE A READER WILL FIND THEM** (000-docs/057
// §4.5, §9 R8/R9, and P9's own row in §7).
//
//   * **048 R20 is TRUE OF THE ROUTE and not of the system.** `POST
//     /api/v1/privileged-sessions` refuses a recovery code without the password and
//     refuses one in place of it, and that is what the invariant asserts. This file
//     is the exception, and anybody quoting R20 — a C-row, a partner sentence, a
//     support answer — carries the scope with it.
//   * **It is the ONE path that holds a single lockout anchor.** `redeemRecoveryCode`
//     takes `user_authenticator` and reads the per-person budget that 048 §4.3 now
//     shares across all three factors, without taking `user_credential` — so it does
//     not serialise against a concurrent password attempt. Accepted, because a
//     network caller cannot reach it at all: the only race available is an operator
//     racing themselves, over a budget that same operator can reset by hand.
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
    const verdict = await withTransaction(
      pool,
      (tx) => redeemRecoveryCode(tx, { appUserId: user, code, pepper, now: new Date() }),
      // A PERSON-SCOPED ACT, DECLARED AS ONE (E03-B04). `user_authenticator`,
      // `recovery_code` and `app_user` carry no `shop_id`, and the `auth_attempt`
      // row a failure appends carries a NULL one — so there is no tenant for this
      // transaction to name. This CLI runs as the schema owner and would bypass
      // the policies anyway; the scope is declared so the transaction SAYS what it
      // is, and so the route E03-D11 turns this into starts with a context that is
      // already right rather than one somebody has to remember to add.
      { tenant: { service: "second-factor" } }
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
