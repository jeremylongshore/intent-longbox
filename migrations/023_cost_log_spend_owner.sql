-- 023_cost_log_spend_owner.sql — E03-B05 (bead longbox-e5b.3.5), the code half.
--
-- 050 §2 Q4(a), §6, §10 row 3: **every cost row names whose money bought the
-- call.** Docs: 050 §1 E7/E12, §2 Q4, §6.1–§6.6, §9 I4/I5/I8, §10; 029 §2.8 /
-- §5 move 7 (V5) (the single-writer rule this leans on); 019 T13a, T15, T35;
-- 022 P3; 042 §8.4; 044 §2.
--
-- WHAT WAS BROKEN, REPRODUCED IN 050 §1 E7/E12. `cost_log` records provider,
-- model, tokens and an estimated dollar figure — and nothing about which
-- credential paid. A shop with no credential row spends the estate's key
-- silently: no row, no flag and no report says whose money bought the call. 019
-- T13a is cost per verified draft and T15 is the variable-cost line; both read
-- this table; and this table cannot currently distinguish a call the shop paid
-- for from one Longbox did. **That is not a reporting gap. It is a ledger that
-- mixes two people's money.**
--
-- DERIVED, NEVER DECLARED (050 §6.2). `spend_owner` is computed inside
-- `appendCostLog` from `credential_version_id` — non-null means a live per-shop
-- credential version resolved the call, so `shop`; null means the global
-- environment or the gateway override did, so `longbox`. `appendCostLog`'s
-- signature accepts no caller-supplied owner, because a caller that can pass an
-- owner in is a caller that can attribute a Longbox call to a shop. The rule is
-- ENFORCEABLE because `appendCostLog` is the single writer of this table — 029
-- §2.8 / §5 move 7 (V5), checked by `pnpm arch`
-- (`scripts/architectureRules.ts` `checkCostLogWriters`, 044 §6) — so the column
-- is populated in one function and cannot be half-populated by a caller that
-- forgot.
--
-- TWO VALUES AND NO `unknown` (050 §2 Q4(a)). A call whose owner cannot be
-- determined is a call that should not have been made.
--
-- ⚠ WHY THE CONSTRAINT IS `NOT VALID` AND NOT A `SET NOT NULL`. 050 requires
-- `spend_owner` NOT NULL. `ALTER COLUMN … SET NOT NULL` is one of 044 §2's four
-- CONTRACTING shapes — the lint refuses it without a `-- contract:` header — and
-- it would fail outright against any database holding pre-existing `cost_log`
-- rows. Those rows CANNOT be backfilled, and that is the honest position rather
-- than an inconvenience: 050 §1 E12 is precisely that nothing in the system
-- records whose money paid for a historical call, so writing `longbox` (or
-- `shop`) into them would be inventing an attribution for a ledger that 019
-- T13a and T15 are measured from.
--
-- So the shape is 019's `shop.organization_id` precedent (E03-D09, `019:31-40`),
-- with one adaptation: there the column was populated in the same transaction and
-- the CHECK could be validated; here it cannot, so the constraint is declared
-- `NOT VALID`. **`NOT VALID` still enforces on every INSERT and UPDATE** — it
-- only skips the scan of rows that already exist. New rows must name an owner;
-- old rows keep their honest silence. Converting it to a true `NOT NULL` is a
-- one-line contract step for the day the historical rows are gone, and it is not
-- this bead's (044 §2).
--
-- ADD COLUMN is DDL, so `cost_log_append_only` neither refuses it nor should:
-- the trigger governs rows, not shape. `012` established that precedent on this
-- same table (`012:35`).
--
-- SHAPE: EXPAND ONLY. Two `ADD COLUMN IF NOT EXISTS`, one constraint added under
-- the DROP-then-ADD idiom, one partial index. Nothing dropped, nothing retyped,
-- no `SET NOT NULL`, no `-- contract:` header (044 §2).

BEGIN;

ALTER TABLE cost_log ADD COLUMN IF NOT EXISTS spend_owner text;
ALTER TABLE cost_log ADD COLUMN IF NOT EXISTS credential_version_id uuid
  REFERENCES shop_credential_version(id);

COMMENT ON COLUMN cost_log.spend_owner IS
  'Whose money bought this call: ''shop'' (a live per-shop credential version resolved it) or '
  '''longbox'' (the global environment or the gateway override did). DERIVED inside '
  'appendCostLog from credential_version_id, never accepted from a caller (050 §6.2). NOT NULL '
  'for every row written after 023; NULL only on rows that predate it, which cannot be '
  'attributed without inventing the fact (050 §1 E12).';

COMMENT ON COLUMN cost_log.credential_version_id IS
  'The credential VERSION that paid, or NULL when Longbox''s own account did — ONE meaning, '
  'not two (030 A1, as 012 applies it). A REFERENCE and never a value: 041 §8.4''s move — the '
  'log holds references, not values — which is why there is no key_ref here and certainly no key.';

-- The NOT NULL half, as a constraint the append-only trigger has no quarrel with.
ALTER TABLE cost_log DROP CONSTRAINT IF EXISTS cost_log_has_a_spend_owner;
ALTER TABLE cost_log ADD CONSTRAINT cost_log_has_a_spend_owner
  CHECK (spend_owner IS NOT NULL AND spend_owner IN ('shop','longbox')) NOT VALID;

-- ---------------------------------------------------------------------------
-- WHAT THIS TABLE MUST NEVER GAIN (050 §6.6, and it is worth a line in the
-- schema rather than only in a record). `cost_log` gains a CREDENTIAL dimension
-- and never an OPERATOR one. 019 T35 is non-waivable and 022 P3 forbids the
-- surface, not the signal: a per-operator cost figure is per-operator telemetry
-- with a dollar sign on it. §9 I8 asserts the negative over the generated
-- OpenAPI document — no route may accept an operator identifier as a filter, a
-- sort or a grouping parameter on any of these columns.
-- ---------------------------------------------------------------------------

-- Partial: `longbox`-owned rows carry NULL here, and the only query this column
-- serves is "what did version X spend" — 012's reasoning for `cost_log_outbox_idx`.
CREATE INDEX IF NOT EXISTS cost_log_credential_version_idx
  ON cost_log (credential_version_id) WHERE credential_version_id IS NOT NULL;

-- The owner's weekly report reads by (shop, owner, time) — 050 §6.5, rendered by
-- E11-B06. This index is the read path; the SENTENCE is a candidate C-row for
-- 021 under the T26 pre-send and is deliberately not written anywhere here.
CREATE INDEX IF NOT EXISTS cost_log_spend_owner_idx
  ON cost_log (shop_id, spend_owner, created_at DESC);

COMMIT;
