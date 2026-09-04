-- GENERATED FIXTURE — do not hand-edit.
-- The schema and seed of intent-longbox at migration 006, dumped with
--   pnpm fixture:schema --upto 006 --out tests/fixtures/schema/after-006.sql
-- Restored by tests/integration/prior-snapshot-upgrade.test.ts, which then runs
-- `pnpm migrate` forward and asserts the append-only trigger set is 'A' and the
-- grant step succeeds (000-docs/044 §3). Regenerate only when THIS release's
-- schema is what changed; a diff here otherwise means a shipped migration was
-- edited, which is the thing the ledger checksum refuses.
--
-- PostgreSQL database dump
--

\restrict p3zgTJRyJdH19guGyQ8q4TJtAtj58O45NQ3kCenvqkcxK5SgwmaMTisIZw55vxd


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "public";


--
-- Name: forbid_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."forbid_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (Hickey model): % not allowed', TG_TABLE_NAME, TG_OP;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: candidate_set; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."candidate_set" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scan_session_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "corpus_version_id" "uuid",
    "method" "text" NOT NULL,
    "candidates" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "barcode_raw" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "candidate_set_method_check" CHECK (("method" = ANY (ARRAY['barcode'::"text", 'llm_vision'::"text", 'ximilar'::"text", 'index'::"text"])))
);


--
-- Name: condition_assessment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."condition_assessment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scan_session_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "grade_range_low" "text" NOT NULL,
    "grade_range_high" "text" NOT NULL,
    "defects" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "operator_id" "uuid",
    "actor_verified" boolean DEFAULT false NOT NULL,
    "supersedes_id" "uuid",
    CONSTRAINT "condition_assessment_grade_range_high_check" CHECK (("grade_range_high" = ANY (ARRAY['PR'::"text", 'FR'::"text", 'GD'::"text", 'VG'::"text", 'FN'::"text", 'VF'::"text", 'NM'::"text"]))),
    CONSTRAINT "condition_assessment_grade_range_low_check" CHECK (("grade_range_low" = ANY (ARRAY['PR'::"text", 'FR'::"text", 'GD'::"text", 'VG'::"text", 'FN'::"text", 'VF'::"text", 'NM'::"text"])))
);


--
-- Name: condition_assessment_current; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW "public"."condition_assessment_current" AS
 SELECT DISTINCT ON ("scan_session_id") "id",
    "scan_session_id",
    "shop_id",
    "grade_range_low",
    "grade_range_high",
    "defects",
    "notes",
    "created_at",
    "operator_id",
    "actor_verified",
    "supersedes_id"
   FROM "public"."condition_assessment" "c"
  WHERE (NOT (EXISTS ( SELECT 1
           FROM "public"."condition_assessment" "s"
          WHERE ("s"."supersedes_id" = "c"."id"))))
  ORDER BY "scan_session_id", "created_at" DESC, "id" DESC;


--
-- Name: corpus_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."corpus_version" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_set" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "built_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text"
);


--
-- Name: cost_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."cost_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "scan_session_id" "uuid",
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "tokens_in" integer DEFAULT 0 NOT NULL,
    "tokens_out" integer DEFAULT 0 NOT NULL,
    "estimated_usd" numeric(12,6) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: human_confirmation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."human_confirmation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scan_session_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "confirmed_issue" "jsonb" NOT NULL,
    "source" "text" NOT NULL,
    "confirmed_by" "text" DEFAULT 'employee'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "operator_id" "uuid",
    "actor_verified" boolean DEFAULT false NOT NULL,
    "supersedes_id" "uuid",
    "outcome" "text",
    CONSTRAINT "human_confirmation_outcome_check" CHECK ((("outcome" IS NULL) OR ("outcome" = ANY (ARRAY['confirm'::"text", 'correct'::"text"])))),
    CONSTRAINT "human_confirmation_source_check" CHECK (("source" = ANY (ARRAY['one_tap'::"text", 'grid_pick'::"text", 'manual_search'::"text", 'owner_review'::"text"])))
);


--
-- Name: human_confirmation_current; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW "public"."human_confirmation_current" AS
 SELECT DISTINCT ON ("scan_session_id") "id",
    "scan_session_id",
    "shop_id",
    "confirmed_issue",
    "source",
    "confirmed_by",
    "created_at",
    "operator_id",
    "actor_verified",
    "supersedes_id",
    "outcome"
   FROM "public"."human_confirmation" "h"
  WHERE (NOT (EXISTS ( SELECT 1
           FROM "public"."human_confirmation" "s"
          WHERE ("s"."supersedes_id" = "h"."id"))))
  ORDER BY "scan_session_id", "created_at" DESC, "id" DESC;


--
-- Name: listing_status_observation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."listing_status_observation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "shopify_draft_id" "uuid" NOT NULL,
    "observed_status" "text" NOT NULL,
    "published_by" "text",
    "observed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" NOT NULL,
    "raw" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "listing_status_observation_observed_status_check" CHECK (("observed_status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'delisted'::"text", 'archived'::"text", 'deleted'::"text"]))),
    CONSTRAINT "listing_status_observation_source_check" CHECK (("source" = ANY (ARRAY['watcher'::"text", 'webhook'::"text"])))
);


--
-- Name: llm_rerank; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."llm_rerank" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "candidate_set_id" "uuid" NOT NULL,
    "scan_session_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "prompt_hash" "text" NOT NULL,
    "response" "jsonb" NOT NULL,
    "confidence" real NOT NULL,
    "band" "text" NOT NULL,
    "contradiction" boolean DEFAULT false NOT NULL,
    "tokens_in" integer DEFAULT 0 NOT NULL,
    "tokens_out" integer DEFAULT 0 NOT NULL,
    "cost_usd" numeric(12,6) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "llm_rerank_band_check" CHECK (("band" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"]))),
    CONSTRAINT "llm_rerank_confidence_check" CHECK ((("confidence" >= (0)::double precision) AND ("confidence" <= (1)::double precision)))
);


--
-- Name: media_deletion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."media_deletion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "scan_photo_id" "uuid" NOT NULL,
    "storage_key" "text" NOT NULL,
    "reason_code" "text" NOT NULL,
    "requested_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: pricing_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."pricing_snapshot" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scan_session_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'pricecharting'::"text" NOT NULL,
    "query" "text" NOT NULL,
    "comps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "suggested_cents" integer NOT NULL,
    "override_cents" integer,
    "policy_id" "uuid",
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "operator_id" "uuid",
    "actor_verified" boolean DEFAULT false NOT NULL,
    "supersedes_id" "uuid"
);


--
-- Name: pricing_snapshot_current; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW "public"."pricing_snapshot_current" AS
 SELECT DISTINCT ON ("scan_session_id") "id",
    "scan_session_id",
    "shop_id",
    "source",
    "query",
    "comps",
    "suggested_cents",
    "override_cents",
    "policy_id",
    "fetched_at",
    "created_at",
    "operator_id",
    "actor_verified",
    "supersedes_id"
   FROM "public"."pricing_snapshot" "p"
  WHERE (NOT (EXISTS ( SELECT 1
           FROM "public"."pricing_snapshot" "s"
          WHERE ("s"."supersedes_id" = "p"."id"))))
  ORDER BY "scan_session_id", "created_at" DESC, "id" DESC;


--
-- Name: retention_hold; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."retention_hold" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "target_table" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "review_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "retention_hold_target_table_check" CHECK (("target_table" = ANY (ARRAY['scan_session'::"text", 'scan_photo'::"text", 'shopify_draft'::"text", 'labor_shift'::"text"])))
);


--
-- Name: retention_hold_release; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."retention_hold_release" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hold_id" "uuid" NOT NULL,
    "released_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: retention_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."retention_policy" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "artifact_class" "text" NOT NULL,
    "anchor" "text" NOT NULL,
    "window_days" integer NOT NULL,
    "ceiling_days" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "retention_policy_anchor_check" CHECK (("anchor" = ANY (ARRAY['draft_created'::"text", 'listing_end'::"text", 'shift_end'::"text", 'capture'::"text"]))),
    CONSTRAINT "retention_policy_artifact_class_check" CHECK (("artifact_class" = ANY (ARRAY['originals'::"text", 'derivatives'::"text", 'labor_shift'::"text"]))),
    CONSTRAINT "retention_policy_ceiling_days_check" CHECK (("ceiling_days" > 0)),
    CONSTRAINT "retention_policy_window_days_check" CHECK (("window_days" > 0))
);


--
-- Name: scan_photo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."scan_photo" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scan_session_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "storage_url" "text" NOT NULL,
    "taken_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "storage_key" "text",
    "content_hash" "text",
    CONSTRAINT "scan_photo_kind_check" CHECK (("kind" = ANY (ARRAY['cover'::"text", 'barcode'::"text", 'defect'::"text"]))),
    CONSTRAINT "scan_photo_storage_key_hashed" CHECK ((("storage_key" IS NULL) OR ("content_hash" IS NOT NULL)))
);


--
-- Name: scan_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."scan_session" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "created_by" "text" DEFAULT 'employee'::"text" NOT NULL,
    "status" "text" DEFAULT 'in_progress'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "operator_id" "uuid",
    "actor_verified" boolean DEFAULT false NOT NULL,
    CONSTRAINT "scan_session_status_check" CHECK (("status" = ANY (ARRAY['in_progress'::"text", 'confirmed'::"text", 'drafted'::"text", 'abandoned'::"text"])))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."schema_migrations" (
    "filename" "text" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: shop; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."shop" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "shopify_domain" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: shop_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."shop_credentials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "key_ref" "text" NOT NULL,
    "base_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shop_credentials_kind_check" CHECK (("kind" = ANY (ARRAY['anthropic'::"text", 'openai_compat'::"text", 'shopify'::"text", 'pricecharting'::"text", 'ebay'::"text"])))
);


--
-- Name: shop_pricing_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."shop_pricing_policy" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "comp_percent" integer DEFAULT 100 NOT NULL,
    "floor_cents" integer DEFAULT 0 NOT NULL,
    "rounding_rule" "text" DEFAULT 'nearest_99'::"text" NOT NULL,
    "effective_from" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shop_pricing_policy_comp_percent_check" CHECK (("comp_percent" > 0)),
    CONSTRAINT "shop_pricing_policy_floor_cents_check" CHECK (("floor_cents" >= 0)),
    CONSTRAINT "shop_pricing_policy_rounding_rule_check" CHECK (("rounding_rule" = ANY (ARRAY['none'::"text", 'whole_dollar'::"text", 'nearest_99'::"text"])))
);


--
-- Name: shopify_draft; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."shopify_draft" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scan_session_id" "uuid" NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "product_gid" "text",
    "status" "text" NOT NULL,
    "error" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shopify_draft_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'failed'::"text", 'delisted'::"text", 'archived'::"text"])))
);


--
-- Data for Name: candidate_set; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."candidate_set" ("id", "scan_session_id", "shop_id", "corpus_version_id", "method", "candidates", "barcode_raw", "created_at") FROM stdin;
44444444-4444-4444-8444-444444444441	22222222-2222-4222-8222-222222222221	11111111-1111-4111-8111-111111111111	\N	barcode	[]	\N	2026-09-04 11:00:24.330898+00
44444444-4444-4444-8444-444444444442	22222222-2222-4222-8222-222222222221	11111111-1111-4111-8111-111111111111	\N	llm_vision	[]	\N	2026-09-04 11:00:24.330898+00
\.


--
-- Data for Name: condition_assessment; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."condition_assessment" ("id", "scan_session_id", "shop_id", "grade_range_low", "grade_range_high", "defects", "notes", "created_at", "operator_id", "actor_verified", "supersedes_id") FROM stdin;
66666666-6666-4666-8666-666666666661	22222222-2222-4222-8222-222222222221	11111111-1111-4111-8111-111111111111	VG	FN	{}	\N	2026-09-04 11:00:24.330898+00	\N	f	\N
\.


--
-- Data for Name: corpus_version; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."corpus_version" ("id", "source_set", "built_at", "notes") FROM stdin;
\.


--
-- Data for Name: cost_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."cost_log" ("id", "shop_id", "scan_session_id", "provider", "model", "tokens_in", "tokens_out", "estimated_usd", "created_at") FROM stdin;
77777777-7777-4777-8777-777777777771	11111111-1111-4111-8111-111111111111	22222222-2222-4222-8222-222222222221	anthropic	claude-sonnet-5	100	20	0.001200	2026-09-04 11:00:24.330898+00
\.


--
-- Data for Name: human_confirmation; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."human_confirmation" ("id", "scan_session_id", "shop_id", "confirmed_issue", "source", "confirmed_by", "created_at", "operator_id", "actor_verified", "supersedes_id", "outcome") FROM stdin;
55555555-5555-4555-8555-555555555551	22222222-2222-4222-8222-222222222221	11111111-1111-4111-8111-111111111111	{"issue": "1", "title": "Fixture"}	one_tap	fixture-operator	2026-09-04 11:00:24.330898+00	\N	f	\N	\N
\.


--
-- Data for Name: listing_status_observation; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."listing_status_observation" ("id", "shop_id", "shopify_draft_id", "observed_status", "published_by", "observed_at", "source", "raw", "created_at") FROM stdin;
\.


--
-- Data for Name: llm_rerank; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."llm_rerank" ("id", "candidate_set_id", "scan_session_id", "shop_id", "provider", "model", "prompt_hash", "response", "confidence", "band", "contradiction", "tokens_in", "tokens_out", "cost_usd", "created_at") FROM stdin;
\.


--
-- Data for Name: media_deletion; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."media_deletion" ("id", "shop_id", "scan_photo_id", "storage_key", "reason_code", "requested_by", "created_at") FROM stdin;
\.


--
-- Data for Name: pricing_snapshot; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."pricing_snapshot" ("id", "scan_session_id", "shop_id", "source", "query", "comps", "suggested_cents", "override_cents", "policy_id", "fetched_at", "created_at", "operator_id", "actor_verified", "supersedes_id") FROM stdin;
\.


--
-- Data for Name: retention_hold; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."retention_hold" ("id", "shop_id", "target_table", "target_id", "reason", "review_date", "created_at") FROM stdin;
\.


--
-- Data for Name: retention_hold_release; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."retention_hold_release" ("id", "hold_id", "released_by", "created_at") FROM stdin;
\.


--
-- Data for Name: retention_policy; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."retention_policy" ("id", "shop_id", "artifact_class", "anchor", "window_days", "ceiling_days", "created_at") FROM stdin;
\.


--
-- Data for Name: scan_photo; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."scan_photo" ("id", "scan_session_id", "shop_id", "kind", "storage_url", "taken_at", "storage_key", "content_hash") FROM stdin;
33333333-3333-4333-8333-333333333331	22222222-2222-4222-8222-222222222221	11111111-1111-4111-8111-111111111111	cover	file:///fixture/cover.jpg	2026-09-04 11:00:24.330898+00	\N	\N
\.


--
-- Data for Name: scan_session; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."scan_session" ("id", "shop_id", "created_by", "status", "created_at", "operator_id", "actor_verified") FROM stdin;
22222222-2222-4222-8222-222222222221	11111111-1111-4111-8111-111111111111	fixture-operator	in_progress	2026-09-04 11:00:24.330898+00	\N	f
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."schema_migrations" ("filename", "applied_at") FROM stdin;
001_init.sql	2026-09-04 11:00:24.1864+00
002_ebay_credential_kind.sql	2026-09-04 11:00:24.19773+00
003_reserve_principle_slots.sql	2026-09-04 11:00:24.28278+00
004_human_confirmation_outcome.sql	2026-09-04 11:00:24.295356+00
005_listing_status_observation.sql	2026-09-04 11:00:24.319054+00
006_append_only_enable_always.sql	2026-09-04 11:00:24.328433+00
\.


--
-- Data for Name: shop; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."shop" ("id", "name", "slug", "shopify_domain", "created_at") FROM stdin;
11111111-1111-4111-8111-111111111111	Fixture Comics	fixture-comics	\N	2026-09-04 11:00:24.330898+00
\.


--
-- Data for Name: shop_credentials; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."shop_credentials" ("id", "shop_id", "kind", "key_ref", "base_url", "created_at") FROM stdin;
\.


--
-- Data for Name: shop_pricing_policy; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."shop_pricing_policy" ("id", "shop_id", "comp_percent", "floor_cents", "rounding_rule", "effective_from") FROM stdin;
11111111-1111-4111-8111-111111111112	11111111-1111-4111-8111-111111111111	90	300	nearest_99	2026-09-04 11:00:24.330898+00
\.


--
-- Data for Name: shopify_draft; Type: TABLE DATA; Schema: public; Owner: -
--

COPY "public"."shopify_draft" ("id", "scan_session_id", "shop_id", "product_gid", "status", "error", "created_at") FROM stdin;
\.


--
-- Name: candidate_set candidate_set_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."candidate_set"
    ADD CONSTRAINT "candidate_set_pkey" PRIMARY KEY ("id");


--
-- Name: condition_assessment condition_assessment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."condition_assessment"
    ADD CONSTRAINT "condition_assessment_pkey" PRIMARY KEY ("id");


--
-- Name: corpus_version corpus_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."corpus_version"
    ADD CONSTRAINT "corpus_version_pkey" PRIMARY KEY ("id");


--
-- Name: cost_log cost_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cost_log"
    ADD CONSTRAINT "cost_log_pkey" PRIMARY KEY ("id");


--
-- Name: human_confirmation human_confirmation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."human_confirmation"
    ADD CONSTRAINT "human_confirmation_pkey" PRIMARY KEY ("id");


--
-- Name: listing_status_observation listing_status_observation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."listing_status_observation"
    ADD CONSTRAINT "listing_status_observation_pkey" PRIMARY KEY ("id");


--
-- Name: llm_rerank llm_rerank_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."llm_rerank"
    ADD CONSTRAINT "llm_rerank_pkey" PRIMARY KEY ("id");


--
-- Name: media_deletion media_deletion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."media_deletion"
    ADD CONSTRAINT "media_deletion_pkey" PRIMARY KEY ("id");


--
-- Name: media_deletion media_deletion_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."media_deletion"
    ADD CONSTRAINT "media_deletion_storage_key_key" UNIQUE ("storage_key");


--
-- Name: pricing_snapshot pricing_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pricing_snapshot"
    ADD CONSTRAINT "pricing_snapshot_pkey" PRIMARY KEY ("id");


--
-- Name: retention_hold retention_hold_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."retention_hold"
    ADD CONSTRAINT "retention_hold_pkey" PRIMARY KEY ("id");


--
-- Name: retention_hold_release retention_hold_release_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."retention_hold_release"
    ADD CONSTRAINT "retention_hold_release_pkey" PRIMARY KEY ("id");


--
-- Name: retention_policy retention_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."retention_policy"
    ADD CONSTRAINT "retention_policy_pkey" PRIMARY KEY ("id");


--
-- Name: scan_photo scan_photo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."scan_photo"
    ADD CONSTRAINT "scan_photo_pkey" PRIMARY KEY ("id");


--
-- Name: scan_session scan_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."scan_session"
    ADD CONSTRAINT "scan_session_pkey" PRIMARY KEY ("id");


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."schema_migrations"
    ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("filename");


--
-- Name: shop_credentials shop_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop_credentials"
    ADD CONSTRAINT "shop_credentials_pkey" PRIMARY KEY ("id");


--
-- Name: shop shop_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop"
    ADD CONSTRAINT "shop_pkey" PRIMARY KEY ("id");


--
-- Name: shop_pricing_policy shop_pricing_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop_pricing_policy"
    ADD CONSTRAINT "shop_pricing_policy_pkey" PRIMARY KEY ("id");


--
-- Name: shop shop_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop"
    ADD CONSTRAINT "shop_slug_key" UNIQUE ("slug");


--
-- Name: shopify_draft shopify_draft_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shopify_draft"
    ADD CONSTRAINT "shopify_draft_pkey" PRIMARY KEY ("id");


--
-- Name: condition_assessment_supersedes_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "condition_assessment_supersedes_once_idx" ON "public"."condition_assessment" USING "btree" ("supersedes_id") WHERE ("supersedes_id" IS NOT NULL);


--
-- Name: human_confirmation_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "human_confirmation_outcome_idx" ON "public"."human_confirmation" USING "btree" ("shop_id", "source", "outcome") WHERE ("outcome" IS NOT NULL);


--
-- Name: human_confirmation_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "human_confirmation_session_idx" ON "public"."human_confirmation" USING "btree" ("scan_session_id", "created_at" DESC, "id" DESC);


--
-- Name: human_confirmation_supersedes_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "human_confirmation_supersedes_once_idx" ON "public"."human_confirmation" USING "btree" ("supersedes_id") WHERE ("supersedes_id" IS NOT NULL);


--
-- Name: listing_status_observation_latest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "listing_status_observation_latest_idx" ON "public"."listing_status_observation" USING "btree" ("shopify_draft_id", "observed_at" DESC, "id" DESC);


--
-- Name: listing_status_observation_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "listing_status_observation_shop_idx" ON "public"."listing_status_observation" USING "btree" ("shop_id", "observed_at" DESC);


--
-- Name: media_deletion_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "media_deletion_shop_idx" ON "public"."media_deletion" USING "btree" ("shop_id", "created_at" DESC);


--
-- Name: pricing_snapshot_supersedes_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "pricing_snapshot_supersedes_once_idx" ON "public"."pricing_snapshot" USING "btree" ("supersedes_id") WHERE ("supersedes_id" IS NOT NULL);


--
-- Name: retention_hold_release_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "retention_hold_release_once_idx" ON "public"."retention_hold_release" USING "btree" ("hold_id");


--
-- Name: retention_hold_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "retention_hold_shop_idx" ON "public"."retention_hold" USING "btree" ("shop_id", "created_at" DESC);


--
-- Name: retention_hold_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "retention_hold_target_idx" ON "public"."retention_hold" USING "btree" ("target_table", "target_id");


--
-- Name: retention_policy_shop_class_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "retention_policy_shop_class_idx" ON "public"."retention_policy" USING "btree" ("shop_id", "artifact_class", "created_at" DESC);


--
-- Name: scan_photo_storage_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scan_photo_storage_key_idx" ON "public"."scan_photo" USING "btree" ("storage_key");


--
-- Name: scan_session_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scan_session_shop_idx" ON "public"."scan_session" USING "btree" ("shop_id", "created_at" DESC);


--
-- Name: shop_credentials_shop_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "shop_credentials_shop_kind_idx" ON "public"."shop_credentials" USING "btree" ("shop_id", "kind", "created_at" DESC);


--
-- Name: shop_pricing_policy_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "shop_pricing_policy_shop_idx" ON "public"."shop_pricing_policy" USING "btree" ("shop_id", "effective_from" DESC);


--
-- Name: candidate_set candidate_set_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "candidate_set_append_only" BEFORE DELETE OR UPDATE ON "public"."candidate_set" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."candidate_set" ENABLE ALWAYS TRIGGER "candidate_set_append_only";


--
-- Name: condition_assessment condition_assessment_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "condition_assessment_append_only" BEFORE DELETE OR UPDATE ON "public"."condition_assessment" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."condition_assessment" ENABLE ALWAYS TRIGGER "condition_assessment_append_only";


--
-- Name: corpus_version corpus_version_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "corpus_version_append_only" BEFORE DELETE OR UPDATE ON "public"."corpus_version" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."corpus_version" ENABLE ALWAYS TRIGGER "corpus_version_append_only";


--
-- Name: cost_log cost_log_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "cost_log_append_only" BEFORE DELETE OR UPDATE ON "public"."cost_log" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."cost_log" ENABLE ALWAYS TRIGGER "cost_log_append_only";


--
-- Name: human_confirmation human_confirmation_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "human_confirmation_append_only" BEFORE DELETE OR UPDATE ON "public"."human_confirmation" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."human_confirmation" ENABLE ALWAYS TRIGGER "human_confirmation_append_only";


--
-- Name: listing_status_observation listing_status_observation_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "listing_status_observation_append_only" BEFORE DELETE OR UPDATE ON "public"."listing_status_observation" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."listing_status_observation" ENABLE ALWAYS TRIGGER "listing_status_observation_append_only";


--
-- Name: llm_rerank llm_rerank_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "llm_rerank_append_only" BEFORE DELETE OR UPDATE ON "public"."llm_rerank" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."llm_rerank" ENABLE ALWAYS TRIGGER "llm_rerank_append_only";


--
-- Name: media_deletion media_deletion_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "media_deletion_append_only" BEFORE DELETE OR UPDATE ON "public"."media_deletion" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."media_deletion" ENABLE ALWAYS TRIGGER "media_deletion_append_only";


--
-- Name: pricing_snapshot pricing_snapshot_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "pricing_snapshot_append_only" BEFORE DELETE OR UPDATE ON "public"."pricing_snapshot" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."pricing_snapshot" ENABLE ALWAYS TRIGGER "pricing_snapshot_append_only";


--
-- Name: retention_hold retention_hold_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "retention_hold_append_only" BEFORE DELETE OR UPDATE ON "public"."retention_hold" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."retention_hold" ENABLE ALWAYS TRIGGER "retention_hold_append_only";


--
-- Name: retention_hold_release retention_hold_release_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "retention_hold_release_append_only" BEFORE DELETE OR UPDATE ON "public"."retention_hold_release" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."retention_hold_release" ENABLE ALWAYS TRIGGER "retention_hold_release_append_only";


--
-- Name: retention_policy retention_policy_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "retention_policy_append_only" BEFORE DELETE OR UPDATE ON "public"."retention_policy" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."retention_policy" ENABLE ALWAYS TRIGGER "retention_policy_append_only";


--
-- Name: scan_photo scan_photo_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "scan_photo_append_only" BEFORE DELETE OR UPDATE ON "public"."scan_photo" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."scan_photo" ENABLE ALWAYS TRIGGER "scan_photo_append_only";


--
-- Name: shopify_draft shopify_draft_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "shopify_draft_append_only" BEFORE DELETE OR UPDATE ON "public"."shopify_draft" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."shopify_draft" ENABLE ALWAYS TRIGGER "shopify_draft_append_only";


--
-- Name: candidate_set candidate_set_corpus_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."candidate_set"
    ADD CONSTRAINT "candidate_set_corpus_version_id_fkey" FOREIGN KEY ("corpus_version_id") REFERENCES "public"."corpus_version"("id");


--
-- Name: candidate_set candidate_set_scan_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."candidate_set"
    ADD CONSTRAINT "candidate_set_scan_session_id_fkey" FOREIGN KEY ("scan_session_id") REFERENCES "public"."scan_session"("id");


--
-- Name: candidate_set candidate_set_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."candidate_set"
    ADD CONSTRAINT "candidate_set_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: condition_assessment condition_assessment_scan_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."condition_assessment"
    ADD CONSTRAINT "condition_assessment_scan_session_id_fkey" FOREIGN KEY ("scan_session_id") REFERENCES "public"."scan_session"("id");


--
-- Name: condition_assessment condition_assessment_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."condition_assessment"
    ADD CONSTRAINT "condition_assessment_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: condition_assessment condition_assessment_supersedes_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."condition_assessment"
    ADD CONSTRAINT "condition_assessment_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."condition_assessment"("id");


--
-- Name: cost_log cost_log_scan_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cost_log"
    ADD CONSTRAINT "cost_log_scan_session_id_fkey" FOREIGN KEY ("scan_session_id") REFERENCES "public"."scan_session"("id");


--
-- Name: cost_log cost_log_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cost_log"
    ADD CONSTRAINT "cost_log_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: human_confirmation human_confirmation_scan_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."human_confirmation"
    ADD CONSTRAINT "human_confirmation_scan_session_id_fkey" FOREIGN KEY ("scan_session_id") REFERENCES "public"."scan_session"("id");


--
-- Name: human_confirmation human_confirmation_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."human_confirmation"
    ADD CONSTRAINT "human_confirmation_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: human_confirmation human_confirmation_supersedes_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."human_confirmation"
    ADD CONSTRAINT "human_confirmation_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."human_confirmation"("id");


--
-- Name: listing_status_observation listing_status_observation_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."listing_status_observation"
    ADD CONSTRAINT "listing_status_observation_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: listing_status_observation listing_status_observation_shopify_draft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."listing_status_observation"
    ADD CONSTRAINT "listing_status_observation_shopify_draft_id_fkey" FOREIGN KEY ("shopify_draft_id") REFERENCES "public"."shopify_draft"("id");


--
-- Name: llm_rerank llm_rerank_candidate_set_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."llm_rerank"
    ADD CONSTRAINT "llm_rerank_candidate_set_id_fkey" FOREIGN KEY ("candidate_set_id") REFERENCES "public"."candidate_set"("id");


--
-- Name: llm_rerank llm_rerank_scan_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."llm_rerank"
    ADD CONSTRAINT "llm_rerank_scan_session_id_fkey" FOREIGN KEY ("scan_session_id") REFERENCES "public"."scan_session"("id");


--
-- Name: llm_rerank llm_rerank_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."llm_rerank"
    ADD CONSTRAINT "llm_rerank_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: media_deletion media_deletion_scan_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."media_deletion"
    ADD CONSTRAINT "media_deletion_scan_photo_id_fkey" FOREIGN KEY ("scan_photo_id") REFERENCES "public"."scan_photo"("id");


--
-- Name: media_deletion media_deletion_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."media_deletion"
    ADD CONSTRAINT "media_deletion_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: pricing_snapshot pricing_snapshot_policy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pricing_snapshot"
    ADD CONSTRAINT "pricing_snapshot_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "public"."shop_pricing_policy"("id");


--
-- Name: pricing_snapshot pricing_snapshot_scan_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pricing_snapshot"
    ADD CONSTRAINT "pricing_snapshot_scan_session_id_fkey" FOREIGN KEY ("scan_session_id") REFERENCES "public"."scan_session"("id");


--
-- Name: pricing_snapshot pricing_snapshot_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pricing_snapshot"
    ADD CONSTRAINT "pricing_snapshot_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: pricing_snapshot pricing_snapshot_supersedes_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pricing_snapshot"
    ADD CONSTRAINT "pricing_snapshot_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."pricing_snapshot"("id");


--
-- Name: retention_hold_release retention_hold_release_hold_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."retention_hold_release"
    ADD CONSTRAINT "retention_hold_release_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "public"."retention_hold"("id");


--
-- Name: retention_hold retention_hold_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."retention_hold"
    ADD CONSTRAINT "retention_hold_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: retention_policy retention_policy_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."retention_policy"
    ADD CONSTRAINT "retention_policy_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: scan_photo scan_photo_scan_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."scan_photo"
    ADD CONSTRAINT "scan_photo_scan_session_id_fkey" FOREIGN KEY ("scan_session_id") REFERENCES "public"."scan_session"("id");


--
-- Name: scan_photo scan_photo_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."scan_photo"
    ADD CONSTRAINT "scan_photo_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: scan_session scan_session_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."scan_session"
    ADD CONSTRAINT "scan_session_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: shop_credentials shop_credentials_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop_credentials"
    ADD CONSTRAINT "shop_credentials_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: shop_pricing_policy shop_pricing_policy_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shop_pricing_policy"
    ADD CONSTRAINT "shop_pricing_policy_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: shopify_draft shopify_draft_scan_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shopify_draft"
    ADD CONSTRAINT "shopify_draft_scan_session_id_fkey" FOREIGN KEY ("scan_session_id") REFERENCES "public"."scan_session"("id");


--
-- Name: shopify_draft shopify_draft_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shopify_draft"
    ADD CONSTRAINT "shopify_draft_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- PostgreSQL database dump complete
--

\unrestrict p3zgTJRyJdH19guGyQ8q4TJtAtj58O45NQ3kCenvqkcxK5SgwmaMTisIZw55vxd

