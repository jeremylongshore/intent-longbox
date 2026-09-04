-- 021_shop_credential_version.sql — E03-B05 (bead longbox-e5b.3.5), the code half.
--
-- 050 §2 Q2, §4, §10 row 1: **rotation is a fact, not an edit.** Docs: 050 §2 Q2
-- (the ruling), §4 (the shape), §9 I2/I3, §10; 041 §2.3 (`authored_by`), §8 (a
-- deletion is a row, never a mutation), §10.1; 044 §2 (expand-only), §7; 048
-- §3.5 (the RULE on attribution); CLAUDE.md locked decisions 2 and 4.
--
-- WHAT WAS BROKEN, REPRODUCED IN 050 §1 E10. `shop_credentials` holds one row
-- per `(shop_id, kind)` and the resolver read `ORDER BY created_at DESC LIMIT 1`.
-- A second row was therefore not a VERSION — it was a shadow the system silently
-- ignored. There was no record that a key had ever changed, no time at which it
-- changed, and nobody to attribute the change to. A rotation that leaves no
-- trace is indistinguishable from no rotation, which is the worse of the two
-- readings: the shop believes it rotated.
--
-- WHY A SECOND TABLE RATHER THAN `retired_at` ON THIS ONE (050 A3). Setting
-- `retired_at` is an UPDATE, and `forbid_mutation()` refuses it — correctly.
-- Retirement is therefore its own fact, in `022_shop_credential_retirement.sql`,
-- exactly as 041 §8 makes a deletion a `media_deletion` row and a hold's release
-- a `retention_hold_release` row. **Liveness is a predicate over the two tables,
-- computed at read time, with no status column and no cache** — the same
-- construction 043 uses for the outbox and 048 for a session, and for the same
-- reason: a cached liveness is a retired credential still working.
--
-- ⚠ THIS TABLE HOLDS A NAME, NEVER A VALUE. `key_ref` is the NAME of a process
-- environment variable and carries the same CHECK as `shop_credentials.key_ref`
-- (`014`). Locked decision 2 — *raw keys never in the database* — is why there is
-- no `secret`, no `ciphertext` and no `envelope_key_id` column here, and 050 §2
-- Q1 rejects the encrypted-column design outright: the database is backed up to
-- Backblaze B2 under Object Lock (governance, 30 days), so a key written to a
-- column on Monday sits in an immutable offsite copy that cannot be deleted
-- until thirty days after the shop revoked it. A credential store whose
-- deletions take thirty days to become true is not a credential store.
--
-- `authored_by` IS AN ATTRIBUTION OF RECORD AND NOTHING STRONGER (048 §3.5's
-- RULE, which 050 §2 Q2 adopts without amendment). A person who watched another
-- person's PIN can introduce a credential version, and this row will say it was
-- theirs. No artifact, dissent, registered claim or partner-facing sentence may
-- describe this column as non-repudiable or as proof of who rotated a key.
--
-- SHAPE: EXPAND ONLY. One new table, one new index, one INSERT … SELECT …
-- ON CONFLICT DO NOTHING. `CREATE TABLE IF NOT EXISTS`, re-runnable by hand,
-- no `-- contract:` header because it retires nothing (044 §2).

BEGIN;

CREATE TABLE IF NOT EXISTS shop_credential_version (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES shop(id),          -- locked decision 4
  kind          text NOT NULL
                  CHECK (kind IN ('anthropic','openai_compat','shopify','pricecharting','ebay')),
  -- The same shape `014` fixes on `shop_credentials.key_ref`, restated rather
  -- than referenced because a CHECK cannot be shared: `LONGBOX_` + exactly ONE
  -- slug segment carrying no underscore + one of six closed suffixes. The
  -- single-segment rule is what makes the sibling-slug name
  -- `LONGBOX_GOTHAM_CITY_ANTHROPIC_KEY` unrepresentable for shop `gotham`
  -- (046 §5 A7). `tests/contract/credential-namespace.test.ts` asserts this
  -- pattern equals `KEY_REF_PATTERN` in `src/providers/credentialPolicy.ts`, so
  -- the two cannot drift without a red build.
  key_ref       text NOT NULL
                  CHECK (key_ref ~ '^LONGBOX_[A-Z0-9]+_(ANTHROPIC|OPENAI|SHOPIFY|PRICECHARTING|EBAY)_KEY(_SECRET)?$'),
  version_no    integer NOT NULL CHECK (version_no >= 1),
  introduced_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- 041 §2.3 / §10.1's envelope half that applies here. `session_seq` is
  -- deliberately ABSENT and its absence is declared on the row in
  -- `src/db/appendOnlyTables.ts`: a credential rotation is not session-scoped,
  -- and ordering it by one scan's counter would be the claim 041 §2.0 declines
  -- to make ("above a session … nothing orders anything").
  authored_by   text NOT NULL DEFAULT 'human'
                  CHECK (authored_by IN ('human','system','provider')),
  -- 050 §4: a second introduction of the same version number for one
  -- (shop, kind) fails loudly rather than writing an ambiguous pair.
  UNIQUE (shop_id, kind, version_no)
);

COMMENT ON TABLE shop_credential_version IS
  'An INTRODUCTION of a credential version (050 §4). Append-only. Holds the NAME of an '
  'environment variable and never a value (locked decision 2). Retirement is a row in '
  'shop_credential_retirement, never an edit here; liveness is the predicate '
  '"has an introduction and no retirement" and is never a column.';

COMMENT ON COLUMN shop_credential_version.authored_by IS
  'An attribution of record and nothing stronger (048 §3.5 RULE, adopted by 050 §2 Q2). '
  'NOT non-repudiable: a person who watched a PIN can introduce a version and this column '
  'will name them.';

-- The resolver's only ordering: newest live version for (shop, kind).
CREATE INDEX IF NOT EXISTS shop_credential_version_lookup_idx
  ON shop_credential_version (shop_id, kind, version_no DESC);

-- ---------------------------------------------------------------------------
-- The existing configuration becomes version 1, and this is a RE-SHAPING of a
-- record rather than an invention of one.
--
-- WHY BACKFILL AT ALL, when 041 §5.3 refuses to backfill `session_seq`. The two
-- are different acts. Backfilling `session_seq` would fabricate an ORDER nobody
-- observed. This backfills a fact `shop_credentials` already holds and states
-- plainly: *this shop declared this key_ref, as of the moment that row was
-- written.* Nothing is guessed — `introduced_at` is the config row's own
-- `created_at`, and `authored_by` is `'system'` because the MIGRATION authored
-- these rows, not a person.
--
-- WHY IT IS LOAD-BEARING RATHER THAN TIDY. From `022` onward the resolver reads
-- liveness from these tables (050 §4: `shop_credentials` "stops being read").
-- 050 §1 E4's rule — a shop that has DECLARED a credential resolves it or fails
-- loudly, and never borrows the estate's key — would silently regress for every
-- already-configured shop if their declarations did not arrive here. So the
-- backfill is what keeps E4 true across the cutover.
--
-- `ON CONFLICT DO NOTHING` on the natural key makes it re-runnable by hand
-- (044 §2) and makes a second run a no-op rather than a second version.
-- ---------------------------------------------------------------------------
INSERT INTO shop_credential_version (shop_id, kind, key_ref, version_no, introduced_at, authored_by)
SELECT c.shop_id, c.kind, c.key_ref, 1, c.created_at, 'system'
  FROM shop_credentials c
 WHERE c.key_ref ~ '^LONGBOX_[A-Z0-9]+_(ANTHROPIC|OPENAI|SHOPIFY|PRICECHARTING|EBAY)_KEY(_SECRET)?$'
ON CONFLICT (shop_id, kind, version_no) DO NOTHING;

-- ---------------------------------------------------------------------------
-- `shop_credentials` is DEPRECATED for key_ref and liveness, and is NOT dropped.
--
-- 034 §2.13's reasoning for `created_by` applies unchanged: the existing rows are
-- the record of what the pre-rotation system was configured with. Dropping the
-- table is a CONTRACT step under 044 §2, needs its own `-- contract:` header and
-- its own `000-docs/006` row, and is explicitly not this bead's (050 §4, §10).
--
-- ⚠ ONE COLUMN IS STILL READ, AND SAYING SO IS THE POINT. `base_url` has no
-- counterpart on `shop_credential_version` — 050 §4's shape does not give it one
-- and §10 lists no migration that would — so the host a credential may be sent
-- to is still read from this table. Deciding where `base_url` lives after the
-- contract step is left to whoever writes it; inventing the column here would be
-- settling a question 050 did not put to the cannon.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE shop_credentials IS
  'DEPRECATED for key_ref and liveness by 050 §4 (E03-B05): the authority for WHICH env var '
  'name a shop uses, and whether it is live, is shop_credential_version + '
  'shop_credential_retirement. `base_url` is still read from here because the version table '
  'has no host column. Not dropped: these rows record what the pre-rotation system was '
  'configured with (034 §2.13). Dropping it is a later CONTRACT step (044 §2) with its own '
  '000-docs/006 row.';

COMMIT;
