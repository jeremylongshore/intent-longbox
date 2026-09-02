import { describe, expect, it } from "vitest";
import { checkEvidenceContradiction } from "../src/services/rerank.js";
import type { Evidence, RankedCandidate } from "../src/providers/types.js";

const asm300: RankedCandidate = {
  title: "The Amazing Spider-Man",
  issue: "300",
  publisher: "Marvel",
  year: 1988,
  confidence: 0.92,
};

const cleanEvidence: Evidence = {
  issue_number_read: "#300",
  price_box_text: "$1.00 US",
  logo_era_guess: "1980s",
};

describe("checkEvidenceContradiction", () => {
  it("no contradiction when evidence agrees", () => {
    const r = checkEvidenceContradiction(asm300, cleanEvidence);
    expect(r.contradiction).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it("flags issue-number mismatch", () => {
    const r = checkEvidenceContradiction(asm300, { ...cleanEvidence, issue_number_read: "#301" });
    expect(r.contradiction).toBe(true);
    expect(r.reasons[0]).toContain("issue_number_read");
  });

  it("flags price-box era vs candidate year mismatch", () => {
    // 12-cent price box on a claimed 1988 book: decade-scale miss.
    const r = checkEvidenceContradiction(asm300, { ...cleanEvidence, price_box_text: "12¢" });
    expect(r.contradiction).toBe(true);
    expect(r.reasons.some((x) => x.includes("price_box_text"))).toBe(true);
  });

  it("flags logo-era decade mismatch", () => {
    const r = checkEvidenceContradiction(asm300, { ...cleanEvidence, logo_era_guess: "1960s" });
    expect(r.contradiction).toBe(true);
    expect(r.reasons.some((x) => x.includes("logo_era_guess"))).toBe(true);
  });

  it("null evidence fields never contradict", () => {
    const r = checkEvidenceContradiction(asm300, {
      issue_number_read: null,
      price_box_text: null,
      logo_era_guess: null,
    });
    expect(r.contradiction).toBe(false);
  });

  it("no top candidate → no contradiction", () => {
    expect(checkEvidenceContradiction(undefined, cleanEvidence).contradiction).toBe(false);
  });
});
