-- 010_scan_session_transition.sql — E02-B10 (bead longbox-e5b.2.10)
--
-- 040 §3.3's table and 040 §8.1 item 1, exactly as specified. Docs: 040 §3.3,
-- §4.2, §4.5, §8.1, §8.4; 041 §2.3, §3.5; 000-docs/044 §5.
--
-- ⚠ THE TABLE ONLY. 040 §8.1's other items — `scan_session_current_state`,
-- `scan_session_state_history`, the `against_*` columns on `human_confirmation`,
-- and the `scan_session.status` deprecation comment — are NOT here. The views are
-- E02-B07's (and 040 A6 forbids putting `scan_session_current_state` on a request
-- path before O-A's benchmark fixture and plan-shape gate land); the `against_*`
-- columns change the wire contract and belong with E02-B08's routes. 040 §8.2's
-- CONTRACT step — dropping `scan_session.status` and adding `scan_session` to the
-- trigger loop — is this bead's by name and is deliberately NOT taken here: it
-- requires zero writers, and `setSessionStatus` still has two call sites
-- (`routes:213`, `:373`). Taking it now would break the deploy, which is the exact
-- failure the expand/contract discipline in 000-docs/044 exists to prevent. It
-- lands as its own migration carrying a `-- contract:` header after E02-B08.
--
-- WHY THIS TABLE AT ALL (040 §3.3). Four session transitions are not implied by any
-- other record, because nothing else in the system is written when they happen:
-- park, resume, reopen, void. Each is a decision by a person, and there is no
-- `park_photo` or `void_snapshot` to infer it from. Every other state in 040 is
-- READ OUT OF THE LOG — writing a `confirmed` transition beside every
-- `human_confirmation` would store the same fact twice, which is the thing that
-- record exists to stop.
--
-- NO BACKFILL (040 §8.4 item 1). The table starts EMPTY. No park, resume,
-- abandonment, void or failure was ever recorded, and manufacturing one would
-- invent an actor and a reason — the fabrication 034 §4.4 forbids, and unfixable
-- here by construction because the row cannot be updated.
--
-- SHAPE: EXPAND ONLY, `CREATE TABLE IF NOT EXISTS`, re-runnable by hand.

BEGIN;

CREATE TABLE IF NOT EXISTS scan_session_transition (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           uuid NOT NULL REFERENCES shop(id),            -- locked decision 4
  scan_session_id   uuid NOT NULL REFERENCES scan_session(id),

  -- FOUR values (040 A2). No 'system' anything, no 'abandoned' (derived, A3), no
  -- 'failed' (every failure is a record, A4), and no 'published' — there never will
  -- be one (040 F1: publication is an observation Longbox RECEIVES, never a
  -- transition Longbox makes).
  kind              text NOT NULL
      CHECK (kind IN ('parked','resumed','voided','reopened')),
  reopened_to_rung  text
      CHECK (reopened_to_rung IN ('captured','proposed','confirmed','conditioned','priced')),

  -- 040 A1 — THE CAUSAL REFERENCE, and the costliest amendment in that record.
  -- v1.0.0 compared `created_at` values and took the later one; a timestamp
  -- comparison is an INFERENCE ABOUT CAUSALITY FROM A PROXY FOR IT, and the proxy
  -- fails in exactly the three cases that matter: commit skew (`now()` is
  -- transaction-start time, so a long transaction stamps its rows EARLIER than a
  -- short one that started later and committed first), the offline queue replaying
  -- a park against a session another device has advanced, and the two-device case
  -- where the second actor is deliberately looking at an older world. So a
  -- transition records WHAT IT WAS ISSUED AGAINST — the highest-witness record the
  -- actor was shown — and 040 §3.4 clause 2 asks a causal question, not a temporal
  -- one. 041 §3.5 rules this the ONE shape: `observed_current_id` is not built.
  against_table     text
      CHECK (against_table IN ('scan_photo','candidate_set','llm_rerank','human_confirmation',
                               'condition_assessment','pricing_snapshot','shopify_draft',
                               'scan_session')),
  against_id        uuid,

  -- The derived state the actor was shown: a witness to what they believed, never a
  -- key and never authoritative.
  observed_state    text NOT NULL,
  -- 033 §5.6: "one line: bad photo, wrong book, second look".
  reason            text NOT NULL,

  -- 003:44-73's actor-attribution rule, applied to this table. NULL pre-G2 and
  -- NEVER backfilled to true: a pre-G2 transition is written by an unauthenticated
  -- caller and is unattributable BY CONSTRUCTION, not by policy (034 E6).
  -- `operator_id` carries no FK yet — its target `app_user` arrives with 034 §4.1's
  -- tenancy migration (E03) — exactly as `003:60` left the same column on four
  -- other tables. Reserving the slot before the first live row is the point (003's
  -- own rationale: an append-only column added later is a permanent hole).
  operator_id       uuid,
  actor_verified    boolean NOT NULL DEFAULT false,
  -- THREE roles (040 A3/A4). There is no 'system' role because after A3 no machine
  -- writes a row here at all — the strongest possible form of 033 §5.2's rule.
  actor_role        text NOT NULL
      CHECK (actor_role IN ('operator','owner','manager')),
  -- 034 §2.8 / §2.11. Same reservation, same reason; FKs arrive with 034's migration.
  device_id         uuid,
  batch_id          uuid,

  -- 041 §2.3: who produced the content. Constant here and constrained to it,
  -- because after 040 A3 there is no machine writer for this table — the same move
  -- `007` makes for `condition_assessment` and `human_confirmation`.
  authored_by       text NOT NULL DEFAULT 'human'
      CHECK (authored_by = 'human'),
  -- 041 §5.3, read exactly: `session_seq` is "NOT NULL on tables created after
  -- this record and nullable on the existing witness tables, never backfilled".
  -- This table is created after the record and starts EMPTY, so it takes the
  -- strict half — there is no legacy row to accommodate, and a nullable column
  -- here would permanently admit a writer that bypasses the assignment helper.
  -- The eight tables `007` touches are the other half of that sentence and are
  -- correctly nullable; an earlier draft of this line said "like every other
  -- witness table's", which read the sentence backwards.
  session_seq       bigint NOT NULL CHECK (session_seq > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- 040 A2: `reopened_to_rung` is present exactly when the kind is 'reopened'.
  CONSTRAINT scan_session_transition_rung_pairs_with_reopened
    CHECK ((kind = 'reopened') = (reopened_to_rung IS NOT NULL)),
  -- 040 A1: the causal reference is whole or absent; never half of one.
  CONSTRAINT scan_session_transition_reference_is_whole
    CHECK ((against_table IS NULL) = (against_id IS NULL)),
  -- 040 §3.3: voided and reopened are decisions, not observations — only a shop
  -- principal writes them.
  CONSTRAINT scan_session_transition_principal_only_decisions
    CHECK (kind IN ('parked','resumed') OR actor_role IN ('owner','manager'))
);

-- 040 §3.3's three indexes: the session's own trail, the resumable-session list
-- (§7), and "which transitions were issued against this record?".
CREATE INDEX IF NOT EXISTS scan_session_transition_session_idx
  ON scan_session_transition (scan_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scan_session_transition_shop_kind_idx
  ON scan_session_transition (shop_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS scan_session_transition_against_idx
  ON scan_session_transition (against_table, against_id);
-- 041 §5.3's per-session counter guard, same shape as every other witness table's.
CREATE UNIQUE INDEX IF NOT EXISTS scan_session_transition_session_seq_idx
  ON scan_session_transition (scan_session_id, session_seq);

-- Append-only, and ENABLE ALWAYS in the same breath (041 §9.2 item 1). `006` had to
-- promote fourteen existing triggers because `CREATE TRIGGER` always lands at the
-- bypassable 'O' default; a table added after `006` must not repeat that, and the
-- gate-test asserts 'A' for every declared trigger, so forgetting this is a red
-- build rather than a silent hole.
DROP TRIGGER IF EXISTS scan_session_transition_append_only ON scan_session_transition;
CREATE TRIGGER scan_session_transition_append_only
  BEFORE UPDATE OR DELETE ON scan_session_transition
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE scan_session_transition
  ENABLE ALWAYS TRIGGER scan_session_transition_append_only;

COMMIT;
