-- 009_request_idempotency.sql — E02-B10 (bead longbox-e5b.2.10)
--
-- 042 §5.2's table, exactly as specified, and NOTHING ELSE. Docs: 042 §5.1–§5.5,
-- 041 §8.5 / A11, 040 §8.1 item 3, 000-docs/044 §5.
--
-- ⚠ THE TABLE ONLY — NO ROUTE WIRING. Every mutating handler is meant to INSERT
-- its idempotency row first, do the work, then complete the row, all in one
-- transaction on one held connection (042 §5.3(a), I21). That wiring is E02-B08's:
-- it changes the request contract (an `Idempotency-Key` header becomes required),
-- it needs the `v1` route surface 042 §2 defines, and it needs the canonical
-- request hash of §5.4. Landing the table now is what lets the lock-order lint
-- (042 I22) exist BEFORE the first handler that could violate it, which is the
-- whole point of a rule that exists for "a handler written six months from now by
-- someone who has not read this section."
--
-- EXEMPT FROM THE APPEND-ONLY TRIGGER SET, AS A DECLARED ROW WITH ITS REASON
-- (041 A11, Q7 answered yes; the row lives in src/db/appendOnlyTables.ts). Three
-- reasons, and the third was added by 042 A5:
--   1. It is not a witness table. It records only what this server replied to a key
--      it has already seen; deleting an expired key destroys no history.
--   2. It holds response BODIES, which must be sweepable so a deletion right can be
--      honoured — "a table that stores response bodies and cannot delete a row
--      cannot honour a deletion right."
--   3. The row is UPDATEd by construction: §5.3 writes it, then completes it with
--      the response. That is legal precisely because of the exemption.
-- This REVERSES 040 §8.1 item 6, which put a trigger on it (041 §8.5 records the
-- reversal). Its retention window is E13-B01's; nothing here sets one, and nothing
-- may assume one.
--
-- NO STATUS COLUMN, NO IN-FLIGHT STATE, NO LEASE, NO TIMEOUT (042 §5.3). The
-- obvious design has three states and a status column to hold them; the UNIQUE
-- constraint already expresses it. A concurrent request with the same key blocks on
-- `UNIQUE (shop_id, idempotency_key)` until the first transaction resolves: if the
-- first commits, the second gets a unique violation and returns the stored
-- response; if it rolls back, the second's insert succeeds and it does the work,
-- which is also correct because nothing happened. That is 041 §4.2's preference
-- order — "a constraint, where one exists — always preferred" — paying for itself.
--
-- SHAPE: EXPAND ONLY, `CREATE TABLE IF NOT EXISTS`, re-runnable by hand.

BEGIN;

CREATE TABLE IF NOT EXISTS request_idempotency (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Locked decision 4: `shop_id` on every shop-scoped table, even in single-tenant v0.
  shop_id          uuid NOT NULL REFERENCES shop(id),
  idempotency_key  text NOT NULL,
  -- The route TEMPLATE, not the resolved path: `/api/v1/shops/:shopId/scan-sessions/:id/confirm`.
  -- A resolved path would make the same logical route look like one row per session.
  route            text NOT NULL,
  -- 042 §5.4: SHA-256 over a canonical serialization of (method, route template,
  -- resolved path parameters, request body). Sorted keys, no insignificant
  -- whitespace, NO FUZZY COMPARISON EVER — the hash class is pinned the way 041 A5
  -- pins `content_hash`, because a hash whose matching rule is negotiable is a hash
  -- whose meaning drifts. Canonicalisation is part of the `v1` contract: changing
  -- it changes which retries are recognised and is therefore a `v2` change.
  request_hash     text NOT NULL,
  -- ⚠ NULLABLE, and this DEPARTS from 042 §5.2's column list — which says
  -- `NOT NULL` on both and is, as written, impossible to satisfy. 042 §5.3 step 1
  -- is explicit that the handler "INSERTs the `request_idempotency` row first,
  -- inside `withTransaction`, then does the work, then updates the row's response
  -- fields". At INSERT time the response does not exist yet, so `NOT NULL` here
  -- makes the ratified sequence unimplementable — the two halves of that record
  -- contradict each other and §5.3 is the half with the argument behind it.
  --
  -- A NULL response therefore MEANS "in flight", and that does not reintroduce the
  -- status column §5.3 removed: §5.3's point is that no reader ever consults such a
  -- state, because a concurrent request with the same key BLOCKS on the unique
  -- constraint until the first transaction resolves and then sees either a
  -- committed row (complete, by construction) or no row at all (rolled back). The
  -- in-flight row is unobservable from outside the writing transaction, so the
  -- nullability is a fact about the write sequence rather than a state machine.
  -- Recorded as 042 v1.2.0 with a 006 decision-log row.
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, idempotency_key)
);

COMMENT ON TABLE request_idempotency IS
  'Operational replay cache (042 §5.2), platform-owned. NOT a witness table: exempt from the '
  'append-only trigger set as a declared row in src/db/appendOnlyTables.ts (041 §8.5 / A11). '
  'Rows are UPDATEd to carry their response (042 §5.3) and swept on E13-B01''s window.';

COMMIT;
