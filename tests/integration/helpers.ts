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

/** Drop-and-recreate a throwaway database; returns its connection URL. */
export async function createFreshDb(name: string): Promise<string> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`unsafe test database name: ${name}`);
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

/** Run the real migration runner (scripts/migrate.ts) against a database. */
export async function runMigrations(databaseUrl: string): Promise<string> {
  const { stdout } = await execFileAsync("pnpm", ["exec", "tsx", "scripts/migrate.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  return stdout;
}

/** Insert a shop + default pricing policy; returns the shop id. */
export async function seedShop(
  db: pg.Pool,
  opts: { name?: string; slug?: string; compPercent?: number; floorCents?: number } = {}
): Promise<string> {
  const res = await db.query(`INSERT INTO shop (name, slug) VALUES ($1, $2) RETURNING id`, [
    opts.name ?? "Test Shop",
    opts.slug ?? `test-shop-${Date.now()}`,
  ]);
  const shopId = (res.rows[0] as { id: string }).id;
  await db.query(
    `INSERT INTO shop_pricing_policy (shop_id, comp_percent, floor_cents, rounding_rule)
     VALUES ($1, $2, $3, 'nearest_99')`,
    [shopId, opts.compPercent ?? 90, opts.floorCents ?? 300]
  );
  return shopId;
}
