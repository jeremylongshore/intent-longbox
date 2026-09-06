-- 038_webhook_replay_and_privacy_workflows.sql — E03-B08 (bead longbox-e5b.3.8)
--
-- WHAT A SECOND DELIVERY MEANS, AND WHAT A PRIVACY MESSAGE OBLIGES.
-- Docs: 000-docs/064 (the decision); 053 §5.5, §7.3, §8 (the receipt, the
-- uninstall and the two mechanism substitutions this file extends rather than
-- replaces); 043 §2.3, §2.4, §3.3, §5.4 (the outbox, its derived predicates and
-- the dead-letter view); 041 §2.5, §8.4 (an external observation; the log holds
-- references and not values); 019 T32, T33; 022 P3; 034 §3.4 (the K1 shape);
-- 000-docs/044 §2, §9.
--
-- ⚠ NUMBERED 038 ON TOP OF 037. The runner's ledger keys on FILENAME and applies
-- unseen files in sorted order, so gaps and out-of-order arrivals are legal and
-- self-healing (`scripts/migrationDiscipline.ts`). `027` is still the only gap:
-- reserved by E03-B06 and never written.
--
-- ============================================================================
-- THE ONE FACT THAT SHAPES EVERY COLUMN BELOW: THE HEADERS ARE NOT SIGNED
-- ============================================================================
--
-- Shopify's webhook HMAC covers the RAW BODY and nothing else. `X-Shopify-
-- Webhook-Id`, `X-Shopify-Topic` and `X-Shopify-Triggered-At` are OUTSIDE the
-- signature. So the dedupe key this subsystem shipped with — `UNIQUE (connector,
-- webhook_id)` — is a defence against the PROVIDER's at-least-once delivery, and
-- it is not a defence against someone who captured one valid message and sends it
-- again with a fresh id header. Those are two different adversaries and they need
-- two different keys:
--
--   * the provider's accidental redelivery  → the id it chose (already shipped)
--   * a deliberate replay of captured bytes → `payload_digest`, which IS covered
--     by the signature because it is a digest OF the signed bytes
--
-- This file adds the second key and records the decision each delivery received.
-- Neither key is removed and neither is weakened.
--
-- ============================================================================
-- WHY `triggered_at` IS RECORDED AND WHAT IT MAY AND MAY NOT DECIDE
-- ============================================================================
--
-- `X-Shopify-Triggered-At` is the provider's statement about when the event
-- happened. It is UNSIGNED, so it is evidence in the accidental case (the sender
-- is Shopify) and worth nothing in the deliberate one (the sender chose it).
--
-- ⚠ **THIS PARAGRAPH ONCE SAID A FORGED VALUE "IS ALREADY CAUGHT BY THE DIGEST
-- KEY", AND TWO LENSES FALSIFIED IT INDEPENDENTLY (F2, F3).** It was not: a
-- FUTURE value was never stale, because the only test was `now - triggered_at >
-- window` — so `triggered_at` in 2030 pushed the uninstall's cutoff arbitrarily
-- forward. And a WINDOW-scoped digest key is a clock an attacker only has to
-- outwait: capture, wait past forty-eight hours, replay under a fresh id. What
-- makes the two uses safe now is three separate repairs, none of which is the
-- digest key on its own — the store comes from the SIGNED BODY (F1), a future
-- stated time is treated as ABSENT and the cutoff is clamped at `now` (F2), and
-- `app/uninstalled`'s digest lookback is ABSOLUTE rather than windowed (F3).
--
-- It is used for exactly two things:
--
--   1. the staleness window — an old-but-valid message is REFUSED and the refusal
--      is RECORDED (`disposition = 'stale'`), never dropped silently;
--   2. the uninstall's event-time bound — an uninstall retires the tokens that
--      existed when it happened, not tokens introduced by a LATER re-install.
--
-- ⚠ (2) COMPARES TWO CLOCKS: Shopify's `triggered_at` against this database's
-- `connector_token_version.created_at`. 043 §2.4 already ratified a cross-clock
-- comparison for `attempt_visibility` and named its condition — "beyond a single
-- host, NTP or a monotonic source is a requirement, not an operational nicety".
-- The same condition binds here, and the guard band (`CONNECTOR_WEBHOOK_CLOCK_
-- SKEW_SECONDS`, a PROVISIONAL floor) is what keeps the more dangerous of the two
-- failure directions closed: with the band, skew makes the bound retire one token
-- TOO MANY (the shop re-installs) rather than one too few (a token this system
-- believes is live and Shopify has already killed).
--
-- ⚠ `triggered_at` IS NOT `observed_at`, AND THE RECEIPT'S EXTERNAL-OBSERVATION
-- FLAG STAYS FALSE. 041 §2.5's flag governs whether a table may order ITS OWN
-- rows' derivation by `observed_at`; nothing here orders receipts by anything.
-- `received_at` remains this system's observation time and is unchanged.
--
-- SHAPE: EXPAND ONLY. `ADD COLUMN … NOT NULL DEFAULT …` is expand (044 §2);
-- `DROP CONSTRAINT IF EXISTS` before each `ADD CONSTRAINT`, `IF NOT EXISTS`
-- everywhere else, so a re-run is a no-op. No `-- contract:` header: nothing here
-- retires anything, and no policy is written here — `src/db/rowLevelSecurity.ts`
-- re-derives the boundary from the live catalog after every `pnpm migrate`, so a
-- new table carrying `shop_id` is policied by that step and not by this file.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The receipt records WHICH decision each delivery received (064 §4).
-- ---------------------------------------------------------------------------

-- The provider's stated event time. NULLABLE: the header is absent on a message
-- from an older API version, and a message with no stated time is accepted
-- (there is nothing to compare) rather than refused — refusing would let a
-- dropped header become a lost `customers/redact`.
ALTER TABLE connector_webhook_receipt
  ADD COLUMN IF NOT EXISTS triggered_at timestamptz;

-- WHAT THIS SYSTEM DECIDED ABOUT THIS DELIVERY. It is set once, at INSERT, on an
-- append-only table: a receipt is a record of a decision made at a moment, and a
-- decision that could be edited afterwards is not a record of anything.
--
-- The default is `accepted` because every receipt written before this migration
-- WAS accepted — the code that wrote them had no other outcome — so the default
-- states a true fact about the existing rows rather than a convenient one.
ALTER TABLE connector_webhook_receipt
  ADD COLUMN IF NOT EXISTS disposition text NOT NULL DEFAULT 'accepted';

ALTER TABLE connector_webhook_receipt
  DROP CONSTRAINT IF EXISTS connector_webhook_receipt_disposition_is_closed;
-- A CLOSED set, unlike `topic` two columns up, and the difference is the same one
-- 050 and 053 keep making: `topic` is the PROVIDER's vocabulary and must stay
-- open-world or an unrecognised-but-authentic message becomes a 500 and a retry
-- storm; `disposition` is THIS system's vocabulary, and a fourth value would be a
-- fourth meaning that ought to be a decision rather than a string.
--
--   accepted      — the message was authentic, timely and not a repeat of bytes
--                   already seen inside the window; its effects ran.
--   stale         — authentic, and older than the receipt window. Recorded and
--                   REFUSED. The receipt is the evidence that it arrived.
--   replayed_body — authentic, and byte-identical to a message already received
--                   for the same connector, topic and store inside the window,
--                   under a DIFFERENT id. No effect ran. This is the one the
--                   unsigned id header cannot catch.
ALTER TABLE connector_webhook_receipt
  ADD CONSTRAINT connector_webhook_receipt_disposition_is_closed
  CHECK (disposition IN ('accepted', 'stale', 'replayed_body'));

-- The body key. `received_at DESC` is in the index because every read of it asks
-- "was this body seen inside the window", which is a lookup followed by a bound
-- on time.
--
-- index lock: connector_webhook_receipt holds no live shop row before G3 (034:421); the build is instantaneous
CREATE INDEX IF NOT EXISTS connector_webhook_receipt_body_idx
  ON connector_webhook_receipt (connector, topic, shop_domain, payload_digest, received_at DESC);

-- ---------------------------------------------------------------------------
-- 2. `privacy_request` — one append-only fact per message on a topic Shopify
--    requires an app to handle (064 §6).
--
-- ⚠ IT HOLDS NO CUSTOMER IDENTIFIER, AND THAT IS THE POINT RATHER THAN AN
-- OMISSION. The message names a person; 041 §8.4's rule is that the log holds
-- references and not values, and a table that copied the identifier would be a
-- second copy of the thing a redaction message asks this system to be rid of.
-- What is kept is the DIGEST of the signed bytes — enough to prove which message
-- arrived, and useless for finding a person. The bytes themselves are not stored
-- anywhere: `connector_webhook_receipt` records their length and their digest,
-- and the buffer is discarded with the request.
--
-- WHAT THIS TABLE IS FOR, given that it holds nothing about the subject: it is
-- the CLOCK. It records that an obligation started, when, and by when it is owed,
-- so that an unanswered one is a finding rather than a silence.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS privacy_request (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULLABLE for `connector_webhook_receipt.shop_id`'s reason, word for word
  -- (053 §5.5): the commonest `shop/redact` arrives for a store that has already
  -- been offboarded, and the choices are to record the fact with a null
  -- resolution or to record nothing. Recording nothing is the worse answer.
  shop_id            uuid REFERENCES shop(id),
  connector          text NOT NULL CHECK (connector IN ('shopify')),
  -- OPEN-WORLD, as the receipt's is: a fourth compliance topic added by the
  -- provider must be recordable on the day it arrives.
  topic              text NOT NULL,
  webhook_id         text NOT NULL,
  -- The signed message this obligation came from. NOT NULL: an obligation with no
  -- evidence is an assertion, and 018's rung rules forbid recording one as a fact.
  webhook_receipt_id uuid NOT NULL REFERENCES connector_webhook_receipt(id),
  shop_domain        text NOT NULL,
  payload_digest     text NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  -- WHEN IT IS OWED. Derived at INSERT from a PROVISIONAL window
  -- (`PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS`) and STORED rather than computed on
  -- read, for 041 §5.3's reason: a window changed next year must not silently
  -- restate what was owed last year. The number is a floor this repository chose,
  -- it is not a legal deadline, and no artifact may present it as one — what a
  -- person is entitled to and on what clock is E03-B09's material and needs
  -- counsel (E01-B06).
  due_at             timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Always 'provider': Shopify authored the message and this row is Longbox's
  -- record of having received it (041 §2.5).
  authored_by        text NOT NULL DEFAULT 'provider'
                       CHECK (authored_by IN ('human', 'system', 'provider')),
  CONSTRAINT privacy_request_due_after_receipt CHECK (due_at >= received_at)
);

-- The provider's own key, mirroring the receipt's. One request per delivered
-- message; a redelivery under the same id conflicts here as it does there.
CREATE UNIQUE INDEX IF NOT EXISTS privacy_request_webhook_idx
  ON privacy_request (connector, webhook_id);
-- The clock's read path: "what is outstanding, oldest first".
CREATE INDEX IF NOT EXISTS privacy_request_due_idx
  ON privacy_request (due_at, received_at);
-- LEADING `shop_id`, because the tenant policy adds `shop_id = current_shop_id()`
-- to every statement and a shop-wide listing would otherwise scan every tenant's
-- rows. `tests/integration/rls-tenant-isolation.test.ts` asserts this for every
-- policied table, so the index is a requirement rather than a preference.
CREATE INDEX IF NOT EXISTS privacy_request_shop_idx
  ON privacy_request (shop_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- 3. `privacy_request_fulfilment` — the answer, as a fact.
--
-- There is no `status` on `privacy_request` and there is no `fulfilled_at`
-- column on it either. Outstanding is a PREDICATE — no fulfilment row exists —
-- exactly as 043 §2.4 derives an outbox row's liveness and 040 refuses
-- `scan_session.status`. A mutable flag here would be a second, lossy copy of
-- what this table says in full.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS privacy_request_fulfilment (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id            uuid REFERENCES shop(id),
  privacy_request_id uuid NOT NULL REFERENCES privacy_request(id),
  -- WHAT WAS DONE. A closed set, because each member is a different sentence a
  -- shop could be shown and inventing a fifth should cost a decision:
  --   no_data_held   — this system holds nothing about the subject. It is a
  --                    CHECKABLE claim here and not a comfortable one: no scope
  --                    this connector may request reads a customer, and no code
  --                    path calls a customer-bearing endpoint (064 §7).
  --   data_exported  — an export was produced for the merchant (E03-B09).
  --   data_erased    — the deletion procedure ran (E03-B09).
  --   not_applicable — the message names a store this system never held data for.
  outcome            text NOT NULL
                       CHECK (outcome IN ('no_data_held', 'data_exported', 'data_erased', 'not_applicable')),
  -- HOW the outcome was reached, so a reader can tell an automatic answer from a
  -- person's. `scope_policy` is the only one a machine may write.
  method             text NOT NULL
                       CHECK (method IN ('scope_policy', 'operator', 'deletion_procedure')),
  operator_id        uuid REFERENCES app_user(id),
  fulfilled_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  authored_by        text NOT NULL
                       CHECK (authored_by IN ('human', 'system')),
  -- A machine answer never names a person, and a person's answer is not
  -- attributable to the machine. Stated as a constraint because a receipt that
  -- got this wrong would be a false statement about who decided (041 §8.2).
  CONSTRAINT privacy_request_fulfilment_method_matches_author CHECK (
    (method =  'scope_policy' AND authored_by = 'system' AND operator_id IS NULL) OR
    (method <> 'scope_policy' AND authored_by = 'human')
  )
);

-- ONE fulfilment per request. This is the constraint the consumer's idempotency
-- rests on (043 §3.2: "a consumer's idempotency is enforced by a database
-- constraint … never by a read-then-write check"), and it holds under the
-- concurrent duplicate delivery that `SKIP LOCKED` plus at-least-once makes
-- constructible.
CREATE UNIQUE INDEX IF NOT EXISTS privacy_request_fulfilment_request_idx
  ON privacy_request_fulfilment (privacy_request_id);
-- Leading `shop_id`, for `privacy_request_shop_idx`'s reason.
CREATE INDEX IF NOT EXISTS privacy_request_fulfilment_shop_idx
  ON privacy_request_fulfilment (shop_id, fulfilled_at DESC);

-- ---------------------------------------------------------------------------
-- 4. `privacy_request_outstanding` — the audit's question, as ONE definition.
--
-- A view rather than a query inside `scripts/`, so the CLI, a future report and
-- any test all read the same predicate. `security_invoker = true` is set on every
-- view by `029`'s catalog enumeration, so this one is filtered by the caller's
-- own policies and context.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW privacy_request_outstanding AS
SELECT
  r.id            AS privacy_request_id,
  r.shop_id,
  r.connector,
  r.topic,
  r.shop_domain,
  r.received_at,
  r.due_at,
  (now() > r.due_at) AS overdue
FROM privacy_request r
WHERE NOT EXISTS (
  SELECT 1 FROM privacy_request_fulfilment f WHERE f.privacy_request_id = r.id
);

COMMENT ON VIEW privacy_request_outstanding IS
  'Privacy requests with no fulfilment fact, and whether each is past the '
  'PROVISIONAL window it was stamped with. Outstanding is a PREDICATE over '
  'privacy_request_fulfilment, never a status column (000-docs/064 §6; 043 §2.4). '
  'It names no customer and holds no payload: the request row never carried one.';

-- ---------------------------------------------------------------------------
-- 5. The dead-letter view learns the new guard refusal (043 §5.4, A5).
--
-- `guard_refusal` separates "a guard worked" from "a provider failed", and the
-- privacy job has TWO guards of its own: it refuses to answer `no_data_held` for
-- a store whose connector was ever GRANTED a customer scope, and — since the
-- security lens's F4 — for a store with NO RECORDED GRANT AT ALL, because an
-- empty set satisfies *no customer scope was granted* vacuously and an answer
-- produced by a check that examined nothing is indistinguishable from a real one.
-- Both are unknown-means-do-not-touch. Without these entries they would be
-- counted as unreliability in the 019 T17 aggregate.
--
-- ⚠ `privacy_topic_not_auto_fulfillable` is DELIBERATELY ABSENT from this list
-- (the gate audit's B6). It is a PRODUCER defect — a job enqueued for a topic
-- nothing answers automatically — and calling it a guard refusal would say a
-- control worked when nothing was controlled.
--
-- CREATE OR REPLACE on a view is expand: readers see one more TRUE in an existing
-- boolean column, and no column is added, removed or retyped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW outbox_dead_letter AS
SELECT
  o.id                                   AS outbox_id,
  o.shop_id,
  o.scan_session_id,
  o.event,
  o.ref_table,
  o.ref_id,
  a.id                                   AS attempt_id,
  a.attempt_no,
  a.detail ->> 'reason_code'             AS reason_code,
  (a.detail ->> 'reason_code') IN ('listing_left_draft', 'no_observation_evidence',
                                   'customer_scope_was_granted', 'no_recorded_grant')
                                         AS guard_refusal,
  a.created_at                           AS dead_lettered_at,
  EXISTS (
    SELECT 1 FROM outbox_attempt r
     WHERE r.outbox_id = a.outbox_id
       AND r.kind = 'replay_requested'
       AND r.created_at > a.created_at
  )                                      AS replay_requested_after
FROM outbox o
JOIN outbox_attempt a ON a.outbox_id = o.id AND a.kind = 'dead_lettered';

COMMENT ON VIEW outbox_dead_letter IS
  'The dead-letter queue, DERIVED (043 §5.4). guard_refusal separates the guard '
  'refusals — listing_left_draft, no_observation_evidence and (E03-B08) '
  'customer_scope_was_granted + no_recorded_grant — from the T17 aggregate: they '
  'are a queue awaiting a human look, not a count of failures (043 A5). '
  'privacy_topic_not_auto_fulfillable is deliberately NOT one of them: it is a '
  'producer defect, not a control working. Nothing re-drives a row here '
  'automatically, ever (043 §5.5): a replay is a human act with a record.';

-- ---------------------------------------------------------------------------
-- 6. Append-only, and `ENABLE ALWAYS` in the same breath (041 §9.2 item 1,
--    044 §7). `CREATE TRIGGER` always lands at the bypassable 'O' default and the
--    gate-test asserts 'A' for every declared trigger. The declared set is
--    `src/db/appendOnlyTables.ts`.
--
-- Both, with no exemption. A privacy request is a message that ARRIVED and a
-- fulfilment is an answer that was GIVEN; neither is a statement about the
-- present that gets corrected. A wrong fulfilment is superseded by nothing — it
-- is a fact about what this system did, and the correction is a new request with
-- its own evidence.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['privacy_request', 'privacy_request_fulfilment'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

COMMIT;
