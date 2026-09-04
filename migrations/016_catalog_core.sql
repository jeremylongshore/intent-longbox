-- 016_catalog_core.sql — E04-D01 (bead longbox-e5b.4.13)
--
-- 030 v1.2.1 §7's catalog tables and 047 v1.1.2 §3/§4/§8's registry, as DDL for
-- the first time. Docs: 047 §3 (the namespace), §4 (the mint), §8 (alias
-- namespaces and the catalog-authoring role), §9.3 (the signature); 030 §2.2,
-- §2.3, §2.5, §3.3, §4, §5.2, §7; 041 §2.1–§2.3 (the envelope), §9.2 item 4
-- (the declared list); 000-docs/044 §2, §7.
--
-- WHAT THIS FILE IS FOR, IN ONE PARAGRAPH. Until this migration the system had
-- no way to say what a comic IS: `human_confirmation.confirmed_issue` is an
-- untyped jsonb blob (`001:115`) and the wire contract types it `z.unknown()`
-- (`src/contracts/v1/schemas.ts:205`) because there was nothing to describe it
-- as. 047 §1 is the record of that absence. This file lands the referent: an
-- insert-only registry whose primary key IS the platform's canonical identity,
-- and the definition/edition/signature/crosswalk tables that hang off it.
--
-- SHAPE: EXPAND ONLY (000-docs/044 §2). No shipped migration is edited. Every
-- statement is `CREATE … IF NOT EXISTS` or DROP-then-CREATE, so a hand re-run is
-- a no-op. There is no UPDATE statement in this file and no backfill: every
-- table here starts EMPTY, and 030 §7.1's reasoning applies to all of them — a
-- table added later loses no history because its facts are dated when they are
-- MADE. What could not be added later is the FOREIGN KEY from every `*_lcid`
-- column to `lcid_registry(lcid)` (047 I2), because adding it retroactively
-- would require touching immutable rows. That is why the registry lands now.
--
-- ⚠ NO `shop_id` ON ANY TABLE IN THIS FILE. 030 §2.1: a catalog fact is not a
-- tenant's property, and 029 §2.3 requires `catalog` to be readable by a batch
-- importer with no pipeline present. The moment a definition is shop-scoped,
-- importing the GCD dump becomes a per-tenant operation. `identity_resolution`
-- — the one workflow-owned, shop-scoped table in this cluster — is deliberately
-- in `015`, not here, so that this file's "no shop_id" rule reads as absolute.
--
-- ⚠ NO UNIQUE ON `edition_signature.signature` (047 A1 / I17). Its absence is a
-- DECISION, not an oversight, and it is the one thing in this file most likely
-- to be "fixed" by a future reader. The mint path is deliberately AP on a
-- signature collision: two concurrent importers minting for one signature
-- produce TWO valid LCIDs, and the repair is a later human-arbitrated
-- `lcid_merge` fact (030 §3.3: "a dedupe candidate… never an automatic merge").
-- A UNIQUE here converts a dedupe candidate into a write failure and pushes the
-- arbitration onto whichever writer lost the race.
--
-- ⚠ DECISION MADE HERE, BECAUSE 047 AND 030 DISAGREED ON ONE COLUMN NAME.
-- 047 §3.1 says the LCID's third segment is "the registered THREE-CHARACTER
-- vertical code" (`cmc`), and §4.2's sketch writes that column as
-- `lcid_registry.vertical REFERENCES vertical_pack(vertical)` — which only type-
-- checks against §4.2's own prefix CHECK if `vertical_pack.vertical` is itself
-- three characters. 030 §3.2/§5.4 uses `vertical` for the DISCRIMINATOR that
-- selects the pack, whose values are `'comic'` and `'sports-card'` — eleven
-- characters, and unusable as an LCID segment. Both cannot be the same column.
-- So `vertical_pack` carries BOTH, one of them as its key:
--     vertical      text PRIMARY KEY   -- 030's discriminator: 'comic'
--     vertical_code text UNIQUE        -- 047's LCID segment:  'cmc'
-- and `lcid_registry` names the second as `vertical_code`. 047 §4.2's CHECK is
-- preserved in effect and in spelling — only the column's NAME changes, so that
-- `edition.vertical` and `lcid_registry.vertical_code` can never be read as the
-- same value. Recorded as a decision rather than taken silently.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. `vertical_pack` and `vertical_pack_version` — the pack registry (030 §5.2).
--
--    INSERT-ONLY, not append-only-with-supersession, for `vertical_pack`: a pack
--    is REGISTERED once and evolves by a new `vertical_pack_version` row
--    (030 §7). Insert-only and append-only are the same enforcement here — the
--    `forbid_mutation()` trigger refuses UPDATE and DELETE and nothing else — so
--    both tables join the declared trigger set in `src/db/appendOnlyTables.ts`
--    rather than taking an exemption row. An exemption would say "this table is
--    deliberately mutable", which is false of both.
--
--    `pack_version` is SINGLE-RATE (030 A5): one number governs the whole
--    manifest. There is deliberately no `signature_fn_version` beside it.
--
--    THE MANIFEST IS ONE `jsonb` COLUMN, NOT NINE. 030 §5.1's slots
--    (identitySchema, captureRecipe, conditionSchema, providerCrosswalk,
--    valuationNormalization, prohibitedClaims, …) are the PACK MANIFEST AS
--    SHIPPED CODE, which 047 §12.3 assigns to E04-B04. Spelling them as nine
--    typed columns here would decide that bead's contract from a table
--    definition. One `manifest jsonb` validated by the pack loader is the honest
--    floor; promoting a slot to a column later is an expand migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vertical_pack (
  vertical      text PRIMARY KEY,
  -- 047 §3.3: assigned in the pack row, never invented per LCID and never
  -- hard-coded in the mint helper. Crockford-safe lowercase letters only, so the
  -- code can never collide with the payload alphabet's digits.
  vertical_code text NOT NULL UNIQUE CHECK (vertical_code ~ '^[a-z]{3}$'),
  registered_at timestamptz NOT NULL DEFAULT now(),
  authored_by   text NOT NULL DEFAULT 'human' CHECK (authored_by IN ('human', 'system', 'provider')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE vertical_pack IS
  '030 §5.2 / 047 §3.3. One row per registered vertical. `vertical` is the '
  'discriminator that selects the pack (030); `vertical_code` is the three-character '
  'segment that appears in every LCID minted in it (047 §3.1). 030 §6 rule 3 forbids '
  'accepting an unregistered vertical anywhere, and 047 §3.3 makes minting one of the '
  'places that must fail closed — which is what the FK from lcid_registry enforces.';

CREATE TABLE IF NOT EXISTS vertical_pack_version (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical          text NOT NULL REFERENCES vertical_pack(vertical),
  pack_version      integer NOT NULL CHECK (pack_version > 0),
  manifest          jsonb NOT NULL,
  -- 030 §5.2's honest edge: a function cannot live in a jsonb column, so the row
  -- names a module path and the pack registry resolves it at boot, FAILING CLOSED
  -- if it is missing. A registered pack whose signature function has been deleted
  -- must stop the process, not silently mis-dedupe.
  signature_fn_ref  text NOT NULL,
  authored_by       text NOT NULL DEFAULT 'human' CHECK (authored_by IN ('human', 'system', 'provider')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  supersedes_id     uuid REFERENCES vertical_pack_version(id),
  CONSTRAINT vertical_pack_version_not_self CHECK (supersedes_id IS DISTINCT FROM id),
  CONSTRAINT vertical_pack_version_rate UNIQUE (vertical, pack_version)
);

-- 003:98-104's pattern: a superseded row is superseded ONCE, so correction
-- history is a chain and never a fork.
CREATE UNIQUE INDEX IF NOT EXISTS vertical_pack_version_supersedes_once_idx
  ON vertical_pack_version (supersedes_id) WHERE supersedes_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. `data_source` — the rights row (030 §4; 019 T25, NON-WAIVABLE).
--
--    "Nothing imports without a `data_source_id`." The table exists here because
--    `edition_external_id` FKs it and 019 T25 makes that FK non-optional. The
--    RIGHTS REGISTRY ITSELF — what a licence permits, whether CC BY-SA 4.0
--    metadata may seed a commercial catalog, what attribution attaches to a
--    derived row — is E04-B05's, and 047 §12.3 routes the licence question to
--    counsel. This file records the columns and asserts nothing about any
--    licence.
--
--    TERMS ARE FIXED AT REGISTRATION, and the missing supersession column says so
--    rather than hiding it. `UNIQUE (name)` plus no `supersedes_id` means a source
--    is registered once and its licence text is what every import made under it
--    relied on. That is deliberately NOT the same as "a terms change is a new
--    row": whether a licence change supersedes, and what it does to rows already
--    derived under the old terms, is a rights decision this bead does not own.
--    E04-B05 makes it, and adds the chain if it needs one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_source (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL UNIQUE,
  -- 047 §8.2's four classes, minus the fourth: a copy-level certification
  -- namespace is NOT an edition alias at all (§8.4), so it can never be a data
  -- source for the crosswalk and the CHECK does not admit one.
  namespace_class      text NOT NULL CHECK (namespace_class IN ('registrar', 'community', 'commercial')),
  licence              text,
  terms_url            text,
  attribution_required boolean NOT NULL DEFAULT false,
  authored_by          text NOT NULL DEFAULT 'human' CHECK (authored_by IN ('human', 'system', 'provider')),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. `lcid_registry` — THE MINT (047 §4).
--
--    "An LCID comes into existence by inserting one row into `lcid_registry`,
--    inside the transaction that writes the first catalog row citing it."
--    The INSERT *is* the mint. There is no separate allocation step, no
--    pre-allocated block, and no `status` column (047 §5.1) — the lifecycle is a
--    derivation over the facts in `015`, and a status column on an insert-only
--    table is a column that can never be set.
--
--    INSERT-ONLY, NOT APPEND-ONLY-WITH-SUPERSESSION, and the difference is not
--    pedantry (047 §4.2). Every other immutable table supports correction by
--    supersession because it has CONTENT that can be wrong. A registry row has no
--    content: it asserts that a name has been issued. So there is no
--    `supersedes_id` here, and a mistaken mint is repaired by an `lcid_retirement`
--    fact (015), never by an edit.
--
--    NEVER REUSED (047 §4.3, invariant I1 — the one invariant with no acceptable
--    exception). A reused LCID makes every historical reference silently mean
--    something new, and under append-only rules there is NO REPAIR: the
--    referencing rows cannot be updated. The primary key is what enforces it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lcid_registry (
  lcid                        text PRIMARY KEY,
  kind                        text NOT NULL CHECK (kind IN ('definition', 'edition')),
  vertical_code               text NOT NULL REFERENCES vertical_pack(vertical_code),
  minted_in_corpus_version_id uuid NOT NULL REFERENCES corpus_version(id),
  -- 047 §4.4: TWO ways to mint and only two. A resolution proposal — a barcode
  -- parse, a vision candidate, a similarity hit, a crosswalk edge under review —
  -- NEVER mints one (§5.2). There is no 'proposed' value and there never will be:
  -- minting for a guess would put a machine's opinion into a never-reused
  -- namespace, and §4.3 means it could never be freed.
  minted_by                   text NOT NULL CHECK (minted_by IN ('import', 'human_review')),
  -- 041 §2.3's envelope. `minted_by` is the CAUSE; `authored_by` is who produced
  -- the row's content. They are different facts and 041 refuses to collapse them.
  authored_by                 text NOT NULL DEFAULT 'system' CHECK (authored_by IN ('human', 'system', 'provider')),
  issued_at                   timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),

  -- 047 §3.1's grammar: `lb.<kind><vertical_code>.<16 payload><1 check>`, canonical
  -- LOWERCASE, Crockford base32 (no i, l, o, u in the payload alphabet). The check
  -- character is Crockford's mod-37 symbol, so it may additionally be one of
  -- `* ~ $ = u`. Equality is byte equality on this canonical form.
  CONSTRAINT lcid_registry_grammar
    CHECK (lcid ~ '^lb\.[de]\.[a-z]{3}\.[0-9abcdefghjkmnpqrstvwxyz]{16}[0-9abcdefghjkmnpqrstvwxyz*~$=u]$'),

  -- 047 §3.2 / §4.2 / I3 — THE ENFORCED REDUNDANCY. The string cannot disagree
  -- with the row. "A redundancy a constraint checks is not duplication; a
  -- redundancy nothing checks is drift waiting." An LCID may encode only what can
  -- never be corrected, and `kind` and `vertical` are the only two facts in the
  -- whole catalog that qualify: a definition never becomes an edition, and a book
  -- never becomes a trading card. Publisher, series, issue, year, printing and
  -- variant do NOT qualify, which is why none of them is in the string.
  CONSTRAINT lcid_registry_string_agrees_with_row
    CHECK (lcid = 'lb.' || substr(kind, 1, 1) || '.' || vertical_code || '.' || substr(lcid, 10))
);

COMMENT ON TABLE lcid_registry IS
  '047 §4. The Longbox Canonical Collectible ID. Insert-only: no UPDATE, no DELETE, '
  'no supersession, no reuse, ever (I1). It carries NO shop_id and therefore no shop '
  'anchor, which is why the mint INSERT takes no anchor lock (047 A5) and why 047 '
  '§6.3(b) rejects "the LCID with more references survives" — that rule would let one '
  'tenant''s inventory volume decide the shared catalog''s canonical names, a tenancy '
  'leak in a table with no tenancy (019 T24, non-waivable).';

COMMENT ON COLUMN lcid_registry.minted_in_corpus_version_id IS
  '047 §10.1: where a name entered the world. A later corpus may add rows, aliases, '
  'merges, splits and retirements against that LCID; no corpus can un-mint it. It is '
  'also what makes `resolve(lcid, asOf)` able to answer NOT_YET_MINTED (047 §10.2) '
  'rather than conflating "did not exist yet" with "never existed".';

-- ---------------------------------------------------------------------------
-- 4. `collectible_definition` and `edition` (030 §2.2, §2.3).
--
--    Both are VALUES, versioned: many rows per LCID, one per corpus version in
--    which the thing appears, plus in-corpus corrections chained by
--    `supersedes_id`. Neither carries `shop_id`. Neither is ever updated.
--
--    TWO SUPERSESSION MECHANISMS, DELIBERATELY NOT COLLAPSED (030 §2.2):
--      * A CORPUS ADVANCE produces a new row for the same LCID and supersedes
--        NOTHING — the old row remains the truth as of its corpus version, which
--        is what keeps a two-year-old candidate_set interpretable.
--      * An IN-CORPUS CORRECTION is a new row with `supersedes_id` pointing at the
--        wrong one, in the SAME corpus version, at most once.
--
--    THE `*_lcid` COLUMNS FK `lcid_registry(lcid)`, NEVER `edition.id`
--    (030 §2.5, A2). An FK to `edition.id` is impossible — `edition_lcid` is not
--    unique in `edition`, because many corpus-version rows share one LCID, which
--    is the whole design. An FK to `lcid_registry(lcid)` is straightforward,
--    because that table has exactly one row per LCID by construction. "Point at
--    the LCID, never at the row" never required giving up referential integrity.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collectible_definition (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_lcid          text NOT NULL REFERENCES lcid_registry(lcid),
  vertical                 text NOT NULL REFERENCES vertical_pack(vertical),
  vertical_pack_version_id uuid NOT NULL REFERENCES vertical_pack_version(id),
  corpus_version_id        uuid NOT NULL REFERENCES corpus_version(id),
  attributes               jsonb NOT NULL,
  signature                text NOT NULL,
  authored_by              text NOT NULL DEFAULT 'system' CHECK (authored_by IN ('human', 'system', 'provider')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  supersedes_id            uuid REFERENCES collectible_definition(id),
  CONSTRAINT collectible_definition_not_self CHECK (supersedes_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX IF NOT EXISTS collectible_definition_supersedes_once_idx
  ON collectible_definition (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS collectible_definition_lcid_corpus_idx
  ON collectible_definition (definition_lcid, corpus_version_id);

CREATE TABLE IF NOT EXISTS edition (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_lcid             text NOT NULL REFERENCES lcid_registry(lcid),
  -- 030 §2.3: which work this is an edition of. References the LCID, not a
  -- version row.
  definition_lcid          text NOT NULL REFERENCES lcid_registry(lcid),
  vertical                 text NOT NULL REFERENCES vertical_pack(vertical),
  vertical_pack_version_id uuid NOT NULL REFERENCES vertical_pack_version(id),
  corpus_version_id        uuid NOT NULL REFERENCES corpus_version(id),
  attributes               jsonb NOT NULL,
  signature                text NOT NULL,
  -- 030 §2.3: "if you only know the issue, this is the default printing" — the
  -- row that lets a DEFINITION-level match still produce a listing. 047 §2.2
  -- requires the resolution's `method` to record that it resolved this way, so
  -- "we only knew the issue" is a readable fact rather than an indistinguishable
  -- success.
  is_canonical_edition     boolean NOT NULL DEFAULT false,
  authored_by              text NOT NULL DEFAULT 'system' CHECK (authored_by IN ('human', 'system', 'provider')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  supersedes_id            uuid REFERENCES edition(id),
  CONSTRAINT edition_not_self CHECK (supersedes_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX IF NOT EXISTS edition_supersedes_once_idx
  ON edition (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS edition_lcid_corpus_idx ON edition (edition_lcid, corpus_version_id);
CREATE INDEX IF NOT EXISTS edition_definition_idx ON edition (definition_lcid, corpus_version_id);

-- 030 I7 — `edition.vertical` must equal its definition's — is NOT enforced here
-- and the omission is deliberate rather than forgotten. The parent is a VERSIONED
-- row set: there is no single `collectible_definition` row to FK, so the rule is
-- a cross-row assertion Postgres cannot express as a constraint without a trigger
-- that reads a corpus version the writer has not necessarily pinned. It is 030
-- I7's test to make, over the data, and E04-B02 owns the comic identity schema
-- that gives it something to assert about.

-- ---------------------------------------------------------------------------
-- 5. `edition_signature` — a TABLE, not a column (030 §3.3, A4).
--
--    An edition may have MORE THAN ONE valid signature: a series renamed mid-run,
--    a set with a regional alternate name. 030 A4 overruled the ordinary
--    start-as-a-column YAGNI move on RECOVERABILITY, not on frequency: a column
--    that turns out to need two values is unrecoverable, because the write path
--    must choose one and discard the other, the row cannot be updated, and the
--    alias was never recorded anywhere. A table that turns out to hold one row per
--    edition is a rounding error.
--
--    `normalization_version` (047 §9.3) is the version of the RULE that produced
--    this string. It is NOT `vertical_pack_version.pack_version`: the pack version
--    governs the whole manifest single-rate, while this column lets a reader ask
--    "which normalization produced this exact text" without resolving a pack. A
--    function change produces NEW rows in a new corpus version and never rewrites
--    old ones.
--
--    ⚠ NO UNIQUE. See the header. 047 I17 asserts the absence as a test, so
--    adding one fails a build rather than passing a review.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edition_signature (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical             text NOT NULL REFERENCES vertical_pack(vertical),
  signature            text NOT NULL,
  normalization_version integer NOT NULL CHECK (normalization_version > 0),
  edition_lcid         text NOT NULL REFERENCES lcid_registry(lcid),
  corpus_version_id    uuid NOT NULL REFERENCES corpus_version(id),
  authored_by          text NOT NULL DEFAULT 'system' CHECK (authored_by IN ('human', 'system', 'provider')),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- 030 §3.1 Q2/Q3: the ONE hot equality lookup every vertical shares. Non-unique
-- BY DESIGN (047 A1/I17).
CREATE INDEX IF NOT EXISTS edition_signature_lookup_idx
  ON edition_signature (vertical, signature, normalization_version);
CREATE INDEX IF NOT EXISTS edition_signature_edition_idx ON edition_signature (edition_lcid);

-- ---------------------------------------------------------------------------
-- 6. `edition_external_id` — the crosswalk (030 §4, 047 §8).
--
--    Every external identifier is an ALIAS under a rights row: never a key, never
--    a primary key, never a foreign-key target. `(provider, external_id)` is NOT
--    unique and is NOT a key — providers reuse, recycle and mis-issue IDs, and two
--    providers may agree on a string by accident.
--
--    047 §8 ADDS NO SECOND ALIAS TABLE, and this file honours that literally.
--    E04-D01's brief named an `lcid_alias` table beside this one; §8.1 says in
--    terms: "This record adds no second alias table. What it adds is a
--    CLASSIFICATION of namespaces." The ratified record wins over the brief, so
--    the classification lands as `namespace_class` on `data_source` (§2 above)
--    and as the certification columns below, and there is exactly one crosswalk.
--
--    ⚠ TWO CHECKS ARE THE POINT OF THIS TABLE.
--
--    (a) A GRADER CERT IS NEVER AN EDITION ALIAS (047 §8.4, I13). A PSA or CGC
--        certification number identifies ONE SLABBED COPY. A CGC-slabbed ASM #300
--        is the SAME EDITION as a raw one — a different copy, in a different
--        condition, at a different price, and none of those three is identity.
--        A cert-number edge would make one shop's slab a property of the shared
--        catalog, and then 047 §2.3's three consequences follow: the same physical
--        book changes edition when it is graded; two shops disagree about the
--        catalog depending on whether either has sent theirs to a grader; and the
--        grade enters identity, which locked decision 5 and 019 T7 (non-waivable)
--        forbid. Per 047 A6 this is not a comic rule: grader and cert_number are
--        COPY facts in EVERY vertical (030's amend-by-a-row, carried at v1.2.1).
--
--    (b) A CERTIFICATION WRITE IS A CATALOG-AUTHORING ACT, NEVER A SHOP-WORKFLOW
--        ACT (047 A4, §8.4). The hazard is that the crosswalk is a NON-TENANT-
--        SCOPED table written during work that always has a tenant in scope. If a
--        shop-scoped session's identity can author an edge, one tenant's
--        operational choice mutates a table that deliberately carries no
--        `shop_id`. 019 T24 signs cross-tenant influence at zero and is
--        non-waivable, but T24's tenant-DATA detector cannot see this: no shop's
--        data crosses. What crosses is AUTHORITY.
--        `decided_by_role` with a closed CHECK is the honest floor available
--        today: authn and the real role model are E03's, and 047 §12.3 assigns
--        E04-B06 the job of stating and building the detector. A text column with
--        a CHECK refuses `'shop_operator'` at the database now, rather than
--        waiting for a role system to exist.
--
--    (c) AUTO-CERTIFICATION IS BOUNDED BY NAMESPACE CLASS (047 §6.3, §8.2). Only
--        a REGISTRAR-issued namespace (upc/ean/isbn — "issued by a standards body
--        to a publisher; nobody's product") may certify without a human. A
--        community catalog or a commercial provider PROPOSES and never certifies;
--        a model never certifies (locked decision 7, 014 §4.3). The CHECK below
--        expresses exactly that.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edition_external_id (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_lcid            text NOT NULL REFERENCES lcid_registry(lcid),
  provider                text NOT NULL,
  external_id             text NOT NULL,
  vertical                text NOT NULL REFERENCES vertical_pack(vertical),
  provider_schema_version text,
  corpus_version_id       uuid NOT NULL REFERENCES corpus_version(id),
  match_method            text NOT NULL CHECK (match_method IN ('exact', 'rule', 'similarity', 'human')),
  -- NEVER NUMERIC (022 P1, 019 T7, locked decision 5). A confidence that is a
  -- number is a grade wearing a different name.
  confidence              text,
  contradiction           jsonb,
  -- 019 T25, NON-WAIVABLE: nothing imports without a rights row.
  data_source_id          uuid NOT NULL REFERENCES data_source(id),
  source_record_hash      text,
  target_record_hash      text,
  effective_from          timestamptz,
  reviewer                text,
  certified               boolean NOT NULL DEFAULT false,
  certified_at            timestamptz,
  decided_by              text,
  decided_by_role         text,
  authored_by             text NOT NULL DEFAULT 'system' CHECK (authored_by IN ('human', 'system', 'provider')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  supersedes_id           uuid REFERENCES edition_external_id(id),
  CONSTRAINT edition_external_id_not_self CHECK (supersedes_id IS DISTINCT FROM id),

  -- (a) 047 §8.4 / I13.
  CONSTRAINT edition_external_id_no_cert_namespace
    CHECK (provider NOT IN ('psa_cert', 'cgc_cert', 'cbcs_cert')),

  -- (b) 047 A4. A catalog-authoring role, or nothing.
  CONSTRAINT edition_external_id_catalog_authoring_role
    CHECK (
      decided_by_role IS NULL
      OR decided_by_role IN ('catalog_author', 'catalog_reviewer', 'catalog_importer')
    ),

  -- A certification names who decided it and in what role. An uncertified edge is
  -- a PROPOSAL and needs neither.
  CONSTRAINT edition_external_id_certification_is_decided
    CHECK (
      certified = false
      OR (decided_by IS NOT NULL AND decided_by_role IS NOT NULL AND certified_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS edition_external_id_supersedes_once_idx
  ON edition_external_id (supersedes_id) WHERE supersedes_id IS NOT NULL;
-- 030 §3.1 Q1: the barcode lookup. NOT unique — see rule 1 of 030 §4.
CREATE INDEX IF NOT EXISTS edition_external_id_lookup_idx ON edition_external_id (provider, external_id);
CREATE INDEX IF NOT EXISTS edition_external_id_edition_idx ON edition_external_id (edition_lcid);

-- (c) 047 §6.3 / §8.2 — only a registrar-issued namespace may certify without a
--     human. Expressed as a trigger rather than a CHECK because the namespace
--     class lives on `data_source`, and a CHECK may not read another table.
CREATE OR REPLACE FUNCTION refuse_machine_certification_outside_registrar() RETURNS trigger
LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS edition_external_id_certification_class ON edition_external_id;
CREATE TRIGGER edition_external_id_certification_class
  BEFORE INSERT ON edition_external_id
  FOR EACH ROW EXECUTE FUNCTION refuse_machine_certification_outside_registrar();
ALTER TABLE edition_external_id ENABLE ALWAYS TRIGGER edition_external_id_certification_class;

-- ---------------------------------------------------------------------------
-- 7. Append-only triggers, in 003:237-248's idempotent DROP-then-CREATE form,
--    followed IMMEDIATELY by ENABLE ALWAYS.
--
--    THE `ENABLE ALWAYS` IS NOT OPTIONAL AND IS NOT DEFERRED. `CREATE TRIGGER`
--    always lands at the bypassable tgenabled='O', which one
--    `SET session_replication_role='replica'` turns off for the rest of the
--    session (006 reproduces it).
--
--    Every table here MUST also be declared in `src/db/appendOnlyTables.ts` in the
--    same change: `tests/integration/migrations.test.ts` asserts equality against
--    `pg_trigger` in BOTH directions, and `src/db/appRoleGrants.ts` refuses to
--    grant anything to a live table that neither declared list names.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vertical_pack',
    'vertical_pack_version',
    'data_source',
    'lcid_registry',
    'collectible_definition',
    'edition',
    'edition_signature',
    'edition_external_id'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;
