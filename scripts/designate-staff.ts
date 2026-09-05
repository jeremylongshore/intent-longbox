// `pnpm designate-staff` — record that a person is LONGBOX-ORIGIN (E03-D14).
//
//   pnpm designate-staff --user <app-user-uuid> --by <app-user-uuid> \
//     --reason "joined support, ticket queue" [--effective-from 2026-09-01T00:00:00Z]
//
// **`--by` IS REQUIRED, and it was optional until the cannon** (058 §5, the
// security lens's F3). This is the most privileged act in the system — it decides
// who 019 T35(c) watches — and it was recording LESS about its actor than an
// invitation does. `designated_by` is the only accountability record either CLI
// produces, and 058 R1 says plainly that nothing verifies it: a schema owner can
// name anybody. Requiring the flag does not make it true; it makes an omission a
// deliberate act rather than a default.
//
// **What it decides.** Every session this person opens, at any shop, from
// `--effective-from` onward, must reconcile to a live `support_break_glass`
// grant at that shop or it is a finding in `pnpm audit:break-glass` — 019
// T35(c), non-waivable, where an unmatched session is K1 (019 §3.4). It grants
// NOTHING: origin is not a role, carries no permission, and is not consulted by
// the authentication hook. It only decides who is WATCHED.
//
// **`--effective-from` may be in the past and may not be in the future** (058
// §3(b)). Back-dating a start widens the audited population, which is the
// direction that costs an operator nothing and buys an investigator the sessions
// opened before anybody remembered to run this. There is no equivalent on the
// retirement, deliberately.
//
// It prints no secret: a designation has none. It echoes the person's id back
// because the operator typed it.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveMigrateUrl } from "./migrateUrl.js";
import { designateStaff } from "./staffDesignation.js";

const { values } = parseArgs({
  options: {
    user: { type: "string" },
    reason: { type: "string" },
    by: { type: "string" },
    "effective-from": { type: "string" },
  },
});

async function main(): Promise<void> {
  const user = values.user;
  const reason = values.reason;
  const by = values.by;
  if (!user || !reason || !by) {
    throw new Error(
      'usage: pnpm designate-staff --user <app-user-uuid> --by <app-user-uuid> --reason "<why>" ' +
        "[--effective-from <iso-8601>]\n" +
        "--by names the person taking this decision and is REQUIRED (058 §5, F3): it is the only " +
        "accountability record this act produces, and 058 R1 states that nothing verifies it."
    );
  }
  const raw = values["effective-from"];
  let effectiveFrom: Date | null = null;
  if (raw !== undefined) {
    effectiveFrom = new Date(raw);
    if (Number.isNaN(effectiveFrom.getTime())) {
      throw new Error(`--effective-from is not a date this runtime can read: ${raw}`);
    }
  }

  const client = new pg.Client({ connectionString: resolveMigrateUrl() });
  await client.connect();
  try {
    const held = await designateStaff(client, {
      appUserId: user,
      reason,
      designatedBy: by,
      effectiveFrom,
    });
    console.log("");
    console.log(`Longbox-origin designations now held by ${user}:`);
    for (const d of held) {
      const ending = d.retiredAt === null ? "live" : `retired ${d.retiredAt.toISOString()}`;
      console.log(`  ${d.id}  from ${d.effectiveFrom.toISOString()}  ${ending}  — ${d.reason}`);
    }
    console.log("");
    console.log(
      "This grants nothing. It decides that every session this person opens must reconcile to a " +
        "live break-glass grant at that shop (019 T35(c)); run `pnpm audit:break-glass` to see."
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
