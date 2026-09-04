-- 004_human_confirmation_outcome.sql — land the `outcome` slot that 019 §3.0
-- names as a G2 prerequisite for T3 (high-confidence false-confirm rate) and
-- T20, alongside the `supersedes_id` that 003 already shipped.
--
-- Why now: 019 §3.0 lists "human_confirmation.supersedes_id + outcome ∈
-- {confirm, correct}" as one prerequisite. Migration 003 landed half of it. T3's
-- numerator is "one-tap items later outcome=correct" — with no column there is
-- nothing to count, so T3 is unmeasurable and 035 §4.3's blind-labelling
-- protocol has no field to read. Like every slot in 003, it must exist BEFORE
-- the rows it describes are written: an append-only row is never backfilled.
--
-- Bead: longbox-e5b.2.13 (alias E02-D03). Docs: 019 §3.0 / T3 / T20,
-- 035 §4.3, 030 A1, 003:84-104.
--
-- Shape: EXPAND ONLY. Nothing in 001/002/003 is edited. Every statement is safe
-- to re-run by hand (ADD COLUMN IF NOT EXISTS, DROP-then-ADD for the CHECK,
-- CREATE OR REPLACE for the view).
--
-- Hickey discipline: this adds a COLUMN, never an UPDATE path. A confirmation
-- whose outcome was mis-set WILL be corrected the way every other correction
-- works — a new row pointing at it through `supersedes_id` — once E02-B07 lands
-- the writer for that column, which 003 reserved but nothing populates yet.
-- Until then a mis-set outcome simply stands; it is never updated. The
-- append-only trigger from 001 still forbids UPDATE and DELETE on the table.
--
-- Migration numbering: 006's decision log reserved 004 for 034 §4.1's tenancy
-- migration and 005 for 036 §7.1's. Neither is written; this expand needs a
-- number now, so it takes 004 and those shift to 005 and 006 respectively. The
-- 006 row filed with this change records that, and E02-B07 uses the new numbers.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. human_confirmation.outcome (019 §3.0, T3, T20)
--
--    NULLABLE, and NULL has EXACTLY ONE meaning: the row was written before this
--    migration existed, i.e. before the confirm route knew how to compute the
--    field. It is NEVER backfilled — 030 A1's rule and 003's rule for
--    storage_key / operator_id alike: nothing written before an instrument
--    existed can be retro-attributed, and a reconstructed value would be a
--    fabricated observation about what an operator did.
--
--    030 A1 rejected a reserved nullable column (`confirmed_edition_lcid`)
--    precisely because its NULL carried TWO meanings — "not resolved yet" and
--    "predates the column" — and the reader could not tell them apart. That
--    hazard does not arise here: every writer after this migration sets the
--    field on INSERT (the confirm route computes it from the pick, and the row
--    is immutable thereafter), so a NULL can only ever mean "pre-G2 row". Any
--    later writer that omits it would reintroduce the two-meanings hole; the
--    integration test asserts the route always sets it.
--
--    The CHECK permits NULL and the two ratified values only. 'confirm' means
--    the confirmed identity equals the top proposal that was on screen;
--    'correct' means the operator changed it. Deliberately a closed CHECK enum
--    rather than open text (unlike media_deletion.reason_code in 003): 019 fixes
--    the domain at exactly {confirm, correct} and T3's arithmetic is a ratio
--    over those two, so a third value would silently corrupt a signed threshold.
--    Widening it is a decision requiring a 006 row and a new migration.
-- ---------------------------------------------------------------------------
ALTER TABLE human_confirmation ADD COLUMN IF NOT EXISTS outcome text;

ALTER TABLE human_confirmation DROP CONSTRAINT IF EXISTS human_confirmation_outcome_check;
ALTER TABLE human_confirmation ADD CONSTRAINT human_confirmation_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('confirm', 'correct'));

COMMENT ON COLUMN human_confirmation.outcome IS
  '019 section 3.0 / T3 / T20. confirm = the confirmed identity equalled its '
  'baseline; correct = the person changed it. The baseline is the session''s prior '
  'human_confirmation when one exists (so an owner review or a second pass is '
  'scored against what the employee confirmed, which is what T20 measures), else '
  'the top proposal of the latest non-barcode candidate_set (T3). one_tap is '
  'always confirm. NULL means the row predates migration 004 (pre-G2) and is '
  'NEVER backfilled (030 A1): a value reconstructed after the fact would be a '
  'fabricated observation. Immutable like every other column here — a mis-set '
  'outcome will be corrected by a superseding row via supersedes_id once E02-B07 '
  'lands that writer; until then it stands, never UPDATEd.';

-- T3 counts one-tap confirmations that were later corrected, so it reads this
-- column filtered by source. Partial index keeps that scan off the whole table
-- once the pilot has volume; NULL rows are excluded because they are never
-- countable in T3 either way.
CREATE INDEX IF NOT EXISTS human_confirmation_outcome_idx
  ON human_confirmation(shop_id, source, outcome)
  WHERE outcome IS NOT NULL;

-- The confirm route reads the session's latest prior confirmation to pick the
-- baseline above. Without this the read is a seq scan + sort over an append-only
-- table that is never pruned.
CREATE INDEX IF NOT EXISTS human_confirmation_session_idx
  ON human_confirmation(scan_session_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- 2. Re-create the current-record read model so it carries the new column.
--
--    A view's column list is frozen at CREATE time — 003's `h.*` expanded to the
--    columns that existed then, so without this the current-record view would
--    silently omit `outcome` and every reader of the read model would see a
--    schema that disagrees with the table. Same shape, same ordering, same
--    semantics as 003: newest row per session that nothing supersedes.
--    CREATE OR REPLACE accepts this because `outcome` is APPENDED to the end of
--    the column list, not inserted into it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW human_confirmation_current AS
SELECT DISTINCT ON (h.scan_session_id) h.*
FROM human_confirmation h
WHERE NOT EXISTS (SELECT 1 FROM human_confirmation s WHERE s.supersedes_id = h.id)
ORDER BY h.scan_session_id, h.created_at DESC, h.id DESC;

COMMIT;
