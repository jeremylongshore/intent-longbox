import { describe, expect, it } from "vitest";
import type { Tx } from "../src/db.js";
import {
  DEFECT_OPTIONS,
  GRADE_LABELS,
  gradeIndex,
  gradeRangeLabel,
  insertConditionAssessment,
  readCurrentConditionAssessment,
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

// The condition module's two persistence halves (E02-D09; 029 §5 move 2 moved the
// INSERT out of the route). The statements are asserted rather than the database:
// what the route can get wrong is WHICH relation it reads and whether it names its
// columns, and both are visible in the text. The behaviour against a real cluster
// is `tests/integration/supersession-forward-ordering.test.ts`.
describe("the condition module's reads and writes", () => {
  function fakeTx(rows: unknown[] = []): {
    tx: Tx;
    calls: Array<{ text: string; values: unknown[] | undefined }>;
  } {
    const calls: Array<{ text: string; values: unknown[] | undefined }> = [];
    const tx = {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, values });
        return { rows };
      },
    };
    return { tx: tx as unknown as Tx, calls };
  }

  // 041 §3.4: "every read that drives a decision goes through `_current`". This
  // read decides whether the incoming call is a correction, so reading the raw
  // table would pick a superseded row as the predecessor.
  it("reads the CURRENT assessment from the view, scoped by shop (T24)", async () => {
    const { tx, calls } = fakeTx([{ id: "a1" }]);
    const row = await readCurrentConditionAssessment(tx, "shop-1", "session-1");
    expect(row).toEqual({ id: "a1" });
    expect(calls[0]!.text).toContain("FROM condition_assessment_current");
    expect(calls[0]!.text).not.toMatch(/FROM condition_assessment\s/);
    expect(calls[0]!.text).toContain("shop_id = $2");
    expect(calls[0]!.values).toEqual(["session-1", "shop-1"]);
  });

  it("returns undefined when the session has no assessment yet", async () => {
    const { tx } = fakeTx([]);
    await expect(readCurrentConditionAssessment(tx, "shop-1", "session-1")).resolves.toBeUndefined();
  });

  // The first append carries no `supersedes_id`, and cannot: a correction is the
  // single writer's (041 §3.3), which `pnpm arch` rule 6 asserts.
  it("appends a first assessment with its session_seq and no supersedes_id", async () => {
    const { tx, calls } = fakeTx([{ id: "a1", created_at: "t", session_seq: "1" }]);
    await insertConditionAssessment(tx, {
      sessionId: "session-1",
      shopId: "shop-1",
      gradeRangeLow: "VG",
      gradeRangeHigh: "FN",
      defects: ["spine_ticks"],
      notes: null,
      sessionSeq: 1,
      // E02-D11: no reference sent, so both causal columns take NULL (042 §6.5).
      against: null,
    });
    expect(calls[0]!.text).toContain("INSERT INTO condition_assessment");
    expect(calls[0]!.text).not.toContain("supersedes_id");
    // The last value is `operator_id`, NULL here because this call passes none —
    // 048 §6.3 stamps it from the session and never from a body, and
    // `actor_verified` is derived from it IN THE STATEMENT so the pair cannot
    // disagree.
    // …and the two AFTER it are 041 §3.5's causal reference, NULL together
    // because this call carries none (E02-D11; `029`'s whole-or-absent CHECK
    // makes half of one impossible).
    expect(calls[0]!.values).toEqual([
      "session-1",
      "shop-1",
      "VG",
      "FN",
      ["spine_ticks"],
      null,
      1,
      null,
      null,
      null,
    ]);
    expect(calls[0]!.text).toContain("actor_verified");
  });
});
