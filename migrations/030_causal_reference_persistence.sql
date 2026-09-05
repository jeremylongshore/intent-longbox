-- 030_causal_reference_persistence.sql — E02-D11 (bead longbox-e5b.2.21)
--
-- 041 §10 row 2's last unwritten half: `against_table` / `against_id` on the two
-- tables that record A HUMAN DECISION MADE AGAINST A DISPLAYED STATE. Docs:
-- 041 §3.5 (one shape, and the table list), §10 row 2; 040 §3.3 (the column pair
-- and its whole-or-absent CHECK, as shipped for `scan_session_transition` in
-- `010`), §3.4 clause 2 (the causal comparison the stored value serves);
-- 042 §6 (the wire shape); 000-docs/044 §2, §3 (expand-only, idempotent by hand,
-- prior-snapshot upgrade).
--
-- ⚠ **NUMBERED 030, PAST A GAP AT 027.** `026` is E03-B06's, `028` is E03-B03's
-- and `029` is E03-B04's row-level security, which merged first; `027` was
-- reserved by E03-B06 and never written. This file was numbered `029` on its own
-- branch and renamed on the rebase, which is legal precisely because it had not
-- shipped: the runner's ledger keys on FILENAME, so a number moves freely before
-- a merge and never after one. The ledger applies unseen files in sorted order
-- (`scripts/migrationDiscipline.ts:planMigrations`), so the gap at `027` is legal
-- and self-healing, and nothing in the runner, the lint or the checksum reads
-- contiguity. `027` stays free rather than being back-filled by this file: a
-- number inserted BEFORE an already-applied one would make
-- `readMigrations().slice(0, n)` — which the prior-snapshot upgrade test uses to
-- name the files a fixture already holds — describe a different set of files
-- than the fixture was cut from.
--
-- ============================================================================
-- WHAT THIS FIXES, STATED AS THE HOLE IT CLOSES
-- ============================================================================
--
-- `src/services/worldView.ts` has said so in its own header since E02-D08:
--
--   > "WHAT THIS FILE DOES NOT DO. It does not PERSIST the reference. …the check
--   >  is enforced at write time and is not reconstructable from the log
--   >  afterwards."
--
-- So today the system REFUSES a write whose world-view has moved and then keeps
-- no record of the world the accepted write was made against. Two ratified
-- requirements read that record and neither can:
--
--   * **040 §3.4 clause 2** derives a session's state by asking whether the
--     newest transition "still speaks to the current world" — a comparison
--     against a STORED `(against_table, against_id)`, with the `created_at`
--     proxy as the counted fallback. `010` gave `scan_session_transition` the
--     columns; the tables a transition is compared against had no way to say
--     what THEY were issued against.
--   * **041 §5.3 (A4)**: "a dispute between two replayed writes is resolved by
--     `against_table`/`against_id`, never by `session_seq` alone". A dispute
--     resolved from columns that do not exist is resolved by the clock.
--
-- And the plainer one: the audit answer to *"what was this person looking at
-- when they decided that?"* is a fact about the act, and 041 §2.1's rule is that
-- a thing that happened is a row — not a check that ran and left nothing behind.
--
-- ============================================================================
-- WHICH TABLES, AND WHY NOT MORE (041 §3.5 — READ EXACTLY)
-- ============================================================================
--
--   > "The columns go on the tables that record a human decision made against a
--   >  displayed state: `human_confirmation`, `condition_assessment`, and
--   >  `scan_session_transition` when 040's table lands. They do NOT go on
--   >  machine-authored tables, which are not decisions and were not made
--   >  against anything the actor was shown."
--
-- `scan_session_transition` has them already (`010`). This file adds the other
-- two named, and NOTHING ELSE — which is narrower than the set of routes that
-- ACCEPT `against` today, and the difference is deliberate:
--
--   * `scan_photo` — a photograph is a human act but not a decision made against
--     a displayed state. Nothing was on the screen for the shutter to disagree
--     with. The route still SENDS `against` and the check still runs; what it
--     buys is the refusal, not a stored claim about what a camera saw.
--   * `candidate_set`, `llm_rerank`, `pricing_snapshot` — machine-authored
--     (041 §10.1 derives `authored_by` as `'system'`/`'provider'` for all
--     three). A provider's answer was not "made against" a world the provider
--     was shown, and storing the operator's world-view on the provider's row
--     would attribute a human's view to a machine's record.
--   * `outbox` — `POST …/draft` appends a JOB, not a witness (043 §4.1). The
--     draft row itself is written later, by a worker, in a different
--     transaction, and it is not a person's decision either.
--
-- Widening the set is a decision that amends 041 §3.5, needs a 000-docs/006 row,
-- and takes a new migration. It is not something a later writer may do by
-- reaching for a column that happens to be there.
--
-- ============================================================================
-- NO BACKFILL, AND NO DEFAULT (041 §10.1's rule, applied)
-- ============================================================================
--
-- Both columns are NULLABLE with NO DEFAULT, and no statement in this file sets
-- a value on an existing row. 041 §10.1: "`operator_id` and `actor_verified` are
-- never backfilled because pre-G2 rows are unattributable BY CONSTRUCTION, not by
-- policy; `session_seq` is never backfilled because a reconstructed sequence
-- would be a fabricated observation about the order things happened in." The same
-- argument is stronger here: nobody recorded what was on the screen, so any value
-- this migration invented would be a fabricated observation about what a person
-- was looking at — the one thing these columns exist to record truthfully.
--
-- NULL therefore has exactly ONE meaning per row, and it is readable from the
-- row's own age: before this migration, "the column did not exist"; after it,
-- "042 §6.5's counted fallback — a client sent no reference" (040 I18 counts
-- those, so the residue is measured rather than assumed away). 030 A1's
-- two-meanings hazard is the thing being avoided, and the boundary is the
-- migration itself rather than a flag.
--
-- ============================================================================
-- SHAPE: EXPAND ONLY
-- ============================================================================
--
-- Four `ADD COLUMN IF NOT EXISTS`, four `DROP CONSTRAINT IF EXISTS` +
-- `ADD CONSTRAINT` pairs, two `CREATE INDEX IF NOT EXISTS`, two
-- `CREATE OR REPLACE VIEW`, four `COMMENT ON COLUMN`. It edits no shipped
-- migration, creates no table, adds no UPDATE path, and a hand re-run is a no-op.
-- No `-- contract:` header: nothing here is a contracting statement (044 §2's
-- lint matches DROP TABLE / DROP COLUMN / ALTER COLUMN … TYPE / SET NOT NULL, and
-- this file contains none), and the lint refuses a header on a file with nothing
-- to retire.
--
-- The append-only triggers are UNTOUCHED. `006` set them to `ENABLE ALWAYS` and
-- this file neither drops nor re-creates one, so there is no path here for the
-- E02-D05 downgrade hazard to travel.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The columns.
--
--    `text` + `uuid`, matching `010:61-65` exactly. **No foreign key**, and that
--    is the same answer `010` gave for the same reason: the reference is
--    polymorphic — it names one of eight tables — and a polymorphic FK is not a
--    thing Postgres has. The CHECK below closes the TABLE side of the domain; the
--    ID side is guaranteed by the writer, which only ever stores a reference the
--    causal check has just READ from the named table inside the same
--    transaction (`src/services/worldView.ts`). A dangling `against_id` is
--    therefore impossible for a row this system wrote, and no constraint can make
--    that claim for a row it did not.
-- ---------------------------------------------------------------------------
ALTER TABLE human_confirmation   ADD COLUMN IF NOT EXISTS against_table text;
ALTER TABLE human_confirmation   ADD COLUMN IF NOT EXISTS against_id    uuid;
ALTER TABLE condition_assessment ADD COLUMN IF NOT EXISTS against_table text;
ALTER TABLE condition_assessment ADD COLUMN IF NOT EXISTS against_id    uuid;

-- ---------------------------------------------------------------------------
-- 2. The domain, and the whole-or-absent rule.
--
--    THE TABLE NAME IS AN ENUMERATION, NOT FREE TEXT. An unconstrained
--    `against_table` would let a writer store `'human_confirmations'`, or a
--    view's name, or a table that does not exist — and every one of those reads
--    back as a reference that names nothing, indistinguishable at query time from
--    a reference to a row that was purged. 040 §3.3 wrote the closed list for
--    `scan_session_transition` and `010` shipped it; this is the SAME EIGHT
--    VALUES, deliberately, because one column pair with two vocabularies is two
--    column pairs wearing one name.
--
--    THE EIGHT INCLUDE `scan_session` AND THE WIRE'S SEVEN DO NOT. The wire enum
--    (`AGAINST_TABLES` in `src/contracts/v1/schemas.ts`) omits `scan_session`
--    because a request body never names the anchor — a session with no records
--    is `intake` (040 §3.4) and there is no witness to have been shown. The
--    database keeps it for `010`'s reason: a transition CAN be issued against the
--    session itself. The narrower set is enforced at the edge by Zod, where a
--    client's value arrives; the wider set is what the schema shares with `010`.
--    The relationship is a SUBSET and it is asserted by
--    `tests/integration/migrations.test.ts`, not left to inspection.
--
--    WHOLE OR ABSENT (040 §3.3's own CHECK, and 041 §3.5's "the same
--    whole-or-absent rule"). Half a reference is worse than none: `('llm_rerank',
--    NULL)` claims a rung with no row to check it against, and 040 §3.4 clause 2
--    would compare a rung it can neither confirm nor refute. The constraint is
--    the reason the read model can publish the pair without a third state.
-- ---------------------------------------------------------------------------
ALTER TABLE human_confirmation DROP CONSTRAINT IF EXISTS human_confirmation_against_table_check;
ALTER TABLE human_confirmation ADD CONSTRAINT human_confirmation_against_table_check
  CHECK (against_table IS NULL OR against_table IN (
    'scan_photo','candidate_set','llm_rerank','human_confirmation',
    'condition_assessment','pricing_snapshot','shopify_draft','scan_session'));

ALTER TABLE human_confirmation DROP CONSTRAINT IF EXISTS human_confirmation_reference_is_whole;
ALTER TABLE human_confirmation ADD CONSTRAINT human_confirmation_reference_is_whole
  CHECK ((against_table IS NULL) = (against_id IS NULL));

ALTER TABLE condition_assessment DROP CONSTRAINT IF EXISTS condition_assessment_against_table_check;
ALTER TABLE condition_assessment ADD CONSTRAINT condition_assessment_against_table_check
  CHECK (against_table IS NULL OR against_table IN (
    'scan_photo','candidate_set','llm_rerank','human_confirmation',
    'condition_assessment','pricing_snapshot','shopify_draft','scan_session'));

ALTER TABLE condition_assessment DROP CONSTRAINT IF EXISTS condition_assessment_reference_is_whole;
ALTER TABLE condition_assessment ADD CONSTRAINT condition_assessment_reference_is_whole
  CHECK ((against_table IS NULL) = (against_id IS NULL));

-- ---------------------------------------------------------------------------
-- 3. The index, per `010:124-125`'s stated purpose: "so a record can be asked
--    which transitions were issued against it". Here the question is the audit
--    one — "which decisions were taken while this row was on the screen?" — and
--    it is asked of a table that is never pruned.
--
--    PARTIAL, which `010`'s is not, and the difference is honest rather than
--    stylistic: a row whose reference is NULL is 042 §6.5's counted fallback and
--    is not an answer to that question at all, so it does not belong in the
--    index that answers it. It also keeps the index off every pre-migration row
--    forever.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS human_confirmation_against_idx
  ON human_confirmation (against_table, against_id)
  WHERE against_table IS NOT NULL;

CREATE INDEX IF NOT EXISTS condition_assessment_against_idx
  ON condition_assessment (against_table, against_id)
  WHERE against_table IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. What each column MEANS, in the database, for the reader who finds it
--    without this file.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN human_confirmation.against_table IS
  '040 A1 / 041 section 3.5 — THE CAUSAL REFERENCE, first half. The table of the '
  'highest-witness record the person was shown when they made this decision. Time '
  'is a proxy for causality; this is the causality. 040 section 3.4 clause 2 '
  'compares against THIS, not against a clock, and degrades to created_at only '
  'when it is NULL — a fallback that is COUNTED (040 I18), never assumed away. '
  'NULL means either that the row predates migration 030 or that the client sent '
  'no reference (against is optional in v1 per 042 section 6.5, because making it '
  'required would refuse every replay from an offline queue written by an older '
  'client). NEVER backfilled: nobody recorded what was on the screen, and a '
  'reconstructed value would be a fabricated observation about what a person was '
  'looking at. Immutable like every other column here — a correction is a new row '
  'naming this one through supersedes_id.';

COMMENT ON COLUMN human_confirmation.against_id IS
  '040 A1 / 041 section 3.5 — THE CAUSAL REFERENCE, second half: the id of the '
  'record named by against_table. Whole or absent, enforced by '
  'human_confirmation_reference_is_whole. No foreign key, because the reference '
  'is polymorphic over eight tables; the writer only ever stores a reference the '
  'causal check read from the named table inside the same transaction '
  '(src/services/worldView.ts), so a dangling value cannot come from this system.';

COMMENT ON COLUMN condition_assessment.against_table IS
  '040 A1 / 041 section 3.5 — THE CAUSAL REFERENCE, first half. The table of the '
  'highest-witness record the person was shown when they made this condition '
  'call: in the ordinary flow the human_confirmation they were looking at. It '
  'says what world the call was made against and nothing about the call itself — '
  'condition stays a grade RANGE plus defect callouts (037), and no reading of '
  'this column produces a number. NULL means the row predates migration 030 or '
  'the client sent no reference (042 section 6.5, counted by 040 I18). NEVER '
  'backfilled.';

COMMENT ON COLUMN condition_assessment.against_id IS
  '040 A1 / 041 section 3.5 — THE CAUSAL REFERENCE, second half: the id of the '
  'record named by against_table. Whole or absent, enforced by '
  'condition_assessment_reference_is_whole. No foreign key, for the reason given '
  'on human_confirmation.against_id.';

-- ---------------------------------------------------------------------------
-- 5. Re-create the two `_current` read models so they carry the new columns.
--
--    A view's column list is FROZEN at CREATE time — `004:95-101` names the
--    hazard and `013:91-96` repeats it: `h.*` expanded to the columns that
--    existed then, so without this the read model would silently omit
--    `against_*` and disagree with its own table. `CREATE OR REPLACE VIEW`
--    accepts the change because both columns were APPENDED to the end of each
--    table by section 1 above, never inserted into the middle.
--
--    Semantics and ordering are UNCHANGED from `013`: newest unsuperseded row
--    per session on 041 section 5's canonical order — `session_seq DESC NULLS
--    LAST`, then `created_at DESC, id DESC` as the declared fallback for pre-`007`
--    rows. `NULLS LAST` on a DESC ordering is not the default and is load-bearing.
--    `pricing_snapshot_current` is deliberately NOT touched: that table gains no
--    column here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW condition_assessment_current AS
SELECT DISTINCT ON (c.scan_session_id) c.*
FROM condition_assessment c
WHERE NOT EXISTS (SELECT 1 FROM condition_assessment s WHERE s.supersedes_id = c.id)
ORDER BY c.scan_session_id, c.session_seq DESC NULLS LAST, c.created_at DESC, c.id DESC;

CREATE OR REPLACE VIEW human_confirmation_current AS
SELECT DISTINCT ON (h.scan_session_id) h.*
FROM human_confirmation h
WHERE NOT EXISTS (SELECT 1 FROM human_confirmation s WHERE s.supersedes_id = h.id)
ORDER BY h.scan_session_id, h.session_seq DESC NULLS LAST, h.created_at DESC, h.id DESC;

COMMIT;
