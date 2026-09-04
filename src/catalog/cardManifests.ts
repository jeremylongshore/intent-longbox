// THE TWO CARD PACK MANIFESTS (E04-B04).
//
// 049 §4 registered `sports-card` and `tcg-card` as two verticals sharing ONE
// module, and its §8 said in terms that it "does not assign vertical CODES —
// `spc` and `tcg` appear in a test fixture; the authoritative assignment is a
// `vertical_pack` row, and E04-B04 makes it". This file makes it: **`spc` and
// `tcg`**, the same two strings the E04-B03 integration fixture used, so the
// fixture's values become the real ones instead of being orphaned by a different
// choice made later.
//
// ⚠ REGISTERING A PACK IS NOT AUTHORISING A VERTICAL, AND A MANIFEST IN THIS FILE
// IS NOT A `vertical_pack` ROW. E19-B06 gates any second vertical on reuse,
// rights, accuracy, economics and demand evidence; 030 §5.4: "architectural
// possibility is not market permission". `pnpm register-pack` takes a vertical by
// name and has no default, so registering a card vertical in a real database is a
// typed, deliberate operator act and never a side effect of a deploy.
//
// ⚠ THE GRADE LADDER IS NOT 030 §5.4's SKETCH, AND THE DIFFERENCE IS A BLOCKLIST
// ROW, NOT A PREFERENCE. §5.4 sketched `["POOR","GOOD","VG","EX","NM","MINT","GEM"]`.
// 021 gained **B21** on 2026-09-04 — *"'Mint' as a Longbox band"*, on 037 §2.1's
// ground that the trade's own publishers decline to define it — after §5.4 was
// written, and `certifyConditionSchema` now refuses any band containing MINT or
// GEM in every vertical. So the sketch's last two bands are dropped here. This is
// not the authoritative card vocabulary: 049 §8 assigns that to **E08-B02**,
// which is blocked on this bead, and these five bands are the largest prefix of
// §5.4's sketch that 021 permits.

import { SPORTS_CARD_VERTICAL, TCG_CARD_VERTICAL } from "./cardIdentity.js";
import { verticalPackManifest, type VerticalPackManifest } from "./packManifest.js";

/**
 * The PRINTING, identical in both card verticals (049 §3.2).
 *
 * `printRun` is an edition fact — every copy of a `/99` parallel shares the run —
 * and it is OUTSIDE the key (049 §5.5); `serialNumber`, the number stamped on one
 * card, is a COPY fact and is refused by name in every vertical (`copyFacts.ts`).
 */
const CARD_EDITION_DECLARATION = [
  { name: "number", required: true, inDefinitionSignature: false, inEditionSignature: true },
  { name: "variant", required: false, inDefinitionSignature: false, inEditionSignature: true },
  { name: "parallel", required: false, inDefinitionSignature: false, inEditionSignature: true },
  { name: "language", required: false, inDefinitionSignature: false, inEditionSignature: true },
  { name: "printRun", required: false, inDefinitionSignature: false, inEditionSignature: false },
];

/** Everything else the two card verticals share, which is everything but four lines. */
const cardShape = {
  packVersion: 1,
  signatureFnRef: "src/catalog/cardIdentity.ts",

  // 030 §5.4: front + back required, the slab label conditional on the COPY
  // carrying a certification. The slab label is a shot of a copy fact, which is
  // why it is a capture shot and never an edition attribute.
  captureRecipe: {
    required: ["front", "back"] as const,
    conditional: [{ when: "the copy is in a third-party slab", shot: "slab_label" } as const],
  },

  conditionSchema: {
    gradeLabels: ["POOR", "GOOD", "VG", "EX", "NM"],
    defectVocabulary: [
      "corner_wear",
      "edge_wear",
      "surface_scratch",
      "print_defect",
      "off_center",
      "crease",
      "stain",
      "writing",
    ],
    // A grader's own label maps ONTO our ladder; the number never travels
    // (022 P1, 019 T7, 021 B17). The keys quote a named grader's label, which is
    // the ONE place B17 permits a number to appear near a condition, and the
    // values are bands from the ladder above.
    graderLabelMap: {
      "PSA 10": { low: "NM", high: "NM" },
      "PSA 9": { low: "NM", high: "NM" },
      "PSA 8": { low: "EX", high: "NM" },
      "BGS 9.5": { low: "NM", high: "NM" },
      "BGS 8": { low: "EX", high: "NM" },
    },
  },

  // 030 §5.4's namespaces. `psa`/`bgs`/`cgc`/`sgc` are DELIBERATELY ABSENT: 047
  // §8.4 excludes cert namespaces from `edition_external_id` entirely, and
  // `certifyProviderCrosswalk` refuses one by name.
  providerCrosswalk: [
    { provider: "upc", idKind: "upc_a" },
    { provider: "pricecharting", idKind: "pricecharting_product_id" },
    { provider: "ebay", idKind: "ebay_epid" },
  ],

  valuationNormalization: {
    gradeBasis: "range" as const,
    currency: "USD",
    sourceAdapters: [
      { source: "pricecharting", quoteKind: "historical_fmv" as const },
      { source: "ebay", quoteKind: "live_asks" as const },
    ],
  },

  // The universal rows plus B23 (investment language), which card copy reaches
  // for more readily than comic copy does. B21 is in the universal set's spirit
  // and is carried explicitly because this pack's sketch offered a MINT band.
  prohibitedClaims: ["B14", "B17", "B18", "B19", "B20", "B21", "B22", "B23", "B24", "B25"],
};

export const sportsCardManifest: VerticalPackManifest = verticalPackManifest.parse({
  ...cardShape,
  vertical: SPORTS_CARD_VERTICAL,
  verticalCode: "spc",
  displayName: "Sports cards",
  identitySchema: {
    // 049 §3.1. `player` is REQUIRED and in the WORK's key: subject cardinality
    // inside one set runs to hundreds, so a card definition with no subject would
    // collide with every other card in its set.
    definition: [
      { name: "sport", required: true, inDefinitionSignature: false, inEditionSignature: false },
      { name: "player", required: true, inDefinitionSignature: true, inEditionSignature: false },
      { name: "set", required: true, inDefinitionSignature: true, inEditionSignature: true },
      { name: "year", required: false, inDefinitionSignature: false, inEditionSignature: false },
      { name: "manufacturer", required: false, inDefinitionSignature: false, inEditionSignature: false },
    ],
    edition: CARD_EDITION_DECLARATION,
  },
});

export const tcgCardManifest: VerticalPackManifest = verticalPackManifest.parse({
  ...cardShape,
  vertical: TCG_CARD_VERTICAL,
  verticalCode: "tcg",
  displayName: "Trading card games",
  identitySchema: {
    definition: [
      { name: "game", required: true, inDefinitionSignature: false, inEditionSignature: false },
      { name: "cardName", required: true, inDefinitionSignature: true, inEditionSignature: false },
      { name: "set", required: true, inDefinitionSignature: true, inEditionSignature: true },
      { name: "year", required: false, inDefinitionSignature: false, inEditionSignature: false },
      { name: "manufacturer", required: false, inDefinitionSignature: false, inEditionSignature: false },
    ],
    edition: CARD_EDITION_DECLARATION,
  },
});
