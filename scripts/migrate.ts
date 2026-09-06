// Minimal SQL migration runner: applies migrations/*.sql in filename order,
// tracked in schema_migrations. No down migrations (append-only discipline).
//
// RUNS AS THE OWNING ROLE (E02-D06, 041 §9.2 item 2). This script creates the
// tables, so whichever role it connects as OWNS them — and an owner can
// `ALTER TABLE … DISABLE TRIGGER`. That is why it reads MIGRATE_DATABASE_URL and
// the server reads DATABASE_URL: they are deliberately different roles, and the
// server asserts at boot that its own role owns nothing (src/services/roleSeparation.ts).
//
// The grant step runs LAST, every time, because `CREATE TABLE` grants privileges
// to nobody: a table added by any future migration is invisible to the app role
// until the grants are re-derived. See src/db/appRoleGrants.ts.
import "dotenv/config";
// EXPAND/CONTRACT DISCIPLINE (E02-B10, 000-docs/044). Three rules the runner now
// enforces rather than the review that used to:
//   1. every migration is expand-only unless it declares a `-- contract:` header
//      naming the expand migration it retires and the 006 decision-log row;
//   2. the ledger records a SHA-256 of each applied file, and a changed applied
//      file fails loudly instead of being silently skipped;
//   3. `pnpm migrate --dry-run` prints the plan and WRITES NOTHING — it reads the
//      ledger if one exists and creates nothing, not even its own table.
// E03-D20 (000-docs/044 §2 A1, §9) adds two more, both linted in the same pass:
//   4. a migration that ENABLES row-level security or CREATEs a policy declares
//      `-- contract: deploy unit …; 006 row: …` — the boundary retires nothing,
//      so what it must declare is the code it ships and rolls back WITH;
//   5. a `CREATE INDEX` without CONCURRENTLY on a table the file did not create
//      declares `-- index lock: …`. It WARNS while `G3_LIVE_SHOP_ROWS` is false
//      and REFUSES after, because the lock is free only while the table is empty.
import pg from "pg";
import { applyAppRoleGrants } from "../src/db/appRoleGrants.js";
import { applyRowLevelSecurity } from "../src/db/rowLevelSecurity.js";
import { resolveMigrateUrl } from "./migrateUrl.js";
import {
  lintMigrationDetailed,
  planMigrations,
  readMigrations,
  type LedgerRow,
} from "./migrationDiscipline.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const files = readMigrations();

  // The lint runs BEFORE any connection is opened, so a bad file is refused
  // without a database and `--dry-run` reports it too.
  //
  // E03-D20 added a WARNING class alongside the refusals: a non-CONCURRENTLY
  // index build on a table this file did not create is free while no table can
  // hold a live shop row (034:421) and a write outage afterwards, so it is
  // printed now and refused when `G3_LIVE_SHOP_ROWS` flips (000-docs/044 §9).
  // Warnings print BEFORE the connection for the same reason the errors do.
  const linted = files.map((f) => lintMigrationDetailed(f.filename, f.sql));
  const lintWarnings = linted.flatMap((l) => l.warnings);
  for (const warning of lintWarnings) console.log(`lint  WARN  ${warning}`);
  if (lintWarnings.length > 0) {
    console.log(
      `lint  ${lintWarnings.length} warning(s); each becomes a refusal at the G3 cut-over (044 §9)`
    );
  }
  const lintErrors = linted.flatMap((l) => l.errors);
  if (lintErrors.length > 0) {
    throw new Error(`expand/contract lint failed:\n\n${lintErrors.join("\n\n")}`);
  }

  const url = resolveMigrateUrl();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // READ FIRST, WRITE NOTHING, so that `--dry-run` is honestly read-only. The
    // ledger may not exist yet (a fresh database) or may predate the checksum
    // column; both are read as an absence rather than created here, because
    // creating the table is a write and "--dry-run touches no database" has to be
    // true rather than nearly true. The DDL moves below the early return.
    const ledgerExists =
      (
        await client.query(
          `SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'schema_migrations'`
        )
      ).rows.length > 0;
    // The checksum column must be probed with a SEPARATE query, not folded into a
    // CASE over `information_schema`: Postgres parses the whole statement before it
    // evaluates anything, so naming a column that does not exist is a parse error
    // however it is guarded. Every database that predates this bead is in exactly
    // that state, which is why this is two round trips and not one clever one.
    const hasChecksum =
      ledgerExists &&
      (
        await client.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'schema_migrations'
              AND column_name = 'checksum'`
        )
      ).rows.length > 0;
    const ledger: LedgerRow[] = !ledgerExists
      ? []
      : hasChecksum
        ? ((await client.query(`SELECT filename, checksum FROM schema_migrations`)).rows as LedgerRow[])
        : (
            (await client.query(`SELECT filename FROM schema_migrations`)).rows as Array<{
              filename: string;
            }>
          ).map((r) => ({ filename: r.filename, checksum: null }));
    // Throws MigrationChecksumError on an edited applied file — before anything runs.
    const migrationPlan = planMigrations(files, ledger);

    if (dryRun) {
      console.log("plan (--dry-run; nothing was applied):");
      for (const entry of migrationPlan) console.log(`  ${entry.action.padEnd(14)} ${entry.filename}`);
      const pending = migrationPlan.filter((p) => p.action === "apply").length;
      console.log(`  ${pending} to apply, ${migrationPlan.length - pending} already applied`);
      console.log("grants  skipped (--dry-run)");
      console.log("rls     skipped (--dry-run)");
      return;
    }

    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`
    );
    // The checksum column is added by the RUNNER, not by a migration file: the
    // ledger is the runner's own bookkeeping (it is `appGrant: "none"` for exactly
    // that reason, src/db/appendOnlyTables.ts), and a migration that altered it
    // would be a migration whose success depended on itself having run.
    await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text`);

    const byName = new Map(files.map((f) => [f.filename, f.sql]));
    for (const entry of migrationPlan) {
      if (entry.action === "skip") {
        console.log(`skip  ${entry.filename}`);
        continue;
      }
      if (entry.action === "adopt-checksum") {
        // Applied before this column existed: there is no honest baseline to compare
        // against, so record the current digest and SAY SO. Verified like any other
        // file from the next run on.
        await client.query(`UPDATE schema_migrations SET checksum = $2 WHERE filename = $1`, [
          entry.filename,
          entry.checksum,
        ]);
        console.log(`skip  ${entry.filename}  (adopted checksum ${entry.checksum.slice(0, 12)}…)`);
        continue;
      }
      console.log(`apply ${entry.filename}`);
      await client.query(byName.get(entry.filename)!);
      await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [
        entry.filename,
        entry.checksum,
      ]);
    }
    console.log("migrations up to date");
    // ⚠ **POLICIES BEFORE PRIVILEGES, AND THE ORDER IS THE SECURITY LENS'S F6.**
    // Both steps are re-derived from the live schema on every run, because
    // neither a POLICY nor a GRANT is inherited by a table a later migration
    // creates. This one is DESIGNED TO THROW — on a table with no `shop_id` and
    // no declared exemption, on a relation kind that cannot carry RLS — and the
    // grant step is what makes a new table readable at all. Granting first meant
    // a run that failed here left the new table GRANTED and UNPOLICIED, with a
    // process already serving from it. Failing this way round leaves it
    // unreadable instead, which is the direction to fail in.
    const rls = await applyRowLevelSecurity(client);
    console.log(
      `rls     ${rls.plan.policied.length} policied (${rls.plan.serviceScoped.length} also service-scoped), ` +
        `${rls.plan.exempt.length} declared exempt (no tenant column), ` +
        `${rls.plan.views.length} view(s) security_invoker`
    );
    const { role, plan, views } = await applyAppRoleGrants(client);
    console.log(
      `grants  ${role}: ${plan.appendOnly.length} append-only (SELECT, INSERT), ` +
        `${plan.mutable.length} exempt (full DML), ${plan.columnScoped.length} exempt (SELECT, INSERT + UPDATE on named columns), ${plan.noGrant.length} exempt (no grant), ` +
        `${views.length} view(s) (SELECT)`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
