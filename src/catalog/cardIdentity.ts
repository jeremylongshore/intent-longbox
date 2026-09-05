// THE CARD IDENTITY SCHEMA — what a trading card IS, as a validated value
// (E04-B03).
//
// ⚠ THIS BEAD IS A PROOF, NOT A LAUNCH. E19-B06 gates any second vertical on
// reuse, rights, accuracy, economics and demand evidence, and 030 §5.4 says it in
// terms: "architectural possibility is not market permission". Nothing here
// registers a pack ROW, imports a card corpus, or authorises a card shop. What it
// does is answer 014 §3.4's question — "plug-and-play requires a vertical pack,
// not scattered `if comic` statements" — with a second pack that the core absorbs
// **without one new column, one new table, or one `if (vertical === 'comic')`**.
// The claim is falsifiable, and `checkNoVerticalBranching` in
// `scripts/architectureRules.ts` is what falsifies it.
//
// TWO VERTICALS, ONE MODULE, AND THE ARGUMENT FOR BOTH HALVES (049 §4).
//
//   `sports-card`  discriminator `sport`, subject `player`
//   `tcg-card`     discriminator `game`,  subject `cardName`
//
// One MODULE because the two share every normalisation rule and every signature
// position; two VERTICALS because 030 A5 makes a pack version SINGLE-RATE — one
// number governs the schema, the signature function, the capture recipe, the
// condition schema, the crosswalk and the prohibited claims together. A TCG
// condition vocabulary that has to move ("played", "lightly played") would drag
// the sports pack's version with it, and a `tcgplayer` crosswalk namespace would
// appear in a sports pack that has no use for it. The alternative — one `card`
// pack with a `sport`-or-`game` either/or inside its schema — is recorded and
// rejected in 049 §4: it is a union type smuggled into a place the system reads
// as a value, and its schema would have to say "exactly one of these two keys",
// which is a discriminator pretending not to be one.
//
// ⚠ THE SIGNATURE CARRIES `parallel`, AND THAT IS AN AMENDMENT TO A SKETCH
// (030 v1.3.0, by a row; 049 §5.2). 030 §5.4 sketched `set|number|variant|
// language` while listing `parallel` as an edition attribute — so a Silver Prizm
// #12 and a base #12 would have produced the SAME signature and deduped as
// candidates for each other. A parallel is a different PRINTING of the same card,
// which is precisely what an edition is; leaving it out of the key would have
// made the card pack's dedupe wrong in the most common case it will ever see.
// 030's own v1.2.0 row set the precedent for amending the sketch while it is
// still a sketch.
//
// ⚠ AND IT REFUSES `grader`, `cert_number` AND `serialNumber` BY NAME. The first
// two are 047 A6's ruling — copy facts in EVERY vertical, never edition fields,
// never in `edition_signature`, and a pack manifest declaring either fails pack
// certification. The third is the same category error wearing card clothes: the
// RUN a parallel was printed to (`/99`) is an edition fact every copy shares, and
// the NUMBER stamped on one card (`07/99`) is a copy fact 036's `physical_item`
// holds. `printRun` is therefore an attribute here and `serialNumber` is refused
// by `copyFacts.ts`, which owns that rule for all packs.

import { z } from "zod";
import { assertNoForbiddenKeys } from "./copyFacts.js";
import {
  SIGNATURE_SEPARATOR,
  UnregisteredVerticalError,
  normalizeField,
  normalizeIssue,
  type SignatureFields,
} from "./editionSignature.js";

/**
 * The version of the SCHEMA below, distinct from `NORMALIZATION_VERSION` (which
 * versions the signature's normalisation rule) and from
 * `vertical_pack_version.pack_version` (which versions the whole manifest
 * single-rate, 030 A5).
 *
 * ONE NUMBER FOR BOTH CARD VERTICALS, because they are one schema shape with two
 * field names substituted. If they ever diverge in shape, this constant splits
 * before the shape does — a shared version over two shapes is the defect
 * `NORMALIZATION_VERSION` exists to avoid one layer down.
 */
export const CARD_IDENTITY_SCHEMA_VERSION = 1;

/** The two registered card verticals (030 §5.4 as amended; 049 §4). */
export const SPORTS_CARD_VERTICAL = "sports-card";
export const TCG_CARD_VERTICAL = "tcg-card";

/**
 * A non-empty string after trimming, exactly as the comic pack defines it. The
 * rule is copied rather than imported: 047 §9.3 says the NORMALISATION should be
 * reused and the FIELD LIST must not, and a shared `required` helper is one
 * refactor away from becoming a shared field list.
 */
const required = z
  .string()
  .refine((v) => v.trim().length > 0, { message: "must not be blank — omit the key, or state null" });

/**
 * OPTIONAL AND NULLABLE, in that order, and never `.default()`.
 *
 * KEY ABSENT means no statement was made; KEY = null means a statement was made
 * and its content is "not known" or "does not apply". A corpus row with an empty
 * `parallel` cell is asserting the card is a base card; that is a fact, and
 * `.default()` would erase the difference between it and a row that never had the
 * column.
 */
const stated = z.string().nullable().optional();

/**
 * The WORK, parameterised on the two names that differ between the verticals.
 *
 * `subject` is REQUIRED — and that is a decision, not an oversight. It sits in the
 * definition signature (`set + subject`), so a definition without one would
 * signature-collide with every other card in the same set, turning one release
 * into several hundred mutual dedupe candidates. A corpus row that cannot name
 * whose card it is has not described a work.
 */
function cardDefinitionSchema(discriminator: "sport" | "game", subject: "player" | "cardName") {
  return z
    .object({
      [discriminator]: required,
      [subject]: required,
      set: required,
      /** Text, not a number: "1986", "1986-87" and "unknown" are all statements a corpus makes. */
      year: stated,
      manufacturer: stated,
    })
    .strict();
}

/**
 * The PRINTING. Identical for both card verticals — a parallel, a language and a
 * print run mean the same thing whether the subject swings a bat or casts a
 * spell.
 */
const cardEditionSchema = z
  .object({
    /** "12", "#12a", "RC-12", "SP-3" — normalised by `normalizeCardNumber`, never parsed. */
    number: required,
    /** A photo variation, an error card, a short print: an axis distinct from the parallel. */
    variant: stated,
    /** "Silver Prizm", "Refractor", "Holo". IN the signature, per 030 v1.3.0. */
    parallel: stated,
    /** "en", "ja", "pt-br". No default — see `normalizeLanguage`. */
    language: stated,
    /**
     * The RUN a parallel was printed to ("99", "/25"). An EDITION fact: every copy
     * of the parallel shares it. The copy's own place in that run ("07/99") is a
     * COPY fact and `copyFacts.ts` refuses it by name.
     *
     * OUTSIDE the signature, for 030 §3.3's reason restated: the ratified card
     * signature is `set + number + variant + parallel + language`, and a run is
     * almost always implied by the parallel name that is already in the key.
     */
    printRun: stated,
  })
  .strict();

export const sportsCardDefinitionAttributes = cardDefinitionSchema("sport", "player");
export const tcgCardDefinitionAttributes = cardDefinitionSchema("game", "cardName");
export const cardEditionAttributes = cardEditionSchema;

export type CardEditionAttributes = z.infer<typeof cardEditionSchema>;

/** Which key holds the WORK's subject in each card vertical. */
const SUBJECT_KEY: Record<string, "player" | "cardName"> = {
  [SPORTS_CARD_VERTICAL]: "player",
  [TCG_CARD_VERTICAL]: "cardName",
};

/** The definition schema per card vertical — the pack's own two-entry registry. */
const CARD_DEFINITION_SCHEMAS: Record<string, z.ZodTypeAny> = {
  [SPORTS_CARD_VERTICAL]: sportsCardDefinitionAttributes,
  [TCG_CARD_VERTICAL]: tcgCardDefinitionAttributes,
};

/**
 * A card number, normalised.
 *
 * Built on `normalizeIssue` — a leading `#` is decoration on a card number for
 * exactly the reason it is on an issue number — and then one card-specific rule:
 * whitespace around a hyphen is dropped, so `RC - 12`, `RC- 12` and `RC-12` are
 * one number.
 *
 * ⚠ THE HYPHEN ITSELF IS KEPT. Stripping it would fold `RC-12` into `RC12`, and
 * nothing in the domain says those are the same card — a set that numbers both
 * `12` and `RC-12` is ordinary. A normalisation that MIGHT merge two real cards
 * is worse than one that leaves two spellings of one card as a dedupe candidate,
 * because a candidate is a human-queue item (030 §3.3) and a bad merge is a
 * silent wrong answer.
 */
export function normalizeCardNumber(value: string | null | undefined): string {
  return normalizeIssue(value).replace(/\s*-\s*/g, "-");
}

/**
 * A language tag, normalised: trimmed, casefolded, `_` folded to `-`.
 *
 * ⚠ AND NO DEFAULT, EVER. Defaulting an absent language to `"en"` would give a
 * Japanese printing and an English one the same signature the moment one corpus
 * omitted the field — merging two editions that trade at different prices, in the
 * one direction the catalog cannot recover from (047 A1: a duplicate is a
 * candidate; a wrong merge is a decided fact). Absent stays absent.
 *
 * ⚠ AND NO SYNONYM TABLE. `"English"` and `"en"` normalise to two different
 * strings, and that is deliberate: mapping names onto tags is an INGEST decision
 * about a corpus (E04-B11), not an identity rule. Two spellings produce a dedupe
 * CANDIDATE, which is a human-queue item and the correct outcome for a
 * disagreement the catalog cannot adjudicate.
 */
export function normalizeLanguage(value: string | null | undefined): string {
  return normalizeField(value).replace(/_/g, "-");
}

/**
 * The card signature's five fields, as a loose input type.
 *
 * `| undefined` is spelled out because the repo runs `exactOptionalPropertyTypes`:
 * an optional property may be ABSENT but not present-and-undefined, and the
 * composers below produce present-and-undefined for a field the source did not
 * state. Missing, null and empty are one claim here, so the type admits it.
 */
export interface CardEditionFields {
  readonly set?: string | null | undefined;
  readonly number?: string | null | undefined;
  readonly variant?: string | null | undefined;
  readonly parallel?: string | null | undefined;
  readonly language?: string | null | undefined;
}

/**
 * The card pack's signature function: `set + number + variant + parallel +
 * language` (030 §5.4 at v1.3.0).
 *
 * Pure, deterministic and stable across corpus versions, exactly as the comic
 * function is — the same fields yield the same string forever, which is what
 * makes the Q2/Q3 equality lookup on `edition_signature (vertical, signature)` a
 * real index plan.
 *
 * ⚠ The field list below is this module's own literal. It is NOT imported from
 * anywhere, it is not shared with the comic pack, and it must not be exported for
 * reuse by a workflow-side function (047 A8).
 */
export function cardEditionSignature(fields: CardEditionFields): string {
  return [
    normalizeField(fields.set),
    normalizeCardNumber(fields.number),
    normalizeField(fields.variant),
    normalizeField(fields.parallel),
    normalizeLanguage(fields.language),
  ].join(SIGNATURE_SEPARATOR);
}

/**
 * The WORK's dedupe text, for `collectible_definition.signature`: `set + subject`.
 *
 * The discriminator, the year and the manufacturer are DELIBERATELY EXCLUDED, on
 * the comic pack's precedent and for its reason: `comicDefinitionSignature` drops
 * publisher and year because "a work-level key including the publisher would fail
 * to dedupe a series two corpora attribute differently, and that disagreement is a
 * human-queue item rather than a second work". A set name is already
 * sport-specific and year-bearing in practice ("1986 Topps"), so including either
 * would split one work on a corpus's formatting habit.
 */
export function cardDefinitionSignature(vertical: string, attributes: Record<string, unknown>): string {
  const subjectKey = SUBJECT_KEY[vertical];
  return [
    normalizeField(attributes["set"] as string | null | undefined),
    normalizeField(subjectKey === undefined ? undefined : (attributes[subjectKey] as string | null)),
  ].join(SIGNATURE_SEPARATOR);
}

/**
 * The signature's INPUT, composed across the two levels — `set` from the
 * DEFINITION, the rest from the EDITION.
 *
 * The asymmetry is the comic pack's, for the comic pack's reason: copying `set`
 * onto every edition row would leave a corrected set name stranded on rows that
 * append-only rules forbid repairing, with no way to tell a stale copy from a
 * deliberate alias. The join costs one read at write time; the copy costs a
 * permanent ambiguity.
 */
export function cardSignatureInput(
  definitionAttributes: Record<string, unknown>,
  editionAttributes: Record<string, unknown>
): SignatureFields {
  return {
    set: definitionAttributes["set"] as string | null | undefined,
    number: editionAttributes["number"] as string | null | undefined,
    variant: editionAttributes["variant"] as string | null | undefined,
    parallel: editionAttributes["parallel"] as string | null | undefined,
    language: editionAttributes["language"] as string | null | undefined,
  };
}

/**
 * A flat identity CLAIM — what a confirmation, a candidate or a slab-label parse
 * carries — mapped onto the signature's fields.
 *
 * ⚠ THIS EXISTS SO THAT NO FILE OUTSIDE `catalog` EVER NAMES THE CARD FIELD LIST,
 * which is the same reason `comicSignatureClaim` exists and the same drift 047 A8
 * guards. A caller passes its payload; the pack decides what the payload's fields
 * mean.
 *
 * `cardNumber` and `setName` are accepted as synonyms because that is how a
 * provider vocabulary is likely to spell them; the pack's own words win when both
 * are present, for the same reason `series` beats `title` on the comic side.
 */
export function cardSignatureClaim(claim: unknown): SignatureFields {
  const c = (claim !== null && typeof claim === "object" ? claim : {}) as Record<string, unknown>;
  const text = (value: unknown): string | null | undefined => {
    if (typeof value === "string" || value === null) return value as string | null;
    if (typeof value === "number") return String(value);
    return undefined;
  };
  return {
    set: text(c["set"] ?? c["setName"]),
    number: text(c["number"] ?? c["cardNumber"]),
    variant: text(c["variant"]),
    parallel: text(c["parallel"]),
    language: text(c["language"] ?? c["lang"]),
  };
}

/**
 * Is there enough of a claim to look an edition up with (see
 * `isUsableClaim` in `packRegistry.ts`)?
 *
 * A set or a number. Neither means the payload named no card at all, and a
 * signature over five empty fields would match every thin row in the corpus —
 * which is a false match, not a lookup.
 */
export function cardClaimIsUsable(fields: SignatureFields): boolean {
  return Boolean(fields["set"] ?? fields["number"]);
}

/**
 * Validate a card attribute payload at one of the two levels.
 *
 * The named-key check runs BEFORE the parse so the foreseeable mistakes
 * (`grader`, `cert_number`, `serialNumber`, `psa_id`) get the sentence that
 * explains them rather than `.strict()`'s "unrecognized key".
 */
export function parseCardAttributes(
  vertical: string,
  level: "definition" | "edition",
  attributes: unknown
): Record<string, unknown> {
  assertNoForbiddenKeys(attributes);
  if (level === "edition") return cardEditionSchema.parse(attributes) as Record<string, unknown>;
  // A MAP AND NOT A TERNARY, even inside the pack that owns both verticals. A
  // `vertical === TCG_CARD_VERTICAL` here would be the smallest possible version
  // of the branch 014 §3.4 forbids, and the rule reads better when the file that
  // is allowed to break it does not.
  const definition = CARD_DEFINITION_SCHEMAS[vertical];
  if (definition === undefined) throw new UnregisteredVerticalError(vertical);
  return definition.parse(attributes) as Record<string, unknown>;
}
