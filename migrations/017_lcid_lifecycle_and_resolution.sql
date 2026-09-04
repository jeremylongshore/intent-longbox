-- 017_lcid_lifecycle_and_resolution.sql — E04-D01 (bead longbox-e5b.4.13)
--
-- 047 v1.1.2 §5 (the lifecycle as appended facts), §6 (merges and the survivor
-- projection), §7 (splits), §9 (identity_resolution) and §10 (resolve as-of), as
-- DDL. Docs: 047 §5.1, §5.3, §5.4, §6.1, §6.2, §7.1, §7.2, §9.1, §10.2, I8, I10,
-- I11, I18; 030 §7.1; 041 §2.1–§2.3, §6.2, §9.2 item 4; 000-docs/044 §2, §7.
--
-- SHAPE: EXPAND ONLY. `CREATE … IF NOT EXISTS` / DROP-then-CREATE throughout, so
-- a hand re-run is a no-op. Every table here starts EMPTY and no row is
-- backfilled — a merge, a split or a retirement that nobody made must not be
-- manufactured, and under the append-only trigger it could never be corrected.
--
-- ⚠ THERE IS NO `status` COLUMN ANYWHERE IN THIS FILE (047 §5.1). The lifecycle
-- of an LCID is a DERIVATION over the facts below, exactly as 040 replaced
-- `scan_session.status` with a derivation over transitions. A status column on an
-- insert-only registry is a column that can never be set, and a status column on
-- an append-only table is a fact two rows can disagree about.
--
-- ⚠ THREE NARROW TABLES, NOT ONE `lcid_lifecycle_fact` WITH A `kind` COLUMN
-- (047 A5, affirmed by the cannon as A9). A merge needs a survivor FK, a split
-- needs an outcome child table, a retirement needs neither — so one table means
-- nullable columns whose meaning depends on `kind`, which is 030 A1's rejected
-- shape and the two-meanings-of-NULL hazard `004:43-48` records. The cost is
-- honest and is paid here: three declared-list entries, three triggers, and a
-- three-way disposition guard.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. `lcid_merge` (047 §6.1).
--
--    "A merge is one appended fact naming a losing LCID and a surviving LCID. It
--    deletes nothing, rewrites nothing, and repoints no reference."
--
--    `UNIQUE (losing_lcid)` is the merge's version of 041 R2 (a row is superseded
--    at most once): an LCID is merged away exactly once, so the merge graph is a
--    FOREST of pointers to a surviving root, never a tangle. A later merge that
--    moves the survivor adds a row for the SURVIVOR, and the chain from the
--    original follows through it.
--
--    WHICH SIDE SURVIVES IS NAMED IN THE FACT (047 §6.3(c)). Not the older LCID
--    — §3.2 deliberately removed the bytes that would make that easy, and in the
--    common case (a fortnightly import creating a near-duplicate of a row a human
--    authored last week) it is systematically backwards. And NOT the LCID with
--    more references — those are overwhelmingly shop-scoped `physical_item` rows,
--    so that rule would let the shop with the most copies decide the catalog's
--    canonical names: a tenancy leak in a table with no tenancy (019 T24,
--    non-waivable).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lcid_merge (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  losing_lcid       text NOT NULL REFERENCES lcid_registry(lcid),
  surviving_lcid    text NOT NULL REFERENCES lcid_registry(lcid),
  corpus_version_id uuid NOT NULL REFERENCES corpus_version(id),
  method            text NOT NULL,
  evidence          jsonb NOT NULL,
  decided_by        text NOT NULL,
  authored_by       text NOT NULL DEFAULT 'human' CHECK (authored_by IN ('human', 'system', 'provider')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lcid_merge_one_disposition UNIQUE (losing_lcid),
  -- 041 R3/R4's shape: the self-edge is refused by a CHECK; the longer cycle is
  -- refused by the trigger in §4.
  CONSTRAINT lcid_merge_not_self CHECK (losing_lcid <> surviving_lcid)
);

CREATE INDEX IF NOT EXISTS lcid_merge_surviving_idx ON lcid_merge (surviving_lcid);
CREATE INDEX IF NOT EXISTS lcid_merge_corpus_idx ON lcid_merge (corpus_version_id);

COMMENT ON COLUMN lcid_merge.decided_by IS
  '047 §6.3(c). The survivor is a decision somebody made and can be read back, argued '
  'with and superseded by a further merge. Where the decision is mechanical — an '
  'importer applying a documented rule — `method` names the rule and `decided_by` names '
  'the importer, which is 041 §2.3''s "cause and authorship are different facts". Per '
  '047 §6.3 only a deterministic exact-identifier agreement under a registrar-issued '
  'namespace may be automatic; a signature collision PROPOSES and a model never certifies.';

-- ---------------------------------------------------------------------------
-- 2. `lcid_split` and `lcid_split_outcome` (047 §7).
--
--    A SPLIT IS NOT THE MIRROR IMAGE OF A MERGE, and the asymmetry is the whole
--    design. A merge asserts that two names were always one thing, so no past
--    reference loses information. A split asserts that ONE NAME WAS ALWAYS TWO
--    THINGS, and every past reference to it is therefore AMBIGUOUS — not wrong,
--    ambiguous, and ambiguous in a way no later evidence can always resolve.
--
--    THE DEFAULT IS AMBIGUITY; CONTINUATION MUST BE EARNED (047 §7.2). The cheap
--    answer — the source continues as one product and one new LCID is minted for
--    the other — silently asserts that every pre-split reference meant the
--    continuation, which is usually false and always unrecorded. So the source is
--    DISPOSED OF, all products are freshly minted, and `resolve(source)` returns
--    SPLIT_AMBIGUOUS, which callers must handle rather than swallow (042 §8.3's
--    fail-closed-to-manual construction).
--
--    A split MAY mark exactly one outcome `is_continuation`, and doing so is a
--    claim with a burden: the evidence must support that every existing reference
--    belongs to it. The partial unique index below makes "exactly one" a database
--    fact; the burden itself is 047 I10's test, over data this file cannot see.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lcid_split (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_lcid       text NOT NULL REFERENCES lcid_registry(lcid),
  corpus_version_id uuid NOT NULL REFERENCES corpus_version(id),
  method            text NOT NULL,
  evidence          jsonb NOT NULL,
  decided_by        text NOT NULL,
  authored_by       text NOT NULL DEFAULT 'human' CHECK (authored_by IN ('human', 'system', 'provider')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lcid_split_one_disposition UNIQUE (source_lcid)
);

CREATE TABLE IF NOT EXISTS lcid_split_outcome (
  split_id        uuid NOT NULL REFERENCES lcid_split(id),
  product_lcid    text NOT NULL REFERENCES lcid_registry(lcid),
  is_continuation boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (split_id, product_lcid)
);

-- At most ONE earned continuation per split.
CREATE UNIQUE INDEX IF NOT EXISTS lcid_split_outcome_one_continuation_idx
  ON lcid_split_outcome (split_id) WHERE is_continuation;

-- ---------------------------------------------------------------------------
-- 3. `lcid_retirement` (047 §5.4).
--
--    A retirement says: THIS LCID NAMES NOTHING. A phantom edition — a bad import
--    row, a duplicate created by a normalization bug, an entry a later corpus
--    withdraws. It is NOT a merge (there is no survivor) and NOT a deletion (the
--    row stays, the string stays resolvable, every reference to it stays
--    readable).
--
--    AND IT DOES NOT REPAIR THE ROWS THAT CITE IT. They cite a name that names
--    nothing, which is a TRUE STATEMENT ABOUT A PAST ACT, and 041 §3.6's "never
--    edits, never hides" forbids improving it. What the retirement does is refuse
--    any NEW citation and put every citing row into the same review obligation a
--    split creates — E11-B08's queue, derived by query, with NO column added to
--    any citing table (047 §7.3: a mutable status on an immutable row is the
--    shape 030 A1 rejected).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lcid_retirement (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lcid              text NOT NULL REFERENCES lcid_registry(lcid),
  corpus_version_id uuid NOT NULL REFERENCES corpus_version(id),
  reason            text NOT NULL,
  method            text NOT NULL,
  evidence          jsonb NOT NULL,
  decided_by        text NOT NULL,
  authored_by       text NOT NULL DEFAULT 'human' CHECK (authored_by IN ('human', 'system', 'provider')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lcid_retirement_one_disposition UNIQUE (lcid)
);

-- ---------------------------------------------------------------------------
-- 4. THE DISPOSITION GUARD AND THE CYCLE REFUSAL (047 §5.1, §6.1, I8).
--
--    `MERGED_AWAY`, `SPLIT_SOURCE` and `RETIRED` are MUTUALLY EXCLUSIVE by
--    construction. Each table carries its own UNIQUE, which stops a second
--    disposition OF THE SAME KIND; this trigger is what stops a second
--    disposition of a DIFFERENT kind, which no single-table constraint can see.
--
--    ⚠ WHERE THE BOUNDED WALK RAISES, AND WHERE IT MUST NOT (047 A10). Hickey and
--    Kleppmann disagreed about I8 and the resolution was that they were talking
--    about two different call sites:
--
--      * AT WRITE TIME a chain that exceeds the bound, or a survivor reachable
--        from the loser, is a DEFECT IN THE FACT BEING PROPOSED. Refusing the
--        INSERT is the only handling that keeps the forest a forest. That is this
--        trigger, and it RAISES.
--      * AT READ TIME the same condition is a property of data that already
--        committed, and a resolver that throws turns a catalog anomaly into a 500
--        on a pricing lookup. So `resolve()` returns an OUTCOME VALUE and never
--        throws past its caller (`src/catalog/resolve.ts`), and chain depth is
--        MONITORED rather than enforced there.
--
--    The bound is a PROVISIONAL CIRCUIT-BREAKER FLOOR in 042 A3's sense —
--    explicitly non-evidentiary. It is not a measurement of anything and must
--    never be quoted as one. A real merge chain is expected to be one or two
--    hops; 64 is "long enough that hitting it means something is wrong".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lcid_max_chain_depth() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 64 $$;

CREATE OR REPLACE FUNCTION refuse_second_disposition() RETURNS trigger
LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION refuse_merge_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
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

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lcid_merge', 'lcid_split', 'lcid_retirement'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_one_disposition', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION refuse_second_disposition()',
      t || '_one_disposition', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_one_disposition');
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS lcid_merge_no_cycle ON lcid_merge;
CREATE TRIGGER lcid_merge_no_cycle
  BEFORE INSERT ON lcid_merge
  FOR EACH ROW EXECUTE FUNCTION refuse_merge_cycle();
ALTER TABLE lcid_merge ENABLE ALWAYS TRIGGER lcid_merge_no_cycle;

-- ---------------------------------------------------------------------------
-- 5. `lcid_current_survivor` — THE MATERIALIZED PROJECTION (047 A2, §6.2, I18).
--
--    `resolve` does NOT run a recursive CTE on the hot path. It reads this
--    projection, which is (i) written ONLY by the transaction that appends the
--    merge fact, and (ii) reproducible from `lcid_merge` alone by a checked-in
--    one-pass rebuild (`src/catalog/projection.ts`,
--    `scripts/rebuild-survivor-projection.ts`).
--
--    ⚠ IT IS A DERIVED READ MODEL, NOT A STATUS COLUMN, and the difference is the
--    whole of Hickey's dissent in 047 §14. A status column is a second place a
--    fact can live and DISAGREE from. A projection maintained inside the merge's
--    own transaction cannot disagree with the log for longer than a transaction,
--    and any disagreement is a TEST FAILURE, not a data state (I18). That is why
--    the maintenance is a transactional trigger and NOT a trigger-on-commit, a
--    queue, or a nightly job: an eventually-consistent survivor map is exactly
--    the "status column with extra steps and worse audit properties" the cannon
--    named.
--
--    KEYS ONLY (041 §6.2). Two columns. There is nothing here to preserve: drop
--    it and the rebuild reproduces it exactly, which is what makes it a
--    derivation rather than a fact. It is therefore DELIBERATELY MUTABLE and
--    carries an `APPEND_ONLY_EXEMPTIONS` row rather than a trigger — an exemption
--    is a decision a reviewer can argue with; an absence is indistinguishable
--    from an oversight.
--
--    ⚠ ONE INDEX, AND IT IS COVERING, ON PURPOSE. The hot read is
--    `SELECT survivor_lcid FROM lcid_current_survivor WHERE lcid = $1`, and 047
--    A2's second obligation is a CI gate asserting that plan is INDEX-ONLY. A
--    plain primary-key index does not carry `survivor_lcid`, so the planner would
--    choose an Index Scan with a heap fetch and the gate would fail — correctly.
--    So the table's uniqueness is enforced by a UNIQUE … INCLUDE index rather
--    than by a PRIMARY KEY, which leaves exactly one index for the planner to
--    choose and makes the index-only plan the only plan.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lcid_current_survivor (
  lcid          text NOT NULL REFERENCES lcid_registry(lcid),
  survivor_lcid text NOT NULL REFERENCES lcid_registry(lcid),
  CONSTRAINT lcid_current_survivor_not_self CHECK (lcid <> survivor_lcid)
);

CREATE UNIQUE INDEX IF NOT EXISTS lcid_current_survivor_covering_idx
  ON lcid_current_survivor (lcid) INCLUDE (survivor_lcid);

CREATE OR REPLACE FUNCTION maintain_lcid_current_survivor() RETURNS trigger
LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS lcid_merge_maintains_survivor ON lcid_merge;
CREATE TRIGGER lcid_merge_maintains_survivor
  AFTER INSERT ON lcid_merge
  FOR EACH ROW EXECUTE FUNCTION maintain_lcid_current_survivor();
ALTER TABLE lcid_merge ENABLE ALWAYS TRIGGER lcid_merge_maintains_survivor;

-- ---------------------------------------------------------------------------
-- 6. `identity_resolution` — 030 §7.1, UNCHANGED (047 §9.1).
--
--    TWO FACTS, NEVER ONE. `human_confirmation` records the edition the PERSON
--    PICKED — a person's act, made against what was on a screen at a moment,
--    immutable and complete on its own. `identity_resolution` records WHAT THE
--    CATALOG SAID THAT WAS, as of a corpus version, by a named method, revisable
--    by a later corpus making a different statement. Neither is derivable from the
--    other.
--
--    ⚠ AND THIS IS WHY THERE IS NO `confirmed_edition_lcid` COLUMN ON
--    `human_confirmation`. 030 A1 rejected exactly that, and
--    `004_human_confirmation_outcome.sql:43-48` records the reasoning: the NULL
--    would carry TWO meanings the reader cannot separate — "confirmed before the
--    catalog existed" and "confirmed after, but resolution failed or was skipped"
--    — and the row cannot be updated to repair it. A row's ABSENCE from this
--    table carries no meaning at all: "was this confirmation ever resolved, and
--    how" is answered by a join returning zero rows or one. 047 I11 asserts by
--    static scan that no such column is ever added.
--
--    THE ONE SHOP-SCOPED TABLE IN THIS CLUSTER. It is WORKFLOW-owned, not catalog
--    (030 §2.6): it is a statement about one shop's `human_confirmation`, and
--    `catalog` must stay readable by a batch importer with no pipeline present.
--    029 §9's owned-tables list takes an amend-by-a-row for it —
--    `longbox-e5b.4.14` (E04-D02) carries that.
--
--    IT SHIPS EMPTY. No migration populates it, and this file writes no rows.
--    Whether pre-catalog confirmations are ever resolved, and at what bar, is
--    E06's (030 §12); it is not authorized here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identity_resolution (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL REFERENCES shop(id),
  human_confirmation_id uuid NOT NULL REFERENCES human_confirmation(id),
  edition_lcid          text NOT NULL REFERENCES lcid_registry(lcid),
  corpus_version_id     uuid NOT NULL REFERENCES corpus_version(id),
  method                text NOT NULL CHECK (method IN ('live', 'barcode', 'signature', 'human', 'canonical_edition')),
  -- NULL for deterministic rungs; NEVER numeric-graded (022 P1, 019 T7,
  -- locked decision 5). `text` is the type, and 047 I14 asserts it stays that way.
  confidence            text,
  resolved_by           text NOT NULL,
  authored_by           text NOT NULL DEFAULT 'system' CHECK (authored_by IN ('human', 'system', 'provider')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- 030 §7.1: a confirmation is resolved AT MOST ONCE PER CORPUS VERSION. A later
  -- corpus may resolve the same confirmation differently, and both statements are
  -- true as of their corpus.
  CONSTRAINT identity_resolution_once_per_corpus UNIQUE (human_confirmation_id, corpus_version_id)
);

CREATE INDEX IF NOT EXISTS identity_resolution_edition_idx ON identity_resolution (edition_lcid);
CREATE INDEX IF NOT EXISTS identity_resolution_shop_idx ON identity_resolution (shop_id);

-- ---------------------------------------------------------------------------
-- 7. Append-only triggers — same idempotent DROP-then-CREATE + ENABLE ALWAYS.
--
--    `lcid_current_survivor` is NOT in this loop: it is the derived read model of
--    §5 and is deliberately mutable, declared in `APPEND_ONLY_EXEMPTIONS` with the
--    reason. Every other table in this file is a FACT and is immutable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'lcid_merge',
    'lcid_split',
    'lcid_split_outcome',
    'lcid_retirement',
    'identity_resolution'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;
