// THE VERTICAL-PACK REGISTRY — the one place that names every pack, and the one
// place a caller resolves a vertical through (E04-B03).
//
// ⚠ WHY THERE IS A FILE HERE AT ALL, GIVEN THAT E04-B02 HAD SIX MAPS AND NO
// REGISTRY MODULE. The maps lived inside `comicIdentity.ts` and
// `editionSignature.ts` — inside a PACK — and that was survivable while the pack
// they lived in was the only one. Registering a second pack in them produces a
// cycle in both directions at once: `editionSignature.ts` would import
// `cardIdentity.ts` for its signature function while `cardIdentity.ts` imports
// `editionSignature.ts` for the normalisation, and `comicIdentity.ts` would
// import `cardIdentity.ts` for the other four. `no-circular` in
// `.dependency-cruiser.cjs` is an ERROR, and it is right to be: 029 §3.1's module
// graph is a DAG, and "a cycle means a boundary was drawn wrong".
//
// The boundary that was drawn wrong is small and worth naming exactly: **a
// registry of packs is not a member of any pack.** Moving the maps up one level
// makes the dependency arrows all point the same way —
//
//     packRegistry ──▶ comicIdentity ──┐
//                 ├──▶ cardIdentity  ──┼──▶ editionSignature (normalisation only)
//                 └──▶ editionSignature┘
//
// — and it means adding a third vertical is an edit to THIS file plus a new pack
// module, with no edit to any existing pack. That property is the acceptance line
// of E04-B03 ("card examples resolve through the same core contract as comics
// without core-code branching") expressed as an import graph.
//
// ⚠ THIS IS STILL THE INTERIM, AND E04-B04 IS STILL THE END STATE. 030 §5.2 makes
// the signature function DATA — `vertical_pack_version.signature_fn_ref` names a
// module path that the registry resolves at boot, FAILING CLOSED if it is
// missing. Six maps keyed on a string literal are the shape that contract will
// take when a manifest resolves them; until E04-B04 ships the manifest as code,
// this file is deliberately small, and every entry is a literal a reader can see.
//
// ⚠ AND REGISTRATION IS NOT AUTHORISATION. Two card verticals appear below and
// **no card pack row exists, no card corpus is imported, and no card shop is
// authorised.** E19-B06 gates any second vertical on reuse, rights, accuracy,
// economics and demand evidence, and 030 §5.4 says why the distinction matters:
// "architectural possibility is not market permission". A `vertical_pack` row is
// what turns a registered function into a usable vertical, and writing one is
// E04-B04's and E19-B06's, not this file's.

import type { z } from "zod";
import {
  SPORTS_CARD_VERTICAL,
  TCG_CARD_VERTICAL,
  cardClaimIsUsable,
  cardDefinitionSignature,
  cardEditionAttributes,
  cardEditionSignature,
  cardSignatureClaim,
  cardSignatureInput,
  parseCardAttributes,
  sportsCardDefinitionAttributes,
  tcgCardDefinitionAttributes,
  type CardEditionFields,
} from "./cardIdentity.js";
import {
  comicClaimIsUsable,
  comicDefinitionAttributes,
  comicDefinitionSignature,
  comicEditionAttributes,
  comicSignatureClaim,
  comicSignatureInput,
  parseComicAttributes,
} from "./comicIdentity.js";
import {
  UnregisteredVerticalError,
  comicEditionSignature,
  type ComicEditionFields,
  type SignatureFields,
} from "./editionSignature.js";

/** The comic vertical's discriminator value (030 §5.3). */
export const COMIC_VERTICAL = "comic";

/**
 * One pack's six functions.
 *
 * ⚠ SIX AND NOT ONE, because every one of them is a place a vertical's field list
 * is applied, and a pack that supplied five of the six would have the comic list
 * applied at the sixth. E04-B02's invariant review found exactly that shape:
 * `editionSignature()` failed closed on an unregistered vertical while the
 * composer beside it silently applied the comic fields, and because the composer
 * runs FIRST, a plausible-looking composed input could have been comic-signed
 * with nothing refusing. The interface is what makes "five of six" impossible to
 * write.
 */
export interface VerticalPack {
  /** Zod schemas the two `attributes` payloads validate against (030 §5.1). */
  readonly schemas: {
    readonly definition: z.ZodTypeAny;
    readonly edition: z.ZodTypeAny;
  };
  /** Validate + refuse copy facts and provider keys, at one level. */
  readonly parseAttributes: (level: "definition" | "edition", attributes: unknown) => Record<string, unknown>;
  /** The WORK's dedupe text, from the work's own field list. */
  readonly definitionSignature: (attributes: Record<string, unknown>) => string;
  /** The signature's input, composed across the definition and the edition. */
  readonly signatureInput: (
    definitionAttributes: Record<string, unknown>,
    editionAttributes: Record<string, unknown>
  ) => SignatureFields;
  /** A flat identity claim mapped onto this pack's signature fields. */
  readonly signatureClaim: (claim: unknown) => SignatureFields;
  /** The pack's signature function. */
  readonly editionSignature: (fields: SignatureFields) => string;
  /**
   * Is there enough of a claim to look an edition up with?
   *
   * ⚠ THIS SLOT EXISTS BECAUSE A CORE SERVICE WAS ASKING THE COMIC QUESTION.
   * `src/services/identityResolution.ts` tested `!fields.series && !fields.issue`
   * before computing a signature — correct for comics and catastrophic for
   * anything else, because a card claim has neither key, so every card lookup
   * would have been skipped as an "unusable claim" while type-checking cleanly.
   * That is precisely the `if comic` 014 §3.4 forbids, wearing field names
   * instead of a vertical literal, which is why the fix is a sixth pack function
   * rather than a second condition.
   */
  readonly claimIsUsable: (fields: SignatureFields) => boolean;
}

/**
 * Every registered pack, keyed by `vertical_pack.vertical`.
 *
 * THREE ENTRIES, TWO PACKS, AND NOT ONE OF THEM AUTHORISED TO TRADE. The two card
 * verticals share one module (`cardIdentity.ts`) and are two REGISTRATIONS
 * because 030 A5 makes a pack version single-rate: schema, signature, capture
 * recipe, condition schema, crosswalk and prohibited claims move together, and a
 * TCG condition vocabulary must be able to move without bumping a sports pack
 * that has no use for it. The rejected alternative — one `card` pack with a
 * `sport`-or-`game` either/or — is recorded in 049 §4.
 */
const PACKS: Record<string, VerticalPack> = {
  [COMIC_VERTICAL]: {
    schemas: { definition: comicDefinitionAttributes, edition: comicEditionAttributes },
    parseAttributes: (level, attributes) => parseComicAttributes(level, attributes),
    definitionSignature: (attributes) => comicDefinitionSignature(attributes),
    signatureInput: (definitionAttributes, editionAttributes) =>
      comicSignatureInput(definitionAttributes, editionAttributes),
    signatureClaim: (claim) => comicSignatureClaim(claim),
    editionSignature: (fields) => comicEditionSignature(fields as ComicEditionFields),
    claimIsUsable: (fields) => comicClaimIsUsable(fields),
  },
  [SPORTS_CARD_VERTICAL]: {
    schemas: { definition: sportsCardDefinitionAttributes, edition: cardEditionAttributes },
    parseAttributes: (level, attributes) => parseCardAttributes(SPORTS_CARD_VERTICAL, level, attributes),
    definitionSignature: (attributes) => cardDefinitionSignature(SPORTS_CARD_VERTICAL, attributes),
    signatureInput: (definitionAttributes, editionAttributes) =>
      cardSignatureInput(definitionAttributes, editionAttributes),
    signatureClaim: (claim) => cardSignatureClaim(claim),
    editionSignature: (fields) => cardEditionSignature(fields as CardEditionFields),
    claimIsUsable: (fields) => cardClaimIsUsable(fields),
  },
  [TCG_CARD_VERTICAL]: {
    schemas: { definition: tcgCardDefinitionAttributes, edition: cardEditionAttributes },
    parseAttributes: (level, attributes) => parseCardAttributes(TCG_CARD_VERTICAL, level, attributes),
    definitionSignature: (attributes) => cardDefinitionSignature(TCG_CARD_VERTICAL, attributes),
    signatureInput: (definitionAttributes, editionAttributes) =>
      cardSignatureInput(definitionAttributes, editionAttributes),
    signatureClaim: (claim) => cardSignatureClaim(claim),
    editionSignature: (fields) => cardEditionSignature(fields as CardEditionFields),
    claimIsUsable: (fields) => cardClaimIsUsable(fields),
  },
};

/** The verticals this build can resolve, for tests and for a reader. */
export const REGISTERED_VERTICALS: readonly string[] = Object.keys(PACKS);

/**
 * Resolve a vertical to its pack. FAILS CLOSED (030 §6 rule 3): an unregistered
 * vertical is refused at the boundary, never defaulted to `"comic"`.
 */
export function packFor(vertical: string): VerticalPack {
  const pack = PACKS[vertical];
  if (pack === undefined) throw new UnregisteredVerticalError(vertical);
  return pack;
}

/** Validate an attribute payload for a registered vertical at one level. */
export function parseIdentityAttributes(
  vertical: string,
  level: "definition" | "edition",
  attributes: unknown
): Record<string, unknown> {
  return packFor(vertical).parseAttributes(level, attributes);
}

/** The WORK's dedupe text for a registered vertical. */
export function definitionSignature(vertical: string, attributes: Record<string, unknown>): string {
  return packFor(vertical).definitionSignature(attributes);
}

/** The signature's input, composed across the two levels. */
export function signatureInput(
  vertical: string,
  definitionAttributes: Record<string, unknown>,
  editionAttributes: Record<string, unknown>
): SignatureFields {
  return packFor(vertical).signatureInput(definitionAttributes, editionAttributes);
}

/** A flat identity claim mapped onto a registered vertical's fields. */
export function signatureClaim(vertical: string, claim: unknown): SignatureFields {
  return packFor(vertical).signatureClaim(claim);
}

/**
 * Compute a signature for any registered vertical.
 *
 * The exported name is unchanged from E04-B02 — every caller still writes
 * `editionSignature(vertical, fields)` and still reaches it through
 * `src/catalog/index.ts` — so the move is a change of home, not of contract.
 */
export function editionSignature(vertical: string, fields: Record<string, unknown>): string {
  return packFor(vertical).editionSignature(fields as SignatureFields);
}

/**
 * Does this claim carry enough for a signature lookup, by the PACK's rule?
 *
 * A caller that asks this question itself is asking a comic question about every
 * vertical — see `VerticalPack.claimIsUsable`.
 */
export function isUsableClaim(vertical: string, fields: SignatureFields): boolean {
  return packFor(vertical).claimIsUsable(fields);
}
