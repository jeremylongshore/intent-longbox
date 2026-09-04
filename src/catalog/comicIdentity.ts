// The COMIC IDENTITY SCHEMA — what a comic IS, as a validated value (E04-B02).
//
// 030 §5.1 makes `identitySchema` a manifest slot: "JSON Schema (draft 2020-12)
// that `collectible_definition.attributes` and `edition.attributes` are validated
// against at write time. Two schemas: a work is not a printing." This module is
// the comic pack's pair of them, expressed as Zod because that is what the repo
// validates with today (`src/contracts/v1/schemas.ts`) and because E04-B04 —
// which ships the manifest as code — has not run. When it does, these two objects
// are what `identitySchema.definition` and `identitySchema.edition` point at.
//
// THE FIELD SPLIT IS 030 §5.3's, NOT A NEW ONE:
//
//   definition  { series, publisher, volume, year }   — the WORK
//   edition     { issue, variant, printing, cover }   — the PRINTING
//
// plus two edition fields 014 §8's E04-B02 row names and §5.3's table does not
// spell out: `coverDate` and `distribution` (direct vs newsstand). Both are
// printing-level facts, both are OUTSIDE the signature, and §3.3 is the reason:
// the ratified comic signature is `series + issue + variant + printing` and
// adding a fifth field to it is an amendment to a ratified record, not a
// builder's convenience. They are attributes because a listing renders them and a
// contradiction rule (E06-B05) will read them; they are not identity.
//
// ⚠ UNKNOWN IS NOT ABSENT, AND THIS SCHEMA IS WHERE THE DIFFERENCE LIVES.
// The bead's own note is one line — "Preserve unknown vs absent" — and it is the
// sharpest requirement here, because 030 A1 already recorded what happens when
// one NULL carries two meanings (`004:43-48`: "confirmed before the catalog
// existed" and "confirmed after, but resolution failed"). The rule adopted:
//
//   * KEY ABSENT   — no statement was made. The source record had no such field;
//                    nobody asked; the importer's row stopped short.
//   * KEY = null   — a statement was made and its content is "not known" or "does
//                    not apply". A GCD row that carries an empty `variant` cell is
//                    asserting there is no variant designator; that is a fact.
//
// Both survive into `attributes` jsonb verbatim, because Zod 3 omits an absent
// optional key rather than materialising `undefined` — asserted in
// `tests/comic-identity.test.ts` rather than assumed.
//
// AND THE SIGNATURE DELIBERATELY COLLAPSES THEM (`editionSignature.ts`:
// "missing, null and empty are the same claim"). That is not a contradiction, it
// is the division of labour: a DEDUPE KEY must not distinguish two records that
// describe the same book with different degrees of silence, or the same edition
// imported from two sources would fail to dedupe. The distinction is preserved
// where a reader can act on it (the attributes) and dropped where acting on it
// would be wrong (the key).
//
// ⚠ COPY FACTS ARE REFUSED BY NAME, NOT MERELY BY STRICTNESS (047 §2.3, A6; 036;
// 037). `.strict()` already rejects an unknown key, but "unrecognized key
// 'grader'" is the wrong sentence: a grader, a cert number and a grade are not
// misspellings, they are a category error that 047 argues at length — "a
// CGC-slabbed Amazing Spider-Man #300 … is the same edition as a raw one", and a
// grader's label "is a number wearing a name" that locked decision 5 and 019 T7
// forbid anywhere near identity. So they get their own error class and their own
// message. 030 §4 rule 2's prohibition — no core table has a column named after a
// provider, "including in `attributes`, where a `gcd_id` key would smuggle the
// same coupling past the DDL" — is enforced the same way.

import { z } from "zod";
import { SIGNATURE_SEPARATOR, UnregisteredVerticalError, normalizeField } from "./editionSignature.js";

/**
 * The version of the SCHEMA below, distinct from `NORMALIZATION_VERSION` (which
 * versions the signature's normalisation rule) and from
 * `vertical_pack_version.pack_version` (which versions the whole manifest
 * single-rate, 030 A5).
 *
 * Three numbers looks like two too many until you ask what each answers. This one
 * answers "what shape was this `attributes` payload written against", which a
 * reader needs when a later schema adds a field and old rows do not have it —
 * and, under append-only rules, old rows never will. It is recorded here and
 * carried by the pack version at E04-B04 rather than added as a column now: a
 * column nothing reads is 030 A3's speculative generality, and the pack version
 * on every `edition` row already dates the payload.
 */
export const COMIC_IDENTITY_SCHEMA_VERSION = 1;

/**
 * Attribute keys that name a COPY, not an edition, in any vertical (047 A6).
 *
 * Lowercased and stripped of `_`/`-` before comparison, so `cert_number`,
 * `certNumber` and `CERT-NUMBER` are one entry. The list is deliberately about
 * IDENTITY-ADJACENT copy facts and not about every copy fact there is: a pack
 * author who invents `slabLabel` gets `.strict()`'s ordinary refusal, which is
 * correct — the named list exists to give the FORESEEABLE mistakes a sentence
 * that explains itself.
 */
export const COPY_FACT_KEYS: readonly string[] = [
  "grader",
  "certnumber",
  "cert",
  "certification",
  "slab",
  "grade",
  "gradelabel",
  "graderlabel",
  "condition",
];

/** Provider-named keys, refused by 030 §4 rule 2. */
const PROVIDER_KEY_RE = /^(gcd|metron|pricecharting|ebay|covrprice|comicvine)_?id$/;

function canonicalKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

/** Thrown when an attribute payload names a copy fact (047 §2.3, A6; 037). */
export class CopyFactInEditionError extends Error {
  constructor(readonly key: string) {
    super(
      `attribute ${JSON.stringify(key)} is a COPY fact, not an edition attribute (047 §2.3, A6). ` +
        `A slabbed book is the SAME EDITION as a raw one — it is a different copy, in a different ` +
        `condition, at a different price, and none of those three is identity. A grader's label is ` +
        `a number wearing a name, and locked decision 5 with 019 T7 (non-waivable) forbid a numeric ` +
        `grade anywhere on the identity path. It belongs on physical_item (036) and its ` +
        `condition_assessment (037).`
    );
    this.name = "CopyFactInEditionError";
  }
}

/** Thrown when an attribute payload names a provider (030 §4 rule 2). */
export class ProviderKeyInAttributesError extends Error {
  constructor(readonly key: string) {
    super(
      `attribute ${JSON.stringify(key)} names a PROVIDER (030 §4 rule 2). No core table has a ` +
        `column named after a provider — "including in attributes, where a \`gcd_id\` key would ` +
        `smuggle the same coupling past the DDL and past a grep for column names". An external ` +
        `identifier is an alias row in edition_external_id under a rights row, never an attribute.`
    );
    this.name = "ProviderKeyInAttributesError";
  }
}

/**
 * A non-empty string after trimming. `""` and `"   "` are not a series name and
 * not an issue number; they are the ABSENCE of one, and the schema says so rather
 * than letting the signature turn them into an empty field silently.
 */
const required = z
  .string()
  .refine((v) => v.trim().length > 0, { message: "must not be blank — omit the key, or state null" });

/**
 * OPTIONAL AND NULLABLE, in that order, and never `.default()`.
 *
 * `.default()` would materialise a value for an absent key and destroy the
 * absent/unknown distinction on the way into jsonb, which is the one thing this
 * module exists to preserve.
 */
const stated = z.string().nullable().optional();

/** The WORK (030 §5.3): `{ series, publisher, volume, year }`. */
export const comicDefinitionAttributes = z
  .object({
    series: required,
    publisher: stated,
    volume: stated,
    /** Text, not a number: "1963", "1963-1998" and "unknown printing year" are all statements a corpus makes. */
    year: stated,
  })
  .strict();

/** The PRINTING (030 §5.3 + 014 §8's E04-B02 row). */
export const comicEditionAttributes = z
  .object({
    issue: required,
    variant: stated,
    /** The barcode's fifth supplement digit finally has somewhere to land (030 E10, §7). */
    printing: stated,
    /** The barcode's fourth supplement digit — the cover variant code. */
    cover: stated,
    /** Text for the same reason as `year`: "1988-05" and "May 1988" are both what a source said. */
    coverDate: stated,
    /**
     * Direct market vs newsstand. NOT in the signature: 030 §3.3's ratified four
     * are series/issue/variant/printing, and widening them is an amendment to a
     * ratified record. It is here because 014 §8's row names it and because a
     * contradiction rule will read it.
     */
    distribution: z.enum(["direct", "newsstand"]).nullable().optional(),
  })
  .strict();

export type ComicDefinitionAttributes = z.infer<typeof comicDefinitionAttributes>;
export type ComicEditionAttributes = z.infer<typeof comicEditionAttributes>;

/**
 * The two schemas per registered vertical. ONE ENTRY, for the same reason
 * `SIGNATURE_FUNCTIONS` has one: E19-B06 gates any second vertical on evidence
 * (030 §5.4), and "architectural possibility is not market permission".
 */
const IDENTITY_SCHEMAS: Record<string, { definition: z.ZodTypeAny; edition: z.ZodTypeAny }> = {
  comic: { definition: comicDefinitionAttributes, edition: comicEditionAttributes },
};

/**
 * The other three per-pack functions, registered exactly like `IDENTITY_SCHEMAS`
 * above and `SIGNATURE_FUNCTIONS` in `editionSignature.ts`.
 *
 * ⚠ WHY THESE ARE MAPS AND NOT DIRECT CALLS. The first version of
 * `editionWrite.ts` called `comicDefinitionSignature` and `comicSignatureInput`
 * by name, for EVERY vertical. That is the `if comic` branch 014 §3.4 forbids,
 * wearing a different hat: `editionSignature()` would fail closed on
 * `sports-card` while the two functions beside it silently applied the COMIC
 * field list to a card — and because the composer runs BEFORE the signature
 * function, a pack whose composer produced a plausible-looking result could have
 * been comic-signed without anything refusing. A registry with one entry is not
 * ceremony here; it is the difference between "no second vertical exists yet" and
 * "a second vertical is silently treated as a comic".
 *
 * All three fail closed with the SAME error as `editionSignature` (030 §6 rule 3:
 * an unregistered vertical is refused at the boundary, never defaulted). E04-B04
 * folds all four maps into `VerticalPackManifest` and resolves them through
 * `vertical_pack_version.signature_fn_ref`; until then this is the interim, and
 * it is deliberately small.
 */
const DEFINITION_SIGNATURE_FUNCTIONS: Record<string, (attributes: Record<string, unknown>) => string> = {
  comic: (attributes) => comicDefinitionSignature(attributes),
};

const SIGNATURE_INPUT_COMPOSERS: Record<
  string,
  (
    definitionAttributes: Record<string, unknown>,
    editionAttributes: Record<string, unknown>
  ) => SignatureFields
> = {
  comic: (definitionAttributes, editionAttributes) =>
    comicSignatureInput(definitionAttributes, editionAttributes),
};

const SIGNATURE_CLAIM_MAPPERS: Record<string, (claim: unknown) => SignatureFields> = {
  comic: (claim) => comicSignatureClaim(claim),
};

/** The WORK's dedupe text for a registered vertical. Fails closed. */
export function definitionSignature(vertical: string, attributes: Record<string, unknown>): string {
  const fn = DEFINITION_SIGNATURE_FUNCTIONS[vertical];
  if (!fn) throw new UnregisteredVerticalError(vertical);
  return fn(attributes);
}

/** The signature's input, composed across the two levels. Fails closed. */
export function signatureInput(
  vertical: string,
  definitionAttributes: Record<string, unknown>,
  editionAttributes: Record<string, unknown>
): SignatureFields {
  const fn = SIGNATURE_INPUT_COMPOSERS[vertical];
  if (!fn) throw new UnregisteredVerticalError(vertical);
  return fn(definitionAttributes, editionAttributes);
}

/** A flat identity claim mapped onto a registered vertical's fields. Fails closed. */
export function signatureClaim(vertical: string, claim: unknown): SignatureFields {
  const fn = SIGNATURE_CLAIM_MAPPERS[vertical];
  if (!fn) throw new UnregisteredVerticalError(vertical);
  return fn(claim);
}

function assertNoForbiddenKeys(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (COPY_FACT_KEYS.includes(canonicalKey(key))) throw new CopyFactInEditionError(key);
    if (PROVIDER_KEY_RE.test(canonicalKey(key))) throw new ProviderKeyInAttributesError(key);
  }
}

/**
 * Validate an attribute payload for a registered vertical at one of the two
 * levels. FAILS CLOSED on an unregistered vertical (030 §6 rule 3), exactly like
 * `editionSignature` — an unregistered vertical is refused at the boundary, never
 * defaulted to `"comic"`.
 *
 * The named-key check runs BEFORE the parse so the foreseeable mistakes get the
 * sentence that explains them rather than `.strict()`'s "unrecognized key".
 */
export function parseIdentityAttributes(
  vertical: string,
  level: "definition" | "edition",
  attributes: unknown
): Record<string, unknown> {
  const pair = IDENTITY_SCHEMAS[vertical];
  if (!pair) throw new UnregisteredVerticalError(vertical);
  assertNoForbiddenKeys(attributes);
  return pair[level].parse(attributes) as Record<string, unknown>;
}

/**
 * The four fields the comic signature reads, as a loose input type.
 *
 * `| undefined` is spelled out rather than relying on `?`, because the repo runs
 * `exactOptionalPropertyTypes`: under it an optional property may be ABSENT but
 * may not be present-and-undefined, and both of the composers below produce
 * present-and-undefined for a field the source did not state. That is the right
 * value to produce — `normalizeField` treats missing, null and empty as one claim
 * (`editionSignature.ts`) — so the type says so instead of the code pretending
 * otherwise with a `delete`.
 */
export interface SignatureFields {
  /**
   * An index signature, so a composed input is assignable to the
   * `Record<string, unknown>` the pack contract's `normalizedSignature` takes
   * (030 §5.1). It is narrowed to the value types a field can hold rather than
   * left as `unknown`, so the type still refuses a number or an object where a
   * normalised field belongs.
   */
  [field: string]: string | null | undefined;
  series?: string | null | undefined;
  issue?: string | null | undefined;
  variant?: string | null | undefined;
  printing?: string | null | undefined;
}

/**
 * A flat identity CLAIM — the shape a confirmation, a candidate or a barcode
 * parse carries — mapped onto the signature's fields.
 *
 * ⚠ THIS FUNCTION EXISTS SO THAT NO FILE OUTSIDE `catalog` EVER NAMES THE FIELD
 * LIST. A workflow caller holding `human_confirmation.confirmed_issue` needs a
 * signature, and the obvious way to get one is to build
 * `{ series, issue, variant, printing }` at the call site — which puts the
 * catalog's field list in a workflow file, one refactor away from someone
 * noticing it looks like `identityKey`'s and unifying them. That is exactly the
 * drift 047 A8 exists to prevent, and the guard in
 * `scripts/architectureRules.ts` watches the two functions rather than every
 * possible third copy. So the mapping lives here, and callers pass the payload.
 *
 * `title` is accepted as a synonym for `series` because the shipped candidate
 * vocabulary spells it `title` (`src/providers/types.ts:11-17`, 030 E8) and a
 * confirmation payload is built from candidates. `series` wins when both are
 * present, because the catalog's own word is the more specific one.
 */
export function comicSignatureClaim(claim: unknown): SignatureFields {
  const c = (claim !== null && typeof claim === "object" ? claim : {}) as Record<string, unknown>;
  const series = (c.series ?? c.title) as string | null | undefined;
  return {
    series: typeof series === "string" || series === null ? series : undefined,
    issue: typeof c.issue === "string" ? c.issue : typeof c.issue === "number" ? String(c.issue) : undefined,
    variant: typeof c.variant === "string" || c.variant === null ? (c.variant as string | null) : undefined,
    printing:
      typeof c.printing === "string" || c.printing === null ? (c.printing as string | null) : undefined,
  };
}

/**
 * The WORK's dedupe text, for `collectible_definition.signature`.
 *
 * ⚠ A SEPARATE FUNCTION, NOT `comicEditionSignature` CALLED WITH THE WRONG
 * ARGUMENTS. The column is NOT NULL and something has to fill it, and the
 * tempting move — reuse the edition function with `volume` where `issue` goes —
 * would write a string whose four positions mean something other than what the
 * function's name and its `normalization_version` say they mean. The
 * NORMALISATION is reused, which is what 047 §9.3 says to reuse; the field list
 * is this level's own, which is what §9.3 says not to share.
 *
 * `series + volume`, and no publisher: a work-level key including the publisher
 * would fail to dedupe a series two corpora attribute differently, and that
 * disagreement is a human-queue item rather than a second work.
 */
export function comicDefinitionSignature(attributes: Record<string, unknown>): string {
  return [
    normalizeField(attributes.series as string | null | undefined),
    normalizeField(attributes.volume as string | null | undefined),
  ].join(SIGNATURE_SEPARATOR);
}

/**
 * The signature's INPUT, composed across the two levels.
 *
 * ⚠ THE SIGNATURE SPANS BOTH SCHEMAS, AND THAT IS WHY THIS FUNCTION EXISTS.
 * 030 §3.3's comic signature is `series + issue + variant + printing`, and
 * §5.3 puts `series` on the DEFINITION while `issue`, `variant` and `printing`
 * are the EDITION's. So an edition's signature is not computable from the
 * edition's own attributes — it needs its parent's series, which is the second
 * reason `insertEdition` reads the definition (the first is invariant I7).
 *
 * A reader may ask why `series` was not simply copied onto the edition. Because
 * then a definition whose series name is corrected would leave every edition
 * carrying the old one, with no way to tell a stale copy from a deliberate
 * alias — and under append-only rules the edition rows cannot be repaired in
 * place. The join costs one read at write time; the copy costs a permanent
 * ambiguity.
 */
export function comicSignatureInput(
  definitionAttributes: Record<string, unknown>,
  editionAttributes: Record<string, unknown>
): SignatureFields {
  return {
    series: definitionAttributes.series as string | null | undefined,
    issue: editionAttributes.issue as string | null | undefined,
    variant: editionAttributes.variant as string | null | undefined,
    printing: editionAttributes.printing as string | null | undefined,
  };
}
