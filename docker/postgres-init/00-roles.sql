-- The two database roles (E02-D06, 041 §9.2 item 2), for LOCAL and CI only.
--
-- `longbox_migrate` owns the schema: `pnpm migrate` connects as it, so it owns
-- every table it creates and may therefore ALTER TABLE … DISABLE TRIGGER.
-- `longbox_app` is what the server connects as: it owns nothing, is not a
-- superuser, and holds only the DML grants that `scripts/grant-app-role.ts`
-- derives from the declared lists. 041 §1 E15 reproduces that this combination
-- is exactly what makes `SET session_replication_role` and `DISABLE TRIGGER`
-- unavailable to the application.
--
-- THE PASSWORDS HERE ARE NOT SECRETS AND MUST NEVER BECOME ONE. This file
-- provisions a throwaway Postgres bound to 127.0.0.1 for the test lane and the
-- same two roles in CI's service container. Production roles are provisioned by
-- the deploy contract with passwords held in SOPS; nothing in this repository
-- ever carries a real credential value (CLAUDE.md § Secrets).
--
-- Read by two callers, deliberately the same file so they cannot drift:
--   * docker-compose.test.yml mounts it into /docker-entrypoint-initdb.d
--   * .github/workflows/ci.yml pipes it through psql before the lane runs
-- Written to be re-runnable: the service container is already initialised when
-- CI reaches it, so every statement is guarded.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'longbox_migrate') THEN
    CREATE ROLE longbox_migrate LOGIN PASSWORD 'longbox_migrate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'longbox_app') THEN
    CREATE ROLE longbox_app LOGIN PASSWORD 'longbox_app';
  END IF;
END
$$;

-- The test helper creates each throwaway database with OWNER longbox_migrate, so
-- the migration runner has CREATE on that database's `public` schema without any
-- role needing CREATEDB. `longbox` (the container superuser) keeps CREATE/DROP
-- DATABASE; it is the admin connection only, never an application connection.
ALTER ROLE longbox_migrate NOSUPERUSER NOCREATEROLE;
ALTER ROLE longbox_app NOSUPERUSER NOCREATEROLE NOCREATEDB;

-- A fresh database's `public` schema grants CREATE to nobody but the owner in
-- PG15+, and PUBLIC keeps USAGE. `longbox_app` gets its real privileges from the
-- grant step; nothing is granted here beyond the ability to connect.
