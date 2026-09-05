// Confirmation outcome (019 §3.0, T1, T3, T20; 035 §4.3).
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
// Pure functions only: no database, no I/O, AND NO IMPORTS AT ALL — which is not
// tidiness but 047 A8's mechanical half held by construction: a file that imports
// nothing cannot share a field-list constant with the catalog, in either
// direction (`scripts/architectureRules.ts` rule 7, `.dependency-cruiser.cjs`
// `identity-key-and-edition-signature-stay-apart`). The route supplies the
// payloads and the session's vertical.
//
// ═══ E04-D04: THE KEY IS VERTICAL-AWARE, AND THE FIELD LISTS STAY HERE ═══
//
// Until this bead `identityKey` computed `[title, issue, variant]`
// UNCONDITIONALLY — no vertical parameter, no lookup. 049 §11.1 H1 named it the
// cannon's most-costly finding and 049 §8 turned it into a gate: a card
// confirmation would have found all three fields `undefined`, every card session
// would have keyed to the same degenerate string, and T1/T3 would have been
// corrupted silently from the first card item. It is the same defect class
// E04-B03 fixed one hop upstream in `identityResolution.ts` — a comic question
// wearing field names rather than a vertical literal, which rule 8's regex is
// structurally blind to.
//
// WHY THE PER-VERTICAL COMPOSERS LIVE **HERE** AND NOT IN `packRegistry.ts`.
// 049 §8's acceptance line names the pack registry — "resolving its field list
// through `packRegistry`, the shape §6.3 used" — and that shape was examined
// first and rejected on three grounds, each of which is a ratified control:
//
//  1. `.dependency-cruiser.cjs` forbids this file from importing `^src/catalog/`
//     at all. Relaxing it to admit the registry admits `editionSignature` and
//     `signatureClaim` with it — the registry re-exports both — so the exception
//     would unlock precisely the merge A8 exists to make unavailable. Passing the
//     composer IN as a parameter avoids the import but moves the key out of this
//     file, leaving rule 7 guarding a house with nothing in it: a gate that
//     passes vacuously forever, the failure mode 052 §6 credits the rule for
//     avoiding.
//  2. `checkIdentityPairEdit` (A8's human half) fires only when this file and a
//     catalog identity file are edited together. A measurement key living in the
//     catalog would be edited catalog-only — so the 006-row requirement, which is
//     the entire enforcement of `019:57`/`019:59`, would silently stop applying
//     to the thing it was written for.
//  3. 030 A5 makes a pack version SINGLE-RATE over schema, signature, capture
//     recipe, condition schema, crosswalk and prohibited claims. A confirmation
//     key inside that bundle could be moved by a pack bump, with no 019 row and
//     no 006 row — which is exactly 052 §6's "two questions, two owners, two
//     versioning schemes" collapsing into one. **Registering a vertical is a
//     catalog act; deciding what T1/T3 measure for it is a 019 act**, and 049 §8's
//     own alternative branch says so in terms ("a 006 row … names what T1/T3
//     measure for a card instead"). That branch is the one taken, and the 006 row
//     of 2026-09-04 plus 019 §9.3's row A8 are it.
//
// THE COST OF THE CHOICE, PAID OPENLY: there are now two per-vertical registries,
// and a pack registered in one and missing from the other is a real mistake. It
// is closed two ways rather than hoped about — an unregistered vertical THROWS
// here (never degrades to comic, never returns null, because a null would score a
// real confirmation as 'correct' and corrupt the measurement in the quiet
// direction), and `tests/edition-signature.test.ts` asserts this registry's key
// set EQUALS the catalog's `REGISTERED_VERTICALS`, so adding a pack without a
// measurement key fails CI in the same PR.
//
// WHAT IS REUSED IS THE NORMALISATION, BY COPY (047 §9.3: the normalisation
// "should be reused" and the field list must not). Copying rather than importing
// is the settled pattern in this neighbourhood — `cardIdentity.ts` copies the
// comic pack's `required` helper for the same stated reason: "a shared helper is
// one refactor away from becoming a shared field list."

/** The two ratified values of human_confirmation.outcome (019 §3.0). */
export type ConfirmationOutcome = "confirm" | "correct";

/** How the confirmation reached us — mirrors human_confirmation.source. */
export type ConfirmationSource = "one_tap" | "grid_pick" | "manual_search" | "owner_review";

/**
 * ASCII unit separator. It cannot occur in any normalised field, so no
 * combination of fields can collide with another combination.
 */
const SEP = "\u001f";

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
 * A card number: the issue rule plus one card-specific one — whitespace around a
 * hyphen is dropped, so `RC - 12`, `RC- 12` and `RC-12` are one number. The
 * hyphen ITSELF is kept, because nothing in the domain says `RC-12` and `RC12`
 * are the same card, and a normalisation that MIGHT merge two real cards is worse
 * than one that leaves two spellings as a visible disagreement.
 */
function normalizeCardNumber(value: unknown): string {
  return normalizeIssue(value).replace(/\s*-\s*/g, "-");
}

/**
 * A language tag: trimmed, casefolded, `_` folded to `-`. No default and no
 * synonym table, for the card pack's own reason — defaulting an absent language
 * to English would let a Japanese printing and an English one compare equal, and
 * "English" versus "en" is a disagreement a measurement must not silently
 * resolve.
 */
function normalizeLanguage(value: unknown): string {
  return normalizeField(value).replace(/_/g, "-");
}

/** A payload as a bag of fields, or an empty bag when it is not an object at all. */
function bag(payload: unknown): Record<string, unknown> {
  return payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

/**
 * The COMIC vertical's confirmation key: title + issue + variant.
 *
 * Publisher and year are metadata the operator does not pick between — two
 * candidates that differ only in `year` are the same identity claim with one of
 * them mistyped, and a manual entry routinely omits both — so including them
 * would score a plain acceptance as a correction and inflate T3.
 *
 * `printing` is excluded for a related but distinct reason: to an operator
 * picking between candidates at a counter, a first and a second printing are the
 * same identity claim. THE CATALOG DISAGREES, and must — `comicEditionSignature`
 * carries `printing` as its fourth position (030 §3.3). Two questions, two field
 * lists, and `tests/edition-signature.test.ts` pins the disagreement.
 *
 * ⚠ THE BYTES OF THIS KEY ARE T1/T3 HISTORY. E04-D04 made the key vertical-aware
 * and changed nothing about the comic composition — same three fields, same
 * order, same separator, same normalisation, same null rule — so no confirmation
 * ever scored changes its outcome. `tests/confirmation-outcome.test.ts` pins the
 * exact string rather than trusting the diff to have been careful.
 *
 * Returns null when the payload carries no usable identity at all (no title AND
 * no issue), which is how "there was nothing comparable to propose" is
 * represented — e.g. the latest candidate_set is a barcode parse, or a manual
 * search on a session that never ran identify.
 */
function comicConfirmationKey(payload: unknown): string | null {
  const p = bag(payload);
  const title = normalizeField(p["title"]);
  const issue = normalizeIssue(p["issue"]);
  // A missing variant, an empty string and an explicit null are the same claim:
  // "no variant designator". Only a non-empty designator distinguishes.
  const variant = normalizeField(p["variant"]);
  if (title === "" && issue === "") return null;
  return [title, issue, variant].join(SEP);
}

/**
 * BOTH card verticals' confirmation key: set + number + variant + parallel +
 * language. One composer for two registrations, because 049 §3.2's edition
 * schema is identical in both — a parallel, a language and a print run mean the
 * same thing whether the subject swings a bat or casts a spell.
 *
 * ⚠ THESE FIVE COINCIDE WITH `cardEditionSignature`'S FIVE, AND THAT IS AN
 * ANSWER RATHER THAN A COPY. The comic key drops `printing` because an operator
 * cannot see a printing while picking; every one of a card's five is visible on
 * the card in their hand, the language included, so there is nothing to drop.
 * Rule 7 is deliberately not "the field lists differ" — "two lists that happen to
 * be equal today are still two decisions" — and these two are owned by different
 * documents and moved by different change-control paths.
 *
 * The year and the manufacturer are excluded on the comic key's precedent: they
 * are definition metadata a manual entry omits, and including them would score a
 * plain acceptance as a correction.
 *
 * ⚠ `language` IS IN, AND THE DIRECTION OF THE ERROR IS WHY. Omitting it would
 * score an operator who switched from the English printing to the Japanese one as
 * having CONFIRMED — a false 'confirm' hides a real miss and flatters T1 and T3,
 * which 021 forbids in every direction that overstates. Including it can only
 * inflate T3, which reads worse than reality and trips a review rather than
 * hiding one. Between overstating accuracy and understating it, this contract
 * chooses understating.
 *
 * `setName`, `cardNumber` and `lang` are accepted as synonyms because that is how
 * a provider vocabulary spells them and a confirmation payload is built from
 * candidates; the pack's own words win when both are present.
 *
 * ⚠ PROVISIONAL IN ONE RESPECT, STATED SO IT IS NOT MISTAKEN FOR MEASURED: no
 * card corpus has ever been imported and no card shop is authorised (E19-B06), so
 * WHICH of these five an operator actually picks between is an untested claim
 * about a flow nobody has run. E04-B11's `variant`/`parallel` conflation
 * measurement is the first evidence that will bear on it.
 */
function cardConfirmationKey(payload: unknown): string | null {
  const p = bag(payload);
  const set = normalizeField(p["set"] ?? p["setName"]);
  const number = normalizeCardNumber(p["number"] ?? p["cardNumber"]);
  const variant = normalizeField(p["variant"]);
  const parallel = normalizeField(p["parallel"]);
  const language = normalizeLanguage(p["language"] ?? p["lang"]);
  // A set or a number. Neither means the payload named no card at all, and a key
  // over five empty fields would compare equal to every other empty claim.
  if (set === "" && number === "") return null;
  return [set, number, variant, parallel, language].join(SEP);
}

/**
 * THE CONFIRMATION-KEY REGISTRY — one composer per vertical, selected by a MAP
 * LOOKUP and never by a comparison (030 §6 rule 1: core code may read `vertical`
 * only to select a pack; 014 §3.4: "plug-and-play requires a vertical pack, not
 * scattered `if comic` statements").
 *
 * Three entries, two composers, and NOT ONE OF THEM AUTHORISED TO TRADE — the
 * card rows mirror `packRegistry.ts`'s two card registrations, which exist so the
 * core can absorb a second vertical without branching and which E19-B06 gates on
 * reuse, rights, accuracy, economics and demand evidence before any shop sees
 * them. Registration is not authorisation, here as there.
 *
 * The keys are string literals rather than imported constants because this file
 * imports nothing (see the header). The copy is not left to drift: the test named
 * in the header asserts this key set equals the catalog's `REGISTERED_VERTICALS`,
 * so the two registries move together or CI stops the PR.
 */
const CONFIRMATION_KEYS: ReadonlyMap<string, (payload: unknown) => string | null> = new Map([
  ["comic", comicConfirmationKey],
  ["sports-card", cardConfirmationKey],
  ["tcg-card", cardConfirmationKey],
]);

/**
 * ⚠ A `Map` AND NOT AN OBJECT LITERAL, AND THE REASON IS A DEFECT THE FIRST
 * VERSION OF THIS FILE SHIPPED TO REVIEW (PR #80, MiniMax finding 2).
 *
 * `PACKS[vertical]` on a plain object resolves INHERITED keys: `"toString"`,
 * `"valueOf"`, `"constructor"` and `"hasOwnProperty"` all find a member of
 * `Object.prototype`, which is not `undefined`, so an `=== undefined` guard waves
 * them through. `identityKey("toString", payload)` then returned
 * `Object.prototype.toString.call(payload)` — a plausible STRING, which
 * `decideOutcome` compares like any other key. That is not a crash; it is the
 * fail-OPEN this whole file exists to make impossible, reachable by a vertical
 * whose name happens to be a JavaScript builtin.
 *
 * A `Map` has no inherited keys, so the refusal is a property of the data
 * structure rather than of a guard someone has to remember to write. The
 * alternatives — `Object.hasOwn` or a null-prototype object — work too and were
 * rejected as weaker: both leave the trap in place and add a check beside it.
 */
export const MEASURED_VERTICALS: readonly string[] = [...CONFIRMATION_KEYS.keys()];

/**
 * Thrown when a confirmation names a vertical with no registered confirmation
 * key. FAILS CLOSED, and loudly: the alternatives are worse in a way that is hard
 * to see later. Defaulting to the comic composer degenerates every field to the
 * empty string and collapses a whole vertical into one key; returning null scores
 * every confirmation in that vertical as 'correct'. Both corrupt 019 T1 and T3
 * while type-checking, passing tests and raising nothing — which is the exact
 * shape of the defect this class exists because of (049 §11.1 H1).
 */
export class UnmeasurableVerticalError extends Error {
  constructor(vertical: string) {
    super(
      `no confirmation key registered for vertical ${JSON.stringify(vertical)} — ` +
        `019 T1/T3 cannot be measured for it, and a confirmation that cannot be measured is ` +
        `refused rather than mis-measured (049 §8). Registering a vertical in ` +
        `src/catalog/packRegistry.ts is a CATALOG act; deciding what T1/T3 compare for it is a ` +
        `019 act — add the composer here and file the 000-docs/006 row that names the measurement ` +
        `change (047 A8, 019 §9.3).`
    );
    this.name = "UnmeasurableVerticalError";
  }
}

/** The composer for a vertical, or a refusal. Never a default, never a guess. */
function keyComposerFor(vertical: string): (payload: unknown) => string | null {
  const composer = CONFIRMATION_KEYS.get(vertical);
  if (composer === undefined) throw new UnmeasurableVerticalError(vertical);
  return composer;
}

/**
 * The identity of one confirmation payload IN ITS VERTICAL, as a comparable key.
 *
 * The vertical comes first, mirroring the catalog's `signatureClaim(vertical, …)`
 * and `editionSignature(vertical, …)`, and it is a required parameter rather than
 * an option with a comic default. That is 047 A11's argument about `asOf` applied
 * one module over — "an optional parameter with a silent default is exactly the
 * kind of API shape that lets a caller be accidentally correct in dev and
 * silently wrong … months later."
 *
 * ⚠ THE STRING IS NOT AN IDENTIFIER AND IS NEVER NAMESPACED BY THE VERTICAL.
 * It is not stored in any column, not returned in any response, and not compared
 * with any key from another call: `decideOutcome` composes all three of its
 * payloads with the SAME composer, inside one session, which has one vertical.
 * So a hypothetical cross-vertical collision has no site at which to occur —
 * asking whether two verticals' keys can collide is asking whether two values
 * that are never compared are equal. Prefixing the vertical was considered and
 * rejected for a concrete cost against no benefit: it would change the comic
 * bytes, and those bytes are T1/T3 history (`tests/confirmation-outcome.test.ts`
 * pins them). The arity difference is asserted anyway, so the property is
 * checkable rather than merely argued.
 */
export function identityKey(vertical: string, payload: unknown): string | null {
  return keyComposerFor(vertical)(payload);
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
 *
 * ⚠ THE VERTICAL IS RESOLVED BEFORE THE `one_tap` SHORTCUT, not after. A one-tap
 * is 'confirm' whatever the key says, so resolving first costs an outcome
 * nothing — but a one-tap in an unmeasurable vertical would otherwise enter T3's
 * DENOMINATOR while its numerator stayed uncountable, which is a quieter
 * corruption of the same threshold. Fail closed on the way in.
 */
export function decideOutcome(args: {
  /** The session's vertical — `vertical_pack.vertical`, supplied by the caller. */
  vertical: string;
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
  const key = keyComposerFor(args.vertical);
  if (args.source === "one_tap") return "confirm";
  const baseline = key(args.priorConfirmation) ?? key(args.topProposal);
  if (baseline === null) return "correct";
  const confirmed = key(args.confirmed);
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
