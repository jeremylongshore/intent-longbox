-- 024_invitations_and_device_enrollment.sql — E03-D07 (bead longbox-e5b.3.18)
--
-- 048 §10.1's **M4, the invitation and enrollment half**: the two ways a shop
-- gains a person and a phone, and the retirement fact that takes a person's PIN
-- away again. Docs: 048 §7 in full (§7.1, §7.1a, §7.2, §7.3), §3.5, §9.1, §9.3,
-- I12; 041 §2.3 (the authorship envelope), §9.2 (declared triggers, declared
-- exemptions); 034 §2.7 (grant/release), §2.8 (the device principal);
-- 000-docs/044 §2, §7 (expand-only, idempotent shape); R14, R15.
--
-- WHAT M4 ASKED FOR AND WHAT IS HERE. 048 §10.1 M4 lists five tables:
-- `invitation`, `invitation_acceptance`, `device_enrollment_code`,
-- `device_enrollment_code_use` and `auth_attempt`. **`auth_attempt` already
-- exists** — `020` built it with `invitation` and `enrollment_code` already in
-- its `method` CHECK, for this file. So four of M4's five land here, plus one
-- table M4 does not name and §3.5 requires: `operator_pin_retirement`.
--
-- **`invitation_use`, not `invitation_acceptance`.** 048 §7.1a names the
-- enrollment table `device_enrollment_code_use` and the invitation table
-- `invitation_acceptance`, and the two are the SAME object under two nouns —
-- "the single fact that this token was spent". One noun for one shape is worth
-- more than fidelity to two, and the constraint 048 actually legislates
-- (`UNIQUE (invitation_id)`) is spelled here exactly as written. The rename is
-- recorded in the 048 amend-by-a-row this bead carries, not hidden in a file.
--
-- ============================================================================
-- SINGLE-USE IS A CONSTRAINT OR IT IS A RACE (048 §7.1)
-- ============================================================================
--
-- Neither `invitation` nor `device_enrollment_code` carries a `status`, a
-- `used`, a `spent`, a `redeemed_at` or an `is_active`. **A status column on an
-- invitation is a column two concurrent redemptions can both read as
-- `pending`**; a UNIQUE index on the use table makes the second one a failed
-- INSERT the database decides. Both use tables carry it — `UNIQUE (invitation_id)`
-- and `UNIQUE (code_id)` — because 048 §7.1a is explicit that "one-time" in
-- prose is the status column §7.1 refused, wearing an adjective.
--
-- Expiry is the same rule one step further out: `expires_at` is an ISSUANCE
-- fact, fixed when the row is written and never touched again, and "is this
-- expired" is a predicate over it (041 §2.4). Nothing anywhere marks a token
-- expired.
--
-- ============================================================================
-- NO TOKEN VALUE IS IN THIS SCHEMA, IN ANY FORM (048 §7.1, I9)
-- ============================================================================
--
-- `token_digest` and `code_digest` hold `sha256(normalised code)` in hex and
-- NOTHING ELSE. There is no column for the code, no column for a prefix of it,
-- no column for a "hint" and no column for a last-four — every one of those is a
-- reduced-keyspace copy of the credential sitting beside its own digest. The
-- code exists in exactly two places for exactly as long as it takes to cross a
-- counter: the response body of the issuing call, once, and the employee's hand.
--
-- The digest is UNIQUE because it is the lookup key, and a collision would be
-- two invitations with one identity.
--
-- ============================================================================
-- WHY THE ENTROPY DIFFERS BETWEEN THE TWO TABLES, AND WHERE THAT IS ENFORCED
-- ============================================================================
--
-- 048 §7.1a permits a SHORT human-readable code **only** with the device binding
-- and a per-shop ceiling, and requires 128 bits otherwise. The two tables get
-- different answers because the binding is available to one and structurally
-- unavailable to the other:
--
--   * an INVITATION is redeemed on a phone that is ALREADY enrolled at the shop
--     the invitation names (R15), so the binding holds and a short code is
--     permitted — this build takes it, because a 26-character token typed on a
--     counter phone is a token that gets photographed instead;
--   * an ENROLLMENT CODE is redeemed by the phone BEING ENROLLED, which by
--     construction holds no session at all. The binding cannot hold, so §7.1a's
--     "a short code without both is refused" applies and the code is 128 bits,
--     pasted or scanned.
--
-- **The schema does not enforce entropy and cannot** — a digest is 64 hex
-- characters whatever went into it. The lengths, the alphabet and the per-shop
-- ceilings live in `src/services/auth/codes.ts` and `policy.ts`, and the
-- decision is recorded in 000-docs/006 and in the 048 amend-by-a-row. This
-- comment exists so the next reader of the two tables does not conclude the
-- difference was an accident.
--
-- ============================================================================
-- `operator_pin_retirement`, AND WHY IT IS A TABLE RATHER THAN A COLUMN
-- ============================================================================
--
-- 048 §3.5 requires that a membership revocation RETIRES that person's PIN rows
-- at that scope. `020` gave `operator_pin` a nullable `retired_at` for it, and
-- this file replaces that mechanism with an append-only fact for the reason
-- 041 and 047 §5.1 give every other retirement in this schema — `membership`
-- has `membership_revocation`, `device_credential` has
-- `device_credential_revocation`, `app_session` has `app_session_revocation`,
-- each with its own UNIQUE — and for one reason specific to this row:
--
--   **`operator_pin` is the lockout anchor** (048 §9.1). Every PIN verification
--   takes `SELECT … FOR UPDATE` on it. A retirement performed as an `UPDATE`
--   writes the security-critical anchor row on a path that is not a PIN
--   verification, and it destroys the only record of WHEN and WHY the PIN was
--   taken away — which is exactly the audit line 019 T35(c) reconciles against.
--
-- `retired_at` IS NOT DROPPED. 000-docs/044 §2 makes a `DROP COLUMN` a
-- contracting statement needing a `-- contract:` header and a 006 row, and this
-- file retires no migration. The column stays, is written by nothing after this
-- bead, and the liveness predicate reads BOTH — a retirement fact OR a non-null
-- `retired_at` retires the PIN — so a row written by the old mechanism before
-- this migration is still honoured. Dropping it is a one-line contract step for
-- whoever next needs it and buys no guarantee this file lacks.
--
-- **The UNIQUE is `(operator_pin_id, retired_pin_updated_at)` and not
-- `(operator_pin_id)`**, and that is the one place this table differs from its
-- three siblings. A membership can be revoked, and the same person can later be
-- re-hired and given a new PIN on the same phone — which is one `operator_pin`
-- row (it is UNIQUE per `(device_id, app_user_id)`) with a new `updated_at`. A
-- bare `UNIQUE (operator_pin_id)` would make the second retirement impossible
-- and leave a re-hired-then-fired employee's PIN live forever. So the retirement
-- names the VERSION of the row it retires — the `updated_at` it read under the
-- anchor lock — and liveness is "no retirement row names my current
-- `updated_at`". Two concurrent retirements of the same version collapse into
-- one row by the UNIQUE, which is the idempotence a status column cannot give.
--
-- ============================================================================
-- AUTHORSHIP, AND THE WORD THAT MAY NOT BE USED
-- ============================================================================
--
-- Every table here carries 041 §2.3's `authored_by` envelope. Issuing an
-- invitation, redeeming one and enrolling a phone are HUMAN acts and default to
-- `'human'`; a PIN retirement is written by the server as a consequence of a
-- human's revocation and defaults to `'system'`.
--
-- 048 §3.5's RULE binds this file as it binds `pin.ts`: **no artifact, dissent,
-- 021 registered claim, pilot-charter clause, partner-facing sentence or support
-- answer may describe attribution in this system as non-repudiable, as
-- tamper-proof, or as proof of who performed an act.** A redemption row records
-- that a code was spent from a phone; a person who watched the code being handed
-- over and reached the phone first would produce the same row.
--
-- ============================================================================
-- NO REAL NAMES, ANYWHERE (048 §7.1's section header, which means it)
-- ============================================================================
--
-- No shop's name, no employee's name and no code from anywhere real appears in
-- this file, in the fixtures it implies, or in any test that exercises it. An
-- invitation flow is exactly the surface on which a "realistic" example becomes
-- a person's name in a repository.
--
-- SHAPE: EXPAND ONLY, `CREATE TABLE IF NOT EXISTS` / `DROP … IF EXISTS` first,
-- re-runnable by hand (000-docs/044 §2, §7).

BEGIN;

-- ---------------------------------------------------------------------------
-- 048 §7.1 — an invitation: a shop, a person, a role, an inviter and an expiry.
-- IMMUTABLE. Its ending is `invitation_use`, never an edit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shop(id),   -- locked decision 4
  -- THE INVITATION NAMES THE PERSON, and the bearer never names themselves.
  --
  -- 048 §7.2's flow is that the owner hands a code across the counter to an
  -- employee whose face they know. The owner therefore already knows who the
  -- person is at ISSUANCE, and binding the row to an `app_user` at that moment
  -- costs nothing and buys the property that matters: a code overheard, or
  -- photographed off the owner's screen, grants a membership to THE PERSON IT
  -- WAS WRITTEN FOR and to nobody else. The alternative — a redemption body
  -- carrying a display name — would let whoever holds the code decide who they
  -- are, which is an identity claim from an unauthenticated party.
  --
  -- It also means redemption writes no `app_user` row, so the redemption
  -- transaction touches identity only through the membership it grants.
  app_user_id    uuid NOT NULL REFERENCES app_user(id),
  -- 034 §2.6's four roles minus one. `support_break_glass` is NEVER invitable:
  -- 034 §2.6 says it "is never granted at ratification and never grants itself"
  -- and 022 P7 says there is no invisible super-admin — a code that could mint
  -- one is exactly the quieter second path 048 §8.2 refuses to build.
  role           text NOT NULL CHECK (role IN ('owner','manager','operator')),
  scope_kind     text NOT NULL DEFAULT 'shop' CHECK (scope_kind IN ('shop','location')),
  location_id    uuid REFERENCES location(id),
  -- `sha256(normalised code)`, hex. The code itself is in no column here and in
  -- no column anywhere; see the header.
  token_digest   text NOT NULL UNIQUE,
  -- An ISSUANCE fact. Nothing marks a row expired; "expired" is a predicate.
  expires_at     timestamptz NOT NULL,
  invited_by     uuid NOT NULL REFERENCES app_user(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  authored_by    text NOT NULL DEFAULT 'human'
                   CHECK (authored_by IN ('human','system','provider')),

  CONSTRAINT invitation_scope_is_whole CHECK (
    (scope_kind = 'shop'     AND location_id IS NULL) OR
    (scope_kind = 'location' AND location_id IS NOT NULL)
  ),
  -- An invitation that expires before it is issued is not a short window; it is
  -- a row that can never be redeemed and never says so. Refuse it at the schema
  -- rather than discover it at the counter.
  CONSTRAINT invitation_expires_after_it_is_issued CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS invitation_shop_idx ON invitation (shop_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 048 §7.1 — the redemption. **`UNIQUE (invitation_id)` is the whole mechanism**:
-- single-use is this index or it is a race.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invitation_use (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL REFERENCES shop(id),
  invitation_id         uuid NOT NULL REFERENCES invitation(id),
  -- 048 §7.1: "Acceptance grants the membership in the same transaction." The
  -- FK is NOT NULL so the two cannot come apart: there is no state in which a
  -- code is spent and no membership exists.
  membership_id         uuid NOT NULL REFERENCES membership(id),
  -- R15's binding, RECORDED and not merely checked. The device and the session
  -- that redeemed it are part of the fact, because "which phone was this
  -- redeemed on" is the question a support conversation about a suspected
  -- overheard code opens with, and a check that leaves no row cannot answer it.
  redeemed_on_device_id  uuid NOT NULL REFERENCES device(id),
  redeemed_on_session_id uuid NOT NULL REFERENCES app_session(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  authored_by           text NOT NULL DEFAULT 'human'
                          CHECK (authored_by IN ('human','system','provider'))
);
CREATE UNIQUE INDEX IF NOT EXISTS invitation_use_invitation_idx
  ON invitation_use (invitation_id);

-- ---------------------------------------------------------------------------
-- 048 §7.3 — the enrollment code. An owner or manager creates it; the phone
-- posts it once and receives a device session.
--
-- It carries the `device` row's fields rather than pointing at one, because the
-- device DOES NOT EXIST until the code is redeemed: an issued-but-unredeemed
-- code that had already written a `device` row would leave a phantom phone in
-- the shop's inventory for every code an owner issued and never used.
-- 034 I7 makes `device.location_id` NOT NULL, so the code names a location or
-- there is nothing to enroll.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_enrollment_code (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES shop(id),
  location_id  uuid NOT NULL REFERENCES location(id),
  device_label text NOT NULL,
  device_kind  text NOT NULL CHECK (device_kind IN ('phone','kiosk','tablet')),
  -- `sha256(normalised code)`, hex, over 128 bits of CSPRNG output. The entropy
  -- is the service's to enforce; see the header for why it is higher here than
  -- for an invitation.
  code_digest  text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  issued_by    uuid NOT NULL REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  authored_by  text NOT NULL DEFAULT 'human'
                 CHECK (authored_by IN ('human','system','provider')),
  CONSTRAINT device_enrollment_code_expires_after_it_is_issued CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS device_enrollment_code_shop_idx
  ON device_enrollment_code (shop_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 048 §7.1a — "`device_enrollment_code_use` carries `UNIQUE (code_id)`, exactly
-- as `invitation_acceptance` carries `UNIQUE (invitation_id)`."
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_enrollment_code_use (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              uuid NOT NULL REFERENCES shop(id),
  code_id              uuid NOT NULL REFERENCES device_enrollment_code(id),
  -- Both NOT NULL: the phone and its credential are written in the same
  -- transaction as this row (048 §7.3), so a spent code with no device is not a
  -- state this schema can hold.
  device_id            uuid NOT NULL REFERENCES device(id),
  device_credential_id uuid NOT NULL REFERENCES device_credential(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  authored_by          text NOT NULL DEFAULT 'human'
                         CHECK (authored_by IN ('human','system','provider'))
);
CREATE UNIQUE INDEX IF NOT EXISTS device_enrollment_code_use_code_idx
  ON device_enrollment_code_use (code_id);

-- ---------------------------------------------------------------------------
-- 048 §3.5 — the PIN retirement, as a fact. See the header for why this is a
-- table and not the `retired_at` column `020` added.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operator_pin_retirement (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                  uuid NOT NULL REFERENCES shop(id),
  operator_pin_id          uuid NOT NULL REFERENCES operator_pin(id),
  -- The VERSION of the anchor row this retirement is about, read under the
  -- anchor's own `FOR UPDATE` lock. See the header: it is what lets a re-hired
  -- person's new PIN be retired a second time.
  retired_pin_updated_at   timestamptz NOT NULL,
  -- Nullable, because §3.5 is not the only reason to retire a PIN — an owner
  -- retiring a lost phone's PINs is the other — but a retirement CAUSED by a
  -- revocation names it, so the two facts are one chain rather than two rows
  -- with a similar timestamp.
  membership_revocation_id uuid REFERENCES membership_revocation(id),
  -- NOT NULL and unconstrained by an enum: this is the column a support
  -- conversation reads, and a closed list here would be a list somebody extends
  -- with 'other' the first time reality does not fit.
  reason                   text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  -- 'system': the server writes this row as a consequence of a person's
  -- revocation, and that person is named by `membership_revocation.revoked_by`.
  authored_by              text NOT NULL DEFAULT 'system'
                             CHECK (authored_by IN ('human','system','provider'))
);
CREATE UNIQUE INDEX IF NOT EXISTS operator_pin_retirement_version_idx
  ON operator_pin_retirement (operator_pin_id, retired_pin_updated_at);

-- ---------------------------------------------------------------------------
-- Append-only, and `ENABLE ALWAYS` in the same breath (041 §9.2 item 1, 044 §7).
-- `CREATE TRIGGER` always lands at the bypassable 'O' default and the gate-test
-- asserts 'A' for every declared trigger, so forgetting this is a red build
-- rather than a silent hole. The declared set is `src/db/appendOnlyTables.ts`.
--
-- All five, with no exemption. Every one of them is a thing that HAPPENED — a
-- code was issued, a code was spent, a PIN was taken away — and none is a
-- statement about the present that gets corrected.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invitation','invitation_use','device_enrollment_code','device_enrollment_code_use',
    'operator_pin_retirement'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;
