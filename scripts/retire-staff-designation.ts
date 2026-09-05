// `pnpm retire-staff-designation` — end a person's Longbox-origin designation
// as a FACT (E03-D14).
//
//   pnpm retire-staff-designation --user <app-user-uuid> --by <app-user-uuid> \
//     --reason "left the company"
//
// **`--by` IS REQUIRED** (058 §5, F3), for the same reason it is on the
// designation and a sharper one: this is the act that REMOVES somebody from 019
// T35(c)'s population, so an unattributed one is the single most interesting row
// this table can hold. `retired_by` is the only accountability record, and
// nothing verifies it (058 R1).
//
// **There is no timestamp argument, and that is the control** (058 §3(b)). The
// designation ends at the retirement row's own `created_at`. A writer who could
// choose when a designation ended could take a session that has ALREADY happened
// out of 019 T35(c)'s audited population, which is the one motion this design
// refuses to make expressible. Sessions opened before this moment stay in scope
// forever.
//
// The designation is not deleted and cannot be: `app_user_origin` is append-only
// under an `ENABLE ALWAYS` trigger. Re-designating a person who returns writes a
// NEW row rather than un-retiring the old one.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { resolveMigrateUrl } from "./migrateUrl.js";
import { retireStaffDesignation } from "./staffDesignation.js";

const { values } = parseArgs({
  options: {
    user: { type: "string" },
    reason: { type: "string" },
    by: { type: "string" },
  },
});

async function main(): Promise<void> {
  const user = values.user;
  const reason = values.reason;
  const by = values.by;
  if (!user || !reason || !by) {
    throw new Error(
      "usage: pnpm retire-staff-designation --user <app-user-uuid> --by <app-user-uuid> " +
        '--reason "<why>"\n' +
        "--by names the person taking this decision and is REQUIRED (058 §5, F3): removing somebody " +
        "from the audited population is the act most worth attributing."
    );
  }

  const client = new pg.Client({ connectionString: resolveMigrateUrl() });
  await client.connect();
  try {
    const out = await retireStaffDesignation(client, {
      appUserId: user,
      reason,
      retiredBy: by,
    });
    console.log("");
    console.log(`Retired ${String(out.retired)} live designation(s) for ${user}.`);
    for (const d of out.remaining) {
      const ending = d.retiredAt === null ? "live" : `retired ${d.retiredAt.toISOString()}`;
      console.log(`  ${d.id}  from ${d.effectiveFrom.toISOString()}  ${ending}  — ${d.reason}`);
    }
    console.log("");
    console.log(
      "Sessions opened BEFORE now stay in the audited population: a retirement ends the " +
        "designation at its own timestamp and never earlier (058 §3(b))."
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
