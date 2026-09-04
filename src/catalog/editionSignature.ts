// `edition_signature` — the CATALOG's dedupe key (030 §3.3, 047 §9.3).
//
// ⚠ THIS IS NOT `identityKey`, AND THE TWO MUST NOT BE MERGED.
// `src/services/confirmationOutcome.ts` exports `identityKey`, which looks
// enough like this function that a future reader will want to delete one of
// them. 047 §9.3 rules that they stay two functions with two names, and the
// reason is that merging them would MOVE A MEASUREMENT RULE:
//
//   |            | identityKey (shipped)              | edition_signature (here)        |
//   |------------|------------------------------------|---------------------------------|
//   | Fields     | title, issue, variant              | series, issue, variant, printing|
//   | Scope      | two payloads WITHIN ONE SESSION    | the WHOLE CORPUS                |
//   | Job        | decide outcome ∈ {confirm,correct} | catalog dedupe + the Q2/Q3 lookup|
//   | Owner      | workflow                           | catalog                         |
//   | Versioning | none — a change is a change to a   | `normalization_version`, and the |
//   |            | 019 measurement                    | pack version beside it           |
//
// `identityKey` deliberately EXCLUDES publisher and year, and the reason is
// written at `src/services/confirmationOutcome.ts:44-49`: including them "would
// score a plain acceptance as a correction and inflate T3". `019:57` makes T1's
// exclusion rule non-editable without a 000-docs/006 row — so this is not a
// refactor a builder may perform, IN EITHER DIRECTION.
//
// THIS FILE THEREFORE IMPORTS NOTHING FROM `src/services/`, AND SHARES NO
// FIELD-LIST CONSTANT WITH IT (047 A8). The full static guard — a
// dependency-cruiser rule plus an assertion that a PR touching both functions
// without a 006 row FAILS — is E04-B02's acceptance line and is NOT built here.
// What is built here is the other half of A8's requirement: the two field lists
// are separate literals in separate modules, so the mechanical merge (one
// exported FIELDS array imported by both) is not available to anyone.
//
// WHAT IS REUSED, DELIBERATELY: the NORMALISATION. Trim, collapse internal
// whitespace, casefold, strip a leading `#` from an issue number, treat
// missing/empty/null as the same claim, and join with a separator that cannot
// occur in a field. 047 §9.3 says in terms that this is "good normalisation and
// should be reused". What must not be reused is the FIELD LIST, because the two
// functions answer different questions.
//
// A SIGNATURE IS NOT AN IDENTITY (030 §3.3). Two rows with the same signature are
// a DEDUPE CANDIDATE — a human-queue item — and never an automatic merge. That is
// why `edition_signature` carries no UNIQUE constraint (047 A1/I17) and why the
// repair for a duplicate is an `lcid_merge` fact somebody decided.

/**
 * The version of the normalisation RULE below, stored on every
 * `edition_signature` row.
 *
 * It is NOT `vertical_pack_version.pack_version`. The pack version governs the
 * whole manifest single-rate (030 A5); this number lets a reader ask "which
 * normalisation produced this exact text" without resolving a pack. A change to
 * any rule in `normalizeField` or to a vertical's field list BUMPS IT, and the
 * bump produces NEW rows in a new corpus version rather than rewriting old ones.
 */
export const NORMALIZATION_VERSION = 1;

/**
 * ASCII unit separator. Chosen because it cannot occur in any normalised field,
 * so `a|b` and `a` + `|b` can never collide.
 */
const SEP = "\u001f";

/**
 * One field, normalised. Missing, null, empty and whitespace-only are THE SAME
 * CLAIM and all normalise to the empty string — a distinction the catalog cannot
 * observe must not become a distinction the signature encodes.
 */
export function normalizeField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** An issue number, normalised. A leading `#` is decoration, not data. */
export function normalizeIssue(value: string | null | undefined): string {
  return normalizeField(value).replace(/^#+\s*/, "");
}

/**
 * The COMIC vertical's identity fields, per 030 §3.3's ratified signature:
 * `series + issue + variant + printing`.
 *
 * Publisher and year are absent, and so is anything about a COPY. 047 §8.4 / A6:
 * `grader` and `cert_number` are copy facts in every vertical, and a pack
 * manifest that declares either as an edition field fails pack certification.
 */
export interface ComicEditionFields {
  readonly series?: string | null;
  readonly issue?: string | null;
  readonly variant?: string | null;
  readonly printing?: string | null;
}

/**
 * The comic pack's signature function.
 *
 * Pure, deterministic, and stable across corpus versions: the same fields yield
 * the same string forever, which is what makes the Q2/Q3 equality lookup on
 * `edition_signature (vertical, signature)` a real index plan rather than a hope.
 *
 * ⚠ The field list below is this module's own literal. It is NOT imported from
 * anywhere and must not be exported for reuse by a workflow-side function.
 */
export function comicEditionSignature(fields: ComicEditionFields): string {
  return [
    normalizeField(fields.series),
    normalizeIssue(fields.issue),
    normalizeField(fields.variant),
    normalizeField(fields.printing),
  ].join(SEP);
}

/**
 * The registered signature functions, keyed by `vertical_pack.vertical`.
 *
 * ONE ENTRY TODAY, and that is not an oversight. E19-B06 gates any second
 * vertical on reuse, rights, accuracy, economics and demand evidence (030 §5.4):
 * "architectural possibility is not market permission". The card pack's signature
 * is E04-B03's and does not exist. When it lands it is registered here — or, once
 * E04-B04 ships the pack manifest as code, resolved through
 * `vertical_pack_version.signature_fn_ref` and FAILING CLOSED when the module is
 * missing (030 §5.2). This map is the interim, and it is deliberately small.
 */
const SIGNATURE_FUNCTIONS: Record<string, (fields: Record<string, unknown>) => string> = {
  comic: (fields) => comicEditionSignature(fields as ComicEditionFields),
};

/** Thrown when a write names a vertical with no registered signature function. */
export class UnregisteredVerticalError extends Error {
  constructor(vertical: string) {
    super(
      `no signature function registered for vertical ${JSON.stringify(vertical)} — ` +
        `030 §6 rule 3: an unregistered vertical is refused at the boundary, never defaulted to "comic"`
    );
    this.name = "UnregisteredVerticalError";
  }
}

/**
 * Compute a signature for any registered vertical. FAILS CLOSED (030 §6 rule 3):
 * an unregistered vertical is refused, never defaulted.
 */
export function editionSignature(vertical: string, fields: Record<string, unknown>): string {
  const fn = SIGNATURE_FUNCTIONS[vertical];
  if (!fn) throw new UnregisteredVerticalError(vertical);
  return fn(fields);
}
