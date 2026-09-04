-- 012_cost_log_outbox_id.sql — give cost_log a job dimension.
--
-- Bead: longbox-e5b.2.17 (alias E02-D07). Docs: 043 v1.1.2 §8.1, §9.1 row 2,
-- §6.1 (a cost row is never replayed), §1 E11; 041 §9.4; 030 A1.
--
-- WHY IT IS ITS OWN FILE. 043 §9.1 orders it as row 2, blocked on row 1 (011's
-- tables), and it is kept as a separate migration for the reason the sequence
-- separates them: the two answer different questions. 011 asks "is an effect
-- owed and what happened when we tried"; this one asks "what did a job cost".
-- Splitting them keeps 011 revertible without dragging a cost-ledger change with
-- it.
--
-- WHAT IT FIXES. 043 §1 E11 reproduces the defect: `cost_log` has no job
-- dimension, so "what did this job cost" is unanswerable by construction. The
-- column closes that.
--
-- ONE MEANING FOR NULL, WHICH IS THE WHOLE TEST (030 A1, restated by 041 §9.4).
-- NULL means "spent by a REQUEST, not a job". It does not also mean "unknown",
-- "not yet linked" or "job cost tracking was off". A nullable column whose NULL
-- carries two meanings is the defect; the alternative shape — a `source` enum
-- beside a nullable FK — encodes the same fact twice and lets the two disagree.
--
-- THE SHOPIFY DRAFT JOB WRITES NO COST ROW, AND THAT IS DELIBERATE (043 §8.1).
-- `productSet` costs no money. Writing a zero-dollar row to prove the seam works
-- would put a figure in a ledger that is not a measurement, and 022 P8's
-- decision strip and 019 T13a both read this table. A job logs a cost when it
-- SPENDS; the seam exists for E10-B04's staged media upload and for any future
-- provider job, and it stays empty until one arrives.
--
-- A REPLAYED JOB APPENDS A SECOND ROW (043 §6.1). It is not a bug and it must
-- not be de-duplicated: a replay that calls a paid provider again spent the
-- money again. The row is a meter reading; replaying the ROW would be falsifying
-- a ledger.
--
-- ADD COLUMN is DDL, not DML, so `cost_log_append_only` neither refuses it nor
-- should: the trigger governs rows, not shape. Expand-only and re-runnable.

BEGIN;

ALTER TABLE cost_log ADD COLUMN IF NOT EXISTS outbox_id uuid REFERENCES outbox(id);

COMMENT ON COLUMN cost_log.outbox_id IS
  'The job that spent this money, or NULL when a REQUEST spent it — ONE meaning, not '
  'two (043 §8.1; 030 A1). A replayed job that calls a paid provider again appends a '
  'SECOND row rather than reusing this one: the row is a meter reading, and replaying '
  'it would be falsifying a ledger (043 §6.1). Empty today by design — the Shopify '
  'draft job spends nothing; E10-B04''s staged media upload is the first job that will '
  'populate it.';

-- Partial: the overwhelming majority of rows are request-spend and carry NULL,
-- and the only query this column serves is "what did job X cost".
CREATE INDEX IF NOT EXISTS cost_log_outbox_idx ON cost_log (outbox_id) WHERE outbox_id IS NOT NULL;

COMMIT;
