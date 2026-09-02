// PriceCharting client transport (R11) — stubbed fetch; the policy math lives
// in tests/pricing.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPriceChartingClient, createStubPriceChartingClient } from "../src/services/pricing.js";
import { fakeResponse } from "./fakes.js";

afterEach(() => vi.unstubAllGlobals());

describe("createPriceChartingClient", () => {
  it("maps products to comps and URL-encodes token + query", async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
      fakeResponse(200, {
        products: [
          { "product-name": "Amazing Spider-Man #300", "loose-price": 12999, id: 42 },
          { "product-name": "No price listed" },
        ],
      })
    );
    vi.stubGlobal("fetch", spy);
    const client = createPriceChartingClient({ token: "t&k" });
    const result = await client.fetchComps("asm #300");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.comps).toEqual([
        { title: "Amazing Spider-Man #300", grade_label: "ungraded", price_cents: 12999, source_id: "42" },
        { title: "No price listed", grade_label: "ungraded", price_cents: 0 },
      ]);
      expect(result.fetchedAt).toBeInstanceOf(Date);
    }
    expect(spy.mock.calls[0]![0]).toBe("https://www.pricecharting.com/api/products?t=t%26k&q=asm%20%23300");
  });

  it("returns status on API errors and 0 on network failure — never throws", async () => {
    vi.stubGlobal("fetch", async () => fakeResponse(403, {}));
    const client = createPriceChartingClient({ token: "t" });
    expect(await client.fetchComps("q")).toMatchObject({ ok: false, status: 403 });

    vi.stubGlobal("fetch", async () => {
      throw new Error("dns failure");
    });
    expect(await client.fetchComps("q")).toMatchObject({ ok: false, status: 0 });
  });

  it("respects a custom baseUrl", async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => fakeResponse(200, { products: [] }));
    vi.stubGlobal("fetch", spy);
    await createPriceChartingClient({ token: "t", baseUrl: "https://pc.example.com/" }).fetchComps("q");
    expect(String(spy.mock.calls[0]![0])).toMatch(/^https:\/\/pc\.example\.com\/api\/products/);
  });
});

describe("createStubPriceChartingClient", () => {
  it("returns zero comps successfully (used until the Premium token exists)", async () => {
    const result = await createStubPriceChartingClient().fetchComps("anything");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.comps).toEqual([]);
  });
});
