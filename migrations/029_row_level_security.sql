-- 029_row_level_security.sql — E03-B04 (bead longbox-e5b.3.4)
--
-- THE TENANT BOUNDARY, MOVED INTO POSTGRES. Docs: 034 §3.2 (three layers, and
-- this is the third), §3.4 (what a cross-tenant read looks like as a K1);
-- 019 T24 (tenant isolation, NON-WAIVABLE, any occurrence is K1); 041 §9.2 item 2
-- and E02-D06 (two roles: `longbox_migrate` owns the schema, `longbox_app` owns
-- nothing); 042 §5.3(b) (the lock order this does NOT join); 046 E8, G-3, K-5;
-- 048 §6.1 (`shop_id` comes from the session, never from a body or a URL);
-- 000-docs/044 §2, §7 (expand-only, idempotent by hand); 056 (the decision).
--
-- 034 §1 E10 recorded the hole this closes, in the tree, by grep: *"There is no
-- row-level security. `shop_id` is therefore a convention enforced by every
-- hand-written `WHERE`, not a boundary."* 046 E8 re-reproduced it three weeks
-- later and added the part that made it actionable — the request transaction the
-- context needs is not merely available, it is already load-bearing under every
-- mutating request (`src/services/idempotency.ts`).
--
-- ⚠ **NUMBERED 029 ON TOP OF 028.** The runner's ledger keys on FILENAME and
-- applies unseen files in sorted order, so gaps and out-of-order arrivals are
-- legal and self-healing (`scripts/migrationDiscipline.ts`). Nothing in the
-- runner, the lint or the checksum reads contiguity.
--
-- ============================================================================
-- WHAT THIS FILE DOES, IN THE ORDER IT DOES IT
-- ============================================================================
--
--   1. two STABLE functions that read the transaction-local context;
--   2. the index every policy predicate wants, on the sixteen shop-scoped tables
--      that did not have one with `shop_id` in the leading position;
--   3. `ENABLE ROW LEVEL SECURITY` + a `tenant_isolation` policy on EVERY table
--      that carries a `shop_id` column — enumerated from the catalog rather than
--      from a list, so this file cannot disagree with the schema it runs against;
--   4. NOTHING — the second and third policies (the scope-scoped read, and the
--      INSERT-only write on three tables) are emitted from the ONE declaration
--      in `src/db/rowLevelSecurity.ts`, for the reason §4 gives;
--   5. `security_invoker` on every view, which is the half of this that is easy
--      to miss and would have voided the rest.
--
-- ============================================================================
-- FIVE DECISIONS A READER WILL WANT ARGUED, NOT ASSUMED
-- ============================================================================
--
-- **(a) `ENABLE`, NOT `FORCE`. The schema owner bypasses, deliberately.**
-- PostgreSQL exempts a table's OWNER from its own policies unless `FORCE ROW
-- LEVEL SECURITY` is set. `longbox_migrate` owns every table here (E02-D06), and
-- every migration data statement, every CLI (`pnpm register-shop`,
-- `pnpm issue-invitation`, …), every schema fixture and most of the integration
-- lane runs as that role with no session and therefore no tenant. Under `FORCE`
-- each of those would be filtered to nothing or refused by the `WITH CHECK` —
-- so `FORCE` would not make the boundary stronger, it would make the schema
-- owner's tooling unusable and buy back the difference with a `BYPASSRLS` role
-- attribute that only a superuser can grant. **The boundary this bead is about
-- is the APPLICATION role**, which owns nothing, is not a superuser, has no
-- `BYPASSRLS`, and is therefore subject to every policy below. That the
-- application can never BE the owner is already structural rather than assumed:
-- `src/services/roleSeparation.ts` refuses to boot the server on a connection
-- whose role owns an append-only table or is a superuser.
--
-- **(b) The context is transaction-local, and that is the point.**
-- `current_setting('longbox.shop_id', true)` is read from a value set by
-- `set_config(…, is_local => true)` in the same round trip as `BEGIN`
-- (`src/db/tenantContext.ts`). It reverts at COMMIT or ROLLBACK, so a pooled
-- connection carries nothing to the next borrower — 034 §3.2's rule
-- (*"never sticky connection state, because the pool is shared and a leaked
-- `SET` outlives the request"*) and 046 K-5's named failure mode.
--
-- **(c) An unset context sees NOTHING. There is no fail-open branch.**
-- `current_shop_id()` returns NULL when the setting is absent or empty, and
-- `shop_id = NULL` is NULL, which a policy treats as "no". A code path that
-- forgets its context therefore returns zero rows and refuses its inserts —
-- loudly wrong rather than quietly complete. That is the whole reason no policy
-- below contains `OR current_shop_id() IS NULL`.
--
-- **(d) What this defends against, and what it does not.**
-- The application role can set `longbox.shop_id` to any value it likes; nothing
-- in Postgres stops a compromised process from declaring itself another shop.
-- This layer defends against a FORGOTTEN PREDICATE — a handler missing its
-- `AND shop_id = $1`, a report that joins one table too many, a generated query —
-- which is exactly the failure 034 §3.4 assigns it: *"the contract fails to a
-- code review, the runtime assertion fails to a bug, and RLS fails to a database
-- misconfiguration."* The value fed to the context comes from the authenticated
-- session (048 §6.1); that is the layer above and it is E03-B02/B03's.
--
-- **(e) It takes no lock, so it is not a fifth position in 042 §5.3(b)'s order.**
-- `set_config` reads nothing, writes no row and blocks on nothing. It PRECEDES
-- the `request_idempotency` INSERT by construction, because it travels with
-- `BEGIN` and there is no way to express it later.

-- ============================================================================
-- 1. THE TWO FUNCTIONS THE POLICIES READ
-- ============================================================================

-- The tenant, or NULL. `STABLE` rather than `IMMUTABLE`: the value is fixed for
-- the duration of one statement but is not a constant across transactions, which
-- is precisely what `STABLE` means and what lets the planner evaluate it once per
-- query and use an index on `shop_id`.
--
-- `nullif(…, '')` collapses the two shapes of absence — never set, and set to the
-- empty string by a context being cleared — into one NULL, so a policy has one
-- case to reason about rather than two.
CREATE OR REPLACE FUNCTION current_shop_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('longbox.shop_id', true), '')::uuid
$$;

COMMENT ON FUNCTION current_shop_id() IS
  'E03-B04: the transaction-local tenant, or NULL. Set by src/db/tenantContext.ts '
  'in the same round trip as BEGIN; reverts at COMMIT. NULL matches no row.';

-- TRUE only inside a transaction that declared one of the closed set of scopes in
-- `src/db/tenantContext.ts`. Deliberately a boolean and not the scope name: a
-- policy that switched on WHICH scope was set would be a second authorization
-- system living in SQL, and the thing that keeps this narrow is not the policy
-- text, it is that `pnpm arch` holds the number of call sites at an exact count.
-- THE SCOPE, BY NAME — and the reason it is a name rather than a boolean is the
-- security lens's F1, reproduced against a live cluster. With a scope-agnostic
-- `longbox_service()` in a `FOR ALL` policy, EVERY scope was a cross-tenant read
-- AND write grant on EVERY service-scoped table: inside `my-shops`, which exists
-- to answer one read, the application role inserted an owner membership at
-- another shop. A policy that names the scopes it serves is not "a second
-- authorization system in SQL" (this file's own first objection, answered in
-- 000-docs/056 §13) — it is the closed union `src/db/tenantContext.ts` already
-- holds, written where the enforcement is.
CREATE OR REPLACE FUNCTION longbox_service_scope() RETURNS text
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('longbox.service', true), '')
$$;

COMMENT ON FUNCTION longbox_service_scope() IS
  'E03-B04: the declared cross-tenant scope this transaction runs in, or NULL. '
  'Policies compare it against the scopes a table names; see src/db/tenantContext.ts.';

CREATE OR REPLACE FUNCTION longbox_service() RETURNS boolean
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
AS $$
  SELECT longbox_service_scope() IS NOT NULL
$$;

COMMENT ON FUNCTION longbox_service() IS
  'E03-B04: TRUE inside ANY declared cross-tenant scope. Kept as a readable '
  'predicate for humans and for the boot assertion; no POLICY uses it, because a '
  'policy must name the scopes it serves (F1).';

-- ============================================================================
-- 2. THE INDEX EVERY POLICY PREDICATE WANTS
-- ============================================================================
--
-- A policy adds `shop_id = current_shop_id()` to every statement against these
-- tables. Where a query already carries a more selective predicate (a session id,
-- a token digest) the planner uses that index and applies the tenant as a cheap
-- filter — but the tables below had NO index with `shop_id` in the leading
-- position, so a shop-wide read (a batch listing, the daily cross-tenant audit
-- query 019 T24 requires, the 500-shop synthetic load of 019 §5's G5 row) would
-- be a sequential scan over every tenant's rows. `IF NOT EXISTS` on every one:
-- expand-only, idempotent by hand (044 §7).
CREATE INDEX IF NOT EXISTS app_session_shop_idx ON app_session (shop_id);
CREATE INDEX IF NOT EXISTS app_session_revocation_shop_idx ON app_session_revocation (shop_id);
CREATE INDEX IF NOT EXISTS auth_attempt_shop_idx ON auth_attempt (shop_id);
CREATE INDEX IF NOT EXISTS candidate_set_shop_idx ON candidate_set (shop_id);
CREATE INDEX IF NOT EXISTS condition_assessment_shop_idx ON condition_assessment (shop_id);
CREATE INDEX IF NOT EXISTS connector_install_state_use_shop_idx ON connector_install_state_use (shop_id);
CREATE INDEX IF NOT EXISTS connector_token_retirement_shop_idx ON connector_token_retirement (shop_id);
CREATE INDEX IF NOT EXISTS device_credential_shop_idx ON device_credential (shop_id);
CREATE INDEX IF NOT EXISTS device_credential_revocation_shop_idx ON device_credential_revocation (shop_id);
CREATE INDEX IF NOT EXISTS device_enrollment_code_use_shop_idx ON device_enrollment_code_use (shop_id);
CREATE INDEX IF NOT EXISTS invitation_use_shop_idx ON invitation_use (shop_id);
CREATE INDEX IF NOT EXISTS llm_rerank_shop_idx ON llm_rerank (shop_id);
CREATE INDEX IF NOT EXISTS membership_revocation_shop_idx ON membership_revocation (shop_id);
CREATE INDEX IF NOT EXISTS operator_pin_shop_idx ON operator_pin (shop_id);
CREATE INDEX IF NOT EXISTS operator_pin_retirement_shop_idx ON operator_pin_retirement (shop_id);
CREATE INDEX IF NOT EXISTS pricing_snapshot_shop_idx ON pricing_snapshot (shop_id);
CREATE INDEX IF NOT EXISTS scan_photo_shop_idx ON scan_photo (shop_id);
CREATE INDEX IF NOT EXISTS shopify_draft_shop_idx ON shopify_draft (shop_id);

-- ============================================================================
-- 3. THE POLICY, ON EVERY TABLE THAT CARRIES A TENANT
-- ============================================================================
--
-- ENUMERATED FROM THE CATALOG, NOT FROM A LIST. A hand-kept list here would be a
-- fourth copy of the schema (the failure `src/db/appendOnlyTables.ts` was written
-- to end) and it would be wrong the first time a table was added in a branch that
-- landed after this one. The loop asks the same question the contract test asks —
-- *does this table have a `shop_id` column?* — so the two cannot disagree.
--
-- ONE `FOR ALL` POLICY RATHER THAN FOUR. `USING` governs which rows a statement
-- may see, update or delete; `WITH CHECK` governs which rows it may write. The
-- same predicate is right for both, and splitting it into `FOR SELECT` / `FOR
-- INSERT` / … would produce four rows per table that must be kept identical. On
-- an append-only table the UPDATE and DELETE halves are unreachable anyway — the
-- `ENABLE ALWAYS` trigger refuses them and the app role is not granted them
-- (041 §9.2 item 1) — so this is defence in depth over a door already welded shut.
--
-- `DROP POLICY IF EXISTS` first, for `003`'s DROP-then-CREATE reason: the file has
-- to be re-runnable by hand (044 §7), and `CREATE POLICY` has no `IF NOT EXISTS`.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'shop_id' AND NOT a.attisdropped
           )
     ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t.name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id())',
      t.name
    );
  END LOOP;
END
$$;

-- ============================================================================
-- 4. THE SECOND POLICY — DECLARED IN TYPESCRIPT, NOT HERE
-- ============================================================================
--
-- ⚠ **THIS FILE DELIBERATELY CARRIES NO LIST OF SERVICE-SCOPED TABLES, AND THE
-- REASON IS A DEFECT IT USED TO HAVE.** The first version hardcoded an array of
-- ten table names here, `src/db/rowLevelSecurity.ts` declared fourteen, and the
-- runner applied seventeen. Both lenses caught it (security F4; consistency K6,
-- its one blocking finding) and the consistency lens named the failure exactly:
-- the only thing keeping that drift from being an outage was that `pnpm migrate`
-- happens to run the SQL and the re-derived plan together — which a
-- disaster-recovery script, a future runner refactor, or a hand-run of this file
-- (a re-runnability 000-docs/044 §7 explicitly wants) would not honour. Under the
-- old arrangement a hand-applied `029` left `membership_revocation` unscoped, and
-- 056 §6.1's fail-open `my-shops` came back.
--
-- So the second policy — and the third, the INSERT-only one — are emitted ONLY by
-- `applyRowLevelSecurity`, from ONE declaration:
--
--     src/db/rowLevelSecurity.ts  →  SERVICE_TABLES
--         { table, readScopes[], write?: { scopes[], check }, reason }
--
-- which `pnpm migrate` and `pnpm grant-app-role` both apply, which
-- `tests/integration/rls-tenant-isolation.test.ts` asserts against the live
-- catalog in both directions, and which a contract test forbids any migration
-- file from restating.
--
-- What a reader wants to know without leaving this file:
--
--   * `service_context` is `FOR SELECT` only, over
--     `longbox_service_scope() = ANY (ARRAY[…])` — the scopes THAT table declares,
--     never a scope-agnostic boolean (F1);
--   * `service_write` exists on three tables only — `auth_attempt`,
--     `connector_token_retirement`, `connector_webhook_receipt` — is `FOR INSERT`
--     only, and its check is the scope list AND a condition about the row (a NULL
--     `shop_id`, a cited webhook receipt, a topic). Every other write to a
--     service-scoped table happens under an ordinary tenant context;
--   * both are DROPped on every table on every run, so removing a table from the
--     declaration takes its policies away rather than leaving them behind.

-- ============================================================================
-- 5. `security_invoker` ON EVERY VIEW — THE HALF THAT WOULD HAVE VOIDED THE REST
-- ============================================================================
--
-- ⚠ **A VIEW IS A HOLE IN ROW-LEVEL SECURITY UNLESS IT IS TOLD NOT TO BE.** By
-- default a view's underlying tables are read as the VIEW'S OWNER, and the
-- policies that apply are the view owner's. Every view here is owned by
-- `longbox_migrate` — the schema owner, which decision (a) above exempts from
-- these policies — so `SELECT * FROM condition_assessment_current` from the
-- application role would have returned EVERY SHOP'S rows while the base table it
-- reads returned only one shop's. The four views are all `*_current` read models
-- and `outbox_dead_letter`, i.e. exactly the shapes a report reaches for.
--
-- `security_invoker = true` (PostgreSQL 15+) makes the underlying access run as
-- the CALLER, so the caller's policies and the caller's context apply. Set on
-- every view in the schema by the same catalog enumeration used above, because
-- "every view" is the rule and a list would be the next thing to drift.
-- `tests/contract/architecture-gate.test.ts`'s companion in the integration lane
-- asserts it in both directions.
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v'
     ORDER BY 1
  LOOP
    EXECUTE format('ALTER VIEW %I SET (security_invoker = true)', v.name);
  END LOOP;
END
$$;
