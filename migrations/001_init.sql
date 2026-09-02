-- 001_init.sql — Hickey model, v0 core.
-- Config tables (shop / shop_credentials / shop_pricing_policy) are mutable-by-append:
-- policy changes append a new row; old rows are kept.
-- Event tables are IMMUTABLE: append-only, enforced by trigger (no UPDATE/DELETE).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Append-only enforcement trigger (P0: the Hickey model is non-negotiable)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (Hickey model): % not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Config (shop-scoped, mutable identity / append-per-change)
-- ---------------------------------------------------------------------------
CREATE TABLE shop (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  slug           text NOT NULL UNIQUE,
  shopify_domain text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop_credentials (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shop(id),
  kind       text NOT NULL CHECK (kind IN ('anthropic','openai_compat','shopify','pricecharting')),
  -- key_ref is the NAME of an env/SOPS reference. NEVER a raw key.
  key_ref    text NOT NULL,
  base_url   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shop_credentials_shop_kind_idx ON shop_credentials(shop_id, kind, created_at DESC);

CREATE TABLE shop_pricing_policy (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shop(id),
  comp_percent   integer NOT NULL DEFAULT 100 CHECK (comp_percent > 0),
  floor_cents    integer NOT NULL DEFAULT 0 CHECK (floor_cents >= 0),
  rounding_rule  text NOT NULL DEFAULT 'nearest_99' CHECK (rounding_rule IN ('none','whole_dollar','nearest_99')),
  effective_from timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shop_pricing_policy_shop_idx ON shop_pricing_policy(shop_id, effective_from DESC);

-- ---------------------------------------------------------------------------
-- Corpus (immutable versioned snapshots)
-- ---------------------------------------------------------------------------
CREATE TABLE corpus_version (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_set jsonb NOT NULL DEFAULT '{}'::jsonb, -- e.g. {"gcd_dump_date":"...","metron_sync_date":"..."}
  built_at   timestamptz NOT NULL DEFAULT now(),
  notes      text
);

-- ---------------------------------------------------------------------------
-- Scan session identity + immutable event tables
-- ---------------------------------------------------------------------------
CREATE TABLE scan_session (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shop(id),
  created_by text NOT NULL DEFAULT 'employee',
  status     text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','confirmed','drafted','abandoned')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scan_session_shop_idx ON scan_session(shop_id, created_at DESC);

CREATE TABLE scan_photo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_session_id uuid NOT NULL REFERENCES scan_session(id),
  shop_id         uuid NOT NULL REFERENCES shop(id),
  kind            text NOT NULL CHECK (kind IN ('cover','barcode','defect')),
  storage_url     text NOT NULL,
  taken_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidate_set (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_session_id   uuid NOT NULL REFERENCES scan_session(id),
  shop_id           uuid NOT NULL REFERENCES shop(id),
  corpus_version_id uuid REFERENCES corpus_version(id),
  method            text NOT NULL CHECK (method IN ('barcode','llm_vision','ximilar','index')),
  candidates        jsonb NOT NULL DEFAULT '[]'::jsonb,
  barcode_raw       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE llm_rerank (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_set_id uuid NOT NULL REFERENCES candidate_set(id),
  scan_session_id  uuid NOT NULL REFERENCES scan_session(id),
  shop_id          uuid NOT NULL REFERENCES shop(id),
  provider         text NOT NULL,
  model            text NOT NULL,
  prompt_hash      text NOT NULL,
  response         jsonb NOT NULL,
  confidence       real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  band             text NOT NULL CHECK (band IN ('high','medium','low')),
  contradiction    boolean NOT NULL DEFAULT false,
  tokens_in        integer NOT NULL DEFAULT 0,
  tokens_out       integer NOT NULL DEFAULT 0,
  cost_usd         numeric(12,6) NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE human_confirmation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_session_id    uuid NOT NULL REFERENCES scan_session(id),
  shop_id            uuid NOT NULL REFERENCES shop(id),
  confirmed_issue    jsonb NOT NULL, -- issue ref (candidate payload or manual entry); corpus FK when corpus lands
  source             text NOT NULL CHECK (source IN ('one_tap','grid_pick','manual_search','owner_review')),
  confirmed_by       text NOT NULL DEFAULT 'employee',
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Condition is NEVER numeric: label enums for range bounds, defect callouts.
CREATE TABLE condition_assessment (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_session_id  uuid NOT NULL REFERENCES scan_session(id),
  shop_id          uuid NOT NULL REFERENCES shop(id),
  grade_range_low  text NOT NULL CHECK (grade_range_low  IN ('PR','FR','GD','VG','FN','VF','NM')),
  grade_range_high text NOT NULL CHECK (grade_range_high IN ('PR','FR','GD','VG','FN','VF','NM')),
  defects          text[] NOT NULL DEFAULT '{}',
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pricing_snapshot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_session_id uuid NOT NULL REFERENCES scan_session(id),
  shop_id         uuid NOT NULL REFERENCES shop(id),
  source          text NOT NULL DEFAULT 'pricecharting',
  query           text NOT NULL,
  comps           jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_cents integer NOT NULL,
  override_cents  integer,
  policy_id       uuid REFERENCES shop_pricing_policy(id),
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shopify_draft (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_session_id uuid NOT NULL REFERENCES scan_session(id),
  shop_id         uuid NOT NULL REFERENCES shop(id),
  product_gid     text,
  status          text NOT NULL CHECK (status IN ('draft','published','failed')),
  error           jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Per-call cost log (R13: from day one)
CREATE TABLE cost_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shop(id),
  scan_session_id uuid REFERENCES scan_session(id),
  provider        text NOT NULL,
  model           text NOT NULL,
  tokens_in       integer NOT NULL DEFAULT 0,
  tokens_out      integer NOT NULL DEFAULT 0,
  estimated_usd   numeric(12,6) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Attach append-only triggers to every immutable table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'corpus_version','scan_photo','candidate_set','llm_rerank','human_confirmation',
    'condition_assessment','pricing_snapshot','shopify_draft','cost_log'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t, t);
  END LOOP;
END $$;

COMMIT;
