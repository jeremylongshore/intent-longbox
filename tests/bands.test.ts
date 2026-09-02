import { describe, expect, it } from "vitest";
import { applyContradiction, assignBand } from "../src/services/bands.js";

const t = { high: 0.85, medium: 0.5 };

describe("assignBand", () => {
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

describe("applyContradiction", () => {
  it("downgrades high to medium on contradiction (forces human review)", () => {
    expect(applyContradiction("high", true)).toBe("medium");
  });
  it("leaves medium/low as-is on contradiction", () => {
    expect(applyContradiction("medium", true)).toBe("medium");
    expect(applyContradiction("low", true)).toBe("low");
  });
  it("no-op without contradiction", () => {
    expect(applyContradiction("high", false)).toBe("high");
  });
});
