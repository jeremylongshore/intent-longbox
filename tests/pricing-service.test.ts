// Multi-source pricing service (R11/R12): snapshot-per-source, failure
// isolation (one source failing/stub never blocks the other), and suggested
// price precedence — historical FMV when real, else live-ask median, else
// the policy floor.
import { describe, expect, it } from "vitest";
import type { PricingPolicy, PricingProvider, PricingResult } from "../src/services/pricing.js";
import { summarizeComps } from "../src/services/pricing.js";
import { pickDrivingResult, priceWithProviders } from "../src/services/pricingService.js";
import { fakePool } from "./fakes.js";

const policy: PricingPolicy = { compPercent: 90, floorCents: 300, roundingRule: "none" };

function result(
  source: string,
  kind: PricingResult["kind"],
  priceCents: number[],
  stub = false
): PricingResult {
  const comps = priceCents.map((p, i) => ({ title: `${source}-${i}`, grade_label: "u", price_cents: p }));
  return { source, kind, comps, summary: summarizeComps(comps), fetched_at: new Date("2026-09-01"), stub };
}

function provider(r: PricingResult): PricingProvider {
  return { source: r.source, kind: r.kind, getComps: async () => r };
}

function failingProvider(source: string, kind: PricingResult["kind"]): PricingProvider {
  return {
    source,
    kind,
    getComps: async () => {
      throw new Error(`${source} exploded`);
    },
  };
}

function snapshotPool() {
  let n = 0;
  return fakePool((text) =>
    text.includes("INSERT INTO pricing_snapshot") ? { rows: [{ id: `snap-${++n}` }] } : undefined
  );
}

const baseArgs = { sessionId: "sess-1", shopId: "shop-1", policyId: "pol-1", policy };

describe("priceWithProviders — snapshot per source", () => {
  it("writes one pricing_snapshot row PER fetched source, same overall suggested on each", async () => {
    const { pool, calls } = snapshotPool();
    const out = await priceWithProviders(pool, {
      ...baseArgs,
      providers: [
        provider(result("pricecharting", "historical_fmv", [1000, 2000, 3000])),
        provider(result("ebay", "live_asks", [5000, 7000])),
      ],
      query: { title: "ASM", issue: "300" },
    });
    const inserts = calls.filter((c) => c.text.includes("INSERT INTO pricing_snapshot"));
    expect(inserts).toHaveLength(2);
    expect(inserts.map((c) => c.values![2])).toEqual(["pricecharting", "ebay"]);
    // Historical FMV (median 2000) drives: 90% of 2000 = 1800, on BOTH rows.
    expect(inserts.map((c) => c.values![5])).toEqual([1800, 1800]);
    expect(inserts.map((c) => c.values![3])).toEqual(["ASM #300", "ASM #300"]);
    expect(out.suggested_cents).toBe(1800);
    expect(out.driven_by).toBe("pricecharting");
    expect(out.snapshot_count).toBe(2);
    expect(out.sources.map((s) => s.snapshot_id)).toEqual(["snap-1", "snap-2"]);
  });

  it("stores the employee override on every row of the pricing event", async () => {
    const { pool, calls } = snapshotPool();
    await priceWithProviders(pool, {
      ...baseArgs,
      providers: [
        provider(result("pricecharting", "historical_fmv", [1000])),
        provider(result("ebay", "live_asks", [2000])),
      ],
      query: { title: "ASM" },
      overrideCents: 4200,
    });
    const inserts = calls.filter((c) => c.text.includes("INSERT INTO pricing_snapshot"));
    expect(inserts.map((c) => c.values![6])).toEqual([4200, 4200]);
  });
});

describe("priceWithProviders — failure isolation", () => {
  it("one source failing never blocks the other; failure is reported, not snapshotted", async () => {
    const { pool, calls } = snapshotPool();
    const out = await priceWithProviders(pool, {
      ...baseArgs,
      providers: [
        failingProvider("pricecharting", "historical_fmv"),
        provider(result("ebay", "live_asks", [2000])),
      ],
      query: { title: "ASM" },
    });
    const inserts = calls.filter((c) => c.text.includes("INSERT INTO pricing_snapshot"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.values![2]).toBe("ebay");
    const failed = out.sources.find((s) => s.source === "pricecharting")!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/exploded/);
    const ok = out.sources.find((s) => s.source === "ebay")!;
    expect(ok.status).toBe("ok");
    expect(ok.snapshot_id).toBe("snap-1");
    // Live asks drive since historical failed: 90% of 2000 = 1800.
    expect(out.suggested_cents).toBe(1800);
    expect(out.driven_by).toBe("ebay");
  });

  it("stub sources are snapshotted (comps: []) and flagged, and never drive the price", async () => {
    const { pool, calls } = snapshotPool();
    const out = await priceWithProviders(pool, {
      ...baseArgs,
      providers: [
        provider(result("pricecharting", "historical_fmv", [], true)),
        provider(result("ebay", "live_asks", [2000])),
      ],
      query: { title: "ASM" },
    });
    expect(calls.filter((c) => c.text.includes("INSERT INTO pricing_snapshot"))).toHaveLength(2);
    expect(out.sources.find((s) => s.source === "pricecharting")!.stub).toBe(true);
    expect(out.driven_by).toBe("ebay");
    expect(out.suggested_cents).toBe(1800);
  });

  it("all sources stub → policy floor wins, driven_by policy_floor", async () => {
    const { pool } = snapshotPool();
    const out = await priceWithProviders(pool, {
      ...baseArgs,
      providers: [
        provider(result("pricecharting", "historical_fmv", [], true)),
        provider(result("ebay", "live_asks", [], true)),
      ],
      query: { title: "ASM" },
    });
    expect(out.suggested_cents).toBe(300); // floorCents
    expect(out.driven_by).toBe("policy_floor");
    expect(out.snapshot_count).toBe(2);
  });
});

describe("pickDrivingResult — policy application precedence", () => {
  it("prefers real historical FMV over real live asks", () => {
    const pc = result("pricecharting", "historical_fmv", [1000]);
    const ebay = result("ebay", "live_asks", [9000]);
    expect(pickDrivingResult([ebay, pc])).toBe(pc);
  });
  it("falls to live asks when historical is stub or empty", () => {
    const pcStub = result("pricecharting", "historical_fmv", [], true);
    const pcEmpty = result("pricecharting", "historical_fmv", []);
    const ebay = result("ebay", "live_asks", [9000]);
    expect(pickDrivingResult([pcStub, ebay])).toBe(ebay);
    expect(pickDrivingResult([pcEmpty, ebay])).toBe(ebay);
  });
  it("undefined when nothing real", () => {
    expect(pickDrivingResult([result("ebay", "live_asks", [], true)])).toBeUndefined();
    expect(pickDrivingResult([])).toBeUndefined();
  });
});
