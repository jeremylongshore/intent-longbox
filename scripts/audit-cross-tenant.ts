// `pnpm audit:cross-tenant` — 019 T24's daily audit query, as a CLI.
//
//   pnpm audit:cross-tenant            # uses MIGRATE_DATABASE_URL (the owning role)
//
// It exits NON-ZERO on any hit, so a scheduler needs no output parsing to know
// something is wrong; 034 §3.4 says what a hit means — *"Any occurrence in the
// daily cross-tenant audit query is K1 — pause live batches until the P0 bead
// closes with an invariant-review PASS."*
//
// **It runs as the SCHEMA OWNER, and that is the only role that can.** An audit
// for rows that cross tenants cannot run under a tenant context, because the
// context is what hides the rows it is looking for. `assertSchemaOwnerOrThrow`
// refuses the application connection, so a scheduler that reached for
// `DATABASE_URL` gets a loud refusal rather than a green run over nothing.
//
// **It prints counts and identifiers, never row contents** (022 P3, 019 T35): an
// edge, a count, and nothing that could put one shop's data — or a person's — in
// a log a scheduler collects.
//
// The daily SCHEDULE and the T34 heartbeat are E13-B04.1's. This is the query.
import "dotenv/config";
import pg from "pg";
import { runCrossTenantAudit } from "./crossTenantAudit.js";
import { assertSchemaOwnerOrThrow } from "../src/services/roleSeparation.js";
import { resolveMigrateUrl } from "./migrateUrl.js";

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: resolveMigrateUrl() });
  await client.connect();
  try {
    await assertSchemaOwnerOrThrow(client);
    const result = await runCrossTenantAudit(client);
    const hits = result.findings.filter((f) => f.mismatches > 0);

    for (const finding of hits) {
      console.error(
        `CROSS-TENANT: ${String(finding.mismatches)} row(s) — ${finding.check} (${finding.detail})`
      );
    }
    console.log(
      `cross-tenant audit: ${String(result.edges)} tenant edge(s) + 1 grant check, ` +
        `${String(hits.length)} finding(s)`
    );
    if (!result.clean) {
      console.error(
        "K1 (019 T24, non-waivable; 034 §3.4): pause live batches until a P0 bead closes with an " +
          "invariant-review PASS. The counts above name the edge, never the rows."
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
