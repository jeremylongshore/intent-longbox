-- 034_scan_session_composite_tenant_keys.sql — E03-D19 (bead longbox-e5b.3.29)
--
-- Every child of `scan_session` is keyed on `(id, shop_id)`, so a foreign-key
-- check cannot bind a row to another shop's anchor. Docs: 056 §11 R7 and §6.3;
-- 016 C46; 041 §3.2 amendment A2 (the composite-FK idiom, and why a constraint
-- rather than a trigger); 042 §5.3(b) and I22 (the lock order this does not
-- move); 040 §3 (the anchor a transition is issued against); 000-docs/044 §2
-- (expand-only), §3 (prior-snapshot upgrade) and §4 (a DROP CONSTRAINT widens).
--
-- ⚠ **NUMBERED 034, AND THE ONLY REMAINING GAP IS 027.** `027` was reserved by
-- E03-B06 and never written (`030`'s header records it). `031` was E03-D11's and
-- was in flight on its own branch when this file was cut, which is why this one
-- took `034`: the rule `030` states from the other side is that a number moves
-- freely BEFORE a merge and never after one, so the branch that has not shipped
-- yields the number rather than racing for it. **`031` then merged FIRST**, and
-- nothing here needed renumbering — the runner applies unseen files in sorted
-- order and nothing in it, in the lint or in the checksum reads contiguity, so
-- the transient gap closed itself. The one cost was real and is recorded because
-- the next author will pay it too: `tests/fixtures/schema/after-033.sql` had to
-- be RE-CUT after that merge, because `031` sorts before `033` and a fixture cut
-- without it describes a schema nobody ships.
--
-- ============================================================================
-- THE DEFECT, IN 056 §11 R7's OWN WORDS
-- ============================================================================
--
--   > "A foreign key is checked with RLS OFF, so a policy on the CHILD says
--   >  nothing about which tenant the PARENT belongs to."
--
-- 016 C46 is the execution that establishes it: as `longbox_app` under shop B's
-- transaction-local context, on `postgres:16`,
--
--   (i)   INSERT INTO candidate_set (scan_session_id, shop_id, …)
--           VALUES (<shop A's session>, <shop B>, …)         -> INSERT 0 1
--   (ii)  the same with a `scan_session_id` that exists nowhere
--                                                            -> 23503
--   (iii) the same with `shop_id` set to A
--                                                            -> RLS refusal
--
-- (i) succeeds because the row's own `shop_id` is B, so `tenant_isolation`'s
-- `WITH CHECK` is satisfied, while the foreign key resolves A's session — a
-- foreign-key check does not see the policy. 056 R7 states the consequence
-- plainly: **"the boundary prevents READING across tenants and does not prevent
-- WRITING across them by reference."** (i) against (ii) is additionally an
-- existence oracle over a value the caller must already possess.
--
-- Nothing in the pilot flow does this — `lockScanSession` carries `shop_id`, and
-- a session id arrives from a URL the same session created — so it is a gap in
-- the mechanism rather than a live defect, and until now the instrument covering
-- it was DETECTION: `pnpm audit:cross-tenant` finds exactly the shape (i)
-- produces. 056 R7's closing sentence is the one this file answers: *"Detection
-- is not prevention, and this record does not pretend otherwise."*
--
-- ============================================================================
-- WHAT THIS FILE DOES
-- ============================================================================
--
-- 1. `scan_session` gains a unique index over `(id, shop_id)`. `id` is already
--    the primary key, so this adds no new uniqueness — it adds the target a
--    composite foreign key requires, which is the whole cost of the change
--    (041 §3.2, and `008` did the same thing for the supersession triple).
--
-- 2. Each of the TEN children re-points at that pair:
--
--      FOREIGN KEY (scan_session_id, shop_id) REFERENCES scan_session (id, shop_id)
--
--    scan_photo · candidate_set · llm_rerank · human_confirmation ·
--    condition_assessment · pricing_snapshot · shopify_draft · cost_log ·
--    scan_session_transition · outbox
--
--    The list is enumerated from the catalog rather than trusted: the loop below
--    REFUSES to run if the ten it names are not exactly the tables that hold a
--    single-column foreign key into `scan_session`. A table added later with the
--    old shape fails this migration on a fresh database rather than slipping
--    past it, which is `crossTenantAudit.ts`'s reason for deriving its edges the
--    same way.
--
--    Three of the ten — `condition_assessment`, `human_confirmation` and
--    `pricing_snapshot` — already carry `UNIQUE (id, shop_id, scan_session_id)`
--    from `008`, which constrains their SUPERSESSION edge. That is a different
--    edge: it says a successor sits in the same shop and session as the row it
--    supersedes, and says nothing about which shop the session belongs to. All
--    ten need this one.
--
-- 3. `MATCH SIMPLE` (the default) is correct and is not an oversight. `shop_id`
--    is `NOT NULL` on all ten; `scan_session_id` is nullable on exactly two —
--    `cost_log` (a cost incurred outside a session) and `outbox` (an effect owed
--    for something other than a scan). Under MATCH SIMPLE a NULL in either
--    column satisfies the constraint vacuously, so those two rows behave exactly
--    as they do today. MATCH FULL would have made "not attached to a session"
--    unrepresentable, which is a data-model change wearing a constraint keyword.
--
-- 4. The superseded single-column foreign key is dropped, by SHAPE rather than
--    by name — see the DROP-CONSTRAINT note below.
--
-- ============================================================================
-- WHY A `DROP CONSTRAINT` IS EXPAND, AND WHY IT IS IN THIS FILE
-- ============================================================================
--
-- 000-docs/044 §2 lists four contracting shapes — DROP TABLE, DROP COLUMN,
-- ALTER COLUMN … TYPE, SET NOT NULL — and §4 rules on this one by name:
--
--   > "to undo a *constraint*, ship a new migration that drops it (a
--   >  `DROP CONSTRAINT` is not on §2's contracting list precisely because it
--   >  widens rather than narrows)."
--
-- So the lint permits it, and `008` already ships `DROP CONSTRAINT IF EXISTS` in
-- an expand migration as half of the DROP-then-ADD idiom `003` established. Two
-- further reasons it is safe to drop the old edge in the SAME file:
--
--   * The composite constraint SUBSUMES the single-column one. `shop_id` is
--     `NOT NULL` on all ten children, so any row satisfying
--     `(scan_session_id, shop_id) -> (id, shop_id)` satisfies
--     `scan_session_id -> id`. Nothing a running deploy relies on is removed;
--     the only writes that stop working are the cross-tenant ones this file
--     exists to stop.
--   * The ADD and the DROP are in ONE transaction, in that order, so there is no
--     instant at which the column is unconstrained.
--
-- It is dropped BY SHAPE — every single-column foreign key from the child into
-- `scan_session`, whatever it is called — rather than by the auto-generated name
-- `<table>_scan_session_id_fkey`. The auto-name is what every database in
-- existence today carries, and a rule keyed on it would silently skip a database
-- where the constraint had been named by hand.
--
-- No index is added on the child side. A foreign key requires an index only on
-- the REFERENCED side; the child-side scan is paid on DELETE of a parent, and
-- nothing deletes a `scan_session` (041's append-only posture, and there is no
-- delete path).
--
-- ============================================================================
-- LOCK PROFILE, STATED — AND WHAT E03-D20 OWNS
-- ============================================================================
--
-- Per statement, as PostgreSQL documents it:
--
--   CREATE UNIQUE INDEX (not CONCURRENTLY)  SHARE on scan_session — reads
--                                           continue, writes wait
--   ADD CONSTRAINT … NOT VALID              SHARE ROW EXCLUSIVE on the child and
--                                           on scan_session; NO table scan
--   VALIDATE CONSTRAINT                     SHARE UPDATE EXCLUSIVE on the child
--                                           (writes continue) plus ROW SHARE on
--                                           scan_session; one scan of the child
--   DROP CONSTRAINT                         ACCESS EXCLUSIVE on both
--
-- ⚠ **The two-step ADD NOT VALID / VALIDATE buys nothing INSIDE one transaction,
-- and it is written that way on purpose.** Every lock above is held until
-- `COMMIT`, so the child's validating scan runs under the strongest lock the
-- file takes. What the split does here is STATE the profile in the file, in the
-- shape a zero-downtime deploy needs — and it is deliberately not turned into a
-- deploy rule here, because that rule is a standard-level decision this file
-- does not get to make. **E03-D20 (`longbox-e5b.3.30`) owns it**: it amends 044
-- with the deploy-order rule and with the `CONCURRENTLY` rule for any index on a
-- table that may hold live shop rows, which is the same reason the unique index
-- above is a plain `CREATE UNIQUE INDEX`. 034 §3.4 puts the first live shop row
-- behind G3, so at the moment this file lands there is no such table.
--
-- ⚠ **`VALIDATE CONSTRAINT` is what refuses an already-broken database, and that
-- is the intended behaviour.** If a cluster already holds a row whose `shop_id`
-- disagrees with its session's, this migration fails and applies nothing. That
-- occurrence is a K1 under 034 §3.4 and `pnpm audit:cross-tenant` already names
-- the edge; the answer is the K1 procedure, never a constraint left `NOT VALID`
-- so that the deploy can proceed.
--
-- ============================================================================
-- WHAT THIS DOES NOT CLOSE
-- ============================================================================
--
-- The ANCHOR edge only. A child of `scan_session` may still hold a SIBLING
-- reference on a single-column foreign key. There are SEVEN into a
-- session-scoped parent, derived from `pg_constraint` rather than by reading —
-- `llm_rerank.candidate_set_id`, `media_deletion.scan_photo_id`,
-- `shopify_draft.outbox_id`, `cost_log.outbox_id`, `outbox_attempt.outbox_id`,
-- `listing_status_observation.shopify_draft_id` and
-- `identity_resolution.human_confirmation_id` — and 056 R7's mechanism applies
-- to every one of them unchanged. (The three `*_supersedes_*` self-edges are
-- NOT among them: `008` gave each a composite companion over
-- `(supersedes_id, shop_id, scan_session_id)`.) Those edges stay covered by DETECTION: the
-- audit enumerates them from the catalog and counts a disagreement. 056 gains a
-- residual row for that remainder — **R11**, owned by **E03-D27**
-- (`longbox-e5b.3.37`) — rather than this file implying it is gone.
--
-- SHAPE: EXPAND ONLY. Adds one index and ten constraints, drops the ten the new
-- ones subsume, edits no shipped migration, adds no UPDATE path, re-runnable by
-- hand (DROP-then-ADD throughout).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The target the composite foreign key needs.
--
--    A UNIQUE INDEX rather than a UNIQUE CONSTRAINT, following `008`: a foreign
--    key's target must be covered by a unique index, and an index is what
--    `IF NOT EXISTS` makes re-runnable by hand.
--
--    It also widens `scan_session`'s KEY attribute set from `{id}` to
--    `{id, shop_id}`, which changes the tuple lock an UPDATE of `shop_id` would
--    take. There are no UPDATEs: `scan_session` is append-only, which is why
--    `010` exists at all (a state change is a `scan_session_transition` row).
--    ⚠ **The anchor lock is `FOR UPDATE`, which ALREADY conflicts with the
--    foreign key's implicit `FOR KEY SHARE` on the parent — before this file and
--    after it.** 042 §5.3(b) and I22 say `SELECT … FROM scan_session … FOR
--    UPDATE`, and `lockScanSession` (`src/services/scanSession.ts`) is that
--    statement; `FOR NO KEY UPDATE` is `app_session`'s lock, one position
--    earlier in the same order, and naming it here would have been the wrong
--    row's lock. So a child INSERT WAITS on a held anchor, and it waited
--    identically at `033`. Reproduced on `postgres:16`, 2026-09-05, holding the
--    anchor in one connection and inserting a `scan_photo` in another under a
--    4-second `statement_timeout` BY HAND (the lane case that pins this uses
--    3 seconds; both numbers are just longer than a round trip and shorter
--    than the holder's transaction, and neither is a measurement of anything)
--    — both databases answer
--    `canceling statement due to statement timeout` with
--    `CONTEXT: while locking tuple (0,1) in relation "scan_session"`, and the
--    ONLY textual difference is the foreign key's own lookup predicate
--    (`WHERE id = $1` at `033`, `WHERE id = $1 AND shop_id = $2` at head) —
--    which is exactly what this file changes and exactly not the lock. Neither
--    I22's fixed order nor the wait moves.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS scan_session_scope_key ON scan_session (id, shop_id);

DO $$
DECLARE
  t        text;
  expected text[] := ARRAY['candidate_set','condition_assessment','cost_log','human_confirmation',
                           'llm_rerank','outbox','pricing_snapshot','scan_photo',
                           'scan_session_transition','shopify_draft'];
  observed text[];
  old_name text;
BEGIN
  -- -------------------------------------------------------------------------
  -- 2. The list is CHECKED against the catalog, not trusted.
  --
  --    A child added later with the old single-column shape would otherwise be
  --    outside this migration with nothing to notice it — the failure mode
  --    `crossTenantAudit.ts` derives its edges to avoid. This refuses on a fresh
  --    database instead, which is where a new table is first seen.
  --
  --    `array_length(conkey, 1) = 1` is the discriminator: after this file has
  --    run once the ten edges are composite and `observed` is empty, so the
  --    comparison is skipped and the file is re-runnable by hand.
  -- -------------------------------------------------------------------------
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), ARRAY[]::text[]) INTO observed
    FROM pg_constraint k
    JOIN pg_class c  ON c.oid = k.conrelid
    JOIN pg_class cf ON cf.oid = k.confrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE k.contype = 'f' AND n.nspname = 'public'
     AND cf.relname = 'scan_session'
     AND array_length(k.conkey, 1) = 1;

  IF array_length(observed, 1) IS NOT NULL AND observed <> expected THEN
    RAISE EXCEPTION
      'scan_session children with a single-column foreign key are % but this migration names % '
      '(000-docs/056 section 11 R7): a child added since this file was written is not covered by '
      'it. Add it to the list rather than widening the query.',
      observed, expected;
  END IF;

  FOREACH t IN ARRAY expected LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION 'scan_session child set names a table that does not exist: %', t;
    END IF;

    -- 3. The composite edge. `NOT VALID` then `VALIDATE` states the lock profile
    --    a zero-downtime deploy needs; see the header for what that does and
    --    does not buy inside one transaction, and for the bead that owns the
    --    deploy rule.
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_session_same_shop');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (scan_session_id, shop_id) '
      'REFERENCES scan_session (id, shop_id) NOT VALID',
      t, t || '_session_same_shop');
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', t, t || '_session_same_shop');

    -- 4. The edge the new one subsumes, dropped BY SHAPE rather than by the
    --    auto-generated name. There is at most one; the check above proved the
    --    set, and this finds whatever this database calls it.
    FOR old_name IN
      SELECT k.conname::text
        FROM pg_constraint k
        JOIN pg_class c  ON c.oid = k.conrelid
        JOIN pg_class cf ON cf.oid = k.confrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE k.contype = 'f' AND n.nspname = 'public'
         AND c.relname = t AND cf.relname = 'scan_session'
         AND array_length(k.conkey, 1) = 1
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, old_name);
    END LOOP;
  END LOOP;
END $$;

COMMIT;
