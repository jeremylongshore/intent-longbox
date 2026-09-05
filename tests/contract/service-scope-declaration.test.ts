// L3 (contract): the cross-tenant scopes are declared in ONE place, and no
// migration file restates them.
//
// E03-B04, after the cannon. The consistency lens's only blocking finding (K6,
// which the security lens raised as F4) was that `migrations/029` carried a
// hardcoded ten-table `service_context` array while `src/db/rowLevelSecurity.ts`
// declared fourteen and the runner applied seventeen — and that the only thing
// keeping the drift from being an outage was that `pnpm migrate` happens to run
// both halves together, which a disaster-recovery script, a runner refactor or a
// hand-run of the SQL (a re-runnability 000-docs/044 §7 explicitly wants) would
// not honour. Under the old arrangement a hand-applied `029` left
// `membership_revocation` unscoped and 056 §6.1's fail-open `my-shops` came back.
//
// The fix was to delete the list from the migration. THIS is what stops it coming
// back: a migration that names a service-scoped table in a policy is a second
// list, whoever writes it and however well they mean it.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SERVICE_CONTEXT_TABLES,
  SERVICE_POLICY,
  SERVICE_WRITE_POLICY,
} from "../../src/db/rowLevelSecurity.js";
import { SERVICE_SCOPES } from "../../src/db/tenantContext.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = join(repoRoot, "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => ({ file: f, sql: readFileSync(join(migrationsDir, f), "utf8") }));

/** SQL comments stripped: a migration may EXPLAIN the design, it may not encode it. */
function statements(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

describe("the service scopes are declared once (F4 / K6)", () => {
  it("finds the migrations it is asserting about", () => {
    expect(migrations.length).toBeGreaterThan(20);
    expect(migrations.map((m) => m.file)).toContain("029_row_level_security.sql");
  });

  it("no migration CREATES either service policy — the runner emits both", () => {
    for (const { file, sql } of migrations) {
      const body = statements(sql);
      expect([file, body.includes(`CREATE POLICY ${SERVICE_POLICY}`)]).toEqual([file, false]);
      expect([file, body.includes(`CREATE POLICY ${SERVICE_WRITE_POLICY}`)]).toEqual([file, false]);
    }
  });

  it("no migration names a service SCOPE in a statement", () => {
    // A scope name in SQL is the beginning of a policy keyed on it, which is the
    // beginning of a second list. The names may appear in COMMENTS — this file's
    // own subject is worth explaining where a reader will be standing.
    for (const { file, sql } of migrations) {
      const body = statements(sql);
      for (const { scope } of SERVICE_SCOPES) {
        expect([file, scope, body.includes(scope)]).toEqual([file, scope, false]);
      }
    }
  });

  it("no migration lists the service-scoped TABLES in an array", () => {
    // The precise shape that drifted: a `FOREACH … IN ARRAY ARRAY[…]` of table
    // names beside a `CREATE POLICY`. Two or more declared table names inside one
    // statement block is the signature, and one name is not (a migration that
    // creates `app_session` obviously names it).
    for (const { file, sql } of migrations) {
      const body = statements(sql);
      for (const block of body.split(";")) {
        // An array of table names is ordinary and legitimate — `019` loops one to
        // create triggers. What is forbidden is an array of table names IN A
        // POLICY STATEMENT, which is the shape that drifted.
        if (!block.includes("ARRAY[")) continue;
        if (!/POLICY|service/i.test(block)) continue;
        const named = SERVICE_CONTEXT_TABLES.filter((t) => block.includes(`'${t}'`));
        expect([file, named]).toEqual([file, []]);
      }
    }
  });
});
