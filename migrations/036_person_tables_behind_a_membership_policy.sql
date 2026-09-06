-- 036_person_tables_behind_a_membership_policy.sql — E03-D21 (bead longbox-e5b.3.31)
--
-- THE PERSON GOES BEHIND THE DATABASE. Docs: 000-docs/062 (the decision);
-- 056 §7 (the exemption classes, and the `app_user` row this file retires),
-- §11 R9 (the residual it discharges), §5 (the scopes), §6.1 (a guard expressed
-- as an absence fails OPEN); 060 §3 and §11 R5 (the identity accessor, which is
-- the code-level door this policy now sits UNDER); 048 §6 and §7 (the four reads
-- and the one write that reach a person); 054 §3 (who may invite);
-- 034 §2.5, §2.6 (a person is a PARTY and may work at more than one shop);
-- 022 P3; 019 T24, T35(b); 000-docs/044 §2 A1 (the deploy-unit header below).
--
-- ⚠ **NUMBERED 036 ON TOP OF 035.** The runner's ledger keys on FILENAME and
-- applies unseen files in sorted order, so gaps and out-of-order arrivals are
-- legal and self-healing (`scripts/migrationDiscipline.ts`). `027` is still the
-- only gap: reserved by E03-B06 and never written.
--
-- ============================================================================
-- WHAT 056 SAID, AND WHY IT IS NO LONGER THE ANSWER
-- ============================================================================
--
-- 056 §7 left `app_user` outside the boundary, and its reason was NOT the one it
-- first gave. v1.0.0 argued that a membership-keyed policy would encode *a person
-- belongs to one shop*; the invariant review rejected that, correctly — §7 uses
-- exactly the parent-EXISTS shape for `retention_hold_release`, and a policy can
-- perfectly well say *visible at any shop where this person holds a grant*. The
-- ground it fell back on was narrower and real:
--
--   > *"the grant and the read happen in the SAME transaction. `grantInvitation`
--     writes the membership and then reads the person; a newcomer being invited
--     holds no grant anywhere yet. A membership-EXISTS policy would refuse the
--     person during the act of admitting them, and a policy that has to be worked
--     around at the one moment it applies is not a boundary."*
--
-- Both halves of that sentence turn out to be answerable, and they answer
-- DIFFERENTLY — which is the whole content of 000-docs/062:
--
--   * **Redemption is already in the right order.** `grantInvitation` INSERTs the
--     membership and `resolvePersonByKey` reads the person AFTERWARDS, in the same
--     transaction, so the row the policy looks for is already there when it looks.
--     Nothing had to move. The sentence above described a hazard that the code it
--     was written about does not have.
--   * **ISSUANCE is the one that genuinely has no grant to point at.** An
--     invitation NAMES its person before any code is minted (048 §7.1), so
--     `upsertPerson` runs for somebody who may hold nothing anywhere. That is the
--     admission problem, and it is answered by a DECLARED SCOPE rather than by a
--     hole: `person-admission` (`src/db/tenantContext.ts`), which may SELECT a
--     person and may INSERT an ACTIVE one, and may do nothing else to the table.
--
-- ============================================================================
-- THE PREDICATE, AND THE THREE THINGS IT IS NOT
-- ============================================================================
--
--   EXISTS (SELECT 1 FROM membership m
--            WHERE m.app_user_id = app_user.id
--              AND m.shop_id = current_shop_id()
--              AND <the liveness triple>)
--
-- **It is not `shop_id = current_shop_id()`, because there is no such column and
-- there must not be.** 034 §2.6 makes a person able to work at two shops; a
-- tenant column here would make that two people with two passwords. The tenant is
-- one join away, and the join is the policy.
--
-- **The liveness triple is not written out here at all**: it is
-- `membership_is_live(m)`, the function §1 creates, which every membership
-- reader in `src/` also calls. Not *the same text as* the application's — THE
-- SAME DEFINITION, so a policy cannot admit somebody the application excludes.
--
-- **`membership_revocation` is inside the NOT EXISTS and it is policied**, which
-- is 056 §6.1's trap read one table over: a guard expressed as an ABSENCE over a
-- table the caller cannot see passes, so a revoked grant would keep answering.
-- Under an ordinary tenant context both tables carry `shop_id = current_shop_id()`
-- and both are visible, which is what makes the revocation half real. There is a
-- lane case for exactly this: a revoked membership hides the person from that
-- shop thereafter, and leaves them visible at the shop they still work at.
--
-- ============================================================================
-- WHAT THIS FILE WRITES, AND WHAT THE RUNNER WRITES
-- ============================================================================
--
-- This file writes the BELT: `ENABLE ROW LEVEL SECURITY` and the
-- `tenant_isolation` policy, in the file where they can be read a year from now.
-- The BRACES are `src/db/rowLevelSecurity.ts`, re-derived and re-applied at the
-- end of every `pnpm migrate` run — and it is the braces, not this file, that
-- emit `app_user`'s `service_context` and `service_write` policies, because
-- 056 §4 and `tests/contract/service-scope-declaration.test.ts` forbid a
-- migration from naming a scope in a statement. That rule exists because a
-- hardcoded list in `029` had already drifted from the module's.
--
-- ⚠ **SO A HAND-APPLIED `036` WITHOUT THE RUNNER IS AN INCOMPLETE STATE, AND IT
-- FAILS CLOSED.** With the tenant policy on and no service policies, the sign-in
-- lookup and the invitation's person write see NOTHING and are REFUSED — an
-- outage, loudly, and not a silent widening. That is the direction 029 (a) and
-- 000-docs/044 §4 A1 both choose deliberately: run `pnpm migrate`, which applies
-- this file and then re-derives the whole plan.
--
-- ============================================================================
-- THE OTHER PERSON-SCOPED TABLES: EACH DECIDED, NONE INHERITED
-- ============================================================================
--
-- 056 §7's *the person* class held seven more tables whose reason was, in
-- substance, *same as `app_user`*. That reason cannot survive `app_user` moving,
-- so each is re-decided in 000-docs/062 §4 and each keeps its exemption on its own
-- ground, restated in `src/db/rowLevelSecurity.ts`:
--
--   * `user_credential`, `recovery_code`, `recovery_code_use` — they hold no
--     attribute of a person, only argon2id digests over a value peppered with a
--     secret this database does not hold; and every application-role path to them
--     is INSIDE the `second-factor` scope, where a tenant predicate is vacuous by
--     construction. A policy there would be in force on no path the running server
--     takes, which is decoration on a boundary and worse than a declared absence.
--   * `user_authenticator` — the same, plus one that is specific to it and
--     decisive: 048 R19 makes `UPDATE … WHERE last_used_step < $2` consume a TOTP
--     step exactly once, and THE AFFECTED-ROW COUNT IS THE AUTHORIZATION. A policy
--     over that statement converts a misconfiguration into a zero-row UPDATE,
--     which this system reads as *this code was already used* — a refusal
--     indistinguishable from a replay. A row filter does not belong over a
--     statement whose row count is a verdict.
--   * `user_authenticator_retirement` — the ending fact for the row above.
--   * `app_user_origin`, `app_user_origin_retirement` — 058 §3(c): the app role
--     holds NO privilege on either (`appGrant: "none"`), and 019 T35(c) needs the
--     origin predicate to answer the SAME for a person at every shop, including a
--     shop they hold nothing at. A tenant-keyed policy would hide precisely the
--     row the reconciliation exists to find.
--
-- 000-docs/062 §4 is the table; this comment is the summary a reader standing in
-- `migrations/` needs.

-- contract: deploy unit migrations/036 + src/db/rowLevelSecurity.ts (app_user's TENANT_PREDICATES row and its SERVICE_TABLES row) + src/db/tenantContext.ts (the person-admission scope) + src/db/{appendOnlyTables,appRoleGrants}.ts (app_user's read-append class, which is what makes the no-UPDATE claim true) + src/services/roleSeparation.ts (the single depth-token policy comparison and the exempt-table branch) + src/services/auth/{people,api,invitations}.ts (the rank gate before the admission transaction) ship and roll back TOGETHER, code FIRST then policies (000-docs/044 §4 A1) — rolling the policy back alone leaves a boundary the code no longer expects, and rolling the code back alone leaves an admission scope nothing enters and an invitation route that cannot name a person who already works elsewhere; 006 row: 2026-09-06 E03-D21 — app_user moves from an RLS exemption to a membership-EXISTS tenant policy with a person-admission service scope; 056 §11 R9 discharged FOR app_user (the five credential tables keep their exemption on new grounds), 060 §11 R5 discharged in full

-- ============================================================================
-- 1. ONE DEFINITION OF *WORKS HERE*
-- ============================================================================
--
-- ⚠ **THE LIVENESS TRIPLE WAS WRITTEN OUT BY HAND IN FIVE PLACES AND THIS FILE
-- WOULD HAVE MADE IT SIX** (the consistency lens's K2 on 000-docs/062). Four
-- copies live in `src/services/auth/memberships.ts` and one in
-- `src/identity/accessors.ts`; the policy below needs the same predicate, and a
-- policy that admitted a person the membership reader excludes would be a SECOND
-- DEFINITION of *works here* — the two would drift the first time either was
-- corrected, and the drift would be a boundary disagreeing with the code that
-- believes it.
--
-- So the predicate becomes a FUNCTION, and every reader calls it. `STABLE` and
-- not `IMMUTABLE` because it reads `now()`; `PARALLEL SAFE` for the same reason
-- `current_shop_id()` is. It takes the whole ROW rather than a set of columns so
-- a caller cannot pass three of the four by accident.
--
-- **What it costs was REPRODUCED rather than predicted, and the first prediction
-- was wrong** (the invariant review of `518b076`). The guess was that the two
-- equality quals would drive `membership_user_shop_idx`. What the planner
-- actually does is better: it turns the correlated `EXISTS` into a **hashed
-- SubPlan** — the set of people who work at `current_shop_id()` is built ONCE PER
-- QUERY, through a **Bitmap Index Scan on `membership_shop_idx`** (the
-- single-column index `019` created), and every candidate row is then a hash
-- probe. `membership_is_live(m.*)` is a filter inside that one scan, so it is
-- evaluated once per membership at this shop and never once per person in the
-- estate.
--
-- Two consequences worth writing down. **(a)** The index that serves this is
-- `membership_shop_idx`, not the composite one — both were created by `019` with
-- the table, so this file still builds nothing and still owes no `-- index lock:`
-- header (000-docs/044 §9), but the honest sentence names the right index.
-- **(b)** 056 I8's property — *the policy folds into a one-time filter* — holds
-- here in its strongest form, and the lane asserts it POSITIVELY against a
-- database holding hundreds of memberships across dozens of shops: the plan must
-- show `hashed SubPlan` over `membership_shop_idx` and no sequential scan of
-- `membership`, rather than merely lacking a seq scan on an empty table.
CREATE OR REPLACE FUNCTION membership_is_live(m membership) RETURNS boolean
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
AS $$
  SELECT m.effective_from <= now()
     AND (m.effective_until IS NULL OR m.effective_until > now())
     AND NOT EXISTS (SELECT 1 FROM membership_revocation r WHERE r.membership_id = m.id)
$$;

COMMENT ON FUNCTION membership_is_live(membership) IS
  'E03-D21 (000-docs/062): the ONE definition of a live grant — started, not '
  'ended, and named by no revocation. Called by app_user''s tenant policy and by '
  'every membership reader in src/, so a policy cannot admit somebody the '
  'application excludes.';

-- ============================================================================
-- 2. THE BOUNDARY
-- ============================================================================
--
-- `DROP POLICY IF EXISTS` before `CREATE POLICY`, for `029`'s reason: the file has
-- to be re-runnable by hand (044 §7) and `CREATE POLICY` has no `IF NOT EXISTS`.
-- `ENABLE` and not `FORCE`, for 056 §4's reason: the schema owner bypasses, which
-- is what keeps `pnpm register-shop`, `pnpm issue-invitation` and every fixture
-- working.
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON app_user;

--
-- ⚠ **THE PARENTHESES AROUND EACH CONJUNCT ARE DELIBERATE.** Postgres stores a
-- parse tree, not this text, and re-renders it FULLY PARENTHESISED when
-- `pg_policies` is read — and the boot assertion compares that rendering against
-- `src/db/rowLevelSecurity.ts`'s declaration by DEPTH-ANNOTATED TOKENS, because a
-- comparison that erases parentheses erases operator precedence (E03-D21). So the
-- declaration is written in the deparser's shape, and this file is written to
-- match it. Nothing here depends on the shape for CORRECTNESS — the tree is the
-- same either way — but a reader who reformats it will find the two halves
-- disagreeing, which is the failure the shape exists to make loud.
CREATE POLICY tenant_isolation ON app_user FOR ALL
  USING (
    (EXISTS (
      SELECT 1 FROM membership m
       WHERE ((m.app_user_id = app_user.id)
         AND (m.shop_id = current_shop_id())
         AND membership_is_live(m))
    ))
  )
  WITH CHECK (
    (EXISTS (
      SELECT 1 FROM membership m
       WHERE ((m.app_user_id = app_user.id)
         AND (m.shop_id = current_shop_id())
         AND membership_is_live(m))
    ))
  );

-- ============================================================================
-- 3. NO INDEX IS BUILT HERE, AND THAT IS CHECKED RATHER THAN ASSUMED
-- ============================================================================
--
-- The predicate's subquery is served by `membership_shop_idx` — REPRODUCED, not
-- assumed: the planner hashes the EXISTS once per query and reaches that
-- single-column index rather than the composite one (§1). Both were created by
-- `019` when the table was created, so there is no lock to take from anybody and
-- no `-- index lock:` header is owed (000-docs/044 §9). `pnpm migrate --dry-run`
-- is the evidence: this file appears in no index-build warning.
--
-- 056 I8 (*every policied table has an index whose leading column is `shop_id`*)
-- is scoped by its own query to tables that HAVE a `shop_id` column, so it neither
-- covers this table nor is weakened by it. What replaces it here is a POSITIVE
-- plan assertion in the lane, on a scaled fixture: the policy's EXISTS is a
-- hashed SubPlan over `membership_shop_idx`, evaluated once per query, and
-- `membership` is never sequentially scanned.

COMMENT ON POLICY tenant_isolation ON app_user IS
  'E03-D21 (000-docs/062): a person is visible to a shop that holds a LIVE grant '
  'for them. The tenant is one join away because a person may work at more than '
  'one shop (034 2.6); the liveness triple is memberships.ts''s, character for '
  'character, because it IS the function every membership reader calls. Admission '
  '— an invitation naming somebody who works nowhere yet — '
  'is a declared cross-tenant scope, emitted by src/db/rowLevelSecurity.ts and '
  'named there rather than here, because a migration that names a scope is the '
  'beginning of a second list (056 SS4).';
