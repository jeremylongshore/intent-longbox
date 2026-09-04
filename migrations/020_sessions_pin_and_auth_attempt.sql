-- 020_sessions_pin_and_auth_attempt.sql — E03-D09 (bead longbox-e5b.3.16)
--
-- 048 §10.1's **M2**, plus the one M3 table the operator scope needs: the two
-- session chains, their ending, the PIN that opens an operator session, and the
-- failure log the lockout is derived from. Docs: 048 §3 (all), §3.5, §3.6, §9.1,
-- §9.2, §10.1, I3/I3a/I4/I9/I10; 041 R1/§3.2/§4.2; 042 §5.3; 034 §2.8; 044 §7.
--
-- THE SHAPE, IN ONE PARAGRAPH. A session is an append-only ISSUANCE FACT. There
-- is no `status`, no `active`, no `revoked` and no `last_seen_at` — 048 §3.3:
-- "liveness is derived". A session is live iff its row exists, no revocation
-- names its CHAIN, no successor supersedes it, and now is before both its
-- absolute and its idle expiry. Idle expiry is enforced by ROTATION rather than
-- by mutation: a request whose session is older than the rotation period issues
-- a NEW row chained by `rotated_from`, sets the new cookie, and leaves the old
-- row in place as spent. That is four properties of immutable rows where a
-- `last_seen_at` would be a write on the security-critical row in EVERY
-- transaction's write set — a serialization-failure source under 041 §4.5's
-- `40001` retry budget (048 §13.0 Q2).
--
-- `chain_id` IS WHY LIVENESS IS CONSTANT IN ROTATION DEPTH (048 §3.3, R2). It is
-- written once at the chain's first issuance and copied unchanged into every
-- successor; a revocation names a CHAIN, never a walk. Without it, "no successor
-- supersedes it" is a walk back up `rotated_from` on every request, and a phone
-- worked all day is a chain hundreds of rows long — a security check whose cost
-- grows with the shift is a security check that gets cached, and a cache of
-- liveness is the status column arriving through the side door.
--
-- ⚠ THREE COMPOSITE FOREIGN KEYS. Two of them are K5 and its device-chain
-- sibling (below); the third binds `parent_session_id` to `parent_chain_id`
-- so K4's closure cannot resolve a chain the parent does not belong to — see
-- the block above `app_session_parent_pair_is_one_fact`.
--
-- ⚠ TWO COMPOSITE FOREIGN KEYS, NOT ONE, AND THE SECOND IS NOT BELT-AND-BRACES.
-- 048 §10.1 (K5, from 041 R1) makes ONE mandatory:
--   FOREIGN KEY (rotated_from, app_user_id, device_id)
--     REFERENCES app_session (id, app_user_id, device_id)
-- so a rotation cannot change WHO the session is for or WHICH device it is on —
-- without it, a bug or a hostile write that chains one person's session onto
-- another's is a silent privilege transfer every liveness check would accept.
-- **But `app_user_id` is NULL on a DEVICE session** (a device session
-- authenticates an app instance, not a person — 048 §3.1), and a composite FK
-- under the default MATCH SIMPLE is **not checked at all when any referencing
-- column is NULL**. So on the device chain — the longer-lived of the two, the one
-- a stolen phone rides — K5's constraint would be inert. `MATCH FULL` does not
-- rescue it: it refuses a mixed null/non-null key outright, so no device
-- successor could be inserted. The answer is a SECOND composite FK whose columns
-- are never NULL:
--   FOREIGN KEY (rotated_from, device_id) REFERENCES app_session (id, device_id)
-- K5 is landed exactly as ratified AND the device chain is covered. The cost is
-- one extra unique index. **This is a finding about K5's expressibility, not a
-- weakening of it**, and it is recorded here rather than in a commit message
-- because the next reader of 048 §10.1 will otherwise wonder why there are two.
--
-- SHAPE: EXPAND ONLY, `CREATE TABLE IF NOT EXISTS`, re-runnable by hand.

BEGIN;

-- ---------------------------------------------------------------------------
-- 048 §3 — the two session chains.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_session (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 048 R2. Generated at the chain's first issuance, copied unchanged into every
  -- successor, never updated (the table is append-only, so "never updated" is
  -- enforced rather than intended — I4 asserts it).
  chain_id             uuid NOT NULL,

  kind                 text NOT NULL CHECK (kind IN ('device','operator')),

  -- locked decision 4. On a DEVICE session these come from the enrollment; on an
  -- OPERATOR session they are DENORMALIZED FROM THE PARENT AT ISSUANCE (048 §3.5,
  -- K4) — immutable facts about an issuance, not a cache of a mutable elsewhere,
  -- so a parent rotation is harmless to tenancy resolution and §6.1 never chases
  -- a pointer into a spent parent.
  shop_id              uuid NOT NULL REFERENCES shop(id),
  location_id          uuid NOT NULL REFERENCES location(id),
  device_id            uuid NOT NULL REFERENCES device(id),
  device_credential_id uuid NOT NULL REFERENCES device_credential(id),

  -- NULL on a device session: the device principal is not a person (048 §3.1).
  app_user_id          uuid REFERENCES app_user(id),

  -- The operator session sits ON TOP of a device session. `parent_chain_id` is
  -- carried beside `parent_session_id` so the parent's CURRENT head resolves in
  -- ONE indexed read (048 §3.5's successor closure "resolved by chain_id"); the
  -- named row itself goes spent at the parent's next rotation, and chasing it
  -- would kill every operator session on the phone once per rotation period.
  parent_session_id    uuid REFERENCES app_session(id),
  parent_chain_id      uuid,

  -- 048 §3.2: the browser holds an opaque 256-bit token; the database stores
  -- `sha256(token)` and never the token. SHA-256 and not a slow KDF **because
  -- the input's entropy, not the output's sensitivity, is what decides**: there
  -- is no dictionary for a 256-bit machine-generated secret, offline guessing is
  -- not the threat model, and a per-request KDF is a denial-of-service surface
  -- whose rate the attacker sets. The PIN gets argon2id (below) for the mirror
  -- reason.
  token_hash           text NOT NULL UNIQUE,

  -- 048 §3.3: UNIQUE, for 041 R2's reason — a session is superseded at most
  -- once, so the chain is a chain and never a fork, and a second successor is
  -- precisely what a token-theft race looks like. The constraint IS the detector.
  rotated_from         uuid UNIQUE REFERENCES app_session(id),

  issued_at            timestamptz NOT NULL DEFAULT now(),
  -- Computed at issuance and never corrected (048 §3.3 point 1). `rotate_after`
  -- is when the NEXT request re-issues; `idle_expires_at` is when a session that
  -- is not used again simply expires.
  rotate_after         timestamptz NOT NULL,
  idle_expires_at      timestamptz NOT NULL,
  absolute_expires_at  timestamptz NOT NULL,

  -- 041 §2.3's envelope. An issuance is a system act: the server mints it, even
  -- when a person's PIN caused it (the person's act is the `auth_attempt`
  -- absence and the operator session's existence, not the row's authorship).
  authored_by          text NOT NULL DEFAULT 'system'
                         CHECK (authored_by IN ('human','system','provider')),

  -- 048 §3.1 / §3.5, as constraints rather than as prose: a device session has no
  -- person and no parent; an operator session has both, and its parent chain is
  -- named so K4's formula has something to read.
  CONSTRAINT app_session_kind_shape CHECK (
    (kind = 'device'   AND app_user_id IS NULL     AND parent_session_id IS NULL
                       AND parent_chain_id IS NULL) OR
    (kind = 'operator' AND app_user_id IS NOT NULL AND parent_session_id IS NOT NULL
                       AND parent_chain_id IS NOT NULL)
  ),
  -- A chain cannot be its own successor.
  CONSTRAINT app_session_rotation_is_not_self CHECK (rotated_from IS DISTINCT FROM id),
  -- The redundant unique targets that make the three composite FKs below
  -- expressible (041 R1's own construction).
  CONSTRAINT app_session_scope_target UNIQUE (id, app_user_id, device_id),
  CONSTRAINT app_session_device_target UNIQUE (id, device_id),
  CONSTRAINT app_session_chain_target UNIQUE (id, chain_id)
);

-- 041 R1 / 048 K5 — MANDATORY, not preferred: "a non-waivable T24 boundary may
-- not sit behind a mechanism §9 exists because it is bypassable". A trigger has
-- a `tgenabled`; a foreign key does not.
ALTER TABLE app_session DROP CONSTRAINT IF EXISTS app_session_rotation_keeps_its_principal;
ALTER TABLE app_session ADD CONSTRAINT app_session_rotation_keeps_its_principal
  FOREIGN KEY (rotated_from, app_user_id, device_id)
  REFERENCES app_session (id, app_user_id, device_id);

-- The device-chain half of the same rule, total because neither column is ever
-- NULL. See the header: MATCH SIMPLE leaves the constraint above unchecked on a
-- device session, which is exactly the chain a stolen phone rides.
ALTER TABLE app_session DROP CONSTRAINT IF EXISTS app_session_rotation_keeps_its_device;
ALTER TABLE app_session ADD CONSTRAINT app_session_rotation_keeps_its_device
  FOREIGN KEY (rotated_from, device_id) REFERENCES app_session (id, device_id);

-- THE PARENT PAIR IS ONE FACT, NOT TWO COLUMNS (invariant review of `c997ae4`).
--
-- `parent_chain_id` is carried beside `parent_session_id` so K4's successor
-- closure resolves in one indexed read. Nothing above stops the two disagreeing:
-- a row naming session A as its parent and chain B's id would insert cleanly,
-- and the closure would then resolve **the wrong device chain** — which is a
-- silent cross-device authorisation, exactly the class K5's composite FK exists
-- to make unconstructible for a rotation. The same construction closes it:
--
--   FOREIGN KEY (parent_session_id, parent_chain_id) REFERENCES app_session (id, chain_id)
--
-- Both columns are NOT NULL together on an operator row and NULL together on a
-- device row (the `app_session_kind_shape` CHECK above makes any other pairing
-- unrepresentable), so MATCH SIMPLE is TOTAL here rather than skipped — unlike
-- K5's, which is why that one needed a device-only sibling.
ALTER TABLE app_session DROP CONSTRAINT IF EXISTS app_session_parent_pair_is_one_fact;
ALTER TABLE app_session ADD CONSTRAINT app_session_parent_pair_is_one_fact
  FOREIGN KEY (parent_session_id, parent_chain_id) REFERENCES app_session (id, chain_id);

-- The three indexes the liveness predicate reads (048 §3.3): the token lookup is
-- the UNIQUE above; the successor probe is the `rotated_from` UNIQUE above; the
-- chain head resolves here.
CREATE INDEX IF NOT EXISTS app_session_chain_idx ON app_session (chain_id);
-- 048 §3.4 (K3): the membership write locks every live session of the affected
-- person, across every shop and both chains, in `chain_id` order.
CREATE INDEX IF NOT EXISTS app_session_user_idx ON app_session (app_user_id, chain_id);
-- K4's cross-chain closure: every operator session hanging off a device chain.
CREATE INDEX IF NOT EXISTS app_session_parent_chain_idx ON app_session (parent_chain_id);

-- ---------------------------------------------------------------------------
-- 048 §3.3 — the ending. Keyed on `chain_id`, NOT on `session_id`.
--
-- Revoking one row in the middle of a live chain was never a thing this system
-- needed to express; "this chain ended" is the fact anybody ever wanted to
-- record, and keying on the chain makes revocation O(1) instead of O(chain).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_session_revocation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shop(id),
  chain_id    uuid NOT NULL,
  -- Why the chain ended. A CLOSED set, because these are the causes the design
  -- has: a person signed out, a token was replayed after its successor was
  -- issued (048 §3.3 point 3), a membership changed (§3.4), or a device
  -- credential was revoked (§7.3).
  reason      text NOT NULL CHECK (reason IN ('signed_out','token_reuse','membership_change',
                                              'device_revoked','operator_switch')),
  revoked_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  authored_by text NOT NULL DEFAULT 'system'
                CHECK (authored_by IN ('human','system','provider'))
);
-- 034 §2.7's grant/release idiom: at most one ending per chain.
CREATE UNIQUE INDEX IF NOT EXISTS app_session_revocation_chain_idx
  ON app_session_revocation (chain_id);

-- ---------------------------------------------------------------------------
-- 048 §3.5, §9.1, §9.2 — the PIN, and the row the lockout anchors on.
--
-- CONFIG, MUTABLE (048 §10.1): a PIN is changed in place, and versioning the
-- hash would keep every old PIN's hash forever, which is a liability rather than
-- an audit trail. Its CHANGES are facts elsewhere (a failure is an
-- `auth_attempt` row; a successful change is E03-D06's).
--
-- IT IS ALSO THE LOCKOUT ANCHOR (048 §9.1, R5). "Derive the lockout, then
-- verify" is a read-then-write across a security boundary, and it is the
-- write-skew shape 041 §4.2 named: N concurrent attempts all read a count below
-- the threshold, all proceed, and the effective budget is N times the intended
-- one. The verification sequence takes `SELECT … FOR UPDATE` on THIS row before
-- counting and holds it through the verify and the failure INSERT — every reader
-- of the count is a writer of the row the count is about.
--
-- `UNIQUE (device_id, app_user_id)` is what makes that anchor exist at all: one
-- row per pair, so there is exactly one thing to lock.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operator_pin (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shop(id),
  device_id      uuid NOT NULL REFERENCES device(id),
  app_user_id    uuid NOT NULL REFERENCES app_user(id),
  -- argon2id over `pin ‖ pepper`, encoded. The pepper is read from the process
  -- environment at boot and is NEVER in this database, in a migration, in a
  -- fixture or in a backup of this database (048 §9.2, R6). For a six-digit PIN
  -- it is close to load-bearing: a million-entry keyspace is enumerable offline
  -- against argon2id in time that is merely expensive, and §3.5's whole
  -- "possession-bound channel" argument evaporates the moment the verification
  -- can be done offline — because a `pg_dump` is not a phone behind a counter.
  pin_hash       text NOT NULL,
  -- 048 §9.2: peppering is VERSIONED, the same construction §4.2 gives the
  -- authenticator key. A rotation re-peppers each credential at its next
  -- successful verification rather than by a mass rewrite of a table nobody can
  -- decrypt.
  pepper_version smallint NOT NULL DEFAULT 1,
  -- 048 §3.5 (RECOMMENDED, adopted): a membership revocation RETIRES that
  -- person's PIN rows at that scope, in the same transaction as §3.4's rotation.
  -- Otherwise a fired employee's PIN sits live on the counter phone against a
  -- membership that no longer exists, and the only thing between it and an
  -- operator session is a membership check somebody has to remember to write.
  retired_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_pin_one_row_per_pair UNIQUE (device_id, app_user_id)
);
CREATE INDEX IF NOT EXISTS operator_pin_device_idx ON operator_pin (device_id);

-- ---------------------------------------------------------------------------
-- 048 §9.1 — attempts are FACTS, and only failures are facts worth keeping.
--
-- FAILURES ONLY (R16). v1.0.0 of 048 recorded successes too, "because T35(c)'s
-- reconciliation needs both sides", and that was false on its own terms: T35(c)
-- reconciles Longbox-origin SESSIONS against break-glass grants, and the session
-- table is `app_session`, which is append-only and records every issuance. A
-- success row here would be a second, redundant record of the same event,
-- differing only in being a per-operator log of when each person signed in —
-- which is the surface 022 P3 forbids, built to satisfy a reconciliation that
-- does not need it.
--
-- SUBSTRATE, NOT SURFACE (R17). This table is read ONLY by (i) the lockout
-- derivation, for exactly one `(device_id, app_user_id)` pair, in the request
-- authenticating that pair, or (ii) an audited break-glass query. Any read in
-- which an operator identifier is a DIMENSION — a GROUP BY, an ORDER BY, a
-- filter parameter, a view column, a count over more than one pair — is a
-- surface, and building one is an architecture-gate failure rather than a review
-- finding. It takes the shortest retention window in the system (E03-B09).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_attempt (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULLABLE, and the reason is stated rather than assumed. Every attempt this
  -- bead can record IS shop-scoped (a PIN and a device credential both name a
  -- device, which names a shop). The column is nullable because E03-D06's
  -- privileged sign-in — email + password + TOTP — has no shop until the
  -- membership is resolved, and a NOT NULL here would force that bead either to
  -- invent a shop or to add a second table. Locked decision 4 scopes shop DATA;
  -- a failed sign-in by a person who may hold memberships at three shops is not
  -- one shop's data.
  shop_id       uuid REFERENCES shop(id),
  device_id     uuid REFERENCES device(id),
  app_user_id   uuid REFERENCES app_user(id),
  method        text NOT NULL CHECK (method IN ('operator_pin','device_credential','session_token',
                                                'password','totp','invitation','enrollment_code')),
  -- 048 §9.3: every failure answers the same thing on the wire. The CLASS is
  -- kept here, where only the lockout derivation and break-glass can read it,
  -- precisely so the response can stay constant.
  failure_class text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  authored_by   text NOT NULL DEFAULT 'system'
                  CHECK (authored_by IN ('human','system','provider'))
);
-- The per-pair window count (048 §9.1) and the per-device ceiling above it —
-- without the second, an attacker holding the phone walks the roster and gets a
-- fresh budget for each of eight display names.
CREATE INDEX IF NOT EXISTS auth_attempt_pair_idx
  ON auth_attempt (device_id, app_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_attempt_device_idx
  ON auth_attempt (device_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Append-only, `ENABLE ALWAYS` in the same breath (041 §9.2 item 1, 044 §7).
-- `operator_pin` is NOT here: it is a declared exemption with its reason on the
-- row in `src/db/appendOnlyTables.ts` (048 §10.1's config/immutable split).
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_session','app_session_revocation','auth_attempt'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;
