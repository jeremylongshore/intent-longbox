-- 005_listing_status_observation.sql — give the Shopify draft a legal lifecycle
-- path: the observed-status fact that 019 T19's auto-publish detector reads.
--
-- Why now: migration 003 widened `shopify_draft.status` to include
-- 'published' / 'delisted' / 'archived', but `shopify_draft` sits in the 001
-- append-only trigger array (`001_init.sql:174-182`, BEFORE UPDATE OR DELETE),
-- so NO legal writer can ever move a draft row to those values — an UPDATE is
-- refused by the trigger, and a second `shopify_draft` row is indistinguishable
-- from the retry 036 E6 records as unprevented. Meanwhile 019 T19
-- ("Auto-publish incidents | 0 | `published_by='app'` rows + Shopify status
-- watcher | any -> K1; non-waivable") needs a `published_by` column, and no such
-- column exists anywhere in the tree. This migration lands the fact table that
-- closes both gaps, so T19 has something to read before the supervised live
-- batch.
--
-- Bead: longbox-e5b.2.12 (alias E02-D02). Docs: 040 §2.2(b), §4.3 C1-C9, §4.4,
-- §8.1 item 2; 036 §7.3; 019 v1.2.0 T19/T34; 003:157-166; 001:174-182.
--
-- Shape: EXPAND ONLY. Nothing in 001, 002, 003 or 004 is edited. Every statement
-- is safe to re-run by hand (IF NOT EXISTS, or DROP-then-ADD for constraints,
-- comments and triggers, which Postgres has no ADD ... IF NOT EXISTS form for).
--
-- Hickey discipline: this migration adds ONE TABLE and its indexes. It never
-- adds an UPDATE path. A listing that changes state is a NEW observation row;
-- "the current status of this listing" is a derivation over the newest row, not
-- a stored column that somebody flips.
--
-- Two deliberate departures from 040 §4.4's sketch, recorded here rather than
-- discovered by the next reader:
--
--   1. **The FK targets `shopify_draft`, not `listing_link`.** 040 §4.4 and
--      §8.1 item 2 write the FK against 036's `listing_link`, "after 036's
--      listing_link, which it FKs". That table does not exist in the tree — 036
--      §7.1's migration is unwritten (006 row 2026-09-04: "not one exists in the
--      tree"), and this bead blocks the supervised live batch, so it cannot wait
--      on it. `shopify_draft` is the only row that today represents a created
--      listing, and it is the row whose status values 003 widened, so it is the
--      honest subject of an observation NOW. When `listing_link` lands, E10-B03
--      adds a nullable `listing_link_id` alongside (expand, never a rewrite);
--      the observations written before it keep pointing at the draft they were
--      actually made against, which is the truth about them.
--   2. **Column names follow the bead: `observed_at` and `source`.** 040 §4.4
--      sketches `external_updated_at` + `observed_via CHECK ('webhook','poll')`.
--      The bead (E02-D02) words the same two fields as `observed_at` and
--      `source = watcher|webhook`, and the CHECK set below is the bead's. Both
--      spellings mean the same two things: when the channel says the status was
--      true, and how Longbox came to hear about it. `observed_status`'s value
--      set is 040 §4.4 verbatim and is NOT narrowed.
--   3. **This table lands ahead of 040 §8.1's single E02-B07 migration.** 040 §8
--      orders §8.1 after 029 §12's transaction (A5) because views and guards
--      are untestable without it; neither a view nor a guard ships here, so
--      that rationale does not bite. Migration 004 (E02-D03) set the same
--      precedent for §8.1 item 5. 040 v1.2.x records both.
--
-- What this migration does NOT do (each is another bead, named so nobody
-- assumes it landed here): the poller and the webhook receiver are E10-B05 and
-- E10-B08; the T19 detector's heartbeat (019 T34) is E13-B04; the
-- `listing_link_current_status` view and the deprecation of `shopify_draft`'s
-- three unreachable status values are E02-B10's contract step (040 §8.2 item 5).
-- This migration deliberately does NOT drop or narrow 003's widened CHECK: that
-- is a contract change and it is not this bead's to make.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. listing_status_observation — commerce-owned, append-only (040 §4.4)
--
--    One row per time the channel was observed to say something about a
--    listing. Nothing here is a decision Longbox made; every row is a report
--    about the outside world, which is exactly why `published_by` is stored
--    verbatim and never interpreted at write time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_status_observation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          uuid NOT NULL REFERENCES shop(id),
  shopify_draft_id uuid NOT NULL REFERENCES shopify_draft(id),
  observed_status  text NOT NULL
    CHECK (observed_status IN ('draft', 'published', 'delisted', 'archived', 'deleted')),
  published_by     text,
  observed_at      timestamptz NOT NULL DEFAULT now(),
  source           text NOT NULL CHECK (source IN ('watcher', 'webhook')),
  raw              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- "The latest observation for this draft" is the only hot read this table has
-- (the T19 detector and the retention anchor both ask it). The index orders by
-- observed_at DESC then id DESC so that two observations carrying the SAME
-- observed_at — a poll and a webhook landing together, which is expected, not
-- exceptional — still have ONE deterministic newest row rather than a coin
-- flip. This index makes that ordered per-draft scan indexed; it does not and
-- cannot make the whole latest-per-draft-across-all-drafts query index-only,
-- which is a different plan shape and is not claimed here.
CREATE INDEX IF NOT EXISTS listing_status_observation_latest_idx
  ON listing_status_observation (shopify_draft_id, observed_at DESC, id DESC);

-- The T19 detector scans per shop, newest first, over app-published rows.
CREATE INDEX IF NOT EXISTS listing_status_observation_shop_idx
  ON listing_status_observation (shop_id, observed_at DESC);

COMMENT ON TABLE listing_status_observation IS
  'Commerce-owned, append-only. THE WITNESS for published/delisted/archived on the '
  '036 copy machine: a listing''s lifecycle state is derived from the newest row here, '
  'never stored. shopify_draft.status values beyond ''draft'' and ''failed'' (widened by '
  '003:157-166) are HISTORICAL and no writer moves them — shopify_draft is append-only '
  '(001:174-182), so those values have no legal writer at all. 040 §4.4; bead E02-D02.';

COMMENT ON COLUMN listing_status_observation.shopify_draft_id IS
  'The created listing this observation is about. 040 §4.4 sketches this FK against '
  '036''s listing_link; that table is unwritten, so the FK targets the row that '
  'represents a created listing today. E10-B03 adds a nullable listing_link_id '
  'alongside when listing_link lands — expand, never a rewrite.';

COMMENT ON COLUMN listing_status_observation.observed_status IS
  'The status the CHANNEL reported. 040 §4.4''s value set, verbatim. This is a '
  'report about the outside world, not a state Longbox drove: 040 F1 — nothing '
  'inside Longbox may cause ''published''.';

COMMENT ON COLUMN listing_status_observation.published_by IS
  'The channel''s actor string, stored VERBATIM as returned. 019 T19 reads rows where '
  'this indicates the app (''app'') as the auto-publish discriminator, so the value must '
  'be storable for the detector to find it. It is NEVER a value Longbox writes as '
  'itself. NULL means the channel reported no actor, which is not evidence of anything.';

COMMENT ON COLUMN listing_status_observation.observed_at IS
  'When the status was true according to the channel (040 §4.4''s external_updated_at). '
  'Distinct from created_at, which is when Longbox wrote the row; a webhook replayed '
  'hours later carries an old observed_at and a new created_at, and the derivation '
  'orders on observed_at.';

COMMENT ON COLUMN listing_status_observation.source IS
  'How Longbox came to hear it: ''watcher'' (the poller, E10-B05) or ''webhook'' '
  '(the receiver, E10-B08). Neither exists yet. 040 F1: a Longbox-originated act is '
  'never a source here.';

COMMENT ON COLUMN listing_status_observation.raw IS
  'The channel payload as received, so a disputed observation can be re-read rather '
  'than re-argued. Append-only: a corrected reading is a new row.';

-- ---------------------------------------------------------------------------
-- 2. Append-only trigger, via the 001:171-182 loop in 003:237-248's idempotent
--    DROP-then-CREATE form. UPDATE and DELETE are both refused: an observation
--    that turned out to be wrong is superseded by a newer observation, and a
--    listing's history is never edited.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['listing_status_observation'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
  END LOOP;
END $$;

COMMIT;
