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
//   HERE SINCE E04-B03 — the CARD identity schema (`cardIdentity.ts`: two
//           registered verticals, `sports-card` and `tcg-card`, sharing one
//           module; `set + number + variant + parallel + language`; a card-number
//           and a language normalisation; `printRun` an edition fact and
//           `serialNumber` a copy fact), the PACK REGISTRY that resolves a
//           vertical to its six functions and fails closed on an unregistered one
//           (`packRegistry.ts`), and the universal copy-fact / provider-key
//           denylist that no pack owns (`copyFacts.ts`, 047 A6).
//
//   ⚠ REGISTERED IS NOT AUTHORISED. Two card verticals resolve through this
//   surface and NO card pack row, card corpus or card shop exists. E19-B06 gates
//   a second vertical on evidence; 030 §5.4: "architectural possibility is not
//   market permission". E04-B03 is a proof that the core is not comic-shaped.
//
//   HERE SINCE E04-B04 — the PACK MANIFEST as shipped code and its CERTIFICATION
//           (`packManifest.ts`: the Zod manifest schema, and `certify()`, which
//           refuses a copy fact as an identity field (030 §5.4 / 049 C10), an
//           unregistered vertical, a signature position the signature function
//           does not have, a field the pack's schema does not validate, a numeric
//           or blocklisted grade band, and a cert namespace in the crosswalk);
//           the three shipped manifests beside their packs (`comicManifest.ts`,
//           `cardManifests.ts`) and the set they form (`manifestRegistry.ts`).
//           The AUTHORITATIVE vertical codes — `cmc`, `spc`, `tcg` — are assigned
//           in those manifests, discharging 049 §8.
//
//   NOT HERE, by 047 §12.3's assignment —
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
  normalizeField,
  normalizeIssue,
  type ComicEditionFields,
  type SignatureFields,
} from "./editionSignature.js";

export {
  COPY_FACT_KEYS,
  CopyFactInEditionError,
  GRADER_NAMESPACES,
  ProviderKeyInAttributesError,
  graderNamespaceOf,
} from "./copyFacts.js";

export {
  COMIC_IDENTITY_SCHEMA_VERSION,
  comicClaimIsUsable,
  comicDefinitionAttributes,
  comicDefinitionSignature,
  comicEditionAttributes,
  comicSignatureClaim,
  comicSignatureInput,
  parseComicAttributes,
  type ComicDefinitionAttributes,
  type ComicEditionAttributes,
} from "./comicIdentity.js";

export {
  CARD_IDENTITY_SCHEMA_VERSION,
  SPORTS_CARD_VERTICAL,
  TCG_CARD_VERTICAL,
  cardClaimIsUsable,
  cardDefinitionSignature,
  cardEditionAttributes,
  cardEditionSignature,
  cardSignatureClaim,
  cardSignatureInput,
  normalizeCardNumber,
  normalizeLanguage,
  parseCardAttributes,
  sportsCardDefinitionAttributes,
  tcgCardDefinitionAttributes,
  type CardEditionAttributes,
  type CardEditionFields,
} from "./cardIdentity.js";

export {
  COMIC_VERTICAL,
  REGISTERED_VERTICALS,
  definitionSignature,
  editionSignature,
  isUsableClaim,
  packFor,
  parseIdentityAttributes,
  signatureClaim,
  signatureInput,
  type VerticalPack,
} from "./packRegistry.js";

export {
  CAPTURE_SHOT_KINDS,
  MANIFEST_SCHEMA_VERSION,
  PackCertificationError,
  UNIVERSAL_PROHIBITED_CLAIMS,
  assertCertified,
  assertVersionMoved,
  canonicalManifest,
  certify,
  // Exported for E04-D05's test: it is the ONE certification function that
  // consults no pack schema, so calling it directly is how "refused by NAME"
  // is proved to be independent of whether a pack declares the field.
  certifyNoCopyFacts,
  manifestField,
  manifestParts,
  verticalPackManifest,
  type CaptureShotKind,
  type CertificationFinding,
  type ManifestField,
  type VerticalPackManifest,
} from "./packManifest.js";

export { comicManifest } from "./comicManifest.js";
export { sportsCardManifest, tcgCardManifest } from "./cardManifests.js";
export { MANIFESTS, manifestFor } from "./manifestRegistry.js";

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
