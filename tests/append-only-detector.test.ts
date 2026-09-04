// L3: the append-only-trigger bypass detector's CLASSIFICATION, against a fake
// pool. The live-database half is tests/integration/migrations.test.ts; this file
// pins the decisions the detector makes about a given pg_trigger snapshot, which is
// where the bug being fixed lived — the old assertion could not tell an enabled
// trigger from a disabled one. E02-D05, 041 §9.2.
import { describe, expect, it, vi } from "vitest";
import { APPEND_ONLY_EXEMPTIONS, APPEND_ONLY_TABLES } from "../src/db/appendOnlyTables.js";
import {
  APPEND_ONLY_CHECK_INTERVAL_MS,
  assertAppendOnlyTriggersOrThrow,
  checkAppendOnlyTriggers,
  describeAppendOnlyFailure,
  scheduleAppendOnlyCheck,
  type QueryablePool,
} from "../src/services/appendOnlyDetector.js";

interface Row {
  table_name: string;
  trigger_name: string;
  tgenabled: string;
}

/** Every declared trigger, all ENABLE ALWAYS — what a healthy database returns. */
function healthyRows(): Row[] {
  return APPEND_ONLY_TABLES.map((t) => ({
    table_name: t.table,
    trigger_name: t.trigger,
    tgenabled: "A",
  }));
}

function fakePool(rows: Row[]): QueryablePool {
  return { query: () => Promise.resolve({ rows }) };
}

const silent = { error: () => undefined, info: () => undefined };

// The list is a declaration, so the declaration itself gets assertions. These would
// have caught the drift 041 §9.2 item 4 describes — five spellings that disagreed —
// at the moment a row was added, rather than at the next integration run.
describe("the declared list", () => {
  // 041 §2.5: `observed_at` may order a derivation ONLY inside an external-observation
  // table. Exactly one table qualifies today, and it is the one that already does it
  // (005:94-95, listingStatus.ts:141). A second flag arriving without a record is the
  // failure this pins.
  it("flags exactly one table as external-observation, and it is listing_status_observation", () => {
    const flagged = APPEND_ONLY_TABLES.filter((t) => t.ordersByObservedAt).map((t) => t.table);
    expect(flagged).toEqual(["listing_status_observation"]);
  });

  it("gives every table one trigger named after it, and no duplicates", () => {
    for (const t of APPEND_ONLY_TABLES) expect(t.trigger).toBe(`${t.table}_append_only`);
    expect(new Set(APPEND_ONLY_TABLES.map((t) => t.table)).size).toBe(APPEND_ONLY_TABLES.length);
  });

  // Exemptions are decisions, so each carries a reason someone can argue with, and a
  // table is never both governed and exempt.
  it("gives every exemption a reason and never exempts a governed table", () => {
    const governed = new Set(APPEND_ONLY_TABLES.map((t) => t.table));
    for (const ex of APPEND_ONLY_EXEMPTIONS) {
      expect(ex.reason.length).toBeGreaterThan(40);
      expect(governed.has(ex.table)).toBe(false);
    }
  });

  // 041 §9.2 item 4's two not-yet-built exemptions are pending; nothing else is.
  it("marks exactly the unbuilt tables pending", () => {
    const pending = APPEND_ONLY_EXEMPTIONS.filter((e) => e.pending)
      .map((e) => e.table)
      .sort();
    expect(pending).toEqual(["physical_item_active_listing", "request_idempotency"]);
  });
});

describe("checkAppendOnlyTriggers", () => {
  it("reports ok when every declared trigger is present at tgenabled='A'", async () => {
    const result = await checkAppendOnlyTriggers(fakePool(healthyRows()));
    expect(result).toEqual({ ok: true, missing: [], disabled: [], undeclared: [] });
  });

  it("classifies a trigger left at the bypassable 'O' default as disabled, not missing", async () => {
    const rows = healthyRows();
    const target = rows.find((r) => r.table_name === "pricing_snapshot");
    target!.tgenabled = "O";

    const result = await checkAppendOnlyTriggers(fakePool(rows));
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.disabled).toEqual([
      { table: "pricing_snapshot", trigger: "pricing_snapshot_append_only", tgenabled: "O" },
    ]);
  });

  it("classifies an explicitly disabled ('D') trigger as disabled", async () => {
    const rows = healthyRows().map((r) => (r.table_name === "cost_log" ? { ...r, tgenabled: "D" } : r));
    const result = await checkAppendOnlyTriggers(fakePool(rows));
    expect(result.disabled).toEqual([{ table: "cost_log", trigger: "cost_log_append_only", tgenabled: "D" }]);
  });

  it("classifies a dropped trigger as missing", async () => {
    const rows = healthyRows().filter((r) => r.table_name !== "human_confirmation");
    const result = await checkAppendOnlyTriggers(fakePool(rows));
    expect(result.ok).toBe(false);
    expect(result.disabled).toEqual([]);
    expect(result.missing).toEqual([
      { table: "human_confirmation", trigger: "human_confirmation_append_only" },
    ]);
  });

  // Equality in BOTH directions (041 §9.2 item 4): a trigger nothing declares is a
  // migration that added an append-only table without adding it to the list, so
  // nothing would have noticed it being created at the bypassable default.
  it("flags an undeclared %_append_only trigger even when it is ENABLE ALWAYS", async () => {
    const rows = [
      ...healthyRows(),
      { table_name: "lcid_registry", trigger_name: "lcid_registry_append_only", tgenabled: "A" },
    ];
    const result = await checkAppendOnlyTriggers(fakePool(rows));
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.disabled).toEqual([]);
    expect(result.undeclared).toEqual([{ table: "lcid_registry", trigger: "lcid_registry_append_only" }]);
  });

  it("reports all three classes at once rather than short-circuiting on the first", async () => {
    const rows = healthyRows()
      .filter((r) => r.table_name !== "scan_photo")
      .map((r) => (r.table_name === "llm_rerank" ? { ...r, tgenabled: "O" } : r));
    rows.push({ table_name: "probe", trigger_name: "probe_append_only", tgenabled: "A" });

    const result = await checkAppendOnlyTriggers(fakePool(rows));
    expect(result.missing).toHaveLength(1);
    expect(result.disabled).toHaveLength(1);
    expect(result.undeclared).toHaveLength(1);
    const described = describeAppendOnlyFailure(result);
    expect(described).toContain("scan_photo_append_only");
    expect(described).toContain("llm_rerank_append_only=O");
    expect(described).toContain("probe_append_only");
  });
});

describe("assertAppendOnlyTriggersOrThrow", () => {
  it("resolves on a healthy database", async () => {
    await expect(assertAppendOnlyTriggersOrThrow(fakePool(healthyRows()), silent)).resolves.toBeUndefined();
  });

  // Fail CLOSED: the process must refuse to serve, and the message must name the
  // trigger, because "the server would not start" is useless without which one.
  it("throws a message naming the failing trigger when the guarantee is off", async () => {
    const rows = healthyRows().map((r) =>
      r.table_name === "condition_assessment" ? { ...r, tgenabled: "D" } : r
    );
    await expect(assertAppendOnlyTriggersOrThrow(fakePool(rows), silent)).rejects.toThrow(
      /refusing to serve.*condition_assessment_append_only=D/s
    );
  });

  it("logs at error level before it throws", async () => {
    const logger = { error: vi.fn(), info: vi.fn() };
    const rows = healthyRows().slice(1);
    await expect(assertAppendOnlyTriggersOrThrow(fakePool(rows), logger)).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]![0]).toContain("FAILED at boot");
  });
});

describe("scheduleAppendOnlyCheck", () => {
  it("re-checks on the declared five-minute interval and logs a failure without throwing", async () => {
    vi.useFakeTimers();
    try {
      const logger = { error: vi.fn(), info: vi.fn() };
      const rows = healthyRows().map((r) =>
        r.table_name === "shopify_draft" ? { ...r, tgenabled: "O" } : r
      );
      const stop = scheduleAppendOnlyCheck(fakePool(rows), logger);

      expect(logger.error).not.toHaveBeenCalled(); // does not fire immediately
      await vi.advanceTimersByTimeAsync(APPEND_ONLY_CHECK_INTERVAL_MS);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0]![0]).toContain("shopify_draft_append_only=O");

      stop();
      await vi.advanceTimersByTimeAsync(APPEND_ONLY_CHECK_INTERVAL_MS * 3);
      expect(logger.error).toHaveBeenCalledTimes(1); // stopped means stopped
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs, and does not reject, when the query itself fails", async () => {
    vi.useFakeTimers();
    try {
      const logger = { error: vi.fn(), info: vi.fn() };
      const broken: QueryablePool = { query: () => Promise.reject(new Error("connection lost")) };
      const stop = scheduleAppendOnlyCheck(broken, logger);
      await vi.advanceTimersByTimeAsync(APPEND_ONLY_CHECK_INTERVAL_MS);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0]![0]).toContain("connection lost");
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet while the guarantee holds", async () => {
    vi.useFakeTimers();
    try {
      const logger = { error: vi.fn(), info: vi.fn() };
      const stop = scheduleAppendOnlyCheck(fakePool(healthyRows()), logger);
      await vi.advanceTimersByTimeAsync(APPEND_ONLY_CHECK_INTERVAL_MS * 4);
      expect(logger.error).not.toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
