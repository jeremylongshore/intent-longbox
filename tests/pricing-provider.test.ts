// PriceCharting behind the PricingProvider seam (R11): historical FMV kind,
// ungraded + graded mapping, stub flagging, query building, summary math.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCompsQueryString,
  createPriceChartingProvider,
  summarizeComps,
  type Comp,
} from "../src/services/pricing.js";
import { fakeResponse } from "./fakes.js";

afterEach(() => vi.unstubAllGlobals());

describe("createPriceChartingProvider", () => {
  it("maps ungraded + graded values into comps, kind historical_fmv", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(200, {
          products: [
            { "product-name": "ASM #300", "loose-price": 10000, "graded-price": 40000, id: 7 },
            { "product-name": "ASM #301", "loose-price": 2500 },
          ],
        })
      )
    );
    const provider = createPriceChartingProvider({ token: "t" });
    const result = await provider.getComps({ title: "Amazing Spider-Man", issue: "300" });
    expect(result.source).toBe("pricecharting");
    expect(result.kind).toBe("historical_fmv");
    expect(result.stub).toBe(false);
    expect(result.comps).toEqual([
      { title: "ASM #300", grade_label: "ungraded", price_cents: 10000, source_id: "7" },
      { title: "ASM #300", grade_label: "graded", price_cents: 40000, source_id: "7" },
      { title: "ASM #301", grade_label: "ungraded", price_cents: 2500 },
    ]);
    expect(result.summary.median_cents).toBe(10000);
  });

  it("builds the text query from title/issue/variant", async () => {
    const spy = vi.fn(async (_url: string) => fakeResponse(200, { products: [] }));
    vi.stubGlobal("fetch", spy);
    await createPriceChartingProvider({ token: "t" }).getComps({
      title: "Saga",
      issue: "1",
      variant: "second print",
    });
    expect(String(spy.mock.calls[0]![0])).toContain(encodeURIComponent("Saga #1 second print"));
  });

  it("throws on API errors so the multi-source service can isolate the failure", async () => {
    vi.stubGlobal("fetch", async () => fakeResponse(500, {}));
    await expect(createPriceChartingProvider({ token: "t" }).getComps({ title: "q" })).rejects.toThrow(
      /pricecharting/
    );
  });

  it("no token → stub: zero comps, stub: true, no network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await createPriceChartingProvider({}).getComps({ title: "anything" });
    expect(result).toMatchObject({ source: "pricecharting", kind: "historical_fmv", stub: true, comps: [] });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("buildCompsQueryString", () => {
  it("joins title, #issue, variant; skips absent parts", () => {
    expect(buildCompsQueryString({ title: "Bone", issue: "3", variant: "b&w" })).toBe("Bone #3 b&w");
    expect(buildCompsQueryString({ title: "Bone" })).toBe("Bone");
  });
});

describe("summarizeComps", () => {
  const comps: Comp[] = [
    { title: "a", grade_label: "u", price_cents: 3000 },
    { title: "b", grade_label: "u", price_cents: 1000 },
    { title: "c", grade_label: "u", price_cents: 2000 },
    { title: "zero ignored", grade_label: "u", price_cents: 0 },
  ];
  it("low/median/high over positive comps", () => {
    expect(summarizeComps(comps)).toEqual({
      low_cents: 1000,
      median_cents: 2000,
      high_cents: 3000,
      currency: "USD",
    });
  });
  it("zeros when empty", () => {
    expect(summarizeComps([])).toEqual({ low_cents: 0, median_cents: 0, high_cents: 0, currency: "USD" });
  });
});
