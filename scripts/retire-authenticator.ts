// End somebody's second factor, as a fact.
//
//   pnpm retire-authenticator --user <app-user-uuid> --reason lost_authenticator [--by <uuid>]
//
// The reasons are the migration's CHECK, and they are a closed set because these
// are the endings the design has: `replaced` (an enrollment did it), `lost_
// authenticator`, `offboarding`, `compromise_suspected`, and `recovery_code_used`
// — the last of which is written by the redemption itself and is not offered here,
// because a human asserting it would be recording a use that never happened.
//
// It is an INSERT and never an UPDATE (048 §10.1, and the same three reasons
// `operator_pin_retirement` gives): the sibling endings in this schema all have
// this shape, an UPDATE would write the row the verification sequence anchors on
// from a path that is not a verification, and an UPDATE keeps no record of when or
// why — which is exactly what a support conversation and 019 T35(c) ask for.
//
// **Retiring is not a lockout and does not lock anybody out of anything today**:
// with no privileged session in the tree, what it does is stop `verifyTotp` from
// ever succeeding for that person until a new authenticator is enrolled. That is
// the property the integration suite asserts.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveMigrateUrl } from "./migrateUrl.js";
import { withTransaction } from "../src/db.js";
import { liveAuthenticator, retireAuthenticator } from "../src/services/auth/index.js";
import type { RetirementReason } from "../src/services/auth/index.js";

const REASONS: readonly RetirementReason[] = [
  "lost_authenticator",
  "offboarding",
  "compromise_suspected",
  "replaced",
];

const { values } = parseArgs({
  options: { user: { type: "string" }, reason: { type: "string" }, by: { type: "string" } },
});

async function main(): Promise<void> {
  const user = values.user;
  const reason = values.reason as RetirementReason | undefined;
  if (!user || !reason || !REASONS.includes(reason)) {
    throw new Error(
      `usage: pnpm retire-authenticator --user <app-user-uuid> --reason ${REASONS.join("|")} [--by <uuid>]`
    );
  }

  const pool = new pg.Pool({ connectionString: resolveMigrateUrl() });
  try {
    const written = await withTransaction(
      pool,
      async (tx) => {
        const live = await liveAuthenticator(tx, user);
        if (!live) return 0;
        return retireAuthenticator(tx, {
          authenticatorId: live.id,
          appUserId: user,
          reason,
          retiredBy: values.by ?? null,
        });
      },
      // A PERSON-SCOPED ACT, DECLARED AS ONE (E03-B04). `user_authenticator`,
      // `recovery_code` and `app_user` carry no `shop_id`, and the `auth_attempt`
      // row a failure appends carries a NULL one — so there is no tenant for this
      // transaction to name. This CLI runs as the schema owner and would bypass
      // the policies anyway; the scope is declared so the transaction SAYS what it
      // is, and so the route E03-D11 turns this into starts with a context that is
      // already right rather than one somebody has to remember to add.
      { tenant: { service: "second-factor" } }
    );

    console.log(
      written === 1
        ? `retired: that person's second factor is ended (${reason}). They cannot verify until a ` +
            `new one is enrolled: pnpm enroll-authenticator --user ${user}`
        : "nothing to retire: that person holds no live authenticator. An ending is written once " +
            "(UNIQUE per authenticator), so this is a no-op rather than a second row."
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
