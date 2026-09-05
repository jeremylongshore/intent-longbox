// The `longbox.commerce.draft_requested` consumer — COMMERCE's, not platform's.
//
// 029 §2.7 owns "the outward mutation" and `shopify_draft`; 029 §2.9 owns the
// queue. Platform never knows what a job MEANS and commerce never knows how it
// was SCHEDULED, and the only thing joining them is the registry keyed on the
// event name. This file is also where 029 §2.7's owed relocation finally lands:
// the draft-creation block leaves `src/routes/scanSessions.ts` for the module
// that owns it (043 §1 E3, §4.1, §9.1 row 4).
//
// THE SHAPE (043 §4.1). Two transactions, and the external call between them,
// OUTSIDE BOTH. That is not a compromise around 041 §4.1 — it is what 041 §4.1
// requires once you accept that a Shopify mutation cannot be rolled back. The
// request already appended `draft_requested` inside its own transaction; this
// consumer calls `productSet` and then, in its OWN transaction, appends
// `shopify_draft` with the returned product id.
//
// Bead: longbox-e5b.2.17 (alias E02-D07). Docs: 043 §4.1–§4.5, A3, A11, §11 I5,
// I7, I8, I9; 040 F1/F6; 033 B3; 022 P1; 019 T17/T19.

import { tenantDb, withTransaction, type Queryable } from "../db.js";
import type { ConsumerContext, ConsumerOutcome, OutboxConsumer } from "../services/outbox.js";
import {
  assignSessionSeq,
  insertShopifyDraft,
  lockScanSession,
  readDraftFacts,
  setSessionStatus,
} from "../services/scanSession.js";
import type { DraftProductInput, ShopifyClient } from "../services/shopify.js";

// ---------------------------------------------------------------------------
// The guard — and it FAILS CLOSED (043 §4.3, A3, the most costly amendment)
// ---------------------------------------------------------------------------

/**
 * What the guard is shown. Both fields are about ONE physical copy.
 *
 * `priorDraft` is the newest `shopify_draft` row for the copy that actually
 * produced a listing — status at `'draft'` or later. A row at `'failed'` is not
 * a prior draft: it records that a call did not create anything.
 */
export interface DraftGuardInput {
  readonly priorDraft: { readonly id: string; readonly status: string } | null;
  /** Every `listing_status_observation` for that copy's drafts. May be empty. */
  readonly observations: ReadonlyArray<{ readonly observedStatus: string }>;
}

export type DraftGuardVerdict =
  | { readonly run: true; readonly because: "no_prior_draft" | "observed_draft" }
  | { readonly run: false; readonly reasonCode: "listing_left_draft" | "no_observation_evidence" };

/**
 * **A job touches an existing listing only on POSITIVE evidence that it is still
 * a draft.**
 *
 * WHY THIS IS THE SHARPEST HAZARD IN THE DESIGN. `productSet` UPDATES an
 * existing product and `buildProductSetInput` hardcodes `status: "DRAFT"`. So a
 * re-run against a product a human has since PUBLISHED would set it back to
 * DRAFT. That is not a 019 T19 auto-publish — nothing publishes — but it is the
 * mirror image: **Longbox silently un-publishing a listing a person decided to
 * publish**, which is 022 P1's human authority and 033 B3's "publish is a normal
 * Shopify action, never the app's" broken from the other side.
 *
 * WHY IT FAILS CLOSED, WHICH IS AMENDMENT A3 AND THE MOST COSTLY LINE IN 043.
 * The draft of that record refused a job when an observation said the listing had
 * left `draft` — and **passed when there were no observations at all**, which is
 * the state of the world today: `listing_status_observation` has no producer
 * (043 §1 E8; the watcher is E10-B05). So the protection evaluated to *proceed*
 * in exactly the condition it existed for, and the record covered that with an
 * instruction that the guard and the watcher not ship apart. Kleppmann's
 * objection is adopted whole:
 *
 *   > **"An instruction is not an invariant. It is the thing an invariant exists
 *   > to replace."**
 *
 * **UNKNOWN MEANS DO NOT TOUCH.** With no watcher, every retry of an
 * already-created draft dead-letters into a queue a human reads — slow, and
 * correct. E10-B05's watcher makes this guard USEFUL; it is not what makes it
 * SAFE. That is the whole of what A3 bought.
 *
 * Order matters and is not arbitrary: a non-`draft` observation is checked
 * BEFORE a `draft` one, so a listing that was observed as a draft and later
 * published is refused rather than waved through on the older evidence.
 */
export function decideDraftGuard(input: DraftGuardInput): DraftGuardVerdict {
  // (d) Nothing to un-publish; this is a create.
  if (input.priorDraft === null) return { run: true, because: "no_prior_draft" };

  // (b) Anything observed beyond `draft` — published, delisted, archived,
  // deleted — is a listing whose state Longbox did not decide and must not
  // overwrite.
  if (input.observations.some((o) => o.observedStatus !== "draft")) {
    return { run: false, reasonCode: "listing_left_draft" };
  }

  // (c) Positive evidence: something observed it as a draft. The upsert is safe.
  if (input.observations.length > 0) return { run: true, because: "observed_draft" };

  // (a) THE EMPTY-TABLE CASE — the one the pre-A3 draft would have passed.
  return { run: false, reasonCode: "no_observation_evidence" };
}

// ---------------------------------------------------------------------------
// Composing the draft (moved verbatim in behaviour out of src/routes/)
// ---------------------------------------------------------------------------

export interface DraftFacts {
  readonly confirmedIssue: Record<string, unknown> | undefined;
  readonly pricing: { suggested_cents: number; override_cents: number | null } | undefined;
  readonly assessment: { grade_range_low: string; grade_range_high: string; defects: string[] } | undefined;
  readonly coverUrls: string[];
}

// ---------------------------------------------------------------------------
// Escaping and bounding, on the way OUT (E03-D02, 046 §5 A16, §11 I3)
// ---------------------------------------------------------------------------

/** Field caps, mirroring `confirmedIssue` in the v1 contract. */
const CAPS = { title: 300, issue: 50, variant: 200, publisher: 200, year: 10, defects: 400 } as const;

/**
 * A stored value as bounded plain text.
 *
 * BOUNDED HERE AS WELL AS AT THE CONTRACT, and that is not belt-and-braces for
 * its own sake: `human_confirmation` is append-only, so every row written before
 * E03-D02 landed is still there and still unbounded, and this function reads
 * from the table rather than from the request. A guard that only lived in the
 * Zod schema would be a guard the historical rows walk straight past.
 */
export function boundedText(value: unknown, max: number): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return ""; // no nesting reaches a storefront
  return String(value).slice(0, max);
}

/**
 * HTML-escape one value for interpolation into `descriptionHtml`.
 *
 * Five characters, the standard set, applied AFTER bounding so a truncation can
 * never cut an entity in half. `&` is replaced first for the same reason it
 * always is: escaping it later would double-escape the ones before it.
 */
export function escapeHtml(value: unknown, max: number): string {
  return boundedText(value, max)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the product payload from the session's own committed facts.
 *
 * CONDITION IS NEVER NUMERIC (locked decision 5; 019 T7 = 0, non-waivable). The
 * copy below renders a grade RANGE and defect callouts and nothing else — no
 * score, no percentage, no confidence figure.
 *
 * NOTHING CLIENT- OR MODEL-AUTHORED CROSSES B9 UNESCAPED (E03-D02). Every value
 * interpolated into `descriptionHtml` goes through `escapeHtml`, and the `title`
 * — which Shopify renders as PLAIN TEXT, so escaping it would put `&amp;` in
 * front of a customer — is bounded instead. The distinction is deliberate: an
 * escape applied to a non-HTML sink is a corruption, not a control.
 *
 * Returns `undefined` when the session cannot be drafted, which is a terminal
 * outcome rather than a retryable one: the facts do not appear by waiting.
 */
export function composeDraftInput(facts: DraftFacts, copyKey: string): DraftProductInput | undefined {
  const issue = facts.confirmedIssue;
  if (!issue || !facts.pricing) return undefined;

  const issueNumber = boundedText(issue["issue"], CAPS.issue);
  const title = [
    boundedText(issue["title"], CAPS.title),
    issueNumber ? `#${issueNumber}` : "",
    boundedText(issue["variant"], CAPS.variant),
  ]
    .filter((part) => part.length > 0)
    .join(" ");
  const a = facts.assessment;
  const gradeCopy = a
    ? `Condition: ${escapeHtml(a.grade_range_low === a.grade_range_high ? a.grade_range_low : `${a.grade_range_low}-${a.grade_range_high}`, CAPS.issue)}` +
      `${a.defects.length ? `. Noted: ${escapeHtml(a.defects.join(", ").replace(/_/g, " "), CAPS.defects)}` : ""}`
    : "";
  const provenance = [escapeHtml(issue["publisher"], CAPS.publisher), escapeHtml(issue["year"], CAPS.year)]
    .filter((part) => part.length > 0)
    .join(", ");

  return {
    title: title || "Unidentified comic",
    descriptionHtml: `<p>${provenance}</p><p>${gradeCopy}</p>`,
    priceCents: facts.pricing.override_cents ?? facts.pricing.suggested_cents,
    imageUrls: facts.coverUrls,
    copyKey,
  };
}

// ---------------------------------------------------------------------------
// The consumer
// ---------------------------------------------------------------------------

/**
 * How the consumer gets a Shopify client for a shop.
 *
 * Injected rather than resolved inline so tests hand it a FAKE (tests/fakes.ts's
 * pattern: the pg seam and the provider seam are the only things faked; the
 * function under test is always the real implementation). It also keeps the
 * per-shop credential resolution — key_ref → env var, with a global fallback —
 * in one place rather than duplicated between the route and the job.
 */
export type ShopifyClientResolver = (
  // A `Queryable` rather than a `pg.Pool` since E03-B04: the resolver is handed
  // the job's TENANT-SCOPED handle, because `shop_credentials` and
  // `shop_credential_version` carry a `shop_id` and therefore a policy. A pool
  // typed here would let a caller resolve a credential with no tenant context and
  // find nothing, which reads as "no credential configured" — a stub client in
  // production, silently (043 §4.4).
  db: Queryable,
  shopId: string
) => Promise<{ client: ShopifyClient; stub: boolean }>;

/**
 * Read the guard's two inputs for one copy.
 *
 * "The copy" is today the `scan_session`, because `physical_item` does not exist
 * (036 §7.1's migration is unwritten). When it lands, this predicate and the
 * `copyKey` move together — E10-B03's, as a metafield BACKFILL and never a key
 * swap (043 §4.3).
 */
export async function readGuardInput(
  db: Queryable,
  shopId: string,
  sessionId: string
): Promise<DraftGuardInput> {
  const priorRes = await db.query(
    `SELECT id, status FROM shopify_draft
      WHERE scan_session_id = $1 AND shop_id = $2 AND status <> 'failed' AND product_gid IS NOT NULL
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [sessionId, shopId]
  );
  const priorDraft = (priorRes.rows[0] as { id: string; status: string } | undefined) ?? null;
  if (!priorDraft) return { priorDraft: null, observations: [] };

  const obsRes = await db.query(
    `SELECT o.observed_status FROM listing_status_observation o
       JOIN shopify_draft d ON d.id = o.shopify_draft_id
      WHERE d.scan_session_id = $1 AND d.shop_id = $2
      ORDER BY o.observed_at DESC, o.id DESC`,
    [sessionId, shopId]
  );
  return {
    priorDraft,
    observations: (obsRes.rows as Array<{ observed_status: string }>).map((r) => ({
      observedStatus: r.observed_status,
    })),
  };
}

export function createDraftRequestedConsumer(deps: { resolveClient: ShopifyClientResolver }): OutboxConsumer {
  return async function draftRequested(ctx: ConsumerContext): Promise<ConsumerOutcome> {
    const { pool, claim } = ctx;
    // THE JOB'S TENANT IS THE CLAIMED ROW'S (E03-B04). A consumer has no session,
    // so every read it makes runs under the shop the claim names — the same shop
    // whose context the claim itself was taken under. `db` is used for the two
    // fact reads and the credential resolution; the recording transaction below
    // declares the same context for itself.
    const db = tenantDb(pool, claim.shopId);
    const sessionId = claim.scanSessionId;
    if (sessionId === null) {
      return { status: "dead_letter", reasonCode: "session_not_draftable" };
    }

    // ── The guard, FIRST, before anything is composed or any client is built.
    //    Deciding late would mean the refusal path had already spent a provider
    //    credential resolution and a fact read on a job it was always going to
    //    refuse — and, worse, would put the decision after the code that builds
    //    the thing it is deciding about.
    const verdict = decideDraftGuard(await readGuardInput(db, claim.shopId, sessionId));
    if (!verdict.run) {
      // Never retried automatically. A replay requires 043 §6.3's human record,
      // and 043 §5.5 is explicit that an automatic re-drive is the mechanism
      // that would eventually un-publish a listing when the guard's data is
      // stale.
      return { status: "dead_letter", reasonCode: verdict.reasonCode };
    }

    const facts = await readDraftFacts(db, claim.shopId, sessionId);
    // The copy key is the physical copy (043 §4.3). Today that is the session.
    const draftInput = composeDraftInput(facts, sessionId);
    if (!draftInput) return { status: "dead_letter", reasonCode: "session_not_draftable" };

    // `stub` travels onto the attempt row, and that is 043 §5.3's closing
    // evidence rather than telemetry for its own sake: the attempt-count and
    // time-to-delivery distributions close the PROVISIONAL floors only when they
    // are SEGMENTED by whether a real credential was configured, because "a stub
    // client never fails, so a mixed sample would report a reliability that
    // belongs to the stub". Nothing else in the attempt log records which client
    // answered, so a row written without it is a row that can never be split.
    const { client, stub } = await deps.resolveClient(db, claim.shopId);

    // ── The external call: outside both transactions, and irreversible.
    const result = await client.createDraft(draftInput);
    if (!result.ok || !result.productGid) {
      // No `shopify_draft` row on a failure (043 §4.1): a failed call created
      // nothing, and a row saying otherwise would be a listing this system
      // believes in and Shopify has never heard of. The attempt row is the
      // record, and `permanent` decides whether it is retried at all.
      return {
        status: "failed",
        ...(result.permanent === true ? { permanent: true } : {}),
        // Carried on the FAILURE path too, not only on `delivered`: the
        // segmentation exists precisely because a stub never fails, so the
        // failures are the half of the sample the flag has to be able to
        // explain.
        detail: { http_status: result.status, stub },
      };
    }

    // ── The recording transaction: its own, and the second of the two.
    //
    // IDEMPOTENCY BY CONSTRAINT, NOT BY A READ-THEN-WRITE CHECK (043 §3.2, §11
    // I5(b)). Under concurrent duplicate delivery both workers reach here;
    // `UNIQUE (outbox_id) WHERE outbox_id IS NOT NULL` lets exactly one row
    // exist and `ON CONFLICT … DO NOTHING` hands the loser `undefined`. The
    // loser still reports `delivered`, because the effect it owed HAS happened —
    // 043 §4.3's `customId` upsert already guaranteed both calls resolved to ONE
    // Shopify product. There is nothing here to interpret and nothing to retry.
    //
    // ⚠ THE ANCHOR LOCK IS TAKEN HERE, AND IT IS NOT A LOCK-ORDER VIOLATION.
    // 043 §7.2's rule is that a worker takes **the `outbox` row, then anything
    // else**, within one transaction. This is a DIFFERENT transaction: the claim
    // committed long ago and released its outbox lock, and this one takes
    // exactly one lock. The lock is required rather than defensive — E02-B10
    // made `shopify_draft.session_seq` NOT NULL and `assignSessionSeq`'s
    // `max + 1` is only atomic under the anchor lock; without it two concurrent
    // deliveries could compute the same counter and trip
    // `UNIQUE (scan_session_id, session_seq)`. The unique index is the backstop,
    // not the mechanism.
    const recorded = await withTransaction(
      pool,
      async (tx) => {
        const locked = await lockScanSession(tx, claim.shopId, sessionId);
        // The session was deleted between the guard read and here. Retrying
        // cannot bring it back, so this is terminal — and the Shopify product
        // that now exists with no row is exactly what 043 §4.5's reconciliation
        // is for (E10-B05), not something to paper over with a second attempt.
        if (!locked) return false;

        const sessionSeq = await assignSessionSeq(tx, claim.shopId, sessionId);
        await insertShopifyDraft(tx, {
          sessionId,
          shopId: claim.shopId,
          productGid: result.productGid ?? null,
          status: "draft",
          error: null,
          sessionSeq,
          outboxId: claim.outboxId,
        });
        // Idempotent by nature: writing 'drafted' twice is writing 'drafted'.
        // 040 §8.2 step 4 replaces this cursor with an observation table; until
        // then it is the one permitted UPDATE in the codebase and it belongs in
        // the same commit as the row it describes.
        await setSessionStatus(tx, claim.shopId, sessionId, "drafted");
        return true;
      },
      // ⚠ THE RECORDING TRANSACTION NEEDS THE TENANT TOO (E03-B04), and the way
      // this was FOUND is worth the line: without it `lockScanSession` locked the
      // rows this connection could see — none — returned `false`, and the job
      // dead-lettered as `session_not_draftable` after the provider call had
      // already succeeded. A missing context is an empty result, never an error,
      // so it surfaces as a wrong decision somewhere downstream.
      { label: "draft-job-record", tenant: { shopId: claim.shopId } }
    );
    if (!recorded) return { status: "dead_letter", reasonCode: "session_not_draftable" };

    return { status: "delivered", detail: { stub } };
  };
}
