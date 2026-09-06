// THE PRIVACY WORKFLOW — the CLOCK on a request Shopify requires an app to
// handle, and the fact that answers it.
//
// Bead: longbox-e5b.3.8 (alias E03-B08). Docs: 000-docs/064 (the decision);
// 053 §5.5, §9 (the three topics are acknowledged, recorded and ROUTED);
// 041 §2.5, §8.4 (an external observation; the log holds references and never
// personal values); 043 §2.4 (outstanding is a PREDICATE, never a status
// column); 022 P3; 019 T32; 029 §2.11 (a tenth privacy module was declined, so
// this is ONE file inside platform rather than a boundary).
//
// ============================================================================
// WHAT THIS FILE OWNS, AND THE MUCH LARGER THING IT DOES NOT
// ============================================================================
//
// It owns the WORKFLOW: that an obligation is recorded when it arrives, that it
// has a moment by which somebody must have answered, that the answer is a fact
// with an author, and that an unanswered one is FINDABLE. That is what stops the
// failure 053 §9 names — "a privacy request this system silently discarded is
// the failure that reads as compliance until somebody asks".
//
// It does NOT own the POLICY. What a person is entitled to, on what clock, what
// they are told, and what deletion actually removes is E03-B09's bead and
// E01-B06's counsel engagement. Nothing here cites a statute, and nothing here
// may be read as legal advice: `PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS` is a
// PROVISIONAL floor this repository chose so that silence is detectable, and it
// is not anybody's deadline.
//
// ============================================================================
// IT HOLDS NO CUSTOMER IDENTIFIER, AND COULD NOT
// ============================================================================
//
// The message names a person. This module writes a DIGEST of the signed bytes
// and never the bytes, so nothing here can be searched for a person and nothing
// here can leak one. That is 041 §8.4's rule, and on this table it is also the
// only coherent posture: a redaction request whose record copied the identifier
// would be a second copy of the thing the request asks this system to be rid of.

import type { Queryable, Tx } from "../db.js";
import { PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS } from "./connectors/shopify/policy.js";

/**
 * What was done about a request. Mirrors the CHECK in `migrations/038` — the
 * database is the enforcement and this is the vocabulary.
 */
export const PRIVACY_OUTCOMES = ["no_data_held", "data_exported", "data_erased", "not_applicable"] as const;
export type PrivacyOutcome = (typeof PRIVACY_OUTCOMES)[number];

/**
 * HOW the outcome was reached. `scope_policy` is the only member a machine may
 * write, and the database's CHECK ties it to `authored_by = 'system'` with no
 * operator — so a person's answer can never be attributed to the machine or the
 * reverse.
 */
export const PRIVACY_FULFILMENT_METHODS = ["scope_policy", "operator", "deletion_procedure"] as const;
export type PrivacyFulfilmentMethod = (typeof PRIVACY_FULFILMENT_METHODS)[number];

export interface RecordPrivacyRequestArgs {
  /** NULL when the signed store matches no install — 053 §5.5's nullable tenant, one table over. */
  readonly shopId: string | null;
  readonly connector: string;
  readonly topic: string;
  readonly webhookId: string;
  readonly webhookReceiptId: string;
  readonly shopDomain: string;
  readonly payloadDigest: string;
  /** Overridable for tests; the default is the PROVISIONAL floor in `policy.ts`. */
  readonly windowDays?: number;
}

export interface PrivacyRequestRow {
  readonly id: string;
  readonly shopId: string | null;
  readonly topic: string;
  readonly dueAt: Date;
  /** TRUE when `UNIQUE (connector, webhook_id)` already held this obligation. */
  readonly alreadyRecorded: boolean;
}

/**
 * Append the obligation, on the caller's transaction handle.
 *
 * `tx` is a `Tx` and not a `Queryable` for `enqueue`'s reason (041 §4.1): the
 * request row and the receipt that evidences it commit together or not at all,
 * and a `pg.Pool` accepted here would let them come apart.
 *
 * `ON CONFLICT DO NOTHING` then read back — the INSERT **is** the duplicate check
 * (041 §4.2(i)'s constraint-over-lock preference), so a redelivery is decided by
 * the database rather than by a read this code performed first.
 *
 * `due_at` is computed here and STORED rather than derived on read: a window
 * changed next year must not silently restate what was owed last year (041
 * §5.3's rule about reconstructed observations, applied to a deadline).
 */
export async function recordPrivacyRequest(
  tx: Tx,
  args: RecordPrivacyRequestArgs
): Promise<PrivacyRequestRow> {
  const windowDays = args.windowDays ?? PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS;
  const inserted = await tx.query(
    `INSERT INTO privacy_request
       (shop_id, connector, topic, webhook_id, webhook_receipt_id, shop_domain,
        payload_digest, due_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8::int))
     ON CONFLICT (connector, webhook_id) DO NOTHING
     RETURNING id, shop_id, topic, due_at`,
    [
      args.shopId,
      args.connector,
      args.topic,
      args.webhookId,
      args.webhookReceiptId,
      args.shopDomain,
      args.payloadDigest,
      windowDays,
    ]
  );
  const first = inserted.rows[0] as
    { id: string; shop_id: string | null; topic: string; due_at: Date } | undefined;
  if (first) {
    return {
      id: first.id,
      shopId: first.shop_id,
      topic: first.topic,
      dueAt: first.due_at,
      alreadyRecorded: false,
    };
  }
  const existing = await tx.query(
    `SELECT id, shop_id, topic, due_at FROM privacy_request WHERE connector = $1 AND webhook_id = $2`,
    [args.connector, args.webhookId]
  );
  const row = existing.rows[0] as
    { id: string; shop_id: string | null; topic: string; due_at: Date } | undefined;
  if (!row) {
    throw new Error(
      `recordPrivacyRequest: the conflict was absorbed but no existing row was found for ` +
        `${args.connector}/${args.webhookId}. That is a tenant-context defect rather than a race: ` +
        `the read back runs under the same context as the INSERT.`
    );
  }
  return {
    id: row.id,
    shopId: row.shop_id,
    topic: row.topic,
    dueAt: row.due_at,
    alreadyRecorded: true,
  };
}

export interface RecordFulfilmentArgs {
  readonly shopId: string | null;
  readonly privacyRequestId: string;
  readonly outcome: PrivacyOutcome;
  readonly method: PrivacyFulfilmentMethod;
  /** A person, for the two methods a person performs. NULL for `scope_policy`. */
  readonly operatorId?: string | null;
}

/**
 * Append the answer. Returns FALSE when one was already recorded.
 *
 * `ON CONFLICT DO NOTHING` on `UNIQUE (privacy_request_id)` is what makes the
 * consumer idempotent under the CONCURRENT duplicate delivery that at-least-once
 * plus `SKIP LOCKED` makes constructible (043 §3.2: "a consumer's idempotency is
 * enforced by a database constraint or by a provider-side natural key, never by a
 * read-then-write check"). There is deliberately no prior SELECT.
 */
export async function recordFulfilment(db: Queryable, args: RecordFulfilmentArgs): Promise<boolean> {
  const authoredBy = args.method === "scope_policy" ? "system" : "human";
  const operatorId = args.method === "scope_policy" ? null : (args.operatorId ?? null);
  const res = await db.query(
    `INSERT INTO privacy_request_fulfilment
       (shop_id, privacy_request_id, outcome, method, operator_id, authored_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (privacy_request_id) DO NOTHING
     RETURNING id`,
    [args.shopId, args.privacyRequestId, args.outcome, args.method, operatorId, authoredBy]
  );
  return res.rows.length === 1;
}

export interface OutstandingPrivacyRequest {
  readonly privacyRequestId: string;
  readonly shopId: string | null;
  readonly topic: string;
  readonly shopDomain: string;
  readonly receivedAt: Date;
  readonly dueAt: Date;
  readonly overdue: boolean;
  /**
   * K6 (consistency lens) — WHY this one is still outstanding, when the queue
   * knows.
   *
   * The lens's point was a usability gap with a correctness edge: an overdue row
   * did not say whether its job had DEAD-LETTERED, whether it is a `shop/redact`
   * that was never going to be automated, or whether it is a null-tenant request
   * that got no job at all (R2). An operator who cannot tell those apart triages
   * by guessing, and the first of the three is the one that needs a person now.
   *
   * `null` means no dead letter — which covers both remaining cases, and the
   * topic column tells them apart.
   */
  readonly deadLetterReason: string | null;
}

/**
 * Every request with no fulfilment fact, oldest first, with the dead-letter
 * reason when the queue has one.
 *
 * ⚠ **THE OVERDUE PREDICATE STAYS IN THE VIEW AND IS NOT RESTATED HERE** (K6's
 * constraint on its own fix). The join adds a COLUMN and changes no row: the
 * `FROM` is still `privacy_request_outstanding` and `overdue` is still that
 * view's, so the CLI, any future report and the tests cannot come to disagree
 * about what *outstanding* means — which is the property the lens called good and
 * asked not to lose while closing the usability gap beside it.
 *
 * The join is LEFT and on `(ref_table, ref_id)` because `outbox_dead_letter` is a
 * view over the attempt log, not a table with a foreign key: a request with no
 * job (a `shop/redact`, or any null-tenant one) has nothing to match and reads
 * `null`, which is correct rather than missing.
 *
 * ⚠ **`DISTINCT ON` IS WHY *adds a column and changes no row* IS TRUE, and the
 * gate re-audit was right to ask what it rested on.** `outbox_dead_letter` is one
 * row per DEAD-LETTERED ATTEMPT, so the join is one-to-MANY in principle and a
 * plain `LEFT JOIN` would duplicate an outstanding request the day a second dead
 * letter existed for one outbox row. The alternative defence — *a dead letter is
 * terminal and nothing writes `replay_requested` today* — is a property of the
 * code at this commit rather than of the query, and 043 §5.5 explicitly
 * anticipates a human re-drive. `DISTINCT ON (o.privacy_request_id)` makes the
 * cardinality a property of the STATEMENT: newest dead letter wins, one row per
 * request, whatever the attempt log grows.
 */
export async function outstandingPrivacyRequests(
  db: Queryable
): Promise<readonly OutstandingPrivacyRequest[]> {
  const res = await db.query(
    // The `DISTINCT ON` needs `privacy_request_id` first in ITS order, so the
    // caller's "oldest first" is applied outside it. Two orderings, each doing
    // one job, rather than one that silently does neither.
    // The outer projection NAMES its columns (042 I5): a star here would ship
    // whatever the inner query grows, which is exactly the shape that put
    // `scan_session.status` in a response body 040 spent a document retiring.
    // (The rule matches TEXT and does not strip comments, so this sentence
    // deliberately does not spell the two characters it is about.)
    `SELECT d.privacy_request_id, d.shop_id, d.topic, d.shop_domain, d.received_at, d.due_at,
            d.overdue, d.dead_letter_reason
       FROM (
       SELECT DISTINCT ON (o.privacy_request_id)
              o.privacy_request_id, o.shop_id, o.topic, o.shop_domain, o.received_at, o.due_at,
              o.overdue, d.reason_code AS dead_letter_reason
         FROM privacy_request_outstanding o
         LEFT JOIN outbox_dead_letter d
                ON d.ref_table = 'privacy_request' AND d.ref_id = o.privacy_request_id
        -- attempt_no breaks a tie on the timestamp, so newest-wins is TOTAL
        -- rather than newest-wins-unless-two-share-a-clock-tick. Two dead
        -- letters for one outbox row is the case 043 section 5.5's human
        -- re-drive creates, and created_at is now() inside a transaction, so two
        -- attempts recorded in one transaction carry the SAME timestamp -- at
        -- which point an unqualified DISTINCT ON picks whichever row the planner
        -- happened to reach first. A non-deterministic answer is worse than a
        -- wrong one, because it does not reproduce.
        ORDER BY o.privacy_request_id, d.dead_lettered_at DESC NULLS LAST, d.attempt_no DESC
     ) d
      ORDER BY d.received_at ASC`
  );
  return (
    res.rows as Array<{
      privacy_request_id: string;
      shop_id: string | null;
      topic: string;
      shop_domain: string;
      received_at: Date;
      due_at: Date;
      overdue: boolean;
      dead_letter_reason: string | null;
    }>
  ).map((r) => ({
    privacyRequestId: r.privacy_request_id,
    shopId: r.shop_id,
    topic: r.topic,
    shopDomain: r.shop_domain,
    receivedAt: r.received_at,
    dueAt: r.due_at,
    overdue: r.overdue,
    deadLetterReason: r.dead_letter_reason,
  }));
}

/** One row of the audit's counts: how many requests on a topic reached an outcome. */
export interface PrivacyAuditBucket {
  readonly topic: string;
  /** NULL for a request nobody has answered yet. */
  readonly outcome: string | null;
  readonly requests: number;
}

/**
 * Counts by topic and outcome. **Counts and never a payload** — the table holds
 * none — and never a person: `operator_id` is deliberately not projected, on 022
 * P3's rule that an audit surface reports the WORK and not the worker.
 */
export async function privacyRequestCounts(db: Queryable): Promise<readonly PrivacyAuditBucket[]> {
  const res = await db.query(
    `SELECT r.topic AS topic, f.outcome AS outcome, count(*)::int AS requests
       FROM privacy_request r
       LEFT JOIN privacy_request_fulfilment f ON f.privacy_request_id = r.id
      GROUP BY r.topic, f.outcome
      ORDER BY r.topic ASC, f.outcome ASC NULLS FIRST`
  );
  return (res.rows as Array<{ topic: string; outcome: string | null; requests: number }>).map((r) => ({
    topic: r.topic,
    outcome: r.outcome,
    requests: r.requests,
  }));
}
