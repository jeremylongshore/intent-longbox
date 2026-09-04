-- 008_supersession_integrity.sql — E02-B10 (bead longbox-e5b.2.10)
--
-- 041 §10 row 3, the half this bead owns: R1's COMPOSITE FOREIGN KEY — mandatory,
-- not optional (041 §3.2, amendment A2) — and R3's self-reference CHECK, on the
-- three session-scoped tables that carry `supersedes_id`. Docs: 041 §3.1, §3.2,
-- invariants I3 and I4; 019 T24 (non-waivable); 000-docs/044 §5.
--
-- THE DEFECT THIS CLOSES, PRECISELY. `003:88-104` gave each of
-- `condition_assessment`, `pricing_snapshot` and `human_confirmation` a self-FK and
-- a partial unique index. That enforces R2 — a row is superseded at most once — and
-- nothing else, because `FOREIGN KEY (supersedes_id) REFERENCES t(id)` constrains
-- the target's EXISTENCE and says nothing about the target's `shop_id` or
-- `scan_session_id`. So today shop `t` can insert a confirmation that supersedes
-- shop `s`'s row (041 §1 E18): a reproducible CROSS-TENANT WRITE whose effect on
-- the victim is that a session silently loses its confirmation. 019 T24 signs
-- cross-tenant access at 0, non-waivable, `any → K1`.
--
-- WHY A FOREIGN KEY AND NOT A TRIGGER (041 §3.2, A2 — the cannon closed §13 Q3).
--   1. It is checked by the planner and there is no procedure to disable. 041 §1
--      E13–E15 establish by execution that a trigger can be switched off by the
--      table owner or a superuser. A constraint has no `tgenabled`. Putting a
--      non-waivable T24 boundary behind the mechanism `006` exists BECAUSE it is
--      bypassable would be the wrong trade twice over.
--   2. It therefore needs no detector, no heartbeat and no place on 041 §9.2's
--      declared list. The FK costs a redundant unique index and nothing else.
--   3. It is not a per-table judgement call. All three are session-scoped, so the
--      FK is expressible on all three. The trigger fallback is DEFERRED, not
--      deleted: whichever record first introduces a supersession chain on a table
--      that is not session-scoped (034 §2.9's `labor_shift`) owns that shape.
--
-- WHAT IS NOT HERE. R4 — "a successor is recorded after its predecessor", asserted
-- against the predecessor's `session_seq` — needs a `BEFORE INSERT` trigger and a
-- writer that assigns `session_seq` on the superseding path. `007` lands the column
-- and this bead wires the assignment on the two transactional routes; the
-- supersession WRITER (041 §3.3's single `supersede()` helper) is E02-B07's, and R4
-- lands with it. Until then a cycle longer than one row is prevented by R2 plus the
-- self-CHECK below only for the two-row case's first edge, and 041 I4(c) stays
-- open. Stated rather than implied, because a half-enforced rule that reads as
-- enforced is worse than an absent one.
--
-- SHAPE: EXPAND ONLY. Adds two indexes and two constraints per table; edits no
-- shipped migration; adds no UPDATE path; re-runnable by hand (DROP-then-ADD).

BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['human_confirmation','condition_assessment','pricing_snapshot'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE EXCEPTION 'supersession set names a table that does not exist: %', t;
    END IF;

    -- The redundant unique index the composite FK needs as its target. `id` is
    -- already the primary key, so this adds no new uniqueness — it adds a UNIQUE
    -- CONSTRAINT over the exact triple the FK references, which is what Postgres
    -- requires of a foreign key's target and is the FK's entire cost (041 §3.2).
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (id, shop_id, scan_session_id)',
      t || '_scope_key', t);

    -- R1 — a successor sits in the same shop AND the same session as its
    -- predecessor. MATCH SIMPLE (the default) means the constraint is vacuous when
    -- `supersedes_id` is NULL, which is exactly right: a first row supersedes
    -- nothing. When it is present, all three columns must match a real row.
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_supersedes_same_scope');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (supersedes_id, shop_id, scan_session_id) ' ||
      'REFERENCES %I (id, shop_id, scan_session_id)',
      t, t || '_supersedes_same_scope', t);

    -- R3 — a row may not supersede itself. One line, and it closes 041 §1 E16
    -- outright. E17 is the pair case: two rows superseding each other satisfy R2,
    -- satisfy the FK, and leave the session with ZERO current confirmations —
    -- unrecoverable, because the append-only trigger forbids repair and R2 forbids
    -- a third row from superseding either. `IS DISTINCT FROM` rather than `<>` so a
    -- NULL `supersedes_id` passes.
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_supersedes_not_self');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (supersedes_id IS DISTINCT FROM id)',
                   t, t || '_supersedes_not_self');
  END LOOP;
END $$;

COMMIT;
