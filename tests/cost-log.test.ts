// Per-call cost logging (R13): the append writes the computed estimate.
import { describe, expect, it } from "vitest";
import { appendCostLog, deriveSpendOwner } from "../src/services/costLog.js";
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
    // `outbox_id` is null (043 §8.1): NULL means "spent by a REQUEST, not a job"
    // — ONE meaning, not two (030 A1). This call had no job, so the honest value
    // is null rather than a placeholder. `credential_version_id` is null for the
    // same kind of reason, and `spend_owner` is DERIVED from it: no live per-shop
    // credential version resolved this call, so Longbox's account paid.
    expect(calls[0]?.values).toEqual([
      "shop-1",
      "s-1",
      "anthropic",
      "claude-sonnet-5",
      1000,
      500,
      usd,
      null,
      null,
      "longbox",
    ]);
  });

  // -------------------------------------------------------------------------
  // E03-B05 (050 §9 I4/I5): every row carries an owner, and the owner is derived.
  // -------------------------------------------------------------------------

  it("I4/I5: a per-shop credential version makes the row `shop`-owned and names the version", async () => {
    const { pool, calls } = fakePool();
    await appendCostLog(pool, {
      shopId: "shop-1",
      scanSessionId: "s-1",
      provider: "anthropic",
      model: "claude-sonnet-5",
      tokensIn: 10,
      tokensOut: 5,
      credentialVersionId: "ver-7",
    });
    expect(calls[0]?.values?.[8]).toBe("ver-7");
    expect(calls[0]?.values?.[9]).toBe("shop");
  });

  it("I4: EVERY row carries a non-null spend_owner, including the session-less and job cases", async () => {
    for (const args of [
      { shopId: "shop-1", provider: "anthropic", model: "claude-sonnet-5", tokensIn: 1, tokensOut: 1 },
      {
        shopId: "shop-1",
        provider: "anthropic",
        model: "claude-sonnet-5",
        tokensIn: 1,
        tokensOut: 1,
        outboxId: "ob-1",
      },
    ]) {
      const { pool, calls } = fakePool();
      await appendCostLog(pool, args);
      expect(calls[0]?.values?.[9]).not.toBeNull();
      expect(["shop", "longbox"]).toContain(calls[0]?.values?.[9]);
    }
  });

  it("I5: the owner is DERIVED — the signature accepts no caller-supplied owner", async () => {
    // The negative half, and it is the one that matters (050 §6.2): a caller
    // that can pass an owner in is a caller that can attribute a Longbox call to
    // a shop, and 019 T13a and T15 are measured from this table. The rule is a
    // TYPE rule, so the assertion is that the extra property does not reach the
    // statement — a cast is the only way to attempt it at all.
    const { pool, calls } = fakePool();
    await appendCostLog(pool, {
      shopId: "shop-1",
      provider: "anthropic",
      model: "claude-sonnet-5",
      tokensIn: 1,
      tokensOut: 1,
      spend_owner: "shop",
      spendOwner: "shop",
    } as never);
    expect(calls[0]?.values?.[9]).toBe("longbox");
    expect(calls[0]?.text).not.toMatch(/\$11/);
  });

  it("derives both values and nothing else (050 §2 Q4(a): there is no `unknown`)", () => {
    expect(deriveSpendOwner(null)).toBe("longbox");
    expect(deriveSpendOwner("ver-1")).toBe("shop");
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
