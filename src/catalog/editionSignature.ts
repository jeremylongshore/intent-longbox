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
// ⚠ THE PER-VERTICAL REGISTRY LEFT THIS FILE AT E04-B03, AND THE REASON IS A
// CYCLE, NOT A PREFERENCE. `SIGNATURE_FUNCTIONS` lived here and mapped
// `"comic"` to the function below. Registering a SECOND pack in it would have
// made this file import `cardIdentity.ts`, which imports the normalisation from
// this file — a two-module cycle, and `no-circular` in `.dependency-cruiser.cjs`
// is an ERROR ("029 §3.1: the module graph is a DAG. A cycle means a boundary was
// drawn wrong."). The boundary was indeed drawn wrong: a registry of packs is not
// a member of any pack. It now lives in `packRegistry.ts`, which imports every
// pack and is imported by NO PACK (`index.ts` imports it, and re-exports the pack
// modules too, because the module's public surface is `index.ts`; the property
// that kills the cycle is that the arrows run registry → pack, never the reverse).
// What stays here is what a pack may share
// — the NORMALISATION (047 §9.3 says in terms it "should be reused") — plus the
// comic pack's own signature function and its own field literal.
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
export const SIGNATURE_SEPARATOR = "\u001f";
const SEP = SIGNATURE_SEPARATOR;

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
  // `| undefined` is spelled out because the repo runs `exactOptionalPropertyTypes`:
  // under it an optional property may be ABSENT but not present-and-undefined, and
  // every composer of these fields produces present-and-undefined for a field the
  // source did not state. That is the right value to produce — missing, null and
  // empty are one claim here — so the type admits it rather than making callers
  // `delete` keys to satisfy it.
  readonly series?: string | null | undefined;
  readonly issue?: string | null | undefined;
  readonly variant?: string | null | undefined;
  readonly printing?: string | null | undefined;
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
 * A signature's INPUT — the fields a pack's signature function reads, as a loose
 * bag with no vertical's names in it.
 *
 * ⚠ IT DECLARES NO NAMED FIELD, AND THAT IS THE E04-B03 CHANGE. It used to name
 * comic's four (`series`, `issue`, `variant`, `printing`) beside the index
 * signature, which was harmless while one pack existed and became a comic field
 * list in a shared type the moment a second one did — a caller reading
 * `fields.series` off a CARD claim type-checks, returns `undefined`, and silently
 * treats a real claim as an empty one. `isUsableClaim` in `packRegistry.ts` is
 * where that question is now asked, per pack.
 *
 * The index signature is narrowed to the value types a normalised field can hold
 * rather than left as `unknown`, so the type still refuses a number or an object
 * where a field belongs.
 */
export interface SignatureFields {
  [field: string]: string | null | undefined;
}
