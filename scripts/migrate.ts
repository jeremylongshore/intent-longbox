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
import pg from "pg";
import { applyAppRoleGrants } from "../src/db/appRoleGrants.js";
import { resolveMigrateUrl } from "./migrateUrl.js";
import { lintMigration, planMigrations, readMigrations, type LedgerRow } from "./migrationDiscipline.js";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const files = readMigrations();

  // The lint runs BEFORE any connection is opened, so a bad file is refused
  // without a database and `--dry-run` reports it too.
  const lintErrors = files.flatMap((f) => lintMigration(f.filename, f.sql));
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
    const { role, plan, views } = await applyAppRoleGrants(client);
    console.log(
      `grants  ${role}: ${plan.appendOnly.length} append-only (SELECT, INSERT), ` +
        `${plan.mutable.length} exempt (full DML), ${plan.noGrant.length} exempt (no grant), ` +
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
