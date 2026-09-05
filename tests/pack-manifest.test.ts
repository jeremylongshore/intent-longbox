// PACK CERTIFICATION (E04-B04) — what a manifest must not be able to say.
//
// Every case below is a manifest that would otherwise have become an immutable
// `vertical_pack_version` row that every later `collectible_definition` and
// `edition` in its vertical cites. There is no repair path for such a row (the
// append-only trigger refuses UPDATE), so certification is the only place these
// mistakes can be caught at all.
import { describe, expect, it } from "vitest";
import {
  MANIFESTS,
  PackCertificationError,
  UNIVERSAL_PROHIBITED_CLAIMS,
  assertCertified,
  assertVersionMoved,
  canonicalManifest,
  certify,
  certifyNoCopyFacts,
  comicManifest,
  sportsCardManifest,
  tcgCardManifest,
  type VerticalPackManifest,
} from "../src/catalog/index.js";

/** A deep clone of the comic manifest, so a mutation in one case cannot leak. */
function draft(): VerticalPackManifest {
  return JSON.parse(JSON.stringify(comicManifest)) as VerticalPackManifest;
}

function codes(manifest: unknown): string[] {
  return certify(manifest).map((f) => f.code);
}

describe("the three shipped manifests certify", () => {
  it.each([
    ["comic", comicManifest],
    ["sports-card", sportsCardManifest],
    ["tcg-card", tcgCardManifest],
  ])("%s", (_name, manifest) => {
    expect(certify(manifest)).toEqual([]);
  });

  it("ships one manifest per registered vertical and no others", () => {
    expect([...MANIFESTS.keys()].sort()).toEqual(["comic", "sports-card", "tcg-card"]);
  });
});

describe("030 §5.4 / 049 C10 — a copy fact is never an identity field", () => {
  // THE ACCEPTANCE LINE THIS BEAD EXISTS TO DISCHARGE. 049 §7 left C10 as the one
  // ASSERTED invariant in that record — "a pack manifest declaring `grader` or
  // `cert_number` as an edition field fails PACK CERTIFICATION" — because pack
  // certification did not exist. It exists now, and these are its teeth.
  it("refuses `grader` declared as an edition field", () => {
    const m = draft();
    m.identitySchema.edition.push({
      name: "grader",
      required: false,
      inDefinitionSignature: false,
      inEditionSignature: false,
    });
    expect(codes(m)).toContain("COPY_FACT_OR_PROVIDER_FIELD");
  });

  it("refuses `cert_number` declared as an edition field, in any spelling", () => {
    for (const name of ["cert_number", "certNumber", "CERT-NUMBER"]) {
      const m = draft();
      m.identitySchema.edition.push({
        name,
        required: false,
        inDefinitionSignature: false,
        inEditionSignature: false,
      });
      expect(codes(m)).toContain("COPY_FACT_OR_PROVIDER_FIELD");
    }
  });

  it("refuses a copy fact on the DEFINITION too, which is the same error one level worse", () => {
    const m = draft();
    m.identitySchema.definition.push({
      name: "serialNumber",
      required: false,
      inDefinitionSignature: false,
      inEditionSignature: false,
    });
    expect(codes(m)).toContain("COPY_FACT_OR_PROVIDER_FIELD");
  });

  // E04-D05 — THE HALF OF C10 THAT WAS ADVERTISED AND NOT BUILT.
  // Before this, `psaGrade` declared as an edition field was refused only as
  // FIELD_NOT_IN_SCHEMA: not because it names a copy fact, but because the
  // pack's Zod object did not happen to declare it. A pack author who declared
  // it in their OWN schema would therefore have CERTIFIED — which is exactly
  // the discharge 051 §4.1 claims, undone by the author it was written for.
  // These cases assert the refusal is BY NAME, at both levels, whatever noun
  // follows the grading company's.
  const graderNamespaced = [
    "psaGrade",
    "bgs_grade",
    "cgcCertNumber",
    "sgc-cert",
    "CGC_Serial",
    "tcgplayerGrade",
    "beckettScore",
    "cbcsSlabLabel",
  ];

  it.each(graderNamespaced)("refuses `%s` as an edition field, by NAME", (name) => {
    const m = draft();
    m.identitySchema.edition.push({
      name,
      required: false,
      inDefinitionSignature: false,
      inEditionSignature: false,
    });
    expect(codes(m)).toContain("COPY_FACT_OR_PROVIDER_FIELD");
  });

  it.each(graderNamespaced)("refuses `%s` on the DEFINITION too", (name) => {
    const m = draft();
    m.identitySchema.definition.push({
      name,
      required: false,
      inDefinitionSignature: false,
      inEditionSignature: false,
    });
    expect(codes(m)).toContain("COPY_FACT_OR_PROVIDER_FIELD");
  });

  it("refuses `psaGrade` for its NAME, not because a schema failed to declare it", () => {
    // The C10 discharge, stated as the scenario that motivated E04-D05: a
    // future pack author adds `psaGrade` to their own Zod object so the field
    // checks pass, and certification must STILL refuse it.
    //
    // `certifyNoCopyFacts` is the proof, because it is the one certification
    // function that never consults `packFor(...).schemas` — its verdict cannot
    // depend on what any pack declares. If it fires, the refusal is by name.
    const m = draft();
    m.identitySchema.edition.push({
      name: "psaGrade",
      required: false,
      inDefinitionSignature: false,
      inEditionSignature: false,
    });
    const byName = certifyNoCopyFacts(m);
    expect(byName.map((f) => f.code)).toEqual(["COPY_FACT_OR_PROVIDER_FIELD"]);
    expect(byName[0]?.message).toMatch(/grading company "PSA"/);
    // And the whole gate agrees, alongside whatever the field checks say.
    expect(codes(m)).toContain("COPY_FACT_OR_PROVIDER_FIELD");
  });

  // `pgx_id` and `beckett_id` joined `PROVIDER_KEY_RE` at E04-D05: they were in
  // the grader-namespace list but not the provider one, so they were refused
  // with a sentence about grades and slab labels rather than about providers.
  it.each(["gcd_id", "pgx_id", "beckett_id", "cbcs_id"])(
    "refuses the provider-named field `%s` (030 §4 rule 2)",
    (name) => {
      const m = draft();
      m.identitySchema.edition.push({
        name,
        required: false,
        inDefinitionSignature: false,
        inEditionSignature: false,
      });
      expect(codes(m)).toContain("COPY_FACT_OR_PROVIDER_FIELD");
    }
  );
});

describe("030 §6 rule 3 — an unregistered vertical is refused, never defaulted", () => {
  it("refuses a vertical this build cannot resolve", () => {
    const m = draft();
    m.vertical = "coin";
    expect(codes(m)).toContain("UNREGISTERED_VERTICAL");
  });

  it("refuses a vertical_code that is not three lowercase letters", () => {
    for (const code of ["cm", "CMC", "cmc1", "comic"]) {
      const m = draft();
      m.verticalCode = code;
      expect(codes(m)).toContain("MANIFEST_SHAPE");
    }
  });
});

describe("the declared identity schema must be the one the pack validates with", () => {
  it("refuses a manifest that omits a field the pack's schema has", () => {
    const m = draft();
    m.identitySchema.edition = m.identitySchema.edition.filter((f) => f.name !== "cover");
    expect(codes(m)).toContain("FIELD_NOT_DECLARED");
  });

  it("refuses a manifest that invents a field the pack's schema refuses", () => {
    const m = draft();
    m.identitySchema.edition.push({
      name: "cornerCount",
      required: false,
      inDefinitionSignature: false,
      inEditionSignature: false,
    });
    expect(codes(m)).toContain("FIELD_NOT_IN_SCHEMA");
  });

  it("refuses a required flag that disagrees with the schema", () => {
    const m = draft();
    m.identitySchema.edition = m.identitySchema.edition.map((f) =>
      f.name === "variant" ? { ...f, required: true } : f
    );
    expect(codes(m)).toContain("REQUIRED_FLAG_DRIFT");
  });

  it("refuses the same field name declared twice", () => {
    const m = draft();
    m.identitySchema.definition.push({ ...m.identitySchema.definition[0]! });
    expect(codes(m)).toContain("DUPLICATE_FIELD");
  });
});

describe("signature positions are proved against the function, not asserted", () => {
  it("refuses a field declared in the key that the key cannot see — 030 §5.4's own defect", () => {
    // This is exactly the shape 030 §5.4 carried until 049 §5.2 amended it: an
    // attribute listed as identity that the signature function ignores, so two
    // different printings dedupe as one.
    const m = draft();
    m.identitySchema.edition = m.identitySchema.edition.map((f) =>
      f.name === "cover" ? { ...f, inEditionSignature: true } : f
    );
    expect(codes(m)).toContain("PHANTOM_SIGNATURE_POSITION");
  });

  it("refuses a field that moves the key while the manifest says it does not", () => {
    const m = draft();
    m.identitySchema.edition = m.identitySchema.edition.map((f) =>
      f.name === "variant" ? { ...f, inEditionSignature: false } : f
    );
    expect(codes(m)).toContain("UNDECLARED_SIGNATURE_POSITION");
  });

  it("refuses an edition field claimed for the WORK's key", () => {
    const m = draft();
    m.identitySchema.edition = m.identitySchema.edition.map((f) =>
      f.name === "issue" ? { ...f, inDefinitionSignature: true } : f
    );
    expect(codes(m)).toContain("EDITION_FIELD_IN_WORK_KEY");
  });

  it("catches a work-key claim the definition signature does not honour", () => {
    const m = draft();
    m.identitySchema.definition = m.identitySchema.definition.map((f) =>
      f.name === "publisher" ? { ...f, inDefinitionSignature: true } : f
    );
    expect(codes(m)).toContain("PHANTOM_SIGNATURE_POSITION");
  });
});

describe("condition is never numeric, in any vertical (022 P1, 019 T7, locked decision 5)", () => {
  it("refuses a grade label containing a digit", () => {
    const m = draft();
    m.conditionSchema.gradeLabels = [...m.conditionSchema.gradeLabels, "9.8"];
    expect(codes(m)).toContain("NUMERIC_GRADE");
  });

  it("refuses MINT and GEM as bands (021 B21)", () => {
    for (const band of ["MINT", "Mint", "GEM MINT"]) {
      const m = draft();
      m.conditionSchema.gradeLabels = [...m.conditionSchema.gradeLabels, band];
      expect(codes(m)).toContain("FORBIDDEN_GRADE_BAND");
    }
  });

  it("refuses `pressed` as a defect option (021 B24)", () => {
    const m = draft();
    m.conditionSchema.defectVocabulary = [...m.conditionSchema.defectVocabulary, "pressed"];
    expect(codes(m)).toContain("FORBIDDEN_DEFECT_OPTION");
  });

  it("refuses a grader label mapped outside this pack's ladder", () => {
    const m = draft();
    m.conditionSchema.graderLabelMap = { "CGC 9.8": { low: "NM", high: "GEM" } };
    expect(codes(m)).toContain("GRADER_MAP_OUTSIDE_LADDER");
  });

  it("refuses a grader range whose low is above its high", () => {
    const m = draft();
    m.conditionSchema.graderLabelMap = { "CGC 9.8": { low: "NM", high: "GD" } };
    expect(codes(m)).toContain("GRADER_MAP_INVERTED");
  });

  it("accepts a grader label that quotes the grader's own number as the KEY", () => {
    // 021 B17's one carve-out: "the only numbers permitted near a condition are
    // quoted from a named grader's own label". The number is in the key, and the
    // value is a band from our ladder — it never travels through.
    const m = draft();
    m.conditionSchema.graderLabelMap = { "CGC 9.8": { low: "VF", high: "NM" } };
    expect(certify(m)).toEqual([]);
  });
});

describe("047 §8.4 — a cert namespace is never a crosswalk edge", () => {
  it.each(["psa", "bgs", "cgc", "sgc", "cbcs"])("refuses %s in providerCrosswalk", (provider) => {
    const m = draft();
    m.providerCrosswalk = [...m.providerCrosswalk, { provider, idKind: "cert_number" }];
    expect(codes(m)).toContain("CERT_NAMESPACE_IN_CROSSWALK");
  });

  it("refuses a duplicated provider namespace", () => {
    const m = draft();
    m.providerCrosswalk = [...m.providerCrosswalk, { provider: "upc", idKind: "upc_a" }];
    expect(codes(m)).toContain("DUPLICATE_PROVIDER");
  });

  it("refuses a provider spelled with capitals, because two spellings are two namespaces", () => {
    const m = draft();
    m.providerCrosswalk = [...m.providerCrosswalk, { provider: "GCD", idKind: "gcd_issue_id" }];
    expect(codes(m)).toContain("PROVIDER_NOT_LOWERCASE");
  });
});

describe("021 rows a pack may not drop", () => {
  it.each(UNIVERSAL_PROHIBITED_CLAIMS)("refuses a manifest that omits %s", (row) => {
    const m = draft();
    m.prohibitedClaims = m.prohibitedClaims.filter((r) => r !== row);
    expect(codes(m)).toContain("MISSING_UNIVERSAL_PROHIBITED_CLAIM");
  });

  it("refuses a prohibited claim that is copy rather than a 021 row id", () => {
    const m = draft();
    m.prohibitedClaims = [...m.prohibitedClaims, "never say AI graded"];
    expect(codes(m)).toContain("MANIFEST_SHAPE");
  });
});

describe("the capture recipe", () => {
  it("refuses a shot outside the closed vocabulary", () => {
    const m = draft();
    (m.captureRecipe.required as string[]).push("xray");
    expect(codes(m)).toContain("MANIFEST_SHAPE");
  });

  it("refuses a duplicated required shot", () => {
    const m = draft();
    m.captureRecipe.required = [...m.captureRecipe.required, "cover"];
    expect(codes(m)).toContain("DUPLICATE_CAPTURE_SHOT");
  });

  it("refuses a shot that is both required and conditional", () => {
    const m = draft();
    m.captureRecipe.conditional = [{ when: "always", shot: "cover" }];
    expect(codes(m)).toContain("CONDITIONAL_SHOT_ALREADY_REQUIRED");
  });

  it("refuses an empty required set — a recipe with no shot captures nothing", () => {
    const m = draft();
    m.captureRecipe.required = [];
    expect(codes(m)).toContain("MANIFEST_SHAPE");
  });
});

describe("signatureFnRef", () => {
  it("refuses a path outside the catalog module", () => {
    const m = draft();
    m.signatureFnRef = "src/services/condition.ts";
    expect(codes(m)).toContain("SIGNATURE_FN_REF_OUTSIDE_CATALOG");
  });
});

describe("assertCertified", () => {
  it("returns the parsed manifest when it passes", () => {
    expect(assertCertified(comicManifest).vertical).toBe("comic");
  });

  it("throws a PackCertificationError naming every finding", () => {
    const m = draft();
    m.vertical = "coin";
    m.conditionSchema.gradeLabels = [...m.conditionSchema.gradeLabels, "9.8"];
    try {
      assertCertified(m);
      expect.unreachable("a manifest with two defects must not certify");
    } catch (err) {
      expect(err).toBeInstanceOf(PackCertificationError);
      const findings = (err as PackCertificationError).findings.map((f) => f.code);
      expect(findings).toContain("UNREGISTERED_VERTICAL");
      expect(findings).toContain("NUMERIC_GRADE");
    }
  });
});

describe("030 A5 — the pack version is single-rate and must move with the parts", () => {
  it("accepts a first registration", () => {
    expect(() => assertVersionMoved(undefined, comicManifest)).not.toThrow();
  });

  it("accepts an unchanged re-registration at the same version", () => {
    expect(() =>
      assertVersionMoved({ packVersion: comicManifest.packVersion, manifest: comicManifest }, comicManifest)
    ).not.toThrow();
  });

  it("REFUSES a changed manifest at an unchanged version", () => {
    const next = draft();
    next.displayName = "Comic books";
    expect(() => assertVersionMoved({ packVersion: 1, manifest: comicManifest }, next)).toThrow(
      PackCertificationError
    );
  });

  it("REFUSES a changed manifest at a LOWER version", () => {
    const next = draft();
    next.displayName = "Comic books";
    next.packVersion = 1;
    expect(() => assertVersionMoved({ packVersion: 3, manifest: comicManifest }, next)).toThrow(
      /VERSION_DID_NOT_MOVE/
    );
  });

  it("accepts a changed manifest at a higher version", () => {
    const next = draft();
    next.displayName = "Comic books";
    next.packVersion = 2;
    expect(() => assertVersionMoved({ packVersion: 1, manifest: comicManifest }, next)).not.toThrow();
  });

  it("REFUSES a version bump that changes nothing", () => {
    const next = draft();
    next.packVersion = 2;
    expect(() => assertVersionMoved({ packVersion: 1, manifest: comicManifest }, next)).toThrow(
      /VERSION_MOVED_WITHOUT_A_CHANGE/
    );
  });

  it("compares manifests by content, not by key order", () => {
    // A jsonb round-trip does not preserve key order, so a comparison that did
    // would refuse every re-registration of an unchanged manifest.
    const shuffled = Object.fromEntries(
      Object.entries(comicManifest as unknown as Record<string, unknown>).reverse()
    );
    const reordered = JSON.parse(JSON.stringify(shuffled)) as VerticalPackManifest;
    expect(canonicalManifest(reordered)).toBe(canonicalManifest(comicManifest));
    expect(() =>
      assertVersionMoved({ packVersion: comicManifest.packVersion, manifest: reordered }, comicManifest)
    ).not.toThrow();
  });

  it("sees a change buried anywhere in the manifest, not only at the top level", () => {
    const next = draft();
    next.conditionSchema.defectVocabulary = [...next.conditionSchema.defectVocabulary, "sun_shadow"];
    expect(() => assertVersionMoved({ packVersion: 1, manifest: comicManifest }, next)).toThrow(
      /VERSION_DID_NOT_MOVE/
    );
  });
});
