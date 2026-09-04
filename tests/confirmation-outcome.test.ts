// L3: the confirmation-outcome rule (019 §3.0, T3, T20; 035 §4.3).
// Pure logic, no database. Bead longbox-e5b.2.13 (E02-D03).
import { describe, expect, it } from "vitest";
import { decideOutcome, identityKey, topCandidateOf } from "../src/services/confirmationOutcome.js";

const ASM300 = { title: "Amazing Spider-Man", issue: "300", variant: "Direct" };

describe("identityKey", () => {
  it("keys on title + issue + variant", () => {
    expect(identityKey(ASM300)).toBe(["amazing spider-man", "300", "direct"].join("\u001f"));
  });

  it("normalizes case, padding and collapsed whitespace so a round-tripped pick still matches", () => {
    expect(identityKey({ title: "  AMAZING   Spider-Man ", issue: " 300 ", variant: "DIRECT" })).toBe(
      identityKey(ASM300)
    );
  });

  it("treats a leading # on the issue as punctuation, not identity", () => {
    expect(identityKey({ title: "Daredevil", issue: "#181" })).toBe(
      identityKey({ title: "Daredevil", issue: "181" })
    );
  });

  it("does not conflate an issue with a lettered issue", () => {
    expect(identityKey({ title: "Daredevil", issue: "181" })).not.toBe(
      identityKey({ title: "Daredevil", issue: "181A" })
    );
  });

  it("accepts a numeric issue field and keys it the same as its string form", () => {
    expect(identityKey({ title: "Hulk", issue: 181 })).toBe(identityKey({ title: "Hulk", issue: "181" }));
  });

  it("treats missing, null and empty variant as the same claim", () => {
    const bare = identityKey({ title: "Hulk", issue: "181" });
    expect(identityKey({ title: "Hulk", issue: "181", variant: null })).toBe(bare);
    expect(identityKey({ title: "Hulk", issue: "181", variant: "" })).toBe(bare);
  });

  it("distinguishes a variant from the base issue", () => {
    expect(identityKey({ title: "Hulk", issue: "181", variant: "Newsstand" })).not.toBe(
      identityKey({ title: "Hulk", issue: "181" })
    );
  });

  it("ignores publisher and year, which the operator does not pick between", () => {
    expect(identityKey({ ...ASM300, publisher: "Marvel", year: 1988, confidence: 0.91 })).toBe(
      identityKey(ASM300)
    );
  });

  it("returns null for a payload with no usable identity", () => {
    expect(identityKey({ publisher: "Marvel", year: 1988 })).toBeNull();
    expect(identityKey({})).toBeNull();
    expect(identityKey(null)).toBeNull();
    expect(identityKey(undefined)).toBeNull();
    expect(identityKey("Amazing Spider-Man 300")).toBeNull();
  });

  it("keeps a title-only or issue-only payload comparable, and does not conflate the two", () => {
    const titleOnly = identityKey({ title: "Amazing Spider-Man" });
    const issueOnly = identityKey({ issue: "300" });
    expect(titleOnly).not.toBeNull();
    expect(issueOnly).not.toBeNull();
    expect(titleOnly).not.toBe(issueOnly);
    expect(titleOnly).not.toBe(identityKey(ASM300));
  });
});

describe("topCandidateOf", () => {
  it("returns the first-ranked entry", () => {
    expect(topCandidateOf([ASM300, { title: "Other", issue: "1" }])).toEqual(ASM300);
  });

  it("returns undefined for an empty or non-array candidates payload", () => {
    expect(topCandidateOf([])).toBeUndefined();
    expect(topCandidateOf(null)).toBeUndefined();
    expect(topCandidateOf({ candidates: [ASM300] })).toBeUndefined();
  });
});

describe("decideOutcome", () => {
  it("is always confirm for one_tap, which is the act of accepting the proposal", () => {
    expect(decideOutcome({ source: "one_tap", confirmed: ASM300, topProposal: ASM300 })).toBe("confirm");
  });

  it("is confirm for one_tap even with no proposal on record (T3's denominator is every one-tap)", () => {
    expect(decideOutcome({ source: "one_tap", confirmed: ASM300, topProposal: undefined })).toBe("confirm");
  });

  it("is confirm when a grid pick lands on the top-ranked proposal", () => {
    expect(
      decideOutcome({
        source: "grid_pick",
        confirmed: { ...ASM300, confidence: 0.62 },
        topProposal: ASM300,
      })
    ).toBe("confirm");
  });

  it("is correct when a grid pick lands on a different candidate", () => {
    expect(
      decideOutcome({
        source: "grid_pick",
        confirmed: { title: "Amazing Spider-Man", issue: "301" },
        topProposal: ASM300,
      })
    ).toBe("correct");
  });

  it("is correct when only the variant differs — variant is identity (019 T1)", () => {
    expect(
      decideOutcome({
        source: "grid_pick",
        confirmed: { title: "Amazing Spider-Man", issue: "300", variant: "Newsstand" },
        topProposal: ASM300,
      })
    ).toBe("correct");
  });

  it("is correct for a manual search on a session with no candidates", () => {
    expect(decideOutcome({ source: "manual_search", confirmed: ASM300, topProposal: undefined })).toBe(
      "correct"
    );
  });

  it("is correct when the latest candidate_set has no comparable identity (a bare barcode parse)", () => {
    expect(
      decideOutcome({
        source: "manual_search",
        confirmed: ASM300,
        topProposal: { ok: true, upc: "759606043019", supplement: "01711" },
      })
    ).toBe("correct");
  });

  it("is confirm when a manual search retypes exactly what was proposed", () => {
    expect(
      decideOutcome({
        source: "manual_search",
        confirmed: { title: "amazing spider-man", issue: "#300", variant: "direct" },
        topProposal: ASM300,
      })
    ).toBe("confirm");
  });

  it("is correct when the operator supplies an identity-less payload", () => {
    expect(decideOutcome({ source: "manual_search", confirmed: {}, topProposal: ASM300 })).toBe("correct");
  });

  it("falls back to the top proposal for a first confirmation, with no prior on the session", () => {
    expect(decideOutcome({ source: "owner_review", confirmed: ASM300, topProposal: ASM300 })).toBe("confirm");
    expect(
      decideOutcome({
        source: "owner_review",
        confirmed: { title: "Hulk", issue: "181" },
        topProposal: ASM300,
      })
    ).toBe("correct");
  });
});

// T20 is "draft → publish without owner edits to identity or condition": the
// owner is reviewing the identity they INHERITED, not the model's ranking. Every
// case below is scored wrong if the prior confirmation is ignored.
describe("decideOutcome — the prior confirmation is the baseline (T20)", () => {
  const HULK181 = { title: "Hulk", issue: "181" };

  it("scores confirm when the owner agrees with the employee's correction, against the model", () => {
    // Employee manual-searched to Hulk 181 while the model's top pick was ASM 300.
    // The owner agreeing with Hulk 181 has edited NOTHING.
    expect(
      decideOutcome({
        source: "owner_review",
        confirmed: HULK181,
        topProposal: ASM300,
        priorConfirmation: HULK181,
      })
    ).toBe("confirm");
  });

  it("scores correct when the owner reverts to the model's top candidate", () => {
    // Employee confirmed Hulk 181; the owner changes it to ASM 300, which is what
    // the model proposed. Matching the model does not make it a non-edit.
    expect(
      decideOutcome({
        source: "owner_review",
        confirmed: ASM300,
        topProposal: ASM300,
        priorConfirmation: HULK181,
      })
    ).toBe("correct");
  });

  it("applies the same baseline to a second employee confirmation, not only owner_review", () => {
    expect(
      decideOutcome({
        source: "grid_pick",
        confirmed: HULK181,
        topProposal: ASM300,
        priorConfirmation: HULK181,
      })
    ).toBe("confirm");
    expect(
      decideOutcome({
        source: "manual_search",
        confirmed: ASM300,
        topProposal: ASM300,
        priorConfirmation: HULK181,
      })
    ).toBe("correct");
  });

  it("still confirms a one_tap regardless of the prior confirmation", () => {
    expect(
      decideOutcome({
        source: "one_tap",
        confirmed: ASM300,
        topProposal: ASM300,
        priorConfirmation: HULK181,
      })
    ).toBe("confirm");
  });

  it("falls through to the top proposal when the prior confirmation has no usable identity", () => {
    expect(
      decideOutcome({
        source: "owner_review",
        confirmed: ASM300,
        topProposal: ASM300,
        priorConfirmation: { publisher: "Marvel" },
      })
    ).toBe("confirm");
  });

  it("is correct when neither a prior confirmation nor a proposal offers a baseline", () => {
    expect(
      decideOutcome({
        source: "owner_review",
        confirmed: ASM300,
        topProposal: undefined,
        priorConfirmation: undefined,
      })
    ).toBe("correct");
  });
});
