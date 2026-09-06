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
  //
  // `against_table` / `against_id` ARE published, and the reason is that they are
  // the same kind of field as `supersedes_id` beside them: a REFERENCE to another
  // record of this session, carrying no confidence, no provider, no cost and no
  // person (042 I9, 019 T35). They answer 022 P8's decision strip — what the
  // person was looking at when they decided — from the trail the client already
  // reads, rather than by a second query nobody would write. Both are `null`
  // together or present together (migration `030`'s whole-or-absent CHECK), and
  // `null` means 042 §6.5's counted fallback or a row older than that migration.
  human_confirmation: z.object({
    id: uuid,
    confirmed_issue: z.unknown(),
    source: z.string(),
    outcome: z.string().nullable(),
    supersedes_id: uuid.nullable(),
    against_table: z.string().nullable(),
    against_id: uuid.nullable(),
    created_at: timestamp,
  }),
  condition_assessment: z.object({
    id: uuid,
    grade_range_low: z.string(),
    grade_range_high: z.string(),
    defects: z.array(z.string()),
    notes: z.string().nullable(),
    supersedes_id: uuid.nullable(),
    against_table: z.string().nullable(),
    against_id: uuid.nullable(),
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
// E03-D11 — the first factor, the privileged session, and the two issuance
// routes it un-pends (000-docs/057; 048 §4.1, §7, §12.4 row 3a).
// ---------------------------------------------------------------------------

/**
 * Signing in as a person rather than as a phone (048 §4.1).
 *
 * **Three fields are a credential and one is a scope, and the scope is checked
 * rather than trusted.**
 *
 *   * `email` is a LOGIN IDENTIFIER, never a delivery channel — 048 §7.2 records
 *     that no mailer exists and that this system will not invent one;
 *   * `password` and exactly one of `totp_code` / `recovery_code`. A recovery
 *     code substitutes for the SECOND factor ONLY (048 R20): it is never
 *     accepted without the password, never on its own, and never in place of the
 *     password. `.strict()` plus the refinement below is where that stops being
 *     a sentence in a record;
 *   * `shop_id` names WHICH tenant this session is for, because a person may
 *     hold memberships at several shops (034 §2.6) and 048 §6.1 requires the
 *     session to be the only source of `shop_id`. It is a VALUE CHECKED against
 *     the person's live memberships, exactly as a URL's `shopId` is checked
 *     against the session one layer up — a shop they hold nothing at answers
 *     the same refusal an unknown one does;
 *   * `location_id` is OPTIONAL and names the storefront the person is acting
 *     for, checked against the shop and against their own grant. Without it a
 *     location-scoped manager could reach no location-scoped permission from a
 *     desk at all (057 §4.4).
 *
 * **There is no `remember_me`, no `device_name` and no `stay_signed_in`.** The
 * privileged session's whole point is that it is short (048 §4.1's freshness
 * window), and a field that lengthens it is a field that removes the control.
 */
export const privilegedSessionRequest = z
  .object({
    email: z.string().min(3).max(320),
    password: z.string().min(1).max(1024),
    totp_code: z.string().min(1).max(16).optional(),
    recovery_code: z.string().min(1).max(64).optional(),
    shop_id: uuid,
    location_id: uuid.optional(),
  })
  .strict()
  .refine((v) => (v.totp_code === undefined) !== (v.recovery_code === undefined), {
    message: "exactly one second factor",
  });

/**
 * What a privileged sign-in returns.
 *
 * The person's own id and display name — which they just proved two factors for
 * — the shop the session is scoped to, and `must_reenroll`, which is 048 §8.1's
 * forced re-enrollment as a fact the client can render rather than a 403 it has
 * to discover by trying something.
 *
 * **No role, no permission list and no expiry.** A role would be a per-operator
 * datum on the wire (022 P3, 042 I7), a permission list would be a second
 * spelling of `ROLE_GRANTS` that the client could act on while the server
 * disagreed (054 §3), and an expiry would invite a client to schedule against a
 * PROVISIONAL floor (042 A3, 021 B16).
 */
export const privilegedSessionResponse = z.object({
  person: z.object({ id: uuid, display_name: z.string() }),
  shop: z.object({ id: uuid, name: z.string() }),
  must_reenroll: z.boolean(),
});

/** Ending a privileged session is a body-less act on the session the cookie names. */
export const endPrivilegedSessionRequest = z.object({}).strict();
export const endPrivilegedSessionResponse = z.object({ ended: z.literal(true) });

/**
 * Issuing an invitation (048 §7.1), which until now was `pnpm issue-invitation`.
 *
 * **No `shop_id`.** The shop is the session's (048 §6.1), and a body field
 * naming one would be the path parameter the tenant plugin exists to make
 * unrepresentable, arriving through the body instead.
 *
 * **No `invited_by`.** The inviter is the session's person, stamped from the
 * session and never accepted from a body — 048 §6.3 and I8's rule, which the
 * CLI could only satisfy by being run by a trusted operator and which a route
 * satisfies structurally.
 *
 * `role` is a closed set that does NOT include `support_break_glass`: 034 §2.6
 * says it *"is never granted at ratification and never grants itself"*, the
 * database CHECK on `invitation.role` refuses it, `ROLE_GRANTABLE` refuses it,
 * and this schema refuses it — three layers that fail differently (034 §3.2).
 */
export const invitationRequest = z
  .object({
    email: z.string().min(3).max(320),
    display_name: z.string().min(1).max(200),
    role: z.enum(["owner", "manager", "operator"]),
    location_id: uuid.optional(),
    /**
     * **A FRESH second-factor code, REQUIRED when `role` is `owner`** (057 §4.4b).
     *
     * 048 §4.1 already puts every privileged act inside a session established by
     * password + TOTP within a freshness window, and §4.3 makes that window the
     * chain's absolute expiry — the right bound for an act whose damage the
     * expiry bounds. **Naming a second OWNER is not such an act.** The membership
     * it grants is permanent and carries the power to grant it again, so a copied
     * cookie spent here outlives every session in the system. This one act
     * therefore re-presents the factor instead of inheriting it.
     *
     * Optional in the SHAPE and mandatory in the RULE, deliberately: the service
     * refuses `role: "owner"` without it, so the requirement is stated where the
     * role is known rather than as a schema branch a reader has to unpick. It is
     * spent exactly once by 048 R19's conditional UPDATE, like any other code.
     */
    totp_code: z.string().min(1).max(16).optional(),
  })
  .strict();

/**
 * What an issued invitation returns.
 *
 * ⚠ **`code` IS PRESENT ON THE FIRST RESPONSE AND ABSENT ON ITS REPLAY, AND
 * THAT IS THE CONTRACT** (057 §4.8, and 042 §5.1's amend-by-a-row at v1.5.0).
 * The code is shown ONCE and stored nowhere — `invitation` holds `sha256` and
 * nothing else — so it cannot be part of the response body
 * `request_idempotency` stores, for exactly the reason a `Set-Cookie` is not:
 * storing it would put a live credential in a table, and NOT storing it while
 * pretending the replay is byte-identical would be a lie in a generated
 * artifact. A retry after a lost response therefore gets a truthful `201` with
 * the invitation's id, its expiry and no code — and the owner issues another and
 * lets the first expire, which is what `scripts/issue-invitation.ts` already
 * tells them to do.
 */
export const invitationResponse = z.object({
  invitation: z.object({
    id: uuid,
    role: z.enum(["owner", "manager", "operator"]),
    expires_at: z.string(),
    /** Present on the first response only. See the note above. */
    code: z.string().optional(),
  }),
});

/**
 * Issuing a device enrollment code (048 §7.3), until now
 * `pnpm issue-enrollment-code`.
 *
 * `location_id` is REQUIRED here where it is optional on the sign-in, and the
 * difference is 034 I7: `device.location_id` is `NOT NULL`, so an enrollment
 * names a location or it does not happen. It is checked against the session's
 * shop by `issueEnrollmentCode` before anything is minted.
 */
export const enrollmentCodeRequest = z
  .object({
    location_id: uuid,
    device_label: z.string().min(1).max(200),
    device_kind: z.enum(["phone", "kiosk", "tablet"]).default("phone"),
  })
  .strict();

/** Same shown-once contract as `invitationResponse`; the note there governs both. */
export const enrollmentCodeResponse = z.object({
  enrollment: z.object({
    id: uuid,
    location_id: uuid,
    expires_at: z.string(),
    /** Present on the first response only. */
    code: z.string().optional(),
  }),
});

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

// ---------------------------------------------------------------------------
// E03-D24 — the credential self-service surface (000-docs/063; 057 §9 R2/R2a;
// 048 §4.1, §8.1).
//
// FOUR ROUTES, and the split between them is the authority each one runs on:
//
//   * `POST /api/v1/credentials` — the FIRST password, on the counter phone,
//     inside the operator session the person just opened with their own PIN.
//     This is the route 057 §9 R2a is about: without it a deployed system has no
//     way to give anybody a password, so `POST /api/v1/privileged-sessions`
//     cannot succeed for any real person and the two issuance routes it guards
//     are unreachable by a shop.
//   * `POST /api/v1/credentials/rotations` — REPLACING a password, which needs
//     the privileged session the first one makes possible AND a fresh
//     second-factor code (048 §4.1's freshness, 057 §4.4b's construction).
//   * `POST /api/v1/authenticators/offers` then `POST /api/v1/authenticators` —
//     enrolling a second factor in two steps, because *"a secret that is never
//     confirmed never becomes a row"* (048 §4.3) and a confirmation needs a
//     round trip. The unconfirmed secret is SEALED and handed to the client; it
//     is in no table and in no server-side map.
// ---------------------------------------------------------------------------

/**
 * Setting a first password.
 *
 * **ONE field, and every absent field is the design.** There is no
 * `app_user_id`: the person is the operator session's, stamped from the session
 * and never accepted from a body (048 §6.3, I8). There is no `email`, for the
 * same reason. There is no `confirm_password`: a mistyped password is a screen's
 * problem and 042 §4.3 keeps screens out of the server.
 *
 * The maximum is generous and the minimum is `MIN_PASSWORD_LENGTH`'s, checked in
 * the service where the floor is stated once (057 §4.1 — a composition rule
 * shortens real passwords and lengthens nobody's, so there is none).
 */
export const setCredentialRequest = z.object({ password: z.string().min(1).max(1024) }).strict();

/**
 * What setting a password returns: that it is set, and nothing else.
 *
 * No id, no timestamp, no "you may now sign in at" — an id would be a handle on
 * a credential row nobody can act on, and a timestamp would be the first
 * per-person datum on a wire 022 P3 keeps clear of them.
 */
export const setCredentialResponse = z.object({ credential_set: z.literal(true) });

/**
 * Replacing a password from a privileged session.
 *
 * `totp_code` is REQUIRED here where it is optional-in-shape on the invitation
 * route, and the difference is that there is no role branch to wait for: every
 * caller of this route is replacing a credential, and 048 §4.1's freshness is
 * re-presented rather than inherited for the reason 057 §4.4b gives — a password
 * a thief has replaced outlives the session they replaced it from.
 *
 * **There is no `current_password` field.** The session was established with the
 * password less than `PRIVILEGED_ABSOLUTE_MS` ago (057 §4.3 — the absolute
 * expiry IS the freshness window), so asking for it again would re-test a factor
 * the session already carries while adding a second thing to get wrong. What the
 * request re-presents is the factor the session does NOT carry a fresh proof
 * of: the code from the person's own authenticator.
 */
export const rotateCredentialRequest = z
  .object({ password: z.string().min(1).max(1024), totp_code: z.string().min(1).max(16) })
  .strict();

/** Same DTO as setting one: it is set, and nothing else is disclosed. */
export const rotateCredentialResponse = setCredentialResponse;

/** Asking for a secret to enrol. A body-less act on the caller's own person. */
export const authenticatorOfferRequest = z.object({}).strict();

/**
 * The offer: a secret to scan, and the sealed ticket that carries it back.
 *
 * ⚠ **BOTH FIELDS ARE SHOWN ONCE AND STORED NOWHERE** (057 §4.8's rule, which
 * this route inherits and 063 §3.4 extends). `otpauth_uri` CONTAINS the secret
 * by construction — that is what an authenticator app scans — and
 * `enrollment_ticket` is that same secret sealed under the authenticator ring
 * with the person and the expiry as additional authenticated data. Neither is in
 * any table: the server mints, seals, answers and forgets, and the only copies
 * that exist afterwards are in the browser that asked and the phone that scanned.
 *
 * `expires_at` is here because the client must be able to say "start again"
 * rather than discovering the expiry as a refusal. It is the ticket's own
 * expiry, which is inside the sealed bytes as well, so a client that edits this
 * field changes nothing.
 */
export const authenticatorOfferResponse = z.object({
  otpauth_uri: z.string(),
  enrollment_ticket: z.string(),
  expires_at: z.string(),
});

/**
 * Confirming an offer: the ticket that came back, and a code generated FROM the
 * secret inside it.
 *
 * The code is what makes this an enrolment rather than an assertion: 048 §4.3's
 * *"a secret that is never confirmed never becomes a row"* is enforced by
 * `enrollAuthenticator`, which verifies the code against the secret before it
 * writes anything and spends the confirming step so nobody standing behind the
 * person can replay it (048 R19).
 */
export const enrolAuthenticatorRequest = z
  .object({
    enrollment_ticket: z.string().min(1).max(4096),
    /** Generated from the secret inside the ticket. It confirms the NEW factor. */
    code: z.string().min(1).max(16),
    /**
     * A code from the factor being REPLACED, required when there is one.
     *
     * ⚠ **TWO CODES FROM TWO SECRETS, AND CONFLATING THEM WOULD BE A HOLE.**
     * `code` proves the person holds the new secret; this one proves they hold
     * the OLD one, which is what stops a copied privileged cookie from silently
     * replacing a live second factor with the thief's (057 §4.4b's rule
     * generalised — the damage outlives the session, so the factor is
     * re-presented rather than inherited).
     *
     * Optional in the SHAPE and mandatory in the RULE, on `invitationRequest`'s
     * construction: the service requires it when `mfaState` reads `enrolled`,
     * because whether a live factor exists is a fact about the PERSON and not
     * about the request, and a caller must not be able to choose which rule
     * applies to them by omitting a field. A person in 048 §8.1's re-enrolment
     * state has no live factor and sends none — the recovery code they signed in
     * with was that presentation.
     */
    fresh_totp_code: z.string().min(1).max(16).optional(),
  })
  .strict();

/**
 * What an enrolment returns: the fresh recovery set, shown ONCE.
 *
 * ⚠ **`recovery_codes` IS PRESENT ON THE FIRST RESPONSE AND ABSENT ON ITS
 * REPLAY, AND THAT IS THE CONTRACT** — `invitationResponse`'s note governs this
 * field verbatim (057 §4.8, 042 §5.1 at v1.5.0). The codes are argon2id digests
 * under the pepper in `recovery_code` and are not recoverable from it, so they
 * cannot be part of the body `request_idempotency` stores; a retry after a lost
 * response therefore gets a truthful `201` with the enrolment's id and no codes,
 * and the person enrols again — which supersedes the set they did not see.
 *
 * There is no secret, no otpauth URI and no key version: the secret was the
 * offer's to show, and a key version is an operational fact about the ring
 * rather than anything a client can act on.
 */
export const enrolAuthenticatorResponse = z.object({
  authenticator: z.object({
    id: uuid,
    enrolled_at: z.string(),
    /** Present on the first response only. See the note above. */
    recovery_codes: z.array(z.string()).optional(),
  }),
});
