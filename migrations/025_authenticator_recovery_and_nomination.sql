-- 025_authenticator_recovery_and_nomination.sql — E03-D06 (bead longbox-e5b.3.17)
--
-- 048 §10.1's **M3 remainder**: the SECOND FACTOR. `user_authenticator` (the TOTP
-- secret, encrypted), its retirement fact, the recovery-code set that substitutes
-- for it, the single use of one code, and the recovery nomination a shop makes at
-- registration. Docs: 048 §4.1, §4.2 (R18), §4.3 (R19), §8.1 (R20), §8.2, §9.1,
-- §10.1; 050 §2 Q2 / §4 (the rotation idiom this file borrows for `key_version`);
-- 041 §9.2 item 4, 034 §4.2; 044 §2 (expand only) and §7.
--
-- WHAT IS NOT HERE, AND IT IS THE FIRST THING A READER SHOULD KNOW. `user_credential`
-- — 048 §4.1's FIRST factor, email + password — is M3's other remainder and is NOT in
-- this file. 048 §4.1 puts the second factor in "a session established by password +
-- TOTP", and 048 §3.1 models exactly two sessions, both bound to an enrolled device:
-- there is no row shape in this schema for a person on their own laptop. So this
-- migration lands the factor and its custody, and the session that carries it is a
-- separate, named piece of work (000-docs/048 §12.4 row 3a, added by this bead). A
-- table that stores a second factor is useful the moment a first factor exists; a
-- third session kind invented by a build agent against a ratified record is not.
--
-- ⚠ THE ENCRYPTION IS SPECIFIED, NOT DESCRIBED (048 R18). "Encrypted at rest" is
-- not a specification, so every clause below is one, and each is here because its
-- absence is a known failure:
--
--   * **AES-256-GCM, an AEAD** — an unauthenticated ciphertext in a database is
--     malleable by anyone who can write to the database, and the failure is silent.
--   * **A fresh random nonce per row, in its own column** — GCM nonce reuse under
--     one key is catastrophic rather than degrading.
--   * **The row's `id` as additional authenticated data** — a TOTP secret's whole
--     meaning is *whose second factor this is*. A ciphertext lifted from one row and
--     pasted into another must FAIL TO AUTHENTICATE rather than decrypt to a working
--     secret. This is why `id` is supplied by the application on INSERT rather than
--     defaulted here: the AAD has to be known before the ciphertext is computed.
--   * **`key_version smallint NOT NULL` from day one** — a rotation with no version
--     column is a rotation that has to guess, per row. Two bytes now; a migration on
--     the table the incident is about, later. Decryption picks the key by THIS
--     column; the highest key present in the environment is what new rows encrypt
--     under; re-encrypting old rows is a later, fact-producing job with its own bead.
--     This is 050 §4's "liveness is a predicate, never a column" applied to a key.
--
-- THE ONE MUTABLE COLUMN IN THIS FILE, DECLARED AS SUCH. `user_authenticator` is a
-- CONFIG table (048 §10.1 lists it beside `user_credential` and `operator_pin`), and
-- `last_used_step` moves by the conditional UPDATE of 048 R19. 041 permits it under
-- 034 §4.2's split — "a record of something that happened is immutable; a statement
-- about the present is corrected in place" — and the argument is specific rather than
-- general: `last_used_step` is a MONOTONE REPLAY GUARD, not a fact. It says "the
-- highest step this authenticator has spent", which is a statement about the present;
-- it destroys no history, because 048 R16 rules that a SUCCESSFUL verification is
-- deliberately not recorded anywhere; and making it append-only would mean one row per
-- successful sign-in, which is precisely the per-operator sign-in log 022 P3 forbids
-- and R16 struck. The row is declared in `src/db/appendOnlyTables.ts` as an exemption
-- with that reason, so its mutability is a decision a reviewer can argue with rather
-- than an absence.
--
-- WHAT IS APPEND-ONLY HERE: the ENDING and the three ISSUANCE/USE facts —
-- `user_authenticator_retirement` (UNIQUE per authenticator), `recovery_code`,
-- `recovery_code_use` (UNIQUE per code — 048 §8.1's single use is a CONSTRAINT or it
-- is a race), and `shop_recovery_nomination`.
--
-- SHAPE: EXPAND ONLY, `CREATE TABLE IF NOT EXISTS`, re-runnable by hand.

BEGIN;

-- ---------------------------------------------------------------------------
-- 048 §4.2, §4.3 — the authenticator.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_authenticator (
  -- NO DEFAULT, deliberately. The application generates this uuid and binds it in
  -- as the AEAD's additional authenticated data before the INSERT, so a ciphertext
  -- is cryptographically tied to the row it sits in. A `DEFAULT gen_random_uuid()`
  -- would mean the id is not known until after the encryption, and the AAD would
  -- have to be something else — which is to say, nothing.
  id                 uuid PRIMARY KEY,
  app_user_id        uuid NOT NULL REFERENCES app_user(id),

  -- 048 §4.2's closed enum with ONE member today. Passkeys are the correct end
  -- state and are an ADDITIVE later decision with its own record — never a
  -- replacement that removes the recovery path §8 depends on.
  kind               text NOT NULL CHECK (kind IN ('totp')),

  -- AES-256-GCM. `secret_ciphertext` carries the ciphertext with the 16-byte GCM
  -- tag appended; `secret_nonce` is the 12 random bytes that row was sealed under
  -- and is never reused across rows.
  secret_ciphertext  bytea NOT NULL,
  secret_nonce       bytea NOT NULL,
  key_version        smallint NOT NULL CHECK (key_version >= 1),

  -- The TOTP parameters, stored rather than assumed: a verifier that reads its
  -- own constants cannot verify a secret enrolled under different ones, and the
  -- day `webauthn` or a longer period arrives, the rows already say which is which.
  -- Each is a CHECK with one member today for the same reason `kind` is.
  digits             smallint NOT NULL DEFAULT 6 CHECK (digits = 6),
  period_seconds     smallint NOT NULL DEFAULT 30 CHECK (period_seconds = 30),
  algorithm          text NOT NULL DEFAULT 'SHA1' CHECK (algorithm IN ('SHA1')),

  -- 048 R19. The replay guard, and the ONE mutable column in this migration. It
  -- moves ONLY by `UPDATE … WHERE id = $1 AND (last_used_step IS NULL OR
  -- last_used_step < $new)`, and the verification succeeds only if that statement
  -- affected exactly one row: zero rows affected means another transaction already
  -- consumed this step, and the answer is a refusal rather than a retry. **The
  -- database decides, not the application** — 041 §4.2(i)'s constraint-over-lock
  -- preference in its cheapest form, and the same shape 042 §5.3 uses for the
  -- idempotency key: the write IS the check.
  last_used_step     bigint,

  -- 048 §4.3: "a secret that is generated and never confirmed never becomes an
  -- authenticator row". So this column can only ever mean "confirmed at", and the
  -- row's existence is the enrollment fact.
  enrolled_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- 041 §2.3's envelope. 'human': a person enrolled this by presenting a code from
  -- the secret. ⚠ 048 §3.5's RULE binds here without amendment — this is an
  -- ATTRIBUTION OF RECORD and is never non-repudiable, never proof of who acted.
  authored_by        text NOT NULL DEFAULT 'human'
                       CHECK (authored_by IN ('human','system','provider'))
);
-- The liveness read (newest unretired authenticator for a person) and the anchor
-- lock both go through this.
CREATE INDEX IF NOT EXISTS user_authenticator_user_idx
  ON user_authenticator (app_user_id, enrolled_at DESC);

-- ---------------------------------------------------------------------------
-- The ending. 034 §2.7's grant/release idiom, for the fourth time in this schema
-- (`membership_revocation`, `device_credential_revocation`, `app_session_revocation`,
-- `operator_pin_retirement`) — and here the reason is 048 §8.1's: a recovery-code use
-- must RETIRE the factor it substituted for, and "why was this second factor taken
-- away" is exactly what a support conversation and 019 T35(c) ask. A nullable
-- `retired_at` on the row above would be an UPDATE on the row the verification
-- sequence anchors on, which is the mechanism 048 §3.5 rejected for `operator_pin`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_authenticator_retirement (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id      uuid NOT NULL REFERENCES app_user(id),
  authenticator_id uuid NOT NULL REFERENCES user_authenticator(id),
  -- A CLOSED set, because these are the endings the design has. `recovery_code_used`
  -- is 048 §8.1's forced re-enrollment expressed as a fact the login path reads as a
  -- predicate: after it there is no live authenticator, so the only thing the person
  -- can do is enrol a new one.
  reason           text NOT NULL CHECK (reason IN ('replaced','recovery_code_used',
                                                   'lost_authenticator','offboarding',
                                                   'compromise_suspected')),
  retired_by       uuid REFERENCES app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  authored_by      text NOT NULL DEFAULT 'human'
                     CHECK (authored_by IN ('human','system','provider'))
);
-- At most one ending per authenticator: the earlier row was never wrong, and there
-- is no replacement — a replacement is a NEW authenticator row.
CREATE UNIQUE INDEX IF NOT EXISTS user_authenticator_retirement_one_ending_idx
  ON user_authenticator_retirement (authenticator_id);

-- ---------------------------------------------------------------------------
-- 048 §8.1 — the recovery codes.
--
-- A code SUBSTITUTES FOR THE SECOND FACTOR ONLY (R20). It is never accepted without
-- the password, never on its own, and never in place of the password: a printed slip
-- in a drawer that could sign somebody in would be a single-factor bearer credential
-- for the owner account — strictly worse than the password it bypassed, because it is
-- written down by design and cannot be changed by the person who memorised it. The
-- FIRST-factor half of that rule is enforced where the first factor is; what this
-- schema enforces is that using one is a fact, that it can happen at most once, and
-- that the set is superseded rather than edited.
--
-- Hashed argon2id over `code ‖ pepper`, exactly as a PIN is (048 §9.2, R6) — the same
-- `LONGBOX_PIN_PEPPER`, deliberately, rather than a fourth secret nobody has a custody
-- story for. Losing it invalidates every PIN and every recovery code together, which
-- is one backup obligation instead of two.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recovery_code (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id    uuid NOT NULL REFERENCES app_user(id),
  -- 048 §8.1's "superseding set". Re-enrollment issues a NEW batch; a code is live
  -- only if its batch is the newest one for that person and it has no use row. So
  -- "re-enrollment retires every remaining code in the old set" is a PREDICATE over
  -- two facts — there is no per-code status to leave stale.
  batch_id       uuid NOT NULL,
  code_hash      text NOT NULL,
  pepper_version smallint NOT NULL DEFAULT 1,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  authored_by    text NOT NULL DEFAULT 'human'
                   CHECK (authored_by IN ('human','system','provider'))
);
CREATE INDEX IF NOT EXISTS recovery_code_user_idx ON recovery_code (app_user_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS recovery_code_batch_idx ON recovery_code (batch_id);

CREATE TABLE IF NOT EXISTS recovery_code_use (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES app_user(id),
  code_id     uuid NOT NULL REFERENCES recovery_code(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  authored_by text NOT NULL DEFAULT 'human'
                CHECK (authored_by IN ('human','system','provider')),
  -- 048 §8.1 and §7.1's shared rule: **single use is a constraint or it is a race.**
  -- Two concurrent redemptions of one code both read it as unused; the second INSERT
  -- is what fails, and it fails at the database.
  CONSTRAINT recovery_code_use_is_single_use UNIQUE (code_id)
);

-- ---------------------------------------------------------------------------
-- 048 §8.2 — the nomination a shop makes at registration.
--
-- "At shop registration the owner nominates either a second `owner`, or a named
-- recovery contact recorded on the shop … **It is nominated, not required.** A shop
-- that declines proceeds, and the decline is a fact rather than a blank field —
-- because the difference between *this owner has no second person* and *nobody asked*
-- is the difference between a known residual and a surprise during an outage."
--
-- It is a TABLE and not a column on `shop`, and the reading is deliberate: `shop` is
-- config, corrected in place, while a nomination has a WHEN and a WHO and is exactly
-- the kind of thing 034 §4.2 calls immutable. A shop that changes its mind appends a
-- second row; the newest row is the current answer.
--
-- ⚠ A NAMED CONTACT IS NOT A CREDENTIAL AND GRANTS NOTHING. It is the out-of-band
-- identity check E11-B09's break-glass runbook performs against, so that the
-- verification stops being "the person who emailed sounds right". Nothing in this
-- schema or in any code path reads it as authority.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_recovery_nomination (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES shop(id),
  kind          text NOT NULL CHECK (kind IN ('second_owner','named_contact','declined')),
  -- Present only for `named_contact`. A person's name and a note on how to reach
  -- them out of band; never a channel this system sends anything to, because 048
  -- §7.2 is explicit that no mailer exists and this bead does not invent one.
  contact_name  text,
  contact_note  text,
  nominated_by  uuid REFERENCES app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  authored_by   text NOT NULL DEFAULT 'human'
                  CHECK (authored_by IN ('human','system','provider')),
  CONSTRAINT shop_recovery_nomination_shape CHECK (
    (kind = 'named_contact' AND contact_name IS NOT NULL) OR
    (kind <> 'named_contact' AND contact_name IS NULL AND contact_note IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS shop_recovery_nomination_shop_idx
  ON shop_recovery_nomination (shop_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 048 §9.1 — one more failure method, so a recovery attempt is counted as itself.
--
-- WIDENING A CHECK IS AN EXPAND STEP (044 §2): the constraint accepts strictly more
-- than it did, every existing row still satisfies it, and no reader is compiled
-- against the narrower set. `020` reserved `password` and `totp` here already; only
-- `recovery_code` was missing, and folding it into `totp` would have made the two
-- failure classes indistinguishable in the one table that exists to tell them apart.
-- ---------------------------------------------------------------------------
ALTER TABLE auth_attempt DROP CONSTRAINT IF EXISTS auth_attempt_method_check;
ALTER TABLE auth_attempt DROP CONSTRAINT IF EXISTS auth_attempt_method_is_known;
ALTER TABLE auth_attempt ADD CONSTRAINT auth_attempt_method_is_known
  CHECK (method IN ('operator_pin','device_credential','session_token','password','totp',
                    'invitation','enrollment_code','recovery_code'));

-- The per-person window the TOTP and recovery-code lockouts read (048 §9.1: "per
-- `app_user_id` for a password"). `020`'s two indexes are both keyed on `device_id`
-- first, and neither of these attempts has a device.
CREATE INDEX IF NOT EXISTS auth_attempt_user_idx
  ON auth_attempt (app_user_id, method, created_at DESC);

-- ---------------------------------------------------------------------------
-- Append-only, `ENABLE ALWAYS` in the same breath (041 §9.2 item 1, 044 §7).
-- `user_authenticator` is NOT here: it is a declared exemption with its reason on
-- the row in `src/db/appendOnlyTables.ts` (048 §10.1's config/immutable split, and
-- the header above for why `last_used_step` is the one column that moves).
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_authenticator_retirement','recovery_code','recovery_code_use',
                           'shop_recovery_nomination'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;
