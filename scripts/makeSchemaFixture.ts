// Generate a checked-in fixture of a PRIOR RELEASED SCHEMA, so that upgrading a
// real old database can be tested rather than assumed.
//
// WHY (E02-B10, 000-docs/044 §3). `tests/integration/migrations.test.ts` proves the
// runner applies clean to an EMPTY database. That is the easy half. The half that
// breaks in production is the other one: a database that already holds `003`'s
// schema and `003`'s rows, upgraded to head. Nothing tested that, and 041 §10's
// requirement — "migrations apply clean to an empty DB AND to the previous
// snapshot" — was therefore half-enforced.
//
// The hazard is not hypothetical. `tests/integration/migrations.test.ts` already
// records it: `003`'s trigger loop is DROP-then-CREATE, and `CREATE TRIGGER` always
// lands at the bypassable `tgenabled='O'` default, so re-running any pre-`006`
// migration silently DOWNGRADES the append-only guarantee for the tables it
// touches (E02-D05). A fixture at `003` is exactly the shape that can reproduce
// that during an upgrade, and the upgrade test asserts the trigger set is back at
// `'A'` afterwards.
//
// USAGE (manual; the fixtures are checked in and CI only RESTORES them):
//   pnpm fixture:schema --upto 003 --out tests/fixtures/schema/after-003.sql
//   pnpm fixture:schema --upto 006 --out tests/fixtures/schema/after-006.sql
//
// The seed uses FIXED uuids, never `gen_random_uuid()`, so regenerating a fixture
// produces the same bytes and a diff shows a real schema change rather than noise.
// It touches only columns that exist at `003`, so the same seed is valid at every
// snapshot point.
import "dotenv/config";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { checksum, readMigrations } from "./migrationDiscipline.js";

const execFileAsync = promisify(execFile);

/** Rows every fixture carries: one shop, one session, one row in each session-scoped table. */
export const FIXTURE_SEED = `
-- THE SEED IS SNAPSHOT-AWARE WHERE A CONSTRAINT MADE IT HAVE TO BE, and nowhere
-- else. It is applied to a database migrated to an ARBITRARY point, so a column
-- introduced later cannot be named unconditionally — and two constraints landed
-- after this file was written that a fixed INSERT can no longer satisfy:
--
--   * \`019\` (E03-D09) gives \`shop\` a validated CHECK that it names a legal
--     party (034 §4.3 A4), so from 019 onward a shop row must carry an
--     \`organization_id\`;
--   * \`023\` (E03-B05) requires every new \`cost_log\` row to name a
--     \`spend_owner\` (050 §6.1).
--
-- Both are handled by \`to_regclass\`/\`information_schema\` probes rather than by
-- forking the whole seed per snapshot: one seed, two branches, and the fixed
-- uuids are unchanged so a regenerated fixture still diffs as a schema change
-- rather than as noise.
DO $seed$
BEGIN
  IF to_regclass('public.organization') IS NULL THEN
    INSERT INTO shop (id, name, slug) VALUES
      ('11111111-1111-4111-8111-111111111111', 'Fixture Comics', 'fixture-comics');
  ELSE
    INSERT INTO organization (id, name) VALUES
      ('88888888-8888-4888-8888-888888888881', 'Fixture Comics');
    INSERT INTO shop (id, name, slug, organization_id) VALUES
      ('11111111-1111-4111-8111-111111111111', 'Fixture Comics', 'fixture-comics',
       '88888888-8888-4888-8888-888888888881');
  END IF;
END
$seed$;
-- ⚠ A THIRD SNAPSHOT-AWARE BRANCH (E03-D11, from the invariant review's WARN 2).
--
-- \`031\` DROPS three \`NOT NULL\`s on \`app_session\` and WIDENS its shape CHECK by
-- one disjunct while TIGHTENING the other two — and a \`CHECK\` added by
-- \`ALTER TABLE\` is VALIDATED against every row already there. **Over an empty
-- table that validation is vacuous**, so a snapshot with no sessions in it proves
-- the migration parses and nothing else. The prior-snapshot upgrade test claimed
-- otherwise until this block existed; it is the difference between "the DDL ran"
-- and "the DDL ran against the rows a deployed shop actually has".
--
-- Two sessions, because the tightened disjuncts are one per kind: a DEVICE row
-- (no person, no parent, three columns present) and an OPERATOR row on top of it
-- (a person, a parent, the same three). Both must satisfy \`020\`'s three composite
-- foreign keys as well, which is why the operator row names its parent's
-- \`chain_id\` and not merely its id.
DO $sessions$
BEGIN
  IF to_regclass('public.app_session') IS NULL THEN RETURN; END IF;
  INSERT INTO location (id, shop_id, kind, name) VALUES
    ('99999999-9999-4999-8999-999999999991', '11111111-1111-4111-8111-111111111111',
     'store', 'Fixture counter');
  INSERT INTO app_user (id, email, display_name) VALUES
    ('99999999-9999-4999-8999-999999999992', 'fixture.person@example.invalid', 'Fixture Person');
  INSERT INTO membership (id, app_user_id, shop_id, scope_kind, role) VALUES
    ('99999999-9999-4999-8999-999999999993', '99999999-9999-4999-8999-999999999992',
     '11111111-1111-4111-8111-111111111111', 'shop', 'operator');
  INSERT INTO device (id, shop_id, location_id, label, kind) VALUES
    ('99999999-9999-4999-8999-999999999994', '11111111-1111-4111-8111-111111111111',
     '99999999-9999-4999-8999-999999999991', 'fixture counter phone', 'phone');
  INSERT INTO device_credential (id, shop_id, device_id, token_hash) VALUES
    ('99999999-9999-4999-8999-999999999995', '11111111-1111-4111-8111-111111111111',
     '99999999-9999-4999-8999-999999999994', 'fixture-not-a-real-digest-0000000000');
  INSERT INTO app_session
    (id, chain_id, kind, shop_id, location_id, device_id, device_credential_id,
     token_hash, rotate_after, idle_expires_at, absolute_expires_at)
  VALUES
    ('99999999-9999-4999-8999-999999999996', '99999999-9999-4999-8999-999999999997', 'device',
     '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999991',
     '99999999-9999-4999-8999-999999999994', '99999999-9999-4999-8999-999999999995',
     'fixture-not-a-real-token-000000000001',
     now() + interval '1 day', now() + interval '7 days', now() + interval '30 days');
  INSERT INTO app_session
    (id, chain_id, kind, shop_id, location_id, device_id, device_credential_id,
     app_user_id, parent_session_id, parent_chain_id,
     token_hash, rotate_after, idle_expires_at, absolute_expires_at)
  VALUES
    ('99999999-9999-4999-8999-999999999998', '99999999-9999-4999-8999-999999999999', 'operator',
     '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999991',
     '99999999-9999-4999-8999-999999999994', '99999999-9999-4999-8999-999999999995',
     '99999999-9999-4999-8999-999999999992',
     '99999999-9999-4999-8999-999999999996', '99999999-9999-4999-8999-999999999997',
     'fixture-not-a-real-token-000000000002',
     now() + interval '10 minutes', now() + interval '30 minutes', now() + interval '12 hours');
END
$sessions$;
INSERT INTO shop_pricing_policy (id, shop_id, comp_percent, floor_cents, rounding_rule) VALUES
  ('11111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', 90, 300, 'nearest_99');
INSERT INTO scan_session (id, shop_id, created_by) VALUES
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'fixture-operator');
INSERT INTO scan_photo (id, scan_session_id, shop_id, kind, storage_url) VALUES
  ('33333333-3333-4333-8333-333333333331', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'cover', 'file:///fixture/cover.jpg');
-- Two candidate sets, one per authorship branch, so 007's GENERATED derivation is
-- exercised in BOTH directions by the upgrade test rather than in one.
INSERT INTO candidate_set (id, scan_session_id, shop_id, method, candidates) VALUES
  ('44444444-4444-4444-8444-444444444441', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'barcode', '[]'::jsonb),
  ('44444444-4444-4444-8444-444444444442', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'llm_vision', '[]'::jsonb);
INSERT INTO human_confirmation (id, scan_session_id, shop_id, confirmed_issue, source, confirmed_by) VALUES
  ('55555555-5555-4555-8555-555555555551', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', '{"title":"Fixture","issue":"1"}'::jsonb,
   'one_tap', 'fixture-operator');
INSERT INTO condition_assessment (id, scan_session_id, shop_id, grade_range_low, grade_range_high, defects) VALUES
  ('66666666-6666-4666-8666-666666666661', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'VG', 'FN', ARRAY[]::text[]);
-- From \`023\` the row must name whose money paid (050 §6.1), and \`cost_log\` is
-- append-only — so the value goes in the INSERT rather than in a follow-up
-- UPDATE the \`ENABLE ALWAYS\` trigger would refuse. \`longbox\` is the TRUE
-- answer for a row no per-shop credential version resolved, and this fixture
-- declares none.
DO $seed$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cost_log' AND column_name = 'spend_owner'
  ) THEN
    INSERT INTO cost_log
      (id, shop_id, scan_session_id, provider, model, tokens_in, tokens_out, estimated_usd, spend_owner)
    VALUES ('77777777-7777-4777-8777-777777777771', '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222221', 'anthropic', 'claude-sonnet-5', 100, 20, 0.0012,
            'longbox');
  ELSE
    INSERT INTO cost_log
      (id, shop_id, scan_session_id, provider, model, tokens_in, tokens_out, estimated_usd)
    VALUES ('77777777-7777-4777-8777-777777777771', '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222221', 'anthropic', 'claude-sonnet-5', 100, 20, 0.0012);
  END IF;
END
$seed$;
`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Thrown when this generator is pointed at anything but the local test cluster. */
export class UnsafeFixtureTargetError extends Error {
  constructor(message: string) {
    super(
      `refusing to generate a fixture: ${message}. This script DROPs and CREATEs databases and ` +
        `writes a dump into the repository, so it runs only against the throwaway local test ` +
        `cluster (docker-compose.test.yml).`
    );
    this.name = "UnsafeFixtureTargetError";
  }
}

/** Hosts that can only be this machine. A tunnel is somebody's problem, not this script's. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * **Refuse any target that is not the local test cluster** (E03-D04).
 *
 * The script previously took whatever `TEST_DATABASE_ADMIN_URL` said, dropped
 * databases on it, ran `pg_dump` with no `--schema-only` and no table filter, and
 * wrote the result INSIDE THE REPOSITORY. Pointed at a real database — by an
 * exported variable in a shell, which is the whole way this repository passes
 * connection strings around — that sequence is a destructive operation followed
 * by exfiltration of live rows into a file somebody then commits.
 *
 * Three conditions, all required, each independently sufficient to make the
 * accident impossible:
 *   1. the host is loopback — a production database is not on this machine;
 *   2. the ADMIN user is the local cluster's throwaway superuser (`longbox`),
 *      because a loopback port can be a tunnel to somewhere else;
 *   3. `NODE_ENV` is not `production`.
 */
export function assertLocalTestCluster(adminUrl: string, env: NodeJS.ProcessEnv = process.env): void {
  let parsed: URL;
  try {
    parsed = new URL(adminUrl);
  } catch {
    throw new UnsafeFixtureTargetError("the admin URL is not a URL");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new UnsafeFixtureTargetError(`the host is ${parsed.hostname}, which is not loopback`);
  }
  if (parsed.username !== "longbox") {
    throw new UnsafeFixtureTargetError(
      `the admin user is '${parsed.username}', not the local test cluster's 'longbox'`
    );
  }
  if (env["NODE_ENV"] === "production") {
    throw new UnsafeFixtureTargetError("NODE_ENV is production");
  }
}

/** The tables the synthetic seed writes, named explicitly (E03-D04). */
export const SEEDED_TABLES: readonly string[] = [
  "shop",
  "shop_pricing_policy",
  "scan_session",
  "scan_photo",
  "candidate_set",
  "human_confirmation",
  "condition_assessment",
  "cost_log",
];

async function main(): Promise<void> {
  const upto = arg("upto");
  const out = arg("out");
  if (!upto || !out) {
    throw new Error(
      "usage: tsx scripts/makeSchemaFixture.ts --upto 003 --out tests/fixtures/schema/after-003.sql"
    );
  }
  const adminUrl =
    process.env["TEST_DATABASE_ADMIN_URL"] ?? "postgres://longbox:longbox@127.0.0.1:54329/postgres";
  // BEFORE the first DROP DATABASE, and before anything is dumped (E03-D04).
  assertLocalTestCluster(adminUrl);
  const dbName = `longbox_fixture_gen_${upto}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName} OWNER longbox_migrate`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  url.username = "longbox_migrate";
  url.password = process.env["TEST_LONGBOX_MIGRATE_PASSWORD"] ?? "longbox_migrate";
  const migrateUrl = url.toString();

  const client = new pg.Client({ connectionString: migrateUrl });
  await client.connect();
  try {
    // The ledger, in the shape the runner of THAT release wrote it: the checksum
    // column did not exist before this bead, so the fixture must not have it —
    // otherwise the upgrade test never exercises the `adopt-checksum` path, which
    // is precisely the path every real database will take exactly once.
    await client.query(
      `CREATE TABLE schema_migrations (
         filename text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`
    );
    for (const file of readMigrations()) {
      const n = file.filename.slice(0, 3);
      if (n > upto) continue;
      await client.query(file.sql);
      await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file.filename]);
      console.log(`apply ${file.filename}  (${checksum(file.sql).slice(0, 12)}…)`);
    }
    await client.query(FIXTURE_SEED);
  } finally {
    await client.end();
  }

  // `--schema-only`, and the DATA comes from the synthetic seed above (E03-D04).
  //
  // WHY NOT DUMP THE DATA. A plain `pg_dump` emits every row in every table of
  // whatever database it was pointed at. Here that database is generated moments
  // earlier and holds nothing but `FIXTURE_SEED`, so the two are the same bytes
  // TODAY — and that is the whole problem: the safety of the output depended on
  // the target being the right database, when the target is an environment
  // variable. `--schema-only` makes the dump structurally incapable of carrying a
  // row, and the seed section below is written from the constant in this file, so
  // a fixture can only ever contain rows this repository authored.
  const { stdout } = await execFileAsync(
    "pg_dump",
    [
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      "--no-comments",
      "--quote-all-identifiers",
      migrateUrl,
    ],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  // Drop pg_dump's version banner: it changes with the client and the server and
  // would make every regeneration a diff about nothing.
  const schema = stdout
    .split("\n")
    .filter((l) => !l.startsWith("-- Dumped from") && !l.startsWith("-- Dumped by"))
    .join("\n");

  // The ledger rows the restored database must carry, and the seed — named table
  // by table so a reader can see exactly what a fixture contains without running
  // it. `schema_migrations` deliberately has NO checksum column here (044 §3).
  const applied = readMigrations()
    .filter((f) => f.filename.slice(0, 3) <= upto)
    .map((f) => `  ('${f.filename}')`)
    .join(",\n");
  const body =
    `${schema}\n` +
    `--\n-- Synthetic seed, written from FIXTURE_SEED in scripts/makeSchemaFixture.ts.\n` +
    `-- NOT a dump of anything: the tables it touches are ${SEEDED_TABLES.join(", ")}\n` +
    `-- plus schema_migrations, and every id is fixed so a regeneration is byte-stable.\n--\n` +
    // pg_dump empties the search_path (`set_config('search_path', '', false)`) so
    // its own statements are unambiguous. These are ours, and they are written
    // unqualified for readability, so the path is restored for them explicitly.
    `SET search_path TO "public";\n` +
    `INSERT INTO schema_migrations (filename) VALUES\n${applied};\n` +
    `${FIXTURE_SEED}\n`;

  writeFileSync(
    out,
    `-- GENERATED FIXTURE — do not hand-edit.\n` +
      `-- The schema and seed of intent-longbox at migration ${upto}, dumped with\n` +
      `--   pnpm fixture:schema --upto ${upto} --out ${out}\n` +
      `-- Restored by tests/integration/prior-snapshot-upgrade.test.ts, which then runs\n` +
      `-- \`pnpm migrate\` forward and asserts the append-only trigger set is 'A' and the\n` +
      `-- grant step succeeds (000-docs/044 §3). Regenerate only when THIS release's\n` +
      `-- schema is what changed; a diff here otherwise means a shipped migration was\n` +
      `-- edited, which is the thing the ledger checksum refuses.\n` +
      body
  );
  console.log(`wrote ${out} (${body.length} bytes)`);

  const admin2 = new pg.Client({ connectionString: adminUrl });
  await admin2.connect();
  await admin2.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin2.end();
}

// Only when RUN, never when imported. `tests/schema-fixture-target.test.ts`
// imports `assertLocalTestCluster` to prove the refusals, and a module that
// generated a fixture on import would make that test do the very thing it exists
// to prevent.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
