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

import { APPEND_ONLY_EXEMPTIONS, APPEND_ONLY_TABLE_NAMES, APPEND_ONLY_TABLES } from "./appendOnlyTables.js";

/** Privileges an append-only table grants the app role: append and read, never edit. */
export const APPEND_ONLY_PRIVILEGES = "SELECT, INSERT";

/**
 * The extra privilege a ROW-LOCKABLE append-only table needs (E02-D07).
 *
 * PostgreSQL's GRANT documentation puts `SELECT … FOR UPDATE` under the UPDATE
 * privilege, so a table on the uniform `SELECT, INSERT` grant cannot be
 * row-locked by the application at all — reproduced on postgres:16 in
 * `appendOnlyTables.ts`'s `appLockable` comment. 043 §7.2's claim mechanism is
 * `FOR UPDATE … SKIP LOCKED` and 043 §7.3 ratifies that the worker uses this
 * same non-owner role, so the privilege is required by two ratified decisions
 * together.
 *
 * IT IS NOT A HOLE IN THE APPEND-ONLY MODEL, and the reason is 041 §9.2 item 1's
 * ranking: enforcement is the `ENABLE ALWAYS` `forbid_mutation()` trigger, and a
 * trigger does not consult privileges. With UPDATE granted, `UPDATE outbox …` is
 * still refused — by the trigger, at the database, in every replication role.
 * The grant layer was never the guarantee; it is defence in depth, and this row
 * says exactly which table trades a little of that depth and for which
 * mechanism.
 */
export const ROW_LOCK_PRIVILEGE = "UPDATE";

/**
 * Append-only tables the application must be able to row-lock, as a DECLARED
 * list rather than a special case inside the grant builder.
 */
export const APP_LOCKABLE_TABLE_NAMES: readonly string[] = APPEND_ONLY_TABLES.filter(
  (t) => t.appLockable === true
).map((t) => t.table);

/** Privileges a declared-exempt (deliberately mutable) table grants the app role. */
export const MUTABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE";

/**
 * Privileges an `appGrant: "insert-only"` table grants (E03-D17).
 *
 * **APPEND WITHOUT READ.** `identity_access` is the audited accessor's fact
 * (019 T35(b), 034 §3.3): the application must write a row on every read that
 * turns a key into a person, and must never be able to read the rows back. A
 * process that could query its own access log could shape what an audit sees
 * before the audit runs, and nothing in the running system has a question to ask
 * this table — its only reader is `pnpm audit:identity-access`, as the schema
 * owner. The mirror of `appGrant: "none"`, and declared as its own class rather
 * than as a special case inside the grant builder.
 */
export const INSERT_ONLY_PRIVILEGES = "INSERT";

/**
 * Privileges a COLUMN-SCOPED exemption grants, beside its `GRANT UPDATE (cols)`.
 *
 * The same pair an append-only table gets, and deliberately so: a table whose
 * exemption is for named columns is append-only in every other respect, so its
 * ending is a fact row rather than a DELETE (E03-D06).
 */
export const COLUMN_SCOPED_PRIVILEGES = "SELECT, INSERT";

/**
 * Privileges a `appGrant: "read-append"` exemption grants (E03-D21).
 *
 * The same two words as `APPEND_ONLY_PRIVILEGES` and a DIFFERENT reason, which is
 * why it is its own constant rather than a reuse: an append-only table is held to
 * `SELECT, INSERT` by a trigger and the grant is defence in depth, while a
 * read-append table has NO trigger and the grant is the whole control. `app_user`
 * is the only member: it is policied `FOR ALL` on a live membership, so a
 * table-level UPDATE let the application rewrite any co-worker's login email
 * under an ordinary tenant context (security lens F1 on 000-docs/062). Nothing in
 * the tree updates or deletes a person; correcting one is a schema-owner act.
 */
export const READ_APPEND_PRIVILEGES = "SELECT, INSERT";

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
  /**
   * Declared exemptions whose UPDATE is scoped to named columns (E03-D06).
   *
   * A FOURTH class rather than a flag on `mutable`, for `noGrant`'s reason: the
   * grant step's output and its test should be able to say "this table's UPDATE
   * is two columns wide" rather than leaving a reader to infer it from an absence
   * in the full-DML list.
   */
  readonly columnScoped: ReadonlyArray<{ table: string; columns: readonly string[] }>;
  /**
   * Declared tables the app role may INSERT into and may not read (E03-D17).
   *
   * A FIFTH class for `noGrant`'s reason, one value over: the grant step's
   * output and its test should be able to say "this table is append-without-read"
   * rather than leaving a reader to infer it from a table missing from the
   * append-only list.
   */
  readonly insertOnly: readonly string[];
  /**
   * Declared exemptions the app role may read and append and may not change
   * (`appGrant: "read-append"`, E03-D21).
   *
   * A SIXTH class for `noGrant`'s reason: the grant step's output and its test
   * should be able to say "this table's rows are not the application's to edit"
   * rather than leaving a reader to infer it from a table missing from the
   * full-DML list.
   */
  readonly readAppend: readonly string[];
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
 * Declared exemptions whose UPDATE is scoped to named columns (E03-D06).
 *
 * Derived from the same declaration list as everything else in this module, so a
 * table cannot enter or leave the class by being edited here.
 */
const COLUMN_SCOPED_EXEMPTIONS: ReadonlyArray<{ table: string; columns: readonly string[] }> =
  APPEND_ONLY_EXEMPTIONS.filter((e) => e.updateColumns !== undefined && e.appGrant !== "none").map((e) => ({
    table: e.table,
    columns: e.updateColumns!,
  }));

/**
 * Declared exemptions the application role may NOT touch at all
 * (`appGrant: "none"` — the third privilege class, declared as a row, not a list).
 *
 * `schema_migrations` is the only member today and the reason is on its row: the
 * app never names it, and a DELETE there makes the next `pnpm migrate` re-run
 * `003`'s DROP-then-CREATE trigger loop, landing every trigger it touches back at
 * the bypassable `'O'` default.
 */
export const NO_APP_GRANT_TABLE_NAMES: readonly string[] = [
  ...APPEND_ONLY_EXEMPTIONS.filter((e) => e.appGrant === "none").map((e) => e.table),
  // E03-D14: an APPEND-ONLY table may also declare it. The two lists are read
  // together rather than kept apart because the question a reader asks is "what
  // may the app touch?", and an answer split across two modules is an answer
  // that can disagree with itself — `appendOnlyTables.ts` gives that reasoning
  // for `appGrant` living on the exemption row, and it does not stop being true
  // one list over.
  ...APPEND_ONLY_TABLES.filter((t) => t.appGrant === "none").map((t) => t.table),
].sort();

/**
 * Declared append-only tables the app role may INSERT into and may not read
 * (`appGrant: "insert-only"`, E03-D17).
 *
 * Derived from the same declaration list as every other class, so a table cannot
 * enter or leave it by being edited here.
 */
export const INSERT_ONLY_TABLE_NAMES: readonly string[] = APPEND_ONLY_TABLES.filter(
  (t) => t.appGrant === "insert-only"
)
  .map((t) => t.table)
  .sort();

/**
 * Declared exemptions the app role may read and append and may NOT change
 * (`appGrant: "read-append"`, E03-D21).
 *
 * Derived from the same declaration list as every other class, so a table cannot
 * enter or leave it by being edited here.
 */
export const READ_APPEND_TABLE_NAMES: readonly string[] = APPEND_ONLY_EXEMPTIONS.filter(
  (e) => e.appGrant === "read-append"
)
  .map((e) => e.table)
  .sort();

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
  const insertOnly: string[] = [];
  const readAppend: string[] = [];
  const columnScoped: Array<{ table: string; columns: readonly string[] }> = [];
  const undeclared: string[] = [];

  for (const table of [...liveTables].sort()) {
    const scoped = COLUMN_SCOPED_EXEMPTIONS.find((e) => e.table === table);
    // `noGrant` FIRST (E03-D14). It is the narrowest class of all, and an
    // append-only table that declares it would otherwise be caught by the wider
    // branch below and silently granted `SELECT, INSERT` — the same ordering bug
    // the `columnScoped` comment records, one class over.
    if (NO_APP_GRANT_TABLE_NAMES.includes(table)) noGrant.push(table);
    // `insertOnly` BEFORE the append-only branch, for `noGrant`'s reason exactly
    // (E03-D17): it is narrower, and reaching the wider branch first would grant
    // the SELECT this class exists to withhold.
    else if (INSERT_ONLY_TABLE_NAMES.includes(table)) insertOnly.push(table);
    else if (APPEND_ONLY_TABLE_NAMES.includes(table)) appendOnly.push(table);
    // BEFORE the plain-exempt branch: a row carrying `updateColumns` is a
    // narrower class, and reaching the wider one first would silently restore
    // the table-level DML this class exists to remove.
    else if (scoped) columnScoped.push({ table, columns: scoped.columns });
    // BEFORE the plain-exempt branch, for the same reason every narrower class is
    // (E03-D21): reaching the wider one first would silently restore the
    // table-level UPDATE and DELETE this class exists to remove.
    else if (READ_APPEND_TABLE_NAMES.includes(table)) readAppend.push(table);
    else if (EXEMPT_TABLE_NAMES.includes(table)) mutable.push(table);
    else undeclared.push(table);
  }

  if (undeclared.length > 0) throw new UndeclaredTableError(undeclared);
  return { appendOnly, mutable, noGrant, columnScoped, insertOnly, readAppend };
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
  for (const t of [
    ...plan.appendOnly,
    ...plan.mutable,
    ...plan.noGrant,
    ...plan.insertOnly,
    ...plan.readAppend,
    ...plan.columnScoped.map((c) => c.table),
    ...views,
  ]) {
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
  // The row-lock privilege, granted to the declared subset and to nothing else.
  // Derived from the same list every other reader uses, so a table cannot
  // acquire it by being edited here.
  const lockable = plan.appendOnly.filter((t) => APP_LOCKABLE_TABLE_NAMES.includes(t));
  if (lockable.length > 0) {
    statements.push(`GRANT ${ROW_LOCK_PRIVILEGE} ON ${lockable.join(", ")} TO ${role}`);
  }
  if (plan.mutable.length > 0) {
    statements.push(`GRANT ${MUTABLE_PRIVILEGES} ON ${plan.mutable.join(", ")} TO ${role}`);
  }
  // APPEND WITHOUT READ (E03-D17). No `SELECT` — which also means no
  // `SELECT … FOR UPDATE`, so this class cannot be row-locked either, and that
  // is correct: nothing in the running system reads or waits on these rows.
  if (plan.insertOnly.length > 0) {
    statements.push(`GRANT ${INSERT_ONLY_PRIVILEGES} ON ${plan.insertOnly.join(", ")} TO ${role}`);
  }
  // READ AND APPEND, NEVER CHANGE (E03-D21). No UPDATE and no DELETE: the table
  // is exempt from the append-only TRIGGER and is still not the application's to
  // edit, because its policy is `FOR ALL` over rows this shop legitimately sees
  // and a table-level UPDATE was therefore a cross-tenant write on a person
  // shared with another shop.
  if (plan.readAppend.length > 0) {
    statements.push(`GRANT ${READ_APPEND_PRIVILEGES} ON ${plan.readAppend.join(", ")} TO ${role}`);
  }
  // THE COLUMN-SCOPED CLASS (E03-D06). `SELECT, INSERT` at the table, `UPDATE` on
  // the named columns only, and NO DELETE — so a table exempted because ONE column
  // has to move cannot have its other columns rewritten or its rows removed by the
  // application. Emitted as two statements because PostgreSQL has no single form
  // that mixes table-level and column-level privileges.
  for (const { table, columns } of plan.columnScoped) {
    for (const column of columns) assertSafeIdentifier(column, "column name");
    statements.push(`GRANT ${COLUMN_SCOPED_PRIVILEGES} ON ${table} TO ${role}`);
    statements.push(`GRANT UPDATE (${columns.join(", ")}) ON ${table} TO ${role}`);
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
  role: string = process.env["APP_DB_ROLE"] ?? DEFAULT_APP_ROLE
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
