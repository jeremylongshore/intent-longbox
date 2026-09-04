// THE COMIC PACK MANIFEST (E04-B04).
//
// 030 §5.3 mapped every manifest slot onto code that already runs, and this file
// is that mapping as data. Nothing here is a new design: the field lists are
// `comicIdentity.ts`'s Zod objects, the signature positions are 030 §3.3's
// ratified `series + issue + variant + printing`, the grade ladder is
// `src/services/condition.ts`'s `GRADE_LABELS`, and the two required capture
// shots are the two kinds `src/services/identify.ts` actually forwards to a
// provider. `tests/contract/pack-manifest-matches-code.test.ts` asserts each of
// those correspondences against the shipped modules rather than trusting them.
//
// ⚠ `cmc` IS THE AUTHORITATIVE COMIC VERTICAL CODE, ASSIGNED HERE. 047 §3.3 puts
// the three-character code in the pack row "never invented per LCID", and 049 §8
// declined to assign any code because E04-B04 owns it. `cmc` is the code the
// catalog integration fixtures have used since E04-D01
// (`tests/integration/catalogHelpers.ts:11`), so assigning it here makes the
// fixture's value the real one rather than orphaning it.

import { COMIC_VERTICAL } from "./packRegistry.js";
import { verticalPackManifest, type VerticalPackManifest } from "./packManifest.js";

export const comicManifest: VerticalPackManifest = verticalPackManifest.parse({
  vertical: COMIC_VERTICAL,
  verticalCode: "cmc",
  displayName: "Comics",
  packVersion: 1,
  signatureFnRef: "src/catalog/editionSignature.ts",

  identitySchema: {
    // The WORK (030 §5.3): `{ series, publisher, volume, year }`. The work's key
    // is `series + volume` and deliberately excludes the publisher, because "a
    // work-level key including the publisher would fail to dedupe a series two
    // corpora attribute differently" (`comicIdentity.ts`).
    definition: [
      { name: "series", required: true, inDefinitionSignature: true, inEditionSignature: true },
      { name: "publisher", required: false, inDefinitionSignature: false, inEditionSignature: false },
      { name: "volume", required: false, inDefinitionSignature: true, inEditionSignature: false },
      { name: "year", required: false, inDefinitionSignature: false, inEditionSignature: false },
    ],
    // The PRINTING. `cover` and `printing` are the barcode supplement's fourth
    // and fifth digits, decoded since v0 and discarded ever since (030 E10);
    // `coverDate` and `distribution` are 014 §8's E04-B02 row and are outside the
    // key, because widening 030 §3.3's ratified four is an amendment.
    edition: [
      { name: "issue", required: true, inDefinitionSignature: false, inEditionSignature: true },
      { name: "variant", required: false, inDefinitionSignature: false, inEditionSignature: true },
      { name: "printing", required: false, inDefinitionSignature: false, inEditionSignature: true },
      { name: "cover", required: false, inDefinitionSignature: false, inEditionSignature: false },
      { name: "coverDate", required: false, inDefinitionSignature: false, inEditionSignature: false },
      { name: "distribution", required: false, inDefinitionSignature: false, inEditionSignature: false },
    ],
  },

  // The two kinds `identify.ts` forwards today. `defect` is conditional because
  // the condition step asks for one only when a defect is being called out.
  captureRecipe: {
    required: ["cover", "barcode"],
    conditional: [{ when: "a defect is being called out", shot: "defect" }],
  },

  // `src/services/condition.ts` verbatim, and no numeric field exists in this
  // type (022 P1, 019 T7, locked decision 5).
  conditionSchema: {
    gradeLabels: ["PR", "FR", "GD", "VG", "FN", "VF", "NM"],
    defectVocabulary: [
      "spine_ticks",
      "spine_roll",
      "corner_wear",
      "cover_crease",
      "foxing",
      "tanning",
      "water_damage",
      "writing",
      "tears",
      "detached_cover",
      "missing_pages",
      "restoration",
    ],
    // EMPTY, DELIBERATELY. A slabbed comic gets the slab line (021 C14) and no
    // Longbox range at all (021 B22, 037 §4.1 trigger 3), so there is no comic
    // grader label to map ONTO our ladder. A map with entries would be the first
    // step toward printing a range beside a slab's number.
    graderLabelMap: {},
  },

  // The namespaces the comic vertical speaks today: the UPC the barcode rung
  // parses (`src/services/barcode.ts`), and the two valuation sources
  // (`src/services/pricing.ts`, `src/services/ebay.ts`). `gcd` is here because
  // the corpus this vertical imports is GCD's (003) — the edge is an alias under
  // a rights row, never a column (030 §4).
  providerCrosswalk: [
    { provider: "upc", idKind: "upc_a_with_supplement" },
    { provider: "gcd", idKind: "gcd_issue_id" },
    { provider: "pricecharting", idKind: "pricecharting_product_id" },
    { provider: "ebay", idKind: "ebay_epid" },
  ],

  valuationNormalization: {
    gradeBasis: "range",
    currency: "USD",
    sourceAdapters: [
      { source: "pricecharting", quoteKind: "historical_fmv" },
      { source: "ebay", quoteKind: "live_asks" },
    ],
  },

  // 021 row ids, never copy. The universal rows plus B21 ("Mint" as a band) and
  // B23 (investment language), both of which a comic listing could otherwise
  // reach for.
  prohibitedClaims: ["B14", "B17", "B18", "B19", "B20", "B21", "B22", "B23", "B24", "B25"],
});
