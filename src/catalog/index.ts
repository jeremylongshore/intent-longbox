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
//   HERE SINCE E04-B02 — the comic IDENTITY SCHEMA the signature reads from
//           (`comicIdentity.ts`: two Zod schemas, 030 §5.3's field split, unknown
//           preserved as distinct from absent, copy facts and provider keys
//           refused by name); the WRITE PATH that computes the signature in a
//           service rather than a trigger and asserts 030 I7 at the data level
//           (`editionWrite.ts`); and the Q2/Q3 lookup with its dedupe CANDIDATE —
//           never an automatic merge (`dedupe.ts`).
//
//   ⚠ THE SIGNATURE WAS SEEDED AT E04-D01 AND COMPLETED AT E04-B02, and the two
//   halves are worth keeping distinguishable. E04-D01 shipped the function and
//   the property A8 protects — two functions, two modules, no shared constant,
//   asserted by tests/edition-signature.test.ts. E04-B02 added the identity
//   SCHEMA `attributes` validates against, the write path, the dedupe candidate,
//   and A8's static guard itself: `checkIdentityFunctionSeparation` and
//   `checkIdentityPairEdit` in `scripts/architectureRules.ts` (rule 7), plus the
//   `identity-key-and-edition-signature-stay-apart` dependency-cruiser rule.
//   `editionSignature.ts` was extended, never replaced.
//
//   NOT HERE, by 047 §12.3's assignment —
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
  SIGNATURE_SEPARATOR,
  UnregisteredVerticalError,
  comicEditionSignature,
  editionSignature,
  normalizeField,
  normalizeIssue,
  type ComicEditionFields,
} from "./editionSignature.js";

export {
  COMIC_IDENTITY_SCHEMA_VERSION,
  COPY_FACT_KEYS,
  CopyFactInEditionError,
  ProviderKeyInAttributesError,
  comicDefinitionAttributes,
  comicDefinitionSignature,
  comicEditionAttributes,
  comicSignatureClaim,
  comicSignatureInput,
  definitionSignature,
  parseIdentityAttributes,
  signatureClaim,
  signatureInput,
  type ComicDefinitionAttributes,
  type ComicEditionAttributes,
  type SignatureFields,
} from "./comicIdentity.js";

export {
  UnattachedDefinitionError,
  VerticalMismatchError,
  insertDefinition,
  insertEdition,
  type DefinitionWrite,
  type EditionWrite,
  type EditionWritten,
} from "./editionWrite.js";

export {
  findAllDedupeCandidates,
  findDedupeCandidate,
  findEditionsBySignature,
  lookupByExternalId,
  lookupBySignature,
  type AliasLookup,
  type DedupeCandidate,
  type ExternalIdQuery,
  type SignatureLookup,
  type SignatureQuery,
} from "./dedupe.js";

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

export {
  READ_CHAIN_BOUND,
  newestCorpusVersionId,
  resolve,
  resolveCurrent,
  type ResolveOutcome,
} from "./resolve.js";

export { rebuildSurvivorProjection, type RebuildResult } from "./projection.js";
