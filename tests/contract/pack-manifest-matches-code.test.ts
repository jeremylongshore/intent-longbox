// THE MANIFESTS DESCRIBE THE CODE THAT RUNS, NOT A DESIGN BESIDE IT (E04-B04).
//
// 030 §5.3's claim about the comic pack is that it "is a description of code that
// already runs, not a new design". A manifest is data, so nothing in the compiler
// holds it to that claim — these are the checks that do. Every one of them reads
// the shipped module and compares, rather than restating the manifest's own value.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../scripts/architectureRules.js";
import { DEFECT_OPTIONS, GRADE_LABELS } from "../../src/services/condition.js";
import {
  MANIFESTS,
  REGISTERED_VERTICALS,
  certify,
  comicManifest,
  sportsCardManifest,
  tcgCardManifest,
} from "../../src/catalog/index.js";

describe("the pack registry and the manifest set are one set", () => {
  it("ships exactly one manifest per registered vertical", () => {
    // A pack with no manifest could never be registered as a row; a manifest with
    // no pack would name functions that do not exist. Either half alone is a
    // vertical that half-works, which is worse than one that does not exist.
    expect([...MANIFESTS.keys()].sort()).toEqual([...REGISTERED_VERTICALS].sort());
  });

  it("certifies every shipped manifest", () => {
    for (const [vertical, manifest] of MANIFESTS) {
      expect({ vertical, findings: certify(manifest) }).toEqual({ vertical, findings: [] });
    }
  });

  it("gives every vertical its own three-letter code", () => {
    // 047 §3.1 puts the code inside every LCID minted in the vertical, and
    // `vertical_pack.vertical_code` is UNIQUE — two packs sharing a code would be
    // two verticals whose identifiers are indistinguishable forever.
    const assigned = [...MANIFESTS.values()].map((m) => m.verticalCode);
    expect(new Set(assigned).size).toBe(assigned.length);
    for (const code of assigned) expect(code).toMatch(/^[a-z]{3}$/);
  });

  it("assigns the codes the E04-D01 and E04-B03 fixtures already used", () => {
    // 049 §8 left the assignment to this bead and noted that `spc` and `tcg`
    // "appear in a test fixture"; `cmc` has been the comic code in
    // `tests/integration/catalogHelpers.ts` since E04-D01. Choosing anything else
    // would have orphaned three fixtures for no gain.
    expect(comicManifest.verticalCode).toBe("cmc");
    expect(sportsCardManifest.verticalCode).toBe("spc");
    expect(tcgCardManifest.verticalCode).toBe("tcg");
  });

  it("names a signature module that exists on disk", () => {
    // 030 §5.2: the registry resolves `signature_fn_ref` at boot and FAILS CLOSED
    // if it is missing — "a registered pack whose signature function has been
    // deleted must stop the process, not silently mis-dedupe". The registration
    // script checks this before writing a row; this checks it before a release.
    for (const manifest of MANIFESTS.values()) {
      expect(existsSync(join(REPO_ROOT, manifest.signatureFnRef))).toBe(true);
    }
  });
});

describe("the comic manifest matches the comic code", () => {
  it("declares `src/services/condition.ts`'s grade ladder verbatim", () => {
    expect(comicManifest.conditionSchema.gradeLabels).toEqual([...GRADE_LABELS]);
  });

  it("declares `src/services/condition.ts`'s defect vocabulary verbatim", () => {
    expect(comicManifest.conditionSchema.defectVocabulary).toEqual([...DEFECT_OPTIONS]);
  });

  it("requires the two photo kinds `identify` actually forwards to a provider", () => {
    // `src/services/identify.ts` filters photos to `cover` and `barcode` before a
    // provider ever sees them. A manifest requiring a third shot would promise a
    // capture the pipeline discards; one requiring fewer would let a book reach a
    // provider with less than the code expects.
    const identify = readFileSync(join(REPO_ROOT, "src/services/identify.ts"), "utf8");
    const forwarded = [...identify.matchAll(/p\.kind === "(\w+)"/g)].map((m) => m[1]!);
    expect(new Set(forwarded)).toEqual(new Set(comicManifest.captureRecipe.required));
  });

  it("maps no grader label at all", () => {
    // 021 B22 / 037 §4.1 trigger 3: a slabbed comic gets the slab line and NO
    // Longbox range, so there is nothing for a comic grader label to map onto. An
    // entry here would be the first step toward printing a range beside a slab's
    // number.
    expect(comicManifest.conditionSchema.graderLabelMap).toEqual({});
  });
});

describe("the card manifests match 049's ratified card decisions", () => {
  it("puts all five ratified positions in the edition key, and printRun outside it", () => {
    // 049 §5.2: `set + number + variant + parallel + language`. `printRun` is an
    // edition attribute and deliberately not identity (049 §5.5).
    for (const manifest of [sportsCardManifest, tcgCardManifest]) {
      const inKey = [...manifest.identitySchema.definition, ...manifest.identitySchema.edition]
        .filter((f) => f.inEditionSignature)
        .map((f) => f.name)
        .sort();
      expect(inKey).toEqual(["language", "number", "parallel", "set", "variant"]);
      expect(manifest.identitySchema.edition.find((f) => f.name === "printRun")?.inEditionSignature).toBe(
        false
      );
    }
  });

  it("declares no cert namespace in the crosswalk (047 §8.4)", () => {
    for (const manifest of [sportsCardManifest, tcgCardManifest]) {
      const providers = manifest.providerCrosswalk.map((e) => e.provider);
      for (const grader of ["psa", "bgs", "cgc", "sgc"]) expect(providers).not.toContain(grader);
    }
  });

  it("offers no MINT or GEM band, though 030 §5.4's sketch did", () => {
    // The sketch predates 021 B21 (2026-09-04). The authoritative card vocabulary
    // is E08-B02's; these five bands are the largest prefix of the sketch that
    // 021 permits.
    for (const manifest of [sportsCardManifest, tcgCardManifest]) {
      expect(manifest.conditionSchema.gradeLabels).toEqual(["POOR", "GOOD", "VG", "EX", "NM"]);
    }
  });
});
