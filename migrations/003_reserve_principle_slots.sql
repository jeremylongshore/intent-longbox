-- 003_reserve_principle_slots.sql — reserve every schema slot the ratified
-- workplace principles (022 P2/P3/P7) depend on, BEFORE any pilot row exists.
--
-- Why now: append-only rows are never backfillable. A column added after Pilot A
-- is a permanent hole in the record for every row written before it, so the slots
-- must exist before the first live item (E16-B05). Until this lands, 022 P7's
-- deletion sentence carries a NOT-YET-ENFORCED label on the face of the record.
--
-- Bead: longbox-e5b.2.11 (alias E02-D01). Docs: 022 P2/P3/P7, 025, 019 v1.2.0
-- T32/T33/T35, 024 §2, 014 E02-B07/E02-B10.
--
-- Shape: EXPAND ONLY. Nothing in 001_init.sql or 002 is edited. Every statement
-- is safe to re-run by hand (IF NOT EXISTS, or DROP-then-ADD for constraints and
-- triggers, which Postgres has no ADD ... IF NOT EXISTS form for).
--
-- Hickey discipline: this migration adds COLUMNS and TABLES. It never adds an
-- UPDATE path. Supersession is a new row pointing at the row it replaces;
-- deletion of a media object is a new `media_deletion` row (the event row
-- survives, the photo does not); a retention hold is released by inserting a
-- `retention_hold_release` row, never by updating the hold. That is why
-- `retention_hold` has no `released_at` column.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. scan_photo: storage key + content hash (022 P7, 024 §2 scan_photo row)
--    Today the row carries `storage_url` only. P7 requires that event rows never
--    hold image bytes and that the photo is addressable by an opaque storage key
--    plus a content hash, so that deletion can tombstone the object while the row
--    survives. Both are NULLABLE because rows written before this migration have
--    neither and are never backfilled (022 P3: no row is retro-attributed).
--    New writers MUST set both — enforced by the CHECK below, which permits the
--    legacy (NULL, NULL) shape but forbids a key with no hash.
-- ---------------------------------------------------------------------------
ALTER TABLE scan_photo ADD COLUMN IF NOT EXISTS storage_key  text;
ALTER TABLE scan_photo ADD COLUMN IF NOT EXISTS content_hash text;

ALTER TABLE scan_photo DROP CONSTRAINT IF EXISTS scan_photo_storage_key_hashed;
ALTER TABLE scan_photo ADD CONSTRAINT scan_photo_storage_key_hashed
  CHECK (storage_key IS NULL OR content_hash IS NOT NULL);

CREATE INDEX IF NOT EXISTS scan_photo_storage_key_idx ON scan_photo(storage_key);

-- ---------------------------------------------------------------------------
-- 2. Actor attribution slots (022 P3, 019 T35)
--    `operator_id` is NULLABLE and `actor_verified` defaults to FALSE precisely
--    because pre-G2 rows are aggregate-only BY CONSTRUCTION: `created_by` /
--    `confirmed_by` are client-supplied and unauthenticated (016 C4), so nothing
--    written before E03-B02 (authn) + E03-B03 (RBAC) is attributable to a person.
--    `actor_verified = false` is the durable, machine-readable statement of that.
--    No row is ever backfilled to true.
--
--    Set: the two tables that carry a free-text actor column today
--    (scan_session.created_by, human_confirmation.confirmed_by) plus the two
--    other human-authored event tables named by the bead — condition_assessment
--    and pricing_snapshot — which record a person's judgement (the condition call,
--    the price override) but carry no actor column at all today. Reserving the
--    slot on all four now is the whole point of this migration.
--
--    Reserving the column is NOT permission to render it: T35 (non-waivable)
--    holds that per-operator rendering outside the break-glass role is 0.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'scan_session','human_confirmation','condition_assessment','pricing_snapshot'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS operator_id uuid', t);
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS actor_verified boolean NOT NULL DEFAULT false', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Supersession slots + current-record read model (022 P2)
--    P2: "undo writes a superseding record; it never edits history". E05-B09
--    builds undo on these columns. A row may be superseded AT MOST ONCE — the
--    partial unique index makes a forked correction history impossible rather
--    than merely discouraged.
--    human_confirmation gets the same slot: the identity pick is as correctable
--    as the condition call, and it had no supersedes_id either.
-- ---------------------------------------------------------------------------
ALTER TABLE condition_assessment ADD COLUMN IF NOT EXISTS supersedes_id uuid;
ALTER TABLE pricing_snapshot     ADD COLUMN IF NOT EXISTS supersedes_id uuid;
ALTER TABLE human_confirmation   ADD COLUMN IF NOT EXISTS supersedes_id uuid;

ALTER TABLE condition_assessment DROP CONSTRAINT IF EXISTS condition_assessment_supersedes_fk;
ALTER TABLE condition_assessment ADD CONSTRAINT condition_assessment_supersedes_fk
  FOREIGN KEY (supersedes_id) REFERENCES condition_assessment(id);
ALTER TABLE pricing_snapshot DROP CONSTRAINT IF EXISTS pricing_snapshot_supersedes_fk;
ALTER TABLE pricing_snapshot ADD CONSTRAINT pricing_snapshot_supersedes_fk
  FOREIGN KEY (supersedes_id) REFERENCES pricing_snapshot(id);
ALTER TABLE human_confirmation DROP CONSTRAINT IF EXISTS human_confirmation_supersedes_fk;
ALTER TABLE human_confirmation ADD CONSTRAINT human_confirmation_supersedes_fk
  FOREIGN KEY (supersedes_id) REFERENCES human_confirmation(id);

-- At most one superseding row per superseded row.
CREATE UNIQUE INDEX IF NOT EXISTS condition_assessment_supersedes_once_idx
  ON condition_assessment(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pricing_snapshot_supersedes_once_idx
  ON pricing_snapshot(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS human_confirmation_supersedes_once_idx
  ON human_confirmation(supersedes_id) WHERE supersedes_id IS NOT NULL;

-- Current record = the newest row per scan_session that nothing supersedes.
-- Views are a read model over immutable history; they hold no state.
CREATE OR REPLACE VIEW condition_assessment_current AS
SELECT DISTINCT ON (c.scan_session_id) c.*
FROM condition_assessment c
WHERE NOT EXISTS (SELECT 1 FROM condition_assessment s WHERE s.supersedes_id = c.id)
ORDER BY c.scan_session_id, c.created_at DESC, c.id DESC;

CREATE OR REPLACE VIEW pricing_snapshot_current AS
SELECT DISTINCT ON (p.scan_session_id) p.*
FROM pricing_snapshot p
WHERE NOT EXISTS (SELECT 1 FROM pricing_snapshot s WHERE s.supersedes_id = p.id)
ORDER BY p.scan_session_id, p.created_at DESC, p.id DESC;

CREATE OR REPLACE VIEW human_confirmation_current AS
SELECT DISTINCT ON (h.scan_session_id) h.*
FROM human_confirmation h
WHERE NOT EXISTS (SELECT 1 FROM human_confirmation s WHERE s.supersedes_id = h.id)
ORDER BY h.scan_session_id, h.created_at DESC, h.id DESC;

-- ---------------------------------------------------------------------------
-- 4. media_deletion (022 P7; 018 C5)
--    The append-only trigger forbids DELETE on scan_photo, and that is correct:
--    the RECORD must survive. Deleting the OBJECT is therefore an appended event,
--    not a row removal. UNIQUE(storage_key) makes a sweep idempotent per object:
--    a second deletion attempt for the same key fails loudly instead of writing a
--    duplicate tombstone.
--
--    reason_code is OPEN-WORLD text with NO CHECK enum, deliberately: a deletion
--    reason we have not thought of must never be blocked by a schema constraint
--    at the moment someone is exercising a privacy right. The initial registry —
--    extend by adding a row and a line here, never by adding a CHECK:
--      retention_sweep      — the scheduled T32 sweep aged the object out
--      seller_revocation    — a walk-in seller revoked consent (5-business-day clock)
--      bystander_report     — a person in frame reported it (5-business-day clock)
--      offboarding          — shop offboarding, after export
--      legal_hold_release   — a hold was released and the object was then swept
--      other                — anything else; the requester states it in the 006 row
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_deletion (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES shop(id),
  scan_photo_id uuid NOT NULL REFERENCES scan_photo(id),
  storage_key   text NOT NULL UNIQUE,
  reason_code   text NOT NULL,
  requested_by  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_deletion_shop_idx ON media_deletion(shop_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. shopify_draft lifecycle states (022 P7 retention; 019 T19 watcher)
--    "Life of the listing" is computed from an OBSERVED lifecycle event, so the
--    T19 status watcher needs somewhere to record that a listing went away.
--    This drops and re-adds a CHECK CONSTRAINT. That is a constraint change on a
--    table whose ROWS remain append-only — no row is read, written or mutated
--    here, and the append-only trigger is untouched.
-- ---------------------------------------------------------------------------
ALTER TABLE shopify_draft DROP CONSTRAINT IF EXISTS shopify_draft_status_check;
ALTER TABLE shopify_draft ADD CONSTRAINT shopify_draft_status_check
  CHECK (status IN ('draft','published','failed','delisted','archived'));

-- ---------------------------------------------------------------------------
-- 6. Retention policy + holds (022 P7 Q6)
--    retention_policy: 022 fixes exactly three artifact classes, so a CHECK enum
--    is right here (unlike reason_code above, where the world is open). A policy
--    CHANGE is a new row — "Retention-policy changes are themselves immutable
--    rows" — so the effective policy is the newest row per (shop, class).
--    Per-shop configuration may shorten a window, never lengthen it; that rule is
--    enforced by the sweep (E03-B09), not by a constraint, because the ceiling is
--    a product rule about successive rows.
--
--    retention_hold: per-item, immutable, naming reason and review date. It has
--    NO released_at and NO status: a hold is released by appending a
--    retention_hold_release row. An open hold is one with no release row. A hold
--    with no review_date is impossible by NOT NULL (022: "a hold with no review
--    date is a T32 failure" — made unrepresentable instead of detected).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_policy (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shop(id),
  artifact_class text NOT NULL CHECK (artifact_class IN ('originals','derivatives','labor_shift')),
  -- `anchor` names the event `window_days` counts FROM. Without it the number is
  -- ambiguous and the sweep would have to hard-code a class-to-event mapping:
  -- 022 Q6 counts originals from the shopify_draft's creation, derivatives from
  -- the listing's observed end (the T19 watcher's delisted/archived), and
  -- labor_shift from shift end. 'capture' exists because a per-shop policy may
  -- shorten a window to run from capture itself.
  anchor         text NOT NULL CHECK (anchor IN ('draft_created','listing_end','shift_end','capture')),
  window_days    integer NOT NULL CHECK (window_days > 0),
  -- ceiling_days is ALWAYS measured from capture, whatever the anchor is: 022 Q6
  -- fixes the hard ceilings as "90 days from capture" and "24 months from
  -- capture", so a listing that never ends cannot hold an original forever.
  ceiling_days   integer NOT NULL CHECK (ceiling_days > 0),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retention_policy_shop_class_idx
  ON retention_policy(shop_id, artifact_class, created_at DESC);

CREATE TABLE IF NOT EXISTS retention_hold (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES shop(id),
  -- The target is polymorphic, so NO foreign key is possible and the CHECK is
  -- the only thing keeping `target_table` from drifting into free text. It also
  -- means NOTHING IN THE DATABASE VERIFIES TENANCY HERE: the sweep (E03-B09)
  -- MUST read the target row and confirm its shop_id equals this hold's shop_id
  -- before honouring the hold, or a hold naming another shop's row would exempt
  -- it from that shop's sweep (T24 tenant isolation, non-waivable).
  target_table text NOT NULL
    CHECK (target_table IN ('scan_session','scan_photo','shopify_draft','labor_shift')),
  target_id    uuid NOT NULL,
  reason       text NOT NULL,
  review_date  date NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retention_hold_target_idx ON retention_hold(target_table, target_id);
CREATE INDEX IF NOT EXISTS retention_hold_shop_idx ON retention_hold(shop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS retention_hold_release (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id     uuid NOT NULL REFERENCES retention_hold(id),
  released_by text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- A hold is released at most once; a second release is a duplicate, not history.
CREATE UNIQUE INDEX IF NOT EXISTS retention_hold_release_once_idx
  ON retention_hold_release(hold_id);

-- ---------------------------------------------------------------------------
-- 7. Append-only triggers on the new tables (same forbid_mutation() as 001)
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'media_deletion','retention_policy','retention_hold','retention_hold_release'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Seed the three default retention policies for every existing shop.
--    022 Q6: originals 30 days from the draft's creation / 90-day ceiling from
--    capture; derivatives 90 days after the listing's observed end / 24-month
--    (730-day) ceiling from capture; labor_shift 730 days from shift end (its own
--    window and anchor — a labor record's lifetime must not depend on a Shopify
--    listing's). The anchor travels with the window; every ceiling is from capture.
--    Guarded by NOT EXISTS rather than a unique key: (shop_id, artifact_class)
--    must NOT be unique, because a policy change is a new row for the same pair.
--    scripts/register-shop.ts seeds the same three rows for new shops.
-- ---------------------------------------------------------------------------
INSERT INTO retention_policy (shop_id, artifact_class, anchor, window_days, ceiling_days)
SELECT s.id, d.artifact_class, d.anchor, d.window_days, d.ceiling_days
FROM shop s
CROSS JOIN (VALUES
  ('originals',   'draft_created', 30,  90),
  ('derivatives', 'listing_end',   90,  730),
  ('labor_shift', 'shift_end',     730, 730)
) AS d(artifact_class, anchor, window_days, ceiling_days)
WHERE NOT EXISTS (
  SELECT 1 FROM retention_policy rp
  WHERE rp.shop_id = s.id AND rp.artifact_class = d.artifact_class
);

COMMIT;
