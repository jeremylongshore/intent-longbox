-- 026_connector_oauth.sql — E03-B06 (bead longbox-e5b.3.6)
--
-- The connector's authorization lifecycle, as facts. Docs: 000-docs/053 §3–§7
-- (the custody ruling and the lifecycle); 050 §2 Q2 / §4 (the two-fact rotation
-- idiom this file borrows), §8's G-14 row (which hands the connector token's
-- provider-side lifecycle to THIS bead and models none of it); 048 §4.2 / R18
-- (the AEAD envelope, per-row nonce, row id as AAD, `key_version` from day one);
-- 041 §2.3 (the authorship envelope), §2.5 (external observation), §8 (an ending
-- is an appended fact and its receipt); 042 §5.1 (the exemption class the
-- webhook route sits in); 046 §6.2 G-14, §5 A14; 044 §2, §7 (expand only,
-- re-runnable by hand); CLAUDE.md locked decisions 2, 3 and 4.
--
-- ============================================================================
-- WHAT THIS REPLACES, AND WHY IT IS NOT A `shop_credentials` KIND
-- ============================================================================
--
-- Today a shop's Shopify authority is a STATIC admin token named by
-- `shop_credentials.key_ref` and resolved out of the process environment
-- (`src/providers/registry.ts`'s `resolveShopToken`). 046 G-14 records the
-- defect in four words — *no OAuth lifecycle, no revocation* — and 050 §8's
-- G-14 row hands it here, saying in its own terms that *"a connector token has a
-- provider-side lifecycle this record deliberately does not model"*.
--
-- **It is a separate table set and not a sixth `kind`, and the reason is a
-- column.** `shop_credential_version` exists so that a rotation is two facts and
-- liveness is a predicate; its whole discipline is that it holds a NAME and
-- never a value — `src/providers/credentialVersions.ts` says so in its header
-- and means it. A connector token cannot be a name: nobody types it, it is
-- minted by Shopify mid-request and handed to this server once. Adding a
-- nullable ciphertext column to that table would put a value in the one table
-- built to hold none, and would make every reader ask which of the two shapes a
-- row is. Two shapes, two tables, and 053 §4 is where that is argued rather
-- than assumed.
--
-- ============================================================================
-- THE TOKEN IS AEAD CIPHERTEXT IN A COLUMN, AND THAT IS A RULING, NOT A DRIFT
-- ============================================================================
--
-- 050 §2 Q1 REJECTS an encrypted column for a BYOK provider key and closes that
-- question. **This file does not reopen it.** 053 §3 rules on the DIFFERENT
-- question 050 §13 item 3 handed to this bead, and the ruling turns on two
-- predicates a BYOK key fails and a Shopify OFFLINE token satisfies:
--
--   (i)  **It is minted by the machine.** No human is in its custody path, so
--        the SOPS→tmpfs→environment path 050 §3 rules for a key somebody types
--        cannot carry it: the value exists first inside an HTTP response, and
--        the only alternative to storing it is printing it to a browser.
--   (ii) **It is revocable server-side by its issuer, without a Longbox act.**
--        An uninstall kills it AT SHOPIFY. That is what defuses 050 §2 Q1's
--        decisive ground — the Object-Lock backup a revocation cannot reach —
--        because a ciphertext in a 30-day immutable copy is a ciphertext of a
--        credential that is already dead at the provider. 050's BYOK key has no
--        such property, and 050 says so: *"the only complete revocation is at
--        the provider and it is the shop's act"*.
--
-- Locked decision 2 is untouched: no RAW key is in this schema. The envelope is
-- 048 R18's, clause for clause, and for R18's own reason — the server must be
-- able to READ this value, and there is no environment variable per install.
--
--   * **AES-256-GCM**, an AEAD: an unauthenticated ciphertext in a database is
--     malleable by anyone who can write to the database, and the failure is
--     silent.
--   * **A fresh random nonce per row, in its own column**: GCM nonce reuse under
--     one key is catastrophic rather than degrading.
--   * **The row's `id` as additional authenticated data**, which is why `id` has
--     NO DEFAULT here: the AAD has to be known before the ciphertext is computed,
--     so the application generates the uuid. A ciphertext lifted from one shop's
--     row into another's must FAIL TO AUTHENTICATE rather than decrypt to a
--     working token — 019 T24's cross-tenant line, enforced by cryptography
--     rather than by a WHERE clause.
--   * **`key_version smallint NOT NULL` from day one**, under its own env name
--     (`LONGBOX_CONNECTOR_KEY_V<n>`) and NOT the authenticator's: two subsystems
--     sharing one key means one compromise is two compromises, and the ring is
--     the only thing Longbox can destroy to make a stored token unopenable.
--
-- ============================================================================
-- LIVENESS IS A PREDICATE. THERE IS NO STATUS COLUMN ANYWHERE IN THIS FILE
-- ============================================================================
--
-- 050 §2 Q2's ruling, applied one connector over: a token version is LIVE when
-- it has an introduction row and no retirement row, computed at read time, every
-- time, from two tables. No `revoked`, no `active`, no `uninstalled_at`. A
-- status column is a column two concurrent uninstalls can both read as live, and
-- a cached credential is a retired credential still working — which is the exact
-- failure 050 §5(a) exists to prevent and the reason there is no cache here
-- either.
--
-- Single use is likewise a CONSTRAINT or it is a race (048 §7.1, three times
-- over in `024`): `UNIQUE (state_id)` on the state's use row is what makes a
-- REPLAYED OAuth callback a failed INSERT the database decides, rather than a
-- second token version for one authorization. `UNIQUE (connector, webhook_id)`
-- is the same rule for a redelivered webhook — Shopify retries, by design, and
-- an at-least-once delivery met by anything other than a unique index is an
-- at-least-once effect.
--
-- ============================================================================
-- NO STATE VALUE AND NO TOKEN VALUE IN THE CLEAR, IN ANY FORM
-- ============================================================================
--
-- `state_digest` holds `sha256(state)` in hex and nothing else — no prefix, no
-- hint, no last-four, every one of which is a reduced-keyspace copy of a
-- credential sitting beside its own digest (`024`'s header, adopted verbatim).
-- `payload_digest` on a webhook receipt is `sha256(raw body)`: the receipt
-- proves WHICH bytes arrived and carries none of them, because a `customers/…`
-- payload is personal data by construction and 041 §8.4's rule is that the log
-- holds references and not values.
--
-- ============================================================================
-- WHY `connector_webhook_receipt.shop_id` IS NULLABLE, ALONE IN THIS FILE
-- ============================================================================
--
-- Locked decision 4 puts a `shop_id` FK on every shop-scoped table and every
-- table here carries one. On the receipt it is NULLABLE, and the reason is that
-- the receipt is an OBSERVATION OF ANOTHER SYSTEM'S ACT (041 §2.5) whose tenancy
-- is the HMAC-verified `shop_domain`, not a Longbox id: the commonest
-- `shop/redact` arrives for a shop that has already been offboarded, and the
-- choices are to record the fact with a null resolution or to record nothing at
-- all. Recording nothing is the worse answer — E03-B09 needs the fact, and a
-- privacy webhook this system silently discarded is the failure that reads as
-- compliance. Inventing a `shop_id` would be worse still. `shop_domain` is
-- NOT NULL: it is always known, because it is inside the bytes the signature
-- covers.
--
-- SHAPE: EXPAND ONLY, `CREATE TABLE IF NOT EXISTS` / `DROP … IF EXISTS` first,
-- re-runnable by hand (000-docs/044 §2, §7). No `-- contract:` header: nothing
-- here retires anything. `shop_credentials`' Shopify row keeps working for a
-- shop that has no connector install at all, and its retirement is a later
-- contract step with its own 006 row.

BEGIN;

-- ---------------------------------------------------------------------------
-- 053 §5.1 — the install state: the CSRF token of the OAuth authorization-code
-- grant, minted by Longbox before the merchant ever reaches Shopify.
--
-- It is a row rather than a signed cookie because the browser that starts the
-- install and the browser that comes back are not guaranteed to be the same one
-- (an owner may start it from a laptop and approve it in another profile), and
-- because a single-use guarantee wants a UNIQUE index, which a cookie cannot
-- have. `requested_scopes` is recorded at issuance so the callback can compare
-- what was ASKED with what Shopify says was GRANTED — a comparison that is
-- impossible if the request is not written down.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_install_state (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          uuid NOT NULL REFERENCES shop(id),   -- locked decision 4
  -- A closed set with one member today, for the reason `024`'s `device_kind`
  -- CHECK is closed: a second connector is an additive decision with its own
  -- record, never a string a caller invents.
  connector        text NOT NULL CHECK (connector IN ('shopify')),
  -- The store the install is for, validated against Shopify's own shape BEFORE
  -- it is written (`isShopifyShopDomain`). It is in the row because the callback
  -- compares it with the `shop` parameter Shopify returns: a state minted for
  -- one store and redeemed against another is a store-substitution attack, and
  -- the comparison needs both halves recorded.
  shop_domain      text NOT NULL,
  -- `sha256(state)`, hex, over 128 bits of CSPRNG output. The state itself is in
  -- no column here and in no column anywhere; see the header.
  state_digest     text NOT NULL UNIQUE,
  -- What was ASKED FOR. The callback refuses a grant that is not exactly this
  -- set under the write⇒read implication (053 §6), so this column is what makes
  -- "least scopes" a checkable claim rather than a sentence in a record.
  requested_scopes text[] NOT NULL,
  -- An ISSUANCE fact. Nothing marks a state expired; "expired" is a predicate
  -- over this column (041 §2.4).
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- 'human': a person ran the CLI that minted this. 048 §3.5's RULE binds — an
  -- attribution of record, never proof of who acted.
  authored_by      text NOT NULL DEFAULT 'human'
                     CHECK (authored_by IN ('human','system','provider')),
  CONSTRAINT connector_install_state_expires_after_it_is_issued CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS connector_install_state_shop_idx
  ON connector_install_state (shop_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 053 §5.3 — the token version: an INTRODUCTION, exactly as 050 §4 defines one,
-- with the value sealed rather than named.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_token_version (
  -- NO DEFAULT, deliberately, and for `025`'s reason one table over: the
  -- application generates this uuid and binds it in as the AEAD's additional
  -- authenticated data before the INSERT, so the ciphertext is cryptographically
  -- tied to the row it sits in. A `DEFAULT gen_random_uuid()` would mean the id
  -- is not known until after the encryption, and the AAD would have to be
  -- something else — which is to say, nothing.
  id                 uuid PRIMARY KEY,
  shop_id            uuid NOT NULL REFERENCES shop(id),
  connector          text NOT NULL CHECK (connector IN ('shopify')),
  -- Denormalised from the state on purpose: the outbound client needs the store
  -- domain and the token TOGETHER, and a token that outlives its state row's
  -- readability (or that was introduced with no state at all) still has to name
  -- the store it is authority over.
  shop_domain        text NOT NULL,
  -- NULLABLE, because not every introduction comes from an OAuth grant: the
  -- pilot's per-store Dev Dashboard app produces a token an operator holds, and
  -- 053 §7.2's CLI introduces it under the same lifecycle. A version with no
  -- state is a version nobody can claim was consented to by a merchant, which is
  -- a distinction worth keeping visible rather than papering over with a
  -- synthetic state row.
  install_state_id   uuid REFERENCES connector_install_state(id),
  -- What Shopify says it GRANTED, recorded verbatim as an array. Never derived
  -- from `requested_scopes`: the whole point of the comparison is that the two
  -- can differ, and a column that copied the request would make the check
  -- tautological.
  granted_scopes     text[] NOT NULL,
  -- AES-256-GCM. `token_ciphertext` carries the ciphertext with the 16-byte GCM
  -- tag appended; `token_nonce` is the 12 random bytes this row was sealed under
  -- and is never reused across rows.
  token_ciphertext   bytea NOT NULL,
  token_nonce        bytea NOT NULL,
  key_version        smallint NOT NULL CHECK (key_version >= 1),
  version_no         integer NOT NULL CHECK (version_no >= 1),
  introduced_at      timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- 'provider': the value in this row was authored by Shopify and handed to this
  -- server. A person authorised the install; they did not author the token.
  authored_by        text NOT NULL DEFAULT 'provider'
                       CHECK (authored_by IN ('human','system','provider')),
  CONSTRAINT connector_token_version_scopes_are_not_empty CHECK (
    array_length(granted_scopes, 1) >= 1
  )
);
-- 050 §4's `UNIQUE (shop_id, kind, version_no)`, with `connector` standing where
-- `kind` stands: what makes a concurrent double-introduction fail loudly instead
-- of silently producing two version 2s.
CREATE UNIQUE INDEX IF NOT EXISTS connector_token_version_no_idx
  ON connector_token_version (shop_id, connector, version_no);
CREATE INDEX IF NOT EXISTS connector_token_version_lookup_idx
  ON connector_token_version (shop_id, connector, version_no DESC);

-- ---------------------------------------------------------------------------
-- 053 §5.2 — the state's single use. **`UNIQUE (state_id)` is the whole
-- mechanism**: a replayed callback is a failed INSERT, decided by the database.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_install_state_use (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                   uuid NOT NULL REFERENCES shop(id),
  state_id                  uuid NOT NULL REFERENCES connector_install_state(id),
  -- NOT NULL: the token version is written in the same transaction as this row,
  -- so "the state was spent and no token exists" is not a state this schema can
  -- hold — `024`'s invitation/membership pairing, applied to an install.
  connector_token_version_id uuid NOT NULL REFERENCES connector_token_version(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  authored_by               text NOT NULL DEFAULT 'system'
                              CHECK (authored_by IN ('human','system','provider'))
);
CREATE UNIQUE INDEX IF NOT EXISTS connector_install_state_use_state_idx
  ON connector_install_state_use (state_id);

-- ---------------------------------------------------------------------------
-- 053 §5.5 — the webhook receipt: WHICH signed message arrived, and nothing it
-- said. The dedupe key of an at-least-once delivery.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_webhook_receipt (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULLABLE, alone in this file. See the header.
  shop_id        uuid REFERENCES shop(id),
  connector      text NOT NULL CHECK (connector IN ('shopify')),
  -- OPEN-WORLD, deliberately, in `003:134-143`'s style. A topic this build does
  -- not know must still be RECORDABLE: the alternative is a CHECK that turns an
  -- unrecognised-but-authentic message into a 500 and a retry storm, which is
  -- how an app gets its webhooks disabled by the provider.
  topic          text NOT NULL,
  -- Shopify's `X-Shopify-Webhook-Id`. The dedupe key, and the reason the route
  -- needs no `Idempotency-Key` (042 §5.1's class two, 053 §8).
  webhook_id     text NOT NULL,
  shop_domain    text NOT NULL,
  api_version    text,
  -- `sha256(raw body)`, hex. WHICH bytes arrived, never the bytes: a
  -- `customers/redact` payload is personal data, and a receipt that copied it
  -- would be a second copy of the thing the message asks us to destroy.
  payload_digest text NOT NULL,
  payload_bytes  integer NOT NULL CHECK (payload_bytes >= 0),
  received_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- 'provider': Shopify authored this message and this row is Longbox's record
  -- of receiving it (041 §2.5).
  authored_by    text NOT NULL DEFAULT 'provider'
                   CHECK (authored_by IN ('human','system','provider'))
);
CREATE UNIQUE INDEX IF NOT EXISTS connector_webhook_receipt_id_idx
  ON connector_webhook_receipt (connector, webhook_id);
CREATE INDEX IF NOT EXISTS connector_webhook_receipt_shop_idx
  ON connector_webhook_receipt (shop_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- 053 §5.4 — the retirement. A SECOND ROW, never an edit (050 §2 Q2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connector_token_retirement (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                    uuid NOT NULL REFERENCES shop(id),
  connector_token_version_id uuid NOT NULL REFERENCES connector_token_version(id),
  -- A CLOSED set, unlike `shop_credential_retirement.reason_code`, and the
  -- difference is worth stating: 050 left that one open-world because a BYOK
  -- key can be retired for reasons nobody has thought of. A CONNECTOR token has
  -- exactly three endings and each carries a different meaning about the
  -- PROVIDER side — the merchant uninstalled (the token is dead at Shopify), we
  -- rotated (a successor exists), or somebody revoked it deliberately (it may
  -- still be live at Shopify until the merchant acts). A fourth would be a
  -- fourth meaning, and it should be a decision rather than a string.
  reason_code                text NOT NULL
                               CHECK (reason_code IN ('uninstall','rotation','revocation')),
  -- The signed message that CAUSED this retirement, when one did. NOT NULL would
  -- be wrong (a rotation has no webhook) and absent would be worse: without it,
  -- "the merchant uninstalled" is an assertion about somebody else's system with
  -- no evidence attached, which is exactly what 018's rung rules forbid.
  webhook_receipt_id         uuid REFERENCES connector_webhook_receipt(id),

  -- 053 §7.3a (v1.0.1, the security lens's S2). WHAT LONGBOX DID AND WHAT IT
  -- OBSERVED — never what the merchant did.
  --
  -- 050 §2 Q3 could record only `provider_revocation_instructed_at`, because for
  -- a BYOK key Longbox can do nothing but ask. A connector token is different:
  -- the app can call Shopify's own app-uninstall endpoint with the token itself.
  -- So there is a Longbox ACT here, and the honest record of it is two columns
  -- that describe THIS system's behaviour:
  --
  --   * `provider_revocation_attempted_at` — when this system CALLED. A fact
  --     about a Longbox act, exactly as 050's `instructed_at` is.
  --   * `provider_revocation_http_status` — the status this system OBSERVED in
  --     reply. 041 §2.5's external observation: it is Longbox's record of what
  --     another system said, and NULL means the call did not complete (a
  --     transport failure), which is different from a call that returned an
  --     error and is stored differently.
  --
  -- ⚠ THERE IS STILL NO COLUMN ASSERTING THAT THE TOKEN IS DEAD AT SHOPIFY, and
  -- there will not be. A 200 is evidence that a request succeeded, not a fact
  -- about another system's present state, and 018's rung rules forbid recording
  -- an unverified third-party state as a fact. What the receipt may say is what
  -- these two columns say: we called, and this is what came back.
  provider_revocation_attempted_at timestamptz,
  provider_revocation_http_status  integer,

  retired_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  authored_by                text NOT NULL DEFAULT 'system'
                               CHECK (authored_by IN ('human','system','provider')),
  -- An uninstall is CAUSED by a signed message and must carry it; the other two
  -- are Longbox acts and have none. Stated as a constraint rather than as a
  -- convention, because a retirement claiming an uninstall with no evidence is
  -- the one row in this file that could make a receipt say something untrue
  -- (041 §8.2).
  CONSTRAINT connector_token_retirement_uninstall_cites_its_webhook CHECK (
    (reason_code =  'uninstall' AND webhook_receipt_id IS NOT NULL) OR
    (reason_code <> 'uninstall')
  ),
  -- An observed status with no attempt is a status this system did not observe.
  -- The reverse is legal and is the transport-failure case.
  CONSTRAINT connector_token_retirement_status_needs_its_attempt CHECK (
    provider_revocation_http_status IS NULL OR provider_revocation_attempted_at IS NOT NULL
  )
);
-- 050 §4's `UNIQUE (credential_version_id)`: at most one ending per version,
-- because a second retirement of one token is a duplicate rather than a fact.
CREATE UNIQUE INDEX IF NOT EXISTS connector_token_retirement_version_idx
  ON connector_token_retirement (connector_token_version_id);

-- ---------------------------------------------------------------------------
-- ONE INDEX ON AN OLDER TABLE, AND IT IS A 019 T24 FIX (the invariant review of
-- `16f17ef`, finding 2).
--
-- `shop.shopify_domain` has been nullable and unconstrained since `001`, and the
-- first version of the webhook receiver resolved its tenant with
-- `SELECT id FROM shop WHERE shopify_domain = $1`, taking `rows[0]` with no
-- `ORDER BY`. **Two shops sharing a domain would have retired an ARBITRARY
-- one's tokens.** The receiver no longer resolves that way — it matches the
-- signed store against `connector_token_version.shop_domain`, the value an
-- authenticated grant actually wrote — so the defect is gone from the code path.
--
-- The index is added anyway, and the difference is the one this repository keeps
-- making: removing the READER makes the bug unreachable; the CONSTRAINT makes
-- the STATE unrepresentable, so the next reader of that column cannot
-- reintroduce it. One store belongs to at most one Longbox shop.
--
-- PARTIAL, on `WHERE shopify_domain IS NOT NULL`: the column is nullable by
-- design (a shop with no Shopify configuration at all is the ordinary case), and
-- Postgres treats NULLs as distinct in a plain unique index anyway — the
-- predicate says so out loud rather than relying on that.
--
-- ⚠ IT CAN FAIL ON AN EXISTING DATABASE, and that is the intended behaviour
-- rather than a hazard to route around: it fails only when two shops already
-- share a domain, which is exactly the state that would have made an uninstall
-- end the wrong shop's authority. A migration that refuses to apply over that is
-- a migration doing its job, and the fix is to correct the rows, not the index.
CREATE UNIQUE INDEX IF NOT EXISTS shop_shopify_domain_is_one_store
  ON shop (shopify_domain) WHERE shopify_domain IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Append-only, and `ENABLE ALWAYS` in the same breath (041 §9.2 item 1, 044 §7).
-- `CREATE TRIGGER` always lands at the bypassable 'O' default and the gate-test
-- asserts 'A' for every declared trigger, so forgetting this is a red build
-- rather than a silent hole. The declared set is `src/db/appendOnlyTables.ts`.
--
-- All five, with no exemption. Every one is a thing that HAPPENED — a state was
-- minted, a state was spent, a token was introduced, a token was ended, a signed
-- message arrived — and none is a statement about the present that gets
-- corrected. There is deliberately no mutable row anywhere in this subsystem:
-- `025` needed one (048 R19's replay guard) and this file needs none, because
-- every guard here is a UNIQUE index instead.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'connector_install_state','connector_install_state_use','connector_token_version',
    'connector_token_retirement','connector_webhook_receipt'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;
