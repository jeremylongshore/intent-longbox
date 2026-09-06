-- 037_authenticator_offer_use_and_credential_clearance.sql — E03-D24 (bead longbox-e5b.3.34)
--
-- TWO TABLES THE CANNON REQUIRED, and neither was in this bead's first version.
-- Docs: 000-docs/063 §3.4 (the sealed enrolment offer), §3.8 (the break-glass
-- clearance), §5 R2; 048 R15 (single use is a CONSTRAINT or it is a race), §8.1
-- (a re-enrolment supersedes the recovery set), §9.1 (the lockout anchor), §10.1
-- (a password is config, changed in place); 041 §2.1 (a thing that happened is a
-- row), §9.2 (declared triggers); 056 §7 (a table's tenancy is DECLARED); 044
-- §2, §7 (expand-only, idempotent by hand).
--
-- ⚠ **NUMBERED 037.** `036` is E03-D21's, landing on the same base. The runner's
-- ledger keys on FILENAME and applies unseen files in sorted order
-- (`scripts/migrationDiscipline.ts:planMigrations`), so two builders numbering
-- consecutively is the normal case and a gap would be legal too — nothing in the
-- runner, the lint or the checksum reads contiguity.
--
-- SHAPE: EXPAND ONLY, `CREATE TABLE IF NOT EXISTS`, re-runnable by hand. It
-- retires nothing, so it carries no `-- contract:` header (044 §2).
--
-- ============================================================================
-- TABLE ONE — `authenticator_offer_use`: THE TICKET IS SPENT BY THE DATABASE
-- ============================================================================
--
-- **This is the security lens's F2 and it was a real, reproduced defect.** The
-- enrolment offer (063 §3.4) is a TOTP secret sealed under 048 R18's envelope and
-- handed to the client to hand back. At v1.0.0 nothing made it single-use: the
-- lens replayed one FORTY SECONDS after its first confirmation, under a new
-- `Idempotency-Key`, and got a second `201` — a SECOND authenticator, and eight
-- FRESH recovery codes, which silently retired the set the person had just
-- written off the screen. For the person in 048 §8.1's re-enrolment state, that
-- is the set they need most.
--
-- 048 R15's idiom is the answer and it is already used three times in this
-- schema — `invitation_use (invitation_id)`, `device_enrollment_code_use
-- (code_id)`, `recovery_code_use (code_id)`: **single use is a CONSTRAINT or it
-- is a race.** The ticket has no row of its own to key on (that is the point of
-- sealing it), so the key is its DIGEST, which `enrolOwnAuthenticator` already
-- computes for the idempotency hash.
--
--   * **A GENUINE RETRY still works**, because `replayIfSettled` runs before any
--     of this: same key, same act, stored response. The constraint only bites a
--     RE-SUBMISSION under a NEW key, which is a second act.
--   * **The digest and never the ticket.** A ticket carries AEAD ciphertext and
--     a nonce; the digest is what identifies the act, and storing the ticket
--     would put sealed credential material in a column for no gain.
--   * **`ticket_digest` is the PRIMARY KEY**, not a surrogate with a unique
--     index beside it: there is exactly one row per ticket and the identity of
--     the row IS the ticket. A surrogate would be a second candidate key that
--     nothing uses.
--
-- ============================================================================
-- TABLE TWO — `user_credential_clearance`: THE REMEDY §5 R2 ASSUMED EXISTED
-- ============================================================================
--
-- **This is the security lens's F3.** 063 §5 R2 accepted, as a stated residual,
-- that a coworker who watches a PIN can set a FIRST password for somebody who
-- has none — and said the remedy was to notice and have the row cleared. The
-- lens checked: **there was no clearing at any level.** `migrations/031`'s
-- `ENABLE ALWAYS` trigger refuses a DELETE on `user_credential` to EVERYONE
-- including the schema owner, and no route and no CLI cleared one. A watched PIN
-- was therefore a permanent lockout of the privileged surface, remediable only
-- by disabling a trigger by hand.
--
-- **The clearance is an UPDATE plus a FACT, and never a DELETE.** The trigger
-- stays exactly as it is: the credential row is 048 §9.1's LOCKOUT ANCHOR, and a
-- row that could be deleted is a lockout that could be reset by deleting it. So
-- `password_hash` is set to NULL — inside `031`'s own three-column licence — and
-- what happened is a row here. A NULL digest verifies against nothing, so a
-- cleared person is refused with 048 §9.3's constant answer exactly as a person
-- with no credential is, and `provisionPassword`'s `ON CONFLICT (app_user_id) DO
-- NOTHING` still sees the row, so the FIRST-password route stays refused: the
-- clearance restores the ability to be given a password, by the same
-- schema-owner act, and does not silently reopen the counter-phone route.
--
-- ⚠ **`password_hash` BECOMES NULLABLE, AND THAT IS THE ONE COLUMN THIS FILE
-- ALTERS.** It is an expand-only change (044 §2: dropping a NOT NULL widens what
-- the column accepts and invalidates no reader), and every reader is audited
-- here: `verifyPassword` treats NULL as an absent credential and pays the
-- decoy's cost, which is the branch it already had for a person with no row.
--
-- Both tables are PERSON-SCOPED and carry no `shop_id`, so both are DECLARED RLS
-- exemptions on `recovery_code_use`'s reasoning, not new tenancy decisions
-- (`src/db/rowLevelSecurity.ts`).

BEGIN;

-- ---------------------------------------------------------------------------
-- 048 R15's idiom, for the sealed offer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS authenticator_offer_use (
  -- `sha256` of the ticket, hex, as `digestOf` produces it. The identity of the
  -- row IS the ticket, so it is the primary key and there is no surrogate.
  ticket_digest   text PRIMARY KEY CHECK (length(btrim(ticket_digest)) > 0),
  -- WHOSE enrolment it was. Not part of the key — a ticket is sealed to one
  -- person by its AAD, so two people cannot present the same digest — and here
  -- because a use that named nobody could not be read alongside the
  -- authenticator it produced.
  app_user_id     uuid NOT NULL REFERENCES app_user(id),
  -- The authenticator this offer became. Nullable for the same reason
  -- `invitation_use` does not carry a membership id: the row is written inside
  -- the same transaction and a FK that had to be satisfied first would fix an
  -- order the code does not otherwise owe.
  authenticator_id uuid REFERENCES user_authenticator(id),
  used_at         timestamptz NOT NULL DEFAULT now(),
  authored_by     text NOT NULL DEFAULT 'human'
                    CHECK (authored_by IN ('human','system','provider'))
);

-- ---------------------------------------------------------------------------
-- 063 §3.8 — the break-glass clearance, as a fact.
-- ---------------------------------------------------------------------------
ALTER TABLE user_credential ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS user_credential_clearance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id  uuid NOT NULL REFERENCES user_credential(id),
  app_user_id    uuid NOT NULL REFERENCES app_user(id),
  -- A CLOSED set, because these are the two situations that produce a clearance
  -- and neither is routine. `squatted_credential` is 063 §5 R2's own case — a
  -- coworker who watched a PIN set a first password the person does not know;
  -- `lost_credential` is the ordinary lockout where the person has forgotten
  -- theirs and holds no second factor to reach the rotation route with.
  reason         text NOT NULL CHECK (reason IN ('squatted_credential','lost_credential')),
  -- WHO cleared it, and it is NULLABLE for `retired_by`'s reason one table over:
  -- this runs as the schema owner from a terminal, where the operator's own
  -- `app_user_id` may not be known to the process. **Nothing verifies it** — it
  -- is an accountability record and not an authentication (058 R1's shape).
  cleared_by     uuid REFERENCES app_user(id),
  -- Free text, because the two reasons above are a class and an incident is a
  -- sentence. It is a NOTE ABOUT AN ACT and must never carry a credential value;
  -- the CLI's own prompt says so.
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  authored_by    text NOT NULL DEFAULT 'human'
                   CHECK (authored_by IN ('human','system','provider'))
);
CREATE INDEX IF NOT EXISTS user_credential_clearance_person_idx
  ON user_credential_clearance (app_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Append-only, and `ENABLE ALWAYS` in the same breath (041 §9.2 item 1, 044 §7).
-- `CREATE TRIGGER` always lands at the bypassable 'O' default and the gate-test
-- asserts 'A' for every declared trigger, so forgetting this is a red build
-- rather than a silent hole. The declared set is `src/db/appendOnlyTables.ts`.
--
-- Both, with no exemption. A ticket was spent; a credential was cleared. Neither
-- is a statement about the present that gets corrected.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['authenticator_offer_use','user_credential_clearance'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;
