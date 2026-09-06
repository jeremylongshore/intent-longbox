// `pnpm audit:identity-access` — 019 T35(b)'s reconciliation, as a CLI (E03-D17).
//
//   pnpm audit:identity-access                 # the last 24 hours (the exit-code question)
//   pnpm audit:identity-access --hours 168     # a week
//   pnpm audit:identity-access --all           # every access ever (the investigation question)
//
// It exits NON-ZERO on any finding, so a scheduler needs no output parsing to
// know something is wrong. What a finding MEANS is stated in
// `scripts/identityAccessAudit.ts`'s header and deliberately NOT called a K1 by
// this file: 019 §3.4's K1 list is closed, T35's own rule is *"any rendering →
// K1"*, and a row from an undeclared accessor is evidence that a
// person-resolution reached an unreviewed surface rather than proof that a
// rendering happened. The exit code is a **T35(b) gate failure** and says so.
//
// **It runs as the SCHEMA OWNER, and that is the only role that can.** The
// application role holds `INSERT` and no `SELECT` on `identity_access`
// (`appGrant: "insert-only"`, 000-docs/060 §3.4) and would in any case see only
// its own tenant under row-level security — which is exactly what would hide the
// rows this is looking for. `assertSchemaOwnerOrThrow` refuses the application
// connection, so a scheduler that reached for `DATABASE_URL` gets a loud refusal
// rather than a green run over nothing.
//
// **It prints COUNTS per purpose and per accessor, and NO PERSON** (022 P3, 019
// T35) — and unlike every other audit in this repository it does not have to
// withhold one, because `identity_access` holds no subject column at all
// (000-docs/060 §5). It also prints no shop id: a shop is a tenant and naming
// one is fine, but nothing in a finding here needs it, and an audit that prints
// what it does not need is an audit that grows a reason to print more.
//
// The daily SCHEDULE and the T34 heartbeat are **E13-B04-D1**'s
// (`longbox-e5b.13.4.1`). This is the query and its exit code; a detector nobody
// runs reports nothing, and 019 T35(b) stays *instrumented* rather than *closed*
// until that bead lands — which is exactly what the 019 amendment row says.
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { DEFAULT_LOOKBACK_HOURS, runIdentityAccessAudit } from "./identityAccessAudit.js";
import { assertSchemaOwnerOrThrow } from "../src/services/roleSeparation.js";
import { resolveMigrateUrl } from "./migrateUrl.js";

const { values } = parseArgs({
  options: {
    hours: { type: "string" },
    all: { type: "boolean", default: false },
  },
});

async function main(): Promise<void> {
  let windowHours: number | null = DEFAULT_LOOKBACK_HOURS;
  if (values.all) windowHours = null;
  else if (values.hours !== undefined) {
    windowHours = Number(values.hours);
    if (!Number.isFinite(windowHours) || windowHours <= 0) {
      throw new Error(`--hours must be a positive number of hours; got ${values.hours}`);
    }
  }

  const client = new pg.Client({ connectionString: resolveMigrateUrl() });
  await client.connect();
  try {
    await assertSchemaOwnerOrThrow(client);
    const result = await runIdentityAccessAudit(client, { windowHours });

    for (const bucket of result.buckets) {
      const mark = bucket.declared ? " " : "!";
      console.log(
        `${mark} ${bucket.method} ${bucket.path} — ${bucket.purpose}: ` +
          `${String(bucket.accesses)} access(es), ${String(bucket.resolved)} person(s) resolved`
      );
    }

    for (const bucket of result.undeclared) {
      console.error(
        `UNDECLARED: ${bucket.method} ${bucket.path} cited '${bucket.purpose}' ` +
          `${String(bucket.accesses)} time(s). Either it is a surface nobody declared, or a ` +
          `declared one citing a purpose it was not declared for (src/identity/purposes.ts).`
      );
    }
    for (const drift of result.purposeDrift) {
      console.error(`PURPOSE DRIFT: ${drift}`);
    }

    console.log(
      `identity-access audit: ${result.windowHours === null ? "all time" : `last ${String(result.windowHours)}h`}, ` +
        `${String(result.buckets.length)} bucket(s), ` +
        `${String(result.undeclared.length)} undeclared, ${String(result.purposeDrift.length)} drift`
    );
    if (result.buckets.length === 0) {
      // Not a failure, and not silence either: a reconciliation over an empty
      // table is green for the wrong reason, which is the stale detector 019 T34
      // exists to catch one threshold over.
      console.log(
        "note: no identity accesses in this window. That is the expected state for a database " +
          "nobody has signed in to; it is NOT evidence that the accessor is wired up."
      );
    }
    if (!result.clean) {
      console.error(
        "019 T35(b) GATE FAILURE (non-waivable). A person-resolution reached a surface nobody " +
          "declared, or the purpose vocabulary has two definitions. Whether any of it is a K1 is " +
          "decided by reading the accessor named above against T35(a); this exit code does not " +
          "decide it, because 019 §3.4's K1 list is closed. The counts above name no person."
      );
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
