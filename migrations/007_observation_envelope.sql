-- 007_observation_envelope.sql — E02-B10 (bead longbox-e5b.2.10)
--
-- 041 §10 row 2, the half this bead owns: `authored_by` on all fourteen
-- append-only tables, and `session_seq` on the eight of them that are
-- session-scoped. Docs: 041 §2.1 (the envelope), §2.3 (`authored_by`), §5.3
-- (`session_seq`), §10.1 (the per-table backfill derivation), 000-docs/044 §5.
--
-- WHAT IS NOT HERE, AND WHY. 041 §10 row 2 also lists `observed_at`,
-- `definition_version`, `against_table`/`against_id` and the `operator_id` FK.
-- Those are held back deliberately: `operator_id`'s FK target (`app_user`) does
-- not exist until 034 §4.1's tenancy migration (E03), `observed_at` and
-- `definition_version` change what WRITERS must supply and belong with the
-- writers E02-B08 moves, and `against_*` is a wire-contract column whose route
-- half is E02-B08's. Adding a column with no writer is cheap; adding one whose
-- semantics a later bead will re-decide is not. This file adds the two that are
-- fully decided and whose values are derivable TODAY.
--
-- SHAPE: EXPAND ONLY. No shipped migration is edited. Every statement is
-- `IF NOT EXISTS` or `DROP-then-ADD`, so a hand re-run is a no-op. **There is no
-- UPDATE statement in this file at all** — the DEFAULT is what reaches existing
-- rows, because `ADD COLUMN … NOT NULL DEFAULT` fills them during the rewrite. An
-- earlier draft backfilled with a guarded `UPDATE`; the DEFAULT replaced it, and
-- the DEFAULT is strictly better because it also governs the NEXT row.
--
-- ⚠ `authored_by` IS NOT NULL WITH A PER-TABLE DEFAULT, NOT A BACKFILL GUESS.
-- 041 §10.1 (A10, Q1 answered YES) requires the derivation to be stated per table
-- in the migration comment, and requires that a table whose value is not derivable
-- take NULL rather than a guess. Worked through there, all fourteen are either
-- derivable from a single writing path or empty, so no NULL is needed — and the
-- derivation is expressed as the column's DEFAULT rather than as a one-off UPDATE,
-- which makes it apply to the next row as well as to every existing one.
--
-- ONE table takes a GENERATED column instead: `candidate_set`, whose derivation is
-- over `method`, a column whose domain is CLOSED by the CHECK at `001:89`. There a
-- generated column IS the derivation and cannot drift from it. `media_deletion`'s
-- rule reads `reason_code`, which `003:75` makes deliberately OPEN-WORLD, so a
-- generated column there would decide authorship for every reason code that does
-- not exist yet and would make `'provider'` unrepresentable on that table forever —
-- the guess 041 §10.1 refuses. It takes a DEFAULT like the other twelve.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. `authored_by` — who produced the row's CONTENT (041 §2.3).
--
--    Distinct from `operator_id`/`actor_role`, which name who CAUSED the row.
--    An operator presses identify and `resolution` writes a `candidate_set`;
--    nobody would call the operator its author. Collapsing the two forces a false
--    answer on every machine-authored table.
--
--    The domain is closed by CHECK on every table: {human, system, provider}.
--    The DEFAULT on each table IS 041 §10.1's derivation for that table.
-- ---------------------------------------------------------------------------

-- 1a. THIRTEEN tables whose authorship is a constant, because each has exactly one
--     writing path. The DEFAULT states the derivation; existing rows take it via
--     the ADD COLUMN rewrite, which is what makes NOT NULL safe on a populated
--     table without a separate UPDATE.
--
--     ⚠ THE DEFAULT'S FORWARD CONSEQUENCE, stated because it is not obvious: a
--     future writer that OMITS `authored_by` is silently authored by the default
--     rather than refused. That is the price of not breaking the existing writers,
--     and it is bounded — `condition_assessment` and `human_confirmation` carry the
--     `= 'human'` CHECK in §2, so the one class of wrong answer that matters (a
--     machine authoring a human act) is refused whether the writer names the column
--     or not.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- table                        authored_by  derivation (041 §10.1)
    ('corpus_version',              'system'),  -- no rows; no code references it (029 §1)
    ('scan_photo',                  'human'),   -- sole writer addScanPhoto from routes:149; a person took the photograph
    ('llm_rerank',                  'provider'),-- sole writer runIdentify's re-rank step; the content is the provider's
    ('human_confirmation',          'human'),   -- sole writer POST …/confirm (routes:247), human-driven by construction
    ('condition_assessment',        'human'),   -- sole writer POST …/condition (routes:280); 037 §1.1 makes any other value a defect
    ('pricing_snapshot',            'system'),  -- written by priceWithProviders: the comps are the provider's, the snapshot is Longbox's computation
    ('shopify_draft',               'system'),  -- sole writer POST …/draft (routes:408)
    ('cost_log',                    'system'),  -- written by costLog; a meter reading
    ('retention_policy',            'system'),  -- both writers are a migration (003:261) and register-shop.ts:70; no person authored a default
    ('listing_status_observation',  'system'),  -- no rows; no poller or webhook exists (005:131-134), and 040 F1 means a Longbox act is never a source here
    -- The two 041 §10.1 leaves as "—" because they are EMPTY. The record permits
    -- NULL there and asks for a stated derivation instead of a guess; the stated
    -- derivation is structural rather than historical: `retention_hold.placed_by`
    -- and `retention_hold_release.released_by` are free-text ACTOR columns
    -- (003:§5/§6) and 022 P7's hold is a person's act. There is no machine path to
    -- either table in any ratified record. Stated here so a reader can argue with it.
    ('retention_hold',              'human'),
    ('retention_hold_release',      'human'),
    -- `media_deletion` — 041 §10.1 states the rule conditionally (`reason_code =
    -- 'retention_sweep'` → 'system', else 'human') and the table is EMPTY, so the
    -- rule is a statement about future writers, not a backfill. It takes a DEFAULT
    -- like the other twelve rather than a GENERATED column, and the reason is that
    -- a generated column would DECIDE authorship for every `reason_code` that does
    -- not exist yet and would make `'provider'` unrepresentable on this table
    -- forever — precisely the guess 041 §10.1 refuses. `reason_code` is
    -- deliberately open-world text (003:75); an expression over an open domain is
    -- a closed answer to an open question.
    --
    -- The constant is `'system'` because the only writer any ratified record
    -- specifies is E13-B01's retention sweep, whose `reason_code` IS
    -- `'retention_sweep'`. A person-requested deletion arrives through a route that
    -- states its actor anyway (022 P7), so that path passes `authored_by` and the
    -- default never applies to it.
    ('media_deletion',              'system')
  ) AS v(tbl, author) LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS authored_by text NOT NULL DEFAULT %L',
                   r.tbl, r.author);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', r.tbl, r.tbl || '_authored_by_check');
    EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I
                       CHECK (authored_by IN ('human','system','provider'))$f$,
                   r.tbl, r.tbl || '_authored_by_check');
  END LOOP;
END $$;

-- 1b. `candidate_set` — the one COLUMN-derivation rather than a path-derivation,
--     and it is exact: the CHECK at 001:89 closes `method`'s domain to four values.
--     A GENERATED column is the derivation, not a copy of it: it cannot drift from
--     `method`, it needs no writer, and it needs no CHECK because the expression's
--     range is already {system, provider}.
--
--     NOT NULL, and no CHECK: the expression's range is exactly {system, provider}
--     and it can never yield NULL, because `method` is itself `NOT NULL`. A
--     generated column is defensible here and only here, because that domain is
--     CLOSED — which is why `media_deletion` above takes a DEFAULT instead.
ALTER TABLE candidate_set ADD COLUMN IF NOT EXISTS authored_by text
  GENERATED ALWAYS AS (CASE WHEN method = 'barcode' THEN 'system' ELSE 'provider' END) STORED NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. A human act is a HUMAN act, in the database (041 §2.3, invariant I2).
--
--    037 §1.1: a condition value not authored by a person in front of the book is
--    an estimate, and "an estimate that reaches any of those surfaces is a defect,
--    not a feature." 040 F4 forbids a machine-driven condition. 019 T7 signs
--    numeric grades at 0, NON-WAIVABLE. 022 P1: "a person confirms every identity."
--    Today all four are enforced by the ABSENCE of a code path — a statement about
--    the code as it stands, re-checkable only by grep. After this constraint a
--    machine-authored condition or confirmation is refused by Postgres.
-- ---------------------------------------------------------------------------
ALTER TABLE condition_assessment DROP CONSTRAINT IF EXISTS condition_assessment_is_a_human_act;
ALTER TABLE condition_assessment ADD CONSTRAINT condition_assessment_is_a_human_act
  CHECK (authored_by = 'human');

ALTER TABLE human_confirmation DROP CONSTRAINT IF EXISTS human_confirmation_is_a_human_act;
ALTER TABLE human_confirmation ADD CONSTRAINT human_confirmation_is_a_human_act
  CHECK (authored_by = 'human');

-- ---------------------------------------------------------------------------
-- 3. `session_seq` — the per-session commit counter (041 §5.3, decision (c)).
--
--    The canonical order of two rows about one session. Assigned inside the request
--    transaction under the `scan_session` row lock `lockScanSession` already takes
--    (041 §4.2), so it costs no additional lock — which is why (c) is affordable
--    here and would not be in a system without a request transaction.
--
--    NULLABLE AND NEVER BACKFILLED (041 §5.3's stated limit, 034 §4.4's rule). A
--    legacy row, or a row written by any path that bypasses the helper, has none;
--    a reconstructed sequence would be a fabricated observation about what order
--    things happened in. Where either row lacks one the order degrades to
--    `(created_at, id)` — in which `id` is a stable arbitrary tie-break and NOT a
--    clock — and every use of the fallback is counted (invariant I6).
--
--    ⚠ `session_seq` IS COMMIT ORDER, NOT ACT ORDER (041 §5.3, A4). For the
--    offline queue a park recorded at 10:02 and replayed at 10:47 receives the
--    sequence of 10:47. A dispute between two replayed writes is resolved by
--    `against_table`/`against_id`, never by `session_seq` alone.
--
--    The set below is exactly the append-only tables that carry `scan_session_id`
--    (041 I1: "for shop-scoped, session-scoped tables"). It is declared in
--    `src/db/appendOnlyTables.ts` as the `sessionSeq` flag on each row, and
--    `tests/integration/migrations.test.ts` asserts the two agree in both
--    directions — SQL cannot import TypeScript, so the list is restated here and
--    the drift is a red build rather than a silent hole (the same bounded
--    duplication `006` documents).
--
--    THE UNIQUE INDEX IS PER TABLE, AND THE COUNTER IS PER SESSION ACROSS TABLES.
--    Postgres has no cross-table unique constraint, so `UNIQUE (scan_session_id,
--    session_seq)` catches an intra-table race only. What makes the counter correct
--    ACROSS the eight tables is the anchor lock: every assignment happens under
--    `SELECT … FROM scan_session … FOR UPDATE`, so two assignments for one session
--    cannot interleave. The index is the loud failure if that ever stops being true.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'scan_photo','candidate_set','llm_rerank','human_confirmation',
    'condition_assessment','pricing_snapshot','shopify_draft','cost_log'
  ] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION 'session_seq set names a table that does not exist: %', t;
    END IF;
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS session_seq bigint', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_session_seq_positive');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (session_seq IS NULL OR session_seq > 0)',
                   t, t || '_session_seq_positive');
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (scan_session_id, session_seq)',
      t || '_session_seq_idx', t);
  END LOOP;
END $$;

COMMIT;
