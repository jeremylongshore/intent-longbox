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
 * The photo-fetch params (E03-D05). `photoId` is a UUID and nothing else, which
 * is the first half of why traversal is impossible on this route: `..`, an
 * encoded separator or an absolute path fails validation before any service
 * runs. The second half is that the path served is built from the STORED key
 * and never from a request field at all (`sessionApi.readPhoto`).
 */
export const photoParams = sessionParams.extend({ photoId: z.string().uuid() });

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

// ---------------------------------------------------------------------------
// E03-D09 — the four authentication surfaces (048 §3.5, §6.2, §7.3).
// ---------------------------------------------------------------------------

/** A phone exchanges the secret it holds for a device session (048 §7.3's other half). */
export const deviceSessionRequest = z.object({ device_secret: z.string().min(1).max(200) }).strict();

/**
 * What a device session tells the phone about itself.
 *
 * The shop's id and name, and nothing about a person. `location_id` is here
 * because the client renders which counter it is at, and a phone that cannot say
 * which location it belongs to cannot be told apart from another phone in the
 * same shop by the person holding it.
 */
export const deviceSessionResponse = z.object({
  device: z.object({ shop_id: uuid, shop_name: z.string(), location_id: uuid }),
});

/**
 * The operator picker's payload (048 §3.5, I7).
 *
 * **Display name and id ONLY.** No count, no timestamp, no ordering key, no
 * "last used", no badge and no streak — a roster is a list of who could be
 * holding the phone, and a leaderboard is a list of what they did. The DTO is
 * what makes that a schema-level fact instead of a habit of one query.
 */
export const operatorRosterResponse = z.object({
  operators: z.array(z.object({ id: uuid, display_name: z.string() })),
});

/** Tap a name, enter six digits (048 §3.5). */
export const operatorSessionRequest = z
  .object({ app_user_id: uuid, pin: z.string().min(1).max(32) })
  .strict();

/**
 * What a successful PIN returns: the operator's own id and display name — which
 * the person just selected and typed a PIN for, so it discloses nothing — and
 * the shop the session is scoped to.
 */
export const operatorSessionResponse = z.object({
  operator: z.object({ id: uuid, display_name: z.string() }),
  shop: z.object({ id: uuid, name: z.string() }),
});

/**
 * Redeeming an invitation (E03-D07, 048 §7.1, §7.2).
 *
 * Two fields, both credentials, both `.strict()`. The code is bounded generously
 * because `normaliseCode` strips hyphens and spaces before it is digested — a
 * person who types the groups they saw must not be refused by a length check
 * that counted the separators.
 *
 * **There is no `app_user_id`, no `display_name` and no `email` here, and their
 * absence is the design.** The invitation NAMES the person it was written for
 * (`migrations/024`), so whoever holds the code cannot decide who they are.
 */
export const invitationRedemptionRequest = z
  .object({ code: z.string().min(1).max(64), pin: z.string().min(1).max(32) })
  .strict();

/**
 * What a redeemed invitation returns: the person's own id and display name —
 * which they just proved they are entitled to by holding the code written for
 * them — and the shop they now hold a membership at. Identical in shape to
 * `operatorSessionResponse`, because it answers the same question.
 */
export const invitationRedemptionResponse = z.object({
  operator: z.object({ id: uuid, display_name: z.string() }),
  shop: z.object({ id: uuid, name: z.string() }),
});

/**
 * Redeeming a device enrollment code (E03-D07, 048 §7.3).
 *
 * One field, because the phone has nothing else to offer: it holds no session,
 * which is what enrollment means.
 */
export const deviceEnrollmentRequest = z.object({ code: z.string().min(1).max(64) }).strict();

/**
 * What an enrolled phone is told about itself — the same DTO
 * `POST …/device-sessions` returns, because the phone is in the same state
 * afterwards: it holds a device session and knows which counter it is at.
 *
 * **It does NOT carry the device credential's secret**, and that is a decision
 * rather than an omission: the secret is minted, hashed and discarded, and the
 * phone holds only the rotating session (see `redeemEnrollmentCode`).
 */
export const deviceEnrollmentResponse = deviceSessionResponse;

/** Signing an operator out is a body-less act on the session the cookies name. */
export const endOperatorSessionRequest = z.object({}).strict();
export const endOperatorSessionResponse = z.object({ ended: z.literal(true) });

// ---------------------------------------------------------------------------
// E03-B06 — the connector surface (000-docs/053 §8).
// ---------------------------------------------------------------------------

/**
 * The OAuth callback's query, as Shopify sends it.
 *
 * ⚠ **THE SCHEMA IS NOT THE AUTHENTICATION AND MUST NOT BE READ AS ONE.** It
 * bounds the SHAPE — a string of a stated length, present or absent — and every
 * field in it is attacker-controlled until `verifyQueryHmac` has run over the
 * whole query with the app secret. `shop` in particular is checked a second time
 * against `isShopifyShopDomain` before it is used, because the next thing the
 * install does with it is POST this app's client secret to it.
 *
 * `.strict()` is deliberately NOT used, and this is the one contract in the file
 * where a passthrough is the safe choice: Shopify adds parameters to this
 * callback over time (`host` arrived after `timestamp`), every one of them is
 * INSIDE the signed message, and a strict schema would refuse an authentic
 * callback the day the provider adds a field. The signature — which covers every
 * parameter, including ones this schema has never heard of — is what makes that
 * safe.
 */
export const connectorCallbackQuery = z.object({
  shop: z.string().min(1).max(255),
  code: z.string().min(1).max(255),
  state: z.string().min(1).max(255),
  hmac: z.string().min(1).max(128),
  timestamp: z.string().max(32).optional(),
  host: z.string().max(512).optional(),
});

/**
 * What the callback answers.
 *
 * THREE FIELDS AND NO IDENTIFIERS. It carries no token, obviously; it also
 * carries no `connector_token_version_id`, no state id and no shop id, because
 * the reader is a browser at the end of a provider redirect and none of those is
 * anything it can act on — while every one of them would be an id disclosed to
 * whoever completed the redirect. `granted_scopes` IS here: it is exactly what
 * the merchant approved on Shopify's own consent screen a second earlier, so it
 * discloses nothing they were not just shown, and it is the one thing worth
 * seeing at that moment.
 *
 * ⚠ IT IS JSON, NOT A PAGE. 042 §4.3 rules that the server emits no operator
 * prose, so this route cannot answer with a "Longbox is connected" screen. The
 * merchant-facing install and consent SURFACE — including the words on it — is
 * E10-B02's, and its copy is a candidate C-row for 000-docs/021 under the T26
 * pre-send (053 §9). It is not written here.
 */
export const connectorCallbackResponse = z.object({
  connector: z.literal("shopify"),
  shop_domain: z.string(),
  granted_scopes: z.array(z.string()),
});

/**
 * What a webhook receiver answers: an acknowledgement and nothing else.
 *
 * Not the receipt id, not `duplicate`, not the topic. The reader is Shopify's
 * delivery system, which acts on the STATUS CODE alone — and every additional
 * field would be a fact about this system's state returned to a caller that
 * authenticated with a shared secret rather than as a tenant. A redelivery and a
 * first delivery answer identically, which is what an idempotent receiver
 * should look like from outside.
 */
export const connectorWebhookResponse = z.object({ acknowledged: z.literal(true) });

export type SessionDetail = z.infer<typeof sessionDetailResponse>;
export type IdentifyResponse = z.infer<typeof identifyResponse>;
