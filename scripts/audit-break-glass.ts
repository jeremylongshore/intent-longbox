// `pnpm audit:break-glass` — 019 T35(c)'s reconciliation, as a CLI (E03-D14).
//
//   pnpm audit:break-glass                 # the last 24 hours (the exit-code question)
//   pnpm audit:break-glass --hours 168     # a week
//   pnpm audit:break-glass --all           # every session ever (the investigation question)
//
// It exits NON-ZERO on any finding, so a scheduler needs no output parsing to
// know something is wrong; 019 §3.4 says what a finding MEANS — an unmatched
// session is **K1**, and 034 §3.4 states the consequence: *"pause live batches
// until the P0 bead closes with an invariant-review PASS."*
//
// **It runs as the SCHEMA OWNER, and that is the only role that can.** The
// application role holds NO privilege on `app_user_origin` (058 §3(c)) and would
// see nothing across shops under row-level security anyway — the tenant context
// is exactly what hides the rows this is looking for.
// `assertSchemaOwnerOrThrow` refuses the application connection, so a scheduler
// that reached for `DATABASE_URL` gets a loud refusal rather than a green run
// over nothing.
//
// **It prints COUNTS per shop and no person** (022 P3, 019 T35). The shop id is
// the one identifier it prints, for the reason `audit-cross-tenant` prints one: a
// tenant is what an operator must know to act. Who the person was is reachable
// only through the identity module's audited accessor (E03-D17).
//
// The daily SCHEDULE and the T34 heartbeat are **E13-B04-D1**'s
// (`longbox-e5b.13.4.1`, whose acceptance carries the daily-schedule clause — NOT
// its parent E13-B04, which is health and readiness). This is the query and its
// exit code; a detector nobody runs reports nothing.
//
// ⚠ It reconciles APPLICATION sessions (`app_session`). Every schema-owner
// DATABASE session — `psql`, `pnpm migrate`, and this command's own siblings —
// is outside it by construction, and closing that half needs connection-level
// auditing rather than this query (000-docs/058 §7, R5).
import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { DEFAULT_LOOKBACK_HOURS, runBreakGlassAudit } from "./breakGlassAudit.js";
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
    const result = await runBreakGlassAudit(client, { windowHours });

    for (const finding of result.findings) {
      console.error(
        `UNRECONCILED: shop ${finding.shopId} — ` +
          `${String(finding.longboxOrigin)} Longbox-origin session(s), ` +
          `${String(finding.breakGlassHolder)} break-glass-holder session(s), ` +
          `with no covering grant at that shop`
      );
    }
    console.log(
      `break-glass audit: ${result.windowHours === null ? "all time" : `last ${String(result.windowHours)}h`}, ` +
        `${String(result.designations)} Longbox-origin person(s) designated, ` +
        `${String(result.unreconciled)} unreconciled session(s) across ${String(result.findings.length)} shop(s)`
    );
    if (result.designations === 0) {
      // Not a failure, and not silence either: a reconciliation over an empty
      // designation table is green for the wrong reason, which is the stale
      // detector 019 T34 exists to catch.
      console.log(
        "note: no live Longbox-origin designations exist, so the origin half of the population is " +
          "empty. `pnpm designate-staff` is what fills it."
      );
    }
    if (!result.clean) {
      console.error(
        "K1 (019 T35(c), non-waivable; 034 §3.4): pause live batches until a P0 bead closes with an " +
          "invariant-review PASS. The counts above name the shop, never the person."
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
