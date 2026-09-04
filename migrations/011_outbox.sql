-- 011_outbox.sql — the transactional outbox: two append-only tables and the
-- dead-letter view over the attempt log.
--
-- Bead: longbox-e5b.2.17 (alias E02-D07). Docs: 043 v1.1.2 §2.3, §2.4, §2.5,
-- §2.6, §5.1, §5.4, §6.3, §7.2, §9.1 rows 1 and 3; 041 §2.1 (the envelope),
-- §2.3 (authored_by), §5.3 (session_seq), §9.2 (the declared trigger set);
-- 042 §7.1 (reference, never value).
--
-- WHY. Longbox makes one write it does not control: a `productSet` mutation on
-- Shopify's server, which cannot join a Postgres transaction and cannot be
-- rolled back. `src/routes/scanSessions.ts` performs it from inside the request
-- handler and records it afterwards, so a crash between the two leaves a real
-- DRAFT product in a shop's store with no `shopify_draft` row naming it (043 §1
-- E4 — the merged code says so in its own comment). This migration lands the
-- record of INTENT that closes it: the request appends an `outbox` row in the
-- same transaction as the fact that justifies the effect, and a worker performs
-- the effect later, appending one `outbox_attempt` row per try.
--
-- Shape: EXPAND ONLY. Nothing in 001–006 is edited. Every statement is
-- re-runnable (IF NOT EXISTS, or DROP-then-CREATE for triggers and the view,
-- which Postgres has no ADD … IF NOT EXISTS form for).
--
-- HICKEY DISCIPLINE — THE THING THIS MIGRATION DELIBERATELY DOES NOT ADD.
-- There is no `status`, no `claimed_at`, no `locked_at`, no `lease_until` and no
-- `next_attempt_at` column, and no exemption row asking for one. 043 §2.4 is the
-- argument and it is short: a status column beside a complete attempt log is a
-- second, lossy copy of a history the log already holds in full — it can say
-- `failed` but not how many times, when, why, or whether a human asked for the
-- last one. Eligibility (terminal / in flight / due) is a PREDICATE over
-- `outbox_attempt`, evaluated inside the claim transaction, so a crashed
-- worker's row becomes claimable again when its `started` row ages past
-- `attempt_visibility` — not because a reaper repaired state, but because a
-- predicate's inputs changed. There is no reaper, and adding one would mean the
-- predicate was wrong. `src/services/outbox.ts` exports the three predicates so
-- the claim query, the tests and any future view share ONE definition.
--
-- `payload_hash` IS DELIBERATELY ABSENT (043 A6). The draft carried it to detect
-- one event enqueued twice with different envelopes; `UNIQUE (shop_id, event,
-- ref_table, ref_id)` below already makes that case unconstructible, so the
-- column would have existed to catch what the schema forbids — "a place a future
-- engineer will eventually repurpose". If a backfill path ever creates a genuine
-- envelope-drift question, that is a new decision record, not a column reserved
-- in advance.
--
-- NO VALUES, EVER (043 §2.5, 042 §7.1). A row carries a REFERENCE
-- (`ref_table` + `ref_id`) and 041 §2.1's envelope. It never carries the
-- referenced row's values: a copy is a second source of truth (locked decision
-- 4), a copy sits outside 041 §8's purge path, and a copy ages while the row it
-- copied is corrected by supersession. `outbox_attempt.detail` is bounded to
-- codes and references for the same reason plus 019 T35 and 022 P6/P8.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. outbox — platform-owned, append-only. One row per effect that is OWED.
--
--    "Owed" is the whole point: not maybe-sent and not sent-and-unrecorded. If
--    the request rolls back there is no row and no effect; if it commits, the
--    intent is durable and a worker will perform it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id            uuid NOT NULL REFERENCES shop(id),
  scan_session_id    uuid REFERENCES scan_session(id),
  session_seq        bigint,
  event              text NOT NULL,
  ref_table          text NOT NULL,
  ref_id             uuid NOT NULL,
  definition_version text,
  correlation_id     uuid,
  occurred_at        timestamptz,
  authored_by        text NOT NULL CHECK (authored_by IN ('human', 'system', 'provider')),
  operator_id        uuid,
  actor_verified     boolean NOT NULL DEFAULT false,
  actor_role         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_one_effect_per_reference UNIQUE (shop_id, event, ref_table, ref_id),
  -- 041 §5.3, the same shape migration 007's loop gives every other
  -- session-scoped table. Written here rather than by that loop for one reason:
  -- this table does not exist at 007. `src/db/appendOnlyTables.ts` declares
  -- `sessionSeq: true` for it, and `tests/integration/migrations.test.ts`
  -- asserts the LIVE schema against that declaration in both directions — so
  -- omitting either the column or the index below is a red build, not a hole.
  CONSTRAINT outbox_session_seq_positive CHECK (session_seq IS NULL OR session_seq > 0)
);

-- The loud failure if two writers ever compute `max + 1` from the same snapshot.
-- `assignSessionSeq` is only atomic under the `scan_session` anchor lock, which
-- `POST …/draft` holds when it enqueues; this index is the backstop, not the
-- mechanism. Name matches `%_session_seq_idx` because the migrations gate-test
-- looks the set up by that pattern.
CREATE UNIQUE INDEX IF NOT EXISTS outbox_session_seq_idx ON outbox (scan_session_id, session_seq);

COMMENT ON TABLE outbox IS
  'Platform-owned, append-only (043 §2). One row per effect that leaves Longbox, '
  'appended INSIDE the transaction that decided it, so the record of what should '
  'happen and the fact that justifies it commit together or not at all. There is no '
  'status column and no exemption: terminal/in-flight/due are predicates over '
  'outbox_attempt (043 §2.4), which is why a crashed worker needs no reaper. Excluded '
  'from 041 §6.4''s replay drill as a DECLARED row (043 §2.6, §6.4; '
  'src/db/appendOnlyTables.ts, REPLAY_DRILL_EXCLUSIONS) — it is a witness, not a derivation: it records intent AS OF '
  'the enqueue, and outbox_attempt FKs to it.';

COMMENT ON COLUMN outbox.shop_id IS
  'Locked decision 4: every shop-scoped table carries it even in a single-tenant v0. '
  'The claim query filters on it, which is the seam E13-B03 needs for fairness across '
  'shops — the seam, not the policy.';

COMMENT ON COLUMN outbox.session_seq IS
  '041 §5.3, assigned by assignSessionSeq under the scan_session anchor lock. NULL only '
  'where that lock was not held — a shop-scoped effect with no session. THIS IS NOT '
  'BOOKKEEPING: 043 §3.2 promises that WITHIN ONE SESSION events are delivered in '
  'session_seq order, and §7.2''s claim query sorts by (scan_session_id, session_seq '
  'NULLS LAST, created_at). With the column permanently NULL that sort would fall '
  'through to created_at and the only ordering guarantee the design makes would be '
  'unenforced. It is never backfilled — 041 §5.3: "a reconstructed sequence would be a '
  'fabricated observation about what order things happened in". And it is COMMIT order, '
  'not act order (041 §5.3 A4): nothing may present it as when the operator acted.';

COMMENT ON COLUMN outbox.event IS
  'A name from the AUTHORED catalogue in src/events/catalogue.ts (043 §3.3, §3.4). '
  'Nine names, derived from the appends a consumer OUTSIDE the writing module could act '
  'on. The catalogue is authored and never generated: 042 A2 struck a generated one '
  'precisely because generation cannot be wrong, and a list that cannot be wrong cannot '
  'be reviewed. Adding a name is additive within v1; a rename or a removal is a v2 '
  'change and a retired name is retired forever (042 §2.3).';

COMMENT ON COLUMN outbox.ref_table IS
  'The committed witness row this event references. EXACTLY ONE event in the catalogue '
  'is command-shaped and self-references (ref_table = ''outbox'', ref_id = id): '
  'longbox.commerce.draft_requested, whose subject has not happened yet — that is what '
  'a saga step is. 043 §3.4 argues the ugliness rather than working around it, and '
  'tests/contract/event-catalogue.test.ts asserts the count of commands is exactly 1.';

COMMENT ON COLUMN outbox.authored_by IS
  '041 §2.3. ''human'' for an intent a person''s act decided (the draft tap), ''system'' '
  'for one the platform decided. actor_verified stays false until an identity system '
  'exists — an unverified human actor is recorded as unverified rather than as a system '
  'act, because the second would be a lie about who decided.';

COMMENT ON COLUMN outbox.operator_id IS
  'NO FOREIGN KEY, deliberately: app_user does not exist (034 §4.1''s tenancy migration '
  'is unwritten; 043 §6.3 states the same for outbox_attempt). The FK lands with that '
  'migration. Until then the column is unpopulatable, which is the honest state and not '
  'a gap to be filled with a placeholder.';

COMMENT ON CONSTRAINT outbox_one_effect_per_reference ON outbox IS
  'One effect per (shop, event, referenced row). This is what makes enqueueing the same '
  'event twice with a different envelope unconstructible — and therefore what made '
  'payload_hash unnecessary (043 A6).';

-- ---------------------------------------------------------------------------
-- 2. outbox_attempt — the log the lease is DERIVED from.
--
--    `started` before the effect, then exactly one terminal row after it. A
--    `started` with no terminal partner IS the record of a crash, readable by a
--    human without a log file — and without it the attempt count would
--    undercount exactly the failures that matter most (043 §5.1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox_attempt (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shop(id),
  outbox_id   uuid NOT NULL REFERENCES outbox(id),
  attempt_no  integer NOT NULL CHECK (attempt_no >= 1),
  kind        text NOT NULL
    CHECK (kind IN ('started', 'delivered', 'failed', 'dead_lettered', 'replay_requested')),
  detail      jsonb,
  operator_id uuid,
  reason      text,
  authored_by text NOT NULL CHECK (authored_by IN ('human', 'system', 'provider')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_attempt_one_row_per_kind UNIQUE (outbox_id, attempt_no, kind),
  -- 043 §6.3: "a replay names a person and states why", enforced by a CHECK and
  -- not by a handler — 041 §2.3's "stop forbidding a thing and start making it
  -- unrepresentable". A replay is the one row in this design that could quietly
  -- re-run an external effect, so a nullable author is an invitation.
  --
  -- ⚠ This CHECK makes `replay_requested` UNWRITABLE today, and that is correct
  -- rather than unfortunate: operator_id has no app_user to name (034 §4.1), so
  -- 043 §6.3 rules that the replay path is not built before it (E10-B09). The
  -- constraint exists now so the rule cannot be forgotten when the table does
  -- land, and so nothing writes a replay with no author in the meantime.
  CONSTRAINT outbox_attempt_replay_names_a_person CHECK (
    kind <> 'replay_requested'
    OR (operator_id IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason)) > 0)
  )
);

COMMENT ON TABLE outbox_attempt IS
  'Platform-owned, append-only (043 §5). Every attempt to perform an owed effect '
  'appends here: ''started'' before the effect, then exactly one of ''delivered'', '
  '''failed'' or ''dead_lettered'' after it. This log is the ONLY state the drain has — '
  'terminal, in-flight and due are computed from it (043 §2.4). A replay appends '
  '''replay_requested'' plus a fresh started/terminal pair; it never edits a prior row '
  '(043 §6.2, 022 P2). What happened when Longbox tried to reach Shopify exists nowhere '
  'else, which is why the parent table is as durable as this child.';

COMMENT ON COLUMN outbox_attempt.detail IS
  'STRUCTURED AND BOUNDED: an HTTP status, a provider error CODE, a reference id, a '
  'duration, and reason_code on a refusal. NEVER a response body, a provider exception '
  'message, an operator name, a model or provider name, a percentage or any shop '
  'content (043 §2.5, §11 I6; 042 §4.3; 022 P6/P8; 021 B16/B19; 019 T35). '
  'src/services/outbox.ts declares the allowlisted keys and '
  'tests/contract/outbox-carries-no-values.test.ts asserts them.';

COMMENT ON COLUMN outbox_attempt.attempt_no IS
  'The attempt number, and therefore the state: 043 §5.1. The UNIQUE below makes a '
  'duplicate attempt row a loud failure rather than a silent second history — the same '
  'construction 041 §5.3 uses for UNIQUE (scan_session_id, session_seq).';

COMMENT ON COLUMN outbox_attempt.created_at IS
  'SERVER-SIDE now(), evaluated inside the claim transaction — never a worker or client '
  'wall clock (043 A7). The in-flight predicate compares this against now(), so it is '
  'correct only while attempt_visibility exceeds the worst-case clock skew across every '
  'host that runs a worker. One host makes the assumption vacuous today; E13-B03''s '
  'second worker is what makes it load-bearing, and NTP or a monotonic source beyond a '
  'single host is a requirement rather than an operational nicety.';

COMMENT ON COLUMN outbox_attempt.operator_id IS
  'NO FOREIGN KEY: app_user does not exist (034 §4.1). 043 §6.3 records this exactly — '
  'the CHECK is specified, the column is unpopulatable, and the replay path is not built '
  'before the tenancy migration lands.';

-- ---------------------------------------------------------------------------
-- 3. Indexes.
--
--    ⚠ E02-B10 OWNS THE FINAL INDEX SHAPE, the expand/contract order and the
--    rollback (043 §9.1 row 1). What is here is the minimum the claim query and
--    the eligibility predicate need to be indexed rather than sequential; it is
--    not a tuned plan and no benchmark is claimed. 043 §2.4 states the cost
--    honestly — the predicate is a NOT EXISTS and a newest-attempt lookup over a
--    child table rather than an index scan on a column — and states the escape
--    hatch under load: a materialized index over the log (041 §6.2's first form,
--    keys only, maintained in the same transaction), NEVER a status column.
-- ---------------------------------------------------------------------------

-- The claim query's driving scan: per shop, in the drain order 043 §7.2 fixes.
CREATE INDEX IF NOT EXISTS outbox_claim_idx
  ON outbox (shop_id, scan_session_id, session_seq, created_at);

-- The eligibility predicate's three questions all hang off this child lookup.
CREATE INDEX IF NOT EXISTS outbox_attempt_by_outbox_idx
  ON outbox_attempt (outbox_id, created_at DESC, id DESC);

-- Terminal membership (`delivered` / `dead_lettered`) is the NOT EXISTS half.
CREATE INDEX IF NOT EXISTS outbox_attempt_kind_idx
  ON outbox_attempt (outbox_id, kind);

-- The dead-letter view scans per shop, newest first.
CREATE INDEX IF NOT EXISTS outbox_attempt_shop_idx
  ON outbox_attempt (shop_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. shopify_draft gains the job reference that makes the draft consumer
--    idempotent BY CONSTRAINT.
--
--    ⚠ THIS IS AN ADDITION BEYOND 043 §9.1'S ENUMERATED MIGRATION ROWS, and it
--    is made deliberately rather than absorbed quietly. Two lines of that record
--    require it together:
--
--      * §1 E11 names the defect — "`shopify_draft` has no idempotency key, no
--        attempt count and NO JOB REFERENCE … so 'which attempt produced this
--        row' … is unanswerable by construction";
--      * §11 I5(b), an E02-D07 acceptance line under A2, requires that a
--        consumer's idempotency be enforced by a DATABASE CONSTRAINT or a
--        provider-side natural key, and that "the losing path raises a UNIQUE
--        VIOLATION, proving the mechanism is a constraint and not a read-then-
--        write check".
--
--    043 §4.3's `customId` upsert supplies the provider-side half — two
--    concurrent deliveries produce ONE Shopify product. Without this column the
--    Postgres half has nothing to enforce, and the only remaining way to get one
--    `shopify_draft` row would be SELECT-then-INSERT, which is exactly the shape
--    §3.2 forbids and `tests/contract/consumer-write-shape.test.ts` lints for.
--    So the constraint is not a convenience: it is what lets the draft consumer
--    obey the rule the same record sets.
--
--    NULLABLE, and the NULL has ONE meaning (030 A1): "this draft row was
--    written by a request, not by a job". Every row written before this bead
--    carries NULL and that is the truth about them. The uniqueness is PARTIAL
--    for the same reason — many NULLs, at most one row per job.
-- ---------------------------------------------------------------------------
ALTER TABLE shopify_draft ADD COLUMN IF NOT EXISTS outbox_id uuid REFERENCES outbox(id);

CREATE UNIQUE INDEX IF NOT EXISTS shopify_draft_outbox_uniq
  ON shopify_draft (outbox_id) WHERE outbox_id IS NOT NULL;

COMMENT ON COLUMN shopify_draft.outbox_id IS
  'The outbox row whose job wrote this draft, or NULL when a REQUEST wrote it — one '
  'meaning, not two (030 A1). The partial UNIQUE index on it is what makes the '
  'draft_requested consumer idempotent under CONCURRENT duplicate delivery by a '
  'constraint rather than by a read-then-write check (043 §3.2, §11 I5(b)): the second '
  'writer raises a unique violation and absorbs it, having already been handed the same '
  'Shopify product by 043 §4.3''s customId upsert.';

-- ---------------------------------------------------------------------------
-- 5. Append-only triggers, in 003:237-248's idempotent DROP-then-CREATE form,
--    followed immediately by ENABLE ALWAYS.
--
--    THE `ENABLE ALWAYS` IS NOT OPTIONAL AND IS NOT DEFERRED TO A LATER
--    MIGRATION. `CREATE TRIGGER` always lands at tgenabled='O', which one
--    `SET session_replication_role='replica'` turns off for the rest of the
--    session (006 reproduces it). Migration 006 promoted the fourteen tables
--    that existed then; a fifteenth and sixteenth created here at the default
--    would be governed by a trigger anyone could step around, and
--    src/services/appendOnlyDetector.ts would fail the boot check — correctly,
--    and only after someone deployed it.
--
--    Both tables MUST also be declared in src/db/appendOnlyTables.ts in this
--    same change: tests/integration/migrations.test.ts asserts equality against
--    pg_trigger in BOTH directions, and src/db/appRoleGrants.ts refuses to grant
--    anything to a live table that neither declared list names.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['outbox', 'outbox_attempt'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()',
      t || '_append_only', t);
    EXECUTE format('ALTER TABLE %I ENABLE ALWAYS TRIGGER %I', t, t || '_append_only');
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. The dead-letter queue is a VIEW, not a table (043 §5.4).
--
--    A second table would hold a copy of rows that already exist — locked
--    decision 4's prohibition, and 041 §6.4's "if dropping it loses information,
--    it is not a read model". A view loses nothing and cannot drift.
--
--    `guard_refusal` is A5 made structural. A dead letter from a Shopify 500 is
--    a provider problem and belongs in 019 T17's "declared provider outage"
--    arithmetic. A dead letter carrying 'listing_left_draft' or
--    'no_observation_evidence' is NOT a failure — it is 043 §4.3's guard
--    WORKING, refusing to touch a listing whose state Longbox cannot vouch for.
--    Counted together, a guard doing its job reads as a reliability problem and
--    a reliability problem reads as a guard doing its job, so the distinction is
--    a column here rather than a convention in whoever writes the report.
--
--    `replay_requested_after` exists so "a dead letter nobody has looked at" is
--    answerable without a second query. The review window's N is E13-B01's and
--    no number is set here.
-- ---------------------------------------------------------------------------
-- `CREATE OR REPLACE` rather than DROP-then-CREATE: this migration is EXPAND
-- ONLY, and a bare `DROP VIEW` is a contract step even when it is immediately
-- followed by a create. Replace is idempotent here because the view is new — it
-- has no existing column list for the replace to conflict with — and it keeps
-- the file free of a destructive statement a reader (or an expand/contract lint)
-- would have to reason about.
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
  (a.detail ->> 'reason_code') IN ('listing_left_draft', 'no_observation_evidence')
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
  'The dead-letter queue, DERIVED (043 §5.4). guard_refusal separates 043 §4.3''s two '
  'refusals — listing_left_draft and no_observation_evidence — from the T17 aggregate: '
  'they are a queue of listings awaiting a human look, not a count of failures (043 A5). '
  'Nothing re-drives a row here automatically, ever (043 §5.5): a replay is a human act '
  'with a record.';

COMMIT;
