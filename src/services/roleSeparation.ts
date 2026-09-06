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
import {
  INSERT_ONLY_TABLE_NAMES,
  NO_APP_GRANT_TABLE_NAMES,
  READ_APPEND_TABLE_NAMES,
} from "../db/appRoleGrants.js";
import {
  POLICIED_WITHOUT_SHOP_ID,
  RLS_EXEMPT_TABLE_NAMES,
  SERVICE_POLICY,
  SERVICE_TABLES,
  SERVICE_WRITE_POLICY,
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
   * Tables this design declares EXEMPT that nevertheless carry row-level security
   * or a policy — the security lens's F3 on 000-docs/062.
   *
   * The mirror of `unprotectedTables`, and its remedy is the opposite one: DROP
   * the policy, do not add one. It exists because 062 §4's strongest argument —
   * that a filter over `user_authenticator` would turn a misconfiguration into a
   * refusal indistinguishable from a replay, since 048 R19 makes the affected-row
   * count the authorization — rested entirely on nobody having written such a
   * policy. An argument about harm that nothing enforces is a comment.
   */
  policiedExemptions: string[];
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
   * A privilege FUNCTION rather than a `role_table_grants` read, deliberately:
   * the question is not "was a GRANT statement issued" but "can this role, by any
   * path — a direct grant, PUBLIC, or a role it is a member of — touch the table",
   * and only the privilege function answers that one.
   *
   * ⚠ **AND IT IS `has_any_column_privilege`, NOT `has_table_privilege`**
   * (E03-D21's re-verification). The table-level function is blind to a COLUMN
   * grant: `GRANT UPDATE (email, display_name, status) ON app_user TO
   * longbox_app` left it answering FALSE while a tenant-context UPDATE returned
   * `UPDATE 1`. A column grant is a grant, and the column function subsumes the
   * table-level answer, so all three classes ask it for `SELECT`, `INSERT` and
   * `UPDATE`. **`DELETE` keeps `has_table_privilege`** because PostgreSQL has no
   * column-level DELETE at all — there, the table-level function is the complete
   * answer rather than a partial one.
   */
  forbiddenGrants: string[];
}

interface IsolationRow {
  bypasses: boolean;
  owned: string[] | null;
  unprotected: string[] | null;
  policied_exemptions: string[] | null;
  owner_views: string[] | null;
  unprotectable: string[] | null;
  forbidden_grants: string[] | null;
}

/** One policy as `pg_policies` reports it, before any comparison (E03-D21). */
interface LivePolicyRow {
  tablename: string;
  policyname: string;
  cmd: string;
  qual: string;
  with_check: string;
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
  )
  SELECT
    COALESCE((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypasses,
    (SELECT array_agg(p.relname::text ORDER BY p.relname) FROM policied p
      WHERE pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = p.oid), 'MEMBER')) AS owned,
    -- A policied table with RLS off, or with no tenant policy at all.
    (SELECT array_agg(p.relname::text ORDER BY p.relname) FROM policied p
      JOIN pg_class c ON c.oid = p.oid
      WHERE NOT c.relrowsecurity
         OR NOT EXISTS (SELECT 1 FROM pg_policies l
                         WHERE l.schemaname = 'public'
                           AND l.tablename = p.relname AND l.policyname = $2)) AS unprotected,
    -- E03-D21 (security lens F3): A DECLARED EXEMPTION THAT IS NOT ONE.
    --
    -- 000-docs/062 §4 keeps five person-scoped tables outside the boundary, and
    -- its strongest argument is that a policy over user_authenticator would be
    -- HARMFUL: 048 R19 makes the affected-row count of its replay guard the
    -- authorization, so a filter turns a misconfiguration into a refusal
    -- indistinguishable from a replay. That argument rested on nobody having
    -- written such a policy. This branch is what turns it into enforcement: a
    -- table this design declares exempt must have row-level security OFF and no
    -- policy of any kind. Reported as its own array because the remedy is the
    -- opposite of every other one here -- DROP the policy, do not add one.
    (SELECT array_agg(t ORDER BY t) FROM unnest($3::text[]) AS t
      WHERE to_regclass('public.' || quote_ident(t)) IS NOT NULL
        AND (
              (SELECT c.relrowsecurity FROM pg_class c
                WHERE c.oid = to_regclass('public.' || quote_ident(t)))
              OR EXISTS (SELECT 1 FROM pg_policies p
                          WHERE p.schemaname = 'public' AND p.tablename = t)
            )) AS policied_exemptions,
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
    --
    -- ⚠ has_any_column_privilege AND NOT has_table_privilege, IN ALL THREE
    -- BLOCKS BELOW — E03-D21's re-verification, and it closed a real hole rather
    -- than tightening a nicety. has_table_privilege answers about the TABLE-LEVEL
    -- grant alone, so after a COLUMN-level UPDATE grant on the person table —
    -- three of its columns named, the table itself never mentioned —
    -- it answered FALSE, this check passed, and a tenant-context UPDATE returned
    -- UPDATE 1. **A column grant is a grant.** has_any_column_privilege SUBSUMES
    -- the table-level answer — true when the privilege is held on the table OR on
    -- any column of it — so widening the function closes the hole with no second
    -- question to keep in step. It applies to all three classes, because none is
    -- safer against a column grant than the others: an insert-only table's SELECT
    -- and a no-grant table's INSERT are as reachable one column at a time as an
    -- UPDATE is.
    --
    -- DELETE KEEPS has_table_privilege, AND THAT IS NOT AN OVERSIGHT: PostgreSQL
    -- has no column-level DELETE — the column privileges are SELECT, INSERT,
    -- UPDATE and REFERENCES — so has_any_column_privilege REJECTS the word
    -- outright ("unrecognized privilege type"). For DELETE the table-level
    -- function is the COMPLETE answer rather than a partial one, which is why
    -- the two functions sit side by side here instead of one being preferred.
    --
    -- ⚠ BOTH HALVES ARE COALESCEd TO AN EMPTY ARRAY BEFORE THE ||, AND THAT
    -- IS LOAD-BEARING (E03-D17): array_agg over zero rows returns NULL, and in
    -- Postgres NULL || anything is NULL — so a concatenation without the two
    -- COALESCEs would report NO findings the moment EITHER half was clean, which
    -- is a check that goes quietly green rather than red. The same failure shape
    -- 058 F2 exists to prevent, arriving through an operator.
    COALESCE(
      (SELECT array_agg(t ORDER BY t) FROM unnest($4::text[]) AS t
        WHERE to_regclass('public.' || quote_ident(t)) IS NOT NULL
          AND (has_any_column_privilege(current_user, quote_ident(t), 'SELECT')
            OR has_any_column_privilege(current_user, quote_ident(t), 'INSERT')
            OR has_any_column_privilege(current_user, quote_ident(t), 'UPDATE')
            OR has_table_privilege(current_user, quote_ident(t), 'DELETE'))),
      '{}'::text[])
      ||
    -- E03-D17, the security lens's F2 (= the gate audit's F2). THE SAME SHAPE,
    -- ONE PRIVILEGE CLASS OVER, and it is here because 060 §3.4 claimed
    -- "enforced twice" while the runtime half did not exist.
    --
    -- appGrant: "insert-only" gives the app role INSERT and withholds SELECT,
    -- because a process that can read its own access log can shape what an audit
    -- sees before the audit runs. The lens reproduced the gap: GRANT SELECT ON
    -- identity_access TO longbox_app was accepted, BOTH boot assertions passed,
    -- and the application read its own access log — because the check above takes
    -- the no-grant list ALONE. A grant plan is re-applied on every pnpm migrate
    -- and a hand-run GRANT between two runs is exactly the drift 058 F2 added
    -- that check for.
    --
    -- INSERT is deliberately ABSENT from the three asked here: it is the one
    -- privilege this class is supposed to hold, so asking about it would fail the
    -- boot on a correct grant. to_regclass guards the pending case for the same
    -- reason it does above.
    COALESCE(
      (SELECT array_agg(t ORDER BY t) FROM unnest($5::text[]) AS t
        WHERE to_regclass('public.' || quote_ident(t)) IS NOT NULL
          AND (has_any_column_privilege(current_user, quote_ident(t), 'SELECT')
            OR has_any_column_privilege(current_user, quote_ident(t), 'UPDATE')
            OR has_table_privilege(current_user, quote_ident(t), 'DELETE'))),
      '{}'::text[])
      ||
    -- E03-D21, the security lens's F1. THE SAME SHAPE, ONE PRIVILEGE CLASS OVER
    -- AGAIN, and here because 000-docs/062 claimed "the running server can admit
    -- a person and can never rename, suspend or deactivate one" while the
    -- application role held table-level DML on app_user.
    --
    -- appGrant: "read-append" gives SELECT and INSERT and withholds UPDATE and
    -- DELETE, because tenant_isolation on that table is FOR ALL and the rows it
    -- admits are co-workers -- so a table-level UPDATE was a one-statement rewrite
    -- of any of them, login identifier included, on a person who may be shared
    -- with another shop. The POLICY cannot narrow that (the row is one this shop
    -- legitimately sees); only the grant can, which is what makes the grant the
    -- whole control and this check its runtime half.
    --
    -- SELECT and INSERT are deliberately ABSENT from the two asked: they are the
    -- privileges this class is supposed to hold.
    COALESCE(
      (SELECT array_agg(t ORDER BY t) FROM unnest($6::text[]) AS t
        WHERE to_regclass('public.' || quote_ident(t)) IS NOT NULL
          AND (has_any_column_privilege(current_user, quote_ident(t), 'UPDATE')
            OR has_table_privilege(current_user, quote_ident(t), 'DELETE'))),
      '{}'::text[])
      AS forbidden_grants
`;

/**
 * Every policy that exists on a table this database policies, RAW.
 *
 * ⚠ **RAW IS THE WHOLE POINT, AND IT REPLACES A SECOND NORMALISER** (E03-D21;
 * security lens F2 = consistency lens K3). Until this bead the comparison was
 * done IN SQL against a predicate the query itself normalised, and
 * `normalisePredicate()` did the same job again in TypeScript for the declared
 * side. Two hand-rolled string-strippers cannot be kept in step — E03-D21's first
 * attempt proved it in the direction of a FALSE POSITIVE (they disagreed about
 * newlines, and a correct policy refused a port) — and the cannon proved it in
 * the direction that matters: **both stripped parentheses**, so a predicate
 * relaxed only by removing the grouping around this bead's own `effective_until`
 * disjunction normalised to the declared string CHARACTER FOR CHARACTER, booted
 * green, and returned every person in the estate to any shop holding one
 * time-bounded grant.
 *
 * So there is now ONE comparison, in ONE language, over `policyTokens()`. This
 * query fetches; it does not judge.
 */
const LIVE_POLICIES_SQL = `
  SELECT p.tablename, p.policyname, p.cmd::text AS cmd,
         COALESCE(p.qual, '') AS qual, COALESCE(p.with_check, '') AS with_check
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = ANY ($1::text[])
   ORDER BY p.tablename, p.policyname
`;

/**
 * A predicate as a DEPTH-ANNOTATED TOKEN SEQUENCE — the one comparison, in one
 * language (E03-D21; security lens F2 = consistency lens K3).
 *
 * ⚠ **WHAT THIS REPLACES, AND WHY THE REPLACEMENT IS NOT A REFINEMENT.** Until
 * this bead there were TWO normalisers — this one in TypeScript, and four
 * `replace()` calls inside `ISOLATION_SQL` — and BOTH of them **deleted
 * parentheses**. Deleting a parenthesis deletes operator precedence, and the
 * cannon reproduced what that costs on this bead's own policy: removing only the
 * grouping around
 *
 *     AND (m.effective_until IS NULL OR m.effective_until > now())
 *
 * turns a conjunction into `… AND m.effective_until IS NULL OR m.effective_until
 * > now()`, which Postgres reads as `(… AND … IS NULL) OR (… > now())` — a policy
 * that returns **every person in the estate** to any shop holding one
 * time-bounded grant. Both string-strippers normalised the relaxed text to the
 * declared text **character for character**, so the boot assertion passed and the
 * boundary was gone. *A comparison that erases operator precedence is not a
 * boundary check.*
 *
 * **The fix is to keep the parentheses and make them count.** Each token is
 * tagged with the parenthesis DEPTH it sits at, so two predicates match only when
 * every token appears at the same nesting level in the same order. Whitespace is
 * still irrelevant (Postgres wraps a long predicate across lines, which is the
 * false POSITIVE this file hit first), `::text` casts are still dropped (the
 * deparser adds them and the declaration does not), and the COUNT of parentheses
 * is deliberately not compared — only the depth each token sits at — so a
 * redundant pair the deparser adds around a whole expression does not fail a boot.
 *
 * **The declared side goes through the same function**, which is the property
 * that makes this sound: there is no second rule to keep in step. The smallest
 * sound repair the consistency lens asked for — comparing both sides as
 * Postgres's own deparser renders them, by round-tripping the declaration through
 * the database — is STRONGER still and is FILED rather than built here
 * (000-docs/062 §8 A3, PROPOSED alias **E03-D32**): it needs a round trip at boot
 * on a connection that may not hold `CREATE POLICY`, which is a decision about
 * the boot path rather than an edit to this function.
 */
export function policyTokens(expr: string): string {
  const out: string[] = [];
  let depth = 0;
  let token = "";
  const flush = (): void => {
    if (token.length > 0) {
      out.push(`${String(depth)}:${token}`);
      token = "";
    }
  };
  const cleaned = expr.replace(/::text/g, "");
  for (const ch of cleaned) {
    if (ch === "(") {
      flush();
      depth += 1;
    } else if (ch === ")") {
      flush();
      depth -= 1;
    } else if (/\s/.test(ch)) {
      flush();
    } else {
      token += ch;
    }
  }
  flush();
  return out.join(" ");
}

/** One policy this design emits, as the catalog will report it back. */
export interface ExpectedPolicy {
  readonly table: string;
  readonly policy: string;
  /** `pg_policies.cmd`: `ALL`, `SELECT`, `INSERT`. */
  readonly cmd: string;
  /** `qual` as a depth-annotated token sequence; `''` when the policy has none (an INSERT-only policy). */
  readonly using: string;
  /** `with_check` as a depth-annotated token sequence; `''` when the policy has none (a SELECT-only policy). */
  readonly check: string;
}

/**
 * EVERY policy this design emits, for every policied table — the tenant policy on
 * each, the scope-scoped read on the declared ones, and the INSERT-only write on
 * the FOUR that have one (`app_user` joined them at E03-D21).
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
    const tenant = policyTokens(tenantPredicate(table));
    expected.push({ table, policy: TENANT_POLICY, cmd: "ALL", using: tenant, check: tenant });
  }
  for (const table of SERVICE_TABLES) {
    if (!policiedTables.includes(table.table)) continue;
    expected.push({
      table: table.table,
      policy: SERVICE_POLICY,
      cmd: "SELECT",
      using: policyTokens(serviceReadPredicate(table)),
      check: "",
    });
    if (table.write !== undefined) {
      expected.push({
        table: table.table,
        policy: SERVICE_WRITE_POLICY,
        cmd: "INSERT",
        using: "",
        check: policyTokens(serviceWritePredicate(table)),
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
  const overrides = [...POLICIED_WITHOUT_SHOP_ID];
  const policiedRows = (await pool.query(POLICIED_TABLES_SQL, [overrides])).rows as Array<{
    name: string;
  }>;
  const policied = policiedRows.map((r) => r.name);
  const expected = expectedPolicies(policied);
  const row = (
    await pool.query(ISOLATION_SQL, [
      overrides,
      TENANT_POLICY,
      // E03-D21 (security F3): the declared exemptions, asked whether they are
      // exempt IN THE DATABASE and not merely on a row in a TypeScript list.
      [...RLS_EXEMPT_TABLE_NAMES],
      [...NO_APP_GRANT_TABLE_NAMES],
      // E03-D17 (security F2): the insert-only class, asked about SELECT, UPDATE
      // and DELETE — never INSERT, which is the privilege the class holds.
      [...INSERT_ONLY_TABLE_NAMES],
      // E03-D21 (security F1): the read-append class, asked about UPDATE and
      // DELETE — never SELECT or INSERT, which are the privileges it holds.
      [...READ_APPEND_TABLE_NAMES],
    ])
  ).rows[0] as IsolationRow | undefined;
  if (!row) throw new Error("tenant-isolation check: the catalog query returned no row");

  // ⚠ **THE POLICY COMPARISON HAPPENS HERE, IN ONE LANGUAGE, OVER ONE FUNCTION**
  // (E03-D21; security F2 = consistency K3). It used to happen in SQL against a
  // predicate the query normalised itself, with `normalisePredicate()` doing the
  // same job again for the declared side — and BOTH stripped parentheses, so a
  // policy relaxed by removing one pair of them compared EQUAL to the declared
  // text and booted green. `policyTokens()` is now the only rule, and both sides
  // go through it.
  const live = (await pool.query(LIVE_POLICIES_SQL, [policied])).rows as LivePolicyRow[];
  const emitted = [TENANT_POLICY, SERVICE_POLICY, SERVICE_WRITE_POLICY];
  const label = (l: LivePolicyRow): string => `${l.tablename}:${l.policyname} ${l.cmd}`;
  const alteredPolicies = live
    .filter((l) => emitted.includes(l.policyname))
    .filter(
      (l) =>
        !expected.some(
          (e) =>
            e.table === l.tablename &&
            e.policy === l.policyname &&
            e.cmd === l.cmd &&
            e.using === policyTokens(l.qual) &&
            e.check === policyTokens(l.with_check)
        )
    )
    .map(label);
  const unexpectedPolicies = live.filter((l) => !emitted.includes(l.policyname)).map(label);

  const ownedPoliciedTables = row.owned ?? [];
  const unprotectedTables = row.unprotected ?? [];
  const policiedExemptions = row.policied_exemptions ?? [];
  const unprotectableRelations = row.unprotectable ?? [];
  const ownerReadingViews = row.owner_views ?? [];
  const forbiddenGrants = row.forbidden_grants ?? [];
  return {
    ok:
      !row.bypasses &&
      ownedPoliciedTables.length === 0 &&
      unprotectedTables.length === 0 &&
      policiedExemptions.length === 0 &&
      alteredPolicies.length === 0 &&
      unexpectedPolicies.length === 0 &&
      unprotectableRelations.length === 0 &&
      ownerReadingViews.length === 0 &&
      forbiddenGrants.length === 0,
    role: identity.role,
    bypassesPolicies: row.bypasses,
    ownedPoliciedTables,
    unprotectedTables,
    policiedExemptions,
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
  if (result.policiedExemptions.length > 0) {
    parts.push(
      `${String(result.policiedExemptions.length)} table(s) are DECLARED EXEMPT and carry row-level ` +
        `security or a policy anyway — the boundary is claimed in one place and applied in another, ` +
        `and on \`user_authenticator\` a row filter would turn a misconfiguration into a refusal ` +
        `indistinguishable from a replay (048 R19, 000-docs/062 §4): ${result.policiedExemptions.join(", ")}`
    );
  }
  if (result.alteredPolicies.length > 0) {
    parts.push(
      `${String(result.alteredPolicies.length)} policy/policies carry a command or a predicate that is ` +
        `not the declared one — a relaxed predicate, a reshaped command, or a policy on a table the ` +
        `declaration does not name. The comparison is over a DEPTH-ANNOTATED TOKEN SEQUENCE, so a ` +
        `predicate that differs only in where its parentheses fall is a MISMATCH rather than a match ` +
        `(E03-D21): ${result.alteredPolicies.join(", ")}`
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
      `role "${result.role}" holds a privilege the design withholds on ` +
        `${String(result.forbiddenGrants.length)} table(s): a table declared \`appGrant: "none"\` ` +
        `(no tenant column, so no policy stands behind the grant and the grant is the whole ` +
        `mechanism), or a READ, UPDATE or DELETE on a table declared \`appGrant: "insert-only"\` ` +
        `(E03-D17 — a process that can read its own access log can shape what an audit sees before ` +
        `the audit runs), or an UPDATE or DELETE on a table declared \`appGrant: "read-append"\` ` +
        `(E03-D21 — \`app_user\` is policied FOR ALL over rows this shop legitimately sees, so a ` +
        `table-level UPDATE was a one-statement rewrite of a co-worker's login email): ` +
        `${result.forbiddenGrants.join(", ")}`
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
