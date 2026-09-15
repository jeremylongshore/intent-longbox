// Observed listing lifecycle (040 §4.4) — the fact 019 T19's auto-publish
// detector reads.
//
// `shopify_draft` is append-only (migrations/001_init.sql:174-182), so the
// 'published' / 'delisted' / 'archived' values migration 003 added to its status
// CHECK (003:157-166) have no legal writer. The lifecycle lives here instead:
// every observation is an immutable row, and "what is this listing doing now" is
// derived from the newest one — never stored, never updated.
//
// Bead: longbox-e5b.2.12 (alias E02-D02).
//
// SCOPE — what this module is NOT. There is no route, no poller and no webhook
// endpoint here, deliberately:
//   * the Shopify status watcher (the poller) is E10-B05;
//   * the webhook receiver is E10-B08;
//   * the T19 detector's runtime heartbeat (019 T34) is E13-B04;
//   * the `listing_link_current_status` view and the deprecation of
//     shopify_draft's three unreachable status values are E02-B10's contract
//     step (040 §8.2 item 5).
// This module supplies only the write, the read, and the pure predicate those
// beads will call.
import type pg from "pg";
import { z } from "zod";

/** 040 §4.4's value set, verbatim. Not narrowed. */
export const OBSERVED_STATUSES = ["draft", "published", "delisted", "archived", "deleted"] as const;

/** How Longbox came to hear it. 040 F1: a Longbox-originated act is never a source. */
export const OBSERVATION_SOURCES = ["watcher", "webhook"] as const;

/**
 * The actor string the channel uses for an app-driven change. 019 T19 names it
 * literally: "`published_by='app'` rows + Shopify status watcher".
 */
export const APP_ACTOR = "app";

export const listingStatusObservationInput = z.object({
  shopId: z.string().uuid(),
  shopifyDraftId: z.string().uuid(),
  observedStatus: z.enum(OBSERVED_STATUSES),
  /**
   * The channel's actor string, stored VERBATIM as returned — never normalised,
   * never defaulted. Absent/null means the channel reported no actor, which is
   * not evidence of anything.
   */
  publishedBy: z.string().min(1).nullish(),
  /** When the status was true per the channel. Defaults to now() in the DB. */
  observedAt: z.date().optional(),
  source: z.enum(OBSERVATION_SOURCES),
  /** The channel payload as received, so a disputed observation can be re-read. */
  raw: z.record(z.string(), z.unknown()).optional(),
});

export type ListingStatusObservationInput = z.input<typeof listingStatusObservationInput>;

export type ListingStatusObservation = {
  id: string;
  shopId: string;
  shopifyDraftId: string;
  observedStatus: (typeof OBSERVED_STATUSES)[number];
  publishedBy: string | null;
  observedAt: Date;
  source: (typeof OBSERVATION_SOURCES)[number];
  raw: Record<string, unknown>;
  createdAt: Date;
};

type Row = {
  id: string;
  shop_id: string;
  shopify_draft_id: string;
  observed_status: ListingStatusObservation["observedStatus"];
  published_by: string | null;
  observed_at: Date;
  source: ListingStatusObservation["source"];
  raw: Record<string, unknown>;
  created_at: Date;
};

function toObservation(row: Row): ListingStatusObservation {
  return {
    id: row.id,
    shopId: row.shop_id,
    shopifyDraftId: row.shopify_draft_id,
    observedStatus: row.observed_status,
    publishedBy: row.published_by,
    observedAt: row.observed_at,
    source: row.source,
    raw: row.raw,
    createdAt: row.created_at,
  };
}

/**
 * Append one observation. INSERT only — there is no update path and there will
 * not be one: a corrected reading is a newer row, and the append-only trigger
 * refuses anything else at the database.
 */
export async function recordListingStatusObservation(
  db: pg.Pool,
  input: ListingStatusObservationInput
): Promise<ListingStatusObservation> {
  const parsed = listingStatusObservationInput.parse(input);
  const res = await db.query<Row>(
    `INSERT INTO listing_status_observation
       (shop_id, shopify_draft_id, observed_status, published_by, observed_at, source, raw)
     VALUES ($1, $2, $3, $4, COALESCE($5, now()), $6, $7)
     RETURNING id, shop_id, shopify_draft_id, observed_status, published_by,
               observed_at, source, raw, created_at`,
    [
      parsed.shopId,
      parsed.shopifyDraftId,
      parsed.observedStatus,
      parsed.publishedBy ?? null,
      parsed.observedAt ?? null,
      parsed.source,
      JSON.stringify(parsed.raw ?? {}),
    ]
  );
  return toObservation(res.rows[0]!);
}

/**
 * The newest observation for one draft, or null when nothing has ever observed
 * it. An unobserved listing HAS NO observed status — that is an absence, not an
 * assumed 'draft' (040 §8.4 item 2).
 *
 * Ties on observed_at break on id DESC, matching the
 * (shopify_draft_id, observed_at DESC, id DESC) index, so a poll and a webhook
 * landing with the same timestamp still resolve to one deterministic row.
 */
export async function latestListingStatus(
  db: pg.Pool,
  shopifyDraftId: string
): Promise<ListingStatusObservation | null> {
  const res = await db.query<Row>(
    `SELECT id, shop_id, shopify_draft_id, observed_status, published_by,
            observed_at, source, raw, created_at
       FROM listing_status_observation
      WHERE shopify_draft_id = $1
      ORDER BY observed_at DESC, id DESC
      LIMIT 1`,
    [shopifyDraftId]
  );
  const row = res.rows[0];
  return row ? toObservation(row) : null;
}

/**
 * 019 T19's detector rule, as a pure predicate.
 *
 * T19 verbatim (product success contract 019 v1.2.0 §3.3, row T19):
 *   "| T19 | Auto-publish incidents | 0 | `published_by='app'` rows + Shopify
 *    status watcher | any → K1; **non-waivable** |"
 *
 * So an incident is an observation that BOTH reports the listing live
 * ('published') AND names the app as the actor. Longbox never writes 'app' as
 * itself (040 §4.4); the value exists in the schema precisely so that a channel
 * reporting it can be caught here. A null or absent `published_by` is NOT an
 * incident — the channel reported no actor, and an absence is never evidence
 * (040 §8.4).
 *
 * The comparison trims surrounding whitespace and is case-insensitive, because
 * the string is stored verbatim as the channel returned it and a detector that
 * misses 'App' would be a waiver by omission (019 standing amendment 2).
 */
export function isAutoPublishIncident(observation: {
  observedStatus: string;
  publishedBy?: string | null;
}): boolean {
  if (observation.observedStatus !== "published") return false;
  const actor = observation.publishedBy;
  if (actor === null || actor === undefined) return false;
  return actor.trim().toLowerCase() === APP_ACTOR;
}
