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
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyAppRoleGrants } from "../src/db/appRoleGrants.js";
import { resolveMigrateUrl } from "./migrateUrl.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main(): Promise<void> {
  const url = resolveMigrateUrl();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`
    );
    const applied = new Set(
      (await client.query("SELECT filename FROM schema_migrations")).rows.map(
        (r: { filename: string }) => r.filename
      )
    );
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip  ${file}`);
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      console.log(`apply ${file}`);
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
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
