-- 031_first_factor_and_privileged_session.sql — E03-D11 (bead longbox-e5b.3.21)
--
-- 048 §10.1's **M3 remainder** — `user_credential`, the FIRST factor, which
-- 048 §10.2's table assigned to no bead at all — plus the THIRD session kind
-- 048 §12.4 row 3a hands over, plus the `user_authenticator` replay-guard
-- trigger PR #82 left as a residual. Docs: 000-docs/057 (this bead's record);
-- 048 §3.1, §4.1, §8, §9.1, §9.2, §10.1, §12.4 rows 3/3a; 041 R1/§9.2 item 1;
-- 042 §5.3(b); 044 §2, §7; 054 §3.
--
-- ============================================================================
-- THE SHAPE, IN ONE PARAGRAPH
-- ============================================================================
--
-- 048 §4.1 puts the second factor inside "a session established by password +
-- TOTP within a freshness window". E03-D06 built the second factor and found
-- that neither half of that sentence existed: `user_credential` had no owner,
-- and `app_session`'s two kinds are BOTH bound to an enrolled phone by the
-- `app_session_kind_shape` CHECK and by two composite foreign keys — so there
-- was no row shape for a person on their own laptop, and the issuance routes
-- 048 §7 describes stayed `pending: true`. This migration lands both halves:
-- a password credential, and a `privileged` session kind that names a SHOP and
-- a PERSON and no device at all.
--
-- ============================================================================
-- WHY THE THIRD KIND WIDENS `app_session` RATHER THAN TAKING ITS OWN TABLE
-- ============================================================================
--
-- A separate `privileged_session` table would need its own liveness predicate,
-- its own revocation table, its own rotation, its own reuse detector and its own
-- cookie plumbing — five mechanisms re-derived, four of which are security
-- properties. 048 §12.4 row 3a already anticipates the alternative and names its
-- cost in the schema's own terms: *"adding a third `kind` means widening
-- `app_session`'s CHECK, dropping two `NOT NULL`s and adding a third composite
-- FK to keep K5 total."* This file does exactly that, and reports one honest
-- divergence: it is THREE `NOT NULL`s, not two. `location_id` is as unavailable
-- to a person at a desk as `device_id` is, and 048 §12.4 row 3a counted the two
-- device columns without it. 000-docs/057 §4.2 records the correction.
--
-- ⚠ **THE THIRD COMPOSITE FK IS NOT BELT-AND-BRACES, AND THE REASON IS THE SAME
-- ONE `020` GIVES FOR THE SECOND.** 041 R1 / 048 K5 makes ONE mandatory —
-- `(rotated_from, app_user_id, device_id)` — so a rotation cannot change WHO the
-- session is for or WHICH device it is on. Under the default MATCH SIMPLE a
-- composite FK is **not checked at all when any referencing column is NULL**, so
-- on a PRIVILEGED session (where `device_id` is NULL) K5's constraint is inert,
-- exactly as `020` found it inert on the DEVICE chain (where `app_user_id` is
-- NULL). `020` answered that with `(rotated_from, device_id)`, whose columns are
-- never NULL on the two kinds it covers. The privileged chain needs the mirror
-- image:
--
--   FOREIGN KEY (rotated_from, app_user_id) REFERENCES app_session (id, app_user_id)
--
-- With all three present every chain is covered by at least one TOTAL check:
-- device chains by the device pair, operator chains by all three, privileged
-- chains by the person pair. Without this one, a hostile write could chain one
-- owner's privileged session onto another's and every liveness predicate in
-- 048 §3.3 would accept it — a live row, an unrevoked chain, no successor.
--
-- ============================================================================
-- WHAT THIS FILE DOES NOT DO
-- ============================================================================
--
-- It does not add a `mfa_verified_at` column, and that is a decision rather than
-- an omission (057 §4.3). 048 §4.1's *"freshness window"* is a property of the
-- privileged CHAIN, and the chain already has one: `absolute_expires_at` is
-- carried unchanged across every rotation (`sessions.ts`, "the ceiling belongs
-- to the CHAIN"), so a short absolute expiry IS the freshness window. A second
-- column holding the same fact is a second thing that can disagree with the
-- first, which is the shape 040 A8, 042 I5 and 047 §5.1 each refused.
--
-- It does not add a `status`, an `active`, a `revoked` or a `last_seen_at` to
-- anything. 048 §3.3 governs the new kind exactly as it governs the other two.
--
-- SHAPE: EXPAND ONLY. Tables and columns are added, a CHECK is WIDENED (it
-- accepts strictly more than before), three `NOT NULL`s are DROPPED (also a
-- widening), and nothing is dropped, retyped or narrowed. Re-runnable by hand.

BEGIN;

-- ---------------------------------------------------------------------------
-- 048 §10.1's M3 remainder — THE FIRST FACTOR.
--
-- CONFIG, MUTABLE, exactly as 048 §10.1 ratifies it and for the reason it gives:
-- *"a password is changed in place; versioning the hash would keep every old
-- password's hash forever, which is a liability rather than an audit trail."*
-- That is the same ruling `operator_pin` and `user_authenticator` sit under, and
-- this table is named in the same sentence as both. What HAPPENED to it is
-- recorded elsewhere and not here: a failed verification is an `auth_attempt`
-- row (048 §9.1), and a successful one is deliberately recorded NOWHERE (048
-- R16 — a per-person log of when each person signed in is the surface 022 P3
-- forbids).
--
-- ⚠ **IT IS ALSO A LOCKOUT ANCHOR, AND THAT IS WHY IT IS ONE ROW PER PERSON.**
-- 048 §9.1's construction is *"count and verify in one transaction under
-- `SELECT … FOR UPDATE` on an anchor row, because every reader of the count is a
-- writer of the row it is a count about"* — `operator_pin` for a PIN,
-- `user_authenticator` for a TOTP code (048 §4.3), and this row for a password.
-- `UNIQUE (app_user_id)` is what makes the anchor exist at all: one row per
-- person, so there is exactly one thing to lock.
--
-- ⚠ **THE PEPPER IS THE SAME PEPPER, AND THAT IS A DECISION** (057 §4.1). 048
-- §9.2 says PIN and password hashes are computed over `secret ‖ pepper` with
-- ONE process-environment value, and 055 §9 item 11 hands the confirmation here.
-- Two peppers would be two custody obligations, two things to lose and two
-- rotations to run, in exchange for a separation that buys nothing: every path
-- back in after a pepper loss is authenticated by something under the lost value
-- (055 §2 E4/E6), so splitting the value splits the blast radius of nothing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_credential (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id    uuid NOT NULL REFERENCES app_user(id),

  -- argon2id over `password ‖ pepper`, encoded — salt, parameters and digest in
  -- one string, the same encoding `operator_pin.pin_hash` carries. The pepper is
  -- read from the process environment at boot and is NEVER in this database, in
  -- a migration, in a fixture or in a backup of this database (048 §9.2, R6).
  -- For a password the pepper is defence in depth rather than load-bearing — a
  -- password is not a six-digit keyspace — and it is applied anyway, because the
  -- alternative is two hashing rules in one file and a reader who has to
  -- remember which is which.
  password_hash  text NOT NULL,

  -- 048 §9.2: peppering is VERSIONED, the same construction §4.2 gives the
  -- authenticator key, so a rotation re-peppers each credential at its next
  -- successful verification rather than by a mass rewrite of a table nobody can
  -- decrypt. The COLUMN lands here; the ring that would make it move is 055 §9
  -- item 5's build half and is not in this bead (057 §7 residual R3).
  pepper_version smallint NOT NULL DEFAULT 1 CHECK (pepper_version >= 1),

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- 041 §2.3's envelope. 'human': a person chose this password. ⚠ 048 §3.5's
  -- RULE binds here without amendment — this is an ATTRIBUTION OF RECORD and is
  -- never non-repudiable, never proof of who acted.
  authored_by    text NOT NULL DEFAULT 'human'
                   CHECK (authored_by IN ('human','system','provider')),

  -- The anchor. One row per person, so 048 §9.1's `FOR UPDATE` has exactly one
  -- row to take and the count it guards cannot be read by two transactions that
  -- both then proceed.
  CONSTRAINT user_credential_one_row_per_person UNIQUE (app_user_id)
);

-- ---------------------------------------------------------------------------
-- The first factor is CONFIG, but it is not a table anybody may rewrite.
--
-- 041 §9.2 item 1 ranks enforcement: an `ENABLE ALWAYS` trigger, because a
-- trigger does not consult privileges and survives every replication role. The
-- app role's grant on this table is COLUMN-SCOPED (`src/db/appRoleGrants.ts`) so
-- only the three columns below may move; the trigger is the half that a dropped
-- or widened GRANT cannot bypass, and it also refuses the DELETE that a grant
-- layer alone would permit.
--
-- Shipping it in the SAME migration as the table is deliberate: E03-D06 shipped
-- `user_authenticator`'s column-scoped grant without the matching trigger, and
-- the gap it left is the residual this file closes below. A rule applied to one
-- table and not the next one is a rule that was a habit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_credential_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'user_credential rows are never deleted (048 §10.1): a person leaving is a '
      'membership_revocation fact, not the disappearance of the row an auth_attempt '
      'window is derived from';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.app_user_id IS DISTINCT FROM OLD.app_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.authored_by IS DISTINCT FROM OLD.authored_by THEN
    RAISE EXCEPTION
      'only password_hash, pepper_version and updated_at may change on user_credential '
      '(048 §10.1: a password is changed in place; whose credential it is, is not)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_credential_scoped_mutation ON user_credential;
CREATE TRIGGER user_credential_scoped_mutation
  BEFORE UPDATE OR DELETE ON user_credential
  FOR EACH ROW EXECUTE FUNCTION forbid_credential_mutation();
ALTER TABLE user_credential ENABLE ALWAYS TRIGGER user_credential_scoped_mutation;

-- ---------------------------------------------------------------------------
-- THE PR #82 RESIDUAL — the replay guard, enforced by the DATABASE.
--
-- E03-D06's re-review recorded it in the bead's own notes: *"the app role holds
-- a column-scoped UPDATE on `user_authenticator.last_used_step`, so R19
-- monotonicity is the service SQL only — an actor with the app connection could
-- roll the step back and replay a code inside the ±1 window."* 048 R19's whole
-- construction is that **the database decides, not the application**: the
-- conditional `UPDATE … WHERE last_used_step < $new` is the check. A guard whose
-- monotonicity lives only in the one statement that happens to spell the
-- predicate is a guard any second statement removes.
--
-- Two rules, both `ENABLE ALWAYS`:
--   (1) only `last_used_step` and `updated_at` may change — the sealed secret,
--       its nonce, its `key_version` and the TOTP parameters are written once at
--       enrollment and never again (`src/db/appendOnlyTables.ts` says so; this
--       makes the sentence enforceable);
--   (2) `last_used_step` only ever INCREASES, and never returns to NULL.
--
-- A DELETE is refused for the same reason it is refused on `user_credential`: an
-- ending is a `user_authenticator_retirement` row (048 §8.1), and a factor that
-- can be deleted is a retirement fact that can be made to disappear.
--
-- ⚠ **THE RE-SEAL WRITES A NEW ROW AND NEVER EDITS THIS ONE** (057 §4.6). Key
-- rotation moves a secret from one `key_version` to the next by INSERTING a
-- successor and retiring the predecessor `replaced`, carrying `last_used_step`
-- forward — so rule (1) is compatible with rotation rather than in tension with
-- it, and the AAD stays bound to the row it was computed for (048 R18).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_authenticator_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'user_authenticator rows are never deleted (048 §8.1): an ending is a '
      'user_authenticator_retirement row, and a factor that can be deleted is a '
      'retirement that can be made to disappear';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.app_user_id IS DISTINCT FROM OLD.app_user_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.secret_ciphertext IS DISTINCT FROM OLD.secret_ciphertext
     OR NEW.secret_nonce IS DISTINCT FROM OLD.secret_nonce
     OR NEW.key_version IS DISTINCT FROM OLD.key_version
     OR NEW.digits IS DISTINCT FROM OLD.digits
     OR NEW.period_seconds IS DISTINCT FROM OLD.period_seconds
     OR NEW.algorithm IS DISTINCT FROM OLD.algorithm
     OR NEW.enrolled_at IS DISTINCT FROM OLD.enrolled_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.authored_by IS DISTINCT FROM OLD.authored_by THEN
    RAISE EXCEPTION
      'only last_used_step and updated_at may change on user_authenticator (048 R18): '
      'a sealed secret is written once, and a key rotation is a NEW row that supersedes '
      'this one, never an edit that breaks the id-as-AAD binding';
  END IF;
  IF NEW.last_used_step IS NULL
     OR (OLD.last_used_step IS NOT NULL AND NEW.last_used_step <= OLD.last_used_step) THEN
    RAISE EXCEPTION
      'last_used_step is monotone (048 R19): a step may only move forward, because '
      'rolling it back makes every code inside the +/-1 window replayable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_authenticator_step_is_monotone ON user_authenticator;
CREATE TRIGGER user_authenticator_step_is_monotone
  BEFORE UPDATE OR DELETE ON user_authenticator
  FOR EACH ROW EXECUTE FUNCTION forbid_authenticator_mutation();
ALTER TABLE user_authenticator ENABLE ALWAYS TRIGGER user_authenticator_step_is_monotone;

-- ---------------------------------------------------------------------------
-- 048 §3.1 + §12.4 row 3a — THE THIRD SESSION KIND.
--
-- Everything 048 §3.3 says about liveness, rotation, revocation and the absence
-- of a status column applies to this kind unchanged. What differs is what the
-- row NAMES: a shop and a person, and no device, no device credential and no
-- location — because 048 §4.1 places a privileged session on *"any device"*, and
-- the owner it is built for is at a desk with a laptop that this system has
-- never enrolled and never will.
-- ---------------------------------------------------------------------------

-- (a) the kind itself.
ALTER TABLE app_session DROP CONSTRAINT IF EXISTS app_session_kind_check;
ALTER TABLE app_session DROP CONSTRAINT IF EXISTS app_session_kind_is_known;
ALTER TABLE app_session ADD CONSTRAINT app_session_kind_is_known
  CHECK (kind IN ('device','operator','privileged'));

-- (b) the three columns a person at a desk cannot supply.
--
-- Dropping a `NOT NULL` is an EXPAND step (044 §2): it accepts strictly more
-- than before, every existing row still satisfies the column, and no reader that
-- was compiled against the old shape breaks — the shape CHECK below is what
-- keeps the two existing kinds exactly as `020` left them.
ALTER TABLE app_session ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE app_session ALTER COLUMN device_credential_id DROP NOT NULL;
ALTER TABLE app_session ALTER COLUMN location_id DROP NOT NULL;

-- (c) the shape, widened by one disjunct and TIGHTENED on the other two.
--
-- The device and operator disjuncts now assert the three columns explicitly.
-- They were implied by the `NOT NULL`s a moment ago and are not any more, so
-- restating them here is not redundancy — it is the whole of what stops the
-- widening from loosening the two kinds it was not about. A device session with
-- a NULL `device_id` would be a phone session that names no phone, and every
-- predicate downstream of it reads `device_id` as a fact.
ALTER TABLE app_session DROP CONSTRAINT IF EXISTS app_session_kind_shape;
ALTER TABLE app_session ADD CONSTRAINT app_session_kind_shape CHECK (
  (kind = 'device'     AND app_user_id IS NULL     AND parent_session_id IS NULL
                       AND parent_chain_id IS NULL
                       AND device_id IS NOT NULL   AND device_credential_id IS NOT NULL
                       AND location_id IS NOT NULL) OR
  (kind = 'operator'   AND app_user_id IS NOT NULL AND parent_session_id IS NOT NULL
                       AND parent_chain_id IS NOT NULL
                       AND device_id IS NOT NULL   AND device_credential_id IS NOT NULL
                       AND location_id IS NOT NULL) OR
  -- 048 §4.1: established by password + TOTP, on any device, and standing
  -- NOWHERE — so it has no parent to sit on and no phone to be revoked with.
  -- `location_id` is NULLABLE rather than forbidden: a location-scoped manager
  -- may name the storefront they are acting for at sign-in, checked against the
  -- shop and against their own membership (057 §4.4), and a person who names
  -- none holds a session that reaches shop-scoped acts only.
  (kind = 'privileged' AND app_user_id IS NOT NULL AND parent_session_id IS NULL
                       AND parent_chain_id IS NULL
                       AND device_id IS NULL       AND device_credential_id IS NULL)
);

-- (d) the third composite FK, and the unique target that makes it expressible.
--
-- See the header: MATCH SIMPLE leaves K5's own constraint unchecked whenever
-- `device_id` is NULL, which is every privileged row. This one's columns are
-- never NULL on a privileged or an operator row, so it is TOTAL on both.
ALTER TABLE app_session DROP CONSTRAINT IF EXISTS app_session_person_target;
ALTER TABLE app_session ADD CONSTRAINT app_session_person_target UNIQUE (id, app_user_id);

ALTER TABLE app_session DROP CONSTRAINT IF EXISTS app_session_rotation_keeps_its_person;
ALTER TABLE app_session ADD CONSTRAINT app_session_rotation_keeps_its_person
  FOREIGN KEY (rotated_from, app_user_id) REFERENCES app_session (id, app_user_id);

-- (e) the ending's vocabulary.
--
-- `signed_out` already covers a person ending their own privileged session and
-- `membership_change` already covers 048 §3.4's rotation — both are written by
-- code that does not know or care which kind it is ending. TWO causes are new and
-- neither has an existing name.
--
-- `mfa_reenrolled`: a privileged session whose holder used a RECOVERY CODE is
-- ended when they re-enrol, because the session that re-enrolled the factor must
-- not outlive the state that forced it (048 §8.1).
--
-- `privileged_superseded`: the person signed in privileged again, so their
-- earlier privileged chains at that shop end (057 §4.4a). ⚠ **This is the one
-- remedy an owner has against a COPIED cookie**, and it needs its own name rather
-- than `signed_out` for a reason that is not cosmetic: it is the row somebody
-- points at when they say "I evicted whatever had my session", and `signed_out`
-- would make that indistinguishable from clicking a button. A privileged session
-- is deliberately not device-bound, so there is nothing else to revoke and no
-- device to blame — the ordinary act of signing in again has to be the act that
-- works.
ALTER TABLE app_session_revocation DROP CONSTRAINT IF EXISTS app_session_revocation_reason_check;
ALTER TABLE app_session_revocation DROP CONSTRAINT IF EXISTS app_session_revocation_reason_is_known;
ALTER TABLE app_session_revocation ADD CONSTRAINT app_session_revocation_reason_is_known
  CHECK (reason IN ('signed_out','token_reuse','membership_change','device_revoked',
                    'operator_switch','mfa_reenrolled','privileged_superseded'));

-- 048 §9.1's `auth_attempt.method` gains the first factor. `password` was
-- already in `020`'s CHECK — the column was designed for a bead that had not
-- been written — so nothing changes here and the absence of a statement is the
-- statement. (`025` widened the same CHECK for `recovery_code`.)

COMMIT;
