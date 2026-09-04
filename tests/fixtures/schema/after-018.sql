-- GENERATED FIXTURE — do not hand-edit.
-- The schema and seed of intent-longbox at migration 018, dumped with
--   pnpm fixture:schema --upto 018 --out tests/fixtures/schema/after-018.sql
-- Restored by tests/integration/prior-snapshot-upgrade.test.ts, which then runs
-- `pnpm migrate` forward and asserts the append-only trigger set is 'A' and the
-- grant step succeeds (000-docs/044 §3). Regenerate only when THIS release's
-- schema is what changed; a diff here otherwise means a shipped migration was
-- edited, which is the thing the ledger checksum refuses.
--
-- PostgreSQL database dump
--

\restrict dwI9k7MtLdC4dbOKq1vDeqwbaB6xMWFx2lO6Cof7qOj8XetzDvWlCLZHzSRpnbt


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
-- Name: forbid_backward_supersession(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."forbid_backward_supersession"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
  prior_seq     bigint;
  prior_shop    uuid;
  prior_session uuid;
BEGIN
  -- Clause 1.
  IF NEW.supersedes_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Clause 2 — the database half of 041 §3.3's single writer.
  IF NEW.session_seq IS NULL THEN
    RAISE EXCEPTION
      'supersession_forward: a row superseding %.% must carry session_seq (041 §3.3, §5.3): '
      'assign it with assignSessionSeq under the scan_session anchor lock, which is what '
      'src/services/supersession.ts supersede() does. A superseding row with no counter did not '
      'come through the single writer.',
      TG_TABLE_NAME, NEW.supersedes_id;
  END IF;

  EXECUTE format(
    'SELECT session_seq, shop_id, scan_session_id FROM %I WHERE id = $1', TG_TABLE_NAME)
    INTO prior_seq, prior_shop, prior_session
    USING NEW.supersedes_id;

  -- Clause 3 — R1 belongs to `008`'s composite FK; do not pre-empt its error.
  --
  -- ⚠ THE MISS IS DETECTED FROM THE VARIABLE, NOT FROM `FOUND`, and that is not a
  -- style choice: **`EXECUTE` does not set `FOUND`** (PL/pgSQL: "EXECUTE changes
  -- the output of GET DIAGNOSTICS, but does not change FOUND"). Writing
  -- `IF NOT FOUND` here reads correctly, compiles, and is WRONG — `FOUND` is false
  -- on entry to the trigger, so the function returns early and R4 never runs. That
  -- was this file's first version and it passed a hand test that only proved the
  -- unique index still worked. `shop_id` is `NOT NULL` on all three tables, so a
  -- NULL here means exactly one thing: no such row.
  IF prior_shop IS NULL THEN
    RETURN NEW;
  END IF;
  IF prior_shop IS DISTINCT FROM NEW.shop_id OR prior_session IS DISTINCT FROM NEW.scan_session_id THEN
    RETURN NEW;
  END IF;

  -- Clause 4 — a pre-`007` predecessor has no comparable ordinal.
  IF prior_seq IS NULL THEN
    RETURN NEW;
  END IF;

  -- Clause 5.
  IF NEW.session_seq <= prior_seq THEN
    RAISE EXCEPTION
      'supersession_forward: %.% would supersede a row recorded LATER or at the same point '
      '(session_seq % is not greater than the predecessor''s %). 041 §3.2 R4: a correction chain '
      'runs forward, and a cycle requires at least one backward edge — which is why refusing this '
      'insert is what stops a session reaching zero current rows (041 §3.4, E17).',
      TG_TABLE_NAME, NEW.supersedes_id, NEW.session_seq, prior_seq;
  END IF;

  RETURN NEW;
END;
$_$;


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


--
-- Name: lcid_max_chain_depth(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."lcid_max_chain_depth"() RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$ SELECT 64 $$;


--
-- Name: maintain_lcid_current_survivor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."maintain_lcid_current_survivor"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE root text;
BEGIN
  -- The new survivor's OWN root, if it has already been merged away itself. The
  -- projection is transitively closed, so this is one lookup and not a walk.
  SELECT survivor_lcid INTO root FROM lcid_current_survivor WHERE lcid = NEW.surviving_lcid;
  IF root IS NULL THEN
    root := NEW.surviving_lcid;
  END IF;

  INSERT INTO lcid_current_survivor (lcid, survivor_lcid) VALUES (NEW.losing_lcid, root);

  -- Everything that pointed at the loser now points at the loser's new root.
  UPDATE lcid_current_survivor SET survivor_lcid = root WHERE survivor_lcid = NEW.losing_lcid;

  RETURN NULL;
END;
$$;


--
-- Name: refuse_machine_certification_outside_registrar(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."refuse_machine_certification_outside_registrar"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE cls text;
BEGIN
  IF NEW.certified IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  SELECT namespace_class INTO cls FROM data_source WHERE id = NEW.data_source_id;
  IF cls <> 'registrar' AND NEW.decided_by_role = 'catalog_importer' THEN
    RAISE EXCEPTION
      'edition_external_id: a % namespace proposes and never certifies (047 §8.2); '
      'certification outside a registrar-issued namespace requires a human catalog author', cls
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: refuse_merge_cycle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."refuse_merge_cycle"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  cursor_lcid text := NEW.surviving_lcid;
  next_lcid   text;
  hops        integer := 0;
  bound       integer := lcid_max_chain_depth();
BEGIN
  -- `UNIQUE (losing_lcid)` makes the merge graph FUNCTIONAL: every node has at
  -- most one outgoing edge. So a cycle exists iff walking forward from the
  -- proposed SURVIVOR reaches the proposed LOSER. One pass, no recursion.
  LOOP
    SELECT surviving_lcid INTO next_lcid FROM lcid_merge WHERE losing_lcid = cursor_lcid;
    EXIT WHEN next_lcid IS NULL;

    IF next_lcid = NEW.losing_lcid THEN
      RAISE EXCEPTION
        'merge % -> % would create a cycle: % is already reachable from % (047 §6.1, I8)',
        NEW.losing_lcid, NEW.surviving_lcid, NEW.losing_lcid, NEW.surviving_lcid
        USING ERRCODE = 'check_violation';
    END IF;

    hops := hops + 1;
    IF hops > bound THEN
      RAISE EXCEPTION
        'merge % -> % exceeds the chain bound of % hops; refused at WRITE time (047 A10)',
        NEW.losing_lcid, NEW.surviving_lcid, bound
        USING ERRCODE = 'check_violation';
    END IF;

    cursor_lcid := next_lcid;
    next_lcid := NULL;
  END LOOP;

  RETURN NEW;
END;
$$;


--
-- Name: refuse_second_disposition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."refuse_second_disposition"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE target text;
BEGIN
  -- IF/ELSIF rather than a CASE EXPRESSION, and the difference is not style:
  -- plpgsql evaluates a CASE expression's arms against the record's actual type,
  -- so `NEW.losing_lcid` inside one arm raises `record "new" has no field
  -- "losing_lcid"` when the trigger fires on `lcid_split`. One shared function
  -- across three differently-shaped tables has to branch on the statement, never
  -- on an expression.
  IF TG_TABLE_NAME = 'lcid_merge' THEN
    target := NEW.losing_lcid;
  ELSIF TG_TABLE_NAME = 'lcid_split' THEN
    target := NEW.source_lcid;
  ELSE
    target := NEW.lcid;
  END IF;

  IF TG_TABLE_NAME <> 'lcid_merge'
     AND EXISTS (SELECT 1 FROM lcid_merge WHERE losing_lcid = target) THEN
    RAISE EXCEPTION 'lcid % is already merged away; an LCID is disposed of at most once (047 I8)', target
      USING ERRCODE = 'unique_violation';
  END IF;

  IF TG_TABLE_NAME <> 'lcid_split'
     AND EXISTS (SELECT 1 FROM lcid_split WHERE source_lcid = target) THEN
    RAISE EXCEPTION 'lcid % is already a split source; an LCID is disposed of at most once (047 I8)', target
      USING ERRCODE = 'unique_violation';
  END IF;

  IF TG_TABLE_NAME <> 'lcid_retirement'
     AND EXISTS (SELECT 1 FROM lcid_retirement WHERE lcid = target) THEN
    RAISE EXCEPTION 'lcid % is already retired; an LCID is disposed of at most once (047 I8)', target
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
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
    "authored_by" "text" GENERATED ALWAYS AS (
CASE
    WHEN ("method" = 'barcode'::"text") THEN 'system'::"text"
    ELSE 'provider'::"text"
END) STORED NOT NULL,
    "session_seq" bigint,
    CONSTRAINT "candidate_set_method_check" CHECK (("method" = ANY (ARRAY['barcode'::"text", 'llm_vision'::"text", 'ximilar'::"text", 'index'::"text"]))),
    CONSTRAINT "candidate_set_session_seq_positive" CHECK ((("session_seq" IS NULL) OR ("session_seq" > 0)))
);


--
-- Name: collectible_definition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."collectible_definition" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "definition_lcid" "text" NOT NULL,
    "vertical" "text" NOT NULL,
    "vertical_pack_version_id" "uuid" NOT NULL,
    "corpus_version_id" "uuid" NOT NULL,
    "attributes" "jsonb" NOT NULL,
    "signature" "text" NOT NULL,
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "supersedes_id" "uuid",
    CONSTRAINT "collectible_definition_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "collectible_definition_not_self" CHECK (("supersedes_id" IS DISTINCT FROM "id"))
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
    "authored_by" "text" DEFAULT 'human'::"text" NOT NULL,
    "session_seq" bigint,
    CONSTRAINT "condition_assessment_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "condition_assessment_grade_range_high_check" CHECK (("grade_range_high" = ANY (ARRAY['PR'::"text", 'FR'::"text", 'GD'::"text", 'VG'::"text", 'FN'::"text", 'VF'::"text", 'NM'::"text"]))),
    CONSTRAINT "condition_assessment_grade_range_low_check" CHECK (("grade_range_low" = ANY (ARRAY['PR'::"text", 'FR'::"text", 'GD'::"text", 'VG'::"text", 'FN'::"text", 'VF'::"text", 'NM'::"text"]))),
    CONSTRAINT "condition_assessment_is_a_human_act" CHECK (("authored_by" = 'human'::"text")),
    CONSTRAINT "condition_assessment_session_seq_positive" CHECK ((("session_seq" IS NULL) OR ("session_seq" > 0))),
    CONSTRAINT "condition_assessment_supersedes_not_self" CHECK (("supersedes_id" IS DISTINCT FROM "id"))
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
    "supersedes_id",
    "authored_by",
    "session_seq"
   FROM "public"."condition_assessment" "c"
  WHERE (NOT (EXISTS ( SELECT 1
           FROM "public"."condition_assessment" "s"
          WHERE ("s"."supersedes_id" = "c"."id"))))
  ORDER BY "scan_session_id", "session_seq" DESC NULLS LAST, "created_at" DESC, "id" DESC;


--
-- Name: corpus_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."corpus_version" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_set" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "built_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    CONSTRAINT "corpus_version_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"])))
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
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    "session_seq" bigint,
    "outbox_id" "uuid",
    CONSTRAINT "cost_log_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "cost_log_session_seq_positive" CHECK ((("session_seq" IS NULL) OR ("session_seq" > 0)))
);


--
-- Name: data_source; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."data_source" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "namespace_class" "text" NOT NULL,
    "licence" "text",
    "terms_url" "text",
    "attribution_required" boolean DEFAULT false NOT NULL,
    "authored_by" "text" DEFAULT 'human'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "data_source_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "data_source_namespace_class_check" CHECK (("namespace_class" = ANY (ARRAY['registrar'::"text", 'community'::"text", 'commercial'::"text"])))
);


--
-- Name: edition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."edition" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "edition_lcid" "text" NOT NULL,
    "definition_lcid" "text" NOT NULL,
    "vertical" "text" NOT NULL,
    "vertical_pack_version_id" "uuid" NOT NULL,
    "corpus_version_id" "uuid" NOT NULL,
    "attributes" "jsonb" NOT NULL,
    "signature" "text" NOT NULL,
    "is_canonical_edition" boolean DEFAULT false NOT NULL,
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "supersedes_id" "uuid",
    CONSTRAINT "edition_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "edition_not_self" CHECK (("supersedes_id" IS DISTINCT FROM "id"))
);


--
-- Name: edition_external_id; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."edition_external_id" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "edition_lcid" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "external_id" "text" NOT NULL,
    "vertical" "text" NOT NULL,
    "provider_schema_version" "text",
    "corpus_version_id" "uuid" NOT NULL,
    "match_method" "text" NOT NULL,
    "confidence" "text",
    "contradiction" "jsonb",
    "data_source_id" "uuid" NOT NULL,
    "source_record_hash" "text",
    "target_record_hash" "text",
    "effective_from" timestamp with time zone,
    "reviewer" "text",
    "certified" boolean DEFAULT false NOT NULL,
    "certified_at" timestamp with time zone,
    "decided_by" "text",
    "decided_by_role" "text",
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "supersedes_id" "uuid",
    CONSTRAINT "edition_external_id_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "edition_external_id_catalog_authoring_role" CHECK ((("decided_by_role" IS NULL) OR ("decided_by_role" = ANY (ARRAY['catalog_author'::"text", 'catalog_reviewer'::"text", 'catalog_importer'::"text"])))),
    CONSTRAINT "edition_external_id_certification_is_decided" CHECK ((("certified" = false) OR (("decided_by" IS NOT NULL) AND ("decided_by_role" IS NOT NULL) AND ("certified_at" IS NOT NULL)))),
    CONSTRAINT "edition_external_id_match_method_check" CHECK (("match_method" = ANY (ARRAY['exact'::"text", 'rule'::"text", 'similarity'::"text", 'human'::"text"]))),
    CONSTRAINT "edition_external_id_no_cert_namespace" CHECK (("provider" <> ALL (ARRAY['psa_cert'::"text", 'cgc_cert'::"text", 'cbcs_cert'::"text"]))),
    CONSTRAINT "edition_external_id_not_self" CHECK (("supersedes_id" IS DISTINCT FROM "id"))
);


--
-- Name: edition_signature; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."edition_signature" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vertical" "text" NOT NULL,
    "signature" "text" NOT NULL,
    "normalization_version" integer NOT NULL,
    "edition_lcid" "text" NOT NULL,
    "corpus_version_id" "uuid" NOT NULL,
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "edition_signature_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "edition_signature_normalization_version_check" CHECK (("normalization_version" > 0))
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
    "authored_by" "text" DEFAULT 'human'::"text" NOT NULL,
    "session_seq" bigint,
    CONSTRAINT "human_confirmation_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "human_confirmation_is_a_human_act" CHECK (("authored_by" = 'human'::"text")),
    CONSTRAINT "human_confirmation_outcome_check" CHECK ((("outcome" IS NULL) OR ("outcome" = ANY (ARRAY['confirm'::"text", 'correct'::"text"])))),
    CONSTRAINT "human_confirmation_session_seq_positive" CHECK ((("session_seq" IS NULL) OR ("session_seq" > 0))),
    CONSTRAINT "human_confirmation_source_check" CHECK (("source" = ANY (ARRAY['one_tap'::"text", 'grid_pick'::"text", 'manual_search'::"text", 'owner_review'::"text"]))),
    CONSTRAINT "human_confirmation_supersedes_not_self" CHECK (("supersedes_id" IS DISTINCT FROM "id"))
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
    "outcome",
    "authored_by",
    "session_seq"
   FROM "public"."human_confirmation" "h"
  WHERE (NOT (EXISTS ( SELECT 1
           FROM "public"."human_confirmation" "s"
          WHERE ("s"."supersedes_id" = "h"."id"))))
  ORDER BY "scan_session_id", "session_seq" DESC NULLS LAST, "created_at" DESC, "id" DESC;


--
-- Name: identity_resolution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."identity_resolution" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "human_confirmation_id" "uuid" NOT NULL,
    "edition_lcid" "text" NOT NULL,
    "corpus_version_id" "uuid" NOT NULL,
    "method" "text" NOT NULL,
    "confidence" "text",
    "resolved_by" "text" NOT NULL,
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "identity_resolution_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "identity_resolution_method_check" CHECK (("method" = ANY (ARRAY['live'::"text", 'barcode'::"text", 'signature'::"text", 'human'::"text", 'canonical_edition'::"text"])))
);


--
-- Name: lcid_current_survivor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."lcid_current_survivor" (
    "lcid" "text" NOT NULL,
    "survivor_lcid" "text" NOT NULL,
    CONSTRAINT "lcid_current_survivor_not_self" CHECK (("lcid" <> "survivor_lcid"))
);


--
-- Name: lcid_merge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."lcid_merge" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "losing_lcid" "text" NOT NULL,
    "surviving_lcid" "text" NOT NULL,
    "corpus_version_id" "uuid" NOT NULL,
    "method" "text" NOT NULL,
    "evidence" "jsonb" NOT NULL,
    "decided_by" "text" NOT NULL,
    "authored_by" "text" DEFAULT 'human'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lcid_merge_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "lcid_merge_not_self" CHECK (("losing_lcid" <> "surviving_lcid"))
);


--
-- Name: lcid_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."lcid_registry" (
    "lcid" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "vertical_code" "text" NOT NULL,
    "minted_in_corpus_version_id" "uuid" NOT NULL,
    "minted_by" "text" NOT NULL,
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    "issued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lcid_registry_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "lcid_registry_grammar" CHECK (("lcid" ~ '^lb\.[de]\.[a-z]{3}\.[0-9abcdefghjkmnpqrstvwxyz]{16}[0-9abcdefghjkmnpqrstvwxyz*~$=u]$'::"text")),
    CONSTRAINT "lcid_registry_kind_check" CHECK (("kind" = ANY (ARRAY['definition'::"text", 'edition'::"text"]))),
    CONSTRAINT "lcid_registry_minted_by_check" CHECK (("minted_by" = ANY (ARRAY['import'::"text", 'human_review'::"text"]))),
    CONSTRAINT "lcid_registry_string_agrees_with_row" CHECK (("lcid" = ((((('lb.'::"text" || "substr"("kind", 1, 1)) || '.'::"text") || "vertical_code") || '.'::"text") || "substr"("lcid", 10))))
);


--
-- Name: lcid_retirement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."lcid_retirement" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lcid" "text" NOT NULL,
    "corpus_version_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "method" "text" NOT NULL,
    "evidence" "jsonb" NOT NULL,
    "decided_by" "text" NOT NULL,
    "authored_by" "text" DEFAULT 'human'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lcid_retirement_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"])))
);


--
-- Name: lcid_split; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."lcid_split" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_lcid" "text" NOT NULL,
    "corpus_version_id" "uuid" NOT NULL,
    "method" "text" NOT NULL,
    "evidence" "jsonb" NOT NULL,
    "decided_by" "text" NOT NULL,
    "authored_by" "text" DEFAULT 'human'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lcid_split_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"])))
);


--
-- Name: lcid_split_outcome; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."lcid_split_outcome" (
    "split_id" "uuid" NOT NULL,
    "product_lcid" "text" NOT NULL,
    "is_continuation" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


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
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    CONSTRAINT "listing_status_observation_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
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
    "confidence" real,
    "band" "text" NOT NULL,
    "contradiction" boolean DEFAULT false NOT NULL,
    "tokens_in" integer DEFAULT 0 NOT NULL,
    "tokens_out" integer DEFAULT 0 NOT NULL,
    "cost_usd" numeric(12,6) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "authored_by" "text" DEFAULT 'provider'::"text" NOT NULL,
    "session_seq" bigint,
    "band_inputs" "jsonb",
    CONSTRAINT "llm_rerank_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "llm_rerank_band_check" CHECK (("band" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"]))),
    CONSTRAINT "llm_rerank_confidence_check" CHECK ((("confidence" >= (0)::double precision) AND ("confidence" <= (1)::double precision))),
    CONSTRAINT "llm_rerank_session_seq_positive" CHECK ((("session_seq" IS NULL) OR ("session_seq" > 0)))
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
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    CONSTRAINT "media_deletion_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"])))
);


--
-- Name: outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "scan_session_id" "uuid",
    "session_seq" bigint,
    "event" "text" NOT NULL,
    "ref_table" "text" NOT NULL,
    "ref_id" "uuid" NOT NULL,
    "definition_version" "text",
    "correlation_id" "uuid",
    "occurred_at" timestamp with time zone,
    "authored_by" "text" NOT NULL,
    "operator_id" "uuid",
    "actor_verified" boolean DEFAULT false NOT NULL,
    "actor_role" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "outbox_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "outbox_session_seq_positive" CHECK ((("session_seq" IS NULL) OR ("session_seq" > 0)))
);


--
-- Name: outbox_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."outbox_attempt" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "outbox_id" "uuid" NOT NULL,
    "attempt_no" integer NOT NULL,
    "kind" "text" NOT NULL,
    "detail" "jsonb",
    "operator_id" "uuid",
    "reason" "text",
    "authored_by" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "outbox_attempt_attempt_no_check" CHECK (("attempt_no" >= 1)),
    CONSTRAINT "outbox_attempt_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "outbox_attempt_kind_check" CHECK (("kind" = ANY (ARRAY['started'::"text", 'delivered'::"text", 'failed'::"text", 'dead_lettered'::"text", 'replay_requested'::"text"]))),
    CONSTRAINT "outbox_attempt_replay_names_a_person" CHECK ((("kind" <> 'replay_requested'::"text") OR (("operator_id" IS NOT NULL) AND ("reason" IS NOT NULL) AND ("length"("btrim"("reason")) > 0))))
);


--
-- Name: outbox_dead_letter; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW "public"."outbox_dead_letter" AS
 SELECT "o"."id" AS "outbox_id",
    "o"."shop_id",
    "o"."scan_session_id",
    "o"."event",
    "o"."ref_table",
    "o"."ref_id",
    "a"."id" AS "attempt_id",
    "a"."attempt_no",
    ("a"."detail" ->> 'reason_code'::"text") AS "reason_code",
    (("a"."detail" ->> 'reason_code'::"text") = ANY (ARRAY['listing_left_draft'::"text", 'no_observation_evidence'::"text"])) AS "guard_refusal",
    "a"."created_at" AS "dead_lettered_at",
    (EXISTS ( SELECT 1
           FROM "public"."outbox_attempt" "r"
          WHERE (("r"."outbox_id" = "a"."outbox_id") AND ("r"."kind" = 'replay_requested'::"text") AND ("r"."created_at" > "a"."created_at")))) AS "replay_requested_after"
   FROM ("public"."outbox" "o"
     JOIN "public"."outbox_attempt" "a" ON ((("a"."outbox_id" = "o"."id") AND ("a"."kind" = 'dead_lettered'::"text"))));


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
    "supersedes_id" "uuid",
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    "session_seq" bigint,
    CONSTRAINT "pricing_snapshot_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "pricing_snapshot_session_seq_positive" CHECK ((("session_seq" IS NULL) OR ("session_seq" > 0))),
    CONSTRAINT "pricing_snapshot_supersedes_not_self" CHECK (("supersedes_id" IS DISTINCT FROM "id"))
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
    "supersedes_id",
    "authored_by",
    "session_seq"
   FROM "public"."pricing_snapshot" "p"
  WHERE (NOT (EXISTS ( SELECT 1
           FROM "public"."pricing_snapshot" "s"
          WHERE ("s"."supersedes_id" = "p"."id"))))
  ORDER BY "scan_session_id", "session_seq" DESC NULLS LAST, "created_at" DESC, "id" DESC;


--
-- Name: request_idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."request_idempotency" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "route" "text" NOT NULL,
    "request_hash" "text" NOT NULL,
    "response_status" integer,
    "response_body" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


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
    "authored_by" "text" DEFAULT 'human'::"text" NOT NULL,
    CONSTRAINT "retention_hold_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "retention_hold_target_table_check" CHECK (("target_table" = ANY (ARRAY['scan_session'::"text", 'scan_photo'::"text", 'shopify_draft'::"text", 'labor_shift'::"text"])))
);


--
-- Name: retention_hold_release; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."retention_hold_release" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hold_id" "uuid" NOT NULL,
    "released_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "authored_by" "text" DEFAULT 'human'::"text" NOT NULL,
    CONSTRAINT "retention_hold_release_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"])))
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
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    CONSTRAINT "retention_policy_anchor_check" CHECK (("anchor" = ANY (ARRAY['draft_created'::"text", 'listing_end'::"text", 'shift_end'::"text", 'capture'::"text"]))),
    CONSTRAINT "retention_policy_artifact_class_check" CHECK (("artifact_class" = ANY (ARRAY['originals'::"text", 'derivatives'::"text", 'labor_shift'::"text"]))),
    CONSTRAINT "retention_policy_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
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
    "authored_by" "text" DEFAULT 'human'::"text" NOT NULL,
    "session_seq" bigint,
    "byte_size" bigint,
    CONSTRAINT "scan_photo_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "scan_photo_byte_size_nonnegative" CHECK ((("byte_size" IS NULL) OR ("byte_size" >= 0))),
    CONSTRAINT "scan_photo_kind_check" CHECK (("kind" = ANY (ARRAY['cover'::"text", 'barcode'::"text", 'defect'::"text"]))),
    CONSTRAINT "scan_photo_session_seq_positive" CHECK ((("session_seq" IS NULL) OR ("session_seq" > 0))),
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
-- Name: scan_session_transition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."scan_session_transition" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_id" "uuid" NOT NULL,
    "scan_session_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "reopened_to_rung" "text",
    "against_table" "text",
    "against_id" "uuid",
    "observed_state" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "operator_id" "uuid",
    "actor_verified" boolean DEFAULT false NOT NULL,
    "actor_role" "text" NOT NULL,
    "device_id" "uuid",
    "batch_id" "uuid",
    "authored_by" "text" DEFAULT 'human'::"text" NOT NULL,
    "session_seq" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "scan_session_transition_actor_role_check" CHECK (("actor_role" = ANY (ARRAY['operator'::"text", 'owner'::"text", 'manager'::"text"]))),
    CONSTRAINT "scan_session_transition_against_table_check" CHECK (("against_table" = ANY (ARRAY['scan_photo'::"text", 'candidate_set'::"text", 'llm_rerank'::"text", 'human_confirmation'::"text", 'condition_assessment'::"text", 'pricing_snapshot'::"text", 'shopify_draft'::"text", 'scan_session'::"text"]))),
    CONSTRAINT "scan_session_transition_authored_by_check" CHECK (("authored_by" = 'human'::"text")),
    CONSTRAINT "scan_session_transition_kind_check" CHECK (("kind" = ANY (ARRAY['parked'::"text", 'resumed'::"text", 'voided'::"text", 'reopened'::"text"]))),
    CONSTRAINT "scan_session_transition_principal_only_decisions" CHECK ((("kind" = ANY (ARRAY['parked'::"text", 'resumed'::"text"])) OR ("actor_role" = ANY (ARRAY['owner'::"text", 'manager'::"text"])))),
    CONSTRAINT "scan_session_transition_reference_is_whole" CHECK ((("against_table" IS NULL) = ("against_id" IS NULL))),
    CONSTRAINT "scan_session_transition_reopened_to_rung_check" CHECK (("reopened_to_rung" = ANY (ARRAY['captured'::"text", 'proposed'::"text", 'confirmed'::"text", 'conditioned'::"text", 'priced'::"text"]))),
    CONSTRAINT "scan_session_transition_rung_pairs_with_reopened" CHECK ((("kind" = 'reopened'::"text") = ("reopened_to_rung" IS NOT NULL))),
    CONSTRAINT "scan_session_transition_session_seq_check" CHECK (("session_seq" > 0))
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
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shop_slug_charset" CHECK (("slug" ~ '^[a-z0-9-]+$'::"text"))
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
    CONSTRAINT "shop_credentials_base_url_registered" CHECK ((("base_url" IS NULL) OR ("base_url" ~ '^https://(api\.anthropic\.com|api\.openai\.com|api\.ebay\.com|api\.sandbox\.ebay\.com)(/[A-Za-z0-9._~/-]*)?$'::"text"))),
    CONSTRAINT "shop_credentials_key_ref_namespaced" CHECK (("key_ref" ~ '^LONGBOX_[A-Z0-9]+_(ANTHROPIC|OPENAI|SHOPIFY|PRICECHARTING|EBAY)_KEY(_SECRET)?$'::"text")),
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
    "authored_by" "text" DEFAULT 'system'::"text" NOT NULL,
    "session_seq" bigint,
    "outbox_id" "uuid",
    CONSTRAINT "shopify_draft_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "shopify_draft_session_seq_positive" CHECK ((("session_seq" IS NULL) OR ("session_seq" > 0))),
    CONSTRAINT "shopify_draft_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'failed'::"text", 'delisted'::"text", 'archived'::"text"])))
);


--
-- Name: vertical_pack; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."vertical_pack" (
    "vertical" "text" NOT NULL,
    "vertical_code" "text" NOT NULL,
    "registered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "authored_by" "text" DEFAULT 'human'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vertical_pack_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "vertical_pack_vertical_code_check" CHECK (("vertical_code" ~ '^[a-z]{3}$'::"text"))
);


--
-- Name: vertical_pack_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."vertical_pack_version" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vertical" "text" NOT NULL,
    "pack_version" integer NOT NULL,
    "manifest" "jsonb" NOT NULL,
    "signature_fn_ref" "text" NOT NULL,
    "authored_by" "text" DEFAULT 'human'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "supersedes_id" "uuid",
    CONSTRAINT "vertical_pack_version_authored_by_check" CHECK (("authored_by" = ANY (ARRAY['human'::"text", 'system'::"text", 'provider'::"text"]))),
    CONSTRAINT "vertical_pack_version_not_self" CHECK (("supersedes_id" IS DISTINCT FROM "id")),
    CONSTRAINT "vertical_pack_version_pack_version_check" CHECK (("pack_version" > 0))
);


--
-- Name: candidate_set candidate_set_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."candidate_set"
    ADD CONSTRAINT "candidate_set_pkey" PRIMARY KEY ("id");


--
-- Name: collectible_definition collectible_definition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."collectible_definition"
    ADD CONSTRAINT "collectible_definition_pkey" PRIMARY KEY ("id");


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
-- Name: data_source data_source_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."data_source"
    ADD CONSTRAINT "data_source_name_key" UNIQUE ("name");


--
-- Name: data_source data_source_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."data_source"
    ADD CONSTRAINT "data_source_pkey" PRIMARY KEY ("id");


--
-- Name: edition_external_id edition_external_id_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition_external_id"
    ADD CONSTRAINT "edition_external_id_pkey" PRIMARY KEY ("id");


--
-- Name: edition edition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition"
    ADD CONSTRAINT "edition_pkey" PRIMARY KEY ("id");


--
-- Name: edition_signature edition_signature_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition_signature"
    ADD CONSTRAINT "edition_signature_pkey" PRIMARY KEY ("id");


--
-- Name: human_confirmation human_confirmation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."human_confirmation"
    ADD CONSTRAINT "human_confirmation_pkey" PRIMARY KEY ("id");


--
-- Name: identity_resolution identity_resolution_once_per_corpus; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."identity_resolution"
    ADD CONSTRAINT "identity_resolution_once_per_corpus" UNIQUE ("human_confirmation_id", "corpus_version_id");


--
-- Name: identity_resolution identity_resolution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."identity_resolution"
    ADD CONSTRAINT "identity_resolution_pkey" PRIMARY KEY ("id");


--
-- Name: lcid_merge lcid_merge_one_disposition; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_merge"
    ADD CONSTRAINT "lcid_merge_one_disposition" UNIQUE ("losing_lcid");


--
-- Name: lcid_merge lcid_merge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_merge"
    ADD CONSTRAINT "lcid_merge_pkey" PRIMARY KEY ("id");


--
-- Name: lcid_registry lcid_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_registry"
    ADD CONSTRAINT "lcid_registry_pkey" PRIMARY KEY ("lcid");


--
-- Name: lcid_retirement lcid_retirement_one_disposition; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_retirement"
    ADD CONSTRAINT "lcid_retirement_one_disposition" UNIQUE ("lcid");


--
-- Name: lcid_retirement lcid_retirement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_retirement"
    ADD CONSTRAINT "lcid_retirement_pkey" PRIMARY KEY ("id");


--
-- Name: lcid_split lcid_split_one_disposition; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_split"
    ADD CONSTRAINT "lcid_split_one_disposition" UNIQUE ("source_lcid");


--
-- Name: lcid_split_outcome lcid_split_outcome_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_split_outcome"
    ADD CONSTRAINT "lcid_split_outcome_pkey" PRIMARY KEY ("split_id", "product_lcid");


--
-- Name: lcid_split lcid_split_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_split"
    ADD CONSTRAINT "lcid_split_pkey" PRIMARY KEY ("id");


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
-- Name: outbox_attempt outbox_attempt_one_row_per_kind; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."outbox_attempt"
    ADD CONSTRAINT "outbox_attempt_one_row_per_kind" UNIQUE ("outbox_id", "attempt_no", "kind");


--
-- Name: outbox_attempt outbox_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."outbox_attempt"
    ADD CONSTRAINT "outbox_attempt_pkey" PRIMARY KEY ("id");


--
-- Name: outbox outbox_one_effect_per_reference; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."outbox"
    ADD CONSTRAINT "outbox_one_effect_per_reference" UNIQUE ("shop_id", "event", "ref_table", "ref_id");


--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."outbox"
    ADD CONSTRAINT "outbox_pkey" PRIMARY KEY ("id");


--
-- Name: pricing_snapshot pricing_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pricing_snapshot"
    ADD CONSTRAINT "pricing_snapshot_pkey" PRIMARY KEY ("id");


--
-- Name: request_idempotency request_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."request_idempotency"
    ADD CONSTRAINT "request_idempotency_pkey" PRIMARY KEY ("id");


--
-- Name: request_idempotency request_idempotency_shop_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."request_idempotency"
    ADD CONSTRAINT "request_idempotency_shop_id_idempotency_key_key" UNIQUE ("shop_id", "idempotency_key");


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
-- Name: scan_session_transition scan_session_transition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."scan_session_transition"
    ADD CONSTRAINT "scan_session_transition_pkey" PRIMARY KEY ("id");


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
-- Name: vertical_pack vertical_pack_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."vertical_pack"
    ADD CONSTRAINT "vertical_pack_pkey" PRIMARY KEY ("vertical");


--
-- Name: vertical_pack_version vertical_pack_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."vertical_pack_version"
    ADD CONSTRAINT "vertical_pack_version_pkey" PRIMARY KEY ("id");


--
-- Name: vertical_pack_version vertical_pack_version_rate; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."vertical_pack_version"
    ADD CONSTRAINT "vertical_pack_version_rate" UNIQUE ("vertical", "pack_version");


--
-- Name: vertical_pack vertical_pack_vertical_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."vertical_pack"
    ADD CONSTRAINT "vertical_pack_vertical_code_key" UNIQUE ("vertical_code");


--
-- Name: candidate_set_session_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "candidate_set_session_seq_idx" ON "public"."candidate_set" USING "btree" ("scan_session_id", "session_seq");


--
-- Name: collectible_definition_lcid_corpus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "collectible_definition_lcid_corpus_idx" ON "public"."collectible_definition" USING "btree" ("definition_lcid", "corpus_version_id");


--
-- Name: collectible_definition_supersedes_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "collectible_definition_supersedes_once_idx" ON "public"."collectible_definition" USING "btree" ("supersedes_id") WHERE ("supersedes_id" IS NOT NULL);


--
-- Name: condition_assessment_scope_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "condition_assessment_scope_key" ON "public"."condition_assessment" USING "btree" ("id", "shop_id", "scan_session_id");


--
-- Name: condition_assessment_session_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "condition_assessment_session_seq_idx" ON "public"."condition_assessment" USING "btree" ("scan_session_id", "session_seq");


--
-- Name: condition_assessment_supersedes_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "condition_assessment_supersedes_once_idx" ON "public"."condition_assessment" USING "btree" ("supersedes_id") WHERE ("supersedes_id" IS NOT NULL);


--
-- Name: cost_log_outbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cost_log_outbox_idx" ON "public"."cost_log" USING "btree" ("outbox_id") WHERE ("outbox_id" IS NOT NULL);


--
-- Name: cost_log_session_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "cost_log_session_seq_idx" ON "public"."cost_log" USING "btree" ("scan_session_id", "session_seq");


--
-- Name: edition_definition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "edition_definition_idx" ON "public"."edition" USING "btree" ("definition_lcid", "corpus_version_id");


--
-- Name: edition_external_id_edition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "edition_external_id_edition_idx" ON "public"."edition_external_id" USING "btree" ("edition_lcid");


--
-- Name: edition_external_id_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "edition_external_id_lookup_idx" ON "public"."edition_external_id" USING "btree" ("provider", "external_id");


--
-- Name: edition_external_id_supersedes_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "edition_external_id_supersedes_once_idx" ON "public"."edition_external_id" USING "btree" ("supersedes_id") WHERE ("supersedes_id" IS NOT NULL);


--
-- Name: edition_lcid_corpus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "edition_lcid_corpus_idx" ON "public"."edition" USING "btree" ("edition_lcid", "corpus_version_id");


--
-- Name: edition_signature_edition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "edition_signature_edition_idx" ON "public"."edition_signature" USING "btree" ("edition_lcid");


--
-- Name: edition_signature_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "edition_signature_lookup_idx" ON "public"."edition_signature" USING "btree" ("vertical", "signature", "normalization_version");


--
-- Name: edition_supersedes_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "edition_supersedes_once_idx" ON "public"."edition" USING "btree" ("supersedes_id") WHERE ("supersedes_id" IS NOT NULL);


--
-- Name: human_confirmation_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "human_confirmation_outcome_idx" ON "public"."human_confirmation" USING "btree" ("shop_id", "source", "outcome") WHERE ("outcome" IS NOT NULL);


--
-- Name: human_confirmation_scope_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "human_confirmation_scope_key" ON "public"."human_confirmation" USING "btree" ("id", "shop_id", "scan_session_id");


--
-- Name: human_confirmation_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "human_confirmation_session_idx" ON "public"."human_confirmation" USING "btree" ("scan_session_id", "created_at" DESC, "id" DESC);


--
-- Name: human_confirmation_session_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "human_confirmation_session_seq_idx" ON "public"."human_confirmation" USING "btree" ("scan_session_id", "session_seq");


--
-- Name: human_confirmation_supersedes_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "human_confirmation_supersedes_once_idx" ON "public"."human_confirmation" USING "btree" ("supersedes_id") WHERE ("supersedes_id" IS NOT NULL);


--
-- Name: identity_resolution_edition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "identity_resolution_edition_idx" ON "public"."identity_resolution" USING "btree" ("edition_lcid");


--
-- Name: identity_resolution_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "identity_resolution_shop_idx" ON "public"."identity_resolution" USING "btree" ("shop_id");


--
-- Name: lcid_current_survivor_covering_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "lcid_current_survivor_covering_idx" ON "public"."lcid_current_survivor" USING "btree" ("lcid") INCLUDE ("survivor_lcid");


--
-- Name: lcid_merge_corpus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "lcid_merge_corpus_idx" ON "public"."lcid_merge" USING "btree" ("corpus_version_id");


--
-- Name: lcid_merge_surviving_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "lcid_merge_surviving_idx" ON "public"."lcid_merge" USING "btree" ("surviving_lcid");


--
-- Name: lcid_split_outcome_one_continuation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "lcid_split_outcome_one_continuation_idx" ON "public"."lcid_split_outcome" USING "btree" ("split_id") WHERE "is_continuation";


--
-- Name: listing_status_observation_latest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "listing_status_observation_latest_idx" ON "public"."listing_status_observation" USING "btree" ("shopify_draft_id", "observed_at" DESC, "id" DESC);


--
-- Name: listing_status_observation_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "listing_status_observation_shop_idx" ON "public"."listing_status_observation" USING "btree" ("shop_id", "observed_at" DESC);


--
-- Name: llm_rerank_session_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "llm_rerank_session_seq_idx" ON "public"."llm_rerank" USING "btree" ("scan_session_id", "session_seq");


--
-- Name: media_deletion_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "media_deletion_shop_idx" ON "public"."media_deletion" USING "btree" ("shop_id", "created_at" DESC);


--
-- Name: outbox_attempt_by_outbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "outbox_attempt_by_outbox_idx" ON "public"."outbox_attempt" USING "btree" ("outbox_id", "created_at" DESC, "id" DESC);


--
-- Name: outbox_attempt_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "outbox_attempt_kind_idx" ON "public"."outbox_attempt" USING "btree" ("outbox_id", "kind");


--
-- Name: outbox_attempt_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "outbox_attempt_shop_idx" ON "public"."outbox_attempt" USING "btree" ("shop_id", "created_at" DESC);


--
-- Name: outbox_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "outbox_claim_idx" ON "public"."outbox" USING "btree" ("shop_id", "scan_session_id", "session_seq", "created_at");


--
-- Name: outbox_session_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "outbox_session_seq_idx" ON "public"."outbox" USING "btree" ("scan_session_id", "session_seq");


--
-- Name: pricing_snapshot_scope_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "pricing_snapshot_scope_key" ON "public"."pricing_snapshot" USING "btree" ("id", "shop_id", "scan_session_id");


--
-- Name: pricing_snapshot_session_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "pricing_snapshot_session_seq_idx" ON "public"."pricing_snapshot" USING "btree" ("scan_session_id", "session_seq");


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
-- Name: scan_photo_session_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "scan_photo_session_seq_idx" ON "public"."scan_photo" USING "btree" ("scan_session_id", "session_seq");


--
-- Name: scan_photo_storage_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scan_photo_storage_key_idx" ON "public"."scan_photo" USING "btree" ("storage_key");


--
-- Name: scan_session_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scan_session_shop_idx" ON "public"."scan_session" USING "btree" ("shop_id", "created_at" DESC);


--
-- Name: scan_session_transition_against_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scan_session_transition_against_idx" ON "public"."scan_session_transition" USING "btree" ("against_table", "against_id");


--
-- Name: scan_session_transition_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scan_session_transition_session_idx" ON "public"."scan_session_transition" USING "btree" ("scan_session_id", "created_at" DESC);


--
-- Name: scan_session_transition_session_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "scan_session_transition_session_seq_idx" ON "public"."scan_session_transition" USING "btree" ("scan_session_id", "session_seq");


--
-- Name: scan_session_transition_shop_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "scan_session_transition_shop_kind_idx" ON "public"."scan_session_transition" USING "btree" ("shop_id", "kind", "created_at" DESC);


--
-- Name: shop_credentials_shop_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "shop_credentials_shop_kind_idx" ON "public"."shop_credentials" USING "btree" ("shop_id", "kind", "created_at" DESC);


--
-- Name: shop_pricing_policy_shop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "shop_pricing_policy_shop_idx" ON "public"."shop_pricing_policy" USING "btree" ("shop_id", "effective_from" DESC);


--
-- Name: shopify_draft_outbox_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "shopify_draft_outbox_uniq" ON "public"."shopify_draft" USING "btree" ("outbox_id") WHERE ("outbox_id" IS NOT NULL);


--
-- Name: shopify_draft_session_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "shopify_draft_session_seq_idx" ON "public"."shopify_draft" USING "btree" ("scan_session_id", "session_seq");


--
-- Name: vertical_pack_version_supersedes_once_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "vertical_pack_version_supersedes_once_idx" ON "public"."vertical_pack_version" USING "btree" ("supersedes_id") WHERE ("supersedes_id" IS NOT NULL);


--
-- Name: candidate_set candidate_set_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "candidate_set_append_only" BEFORE DELETE OR UPDATE ON "public"."candidate_set" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."candidate_set" ENABLE ALWAYS TRIGGER "candidate_set_append_only";


--
-- Name: collectible_definition collectible_definition_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "collectible_definition_append_only" BEFORE DELETE OR UPDATE ON "public"."collectible_definition" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."collectible_definition" ENABLE ALWAYS TRIGGER "collectible_definition_append_only";


--
-- Name: condition_assessment condition_assessment_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "condition_assessment_append_only" BEFORE DELETE OR UPDATE ON "public"."condition_assessment" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."condition_assessment" ENABLE ALWAYS TRIGGER "condition_assessment_append_only";


--
-- Name: condition_assessment condition_assessment_supersession_forward; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "condition_assessment_supersession_forward" BEFORE INSERT ON "public"."condition_assessment" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_backward_supersession"();

ALTER TABLE "public"."condition_assessment" ENABLE ALWAYS TRIGGER "condition_assessment_supersession_forward";


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
-- Name: data_source data_source_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "data_source_append_only" BEFORE DELETE OR UPDATE ON "public"."data_source" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."data_source" ENABLE ALWAYS TRIGGER "data_source_append_only";


--
-- Name: edition edition_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "edition_append_only" BEFORE DELETE OR UPDATE ON "public"."edition" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."edition" ENABLE ALWAYS TRIGGER "edition_append_only";


--
-- Name: edition_external_id edition_external_id_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "edition_external_id_append_only" BEFORE DELETE OR UPDATE ON "public"."edition_external_id" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."edition_external_id" ENABLE ALWAYS TRIGGER "edition_external_id_append_only";


--
-- Name: edition_external_id edition_external_id_certification_class; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "edition_external_id_certification_class" BEFORE INSERT ON "public"."edition_external_id" FOR EACH ROW EXECUTE FUNCTION "public"."refuse_machine_certification_outside_registrar"();

ALTER TABLE "public"."edition_external_id" ENABLE ALWAYS TRIGGER "edition_external_id_certification_class";


--
-- Name: edition_signature edition_signature_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "edition_signature_append_only" BEFORE DELETE OR UPDATE ON "public"."edition_signature" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."edition_signature" ENABLE ALWAYS TRIGGER "edition_signature_append_only";


--
-- Name: human_confirmation human_confirmation_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "human_confirmation_append_only" BEFORE DELETE OR UPDATE ON "public"."human_confirmation" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."human_confirmation" ENABLE ALWAYS TRIGGER "human_confirmation_append_only";


--
-- Name: human_confirmation human_confirmation_supersession_forward; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "human_confirmation_supersession_forward" BEFORE INSERT ON "public"."human_confirmation" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_backward_supersession"();

ALTER TABLE "public"."human_confirmation" ENABLE ALWAYS TRIGGER "human_confirmation_supersession_forward";


--
-- Name: identity_resolution identity_resolution_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "identity_resolution_append_only" BEFORE DELETE OR UPDATE ON "public"."identity_resolution" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."identity_resolution" ENABLE ALWAYS TRIGGER "identity_resolution_append_only";


--
-- Name: lcid_merge lcid_merge_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "lcid_merge_append_only" BEFORE DELETE OR UPDATE ON "public"."lcid_merge" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."lcid_merge" ENABLE ALWAYS TRIGGER "lcid_merge_append_only";


--
-- Name: lcid_merge lcid_merge_maintains_survivor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "lcid_merge_maintains_survivor" AFTER INSERT ON "public"."lcid_merge" FOR EACH ROW EXECUTE FUNCTION "public"."maintain_lcid_current_survivor"();

ALTER TABLE "public"."lcid_merge" ENABLE ALWAYS TRIGGER "lcid_merge_maintains_survivor";


--
-- Name: lcid_merge lcid_merge_no_cycle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "lcid_merge_no_cycle" BEFORE INSERT ON "public"."lcid_merge" FOR EACH ROW EXECUTE FUNCTION "public"."refuse_merge_cycle"();

ALTER TABLE "public"."lcid_merge" ENABLE ALWAYS TRIGGER "lcid_merge_no_cycle";


--
-- Name: lcid_merge lcid_merge_one_disposition; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "lcid_merge_one_disposition" BEFORE INSERT ON "public"."lcid_merge" FOR EACH ROW EXECUTE FUNCTION "public"."refuse_second_disposition"();

ALTER TABLE "public"."lcid_merge" ENABLE ALWAYS TRIGGER "lcid_merge_one_disposition";


--
-- Name: lcid_registry lcid_registry_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "lcid_registry_append_only" BEFORE DELETE OR UPDATE ON "public"."lcid_registry" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."lcid_registry" ENABLE ALWAYS TRIGGER "lcid_registry_append_only";


--
-- Name: lcid_retirement lcid_retirement_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "lcid_retirement_append_only" BEFORE DELETE OR UPDATE ON "public"."lcid_retirement" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."lcid_retirement" ENABLE ALWAYS TRIGGER "lcid_retirement_append_only";


--
-- Name: lcid_retirement lcid_retirement_one_disposition; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "lcid_retirement_one_disposition" BEFORE INSERT ON "public"."lcid_retirement" FOR EACH ROW EXECUTE FUNCTION "public"."refuse_second_disposition"();

ALTER TABLE "public"."lcid_retirement" ENABLE ALWAYS TRIGGER "lcid_retirement_one_disposition";


--
-- Name: lcid_split lcid_split_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "lcid_split_append_only" BEFORE DELETE OR UPDATE ON "public"."lcid_split" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."lcid_split" ENABLE ALWAYS TRIGGER "lcid_split_append_only";


--
-- Name: lcid_split lcid_split_one_disposition; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "lcid_split_one_disposition" BEFORE INSERT ON "public"."lcid_split" FOR EACH ROW EXECUTE FUNCTION "public"."refuse_second_disposition"();

ALTER TABLE "public"."lcid_split" ENABLE ALWAYS TRIGGER "lcid_split_one_disposition";


--
-- Name: lcid_split_outcome lcid_split_outcome_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "lcid_split_outcome_append_only" BEFORE DELETE OR UPDATE ON "public"."lcid_split_outcome" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."lcid_split_outcome" ENABLE ALWAYS TRIGGER "lcid_split_outcome_append_only";


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
-- Name: outbox outbox_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "outbox_append_only" BEFORE DELETE OR UPDATE ON "public"."outbox" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."outbox" ENABLE ALWAYS TRIGGER "outbox_append_only";


--
-- Name: outbox_attempt outbox_attempt_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "outbox_attempt_append_only" BEFORE DELETE OR UPDATE ON "public"."outbox_attempt" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."outbox_attempt" ENABLE ALWAYS TRIGGER "outbox_attempt_append_only";


--
-- Name: pricing_snapshot pricing_snapshot_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "pricing_snapshot_append_only" BEFORE DELETE OR UPDATE ON "public"."pricing_snapshot" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."pricing_snapshot" ENABLE ALWAYS TRIGGER "pricing_snapshot_append_only";


--
-- Name: pricing_snapshot pricing_snapshot_supersession_forward; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "pricing_snapshot_supersession_forward" BEFORE INSERT ON "public"."pricing_snapshot" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_backward_supersession"();

ALTER TABLE "public"."pricing_snapshot" ENABLE ALWAYS TRIGGER "pricing_snapshot_supersession_forward";


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
-- Name: scan_session_transition scan_session_transition_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "scan_session_transition_append_only" BEFORE DELETE OR UPDATE ON "public"."scan_session_transition" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."scan_session_transition" ENABLE ALWAYS TRIGGER "scan_session_transition_append_only";


--
-- Name: shopify_draft shopify_draft_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "shopify_draft_append_only" BEFORE DELETE OR UPDATE ON "public"."shopify_draft" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."shopify_draft" ENABLE ALWAYS TRIGGER "shopify_draft_append_only";


--
-- Name: vertical_pack vertical_pack_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "vertical_pack_append_only" BEFORE DELETE OR UPDATE ON "public"."vertical_pack" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."vertical_pack" ENABLE ALWAYS TRIGGER "vertical_pack_append_only";


--
-- Name: vertical_pack_version vertical_pack_version_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "vertical_pack_version_append_only" BEFORE DELETE OR UPDATE ON "public"."vertical_pack_version" FOR EACH ROW EXECUTE FUNCTION "public"."forbid_mutation"();

ALTER TABLE "public"."vertical_pack_version" ENABLE ALWAYS TRIGGER "vertical_pack_version_append_only";


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
-- Name: collectible_definition collectible_definition_corpus_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."collectible_definition"
    ADD CONSTRAINT "collectible_definition_corpus_version_id_fkey" FOREIGN KEY ("corpus_version_id") REFERENCES "public"."corpus_version"("id");


--
-- Name: collectible_definition collectible_definition_definition_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."collectible_definition"
    ADD CONSTRAINT "collectible_definition_definition_lcid_fkey" FOREIGN KEY ("definition_lcid") REFERENCES "public"."lcid_registry"("lcid");


--
-- Name: collectible_definition collectible_definition_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."collectible_definition"
    ADD CONSTRAINT "collectible_definition_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "public"."collectible_definition"("id");


--
-- Name: collectible_definition collectible_definition_vertical_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."collectible_definition"
    ADD CONSTRAINT "collectible_definition_vertical_fkey" FOREIGN KEY ("vertical") REFERENCES "public"."vertical_pack"("vertical");


--
-- Name: collectible_definition collectible_definition_vertical_pack_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."collectible_definition"
    ADD CONSTRAINT "collectible_definition_vertical_pack_version_id_fkey" FOREIGN KEY ("vertical_pack_version_id") REFERENCES "public"."vertical_pack_version"("id");


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
-- Name: condition_assessment condition_assessment_supersedes_same_scope; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."condition_assessment"
    ADD CONSTRAINT "condition_assessment_supersedes_same_scope" FOREIGN KEY ("supersedes_id", "shop_id", "scan_session_id") REFERENCES "public"."condition_assessment"("id", "shop_id", "scan_session_id");


--
-- Name: cost_log cost_log_outbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."cost_log"
    ADD CONSTRAINT "cost_log_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "public"."outbox"("id");


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
-- Name: edition edition_corpus_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition"
    ADD CONSTRAINT "edition_corpus_version_id_fkey" FOREIGN KEY ("corpus_version_id") REFERENCES "public"."corpus_version"("id");


--
-- Name: edition edition_definition_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition"
    ADD CONSTRAINT "edition_definition_lcid_fkey" FOREIGN KEY ("definition_lcid") REFERENCES "public"."lcid_registry"("lcid");


--
-- Name: edition edition_edition_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition"
    ADD CONSTRAINT "edition_edition_lcid_fkey" FOREIGN KEY ("edition_lcid") REFERENCES "public"."lcid_registry"("lcid");


--
-- Name: edition_external_id edition_external_id_corpus_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition_external_id"
    ADD CONSTRAINT "edition_external_id_corpus_version_id_fkey" FOREIGN KEY ("corpus_version_id") REFERENCES "public"."corpus_version"("id");


--
-- Name: edition_external_id edition_external_id_data_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition_external_id"
    ADD CONSTRAINT "edition_external_id_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id");


--
-- Name: edition_external_id edition_external_id_edition_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition_external_id"
    ADD CONSTRAINT "edition_external_id_edition_lcid_fkey" FOREIGN KEY ("edition_lcid") REFERENCES "public"."lcid_registry"("lcid");


--
-- Name: edition_external_id edition_external_id_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition_external_id"
    ADD CONSTRAINT "edition_external_id_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "public"."edition_external_id"("id");


--
-- Name: edition_external_id edition_external_id_vertical_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition_external_id"
    ADD CONSTRAINT "edition_external_id_vertical_fkey" FOREIGN KEY ("vertical") REFERENCES "public"."vertical_pack"("vertical");


--
-- Name: edition_signature edition_signature_corpus_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition_signature"
    ADD CONSTRAINT "edition_signature_corpus_version_id_fkey" FOREIGN KEY ("corpus_version_id") REFERENCES "public"."corpus_version"("id");


--
-- Name: edition_signature edition_signature_edition_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition_signature"
    ADD CONSTRAINT "edition_signature_edition_lcid_fkey" FOREIGN KEY ("edition_lcid") REFERENCES "public"."lcid_registry"("lcid");


--
-- Name: edition_signature edition_signature_vertical_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition_signature"
    ADD CONSTRAINT "edition_signature_vertical_fkey" FOREIGN KEY ("vertical") REFERENCES "public"."vertical_pack"("vertical");


--
-- Name: edition edition_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition"
    ADD CONSTRAINT "edition_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "public"."edition"("id");


--
-- Name: edition edition_vertical_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition"
    ADD CONSTRAINT "edition_vertical_fkey" FOREIGN KEY ("vertical") REFERENCES "public"."vertical_pack"("vertical");


--
-- Name: edition edition_vertical_pack_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."edition"
    ADD CONSTRAINT "edition_vertical_pack_version_id_fkey" FOREIGN KEY ("vertical_pack_version_id") REFERENCES "public"."vertical_pack_version"("id");


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
-- Name: human_confirmation human_confirmation_supersedes_same_scope; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."human_confirmation"
    ADD CONSTRAINT "human_confirmation_supersedes_same_scope" FOREIGN KEY ("supersedes_id", "shop_id", "scan_session_id") REFERENCES "public"."human_confirmation"("id", "shop_id", "scan_session_id");


--
-- Name: identity_resolution identity_resolution_corpus_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."identity_resolution"
    ADD CONSTRAINT "identity_resolution_corpus_version_id_fkey" FOREIGN KEY ("corpus_version_id") REFERENCES "public"."corpus_version"("id");


--
-- Name: identity_resolution identity_resolution_edition_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."identity_resolution"
    ADD CONSTRAINT "identity_resolution_edition_lcid_fkey" FOREIGN KEY ("edition_lcid") REFERENCES "public"."lcid_registry"("lcid");


--
-- Name: identity_resolution identity_resolution_human_confirmation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."identity_resolution"
    ADD CONSTRAINT "identity_resolution_human_confirmation_id_fkey" FOREIGN KEY ("human_confirmation_id") REFERENCES "public"."human_confirmation"("id");


--
-- Name: identity_resolution identity_resolution_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."identity_resolution"
    ADD CONSTRAINT "identity_resolution_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: lcid_current_survivor lcid_current_survivor_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_current_survivor"
    ADD CONSTRAINT "lcid_current_survivor_lcid_fkey" FOREIGN KEY ("lcid") REFERENCES "public"."lcid_registry"("lcid");


--
-- Name: lcid_current_survivor lcid_current_survivor_survivor_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_current_survivor"
    ADD CONSTRAINT "lcid_current_survivor_survivor_lcid_fkey" FOREIGN KEY ("survivor_lcid") REFERENCES "public"."lcid_registry"("lcid");


--
-- Name: lcid_merge lcid_merge_corpus_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_merge"
    ADD CONSTRAINT "lcid_merge_corpus_version_id_fkey" FOREIGN KEY ("corpus_version_id") REFERENCES "public"."corpus_version"("id");


--
-- Name: lcid_merge lcid_merge_losing_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_merge"
    ADD CONSTRAINT "lcid_merge_losing_lcid_fkey" FOREIGN KEY ("losing_lcid") REFERENCES "public"."lcid_registry"("lcid");


--
-- Name: lcid_merge lcid_merge_surviving_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_merge"
    ADD CONSTRAINT "lcid_merge_surviving_lcid_fkey" FOREIGN KEY ("surviving_lcid") REFERENCES "public"."lcid_registry"("lcid");


--
-- Name: lcid_registry lcid_registry_minted_in_corpus_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_registry"
    ADD CONSTRAINT "lcid_registry_minted_in_corpus_version_id_fkey" FOREIGN KEY ("minted_in_corpus_version_id") REFERENCES "public"."corpus_version"("id");


--
-- Name: lcid_registry lcid_registry_vertical_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_registry"
    ADD CONSTRAINT "lcid_registry_vertical_code_fkey" FOREIGN KEY ("vertical_code") REFERENCES "public"."vertical_pack"("vertical_code");


--
-- Name: lcid_retirement lcid_retirement_corpus_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_retirement"
    ADD CONSTRAINT "lcid_retirement_corpus_version_id_fkey" FOREIGN KEY ("corpus_version_id") REFERENCES "public"."corpus_version"("id");


--
-- Name: lcid_retirement lcid_retirement_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_retirement"
    ADD CONSTRAINT "lcid_retirement_lcid_fkey" FOREIGN KEY ("lcid") REFERENCES "public"."lcid_registry"("lcid");


--
-- Name: lcid_split lcid_split_corpus_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_split"
    ADD CONSTRAINT "lcid_split_corpus_version_id_fkey" FOREIGN KEY ("corpus_version_id") REFERENCES "public"."corpus_version"("id");


--
-- Name: lcid_split_outcome lcid_split_outcome_product_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_split_outcome"
    ADD CONSTRAINT "lcid_split_outcome_product_lcid_fkey" FOREIGN KEY ("product_lcid") REFERENCES "public"."lcid_registry"("lcid");


--
-- Name: lcid_split_outcome lcid_split_outcome_split_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_split_outcome"
    ADD CONSTRAINT "lcid_split_outcome_split_id_fkey" FOREIGN KEY ("split_id") REFERENCES "public"."lcid_split"("id");


--
-- Name: lcid_split lcid_split_source_lcid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."lcid_split"
    ADD CONSTRAINT "lcid_split_source_lcid_fkey" FOREIGN KEY ("source_lcid") REFERENCES "public"."lcid_registry"("lcid");


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
-- Name: outbox_attempt outbox_attempt_outbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."outbox_attempt"
    ADD CONSTRAINT "outbox_attempt_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "public"."outbox"("id");


--
-- Name: outbox_attempt outbox_attempt_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."outbox_attempt"
    ADD CONSTRAINT "outbox_attempt_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


--
-- Name: outbox outbox_scan_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."outbox"
    ADD CONSTRAINT "outbox_scan_session_id_fkey" FOREIGN KEY ("scan_session_id") REFERENCES "public"."scan_session"("id");


--
-- Name: outbox outbox_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."outbox"
    ADD CONSTRAINT "outbox_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


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
-- Name: pricing_snapshot pricing_snapshot_supersedes_same_scope; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pricing_snapshot"
    ADD CONSTRAINT "pricing_snapshot_supersedes_same_scope" FOREIGN KEY ("supersedes_id", "shop_id", "scan_session_id") REFERENCES "public"."pricing_snapshot"("id", "shop_id", "scan_session_id");


--
-- Name: request_idempotency request_idempotency_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."request_idempotency"
    ADD CONSTRAINT "request_idempotency_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


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
-- Name: scan_session_transition scan_session_transition_scan_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."scan_session_transition"
    ADD CONSTRAINT "scan_session_transition_scan_session_id_fkey" FOREIGN KEY ("scan_session_id") REFERENCES "public"."scan_session"("id");


--
-- Name: scan_session_transition scan_session_transition_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."scan_session_transition"
    ADD CONSTRAINT "scan_session_transition_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id");


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
-- Name: shopify_draft shopify_draft_outbox_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."shopify_draft"
    ADD CONSTRAINT "shopify_draft_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "public"."outbox"("id");


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
-- Name: vertical_pack_version vertical_pack_version_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."vertical_pack_version"
    ADD CONSTRAINT "vertical_pack_version_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "public"."vertical_pack_version"("id");


--
-- Name: vertical_pack_version vertical_pack_version_vertical_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."vertical_pack_version"
    ADD CONSTRAINT "vertical_pack_version_vertical_fkey" FOREIGN KEY ("vertical") REFERENCES "public"."vertical_pack"("vertical");


--
-- PostgreSQL database dump complete
--

\unrestrict dwI9k7MtLdC4dbOKq1vDeqwbaB6xMWFx2lO6Cof7qOj8XetzDvWlCLZHzSRpnbt


--
-- Synthetic seed, written from FIXTURE_SEED in scripts/makeSchemaFixture.ts.
-- NOT a dump of anything: the tables it touches are shop, shop_pricing_policy, scan_session, scan_photo, candidate_set, human_confirmation, condition_assessment, cost_log
-- plus schema_migrations, and every id is fixed so a regeneration is byte-stable.
--
SET search_path TO "public";
INSERT INTO schema_migrations (filename) VALUES
  ('001_init.sql'),
  ('002_ebay_credential_kind.sql'),
  ('003_reserve_principle_slots.sql'),
  ('004_human_confirmation_outcome.sql'),
  ('005_listing_status_observation.sql'),
  ('006_append_only_enable_always.sql'),
  ('007_observation_envelope.sql'),
  ('008_supersession_integrity.sql'),
  ('009_request_idempotency.sql'),
  ('010_scan_session_transition.sql'),
  ('011_outbox.sql'),
  ('012_cost_log_outbox_id.sql'),
  ('013_supersession_forward_ordering.sql'),
  ('014_credential_namespace_and_host_allowlist.sql'),
  ('015_llm_rerank_band_inputs.sql'),
  ('016_catalog_core.sql'),
  ('017_lcid_lifecycle_and_resolution.sql'),
  ('018_scan_photo_bytes_and_hash.sql');

INSERT INTO shop (id, name, slug) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Fixture Comics', 'fixture-comics');
INSERT INTO shop_pricing_policy (id, shop_id, comp_percent, floor_cents, rounding_rule) VALUES
  ('11111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', 90, 300, 'nearest_99');
INSERT INTO scan_session (id, shop_id, created_by) VALUES
  ('22222222-2222-4222-8222-222222222221', '11111111-1111-4111-8111-111111111111', 'fixture-operator');
INSERT INTO scan_photo (id, scan_session_id, shop_id, kind, storage_url) VALUES
  ('33333333-3333-4333-8333-333333333331', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'cover', 'file:///fixture/cover.jpg');
-- Two candidate sets, one per authorship branch, so 007's GENERATED derivation is
-- exercised in BOTH directions by the upgrade test rather than in one.
INSERT INTO candidate_set (id, scan_session_id, shop_id, method, candidates) VALUES
  ('44444444-4444-4444-8444-444444444441', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'barcode', '[]'::jsonb),
  ('44444444-4444-4444-8444-444444444442', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'llm_vision', '[]'::jsonb);
INSERT INTO human_confirmation (id, scan_session_id, shop_id, confirmed_issue, source, confirmed_by) VALUES
  ('55555555-5555-4555-8555-555555555551', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', '{"title":"Fixture","issue":"1"}'::jsonb,
   'one_tap', 'fixture-operator');
INSERT INTO condition_assessment (id, scan_session_id, shop_id, grade_range_low, grade_range_high, defects) VALUES
  ('66666666-6666-4666-8666-666666666661', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'VG', 'FN', ARRAY[]::text[]);
INSERT INTO cost_log (id, shop_id, scan_session_id, provider, model, tokens_in, tokens_out, estimated_usd) VALUES
  ('77777777-7777-4777-8777-777777777771', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222221', 'anthropic', 'claude-sonnet-5', 100, 20, 0.0012);

