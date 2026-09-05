// The role-separation boot assertion (E02-D06, 041 §9.2 item 2).
//
// A SIBLING OF appendOnlyDetector, NOT AN EXTENSION OF IT, and the distinction is
// the point. `appendOnlyDetector` asks "are the triggers on?" — a question about
// the database's state, which an operator can change after boot, so it is asked
// again every five minutes. This module asks "could THIS connection turn them
// off?" — a question about the connection's own identity, which is fixed for the
// life of the pool: a role cannot gain ownership or superuser mid-connection
// without a `GRANT` that is itself a deliberate act by a superuser. So it is a
// boot assertion and deliberately not on the five-minute timer; adding it there
// would burn a query every five minutes to re-read a constant.
//
// WHAT IT REFUSES, and why exactly these two:
//   1. the connection's role is a SUPERUSER — a superuser may `SET
//      session_replication_role = 'replica'` and bypass even an ENABLE ALWAYS
//      trigger (041 §1 E15: the bypass is available to "the table owner and any
//      superuser"), and may `ALTER TABLE … DISABLE TRIGGER` on anything;
//   2. the connection's role OWNS (directly, or through role membership) any
//      table in the declared append-only set — the owner may
//      `ALTER TABLE … DISABLE TRIGGER` on it, which is the door migration 006's
//      ENABLE ALWAYS does not close.
//
// Ownership is tested with `pg_has_role(current_user, relowner, 'MEMBER')` rather
// than `relowner = current_user::regrole`, because a role that is a MEMBER of the
// owning role can `SET ROLE` to it and then disable the trigger. Testing equality
// alone would pass a deployment that made `longbox_app` a member of
// `longbox_migrate` — the exact shortcut someone reaches for when a grant is
// missing, and one that silently reopens the door this bead closes.
//
// AND IT IS 'MEMBER', NOT 'USAGE' — the invariant review caught this and it is
// the difference between a check and a false comfort. `USAGE` asks *"are this
// role's privileges INHERITED right now?"*; `MEMBER` asks *"can this role reach
// that role at all?"*. They differ on exactly one grant, and it is the dangerous
// one: `GRANT longbox_migrate TO longbox_app WITH INHERIT FALSE` leaves `USAGE`
// FALSE while `SET ROLE longbox_migrate` still succeeds — so the app connection
// could `SET ROLE` and then `DISABLE TRIGGER` while this check reported "owns no
// append-only table". Reproduced by the reviewer, and now asserted against a real
// cluster in `tests/integration/role-separation.test.ts`. `MEMBER` is TRUE for
// both inheriting and non-inheriting membership, which is the question worth
// asking: reachability, not today's inheritance setting.

import { APPEND_ONLY_TABLE_NAMES } from "../db/appendOnlyTables.js";
// 058 F2: the tables the application role may not touch at all. Imported from
// the SAME declaration the grant step reads, so the boot check and the grant
// plan cannot disagree about which tables they are.
import { NO_APP_GRANT_TABLE_NAMES } from "../db/appRoleGrants.js";
import {
  SERVICE_POLICY,
  SERVICE_TABLES,
  SERVICE_WRITE_POLICY,
  TENANT_COLUMNS,
  TENANT_POLICY,
  serviceReadPredicate,
  serviceWritePredicate,
  tenantPredicate,
} from "../db/rowLevelSecurity.js";

export interface RoleSeparationResult {
  ok: boolean;
  /** The role the pooled connection authenticates as (`current_user`). */
  role: string;
  /** True when that role has the superuser attribute. */
  isSuperuser: boolean;
  /** Declared append-only tables this role owns or can `SET ROLE` into owning. */
  ownedAppendOnlyTables: string[];
}

interface IdentityRow {
  role: string;
  is_superuser: boolean;
}

interface OwnedRow {
  table_name: string;
}

/** The minimum surface needed; a `pg.Pool` satisfies it. */
export interface RoleQueryable {
  query(text: string): Promise<{ rows: unknown[] }>;
}

const IDENTITY_SQL = `
  SELECT current_user AS role,
         COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_superuser
`;

/**
 * Every table in `public` whose owner this connection is, or is a member of.
 *
 * `relkind='r'` only: a view's owner cannot disable a trigger, and the ownership
 * that matters for locked decision 4 is ownership of the trigger-bearing table.
 */
const OWNED_TABLES_SQL = `
  SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND pg_has_role(current_user, c.relowner, 'MEMBER')
`;

/** Read the connection's own privileges and compare them against the declared set. */
export async function checkRoleSeparation(pool: RoleQueryable): Promise<RoleSeparationResult> {
  const identity = (await pool.query(IDENTITY_SQL)).rows[0] as IdentityRow | undefined;
  if (!identity) throw new Error("role-separation check: `SELECT current_user` returned no row");

  const owned = ((await pool.query(OWNED_TABLES_SQL)).rows as OwnedRow[])
    .map((r) => r.table_name)
    .filter((t) => APPEND_ONLY_TABLE_NAMES.includes(t))
    .sort();

  return {
    ok: !identity.is_superuser && owned.length === 0,
    role: identity.role,
    isSuperuser: identity.is_superuser,
    ownedAppendOnlyTables: owned,
  };
}

/** Human-readable one-liner naming exactly why the connection is over-privileged. */
export function describeRoleSeparationFailure(result: RoleSeparationResult): string {
  const parts: string[] = [];
  if (result.isSuperuser) parts.push(`role "${result.role}" is a SUPERUSER`);
  if (result.ownedAppendOnlyTables.length > 0) {
    parts.push(
      `role "${result.role}" owns ${result.ownedAppendOnlyTables.length} append-only table(s): ` +
        result.ownedAppendOnlyTables.join(", ")
    );
  }
  return parts.join("; ");
}

/** Minimal logger surface — Fastify's and `console` both satisfy it. */
export interface RoleSeparationLogger {
  error(msg: string): void;
  info(msg: string): void;
}

/**
 * Boot assertion: fails closed. A server whose own role can disable the
 * append-only triggers is not serving an append-only log; it is serving a log it
 * has promised not to edit, which is the guarantee 041 §9.2 item 2 exists to
 * replace with one the database enforces.
 */
export async function assertRoleSeparationOrThrow(
  pool: RoleQueryable,
  logger: RoleSeparationLogger = console
): Promise<void> {
  const result = await checkRoleSeparation(pool);
  if (!result.ok) {
    const detail = describeRoleSeparationFailure(result);
    logger.error(`role-separation check FAILED at boot: ${detail}`);
    throw new Error(
      `refusing to serve: this connection could disable the append-only triggers — ${detail}. ` +
        `DATABASE_URL must name the application role (no DDL, no ownership, not a superuser); ` +
        `MIGRATE_DATABASE_URL names the owning role that runs pnpm migrate. See .env.example.`
    );
  }
  logger.info(
    `role-separation check ok: serving as "${result.role}" — owns no append-only table, not a superuser`
  );
}

/**
 * THE MIRROR OF THE BOOT ASSERTION, for the scripts that seed rows as the owner
 * (E04-B04; E02-D06's other half).
 *
 * ⚠ WHY THIS EXISTS AT ALL, STATED AS THE DEFECT IT CLOSES. `resolveMigrateUrl`
 * FALLS BACK to `DATABASE_URL` outside production, deliberately and loudly — so a
 * seeding script that only calls it will happily connect as the APPLICATION role,
 * which has `INSERT` on every table through `grant-app-role`. It would then
 * succeed, and the resulting rows would be indistinguishable from rows written by
 * the owner. The boot assertion refuses a server that could disable a trigger;
 * this refuses a seeding script that is NOT the role E02-D06 says owns the
 * schema, which is the same rule read from the other end.
 *
 * The test is deliberately the SAME query, inverted: a connection that owns (or
 * can `SET ROLE` into owning) NONE of the declared append-only tables is the app
 * role, and an operator act is not the app role's to perform. A superuser is
 * allowed here — it owns everything by construction, and refusing it would break
 * a single-role local checkout for no gain, since the danger a superuser poses is
 * to the SERVING connection and not to a one-shot seed.
 */
export async function assertSchemaOwnerOrThrow(
  pool: RoleQueryable,
  logger: RoleSeparationLogger = console
): Promise<void> {
  const result = await checkRoleSeparation(pool);
  if (result.ownedAppendOnlyTables.length === 0 && !result.isSuperuser) {
    logger.error(`schema-owner check FAILED: role "${result.role}" owns no append-only table`);
    throw new Error(
      `refusing to seed: this connection authenticates as "${result.role}", which owns none of the ` +
        `declared append-only tables — that is the APPLICATION role, not the schema owner. ` +
        `An operator script writes configuration rows and must connect as the owning role: set ` +
        `MIGRATE_DATABASE_URL (see .env.example). \`resolveMigrateUrl\` falls back to DATABASE_URL ` +
        `outside production as a dev convenience, and the app role has INSERT through ` +
        `pnpm grant-app-role, so without this check the fallback would silently succeed.`
    );
  }
  logger.info(`schema-owner check ok: connected as "${result.role}"`);
}

// ===========================================================================
// THE TENANT-ISOLATION BOOT ASSERTION (E03-B04, 034 §3.2, 019 T24)
// ===========================================================================
//
// A THIRD SIBLING, and it asks the third question. `appendOnlyDetector` asks "are
// the triggers on?"; `checkRoleSeparation` asks "could THIS connection turn them
// off?"; this asks **"is the tenant boundary actually in force for this
// connection?"** — which is a different question with a different failure mode.
//
// 034 §3.4 is explicit that the three tenancy layers fail differently: *"the
// contract fails to a code review, the runtime assertion fails to a bug, and RLS
// fails to a DATABASE MISCONFIGURATION."* A misconfiguration is exactly what
// nothing else here would notice: a restored dump taken before `migrations/029`,
// a policy dropped by hand during an incident, a `GRANT`-happy deployment that
// gave the application role `BYPASSRLS`, a role that ended up owning the tables.
// Every one of those leaves a server that reads and writes perfectly well and has
// no tenant boundary at all, and 019 T24 is non-waivable with `any → K1`.
//
// So it is a BOOT ASSERTION and it fails closed, for the same reason the
// role-separation one does: a process that cannot prove the boundary is in force
// must not accept requests it would have to promise were isolated.
//
// **Four things are checked, and each maps to a way the boundary dies:**
//   1. the role has neither `BYPASSRLS` nor `SUPERUSER` — either attribute makes
//      every policy in the database advisory for this connection;
//   2. the role OWNS none of the policied tables — an owner is exempt from its own
//      policies unless `FORCE` is set, and `migrations/029` (a) states why FORCE
//      is deliberately not set;
//   3. every table carrying a `shop_id` has row-level security ENABLED and a
//      `tenant_isolation` policy whose predicate is the declared one — a policy
//      quietly relaxed to `true` would otherwise read as present;
//   4. every view is `security_invoker` — without it a view reads its base tables
//      as the VIEW OWNER (the schema owner, which is exempt), which is the hole
//      `migrations/029` §5 exists to close.
//
// It is NOT on the five-minute timer, and 1 and 2 are the reason: role attributes
// are constant for the life of a connection. 3 and 4 could drift after boot, and
// the instrument for that is 019 T24's daily cross-tenant audit query with its
// T34 heartbeat — a different bead (E13-B04.1) and a different cadence.

export interface TenantIsolationResult {
  ok: boolean;
  role: string;
  /** `BYPASSRLS` or `SUPERUSER`: either one makes every policy advisory. */
  bypassesPolicies: boolean;
  /** Policied tables this role owns or can `SET ROLE` into owning. */
  ownedPoliciedTables: string[];
  /** Tables with a `shop_id` and no row-level security, or no declared policy. */
  unprotectedTables: string[];
  /** Tables whose `tenant_isolation` predicate is not the declared one. */
  alteredPolicies: string[];
  /**
   * `table:policy` pairs on a policied table that this design never emits.
   *
   * The security lens's F2, in one field. Postgres OR-combines PERMISSIVE
   * policies, so an ADDED `CREATE POLICY oops ON scan_session USING (true)` is a
   * cross-tenant read with the declared policy still perfectly intact — the check
   * reported `ok` and the application role read another shop's rows. An inventory
   * of what SHOULD be there cannot see that; only an inventory of what IS there can.
   */
  unexpectedPolicies: string[];
  /**
   * Relations of a kind this boundary cannot protect — a materialized view, a
   * foreign table. Empty by construction today, because the migrate step refuses
   * to create the situation; carried here because a restored dump can.
   */
  unprotectableRelations: string[];
  /** Views that would read their base tables as the schema owner. */
  ownerReadingViews: string[];
  /**
   * Tables declared `appGrant: "none"` on which this role nevertheless holds a
   * privilege — the security lens's F2 on 000-docs/058.
   *
   * These are the only tables in the schema whose CONTENTS decide what a control
   * can SEE (`app_user_origin` and its retirement decide who 019 T35(c) watches),
   * and they carry no `shop_id`, so they are RLS exemptions and no policy stands
   * behind the grant. That made the GRANT the whole mechanism, with nothing
   * checking it at runtime: the lens reproduced a stray
   * `GRANT INSERT … TO longbox_app` after which the application role appended a
   * back-dated retirement while BOTH boot assertions reported green.
   *
   * `has_table_privilege` rather than a `role_table_grants` read, deliberately:
   * the question is not "was a GRANT statement issued" but "can this role, by any
   * path — a direct grant, PUBLIC, or a role it is a member of — touch the table",
   * and only the privilege function answers that one.
   */
  forbiddenGrants: string[];
}

interface IsolationRow {
  bypasses: boolean;
  owned: string[] | null;
  unprotected: string[] | null;
  altered: string[] | null;
  unexpected: string[] | null;
  owner_views: string[] | null;
  unprotectable: string[] | null;
  forbidden_grants: string[] | null;
}

/**
 * ONE round trip, because this runs on every boot and each half is a catalog
 * read. `qual` and `with_check` are the policy predicates as Postgres re-renders
 * them — parenthesised and space-normalised — so both are compared after
 * stripping whitespace and outer parentheses rather than byte for byte.
 */
/** Which tables this database policies: a `shop_id` column, or a declared override. */
const POLICIED_TABLES_SQL = `
  SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND (
           EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'shop_id' AND NOT a.attisdropped
           )
           OR c.relname = ANY ($1::text[])
         )
   ORDER BY 1
`;

const ISOLATION_SQL = `
  WITH policied AS (
    SELECT c.oid, c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND (
             EXISTS (
               SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'shop_id' AND NOT a.attisdropped
             )
             OR c.relname = ANY ($1::text[])
           )
  ),
  -- Every policy that EXISTS on a policied table, normalised the way the
  -- declaration is. coalesce() rather than a guard: a NULL qual is a policy with
  -- no USING clause, which is a FACT about it and not an absence of one.
  live AS (
    SELECT pol.tablename, pol.policyname, pol.cmd,
           replace(replace(replace(replace(coalesce(pol.qual, ''), ' ', ''), '(', ''), ')', ''), '::text', '')
             AS using_expr,
           replace(replace(replace(replace(coalesce(pol.with_check, ''), ' ', ''), '(', ''), ')', ''), '::text', '')
             AS check_expr
      FROM pg_policies pol
      JOIN policied p ON p.relname = pol.tablename
     WHERE pol.schemaname = 'public'
  ),
  expected AS (
    -- Columns named rather than starred: unnest() has no schema to drift, but 042
    -- I5(b)'s lint is a rule about the TREE, and an exemption row for a
    -- five-column set-returning function would cost more than typing them.
    SELECT t.tablename, t.policyname, t.cmd, t.using_expr, t.check_expr
      FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
        AS t(tablename, policyname, cmd, using_expr, check_expr)
  )
  SELECT
    COALESCE((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypasses,
    (SELECT array_agg(p.relname::text ORDER BY p.relname) FROM policied p
      WHERE pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = p.oid), 'MEMBER')) AS owned,
    -- A policied table with RLS off, or with no tenant policy at all.
    (SELECT array_agg(p.relname::text ORDER BY p.relname) FROM policied p
      JOIN pg_class c ON c.oid = p.oid
      WHERE NOT c.relrowsecurity
         OR NOT EXISTS (SELECT 1 FROM live l
                         WHERE l.tablename = p.relname AND l.policyname = $7)) AS unprotected,
    -- A policy whose NAME this design emits, but whose command or predicate is not
    -- the declared one: a relaxed tenant_isolation, a reshaped one, a service
    -- policy widened from SELECT to ALL, or one on a table nothing declares.
    (SELECT array_agg((l.tablename::text || ':' || l.policyname::text || ' ' || l.cmd::text)
                      ORDER BY l.tablename, l.policyname)
       FROM live l
      WHERE l.policyname = ANY ($8::text[])
        AND NOT EXISTS (
              SELECT 1 FROM expected e
               WHERE e.tablename = l.tablename AND e.policyname = l.policyname
                 AND e.cmd = l.cmd AND e.using_expr = l.using_expr AND e.check_expr = l.check_expr
            )) AS altered,
    -- A policy this design never emits at all. Postgres OR-combines permissive
    -- policies, so an ADDED one is a grant with the declared boundary intact.
    (SELECT array_agg((l.tablename::text || ':' || l.policyname::text || ' ' || l.cmd::text)
                      ORDER BY l.tablename, l.policyname)
       FROM live l WHERE l.policyname <> ALL ($8::text[])) AS unexpected,
    (SELECT array_agg(c.relname::text ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind = 'v'
        AND NOT COALESCE(array_to_string(c.reloptions, ',') LIKE '%security_invoker=true%', false)) AS owner_views,
    -- F3: a relation kind this boundary cannot protect. RLS never applies to a
    -- materialized view, and the grant plan beside this one already hands the app
    -- role SELECT on one — so the first one anybody adds would be readable and
    -- unpoliciable with the check otherwise green.
    (SELECT array_agg((c.relname::text || ' (relkind ''' || c.relkind::text || ''')') ORDER BY c.relname)
       FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind IN ('m', 'f')) AS unprotectable,
    -- 058 F2: a table the design says this role may not touch AT ALL, on which it
    -- holds a privilege anyway. to_regclass guards the pending case — a declared
    -- no-grant table a migration has not created yet is not a finding — and the
    -- four privileges are asked separately because the failure is any of them:
    -- a SELECT is a read of who is watched, an INSERT is the back-dated
    -- retirement itself.
    (SELECT array_agg(t ORDER BY t) FROM unnest($9::text[]) AS t
      WHERE to_regclass('public.' || quote_ident(t)) IS NOT NULL
        AND (has_table_privilege(current_user, quote_ident(t), 'SELECT')
          OR has_table_privilege(current_user, quote_ident(t), 'INSERT')
          OR has_table_privilege(current_user, quote_ident(t), 'UPDATE')
          OR has_table_privilege(current_user, quote_ident(t), 'DELETE'))) AS forbidden_grants
`;

/**
 * Normalise a predicate the way the catalog query does: no whitespace, no
 * parentheses, no `::text` casts.
 *
 * Postgres re-renders a policy expression rather than storing the author's text —
 * `= ANY (ARRAY['a'::text])` comes back with casts and its own spacing — so the
 * comparison has to be over a shape both sides can agree on. The stripping is
 * coarse and that is the right direction: a false MATCH would need two predicates
 * differing only in punctuation, while a false MISMATCH is a loud boot failure
 * somebody investigates.
 */
export function normalisePredicate(expr: string): string {
  return expr.replace(/[\s()]/g, "").replace(/::text/g, "");
}

/** One policy this design emits, as the catalog will report it back. */
export interface ExpectedPolicy {
  readonly table: string;
  readonly policy: string;
  /** `pg_policies.cmd`: `ALL`, `SELECT`, `INSERT`. */
  readonly cmd: string;
  /** Normalised `qual`; `''` when the policy has none (an INSERT-only policy). */
  readonly using: string;
  /** Normalised `with_check`; `''` when the policy has none (a SELECT-only policy). */
  readonly check: string;
}

/**
 * EVERY policy this design emits, for every policied table — the tenant policy on
 * each, the scope-scoped read on the declared ones, and the INSERT-only write on
 * the three that have one.
 *
 * ⚠ **THIS IS THE WHOLE OF THE BOOT CHECK'S POLICY HALF, AND THE REASON IT IS A
 * SET RATHER THAN A LIST OF ASSERTIONS** is a defect the invariant review
 * reproduced. The previous version asked one question per table — "does
 * `tenant_isolation` exist and does its predicate match?" — and three ways of
 * being wrong slipped past it:
 *
 *   * a PERMISSIVE policy ADDED beside the declared one (`CREATE POLICY oops ON
 *     scan_session USING (true)`) is OR-ed with it by Postgres, so the boundary is
 *     gone while every declared policy is perfectly intact;
 *   * `tenant_isolation` RESHAPED to `FOR INSERT WITH CHECK (true)` has a NULL
 *     `qual`, which the old query's `using_expr <> ''` guard read as "nothing to
 *     compare" — it reported `ok` and accepted a cross-tenant INSERT;
 *   * the SECOND policy — the one that spans tenants by design — was never
 *     inspected at all.
 *
 * An inventory of what SHOULD be there cannot see any of those. An inventory of
 * what IS there, compared against this set by (table, policy, cmd, using, check),
 * sees all three.
 */
export function expectedPolicies(policiedTables: readonly string[]): ExpectedPolicy[] {
  const expected: ExpectedPolicy[] = [];
  for (const table of policiedTables) {
    const tenant = normalisePredicate(tenantPredicate(table));
    expected.push({ table, policy: TENANT_POLICY, cmd: "ALL", using: tenant, check: tenant });
  }
  for (const table of SERVICE_TABLES) {
    if (!policiedTables.includes(table.table)) continue;
    expected.push({
      table: table.table,
      policy: SERVICE_POLICY,
      cmd: "SELECT",
      using: normalisePredicate(serviceReadPredicate(table)),
      check: "",
    });
    if (table.write !== undefined) {
      expected.push({
        table: table.table,
        policy: SERVICE_WRITE_POLICY,
        cmd: "INSERT",
        using: "",
        check: normalisePredicate(serviceWritePredicate(table)),
      });
    }
  }
  return expected;
}

export interface TenantIsolationQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export async function checkTenantIsolation(pool: TenantIsolationQueryable): Promise<TenantIsolationResult> {
  const identity = (await pool.query(IDENTITY_SQL)).rows[0] as IdentityRow | undefined;
  if (!identity) throw new Error("tenant-isolation check: `SELECT current_user` returned no row");
  // THE DECLARATION IS HANDED TO THE QUERY, never restated in it. Two round trips:
  // one to learn which tables this database policies, one to compare every policy
  // that exists on them against every policy this design emits for them.
  const overrides = Object.keys(TENANT_COLUMNS);
  const policiedRows = (await pool.query(POLICIED_TABLES_SQL, [overrides])).rows as Array<{
    name: string;
  }>;
  const expected = expectedPolicies(policiedRows.map((r) => r.name));
  const row = (
    await pool.query(ISOLATION_SQL, [
      overrides,
      expected.map((e) => e.table),
      expected.map((e) => e.policy),
      expected.map((e) => e.cmd),
      expected.map((e) => e.using),
      expected.map((e) => e.check),
      TENANT_POLICY,
      [TENANT_POLICY, SERVICE_POLICY, SERVICE_WRITE_POLICY],
      [...NO_APP_GRANT_TABLE_NAMES],
    ])
  ).rows[0] as IsolationRow | undefined;
  if (!row) throw new Error("tenant-isolation check: the catalog query returned no row");

  const ownedPoliciedTables = row.owned ?? [];
  const unprotectedTables = row.unprotected ?? [];
  const alteredPolicies = row.altered ?? [];
  const unexpectedPolicies = row.unexpected ?? [];
  const unprotectableRelations = row.unprotectable ?? [];
  const ownerReadingViews = row.owner_views ?? [];
  const forbiddenGrants = row.forbidden_grants ?? [];
  return {
    ok:
      !row.bypasses &&
      ownedPoliciedTables.length === 0 &&
      unprotectedTables.length === 0 &&
      alteredPolicies.length === 0 &&
      unexpectedPolicies.length === 0 &&
      unprotectableRelations.length === 0 &&
      ownerReadingViews.length === 0 &&
      forbiddenGrants.length === 0,
    role: identity.role,
    bypassesPolicies: row.bypasses,
    ownedPoliciedTables,
    unprotectedTables,
    alteredPolicies,
    unexpectedPolicies,
    unprotectableRelations,
    ownerReadingViews,
    forbiddenGrants,
  };
}

/** Human-readable one-liner naming exactly which half of the boundary is missing. */
export function describeTenantIsolationFailure(result: TenantIsolationResult): string {
  const parts: string[] = [];
  if (result.bypassesPolicies) {
    parts.push(`role "${result.role}" is SUPERUSER or has BYPASSRLS, so every policy is advisory`);
  }
  if (result.ownedPoliciedTables.length > 0) {
    parts.push(
      `role "${result.role}" owns ${result.ownedPoliciedTables.length} policied table(s) and an owner ` +
        `is exempt from its own policies: ${result.ownedPoliciedTables.join(", ")}`
    );
  }
  if (result.unprotectedTables.length > 0) {
    parts.push(
      `${result.unprotectedTables.length} table(s) carry shop_id with no row-level security or no ` +
        `${TENANT_POLICY} policy: ${result.unprotectedTables.join(", ")}`
    );
  }
  if (result.alteredPolicies.length > 0) {
    parts.push(
      `${String(result.alteredPolicies.length)} policy/policies carry a command or a predicate that is ` +
        `not the declared one — a relaxed predicate, a reshaped command, or a policy on a table the ` +
        `declaration does not name: ${result.alteredPolicies.join(", ")}`
    );
  }
  if (result.unexpectedPolicies.length > 0) {
    parts.push(
      `${String(result.unexpectedPolicies.length)} policy/policies exist on a policied table that this ` +
        `design never emits — a PERMISSIVE policy is OR-ed with the declared one, so an added one is a ` +
        `cross-tenant grant with the boundary apparently intact: ${result.unexpectedPolicies.join(", ")}`
    );
  }
  if (result.unprotectableRelations.length > 0) {
    parts.push(
      `${String(result.unprotectableRelations.length)} relation(s) are of a kind that cannot carry ` +
        `row-level security at all: ${result.unprotectableRelations.join(", ")}`
    );
  }
  if (result.ownerReadingViews.length > 0) {
    parts.push(
      `${result.ownerReadingViews.length} view(s) are not security_invoker and would read their base ` +
        `tables as the schema owner: ${result.ownerReadingViews.join(", ")}`
    );
  }
  if (result.forbiddenGrants.length > 0) {
    parts.push(
      `role "${result.role}" holds a privilege on ${String(result.forbiddenGrants.length)} table(s) ` +
        `declared \`appGrant: "none"\` — these carry no tenant column, so no policy stands behind the ` +
        `grant and the grant is the whole mechanism: ${result.forbiddenGrants.join(", ")}`
    );
  }
  return parts.join("; ");
}

/**
 * Boot assertion: fails closed. 019 T24 is non-waivable and any cross-tenant read
 * is a K1, so a process that cannot prove the boundary is in force for its own
 * connection does not get to serve requests and hope.
 *
 * The remedy in the message is `pnpm migrate` rather than a manual `CREATE
 * POLICY`, because the plan is re-derived and re-applied there — by design, so
 * that a table added by a later migration is inside the boundary from the run
 * that created it (`src/db/rowLevelSecurity.ts`).
 */
export async function assertTenantIsolationOrThrow(
  pool: TenantIsolationQueryable,
  logger: RoleSeparationLogger = console
): Promise<void> {
  const result = await checkTenantIsolation(pool);
  if (!result.ok) {
    const detail = describeTenantIsolationFailure(result);
    logger.error(`tenant-isolation check FAILED at boot: ${detail}`);
    throw new Error(
      `refusing to serve: the row-level tenant boundary is not in force on this connection — ` +
        `${detail}. Run \`pnpm migrate\` (which re-derives and re-applies the policy plan) and ` +
        `check that DATABASE_URL names the application role, which owns nothing and has no ` +
        `BYPASSRLS. See 000-docs/056 and migrations/029.`
    );
  }
  logger.info(
    `tenant-isolation check ok: serving as "${result.role}" — every shop-scoped table carries ` +
      `${TENANT_POLICY} (with ${SERVICE_POLICY} where declared), and this role bypasses nothing`
  );
}
