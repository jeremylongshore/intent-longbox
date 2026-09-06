// The `longbox.platform.privacy_request_received` consumer.
//
// Bead: longbox-e5b.3.8 (alias E03-B08). Docs: 000-docs/064 §7 (the guard and
// what makes `no_data_held` a CHECKABLE claim rather than a comfortable one);
// 053 §6 (the scopes, argued one at a time — the absence this consumer stands
// on) and §9 (the three topics are acknowledged, recorded and ROUTED); 043 §3.2
// (idempotency by constraint), §4.3 and A3 (a guard that FAILS CLOSED), §5.4
// (the dead letter is where a refusal becomes visible); 041 §8.4; 022 P3.
//
// ============================================================================
// WHY THIS IS A JOB AND NOT A LINE IN THE WEBHOOK'S OWN TRANSACTION
// ============================================================================
//
// Because it can REFUSE. Everything else the webhook path does either succeeds
// or is a constraint absorbing a duplicate; this one asks a question about the
// store's recorded grants and must stop when the answer is not the expected one.
// A fail-closed guard inside the acknowledgement transaction has only two
// endings, and both are bad: a 500 to Shopify, which is a retry storm and
// eventually an app whose webhooks the provider disables (053 §5.5 names that
// hazard in as many words), or a swallowed exception, which is the silent
// discard 053 §9 exists to prevent. On the outbox the refusal is a DEAD LETTER —
// visible, attributable, and never automatically re-driven (043 §5.5).
//
// ============================================================================
// WHAT `no_data_held` ACTUALLY CLAIMS, AND THE THREE THINGS THAT MAKE IT TRUE
// ============================================================================
//
// It claims: this system holds nothing about the person the message names. That
// is not an assurance somebody wrote down; it stands on three separate facts,
// two pinned by tests in the tree and one checked here at runtime.
//
//   1. **No scope this connector may request reads a customer.** `053 §6`'s
//      declared maximum is `write_products` + `read_products`, and
//      `tests/connector-oauth.test.ts` pins it literally (053 I5), and
//      `tests/webhook-replay-policy.test.ts` re-asserts that no customer-bearing
//      scope is inside it. A scope outside the maximum REFUSES the install,
//      two-sidedly.
//   2. **No code path calls a customer-bearing endpoint.** `tests/contract/
//      no-customer-read-path.test.ts` asserts it over the connector and the
//      Shopify client, because a scope this app never asked for is still not the
//      same statement as a call this app never makes.
//   3. **No RECORDED grant for that store carries a customer-bearing scope** —
//      this file, at runtime, per store. If one ever does, the answer stops being
//      computable and a person decides.
//
// ⚠ **THE RESIDUAL IS STATED, AND THIS BRANCH IS DEFENCE IN DEPTH BEHIND IT
// (F4, and the security re-check's correction to it — 064 §7.3, §9 R1).** Fact 3
// is VACUOUS for a shop on the legacy static path: the pilot's per-store Dev
// Dashboard token was minted in a dashboard and its scopes are recorded nowhere
// in this database, so there is nothing for this query to find. The FIRST version
// answered such a shop automatically anyway — an empty scope set satisfies *no
// customer scope was granted* vacuously — which is a record indistinguishable
// from one a real check produced. Zero recorded grants is therefore a REFUSAL.
//
// **It is NOT, however, a live detector, and v1.1.0 of the record said it was.**
// Since F-A a store with no recorded grant resolves to a NULL tenant, and the
// producer enqueues nothing without one — so this branch is UNREACHABLE from the
// shipped producer, and the test that covers it writes the outbox row by hand and
// says so. It is kept because a future producer can reach it (E16-B02's cutover,
// a re-drive), and because a guard written only when somebody needs it is a guard
// nobody writes.

import { tenantDb, withTransaction } from "../db.js";
import type { ConsumerContext, ConsumerOutcome, OutboxConsumer } from "../services/outbox.js";
import { grantCouldReachACustomer, isAutoFulfillableTopic } from "../services/connectors/shopify/policy.js";
import { recordFulfilment } from "../services/privacy.js";

/**
 * What the guard is shown. Both fields are about ONE request at ONE store.
 *
 * `grantedScopes` is every scope recorded across every token version for the
 * store, live or retired — a retired grant is still a grant that once existed,
 * and the question is what this system COULD have read, not what it can read now.
 */
export interface PrivacyGuardInput {
  readonly topic: string;
  readonly grantedScopes: readonly string[];
  /**
   * How many `connector_token_version` rows exist for this store — NOT how many
   * scopes they carry. ZERO is a refusal (F4): an empty scope set satisfies *no
   * customer scope was granted* vacuously, so without this count the automatic
   * answer was produced by a check that examined nothing.
   */
  readonly grantsRecorded: number;
}

/**
 * Three refusals, and they are three because they are three different SENTENCES
 * in `outbox_dead_letter` — 041 §8.2 forbids a false one, and the first version
 * of this type had one reason doing the work of three.
 */
export type PrivacyGuardVerdict =
  | { readonly fulfil: true }
  | {
      readonly fulfil: false;
      readonly reasonCode:
        "customer_scope_was_granted" | "no_recorded_grant" | "privacy_topic_not_auto_fulfillable";
    };

/**
 * **This system answers a customer privacy message automatically only when it can
 * SHOW it never had the authority to hold anything about a customer.**
 *
 * A pure function, so the rule is testable without a cluster and the decision is
 * one expression rather than a shape spread through a handler.
 *
 * ⚠ **`grantsRecorded` IS SEPARATE FROM `grantedScopes` AND THAT IS F4.** The
 * check this answer rests on is *no recorded grant carries a customer scope*, and
 * an EMPTY set satisfies it VACUOUSLY — so before this fix a store with no
 * recorded grant at all (the legacy static path, which is the pilot) was answered
 * automatically by a check that examined nothing, and the row was
 * indistinguishable from one a real check produced. That inverted 043 A3's
 * fail-closed idiom. Zero recorded grants is now a REFUSAL.
 *
 * ⚠ **R1 is *stated, with a defence-in-depth branch, unreachable from the shipped
 * producer since F-A* — and no artifact may call it self-enforcing** (064 §9 R1).
 * Since F-A a store with no recorded grant resolves to a NULL tenant and is never
 * enqueued, so nothing in production reaches this branch; the test that covers it
 * writes the outbox row by hand and says so. The branch is kept because a future
 * producer can reach it — E16-B02's cutover, or a human re-drive under 043 §6.3.
 */
export function decidePrivacyGuard(input: PrivacyGuardInput): PrivacyGuardVerdict {
  if (!isAutoFulfillableTopic(input.topic)) {
    // Reached only if something enqueued a job for `shop/redact`, which the
    // producer does not do. It is refused rather than ignored: a deletion this
    // bead does not perform must never be recorded as one that happened. It is a
    // PRODUCER defect and not a control working, so it carries its own NON-guard
    // reason (the gate audit's B6).
    return { fulfil: false, reasonCode: "privacy_topic_not_auto_fulfillable" };
  }
  if (input.grantsRecorded === 0) {
    return { fulfil: false, reasonCode: "no_recorded_grant" };
  }
  return grantCouldReachACustomer(input.grantedScopes)
    ? { fulfil: false, reasonCode: "customer_scope_was_granted" }
    : { fulfil: true };
}

export function createPrivacyRequestConsumer(): OutboxConsumer {
  return async function privacyRequestReceived(ctx: ConsumerContext): Promise<ConsumerOutcome> {
    const { pool, claim } = ctx;
    // THE JOB'S TENANT IS THE CLAIMED ROW'S (E03-B04). `privacy_request`,
    // `privacy_request_fulfilment` and `connector_token_version` all carry a
    // policy, and a read with no context finds nothing — which here would look
    // like *no grant carries a customer scope* and answer the message. The
    // context is what makes the guard's input real rather than empty.
    const db = tenantDb(pool, claim.shopId);

    const requestRes = await db.query(
      `SELECT topic, shop_domain FROM privacy_request WHERE id = $1 AND shop_id = $2`,
      [claim.refId, claim.shopId]
    );
    const request = requestRes.rows[0] as { topic: string; shop_domain: string } | undefined;
    if (!request) {
      // The obligation this job names is not visible under its own tenant. That
      // is a deployment or context defect rather than a transient failure, so it
      // is terminal — and it is deliberately NOT a guard refusal, because nothing
      // was decided about a customer: the job could not find the question.
      return { status: "dead_letter", reasonCode: "privacy_request_not_visible" };
    }

    // TWO facts, not one: WHAT was granted, and WHETHER ANYTHING WAS. The second
    // is F4's, and it cannot be derived from the first — an empty scope list and
    // "no grant was ever recorded" look identical downstream, and the difference
    // is exactly whether the automatic answer examined anything at all.
    const scopeRes = await db.query(
      // `count(DISTINCT v.id)` and not `count(*)`: the LATERAL multiplies a
      // version by its scopes, so a plain count would report a version with two
      // scopes as two grants — which happens to fail SAFE here and would still be
      // a number this file states and does not mean.
      `SELECT count(DISTINCT v.id)::int AS grants,
              coalesce(array_agg(DISTINCT s) FILTER (WHERE s IS NOT NULL), '{}') AS scopes
         FROM connector_token_version v
         LEFT JOIN LATERAL unnest(v.granted_scopes) AS s ON true
        WHERE v.shop_id = $1 AND v.shop_domain = $2`,
      [claim.shopId, request.shop_domain]
    );
    const scopeRow = scopeRes.rows[0] as { grants: number; scopes: string[] };

    const verdict = decidePrivacyGuard({
      topic: request.topic,
      grantedScopes: scopeRow.scopes,
      grantsRecorded: scopeRow.grants,
    });
    if (!verdict.fulfil) {
      // Never retried automatically (043 §5.5). A store that once granted a
      // customer-bearing scope needs a person to decide what is held and what
      // must be done about it — unknown means do not touch, which is 043 A3's
      // rule one subsystem over.
      return { status: "dead_letter", reasonCode: verdict.reasonCode };
    }

    // IDEMPOTENCY BY CONSTRAINT (043 §3.2). Under concurrent duplicate delivery
    // both workers reach here; `UNIQUE (privacy_request_id)` lets exactly one row
    // exist and `ON CONFLICT … DO NOTHING` hands the loser `false`. The loser
    // still reports `delivered`, because the effect it owed HAS happened. There
    // is no read-then-write anywhere on this path.
    await withTransaction(
      pool,
      async (tx) =>
        recordFulfilment(tx, {
          shopId: claim.shopId,
          privacyRequestId: claim.refId,
          outcome: "no_data_held",
          method: "scope_policy",
        }),
      { label: "privacy-fulfilment", tenant: { shopId: claim.shopId } }
    );

    // The detail carries a REFERENCE and never a value (043 §2.5): which row this
    // answered, and nothing about the message, the store or the person.
    return { status: "delivered", detail: { ref_table: "privacy_request", ref_id: claim.refId } };
  };
}
