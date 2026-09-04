// L3 — the band derivation (E06-D01, 046 §5 A8 / R-3).
//
// The property under test is one sentence: NOTHING THE MODEL PUTS IN A JSON
// FIELD CAN RAISE THE BAND ABOVE WHAT THE SERVER CAN CORROBORATE. Every case
// below is either a demonstration of that or a demonstration that the model's
// number can still lower a band, which is the half that remains.
import { describe, expect, it } from "vitest";
import {
  assignBand,
  barcodeAgreement,
  candidateAgreement,
  deriveBand,
  minBand,
  type Band,
  type BarcodeAgreement,
  type BarcodeVerdict,
} from "../src/services/bands.js";
import type { Evidence, RankedCandidate } from "../src/providers/types.js";
import type { BarcodeResult } from "../src/services/barcode.js";

const t = { high: 0.85, medium: 0.5 };

const CLEAN: Evidence = {
  issue_number_read: "#300",
  price_box_text: "$1.00 US",
  logo_era_guess: "1980s",
};

const ASM300: RankedCandidate = {
  title: "The Amazing Spider-Man",
  issue: "300",
  publisher: "Marvel",
  year: 1988,
  confidence: 0.92,
};

const NO_CONTRADICTION = { contradiction: false, reasons: [] };
const CONTRADICTION = { contradiction: true, reasons: ["issue_number_read contradicts candidate"] };

/** A `BarcodeVerdict` from the shorthand these cases read best with. */
function verdict(agreement: BarcodeAgreement): BarcodeVerdict {
  return { agreement, cause: agreement === "unavailable" ? "no_scan" : null };
}

function derive(
  evidence: Evidence | undefined,
  candidates: readonly RankedCandidate[],
  confidence: number | null,
  opts: { contradiction?: { contradiction: boolean; reasons: string[] }; barcode?: BarcodeAgreement } = {}
): Band {
  return deriveBand(evidence, candidates, confidence, {
    contradiction: opts.contradiction ?? NO_CONTRADICTION,
    barcode: verdict(opts.barcode ?? "unavailable"),
    thresholds: t,
  }).band;
}

describe("assignBand — the model's number ALONE (still an input, no longer an authority)", () => {
  it("assigns high at/above the high threshold", () => {
    expect(assignBand(0.85, t)).toBe("high");
    expect(assignBand(0.99, t)).toBe("high");
  });
  it("assigns medium between thresholds", () => {
    expect(assignBand(0.5, t)).toBe("medium");
    expect(assignBand(0.84, t)).toBe("medium");
  });
  it("assigns low below the medium threshold", () => {
    expect(assignBand(0.49, t)).toBe("low");
    expect(assignBand(0, t)).toBe("low");
  });
});

describe("minBand", () => {
  it.each([
    ["high", "medium", "medium"],
    ["medium", "high", "medium"],
    ["high", "low", "low"],
    ["medium", "low", "low"],
    ["high", "high", "high"],
  ] as Array<[Band, Band, Band]>)("min(%s, %s) = %s", (a, b, expected) => {
    expect(minBand(a, b)).toBe(expected);
  });
});

describe("barcodeAgreement", () => {
  const withSupplement = (issue: number): BarcodeResult => ({
    ok: true,
    upc: "036000291452",
    supplement: { raw: "00311", issue, cover: 1, printing: 1 },
  });

  it("agrees when the supplement's issue matches the top candidate", () => {
    expect(barcodeAgreement(withSupplement(300), ASM300)).toEqual({ agreement: "agree", cause: null });
  });
  it("disagrees when it does not", () => {
    expect(barcodeAgreement(withSupplement(301), ASM300)).toEqual({ agreement: "disagree", cause: null });
  });
  // The four `unavailable` causes are recorded SEPARATELY, because "no barcode"
  // is a fact about the 1970s and "no supplement" is a fact about our scanner —
  // and E07-B07 is asked to re-open the barcode requirement against data, which
  // it cannot do against one bucket.
  it.each([
    ["no scan at all", undefined, ASM300, "no_scan"],
    ["a failed parse", { ok: false as const, error: "bad check digit" }, ASM300, "parse_failed"],
    ["a bare UPC with no supplement", { ok: true as const, upc: "036000291452" }, ASM300, "no_supplement"],
    ["no candidate to compare against", withSupplement(300), undefined, "no_candidate"],
    [
      "a candidate whose issue carries no number (an annual, a fraction)",
      withSupplement(300),
      { ...ASM300, issue: "Annual" },
      "candidate_issue_not_numeric",
    ],
  ] as Array<[string, BarcodeResult | undefined, RankedCandidate | undefined, string]>)(
    "is unavailable on %s, and names the cause",
    (_name, barcode, top, cause) => {
      expect(barcodeAgreement(barcode, top)).toEqual({ agreement: "unavailable", cause });
    }
  );
});

describe("candidateAgreement", () => {
  it("is none on an empty set", () => {
    expect(candidateAgreement([])).toBe("none");
  });
  it("is unique when the top title+issue appears once", () => {
    expect(candidateAgreement([ASM300, { ...ASM300, issue: "301" }])).toBe("unique");
  });
  it("is ambiguous when a later candidate repeats the top title+issue", () => {
    expect(candidateAgreement([ASM300, { ...ASM300, variant: "newsstand" }])).toBe("ambiguous");
  });
  it("compares case- and whitespace-insensitively", () => {
    expect(candidateAgreement([ASM300, { ...ASM300, title: "  the amazing spider-man " }])).toBe("ambiguous");
  });
});

describe("deriveBand — evidence sets the ceiling", () => {
  it.each([
    [
      "THE DEFECT (046 R-3): all three evidence fields null with max confidence never reaches high",
      { issue_number_read: null, price_box_text: null, logo_era_guess: null } as Evidence,
      0.99,
      "low" as Band,
    ],
    [
      "two null fields cap at low however certain the model claims to be",
      { ...CLEAN, price_box_text: null, logo_era_guess: null },
      0.99,
      "low" as Band,
    ],
    [
      "one null field caps at medium — missing evidence is contradiction-class",
      { ...CLEAN, price_box_text: null },
      0.99,
      "medium" as Band,
    ],
    [
      "an empty string is missing evidence, not evidence",
      { ...CLEAN, logo_era_guess: "   " },
      0.99,
      "medium" as Band,
    ],
    [
      "complete evidence with a barcode that agrees and a confident model → high",
      CLEAN,
      0.99,
      "high" as Band,
    ],
  ])("%s", (_name, evidence, confidence, expected) => {
    expect(derive(evidence, [ASM300], confidence, { barcode: "agree" })).toBe(expected);
  });

  it("undefined evidence is three missing fields, not an exemption", () => {
    expect(derive(undefined, [ASM300], 0.99, { barcode: "agree" })).toBe("low");
  });
});

describe("deriveBand — the model's number may only lower", () => {
  it("lowers a fully corroborated result when the model is unsure", () => {
    expect(derive(CLEAN, [ASM300], 0.6, { barcode: "agree" })).toBe("medium");
    expect(derive(CLEAN, [ASM300], 0.1, { barcode: "agree" })).toBe("low");
  });

  it("cannot raise a band the evidence does not support (the whole property)", () => {
    // Same evidence, confidence swept across its entire range: the ceiling holds.
    for (const c of [0, 0.25, 0.5, 0.75, 0.85, 0.99, 1]) {
      expect(derive({ ...CLEAN, price_box_text: null }, [ASM300], c, { barcode: "agree" })).not.toBe("high");
    }
  });

  it("treats an OMITTED confidence as no signal — valid, and never trusted anyway", () => {
    expect(derive(CLEAN, [ASM300], null, { barcode: "agree" })).toBe("high");
    // and it still cannot rescue missing evidence
    expect(derive({ ...CLEAN, price_box_text: null }, [ASM300], null, { barcode: "agree" })).toBe("medium");
  });
});

describe("deriveBand — the other three ceilings", () => {
  it("a contradiction removes the one-tap path (040 §4.2 F3)", () => {
    expect(derive(CLEAN, [ASM300], 0.99, { barcode: "agree", contradiction: CONTRADICTION })).toBe("medium");
  });

  it("a barcode that DISAGREES caps at low — the barcode is printed on the book", () => {
    expect(derive(CLEAN, [ASM300], 0.99, { barcode: "disagree" })).toBe("low");
  });

  it("no barcode caps at medium: unavailable is not agreement", () => {
    expect(derive(CLEAN, [ASM300], 0.99, { barcode: "unavailable" })).toBe("medium");
  });

  it("an ambiguous candidate set caps at medium, and an empty one at low", () => {
    expect(derive(CLEAN, [ASM300, { ...ASM300, variant: "2nd print" }], 0.99, { barcode: "agree" })).toBe(
      "medium"
    );
    expect(derive(CLEAN, [], 0.99, { barcode: "agree" })).toBe("low");
  });
});

describe("deriveBand — the recorded inputs (llm_rerank.band_inputs)", () => {
  it("records the completeness tuple, the reasons, each ceiling and the band", () => {
    const inputs = deriveBand(
      {
        issue_number_read: "#300",
        price_box_text: null,
        logo_era_guess: null,
        unreadable_reasons: { price_box_text: "obscured by a price sticker", logo_era_guess: "  " },
      },
      [ASM300],
      0.99,
      { contradiction: NO_CONTRADICTION, barcode: verdict("agree"), thresholds: t }
    );

    expect(inputs.evidence_present).toEqual({
      issue_number_read: true,
      price_box_text: false,
      logo_era_guess: false,
    });
    expect(inputs.evidence_missing).toEqual(["price_box_text", "logo_era_guess"]);
    // A blank reason is not a reason — it is not recorded as one.
    expect(inputs.unreadable_reasons).toEqual({ price_box_text: "obscured by a price sticker" });
    expect(inputs.model_confidence).toBe(0.99);
    expect(inputs.barcode_agreement).toBe("agree");
    expect(inputs.barcode_unavailable_cause).toBeNull();
    expect(inputs.candidate_agreement).toBe("unique");
    expect(inputs.ceilings).toEqual({
      evidence: "low",
      contradiction: "high",
      barcode: "high",
      candidates: "high",
      model: "high",
    });
    expect(inputs.band).toBe("low");
  });

  it("carries no percentage and no operator identifier (022 P6, 019 T35)", () => {
    const inputs = deriveBand(CLEAN, [ASM300], 0.99, {
      contradiction: NO_CONTRADICTION,
      barcode: verdict("agree"),
      thresholds: t,
    });
    const json = JSON.stringify(inputs);
    expect(json).not.toMatch(/%/);
    expect(json).not.toMatch(/confirmed_by|operator_id|created_by/);
  });
});
