import { describe, expect, it } from "vitest";
import { applyPricingPolicy, medianCents, type Comp } from "../src/services/pricing.js";
import { validGradeRange } from "../src/services/condition.js";

const comps: Comp[] = [
  { title: "a", grade_label: "ungraded", price_cents: 1000 },
  { title: "b", grade_label: "ungraded", price_cents: 2000 },
  { title: "c", grade_label: "ungraded", price_cents: 3000 },
];

describe("medianCents", () => {
  it("odd count → middle", () => expect(medianCents(comps)).toBe(2000));
  it("even count → mean of middle two", () => expect(medianCents(comps.slice(0, 2))).toBe(1500));
  it("ignores zero-priced comps; empty → 0", () => {
    expect(medianCents([{ title: "x", grade_label: "u", price_cents: 0 }])).toBe(0);
    expect(medianCents([])).toBe(0);
  });
});

describe("applyPricingPolicy", () => {
  it("applies comp percent + nearest_99 rounding", () => {
    // 90% of 2000 = 1800 → nearest_99 → 1799
    expect(applyPricingPolicy(comps, { compPercent: 90, floorCents: 0, roundingRule: "nearest_99" })).toBe(
      1799
    );
  });
  it("respects the floor", () => {
    expect(applyPricingPolicy([], { compPercent: 90, floorCents: 300, roundingRule: "none" })).toBe(300);
  });
  it("whole_dollar rounding", () => {
    expect(applyPricingPolicy(comps, { compPercent: 103, floorCents: 0, roundingRule: "whole_dollar" })).toBe(
      2100
    );
  });
});

describe("condition grade range (never numeric)", () => {
  it("accepts low <= high", () => {
    expect(validGradeRange("VG", "FN")).toBe(true);
    expect(validGradeRange("NM", "NM")).toBe(true);
  });
  it("rejects inverted range", () => {
    expect(validGradeRange("NM", "GD")).toBe(false);
  });
});
