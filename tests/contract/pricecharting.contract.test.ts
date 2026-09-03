// Contract: PriceCharting /api/products (R11/R12 — historical FMV side of the
// dual pricing seam). L4 recorded-fixture contract: exact request shape
// (endpoint, token query-param name, no auth header) and field mapping /
// missing-field tolerance from a recorded-shape products response. Stub
// behaviour + graded mapping already live in tests/pricing-provider.test.ts.
// Injected fetch only — no network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPriceChartingClient, createPriceChartingProvider } from "../../src/services/pricing.js";
import { fakeResponse } from "../fakes.js";

afterEach(() => vi.unstubAllGlobals());

// Recorded-shape fixture (PriceCharting /api/products, prices in cents).
const RECORDED_PRODUCTS = {
  status: "success",
  products: [
    {
      id: "6910432",
      "product-name": "Uncanny X-Men #266",
      "console-name": "Marvel Comics",
      "loose-price": 8500,
      "graded-price": 45000,
      "box-only-price": 0,
      "new-price": 0,
      "release-date": "1990-08-01",
      genre: "Superhero",
      upc: "071486024293",
    },
    {
      id: "6910433",
      "product-name": "Uncanny X-Men #266 [Newsstand]",
      "console-name": "Marvel Comics",
      "loose-price": 12000,
      "graded-price": 62500,
    },
  ],
};

function recordFetch(body: unknown, status = 200) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => fakeResponse(status, body));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("PriceCharting /api/products — request contract", () => {
  it("GETs /api/products with the token in the `t` query param and the search in `q`", async () => {
    const spy = recordFetch(RECORDED_PRODUCTS);
    await createPriceChartingClient({ token: "pc_prem_9d8f7e6c" }).fetchComps("Uncanny X-Men #266");
    const [url, init] = spy.mock.calls[0]!;
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://www.pricecharting.com/api/products");
    expect([...parsed.searchParams.entries()]).toEqual([
      ["t", "pc_prem_9d8f7e6c"],
      ["q", "Uncanny X-Men #266"],
    ]);
    expect(init).toBeUndefined(); // bare GET: no headers, no body, no bearer
  });

  it("sends the structured query as `Title #issue Variant` through the provider seam", async () => {
    const spy = recordFetch(RECORDED_PRODUCTS);
    const provider = createPriceChartingProvider({ token: "pc_prem_9d8f7e6c" });
    await provider.getComps({
      title: "Uncanny X-Men",
      issue: "266",
      variant: "Newsstand",
      grade: "VF",
      upc: "071486024293",
    });
    expect(new URL(spy.mock.calls[0]![0]).searchParams.get("q")).toBe("Uncanny X-Men #266 Newsstand");
  });

  it("never puts the token in a header", async () => {
    const spy = recordFetch(RECORDED_PRODUCTS);
    await createPriceChartingClient({ token: "pc_prem_9d8f7e6c" }).fetchComps("Bone #1");
    expect(spy.mock.calls[0]![1]).toBeUndefined();
  });
});

describe("PriceCharting /api/products — recorded response mapping", () => {
  it("maps loose-price → ungraded and graded-price → graded, one pair per product, extra fields ignored", async () => {
    recordFetch(RECORDED_PRODUCTS);
    const result = await createPriceChartingClient({ token: "pc_prem_9d8f7e6c" }).fetchComps(
      "Uncanny X-Men #266"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comps).toEqual([
      { title: "Uncanny X-Men #266", grade_label: "ungraded", price_cents: 8500, source_id: "6910432" },
      { title: "Uncanny X-Men #266", grade_label: "graded", price_cents: 45000, source_id: "6910432" },
      {
        title: "Uncanny X-Men #266 [Newsstand]",
        grade_label: "ungraded",
        price_cents: 12000,
        source_id: "6910433",
      },
      {
        title: "Uncanny X-Men #266 [Newsstand]",
        grade_label: "graded",
        price_cents: 62500,
        source_id: "6910433",
      },
    ]);
  });

  it("labels the provider result historical_fmv with stub false and a summary over all four comps", async () => {
    recordFetch(RECORDED_PRODUCTS);
    const result = await createPriceChartingProvider({ token: "pc_prem_9d8f7e6c" }).getComps({
      title: "Uncanny X-Men",
      issue: "266",
    });
    expect(result.source).toBe("pricecharting");
    expect(result.kind).toBe("historical_fmv");
    expect(result.stub).toBe(false);
    expect(result.summary).toEqual({
      low_cents: 8500,
      median_cents: 28500,
      high_cents: 62500,
      currency: "USD",
    });
  });

  it("tolerates a product with no id, no graded-price and no loose-price", async () => {
    recordFetch({ status: "success", products: [{ "product-name": "Bone #1 [Ashcan]" }] });
    const result = await createPriceChartingClient({ token: "pc_prem_9d8f7e6c" }).fetchComps(
      "Bone #1 Ashcan"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comps).toEqual([{ title: "Bone #1 [Ashcan]", grade_label: "ungraded", price_cents: 0 }]);
    expect(result.comps[0]).not.toHaveProperty("source_id");
  });

  it("emits no graded comp when graded-price is 0", async () => {
    recordFetch({
      products: [{ id: 77, "product-name": "Sandman #8", "loose-price": 2500, "graded-price": 0 }],
    });
    const result = await createPriceChartingClient({ token: "pc_prem_9d8f7e6c" }).fetchComps("Sandman #8");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.comps).toEqual([
      { title: "Sandman #8", grade_label: "ungraded", price_cents: 2500, source_id: "77" },
    ]);
  });

  it("treats a success envelope with no products key as zero comps", async () => {
    recordFetch({ status: "success" });
    const result = await createPriceChartingClient({ token: "pc_prem_9d8f7e6c" }).fetchComps(
      "Nothing Matches #0"
    );
    expect(result).toMatchObject({ ok: true, comps: [] });
  });

  it("treats an unparseable 200 body as zero comps rather than a throw", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    const result = await createPriceChartingClient({ token: "pc_prem_9d8f7e6c" }).fetchComps("Bone #1");
    expect(result).toMatchObject({ ok: true, comps: [] });
  });
});
