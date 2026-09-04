-- 013_supersession_forward_ordering.sql — E02-D09 (bead longbox-e5b.2.19)
--
-- 041 §10 row 3, the half `008` left open: **R4 — a successor is recorded AFTER
-- its predecessor** — plus the `_current` views re-created on §5's canonical
-- order, which is the same row's second clause. Docs: 041 §3.1 (the rule), §3.2
-- (R4), §3.3 (the single writer), §3.4 (the view contract), §5.3 (`session_seq`
-- is commit order), invariants I3/I4(c)/I7; 000-docs/044 §5, §6; 019 T24.
--
-- WHAT `008` LEFT OPEN, IN ITS OWN WORDS. `008`'s header says it: "R4 … needs a
-- `BEFORE INSERT` trigger and a writer that assigns `session_seq` on the
-- superseding path … the supersession WRITER is E02-B07's, and R4 lands with it.
-- Until then a cycle longer than one row is prevented by R2 plus the self-CHECK
-- below only for the two-row case's first edge, and 041 I4(c) stays open."
-- The writer landed as `src/services/supersession.ts` in this same PR; this file
-- is R4.
--
-- THE DEFECT THIS CLOSES, PRECISELY (041 §1 E17). Two rows that supersede each
-- other satisfy R2 (each is superseded exactly once), satisfy `008`'s composite
-- FK (same shop, same session) and satisfy the self-CHECK (neither names itself).
-- The session is then left with **zero** current confirmations, and the state is
-- UNRECOVERABLE: the append-only trigger forbids repair and R2 forbids a third
-- row from superseding either. 041 §3.4 says a `_current` view "may legitimately
-- return zero rows — meaning nothing was ever written — and it must never return
-- zero rows for any other reason". A cycle is the other reason. R4 is what makes
-- that sentence true, because **a cycle requires at least one edge pointing
-- backwards** and this trigger refuses exactly that edge.
--
-- WHY A TRIGGER HERE WHEN `008` ARGUED FOR A CONSTRAINT. `008` chose a composite
-- FK for R1 and gave three reasons, the first being that a constraint has no
-- `tgenabled` and so cannot be switched off. All three still hold and none of
-- them is available here: R4 compares a value on the row being inserted against a
-- value on a DIFFERENT row, which no CHECK constraint may do (a CHECK sees one
-- row) and no foreign key can express (an FK tests membership, not an ordering).
-- A `BEFORE INSERT` trigger is the only mechanism in Postgres for a cross-row
-- assertion at write time, so the choice is between this trigger and no
-- enforcement. It is therefore created `ENABLE ALWAYS` — the same posture `006`
-- put the append-only set in, for the same reason (041 §1 E14: `CREATE TRIGGER`
-- lands at the bypassable `'O'` default, where `SET session_replication_role =
-- 'replica'` silently skips it).
--
-- IT IS NOT ON THE APPEND-ONLY DECLARED LIST, AND THAT IS DELIBERATE. 041 §9.2's
-- list and its detector are about `%_append_only` triggers — the enforcement of
-- locked decision 4. This trigger is named `%_supersession_forward` precisely so
-- the gate-test's both-directions equality over `%\_append\_only` neither claims
-- it nor trips on it. Its own liveness is asserted by
-- `tests/integration/supersession-forward-ordering.test.ts`, which disables it as
-- the table owner, reproduces the backward edge, and re-enables it — 029 §5 move
-- 8's "prove the gate can fail" applied to this trigger.
--
-- THE RULE, IN FIVE CLAUSES (and every skip below is a deliberate deferral to a
-- mechanism that already owns the case, never a hole):
--   1. `supersedes_id IS NULL` → nothing to order. A first row supersedes nothing.
--   2. `NEW.session_seq IS NULL` → REFUSED. This is the database half of 041
--      §3.3's single writer: `supersede()` assigns `session_seq` under the anchor
--      lock before it inserts, so a superseding row without one did not come
--      through the writer. Stating it here is what stops R4 from being an
--      assertion the writer makes about itself.
--   3. The predecessor is looked up **by `id` alone**, and a miss — no such row,
--      or a row in another shop or another session — RETURNS without raising, so
--      the composite FK from `008` produces the error. R1 is the FK's rule and
--      this trigger must not pre-empt its message: 041 §3.2 makes the FK
--      MANDATORY for R1 exactly because it cannot be disabled, and a trigger that
--      answered first would put a non-waivable T24 boundary's error text behind
--      a bypassable mechanism. The trigger STATES R1 (the lookup is scoped in the
--      comparison below) and DEFERS its enforcement, on purpose.
--   4. The predecessor's `session_seq IS NULL` → allowed. A row with no
--      `session_seq` predates `007`, and 041 §10.1 is explicit that the column is
--      "never backfilled because a reconstructed sequence would be a fabricated
--      observation about the order things happened in". Comparing against a
--      fabricated ordinal, or against `created_at` instead, would import the very
--      clock rule 041 §5.3 rejected. A correction to a legacy row is forward by
--      construction: every row written since `007` carries a counter and every row
--      that does not predates it.
--   5. Otherwise `NEW.session_seq > prior.session_seq`, strictly. Equality is
--      refused as well as inversion — two rows in one session never share a
--      counter (`007`'s `UNIQUE (scan_session_id, session_seq)`), so an equal pair
--      is a bug in the caller, not a tie.
--
-- THE VIEWS (041 §3.4, second consequential decision). The three `_current` views
-- ordered by `created_at DESC, id DESC` (`003:112`, `:118`, `:124`, re-stated at
-- `004:103`). `id` is `gen_random_uuid()`, so `id DESC` is "a stable coin flip,
-- not a tie-break with meaning" — and this bead is the one that makes the views
-- LOAD-BEARING, because `supersede()`'s predecessor is read from
-- `human_confirmation_current` / `condition_assessment_current`. A writer that
-- picks its predecessor by coin flip would fork the chain at the first tie. So the
-- views are re-created on §5's canonical order — `session_seq DESC NULLS LAST`,
-- then `created_at DESC, id DESC` as the declared fallback for pre-`007` rows.
-- `NULLS LAST` on a DESC ordering is not the default and is load-bearing: a legacy
-- row must sort BELOW every counted row, or the newest row would be the oldest.
--
-- `CREATE OR REPLACE VIEW` also refreshes the frozen column lists. `003` and `004`
-- expanded `c.*` at creation time, so the views do not carry the envelope columns
-- `007` added (`authored_by`, `session_seq`, `actor_role`, …) — a read model that
-- disagrees with its table, which `004:95-101` names as the hazard and fixed once
-- for `outcome`. Replacing them here appends the missing columns; that is legal
-- because every one was ADDED to the end of its table, never inserted.
--
-- SHAPE: EXPAND ONLY. One function, three triggers, three view replacements. It
-- edits no shipped migration, adds no UPDATE path, creates no column, and is
-- re-runnable by hand (`CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS` then
-- `CREATE`). No `-- contract:` header: nothing here is a contracting statement
-- (`scripts/migrationDiscipline.ts` matches DROP TABLE / DROP COLUMN / ALTER
-- COLUMN TYPE / SET NOT NULL, and this file contains none of them), and 044 §2's
-- lint refuses a header on a file that has no contracting statement to retire.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The trigger function. One function for all three tables: the rule is about
--    the envelope (`supersedes_id`, `session_seq`, `shop_id`, `scan_session_id`),
--    which is identical on each, and `TG_TABLE_NAME` supplies the rest. Three
--    copies of one rule is three places for it to drift — the exact failure 041
--    §9.2 records for the append-only trigger set, which was spelled four times
--    and had already disagreed with itself.
--
--    `format(%I)` on `TG_TABLE_NAME`, not string concatenation: the name comes
--    from the catalog rather than from input, and quoting it anyway costs nothing
--    and keeps the habit intact.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_backward_supersession() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  prior_seq     bigint;
  prior_shop    uuid;
  prior_session uuid;
BEGIN
  -- Clause 1.
  IF NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Clause 2 — the database half of 041 §3.3's single writer.
  IF NEW.session_seq IS NULL THEN
    RAISE EXCEPTION
      'supersession_forward: a row superseding %.% must carry session_seq (041 §3.3, §5.3): '
      'assign it with assignSessionSeq under the scan_session anchor lock, which is what '
      'src/services/supersession.ts supersede() does. A superseding row with no counter did not '
      'come through the single writer.',
      TG_TABLE_NAME, NEW.supersedes_id;
  END IF;

  EXECUTE format(
    'SELECT session_seq, shop_id, scan_session_id FROM %I WHERE id = $1', TG_TABLE_NAME)
    INTO prior_seq, prior_shop, prior_session
    USING NEW.supersedes_id;

  -- Clause 3 — R1 belongs to `008`'s composite FK; do not pre-empt its error.
  --
  -- ⚠ THE MISS IS DETECTED FROM THE VARIABLE, NOT FROM `FOUND`, and that is not a
  -- style choice: **`EXECUTE` does not set `FOUND`** (PL/pgSQL: "EXECUTE changes
  -- the output of GET DIAGNOSTICS, but does not change FOUND"). Writing
  -- `IF NOT FOUND` here reads correctly, compiles, and is WRONG — `FOUND` is false
  -- on entry to the trigger, so the function returns early and R4 never runs. That
  -- was this file's first version and it passed a hand test that only proved the
  -- unique index still worked. `shop_id` is `NOT NULL` on all three tables, so a
  -- NULL here means exactly one thing: no such row.
  IF prior_shop IS NULL THEN
    RETURN NEW;
  END IF;
  IF prior_shop IS DISTINCT FROM NEW.shop_id OR prior_session IS DISTINCT FROM NEW.scan_session_id THEN
    RETURN NEW;
  END IF;

  -- Clause 4 — a pre-`007` predecessor has no comparable ordinal.
  IF prior_seq IS NULL THEN
    RETURN NEW;
  END IF;

  -- Clause 5.
  IF NEW.session_seq <= prior_seq THEN
    RAISE EXCEPTION
      'supersession_forward: %.% would supersede a row recorded LATER or at the same point '
      '(session_seq % is not greater than the predecessor''s %). 041 §3.2 R4: a correction chain '
      'runs forward, and a cycle requires at least one backward edge — which is why refusing this '
      'insert is what stops a session reaching zero current rows (041 §3.4, E17).',
      TG_TABLE_NAME, NEW.supersedes_id, NEW.session_seq, prior_seq;
  END IF;

  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Attach it, ENABLE ALWAYS, to the three tables that carry `supersedes_id`.
--    Same guarded, idempotent loop shape as `003:237-248` and `008`: the table
--    list is asserted to exist first, so a rename turns into a failed migration
--    rather than a silently unattached trigger.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['human_confirmation','condition_assessment','pricing_snapshot'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION 'supersession set names a table that does not exist: %', t;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_supersession_forward', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION forbid_backward_supersession()',
      t || '_supersession_forward', t);
    -- `CREATE TRIGGER` lands at `tgenabled='O'`, where `session_replication_role
    -- = 'replica'` skips it (041 §1 E14). Same posture as `006`.
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_supersession_forward');
  END LOOP;
END $$;

-- Fail the migration rather than the runtime if any of the three is bypassable.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(c.relname || '.' || tg.tgname || '=' || tg.tgenabled::text, ', ')
    INTO bad
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT tg.tgisinternal
     AND n.nspname = 'public'
     AND tg.tgname LIKE '%\_supersession\_forward'
     AND tg.tgenabled <> 'A';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'supersession triggers not ENABLE ALWAYS after 013: %', bad;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The `_current` views, on 041 §5's canonical order.
--    Unchanged semantics: newest row per session that nothing supersedes. What
--    changes is WHICH row "newest" names when a session has more than one
--    unsuperseded row — now the highest `session_seq`, with `(created_at, id)`
--    kept as the declared fallback for pre-`007` rows only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW condition_assessment_current AS
SELECT DISTINCT ON (c.scan_session_id) c.*
FROM condition_assessment c
WHERE NOT EXISTS (SELECT 1 FROM condition_assessment s WHERE s.supersedes_id = c.id)
ORDER BY c.scan_session_id, c.session_seq DESC NULLS LAST, c.created_at DESC, c.id DESC;

CREATE OR REPLACE VIEW pricing_snapshot_current AS
SELECT DISTINCT ON (p.scan_session_id) p.*
FROM pricing_snapshot p
WHERE NOT EXISTS (SELECT 1 FROM pricing_snapshot s WHERE s.supersedes_id = p.id)
ORDER BY p.scan_session_id, p.session_seq DESC NULLS LAST, p.created_at DESC, p.id DESC;

CREATE OR REPLACE VIEW human_confirmation_current AS
SELECT DISTINCT ON (h.scan_session_id) h.*
FROM human_confirmation h
WHERE NOT EXISTS (SELECT 1 FROM human_confirmation s WHERE s.supersedes_id = h.id)
ORDER BY h.scan_session_id, h.session_seq DESC NULLS LAST, h.created_at DESC, h.id DESC;

COMMIT;
