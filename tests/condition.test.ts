import { describe, expect, it } from "vitest";
import {
  DEFECT_OPTIONS,
  GRADE_LABELS,
  gradeIndex,
  gradeRangeLabel,
  validGradeRange,
} from "../src/services/condition.js";

describe("grade scale", () => {
  it("orders labels PR → NM", () => {
    expect(GRADE_LABELS).toEqual(["PR", "FR", "GD", "VG", "FN", "VF", "NM"]);
    expect(gradeIndex("PR")).toBe(0);
    expect(gradeIndex("NM")).toBe(6);
  });
});

describe("validGradeRange", () => {
  it("accepts low <= high", () => {
    expect(validGradeRange("FN", "VF")).toBe(true);
    expect(validGradeRange("NM", "NM")).toBe(true);
  });
  it("rejects low > high", () => {
    expect(validGradeRange("NM", "PR")).toBe(false);
    expect(validGradeRange("VF", "FN")).toBe(false);
  });
});

describe("gradeRangeLabel", () => {
  it("renders a single label when bounds match", () => {
    expect(gradeRangeLabel("VF", "VF")).toBe("VF");
  });
  it("renders a range when bounds differ — always a range, never a number", () => {
    expect(gradeRangeLabel("FN", "VF")).toBe("FN-VF");
    expect(gradeRangeLabel("FN", "VF")).not.toMatch(/\d/);
  });
});

describe("defect vocabulary", () => {
  it("carries the retail defect callouts (R10)", () => {
    expect(DEFECT_OPTIONS).toContain("spine_ticks");
    expect(DEFECT_OPTIONS).toContain("water_damage");
    expect(new Set(DEFECT_OPTIONS).size).toBe(DEFECT_OPTIONS.length);
  });
});
