// The v1 contract: request schemas AND response DTOs, in Zod, as the single
// source of truth (042 §2.5(c), §3.3).
//
// WHAT MOVED HERE AND WHY. The request shapes were Zod literals inline in the
// handlers (042 E18): none exported, none imported by a test, none emitted as an
// artifact — validators inside handlers rather than a contract. The responses
// were database rows (E17). `contracts/openapi.json` is GENERATED from this file
// and diff-gated in CI (042 I15), so a contract change is a diff in the PR,
// which is what makes the additive-only rule of §2.3 reviewable rather than
// aspirational.
//
// THE RESPONSE-DTO RULE (042 §3.3). No route response is derived from
// an unbounded star projection, and a response body may contain no key its DTO
// does not declare.
// That closes an instance and a CLASS: `scan_session.status` cannot leak from a
// projection that does not select it (040 A8), and `getSessionEvents`'s seven
// interpolated star projections stop being a standing commitment to publish every
// column a future migration adds — `authored_by`, `actor_role`, `operator_id`,
// `session_seq` and whatever comes after.
//
// THREE CLASSES OF FIELD ARE ABSENT BY RULE, not by oversight:
//   - **operator identifiers** (`created_by`, `confirmed_by`) — 019 T35
//     non-waivable, 041 §8.4, 042 I1/I7;
//   - **confidence, provider, model and cost** — 022 P6 / 022 P8 / 021 B19,
//     042 I9. `llm_rerank`'s row carries all four and its DTO carries none;
//   - **`storage_url` / `storage_key`** — 042 §3.5: "an internal reference, and
//     NEVER a response field". A photo is addressed by a shop-scoped, signed,
//     expiring URL issued by the owning module, which is E03-B07's to build.
import { z } from "zod";
import { GRADE_LABELS } from "../../services/condition.js";

export const API_PREFIX = "/api/v1";
export const TENANT_PREFIX = `${API_PREFIX}/shops/:shopId`;

// ---------------------------------------------------------------------------
// Params and the causal reference
// ---------------------------------------------------------------------------

export const shopParams = z.object({ shopId: z.string().uuid() });
export const sessionParams = shopParams.extend({ id: z.string().uuid() });

/**
 * The tables a client may name as the record it was shown (040 §3.2's ladder).
 * A closed set, because an open one would let a client assert a world-view over
 * a table with no rung and get an unfalsifiable comparison.
 */
export const AGAINST_TABLES = [
  "scan_photo",
  "candidate_set",
  "llm_rerank",
  "human_confirmation",
  "condition_assessment",
  "pricing_snapshot",
  "shopify_draft",
] as const;

/**
 * 042 §6.1 — the highest-witness record the actor was shown.
 *
 * IN THE BODY, NOT A HEADER (042 §6.2), and the reason is §5.4: `request_hash`
 * covers the body and not the headers, so a world-view in a header could differ
 * between a request and its replay while still hashing identical. The two
 * mechanisms have to agree about what a request IS.
 *
 * OPTIONAL IN `v1` (042 §6.5). Making it required on day one would 400 every
 * replay from a queue written by yesterday's client, which is E05-B08's normal
 * operation rather than an error. The fallback is COUNTED (040 I18) — an
 * uncounted fallback is a silent return to the rule it replaced.
 */
export const againstSchema = z.object({
  table: z.enum(AGAINST_TABLES),
  id: z.string().uuid(),
});

export type Against = z.infer<typeof againstSchema>;

const withAgainst = { against: againstSchema.optional() };

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * 041 §8.4 / 042 §3.1 R2: `created_by` STOPS BEING WRITTEN. The field is gone
 * from the request rather than accepted-and-ignored, because a body key the
 * server silently drops is a promise a client keeps making.
 */
export const createSessionRequest = z.object({}).strict();

export const identifyRequest = z
  .object({
    barcode_digits: z
      .string()
      .regex(/^[\d\s-]+$/)
      .optional(),
    ...withAgainst,
  })
  .strict();

/**
 * The confirmed issue — a DECLARED shape, not `z.record(z.unknown())`.
 *
 * E03-D02 (bead longbox-e5b.3.12; 046 §5 A16, §11 I3). The old `z.record(z.unknown())`
 * accepted arbitrary client JSON of arbitrary size and depth, and its fields were
 * interpolated into a Shopify `descriptionHtml` unescaped — a stored-injection
 * path from a phone at the counter into the shop's own storefront, across a
 * boundary (046 §3.3 B9) into a system Longbox does not own and cannot clean up.
 *
 * THE PATH IS THE MODEL'S, WHICH IS WHY THE BOUND MATTERS. These strings are not
 * typed by an operator in the normal case: they are the candidate the model
 * returned, tapped once (`public/app.js` one-tap → `confirmIssue`). So the
 * hostile input is a cover, a sticker or a QR code carrying markup (046 §5 A8),
 * and the operator confirming it is the design working, not a mistake.
 *
 * SIX FIELDS, ALL STRINGS, NO NESTING, EVERY ONE CAPPED. `year` is a string
 * because a bounded string is the same fact with fewer coercion rules, and
 * because the identify response already carries it as displayed text. `.strict()`
 * means an unexpected key is a 422 rather than a silently stored one — the same
 * argument 042 §3.1 R2 made for `created_by`: "a body key the server silently
 * drops is a promise a client keeps making".
 */
export const confirmedIssue = z
  .object({
    title: z.string().max(300).optional(),
    issue: z.string().max(50).optional(),
    variant: z.string().max(200).optional(),
    publisher: z.string().max(200).optional(),
    year: z.string().max(10).optional(),
    upc: z.string().max(50).optional(),
  })
  .strict();

export const confirmRequest = z
  .object({
    issue: confirmedIssue,
    source: z.enum(["one_tap", "grid_pick", "manual_search", "owner_review"]),
    ...withAgainst,
  })
  .strict();

export const conditionRequest = z
  .object({
    grade_range_low: z.enum(GRADE_LABELS),
    grade_range_high: z.enum(GRADE_LABELS),
    defects: z.array(z.string().max(100)).default([]),
    notes: z.string().max(2000).optional(),
    ...withAgainst,
  })
  .strict();

export const priceRequest = z
  .object({
    title: z.string().min(1).max(300).optional(),
    issue: z.string().min(1).max(50).optional(),
    variant: z.string().min(1).max(200).optional(),
    grade: z.string().min(1).max(50).optional(),
    upc: z.string().min(1).max(50).optional(),
    query: z.string().min(1).max(500).optional(),
    override_cents: z.number().int().positive().optional(),
    ...withAgainst,
  })
  .strict()
  .refine((b) => b.title !== undefined || b.query !== undefined, {
    message: "title (or legacy query) is required",
  });

export const draftRequest = z.object({ ...withAgainst }).strict();

export const photoKind = z.enum(["cover", "barcode", "defect"]);

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();
const timestamp = z.string();

export const shopSummary = z.object({ id: uuid, name: z.string(), slug: z.string() });
export const shopsResponse = z.object({ shops: z.array(shopSummary) });

/** No `status` (040 A8) and no `created_by` (041 §8.4). */
export const sessionDto = z.object({ id: uuid, shop_id: uuid, created_at: timestamp });

export const sessionCreatedResponse = z.object({ session: sessionDto });

/** 040 §3.2's ladder plus §3.3's explicit transitions. */
export const SESSION_STATES = [
  "intake",
  "captured",
  "proposed",
  "confirmed",
  "conditioned",
  "priced",
  "drafted",
  "parked",
  "voided",
] as const;

export const transitionDto = z.object({
  id: uuid,
  kind: z.enum(["parked", "resumed", "voided", "reopened"]),
  reopened_to_rung: z.string().nullable(),
  created_at: timestamp,
});

/**
 * The event trail's DECLARED projection, table by table.
 *
 * 041 I9 requires the trail READ to be complete — a column list in the SQL would
 * silently drop a column a later migration adds — so `getSessionEvents` keeps
 * its star projection as the one declared exemption 042 I5 expects. **The bound is on
 * the PROJECTION, not the read**, and E16 is why the two are different
 * properties: without this, every column added to a witness table lands in a
 * response body on the day its migration applies, with no route, test or
 * reviewer involved.
 */
export const eventDtos = {
  scan_photo: z.object({ id: uuid, kind: z.string(), taken_at: timestamp }),
  candidate_set: z.object({
    id: uuid,
    method: z.string(),
    candidates: z.unknown(),
    created_at: timestamp,
  }),
  // No `provider`, no `model`, no `confidence`, no `cost_usd`, no `response`
  // (042 I9; 022 P6/P8; 021 B19). The band word and the contradiction flag are
  // what a screen is allowed to be built from.
  llm_rerank: z.object({
    id: uuid,
    candidate_set_id: uuid,
    band: z.string(),
    contradiction: z.boolean(),
    created_at: timestamp,
  }),
  // No `confirmed_by` (019 T35 non-waivable).
  human_confirmation: z.object({
    id: uuid,
    confirmed_issue: z.unknown(),
    source: z.string(),
    outcome: z.string().nullable(),
    supersedes_id: uuid.nullable(),
    created_at: timestamp,
  }),
  condition_assessment: z.object({
    id: uuid,
    grade_range_low: z.string(),
    grade_range_high: z.string(),
    defects: z.array(z.string()),
    notes: z.string().nullable(),
    supersedes_id: uuid.nullable(),
    created_at: timestamp,
  }),
  pricing_snapshot: z.object({
    id: uuid,
    source: z.string(),
    query: z.string(),
    comps: z.unknown(),
    suggested_cents: z.number(),
    override_cents: z.number().nullable(),
    created_at: timestamp,
  }),
  shopify_draft: z.object({
    id: uuid,
    product_gid: z.string().nullable(),
    status: z.string(),
    outbox_id: uuid.nullable(),
    created_at: timestamp,
  }),
} as const;

export type EventTable = keyof typeof eventDtos;

export const EVENT_TABLES = Object.keys(eventDtos) as EventTable[];

/**
 * The declared key set per table, derived from the DTOs above so there is ONE
 * list and not two that drift — the construction 041 §9.2 uses for the trigger
 * set, applied to the wire.
 */
export const EVENT_PROJECTIONS: Record<EventTable, readonly string[]> = Object.fromEntries(
  EVENT_TABLES.map((t) => [t, Object.keys(eventDtos[t].shape)])
) as unknown as Record<EventTable, readonly string[]>;

export const eventsDto = z.object({
  scan_photo: z.array(eventDtos.scan_photo),
  candidate_set: z.array(eventDtos.candidate_set),
  llm_rerank: z.array(eventDtos.llm_rerank),
  human_confirmation: z.array(eventDtos.human_confirmation),
  condition_assessment: z.array(eventDtos.condition_assessment),
  pricing_snapshot: z.array(eventDtos.pricing_snapshot),
  shopify_draft: z.array(eventDtos.shopify_draft),
});

export const sessionDetailResponse = z.object({
  session: sessionDto,
  /** 040 §3.1's derived state. Never a stored column (040 A8). */
  state: z.enum(SESSION_STATES),
  transitions: z.array(transitionDto),
  events: eventsDto,
});

export const photoResponse = z.object({
  // `storage_url` is DELIBERATELY ABSENT (042 §3.5). It was `routes:160`.
  photo: z.object({ id: uuid, kind: photoKind }),
});

/**
 * 042 §6.3 — the identify DTO returns the ids of EVERY record the call wrote,
 * including the `llm_rerank` id, "without which §6 is unsatisfiable" (E14): a
 * client instructed to send the record it was shown had no id for it.
 *
 * And it STRIPS `confidence`, `provider`, `model` and `costUsd`, which
 * `IdentifyOutcome` still carries internally because `cost_log` and `llm_rerank`
 * are written from them. 042 A4 binds the client change to the same PR as this
 * one, because split across two either the client reads fields the server no
 * longer sends, or the server keeps sending fields 022 P6 forbids "because the
 * client still needs them" — and the second is how a temporary state becomes
 * permanent.
 */
export const identifyResponse = z.object({
  candidate_set_ids: z.array(uuid),
  llm_rerank_id: uuid.nullable(),
  candidates: z.array(z.unknown()),
  band: z.enum(["high", "medium", "low"]),
  contradiction: z.boolean(),
  contradiction_reasons: z.array(z.string()),
  barcode: z.unknown().optional(),
  /** True when the shop's metered budget is spent and this call went to the manual path (042 §8.3). */
  manual_path: z.boolean(),
});

export const confirmResponse = z.object({
  confirmation: z.object({ id: uuid, created_at: timestamp, outcome: z.string() }),
});

export const conditionResponse = z.object({
  assessment: z.object({ id: uuid, created_at: timestamp }),
});

export const priceSourceDto = z.object({
  source: z.string(),
  kind: z.string(),
  status: z.enum(["ok", "failed"]),
  stub: z.boolean(),
  comps_count: z.number(),
  summary: z.unknown(),
  snapshot_id: uuid.optional(),
  error: z.string().optional(),
});

export const priceResponse = z.object({
  sources: z.array(priceSourceDto),
  suggested_cents: z.number(),
  driven_by: z.string(),
  override_cents: z.number().nullable(),
  snapshot_count: z.number(),
  /** 033 D5: stub flagging is PART OF THE DTO, not a convenience key. */
  stub: z.boolean(),
});

export const draftResponse = z.object({
  status: z.literal("accepted"),
  outbox_id: uuid,
  already_requested: z.boolean(),
});

export const healthResponse = z.object({ ok: z.literal(true) });

export type SessionDetail = z.infer<typeof sessionDetailResponse>;
export type IdentifyResponse = z.infer<typeof identifyResponse>;
