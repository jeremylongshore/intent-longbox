-- 032_longbox_origin_designation.sql — E03-D14 (bead longbox-e5b.3.24)
--
-- THE ORIGIN PREDICATE. Docs: 000-docs/058 in full; 054 §6 (the claim this
-- narrows back to discharged); 019 T35(c) (*"periodic reconciliation of
-- Longbox-origin database sessions against break-glass rows"*, NON-WAIVABLE);
-- 034 §2.5 (an `app_user` is a PARTY, not a tenant's row), §2.7 (grant/release,
-- never an UPDATE); 048 §3 (the session chains); 022 P3 (staff data serves
-- learning and support, never covert measurement), P7; 041 §2.1 (a thing that
-- happened is a row), §2.3 (the authorship envelope), §9.2 (declared triggers);
-- 056 §7 (a table with no tenant is DECLARED, with a reason); 000-docs/044 §2,
-- §7 (expand-only, idempotent by hand).
--
-- ⚠ **NUMBERED 032, NOT 031.** E03-D11 is building `031` on the same base. The
-- runner's ledger keys on FILENAME and applies unseen files in sorted order
-- (`scripts/migrationDiscipline.ts:planMigrations`), so a gap is legal and
-- self-healing — `027` has been one since E03-B06 reserved and never wrote it.
-- Nothing in the runner, the lint or the checksum reads contiguity.
--
-- ============================================================================
-- WHAT THIS CLOSES, IN THE WORDS OF THE RECORD THAT LEFT IT OPEN
-- ============================================================================
--
-- 054 §6: *"T35(c) reconciles 'Longbox-origin sessions'. This schema has no
-- staff flag and cannot tell a Longbox person from a shop's person, so the
-- population here is every session of a person who holds a `support_break_glass`
-- grant at some time — a superset of what matters and a SUBSET of
-- 'Longbox-origin'. A Longbox employee who was never granted break-glass is
-- invisible to it."*
--
-- Invisible BY CONSTRUCTION is the part that mattered: the reconciliation could
-- not have found such a session however often it ran, because the population it
-- selects from is defined by the grant it is checking for. This file adds the
-- fact that population was missing.
--
-- ============================================================================
-- FOUR DECISIONS A READER WILL WANT ARGUED, NOT ASSUMED (000-docs/058 §3)
-- ============================================================================
--
-- **(a) A ROW, NOT A COLUMN ON `app_user`.** A boolean `is_longbox_staff` on
-- `app_user` — a declared MUTABLE table (048 §10.1: a person is a statement
-- about the present) — is flipped by one UPDATE, leaves nothing behind, and
-- takes every past session out of the audit's population with it. The whole
-- value of this predicate is that it cannot be quietly withdrawn, so it is an
-- append-only issuance with an append-only ending, on `membership`'s
-- grant/release idiom (034 §2.7) rather than on a status column.
--
-- **(b) THE START IS SETTABLE AND THE END IS NOT, AND THAT ASYMMETRY IS THE
-- CONTROL.** `effective_from` may be back-dated by the CLI, because a
-- designation records something that was TRUE before anybody wrote it down and
-- an audit that could not backdate would be permanently blind to every session
-- before the day somebody remembered to run it. Back-dating a start WIDENS the
-- audited population. The retirement has no such column: it ends the designation
-- at its own `created_at`, which the writer does not choose. Narrowing the
-- population retroactively — hiding a session that has already happened — is the
-- one motion an attacker with write access would want, and it is not
-- expressible here.
--
-- **(c) THE APPLICATION ROLE MAY NOT WRITE EITHER TABLE.** Both are declared
-- `appGrant: "none"` in `src/db/appendOnlyTables.ts`, so the grant step's
-- opening `REVOKE ALL` leaves `longbox_app` with no privilege at all on them. A
-- table that records WHO IS BEING WATCHED must not be writable by the process
-- being watched: with INSERT, a compromised server could append a retirement and
-- take a staff account out of the audit's population from that moment on.
-- Designation is a schema-owner act reached from a CLI (`pnpm designate-staff`),
-- which is the same shape 048 §12.4 row 3a forces on every other privileged
-- issuance until E03-D11 lands the privileged session.
--
-- **(d) NO `shop_id`, AND THE FUNCTION IS THE ONLY DEFINITION OF THE PREDICATE.**
-- Origin is a fact about a PERSON and follows them to every shop — which is
-- exactly the property the reconciliation needs, since the session worth finding
-- is the one at a shop the person holds nothing at. Both tables are therefore
-- declared RLS exemptions (056 §7, the "person" class, beside `app_user`
-- itself). `longbox_is_origin_staff(app_user_id, at)` is a STABLE SQL function
-- so the predicate has ONE definition: the reconciliation calls it, the CLIs
-- call it, and no TypeScript copy of it exists to drift.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- The designation. Immutable, append-only.
--
-- `origin` is a CLOSED enum with one member today. A second member is a
-- migration and a decision, which is the point: the vocabulary of who a person
-- is to Longbox should not be extensible by whoever writes the next INSERT.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user_origin (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id    uuid NOT NULL REFERENCES app_user(id),
  origin         text NOT NULL CHECK (origin IN ('longbox_staff')),
  -- 034 §2.7's rule for a grant that widens what somebody can reach, applied to
  -- a fact that widens what an audit can see: it says why, in a person's words.
  reason         text NOT NULL CHECK (length(btrim(reason)) > 0),
  -- Nullable: the designating party is a Longbox operator running a CLI as the
  -- schema owner, who need not be an `app_user` at all. When they are one, the
  -- row names them.
  designated_by  uuid REFERENCES app_user(id),
  -- (b) above. Settable, and DEFAULT now() for the ordinary case.
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- 041 §2.3's envelope. A designation is a human act, always.
  authored_by    text NOT NULL DEFAULT 'human'
                   CHECK (authored_by IN ('human','system','provider'))
);
CREATE INDEX IF NOT EXISTS app_user_origin_user_idx ON app_user_origin (app_user_id);

-- ---------------------------------------------------------------------------
-- The ending. `membership_revocation`'s shape, one table over.
--
-- NO `effective_until` and no settable timestamp: the designation ends at this
-- row's own `created_at` (decision (b)). At most one ending per designation, by
-- the UNIQUE rather than by a convention — two concurrent retirements leave one
-- row, and re-designating a person who returns is a NEW designation rather than
-- an un-retirement.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user_origin_retirement (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_id   uuid NOT NULL REFERENCES app_user_origin(id),
  reason      text NOT NULL CHECK (length(btrim(reason)) > 0),
  retired_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  authored_by text NOT NULL DEFAULT 'human'
                CHECK (authored_by IN ('human','system','provider'))
);
CREATE UNIQUE INDEX IF NOT EXISTS app_user_origin_retirement_origin_idx
  ON app_user_origin_retirement (origin_id);

-- ---------------------------------------------------------------------------
-- The predicate, AS OF a moment. Decision (d): one definition, in SQL.
--
-- `STABLE` rather than `VOLATILE` so the planner may lift it, and SECURITY
-- INVOKER (the default) so it reads with the caller's privileges and never lends
-- the owner's — a function that read these tables as their owner would be a
-- bypass of the grant decision (c) just took.
--
-- A NULL `p_app_user_id` (a DEVICE session, 048 §3.1) answers false rather than
-- NULL: a phone is not a person and cannot be Longbox-origin.
--
-- AS OF is MANDATORY and there is no `now()` overload, on `resolve(lcid, asOf)`'s
-- precedent (047): the question the audit asks is *"was this person staff WHEN
-- THIS SESSION WAS ISSUED"*, and a default of `now()` would silently answer a
-- different question for every session issued before a designation was retired.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION longbox_is_origin_staff(p_app_user_id uuid, p_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM app_user_origin o
     WHERE o.app_user_id = p_app_user_id
       AND o.origin = 'longbox_staff'
       AND o.effective_from <= p_at
       AND NOT EXISTS (
             SELECT 1
               FROM app_user_origin_retirement r
              WHERE r.origin_id = o.id
                AND r.created_at <= p_at))
$$;

COMMENT ON FUNCTION longbox_is_origin_staff(uuid, timestamptz) IS
  'E03-D14 / 019 T35(c): was this person Longbox-origin at that moment? The ONE definition of the predicate.';

-- ---------------------------------------------------------------------------
-- Append-only, and `ENABLE ALWAYS` in the same breath (041 §9.2 item 1, 044 §7).
-- `CREATE TRIGGER` always lands at the bypassable 'O' default and the gate-test
-- asserts 'A' for every declared trigger. The declared set is
-- `src/db/appendOnlyTables.ts`.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_user_origin','app_user_origin_retirement'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;
