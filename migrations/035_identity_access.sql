-- 035_identity_access.sql — E03-D17 (bead longbox-e5b.3.27)
--
-- THE AUDITED ACCESSOR'S FACT. Docs: 000-docs/060 in full; 019 T35(b)
-- (*"`created_by`/`operator_id` selectable only inside one audited accessor
-- module"* — NON-WAIVABLE, and OPEN with no owner until this bead); 034 §3.3
-- (the `identity` accessor contract, verbatim); 048 §12.4 row 6 (the fourth
-- part), §3.5 (attribution of record, never non-repudiable); 054 §8 (the fifth
-- path — `authorization_decision`'s `membership_id` and `session_chain_id`);
-- 022 P3 (staff data serves learning and support, never covert measurement);
-- 041 §2.1 (a thing that happened is a row), §9.2 (declared triggers); 056 §7
-- (a table's tenancy is DECLARED); 000-docs/044 §2, §7 (expand-only, idempotent
-- by hand).
--
-- ⚠ **NUMBERED 035.** `034` is E03-D19's, landing on the same base; `027` has
-- been a gap since E03-B06 reserved and never wrote it. The runner's ledger keys
-- on FILENAME and applies unseen files in sorted order
-- (`scripts/migrationDiscipline.ts:planMigrations`), so a gap is legal and
-- self-healing; nothing in the runner, the lint or the checksum reads contiguity.
--
-- ============================================================================
-- WHAT THIS TABLE IS, IN ONE SENTENCE
-- ============================================================================
--
-- **A record that a person was looked up, and never a record of the person.**
--
-- 034 §3.3 requires that exactly one module may turn an `operator_id`, an
-- `app_user_id`, a `membership_id` or a `session_chain_id` into a NAME, and that
-- every such read *"writes an access-audit row before returning"*. This is that
-- row. The hard part is not the write; it is what the row may hold.
--
-- ============================================================================
-- THE SHAPE 022 P3 FORCES: NO SUBJECT, ONLY AN ACCESSOR
-- ============================================================================
--
-- The obvious design records WHO WAS LOOKED UP — an `app_user_id` column, so an
-- investigator can ask "who has been reading this person's record". That design
-- is REFUSED here, and the reason is 022 P3 read one level up:
--
--   > *"No individual-level telemetry view — for the employee, the owner or
--     Longbox — exists…"*
--
-- A table keyed on the person looked up is a per-person timeline of every time
-- their name was rendered — which is a per-operator surface built by the control
-- that exists to prevent per-operator surfaces. Worse, it would be the ONE
-- per-operator surface in the schema that grows on the hot path: every operator
-- session opened at a counter renders a display name, so the phone would be
-- writing a row about its holder on every sign-in, keyed by them.
--
-- So the row records the ACCESS and not the SUBJECT:
--
--   * **`purpose`** — why the accessor asked, from a CLOSED enum enforced here
--     by a CHECK. A fifth purpose is a migration and a decision, which is the
--     point: the vocabulary of reasons to resolve a person must not be
--     extensible by whoever writes the next INSERT (`032`'s argument for
--     `origin`, one table over).
--   * **`accessor_method` / `accessor_path`** — WHERE the read came from, in
--     `authorization_decision`'s exact idiom: the route TEMPLATE for an HTTP
--     request, the literal `CLI` plus the script path for an operator command.
--     Never a URL — a URL carries ids, and an id is a join back to the work.
--   * **`key_kind`** — the KIND of key that was resolved, never its value. That
--     an `operator_id` was resolved is what 019 T35(b) wants recorded; WHICH
--     `operator_id` is the thing T35 signs at zero.
--   * **`resolved_count`** — how many people the read produced. One for a
--     display name, N for a roster. A count is what makes a bulk read visible
--     without naming anybody in it.
--   * **`shop_id`** — the tenant the access happened IN, where there is one.
--
-- **What a reader loses, stated plainly.** This table cannot answer *"who read
-- this person's name, and when"*. It answers *"how often, from where, and for
-- what stated reason, did this system turn a key into a person"* — which is the
-- question 019 T35(b) actually asks, and it answers it without creating the
-- artifact 022 P3 forbids. The subject-keyed question belongs to a break-glass
-- READ path with its own 7-day notice to the employee (022 P3, E11-B09), and it
-- is not answerable from here by design. 000-docs/060 §5 argues it; §11 R6 records
-- it as a residual rather than as a feature.
--
-- ============================================================================
-- THREE MORE DECISIONS A READER WILL WANT ARGUED
-- ============================================================================
--
-- **(a) `shop_id` IS NULLABLE, AND THE NULL IS TIED TO ITS ONE REASON.** A
-- second factor is enrolled for a PERSON, who may hold memberships at more than
-- one shop (034 §2.6), so `pnpm enroll-authenticator` has no tenant to name. The
-- CHECK below ties the null to `accessor_method = 'CLI'` so it cannot quietly
-- become "a shop we failed to record" — `028`'s idiom for `session_chain_id`.
--
-- **AND THE NULL IS UNWRITABLE BY THE APPLICATION, WHICH IS THE PROPERTY, NOT A
-- SIDE EFFECT.** The table carries `shop_id`, so `src/db/rowLevelSecurity.ts`
-- policies it `tenant_isolation` — `shop_id = current_shop_id()` — with no
-- declaration needed and no service scope. A NULL row can therefore never
-- satisfy the WITH CHECK, so **every fact the running server writes names the
-- tenant it happened in**, and the unscoped rows are exactly the schema-owner
-- CLI's, written by the role that owns the table and bypasses the policy.
--
-- **(b) ONE INDEX, ON THE TENANT, AND NOT ONE MORE.** 054 §4.2 removed
-- `authorization_decision_chain_idx` because an index is a standing affordance
-- and a fast per-session query is the covert timeclock 022 P3 forbids. That
-- reasoning bites on a PERSON-adjacent column and not on this one: **a shop id
-- names a tenant, never a person**, so `identity_access_shop_idx` makes no
-- per-person question cheap and it keeps this table inside the blanket property
-- `tests/integration/rls-tenant-isolation.test.ts` asserts of EVERY policied
-- table — *"an index whose LEADING column is shop_id"*. A uniform invariant with
-- one table exempted is an invariant somebody has to remember; E03-B09's
-- retention sweep will be shop-scoped and will use it.
--
-- **What is refused is every OTHER index.** There is no index on `purpose`, none
-- on the accessor pair and none on `created_at`: the only reader is a scheduled
-- schema-owner audit that GROUPs the whole table, and a sequential scan is
-- correct for a query that runs on a schedule and wrong for one somebody runs
-- casually (054 §4.2's own sentence). The table grows without a sweep until
-- E03-B09 lands retention; 060 §10 says so rather than leaving it to be
-- discovered.
--
-- **(c) THE APPLICATION MAY INSERT AND MAY NOT SELECT.** `appGrant:
-- "insert-only"` in `src/db/appendOnlyTables.ts` — a FIFTH privilege class,
-- declared as a row. The application must be able to append (the accessor runs
-- in the request), and it must never be able to read: a process that could read
-- its own access log could shape what an audit sees before the audit runs, and
-- nothing in the running system has a reason to ask this table a question.
-- Reading it is the audit's job and the audit runs as the schema owner.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS identity_access (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- (a) above. Nullable ONLY for a CLI accessor, and the CHECK says so.
  shop_id         uuid REFERENCES shop(id),

  -- The CLOSED enum. Four members, each with a live caller; a purpose with no
  -- caller is an affordance nobody asked for, and 022 P3's CFO constraint —
  -- never build a per-operator surface and then restrict it — reads on a
  -- vocabulary too. `break_glass_reconciliation` is NOT here: E11-B09 adds it
  -- in the migration that gives break-glass its read path (000-docs/060 §3.3).
  purpose         text NOT NULL CHECK (purpose IN (
                    'session_display_name',
                    'operator_picker_roster',
                    'invitation_addressee',
                    'authenticator_enrollment')),

  -- `authorization_decision`'s pair, verbatim in intent: the route TEMPLATE, or
  -- `CLI` + the script path. Never a URL.
  accessor_method text NOT NULL CHECK (length(btrim(accessor_method)) > 0),
  accessor_path   text NOT NULL CHECK (length(btrim(accessor_path)) > 0),

  -- The KIND of key resolved, never the key. 034 §3.3 names THREE COLUMNS —
  -- `operator_id`, `created_by`, `confirmed_by`, with A5 putting the two legacy
  -- strings INSIDE the contract — and 054 §8 adds `membership_id` and
  -- `session_chain_id`. All of them are here, plus `app_user_id` (the ordinary
  -- key) and `shop_roster` (the bulk shape: a read keyed on a SHOP that produces
  -- people), so a future accessor cannot introduce another without a migration.
  --
  -- ⚠ `created_by` and `confirmed_by` HAVE NO CALLER AND ARE HERE ANYWAY (the
  -- gate audit's F7). Without them the first reader of a pre-G2 attribution
  -- string could not write its fact at all — this CHECK would refuse it — and
  -- the author's cheapest fix would be to skip the accessor, which is the exact
  -- hazard §3.3 argues against. E02-D10 retires both columns eventually; the
  -- kinds then become historical rather than wrong.
  key_kind        text NOT NULL CHECK (key_kind IN (
                    'app_user_id',
                    'operator_id',
                    'created_by',
                    'confirmed_by',
                    'membership_id',
                    'session_chain_id',
                    'shop_roster')),

  -- How many people the read produced. Zero is legal and meaningful: a lookup
  -- that resolved nobody is still an access that happened.
  resolved_count  integer NOT NULL CHECK (resolved_count >= 0),

  -- The COMMIT this process was built from (054 §4.2's K2, one table over).
  -- The declared accessor inventory and the purpose prose are CODE, and code is
  -- not a row; without this a past access is not reconstructible. `'unknown'`
  -- is a VALUE, not an absence.
  build_commit    text NOT NULL DEFAULT 'unknown',

  -- ⚠ **TRUNCATED TO THE HOUR, AND THE DEFAULT IS WHERE THAT IS ENFORCED** (the
  -- security lens's F5 = the gate audit's F8). §5.2 already says that "no
  -- subject is stored" is a claim about the SCHEMA and never "nobody can be
  -- identified" — and the lens applied that caveat where it bites: a per-day
  -- FIRST-SIGN-IN series over `(shop_id, purpose, created_at)` is a shift record
  -- at a three-person shop and a timeclock at a one-owner shop, which is the
  -- artifact 022 P3 forbids, assembled from a table that holds no person.
  --
  -- Truncating to the hour is the cheap half of the answer and it costs the
  -- instrument NOTHING: the audit's 24-hour window is a `>=` over whole hours,
  -- and every bucket it prints is a COUNT grouped by purpose and accessor. What
  -- it removes is the minute-level ordering that makes "when did the shift
  -- start" answerable to the precision a timeclock needs.
  --
  -- **It does not remove the class**, and no artifact may say it does: an hourly
  -- series at a one-owner shop still says which hours that owner worked. The
  -- expensive half is retention (E03-B09) and the honest half is the 022 P3
  -- notice describing THIS table (E01-B06); 060 §11 R7 carries both.
  created_at      timestamptz NOT NULL DEFAULT date_trunc('hour', now()),

  -- 041 §2.3's envelope. An access is authored by the SYSTEM: the row records a
  -- read the software performed on somebody's behalf, and attributing it to a
  -- human would be the subject-keyed shape (a) refuses, arriving by the back
  -- door.
  authored_by     text NOT NULL DEFAULT 'system'
                    CHECK (authored_by IN ('human','system','provider')),

  -- (a): the null has exactly one meaning.
  CONSTRAINT identity_access_unscoped_is_a_cli
    CHECK (shop_id IS NOT NULL OR accessor_method = 'CLI')
);

-- (b): the tenant index every policied table carries, and the only index here.
CREATE INDEX IF NOT EXISTS identity_access_shop_idx ON identity_access (shop_id);

COMMENT ON TABLE identity_access IS
  'E03-D17 / 019 T35(b): one row per read that resolved a key to a person. Records the ACCESS, never the subject (022 P3).';

-- ---------------------------------------------------------------------------
-- Append-only, and `ENABLE ALWAYS` in the same breath (041 §9.2 item 1, 044 §7).
-- `CREATE TRIGGER` always lands at the bypassable 'O' default and the gate-test
-- asserts 'A' for every declared trigger. The declared set is
-- `src/db/appendOnlyTables.ts`.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['identity_access'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;
