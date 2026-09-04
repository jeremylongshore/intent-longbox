// Confirmation outcome (019 §3.0, T3, T20; 035 §4.3).
//
// `human_confirmation.outcome` records whether the operator ACCEPTED the
// identity the system proposed ('confirm') or CHANGED it ('correct'). T3's
// numerator is "one-tap items later outcome=correct"; 035 §4.3's blind
// labelling protocol reads the same field. It is computed at INSERT time from
// facts already on the session and is immutable thereafter — a mis-set outcome
// will be corrected by appending a superseding row once E02-B07 lands the
// `supersedes_id` writer, never by UPDATE. Until then the column that 003
// reserved has no writer and a mis-set outcome simply stands.
//
// Pure functions only: no database, no I/O. The route supplies the two payloads.

/** The two ratified values of human_confirmation.outcome (019 §3.0). */
export type ConfirmationOutcome = "confirm" | "correct";

/** How the confirmation reached us — mirrors human_confirmation.source. */
export type ConfirmationSource = "one_tap" | "grid_pick" | "manual_search" | "owner_review";

/**
 * Normalize one identity field: trim, collapse internal whitespace, casefold.
 *
 * Deliberately NOT a strict-equality-on-objects check. A grid pick round-trips
 * the candidate through JSON and back through the browser, so the confirmed
 * payload is never the same object as the proposal and often not even key-for-key
 * identical — it may carry extra fields (`confidence`, `variantHints`) or lose
 * optional ones. Equality has to be defined on the identity the operator saw.
 */
function normalizeField(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Issue numbers arrive as "300", "#300", " 300 " from different surfaces
 * (LLM candidate, barcode parse, hand entry). The leading hash is punctuation,
 * not identity. Anything else is preserved verbatim — "300A" is NOT "300".
 */
function normalizeIssue(value: unknown): string {
  return normalizeField(value).replace(/^#+/, "").trim();
}

/**
 * The identity of a comic, per 019 T1: title + issue + variant. Publisher and
 * year are metadata the operator does not pick between — two candidates that
 * differ only in `year` are the same identity claim with one of them mistyped,
 * and a manual entry routinely omits both — so including them would score a
 * plain acceptance as a correction and inflate T3.
 *
 * Returns null when the payload carries no usable identity at all (no title AND
 * no issue), which is how "there was nothing comparable to propose" is
 * represented — e.g. the latest candidate_set is a barcode parse, or a manual
 * search on a session that never ran identify.
 */
export function identityKey(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const title = normalizeField(p.title);
  const issue = normalizeIssue(p.issue);
  // A missing variant, an empty string and an explicit null are the same claim:
  // "no variant designator". Only a non-empty designator distinguishes.
  const variant = normalizeField(p.variant);
  if (title === "" && issue === "") return null;
  // Fields are joined with an ASCII unit separator, which cannot occur in any
  // of them, so no title/issue/variant combination can collide with another.
  return [title, issue, variant].join("\u001f");
}

/**
 * Decide the outcome of a confirmation.
 *
 * The BASELINE — the thing the operator is agreeing with or changing — is
 * whichever of these exists, in this order:
 *
 *  1. `priorConfirmation`: the identity already confirmed on this session.
 *     T20 is "draft → publish without owner edits to identity or condition", so
 *     an owner_review is reviewing the IDENTITY IT INHERITED, not the model's
 *     ranking. An owner who agrees with an employee's manual correction has
 *     edited nothing, and must score 'confirm' even though the employee's pick
 *     disagreed with the top candidate; an owner who reverts to the model's top
 *     candidate HAS edited the identity, and must score 'correct' even though
 *     the result matches what the model originally proposed. Comparing against
 *     the proposal in either case inverts T20.
 *  2. `topProposal`: the top-ranked entry of the session's latest non-barcode
 *     candidate_set. This is the baseline for the FIRST confirmation on a
 *     session, where the only thing on screen is what the model offered.
 *
 * Rules (019 §3.0, T3, T20):
 *  - `one_tap` is ALWAYS 'confirm'. One tap is the act of accepting what is on
 *    screen; it has no other meaning, and T3's denominator is exactly the set of
 *    one-tap confirmations. A one-tap payload that failed to match the baseline
 *    would be a client bug, not a correction by the operator.
 *  - Every other source compares the confirmed identity to the baseline above.
 *    Equal → 'confirm' (the operator accepted what was already there; when the
 *    baseline is a proposal, the system was right and the extra tap was the
 *    band's caution rather than a miss). Different → 'correct'.
 *  - No comparable baseline at all — no prior confirmation AND no candidate_set,
 *    an empty one, or a top entry with no identity — → 'correct': the operator
 *    supplied an identity nothing offered. A manual search on a session that
 *    never ran identify is the canonical case.
 */
export function decideOutcome(args: {
  source: ConfirmationSource;
  /** The identity the operator confirmed (the request's `issue` payload). */
  confirmed: unknown;
  /** Top-ranked entry of the session's latest non-barcode candidate_set, if any. */
  topProposal: unknown;
  /**
   * `confirmed_issue` of the session's latest human_confirmation, if any.
   * Takes precedence over `topProposal` — see the baseline order above.
   */
  priorConfirmation?: unknown;
}): ConfirmationOutcome {
  if (args.source === "one_tap") return "confirm";
  const baseline = identityKey(args.priorConfirmation) ?? identityKey(args.topProposal);
  if (baseline === null) return "correct";
  const confirmed = identityKey(args.confirmed);
  if (confirmed === null) return "correct";
  return confirmed === baseline ? "confirm" : "correct";
}

/**
 * Pull the top-ranked proposal out of a candidate_set's `candidates` jsonb.
 * Rank is array order (identify.ts writes `result.ranked`), so the top proposal
 * is index 0. Anything that is not a non-empty array yields undefined, which
 * decideOutcome reads as "nothing was proposed".
 */
export function topCandidateOf(candidates: unknown): unknown {
  return Array.isArray(candidates) && candidates.length > 0 ? candidates[0] : undefined;
}
