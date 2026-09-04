// `catalog` — THE MODULE'S ONLY PUBLIC SURFACE (029 §2, §3.3, §5 move 8).
//
// "A module's only public surface is its index.ts. Reaching into another module's
// internals defeats the boundary without tripping the layer rule." The
// `catalog-public-surface-only` rule in `.dependency-cruiser.cjs` enforces it as
// an ERROR: a route, a service or a consumer that imports
// `src/catalog/mint.js` fails the Architecture gate. It is a NAMED RULE, not an
// exemption — 044 §6's whole point is that a boundary that warns is a boundary
// that erodes.
//
// AND `catalog` IMPORTS ONLY PLATFORM (029 §3.1's ALLOWED table:
// `catalog: ["platform"]`). It never reaches workflow, resolution, condition,
// valuation, commerce, reporting, the routes or the provider seam. 029 §2.3's
// requirement is that catalog "must survive a partner leaving" and stay readable
// by a batch importer with no pipeline present — which is only true if it depends
// on nothing but the database handle. The `catalog-is-a-leaf` rule enforces it.
//
// WHAT LIVES HERE, AND WHAT DELIBERATELY DOES NOT.
//   HERE  — the LCID grammar and its one parser; the mint; the three lifecycle
//           facts; the crosswalk writes; `resolve`/`resolveCurrent`; the survivor
//           projection's rebuild; and the comic SIGNATURE FUNCTION, seeded from
//           030 §3.3's ratified `series + issue + variant + printing` verbatim.
//
//   ⚠ THE SIGNATURE IS SEEDED HERE AND OWNED BY E04-B02, which is a division
//   worth stating because the export below makes it look settled. 047 §9.3 gives
//   this bead the field-list RULING and the normalisation to reuse; what it does
//   not give is the comic identity SCHEMA that `attributes` validates against, or
//   A8's static guard that `identityKey` and `edition_signature` share no
//   field-list constant and that a PR touching both without a 000-docs/006 row
//   FAILS. Both are E04-B02's, and it extends `editionSignature.ts` rather than
//   replacing it. What is shipped here is the property that guard protects: two
//   functions, two modules, no shared constant, asserted by
//   tests/edition-signature.test.ts.
//
//   NOT HERE, by 047 §12.3's assignment —
//     * the comic identity schema, and A8's static guard over the signature  E04-B02
//     * the card identity schema                                 E04-B03 (gated by E19-B06)
//     * the pack manifest as shipped code                        E04-B04
//     * the rights registry and any licence analysis             E04-B05 (+ counsel)
//     * the crosswalk review queue and its own tenancy detector   E04-B06
//     * the corpus ingest, its delta cursor and its dedupe        E04-B11
//     * the exact-lookup path and its version-aware cache         E06-B02

export {
  InvalidLcidError,
  LCID_PREFIX,
  PAYLOAD_LENGTH,
  VERTICAL_CODE_RE,
  checkSymbol,
  mintLcidString,
  parseLcid,
  tryParseLcid,
  type LcidKind,
  type LcidParts,
} from "./lcid.js";

export {
  NORMALIZATION_VERSION,
  UnregisteredVerticalError,
  comicEditionSignature,
  editionSignature,
  normalizeField,
  normalizeIssue,
  type ComicEditionFields,
} from "./editionSignature.js";

export { MINT_ATTEMPTS, mint, type MintRequest } from "./mint.js";

export {
  CATALOG_AUTHORING_ROLES,
  NotACatalogAuthorError,
  addAlias,
  certifyAlias,
  merge,
  retire,
  split,
  type AliasRequest,
  type CatalogAuthoringRole,
  type LifecycleFact,
} from "./lifecycle.js";

export { READ_CHAIN_BOUND, resolve, resolveCurrent, type ResolveOutcome } from "./resolve.js";

export { rebuildSurvivorProjection, type RebuildResult } from "./projection.js";
