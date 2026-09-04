-- The `longbox` development database — LOCAL ONLY (E02-B10).
--
-- WHY IT EXISTS. `.env.example` documents `DATABASE_URL` and
-- `MIGRATE_DATABASE_URL` pointing at a database called `longbox`, and until this
-- file the compose stack created only `postgres`. So the documented URL named a
-- port nothing listened on (5432 rather than 54329) and a database that did not
-- exist, and `pnpm migrate` against a fresh checkout failed twice over. That drift
-- was recorded on bead longbox-e5b.2.10 by the E02-D01 build and is closed here.
--
-- OWNER longbox_migrate, deliberately. From PG15 a fresh database grants CREATE on
-- its `public` schema to the OWNER only, so the migration role must own the
-- database to create the schema in it — the same reason `tests/integration/helpers.ts`
-- creates every throwaway database `OWNER longbox_migrate`.
--
-- NOT APPLIED IN CI, and that is the difference from `00-roles.sql`. The
-- integration lane creates a throwaway database per test file and never touches
-- this one; CI pipes only `00-roles.sql` through psql because roles are the part it
-- needs. Docker runs both, in filename order, on first start.

-- `CREATE DATABASE` cannot run inside a transaction block or a `DO` body, and
-- Postgres has no `CREATE DATABASE IF NOT EXISTS`. psql's `\gexec` is the
-- idiomatic guard: the SELECT yields the command text only when the database is
-- absent, and `\gexec` executes whatever the query returned — nothing, on a
-- re-run. Written to be re-runnable for the same reason `00-roles.sql` is.
SELECT 'CREATE DATABASE longbox OWNER longbox_migrate'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'longbox') \gexec
