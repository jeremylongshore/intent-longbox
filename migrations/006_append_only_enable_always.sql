-- 006_append_only_enable_always.sql — E02-D05 (bead longbox-e5b.2.15)
--
-- WHAT: promote every append-only trigger from the default `ENABLE` ('O') to
-- `ENABLE ALWAYS` ('A'). No table, column, row or trigger body changes. Expand-only
-- and re-runnable: `ALTER TABLE ... ENABLE ALWAYS TRIGGER` is idempotent. The loop
-- FAILS LOUD on a table it names that does not exist, rather than skipping it: by
-- 006 all fourteen exist, so an absent one means the declared set and the schema
-- have diverged, and quietly skipping it would leave a table ungoverned with a
-- green migration run.
--
-- WHY. Locked decision 4 (the Hickey append-only model) is enforced in exactly one
-- place in the database: fourteen BEFORE UPDATE OR DELETE triggers calling
-- forbid_mutation(). Postgres creates a trigger at tgenabled='O' — "enabled in
-- ORIGIN and LOCAL session_replication_role" — which means one statement turns the
-- whole guarantee off for the rest of the session. Reproduced on postgres:16 against
-- this schema at 005 (2026-09-04):
--
--   longbox=> SET session_replication_role='replica';
--   SET
--   longbox=> UPDATE corpus_version SET notes='x';
--   UPDATE 1                      <-- the append-only table was mutated
--
-- After ENABLE ALWAYS, the identical session is refused:
--
--   longbox=> ALTER TABLE corpus_version ENABLE ALWAYS TRIGGER corpus_version_append_only;
--   ALTER TABLE
--   longbox=> SET session_replication_role='replica';
--   SET
--   longbox=> UPDATE corpus_version SET notes='z';
--   ERROR:  table corpus_version is append-only (Hickey model): UPDATE not allowed
--   CONTEXT:  PL/pgSQL function forbid_mutation() line 3 at RAISE
--
-- 'A' means "fire in every replication role", so the bypass door closes outright.
-- 041 §9.2 item 1 ranks this the strongest change available in a migration.
--
-- WHAT THIS DOES *NOT* CLOSE. The other bypass door is ownership: the role that owns
-- a table can still `ALTER TABLE ... DISABLE TRIGGER`, and today one DATABASE_URL
-- (`.env.example`) serves both `scripts/migrate.ts` (which creates, and therefore
-- owns, the tables) and `src/config.ts` (which the server reads). A non-owner,
-- non-superuser role can do neither — it cannot set session_replication_role
-- ("permission denied to set parameter") and cannot disable a trigger ("must be
-- owner of table"). Splitting the migration role from the application role is the
-- primary control and is NOT this migration's job: it is a topology decision owned
-- by E03-B04 (RLS needs the same split) and E13-B01 (environment topology).
-- 041 §9.2 item 2. Until that lands, `src/services/appendOnlyDetector.ts` watches
-- the live database at boot and every five minutes and refuses to serve when a
-- declared trigger is missing or not 'A'.
--
-- THE LIST. The table/trigger set below is the same set declared in
-- `src/db/appendOnlyTables.ts`, which is the source of truth read by the CI
-- gate-test and the runtime detector. SQL cannot import TypeScript, so the list is
-- restated here; `tests/integration/migrations.test.ts` asserts equality in both
-- directions against pg_trigger and fails the moment the two drift.
--
-- ORDERING. 041 §10 step 0 ships this alone and ahead of the envelope, supersession
-- and purge migrations: it is independent of all of them, it changes no shape, and
-- leaving it queued behind them leaves locked decision 4 bypassable for longer than
-- necessary.

BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- 001_init.sql
    'candidate_set','condition_assessment','corpus_version','cost_log',
    'human_confirmation','llm_rerank','pricing_snapshot','scan_photo','shopify_draft',
    -- 003_reserve_principle_slots.sql
    'media_deletion','retention_policy','retention_hold','retention_hold_release',
    -- 005_listing_status_observation.sql
    'listing_status_observation'
  ] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION 'append-only set names a table that does not exist: %', t;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

-- Fail the migration rather than the runtime if anything is still bypassable.
-- SCOPE, stated precisely: this raises if any `%_append_only` trigger PRESENT IN THE
-- SCHEMA is left at anything but 'A'. It matches on the name pattern, not on the
-- declared list, so it cannot tell that a future migration added a trigger without
-- registering it in src/db/appendOnlyTables.ts — that cross-check in both directions
-- is the gate-test's job (tests/integration/migrations.test.ts) and the runtime
-- detector's `undeclared` class. Pattern-matching here is deliberately the wider
-- net: it catches a trigger this loop does not name.
DO $$
DECLARE bad text;
BEGIN
  -- tgenabled is "char", not text: concatenating it needs an explicit cast or
  -- Postgres cannot choose an operator ("operator is not unique: text || char").
  SELECT string_agg(c.relname || '.' || tg.tgname || '=' || tg.tgenabled::text, ', ')
    INTO bad
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT tg.tgisinternal
     AND n.nspname = 'public'
     AND tg.tgname LIKE '%\_append\_only'
     AND tg.tgenabled <> 'A';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'append-only triggers not ENABLE ALWAYS after 006: %', bad;
  END IF;
END $$;

COMMIT;
