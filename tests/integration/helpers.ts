// Integration-lane helpers: probe Postgres, provision throwaway databases,
// and run the real migration runner (scripts/migrate.ts) against them.
//
// The lane is gated by INTEGRATION=1 (pnpm test:integration) and skips cleanly
// when no Postgres is reachable: `docker compose -f docker-compose.test.yml up -d`
// locally, or the postgres service container in CI.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const execFileAsync = promisify(execFile);

/** Admin (maintenance) connection URL; database name is replaced per test file. */
export const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://longbox:longbox@127.0.0.1:54329/postgres";

/**
 * True when the lane should run: INTEGRATION=1 AND a Postgres answers on the
 * admin URL. Locally any other state logs why and lets suites skip. In CI
 * (CI=true, as GitHub Actions sets) an unreachable database throws instead,
 * so a broken service container can never produce a green job with 0 tests.
 */
export async function probeDb(): Promise<boolean> {
  if (process.env.INTEGRATION !== "1") {
    console.warn("[integration] skipping: INTEGRATION=1 not set (use pnpm test:integration)");
    return false;
  }
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3_000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch (err) {
    const where = ADMIN_URL.replace(/\/\/.*@/, "//***@");
    await client.end().catch(() => undefined);
    if (process.env.CI) {
      throw new Error(
        `[integration] CI=true but no Postgres reachable at ${where} (${(err as Error).message}); ` +
          `refusing to skip the lane in CI`,
        { cause: err }
      );
    }
    console.warn(
      `[integration] skipping: no Postgres reachable at ${where} ` +
        `(${(err as Error).message}). Start one: docker compose -f docker-compose.test.yml up -d`
    );
    return false;
  }
}

/**
 * The two non-admin roles the lane uses (E02-D06). Provisioned by
 * `docker/postgres-init/00-roles.sql` — mounted by docker-compose.test.yml
 * locally, piped through psql by CI. Passwords are throwaway, never secrets.
 */
export const MIGRATE_ROLE = process.env.TEST_MIGRATE_ROLE ?? "longbox_migrate";
export const APP_ROLE = process.env.TEST_APP_ROLE ?? "longbox_app";

/** Rewrite a connection URL to authenticate as `role` (password === role name). */
function asRole(databaseUrl: string, role: string): string {
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = process.env[`TEST_${role.toUpperCase()}_PASSWORD`] ?? role;
  return url.toString();
}

/**
 * Drop-and-recreate a throwaway database; returns the MIGRATE-role URL.
 *
 * The database is owned by `longbox_migrate` so the migration runner has CREATE
 * on its `public` schema (PG15+ grants CREATE there to the database owner only)
 * and so the tables it creates are owned by the migrate role rather than by the
 * cluster superuser. Existing suites keep using the returned URL for both
 * migrations and their pool; the ones that need the least-privileged connection
 * ask for it explicitly with `appUrl()`.
 */
export async function createFreshDb(name: string): Promise<string> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe test database name: ${name}`);
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name} OWNER ${MIGRATE_ROLE}`);
  } finally {
    await admin.end();
  }
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return asRole(url.toString(), MIGRATE_ROLE);
}

/** The same database as `dbUrl`, connected as the least-privileged app role. */
export function appUrl(dbUrl: string): string {
  return asRole(dbUrl, APP_ROLE);
}

/**
 * The same database as `dbUrl`, connected as the cluster SUPERUSER.
 *
 * Needed by exactly one class of test: the `session_replication_role='replica'`
 * bypass probes. After E02-D06 neither the app role nor the migrate role can set
 * that parameter — which is the control working — so a test that wants to prove
 * `ENABLE ALWAYS` still refuses the UPDATE *in* replica role has to escalate to
 * the one principal who can get there. That makes the assertion stronger than it
 * was, not weaker: it is now proved against the strongest attacker in the
 * cluster rather than against the role the server happens to use.
 */
export function superuserUrl(dbUrl: string): string {
  const admin = new URL(ADMIN_URL);
  const url = new URL(dbUrl);
  url.username = admin.username;
  url.password = admin.password;
  return url.toString();
}

/**
 * Run the real migration runner (scripts/migrate.ts) against a database.
 *
 * Passes the URL as MIGRATE_DATABASE_URL — the variable the runner now reads —
 * and blanks DATABASE_URL so a stray value in the developer's shell cannot make
 * this silently migrate the wrong database.
 */
export async function runMigrations(databaseUrl: string): Promise<string> {
  const { stdout } = await execFileAsync("pnpm", ["exec", "tsx", "scripts/migrate.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, MIGRATE_DATABASE_URL: databaseUrl, DATABASE_URL: "" },
  });
  return stdout;
}

/**
 * Restore a checked-in prior-schema fixture into `databaseUrl` (000-docs/044 §3).
 *
 * `psql` rather than `client.query(dump)` because a `pg_dump` script contains
 * backslash meta-commands (`\restrict`, `\connect`) that the wire protocol does not
 * understand. `psql` is already a CI dependency — the same job pipes
 * `docker/postgres-init/00-roles.sql` through it.
 */
export async function restoreFixture(databaseUrl: string, fixturePath: string): Promise<void> {
  await execFileAsync("psql", [databaseUrl, "-q", "-v", "ON_ERROR_STOP=1", "-f", fixturePath], {
    cwd: process.cwd(),
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Insert an organization + shop + default pricing policy; returns the shop id.
 *
 * The `organization` row is not optional and is not scenery: `migrations/019`
 * gives `shop` a validated `CHECK (organization_id IS NOT NULL)`, which is 034
 * §4.3 (A4)'s "no committed state has a shop with no legal party" expressed
 * without a `SET NOT NULL` (a contracting statement under 000-docs/044 §2). A
 * consent row, a charter reference or a processor term filed against a BRAND
 * points at the wrong party from the day it is written, and under append-only
 * rules it is exactly the row that cannot be re-pointed.
 */
export async function seedShop(
  db: pg.Pool,
  opts: { name?: string; slug?: string; compPercent?: number; floorCents?: number } = {}
): Promise<string> {
  const org = await db.query(`INSERT INTO organization (name) VALUES ($1) RETURNING id`, [
    opts.name ?? "Test Shop",
  ]);
  const res = await db.query(
    `INSERT INTO shop (name, slug, organization_id) VALUES ($1, $2, $3) RETURNING id`,
    [opts.name ?? "Test Shop", opts.slug ?? `test-shop-${Date.now()}`, (org.rows[0] as { id: string }).id]
  );
  const shopId = (res.rows[0] as { id: string }).id;
  await db.query(
    `INSERT INTO shop_pricing_policy (shop_id, comp_percent, floor_cents, rounding_rule)
     VALUES ($1, $2, $3, 'nearest_99')`,
    [shopId, opts.compPercent ?? 90, opts.floorCents ?? 300]
  );
  return shopId;
}
