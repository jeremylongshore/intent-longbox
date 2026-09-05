-- 028_authorization_decision.sql — E03-B03 (bead longbox-e5b.3.3)
--
-- The actor audit, as a DECISION RECORD. Docs: 054 §4 in full; 034 §2.6 (the
-- four roles), §2.7 (a membership is an append-only grant), §8 (*"the
-- access-audit table itself — E03-B03"*); 022 P3 (staff data serves learning and
-- support, never covert measurement); 019 T24, T34, T35; 041 §2.3 (the
-- authorship envelope), §9.2 (declared triggers); 048 §3.5, §12.4 row 6;
-- 000-docs/044 §2, §7 (expand-only, idempotent by hand).
--
-- ⚠ **NUMBERED 028, NOT 026.** E03-B06 (connector OAuth) is building 026 and 027
-- on the same base. The runner's ledger keys on FILENAME and applies unseen files
-- in sorted order (`scripts/migrationDiscipline.ts:planMigrations`), so a gap is
-- legal and self-healing: whichever branch lands second simply applies the files
-- the other added. Nothing in the runner, the lint or the checksum reads
-- contiguity.
--
-- ============================================================================
-- WHAT THIS TABLE IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT (022 P3)
-- ============================================================================
--
-- 022 P3's CFO constraint is unambiguous: *"the cheapest way to satisfy T35 is
-- never to build a per-operator surface, and no such surface may be built and
-- then restricted."* A table that recorded every request a named person made
-- would be a covert timeclock with a security justification stapled to it, and
-- it would be exactly the artifact P3 forbids.
--
-- So this table records a DECISION ABOUT A GRANT, not an activity of a person:
--
--   * it names the ROUTE TEMPLATE (`/api/v1/shops/:shopId/scan-sessions/:id/
--     identify`) and never the URL — no shop id, no session id, no photo id, so
--     no row here can be joined to an ITEM;
--   * it names the MEMBERSHIP — the grant that was consulted — and NOT the
--     `app_user_id`. The person is one join away, through `membership`, which is
--     the identity module's table. That is the join 034 §3.3's accessor rule
--     exists to gate;
--   * it carries no duration, no outcome, no count, no photograph, no book and
--     no place;
--   * ALLOWANCES ARE RECORDED ONLY FOR MUTATING ROUTES (054 §4.3). A record of
--     every read a person performed is a record of what they looked at, which is
--     surveillance; a record of every state change they were permitted to make is
--     the decision record an auditor needs. Refusals are recorded whatever the
--     method, because a refusal is the security event.
--
-- **It is therefore an aggregate over roles by construction**: the most a report
-- built on this table alone can say is *"a manager-scoped grant was refused
-- `membership.invite` four times"*. Saying anything about a PERSON requires the
-- membership join, and 019 T35 governs that join.
--
-- ============================================================================
-- WHY IT IS A TABLE AND NOT A LOG LINE
-- ============================================================================
--
-- Because 019 T35(c) requires *"periodic reconciliation of Longbox-origin
-- database sessions against break-glass rows"* and T34 requires the writer to
-- report a heartbeat. A reconciliation query is a JOIN; a log line is a string in
-- somebody else's retention policy. 041 §2.1's rule applies unchanged: a thing
-- that happened is a row.
--
-- ============================================================================
-- WHAT IT IS NOT ALLOWED TO GAIN
-- ============================================================================
--
-- No `app_user_id`. No `display_name`. No `ip_address`, no `user_agent` and no
-- `correlation_id` — each of which would turn a decision record into a request
-- log, and the last of which would make every row joinable to the request's own
-- item. No duration and no count. `tests/contract/authorization-audit-surface.test.ts`
-- asserts the column list, so adding one is a red build and a conversation
-- rather than a commit.
--
-- Retention is **E03-B09's** (048 §12.4 row 4b): this record has a window and
-- this migration does not invent one.
--
-- ============================================================================
-- SHAPE: EXPAND ONLY
-- ============================================================================
--
-- One new table, its indexes, its append-only trigger at `ENABLE ALWAYS`, and one
-- constraint added to `membership` under the DROP-then-ADD idiom (`NOT VALID`, so
-- rows that predate it are not re-checked — 023's precedent). Nothing dropped,
-- nothing retyped, no `SET NOT NULL` on an existing column, no `-- contract:`
-- header (044 §2).

BEGIN;

CREATE TABLE IF NOT EXISTS authorization_decision (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Locked decision 4: `shop_id` on every shop-scoped table, even where the
  -- query would not need it. It is the tenant the decision was taken IN, taken
  -- from the session and never from a URL (048 §6.1).
  shop_id          uuid NOT NULL REFERENCES shop(id),

  -- THE SURFACE the act was reached from, and for an HTTP request that is the
  -- route TEMPLATE: `POST` + `/api/v1/shops/:shopId/scan-sessions/:id/identify`.
  -- Never the request's URL — a URL carries ids, and an audit row carrying ids is
  -- joinable to the work, which is the line this table does not cross (022 P3).
  --
  -- For an act reached from an operator SCRIPT the method is the literal `CLI`
  -- and the path is the script, e.g. `scripts/issue-invitation.ts`. That is an
  -- operational fact about how the act arrived and not a fact about a person,
  -- and recording it is what lets a reader tell a privileged act taken at a
  -- terminal from one taken on a phone.
  route_method     text NOT NULL,
  route_path       text NOT NULL,

  -- The permission asked for, and the version of the matrix that answered.
  -- `matrix_version` is the column that makes this row readable after the code
  -- changes: memberships are reconstructible at any past timestamp (034 §2.7),
  -- but the RULE applied to them is code, and code is not a row.
  permission       text NOT NULL,
  matrix_version   text NOT NULL,
  -- The COMMIT the decision was taken under (K2). `matrix_version` is a semver
  -- over a code constant, and a semver names a constant rather than a row: two
  -- deployments can both say `1.0.0` while one carries an edit nobody bumped.
  -- The commit resolves a past row to bytes. `'unknown'` when the deployment
  -- sets no build stamp — a value, not a null, so it cannot be confused with a
  -- row written before the column existed. The immutable snapshot table this
  -- would ideally point at is E03-D16.
  matrix_commit    text NOT NULL DEFAULT 'unknown',

  -- The grant the decision was taken against. NULLABLE for a refusal: a caller
  -- refused because no live grant of theirs holds the permission has no
  -- membership to name, and inventing one would be worse than a null.
  membership_id    uuid REFERENCES membership(id),
  -- The role that decided. Nullable for the same reason, and constrained to
  -- 034 §2.6's closed enum so a fifth role cannot arrive here first.
  role             text CHECK (role IN ('owner','manager','operator','support_break_glass')),

  -- The operator session's chain (048 §3.3). NOT a foreign key: a chain is MANY
  -- `app_session` rows — that is what rotation means — so `app_session.chain_id`
  -- is deliberately not unique and there is nothing to point at.
  --
  -- ⚠ **AND IT IS DELIBERATELY UNINDEXED** (054 §4.2, the security lens's F1 and
  -- S6). A session chain is a person, a phone and a shift; an INDEX on it is a
  -- fast "everything this person did on this phone that day", which is the
  -- covert timeclock 022 P3 forbids — and the first version of this file
  -- shipped that index while the record beside it argued the table was not a
  -- per-operator surface. The column stays, because 019 T35(c)'s reconciliation
  -- runs session-to-grant and a decision that cannot name its session cannot
  -- participate in it; what it makes derivable is stated in 054 §4.2 rather
  -- than made cheap here. The reconciliation's join is a sequential scan, which
  -- is correct for a query that runs on a schedule and wrong for one somebody
  -- runs casually.
  --
  -- **NULLABLE, and the null has exactly one meaning** (054 §4.3): the act was
  -- not taken through a session at all. The two privileged acts — inviting a
  -- person, enrolling a phone — are reached from operator SCRIPTS run as the
  -- schema owner (048 §7, E03-D11 will give them routes), and a CLI has no
  -- session to name. The CHECK below ties the null to that reason, so it cannot
  -- quietly become "a session we failed to record".
  session_chain_id uuid,

  decision         text NOT NULL CHECK (decision IN ('allowed','refused')),
  -- `role` — no grant this person holds carries the permission anywhere.
  -- `scope`  — the role holds it, but not at the place this session is pinned to
  --            (or not at shop level for a shop-scoped permission). The CALLER is
  --            told nothing of the difference (019 T24, 048 §6.5); the record
  --            keeps it, because an auditor asking "why was this refused" needs
  --            the answer the caller must not get.
  refusal_reason   text CHECK (refusal_reason IN ('role','scope')),
  decided_at       timestamptz NOT NULL DEFAULT now(),
  -- ⚠ **NO `authored_by`, and the omission is a decision** (054 §4.2, F10).
  -- 041 §2.3's envelope exists to record WHICH KIND OF ACTOR produced a witness
  -- row, because a `condition_assessment` written by a person and one written by
  -- a provider mean different things. Every row in this table is written by the
  -- same rule in the same function — the column could only ever hold `'system'`,
  -- and a column with one possible value is a column that teaches a reader
  -- nothing and invites a second writer to set it to something else.

  -- A refusal states its reason and an allowance has none. Both halves, so
  -- neither a reasonless refusal nor an allowance carrying one can be written.
  CONSTRAINT authorization_decision_reason_matches_decision CHECK (
    (decision = 'allowed'  AND refusal_reason IS NULL) OR
    (decision = 'refused'  AND refusal_reason IS NOT NULL)
  ),
  -- A membership is named or it is not, and when it is, the role is the role of
  -- that grant. A row with a membership and no role would be a decision that
  -- cannot say what authority it used.
  CONSTRAINT authorization_decision_membership_has_a_role CHECK (
    membership_id IS NULL OR role IS NOT NULL
  ),
  -- A missing session is a CLI act and nothing else. Without this, `NULL` would
  -- be indistinguishable from a session the writer failed to record — and the
  -- reconciliation that reads this column would silently under-report.
  CONSTRAINT authorization_decision_session_or_cli CHECK (
    session_chain_id IS NOT NULL OR route_method = 'CLI'
  )
);

COMMENT ON TABLE authorization_decision IS
  'E03-B03 / 054. An append-only record of authorization DECISIONS: which permission a route '
  'asked for, which membership grant answered, and whether the act was permitted. It is not a '
  'request log and not per-operator telemetry (022 P3) — it names a grant, never a person, and '
  'carries no item, no duration and no count. Retention is E03-B09''s.';

COMMENT ON COLUMN authorization_decision.route_path IS
  'The route TEMPLATE as Fastify registers it, never the request URL. A URL carries ids; an '
  'audit row carrying ids is joinable to the work (022 P3).';

COMMENT ON COLUMN authorization_decision.matrix_version IS
  'The version of the role→permission matrix (src/services/auth/permissions.ts) that decided. '
  'Without it, answering "under what authority was this done" about a past decision means '
  're-running today''s rules over yesterday''s grants and calling the answer history.';

-- ONE access path, ONE index (054 §4.2, F1).
--
-- `(shop_id, decided_at DESC)` serves the retention sweep (E03-B09) and any
-- per-shop review. **There is deliberately no index on `membership_id` and none
-- on `session_chain_id`**, and both absences are the same rule: an index whose
-- only purpose is "everything this grant did" or "everything this person did on
-- this phone that day, fast" is the per-person query path this table exists not
-- to have (022 P3). Every such join still WORKS — a sequential scan on a
-- scheduled job is the right cost — it is simply not made cheap, which is what
-- keeps a casual query casual.
--
-- ⚠ The first version of this file carried `authorization_decision_chain_idx`
-- and justified it as serving 019 T35(c). **That was false**: the reconciliation
-- runs `app_session` → `membership`, and touches this table not at all. An index
-- justified by a query that does not use it is an index nobody would have
-- noticed was a surveillance affordance.
CREATE INDEX IF NOT EXISTS authorization_decision_shop_time_idx
  ON authorization_decision (shop_id, decided_at DESC);
DROP INDEX IF EXISTS authorization_decision_chain_idx;

-- ---------------------------------------------------------------------------
-- 034 I5's third clause, which had no mechanism: **a break-glass grant is never
-- granted by its own holder.**
--
-- 019's `membership` already carries the two CHECKs 034 §2.7 legislates — a
-- `support_break_glass` grant has an expiry and states a reason. The third
-- sentence of I5 — *"and is never granted by its own holder"* — was recorded as
-- "one application assertion" and no application asserts it. A self-grant is the
-- escalation path the role would otherwise create: anybody who reached the
-- membership writer could give themselves the only read path to per-operator
-- data and set their own expiry.
--
-- `NOT VALID`, on 023's precedent: rows written before this constraint are not
-- re-checked (there are none — the break-glass role has never been granted), and
-- every row after it is. `granted_by IS NULL` (the bootstrap grant) passes, which
-- is correct: a null is not a self-grant.
-- ---------------------------------------------------------------------------
ALTER TABLE membership DROP CONSTRAINT IF EXISTS membership_break_glass_is_never_self_granted;
ALTER TABLE membership ADD CONSTRAINT membership_break_glass_is_never_self_granted
  CHECK (role <> 'support_break_glass' OR granted_by IS DISTINCT FROM app_user_id) NOT VALID;

-- ---------------------------------------------------------------------------
-- Append-only, and `ENABLE ALWAYS` in the same breath (041 §9.2 item 1, 044 §7).
-- `CREATE TRIGGER` always lands at the bypassable 'O' default and the gate-test
-- asserts 'A' for every declared trigger. The declared set is
-- `src/db/appendOnlyTables.ts`.
--
-- A decision is a thing that HAPPENED. It is never corrected, never re-decided
-- in place and never deleted by the application — including when the matrix
-- changes, which is what `matrix_version` is for.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['authorization_decision'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;
