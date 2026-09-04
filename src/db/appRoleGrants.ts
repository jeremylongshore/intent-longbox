// The application role's privilege plan: ONE rule, driven by the declared lists.
//
// WHY THIS FILE EXISTS (041 §9.2 item 2, E02-D06). 041 §1 E15 reproduces, by
// execution, that the append-only trigger can be switched off by exactly two
// principals: the table's owner and a superuser. A non-owner, non-superuser role
// gets `permission denied to set parameter "session_replication_role"` and
// `must be owner of table …`, and its UPDATE is refused by the trigger. E12
// records that today one `DATABASE_URL` serves both `scripts/migrate.ts` — which
// creates the tables and therefore owns them — and the server. So the server can
// disable the sole enforcement of locked decision 4 at will.
//
// 041 §9.2 item 2 is explicit that the fix is not another detector:
// "the strongest available mitigation is not a detector at all: it is a migration
// role that owns the schema and an application role that owns nothing."
//
// This module is the second half of that sentence. `longbox_migrate` owns every
// table because it runs the migrations; `longbox_app` is granted DML and nothing
// else, so it cannot `ALTER TABLE … DISABLE TRIGGER` (not the owner) and cannot
// `SET session_replication_role` (not a superuser) — both by construction rather
// than by a check that could be forgotten.
//
// A GRANT IS NOT PERMANENT THE WAY A TRIGGER IS. `CREATE TABLE` grants the new
// table's privileges to nobody, so every future migration that adds a table
// silently leaves the app role unable to read it. That is why this plan is
// re-derived and re-applied at the END of every `pnpm migrate` run rather than
// written once into a migration file: a migration is applied once, and a table
// added three migrations later would never be covered by it.
//
// THE PLAN IS DRIVEN BY THE DECLARED LISTS, NOT BY A THIRD COPY OF THEM.
// `src/db/appendOnlyTables.ts` already declares which tables are append-only and
// which are deliberately mutable, and the gate-test asserts that declaration
// against the live schema in both directions. This module reads the SAME two
// lists and refuses to grant anything to a table that appears in neither — so a
// table added without a declaration fails the grant step loudly instead of
// quietly receiving whichever privileges happen to be convenient. An absence is
// indistinguishable from an oversight (the reasoning `appendOnlyTables.ts` gives
// for exemptions being rows); the same rule applies to privileges.

import { APPEND_ONLY_EXEMPTIONS, APPEND_ONLY_TABLE_NAMES } from "./appendOnlyTables.js";

/** Privileges an append-only table grants the app role: append and read, never edit. */
export const APPEND_ONLY_PRIVILEGES = "SELECT, INSERT";

/** Privileges a declared-exempt (deliberately mutable) table grants the app role. */
export const MUTABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE";

/** Default role name; overridable so a deployment may name its roles differently. */
export const DEFAULT_APP_ROLE = "longbox_app";

/** The classification of the live schema into the two privilege classes. */
export interface GrantPlan {
  /** Declared append-only tables present in the schema → `SELECT, INSERT`. */
  readonly appendOnly: readonly string[];
  /** Declared-exempt tables present in the schema → full DML. */
  readonly mutable: readonly string[];
  /**
   * Declared-exempt tables the app role gets NO privilege on (`appGrant: "none"`).
   *
   * Present in the plan as a named class rather than as an absence, so the grant
   * step's output and its test can say "these were deliberately skipped" instead
   * of leaving a reader to infer it from a table that is simply missing.
   */
  readonly noGrant: readonly string[];
}

/**
 * Thrown when the live schema contains a table that neither declared list names.
 *
 * This is the loud failure the bead asks for. The alternative — defaulting an
 * unknown table to append-only grants — would be quieter and worse: a table that
 * genuinely needs UPDATE would fail at runtime in a route nobody tested, and a
 * table that should have been declared append-only would never be noticed at all.
 */
export class UndeclaredTableError extends Error {
  constructor(readonly tables: readonly string[]) {
    super(
      `refusing to grant: ${tables.length} table(s) in the live schema are declared neither ` +
        `append-only nor exempt in src/db/appendOnlyTables.ts — ${tables.join(", ")}. ` +
        `Add each one to APPEND_ONLY_TABLES (with its trigger) or to APPEND_ONLY_EXEMPTIONS ` +
        `(with the record that exempted it) in the same PR that created it.`
    );
    this.name = "UndeclaredTableError";
  }
}

const EXEMPT_TABLE_NAMES: readonly string[] = APPEND_ONLY_EXEMPTIONS.map((e) => e.table);

/**
 * Declared exemptions the application role may NOT touch at all
 * (`appGrant: "none"` — the third privilege class, declared as a row, not a list).
 *
 * `schema_migrations` is the only member today and the reason is on its row: the
 * app never names it, and a DELETE there makes the next `pnpm migrate` re-run
 * `003`'s DROP-then-CREATE trigger loop, landing every trigger it touches back at
 * the bypassable `'O'` default.
 */
export const NO_APP_GRANT_TABLE_NAMES: readonly string[] = APPEND_ONLY_EXEMPTIONS.filter(
  (e) => e.appGrant === "none"
).map((e) => e.table);

/**
 * Classify the live base tables into the three privilege classes.
 *
 * @param liveTables base-table names present in schema `public`.
 * @throws UndeclaredTableError when any live table appears in neither declared list.
 */
export function planAppRoleGrants(liveTables: readonly string[]): GrantPlan {
  const appendOnly: string[] = [];
  const mutable: string[] = [];
  const noGrant: string[] = [];
  const undeclared: string[] = [];

  for (const table of [...liveTables].sort()) {
    if (APPEND_ONLY_TABLE_NAMES.includes(table)) appendOnly.push(table);
    else if (NO_APP_GRANT_TABLE_NAMES.includes(table)) noGrant.push(table);
    else if (EXEMPT_TABLE_NAMES.includes(table)) mutable.push(table);
    else undeclared.push(table);
  }

  if (undeclared.length > 0) throw new UndeclaredTableError(undeclared);
  return { appendOnly, mutable, noGrant };
}

/** Postgres identifiers we are willing to interpolate: lowercase, unquoted, no injection surface. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function assertSafeIdentifier(name: string, what: string): string {
  if (!SAFE_IDENTIFIER.test(name)) throw new Error(`unsafe ${what}: ${JSON.stringify(name)}`);
  return name;
}

/**
 * The exact statements applied to the database, in order.
 *
 * Returned as data rather than executed inline so a test can assert the plan
 * without a database, and so a reviewer can read the whole privilege set in one
 * place. `REVOKE ALL` runs first, which makes the step idempotent AND corrective:
 * re-running it after a table changes class removes the privileges it no longer
 * has, rather than leaving a stale UPDATE grant behind — which is also what makes
 * `plan.noGrant` need no statement of its own: the opening `REVOKE ALL` strips
 * those tables and nothing grants them back.
 */
export function buildGrantStatements(plan: GrantPlan, role: string, views: readonly string[] = []): string[] {
  assertSafeIdentifier(role, "role name");
  for (const t of [...plan.appendOnly, ...plan.mutable, ...plan.noGrant, ...views]) {
    assertSafeIdentifier(t, "table name");
  }

  const statements = [
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
  ];
  if (plan.appendOnly.length > 0) {
    statements.push(`GRANT ${APPEND_ONLY_PRIVILEGES} ON ${plan.appendOnly.join(", ")} TO ${role}`);
  }
  if (plan.mutable.length > 0) {
    statements.push(`GRANT ${MUTABLE_PRIVILEGES} ON ${plan.mutable.join(", ")} TO ${role}`);
  }
  if (views.length > 0) {
    // Views are read models over the tables above (`*_current`). SELECT only —
    // an updatable view would be an UPDATE path onto an append-only table.
    statements.push(`GRANT SELECT ON ${views.join(", ")} TO ${role}`);
  }
  // Sequences: the app inserts rows, and a serial default needs USAGE. No table
  // in the schema uses one today; the grant is here so adding one does not
  // produce a runtime permission error in a route.
  statements.push(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  return statements;
}

/** The minimum client surface this module needs; `pg.Client` and `pg.Pool` both satisfy it. */
export interface GrantClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

const BASE_TABLES_SQL = `
  SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
`;

const VIEWS_SQL = `
  SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
`;

/**
 * Re-derive and re-apply the app role's privileges against the live schema.
 *
 * Fails closed on a missing role: a `pnpm migrate` that silently skipped the
 * grants would leave a database whose server cannot read it, discovered at the
 * next deploy rather than here.
 */
export async function applyAppRoleGrants(
  client: GrantClient,
  role: string = process.env.APP_DB_ROLE ?? DEFAULT_APP_ROLE
): Promise<{ role: string; plan: GrantPlan; views: string[]; statements: string[] }> {
  assertSafeIdentifier(role, "role name");
  const roleRows = (await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role])).rows;
  if (roleRows.length === 0) {
    throw new Error(
      `refusing to grant: role "${role}" does not exist in this cluster. Provision the two roles ` +
        `first (docker/postgres-init/00-roles.sql for local/CI; the deploy contract in production), ` +
        `or set APP_DB_ROLE to the role this deployment uses.`
    );
  }

  const tables = (await client.query(BASE_TABLES_SQL)).rows as Array<{ name: string }>;
  const views = ((await client.query(VIEWS_SQL)).rows as Array<{ name: string }>).map((r) => r.name).sort();
  const plan = planAppRoleGrants(tables.map((r) => r.name));
  const statements = buildGrantStatements(plan, role, views);
  for (const sql of statements) await client.query(sql);
  return { role, plan, views, statements };
}
