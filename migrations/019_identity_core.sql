-- 019_identity_core.sql — E03-D09 (bead longbox-e5b.3.16)
--
-- 048 §10.1's **M1, identity half**: the principals every later table in this
-- cluster points at. Docs: 034 §2.2–§2.8, §2.13, §4.1–§4.4 (as amended to v1.2.0
-- by 048 §7.4); 048 §2, §3, §6.3, §10.1; 041 §2.3, §9.2; 000-docs/044 §2, §7.
--
-- WHAT IS HERE AND WHAT IS DELIBERATELY NOT.
--
-- 034 §4.1 sketches ONE migration covering tenancy AND work context — seventeen
-- ordered steps ending in `bin`, `batch`, `task` and `labor_shift`. This file
-- takes steps 1–7 and 14 only: `organization`, `location`, `app_user`,
-- `membership`(+revocation), `device`(+credential, +revocation) and the
-- `operator_id` foreign keys. **The work-context half is not this bead's** —
-- 048 §10.1 M1 lists exactly the tables above, and a batch, a bin and a derived
-- labour shift are 034 §2.9–§2.12's, gated on E04's flow rather than on
-- authentication. Splitting the file rather than the record is the honest way to
-- land half of a specification: what is missing is missing by name here, not by
-- silence, and 034 §4.1's remaining steps still read as written.
--
-- `device_credential` carries **`token_hash`, not `key_ref`** — 034 v1.2.0 §2.8,
-- amended by 048 §7.4 at ratification. A device credential is minted by the
-- system, one per phone; there is no environment variable for it to name, and
-- satisfying locked decision 2 literally would need one env var per enrolled
-- device. Locked decision 2 is untouched: it governs PROVIDER credentials, every
-- one of which still names a variable and none of which is stored.
--
-- THE ONE DATA STATEMENT is 034 §4.1 step 3 — one `organization` row per existing
-- `shop`, and the FK populated in the same transaction, so no committed state has
-- a shop with no legal party (034 §4.3, A4).
--
-- ⚠ `shop.organization_id` IS NOT `SET NOT NULL`, AND THE REASON IS A LATER RULE.
-- 034 §4.3 (A4) asks for the column to be added, populated and set `NOT NULL` in
-- one transaction. `ALTER COLUMN … SET NOT NULL` is one of the four CONTRACTING
-- shapes 000-docs/044 §2 refuses without a `-- contract:` header naming an expand
-- migration it retires and a 006 row authorising it — and this file retires
-- nothing. A4's SUBSTANCE is delivered by the equivalent that is not a contract
-- step: a validated `CHECK (organization_id IS NOT NULL)`, added after the column
-- is populated, in this same transaction. The column is nullable to `psql \d` and
-- unwritable-as-null to every writer, which is exactly the guarantee A4 asked for.
-- Converting the CHECK into a true `NOT NULL` is a one-line contract step for
-- whoever next needs the catalogue flag; it buys no guarantee this file lacks.
--
-- **034 CARRIES THE ROW, not just this header** (034 v1.3.0, §4.3; 006 row of
-- 2026-09-04). A deviation recorded only in the file that deviates is a
-- deviation the next reader of §4.3 finds as a contradiction with no reason
-- attached.
--
-- SHAPE: EXPAND ONLY, `CREATE TABLE IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS`
-- first, re-runnable by hand (000-docs/044 §7, `003`'s idempotence style).

BEGIN;

-- ---------------------------------------------------------------------------
-- 034 §2.2 — the legal and billing entity. Config, mutable. The one table in the
-- system with no `shop_id` and no need for one: it is ABOVE the shop.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  legal_name    text,
  billing_email text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shop ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organization(id);

-- 034 §4.1 step 3 — THE ONLY DATA STATEMENT IN THIS FILE. One organization per
-- existing shop, named after the shop, then the FK. It is not the kind of
-- backfill §4.4 forbids: it asserts a fact about a BUSINESS that is externally
-- checkable (the shop has an owner entity), never a fact about a person's acts.
--
-- Written as a per-row loop rather than as an `INSERT … SELECT` plus a join on
-- `name`: two shops may legitimately share a trading name, and a join on it
-- would give them one organization or none. 034 §4.5 (A4) fixes the cardinality
-- at ONE organization per shop, always — `register-shop` never reuses one and
-- offers no `--existing-org` flag, because grouping two shops under one entity
-- is a deliberate later act with its own consent consequences.
DO $$
DECLARE r record; org uuid;
BEGIN
  FOR r IN SELECT id, name FROM shop WHERE organization_id IS NULL LOOP
    INSERT INTO organization (name) VALUES (r.name) RETURNING id INTO org;
    UPDATE shop SET organization_id = org WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE shop DROP CONSTRAINT IF EXISTS shop_has_a_legal_party;
ALTER TABLE shop ADD CONSTRAINT shop_has_a_legal_party CHECK (organization_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 034 §2.4 — a physical store, or the online store. Config, mutable.
-- The online store is a LOCATION, not a boolean on `shop`: a draft created
-- against it has different custody than one created at the counter, and a
-- boolean would fork tasks, batches, devices and shifts (034 §2.4).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS location (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shop(id),   -- locked decision 4
  kind           text NOT NULL CHECK (kind IN ('store','online')),
  name           text NOT NULL,
  timezone       text NOT NULL DEFAULT 'UTC',         -- load-bearing for 034 §2.9
  address_line1  text,
  address_line2  text,
  city           text,
  region         text,
  postal_code    text,
  country        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS location_shop_idx ON location (shop_id);

-- ---------------------------------------------------------------------------
-- 034 §2.5 — a person with a login. Config, mutable.
--
-- Named `app_user` because `user` is reserved in SQL. NO `shop_id`: a person can
-- hold roles in more than one scope, and the shop-scoping of a person is
-- expressed by their memberships. Locked decision 4 scopes shop DATA; an
-- `app_user` is a PARTY.
--
-- NO CREDENTIAL COLUMN. The password hash, the MFA secret and the session token
-- are separate tables in `019` and in E03-D06 (034 §2.5, 048 §10.1 M3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','suspended','deactivated')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- The email is the login identifier and is lower-cased at write (034 §2.5).
  -- Stated as a constraint rather than as a convention: two rows differing only
  -- in case would be two people to the UNIQUE index and one person to everybody.
  CONSTRAINT app_user_email_is_lower_cased CHECK (email = lower(email))
);

-- ---------------------------------------------------------------------------
-- 034 §2.7 — the grant and its ending. Both IMMUTABLE, append-only.
--
-- Grant/release, never `supersedes_id`: a revocation says "that grant ended" —
-- the earlier row was never wrong and there is no replacement. A role change is
-- TWO rows, and the complete history of who could do what, when, and who granted
-- it is reconstructible at any timestamp, forever. That is what makes 019
-- T35(c)'s break-glass reconciliation possible at all.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS membership (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id     uuid NOT NULL REFERENCES app_user(id),
  -- Present even on an org-scoped grant, so locked decision 4 holds and every
  -- RLS policy (E03-B04) is uniform.
  shop_id         uuid NOT NULL REFERENCES shop(id),
  scope_kind      text NOT NULL CHECK (scope_kind IN ('organization','shop','location')),
  organization_id uuid REFERENCES organization(id),
  location_id     uuid REFERENCES location(id),
  -- 034 §2.6's CLOSED enum, all four members, including the one the pilot does
  -- not use. 048 §2.2: a role that exists in the schema and not in the pilot is
  -- exactly the role an implementation drops silently and a second shop
  -- discovers by being unable to express its own staffing.
  role            text NOT NULL CHECK (role IN ('owner','manager','operator','support_break_glass')),
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  granted_by      uuid REFERENCES app_user(id),
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- 041 §2.3's envelope. A grant is a human act by whoever granted it; the one
  -- exception is the bootstrap grant `register-shop` writes, which is an
  -- operator act at onboarding and still a person's.
  authored_by     text NOT NULL DEFAULT 'human'
                    CHECK (authored_by IN ('human','system','provider')),

  -- Exactly one scope column per `scope_kind` (034 §2.7).
  CONSTRAINT membership_scope_is_whole CHECK (
    (scope_kind = 'organization' AND organization_id IS NOT NULL AND location_id IS NULL) OR
    (scope_kind = 'shop'         AND organization_id IS NULL     AND location_id IS NULL) OR
    (scope_kind = 'location'     AND organization_id IS NULL     AND location_id IS NOT NULL)
  ),
  -- 034 §2.7: a break-glass grant with no expiry and no reason is the failure
  -- mode the role exists to prevent (022 P7's "no invisible super-admin").
  CONSTRAINT membership_break_glass_expires_and_says_why CHECK (
    role <> 'support_break_glass' OR (effective_until IS NOT NULL AND reason IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS membership_user_shop_idx ON membership (app_user_id, shop_id);
CREATE INDEX IF NOT EXISTS membership_shop_idx ON membership (shop_id);

CREATE TABLE IF NOT EXISTS membership_revocation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES shop(id),
  membership_id uuid NOT NULL REFERENCES membership(id),
  revoked_by    uuid REFERENCES app_user(id),
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  authored_by   text NOT NULL DEFAULT 'human'
                  CHECK (authored_by IN ('human','system','provider'))
);
-- At most one revocation per grant (034 §2.7). The UNIQUE is the mechanism, not
-- a convention: two concurrent revocations of one grant leave one row.
CREATE UNIQUE INDEX IF NOT EXISTS membership_revocation_membership_idx
  ON membership_revocation (membership_id);

-- ---------------------------------------------------------------------------
-- 034 §2.8 — the phone as an auth principal. `device` is config; the credential
-- and its revocation are immutable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shop(id),
  -- 034 I7: NOT NULL. A device belongs to exactly one location, and an
  -- enrollment that cannot name one fails rather than guessing.
  location_id uuid NOT NULL REFERENCES location(id),
  label       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('phone','kiosk','tablet')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_shop_idx ON device (shop_id);

CREATE TABLE IF NOT EXISTS device_credential (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shop(id),
  device_id   uuid NOT NULL REFERENCES device(id),
  -- 034 v1.2.0 §2.8, amended by 048 §7.4: `sha256` of a 256-bit system-minted
  -- secret. The HASH is stored; the secret never is — the same object
  -- `app_session` stores (048 §3.2). UNIQUE because it is the lookup key, and a
  -- collision would be two devices with one identity.
  token_hash  text NOT NULL UNIQUE,
  enrolled_by uuid REFERENCES app_user(id),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  authored_by text NOT NULL DEFAULT 'human'
                CHECK (authored_by IN ('human','system','provider'))
);
CREATE INDEX IF NOT EXISTS device_credential_device_idx ON device_credential (device_id);

CREATE TABLE IF NOT EXISTS device_credential_revocation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES shop(id),
  credential_id uuid NOT NULL REFERENCES device_credential(id),
  revoked_by    uuid REFERENCES app_user(id),
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  authored_by   text NOT NULL DEFAULT 'human'
                  CHECK (authored_by IN ('human','system','provider'))
);
CREATE UNIQUE INDEX IF NOT EXISTS device_credential_revocation_credential_idx
  ON device_credential_revocation (credential_id);

-- ---------------------------------------------------------------------------
-- 034 §2.13 / §4.1 step 14 — `operator_id` gains its FK target.
--
-- The four columns have existed since `003` with no target and no writer, and
-- five migrations carry a comment about the table this file creates (048 E6).
-- **NO BACKFILL, EVER** (034 §4.4): the columns stay nullable, no existing row
-- is touched, and `actor_verified` is never flipped to true for a pre-G2 row.
-- Adding a constraint is expand, not contract: it narrows nothing that any
-- current writer writes, because nothing writes these columns yet.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text; orphans bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'scan_session','human_confirmation','condition_assessment','pricing_snapshot'
  ] LOOP
    -- THE PRECONDITION IS CHECKED, NOT ASSUMED. The comment above says nothing
    -- writes these columns, and the `ALTER TABLE` below would fail anyway if a
    -- row disagreed — but it would fail with a foreign-key violation naming a
    -- constraint that did not exist a moment ago, on a migration run at 7am. A
    -- row here that names a person who is not an `app_user` is not a schema
    -- problem: it is unattributable data of unknown provenance (034 §4.4 forbids
    -- inventing one), and the operator has to decide what it is. So the refusal
    -- says that, in those words, before anything is altered.
    EXECUTE format(
      'SELECT count(*) FROM %I s WHERE s.operator_id IS NOT NULL'
      || ' AND NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = s.operator_id)', t)
      INTO orphans;
    IF orphans > 0 THEN
      RAISE EXCEPTION
        'refusing to add the operator_id foreign key: % row(s) in % name an operator that is not an '
        'app_user. Nothing in this system has ever written that column (003:44-51), so these rows came '
        'from somewhere this migration cannot account for. 034 §4.4 forbids backfilling an attribution '
        'that was never captured, so the fix is a decision and not a data edit: identify the rows, '
        'record what they are in a 000-docs/006 row, and either set them NULL or create the app_user '
        'they name.', orphans, t;
    END IF;
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_operator_is_an_app_user');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (operator_id) REFERENCES app_user(id)',
      t, t || '_operator_is_an_app_user');
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Append-only, and `ENABLE ALWAYS` in the same breath (041 §9.2 item 1, 044 §7).
-- `CREATE TRIGGER` always lands at the bypassable 'O' default, and the gate-test
-- asserts 'A' for every declared trigger — so forgetting this is a red build
-- rather than a silent hole.
--
-- The split follows 034 §4.2: `organization`, `location`, `app_user` and `device`
-- are statements about the PRESENT and are corrected in place; a grant, a
-- revocation and a minted credential are things that HAPPENED.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'membership','membership_revocation','device_credential','device_credential_revocation'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;
