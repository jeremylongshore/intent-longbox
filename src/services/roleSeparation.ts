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
