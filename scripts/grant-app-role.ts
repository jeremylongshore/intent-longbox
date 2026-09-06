// Re-apply the application role's privileges against the live schema.
//
//   pnpm grant-app-role            # uses MIGRATE_DATABASE_URL (the owning role)
//
// `pnpm migrate` already runs this step last, in-process, through the same
// function — this entry point exists for the two cases where the runner is not
// the thing that changed: a role provisioned after the migrations ran, and a
// deployment verifying the grants without re-running anything. It is idempotent
// (the plan begins with REVOKE ALL) and it is corrective (a table that changed
// class loses the privileges it no longer has).
import "dotenv/config";
import pg from "pg";
import { applyAppRoleGrants } from "../src/db/appRoleGrants.js";
import { applyRowLevelSecurity } from "../src/db/rowLevelSecurity.js";
import { resolveMigrateUrl } from "./migrateUrl.js";

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: resolveMigrateUrl() });
  await client.connect();
  try {
    // POLICIES FIRST, PRIVILEGES SECOND (security lens F6): the RLS step is the
    // one designed to throw, and a failure that has already granted a new table
    // leaves it readable and unpolicied. Both halves are idempotent — the grant
    // plan opens with `REVOKE ALL` and every policy is dropped before it is
    // created — so running them in this order costs nothing and fails safely.
    const rls = await applyRowLevelSecurity(client);
    for (const sql of rls.statements) console.log(`  ${sql}`);
    console.log(
      `rls     ${rls.plan.policied.length} policied (${rls.plan.serviceScoped.length} also service-scoped), ` +
        `${rls.plan.exempt.length} declared exempt (no tenant column), ` +
        `${rls.plan.views.length} view(s) security_invoker`
    );
    const { role, plan, views, statements } = await applyAppRoleGrants(client);
    for (const sql of statements) console.log(`  ${sql}`);
    console.log(
      `granted ${role}: ${plan.appendOnly.length} append-only (SELECT, INSERT), ` +
        `${plan.mutable.length} exempt (full DML), ${plan.columnScoped.length} exempt (SELECT, INSERT + UPDATE on named columns), ${plan.noGrant.length} exempt (no grant), ${plan.insertOnly.length} insert-only (INSERT, no SELECT), ` +
        `${views.length} view(s) (SELECT)`
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
