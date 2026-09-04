// Per-call cost logging (R13): the append writes the computed estimate.
import { describe, expect, it } from "vitest";
import { appendCostLog } from "../src/services/costLog.js";
import { estimateUsd, PRICE_TABLE_PER_MTOK } from "../src/config.js";
import { fakePool } from "./fakes.js";

describe("estimateUsd", () => {
  it("prices claude-sonnet-5 from the pinned table", () => {
    expect(PRICE_TABLE_PER_MTOK["claude-sonnet-5"]).toEqual({ in: 3, out: 15 });
    expect(estimateUsd("claude-sonnet-5", 1_000_000, 1_000_000)).toBe(18);
    expect(estimateUsd("gpt-4o", 1_000_000, 0)).toBe(2.5);
  });
  it("returns 0 for unknown models rather than guessing", () => {
    expect(estimateUsd("some-unknown-model", 5000, 5000)).toBe(0);
  });
});

describe("appendCostLog", () => {
  it("inserts a cost_log row with the computed USD and returns it", async () => {
    const { pool, calls } = fakePool();
    const usd = await appendCostLog(pool, {
      shopId: "shop-1",
      scanSessionId: "s-1",
      provider: "anthropic",
      model: "claude-sonnet-5",
      tokensIn: 1000,
      tokensOut: 500,
    });
    expect(usd).toBeCloseTo(0.0105, 10);
    expect(calls[0]?.text).toMatch(/INSERT INTO cost_log/);
    // The trailing null is `outbox_id` (043 §8.1): NULL means "spent by a
    // REQUEST, not a job" — ONE meaning, not two (030 A1). This call had no job,
    // so the honest value is null rather than a placeholder.
    expect(calls[0]?.values).toEqual(["shop-1", "s-1", "anthropic", "claude-sonnet-5", 1000, 500, usd, null]);
  });

  it("carries the job reference when a JOB spent the money, and never invents one", async () => {
    const { pool, calls } = fakePool();
    await appendCostLog(pool, {
      shopId: "shop-1",
      provider: "anthropic",
      model: "claude-sonnet-5",
      tokensIn: 10,
      tokensOut: 5,
      outboxId: "ob-1",
    });
    expect(calls[0]?.values?.[7]).toBe("ob-1");
  });

  it("logs session-less calls with a null scan_session_id", async () => {
    const { pool, calls } = fakePool();
    await appendCostLog(pool, {
      shopId: "shop-1",
      provider: "openai-compat",
      model: "gpt-4o",
      tokensIn: 10,
      tokensOut: 10,
    });
    expect(calls[0]?.values?.[1]).toBeNull();
  });
});
