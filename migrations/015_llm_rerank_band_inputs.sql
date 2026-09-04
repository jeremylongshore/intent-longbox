-- 015_llm_rerank_band_inputs.sql — record what the band was DERIVED from.
--
-- Bead: longbox-e5b.6.11 (alias E06-D01). Docs: 046 §5 A8 / finding R-3; 040
-- §4.2 F3; 019 T1/T3; 022 P6; 042 §3.3 (the declared projection); CLAUDE.md
-- locked decision 7.
--
-- WHAT IT FIXES. Before E06-D01 the band was `assignBand(model.confidence)`
-- occasionally lowered by the contradiction gate — and every branch of that gate
-- is guarded on a NON-NULL evidence field, so `{issue_number_read: null,
-- price_box_text: null, logo_era_guess: null, confidence: 0.99}` validated,
-- raised no contradiction, and reached the high band and the one-tap path. The
-- band is now derived server-side from five ceilings (evidence completeness,
-- the contradiction verdict, barcode-vs-candidate agreement, candidate-set
-- uniqueness, and the model's number as ONE input that may only lower). This
-- column is the record of those inputs.
--
-- WHY A COLUMN AND NOT A TABLE. 019 T3 is "one-tap items later corrected ÷
-- one-tap items", and the row it is computed from is `llm_rerank`. Storing the
-- derivation anywhere else would mean joining a band to the reason it was that
-- band, which is exactly the shape that lets the two drift. `llm_rerank` is
-- already an append-only, immutable, timestamped record (locked decision 4), so
-- the inputs land beside the conclusion in the same immutable row and no new
-- append-only table or trigger is needed.
--
-- WHAT IT DOES NOT CARRY (022 P6, 019 T35). No percentage, no rate, no operator
-- identifier — a presence tuple, band words, the model's raw number, and the
-- gate's evidence strings about the BOOK. It is not on the wire: 042's
-- `eventDtos.llm_rerank` projection is a declared key set and this column is not
-- in it, so adding it here publishes nothing.
--
-- `confidence` LOSES ITS NOT NULL, AND THAT IS THE POINT. A model that declines
-- to guess a number is now answering correctly rather than failing validation
-- (`shared.ts` makes the field optional), because nothing depends on the number
-- any more. NULL here has ONE meaning: the model reported none. It does not also
-- mean zero, unknown, or "the call failed" — a failed call writes no row at all.
-- DROP NOT NULL is a relaxation, so it is expand-safe and needs no `-- contract:`
-- header (000-docs/044 §2): every reader that worked before still works, and no
-- existing row changes.
--
-- ADD COLUMN and ALTER COLUMN are DDL, not DML, so `llm_rerank_append_only`
-- neither refuses them nor should: the trigger governs rows, not shape.
-- Expand-only and re-runnable.

BEGIN;

ALTER TABLE llm_rerank ADD COLUMN IF NOT EXISTS band_inputs jsonb;

ALTER TABLE llm_rerank ALTER COLUMN confidence DROP NOT NULL;

COMMENT ON COLUMN llm_rerank.band_inputs IS
  'Every input the band was derived from (E06-D01; 046 §5 A8): per-field evidence '
  'presence, the fields the model called unreadable and its reasons, the contradiction '
  'verdict and its reasons, barcode-vs-candidate agreement, candidate-set uniqueness, '
  'the model''s self-reported confidence as ONE input, the five ceilings, and the '
  'resulting band. Written so 019 T3 can be sliced by evidence completeness instead of '
  'reported as one rate over a mixed population. Carries no percentage and no operator '
  'identifier (022 P6, 019 T35), and is absent from the 042 wire projection.';

COMMENT ON COLUMN llm_rerank.confidence IS
  'The model''s self-reported number, or NULL when it reported none — ONE meaning '
  '(E06-D01). It is recorded, it may LOWER the derived band, and it can never raise '
  'one; the band lives in `band` and its derivation in `band_inputs`. Never on the '
  'wire (042 §3.3).';

COMMIT;
