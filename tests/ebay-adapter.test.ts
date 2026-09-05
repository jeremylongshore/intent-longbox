// eBay Browse adapter (R11 dual pricing) — stubbed fetch: OAuth token flow +
// caching, query building, comp mapping/summary math, stub flagging.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEbaySearchUrl, createEbayProvider, createStubEbayProvider } from "../src/services/ebay.js";
import { fakeResponse } from "./fakes.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const TOKEN_URL = /\/identity\/v1\/oauth2\/token$/;

function stubEbayFetch(opts?: { expiresIn?: number; items?: unknown[] }) {
  let tokenCalls = 0;
  const spy = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (TOKEN_URL.test(String(url))) {
      tokenCalls += 1;
      return fakeResponse(200, { access_token: `tok${tokenCalls}`, expires_in: opts?.expiresIn ?? 7200 });
    }
    void init;
    return fakeResponse(200, { itemSummaries: opts?.items ?? [] });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("createEbayProvider — OAuth2 client-credentials flow", () => {
  it("requests an app token with Basic auth + form body, then calls Browse with Bearer", async () => {
    const spy = stubEbayFetch({
      items: [{ itemId: "v1|123|0", title: "ASM #300 NM", price: { value: "129.99", currency: "USD" } }],
    });
    const provider = createEbayProvider({ clientId: "cid", clientSecret: "csec" });
    const result = await provider.getComps({ title: "Amazing Spider-Man", issue: "300" });

    const [tokenUrl, tokenInit] = spy.mock.calls[0]! as [string, RequestInit];
    expect(tokenUrl).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    const headers = tokenInit.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Basic ${Buffer.from("cid:csec").toString("base64")}`);
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(String(tokenInit.body)).toContain("grant_type=client_credentials");
    expect(String(tokenInit.body)).toContain(encodeURIComponent("https://api.ebay.com/oauth/api_scope"));

    const [browseUrl, browseInit] = spy.mock.calls[1]! as [string, RequestInit];
    expect(browseUrl).toContain("/buy/browse/v1/item_summary/search?");
    const browseHeaders = browseInit.headers as Record<string, string>;
    expect(browseHeaders["authorization"]).toBe("Bearer tok1");
    expect(browseHeaders["x-ebay-c-marketplace-id"]).toBe("EBAY_US");

    expect(result.kind).toBe("live_asks");
    expect(result.source).toBe("ebay");
    expect(result.stub).toBe(false);
    expect(result.comps).toEqual([
      { title: "ASM #300 NM", grade_label: "live_ask", price_cents: 12999, source_id: "v1|123|0" },
    ]);
  });

  it("caches the app token across calls until expiry", async () => {
    const spy = stubEbayFetch();
    const provider = createEbayProvider({ clientId: "cid", clientSecret: "csec" });
    await provider.getComps({ title: "X-Men", issue: "1" });
    await provider.getComps({ title: "X-Men", issue: "2" });
    const tokenFetches = spy.mock.calls.filter((c) => TOKEN_URL.test(String(c[0])));
    expect(tokenFetches).toHaveLength(1);
  });

  it("refreshes the token when it is at/near expiry", async () => {
    const spy = stubEbayFetch({ expiresIn: 0 }); // expires immediately → safety margin trips
    const provider = createEbayProvider({ clientId: "cid", clientSecret: "csec" });
    await provider.getComps({ title: "X-Men", issue: "1" });
    await provider.getComps({ title: "X-Men", issue: "2" });
    const tokenFetches = spy.mock.calls.filter((c) => TOKEN_URL.test(String(c[0])));
    expect(tokenFetches).toHaveLength(2);
  });

  it("throws on oauth and Browse API errors (isolated by the multi-source service)", async () => {
    vi.stubGlobal("fetch", async () => fakeResponse(401, {}));
    const provider = createEbayProvider({ clientId: "cid", clientSecret: "bad" });
    await expect(provider.getComps({ title: "q" })).rejects.toThrow(/ebay oauth error 401/);

    let call = 0;
    vi.stubGlobal("fetch", async () =>
      call++ === 0 ? fakeResponse(200, { access_token: "t", expires_in: 7200 }) : fakeResponse(500, {})
    );
    const p2 = createEbayProvider({ clientId: "cid", clientSecret: "csec" });
    await expect(p2.getComps({ title: "q" })).rejects.toThrow(/ebay browse api error 500/);
  });
});

describe("buildEbaySearchUrl — query building", () => {
  it("builds q from title + #issue + variant with category and limit", () => {
    const url = buildEbaySearchUrl(
      "https://api.ebay.com",
      { title: "Amazing Spider-Man", issue: "300", variant: "newsstand" },
      "259104",
      50
    );
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/buy/browse/v1/item_summary/search");
    expect(parsed.searchParams.get("q")).toBe("Amazing Spider-Man #300 newsstand");
    expect(parsed.searchParams.get("category_ids")).toBe("259104");
    expect(parsed.searchParams.get("limit")).toBe("50");
  });

  it("omits issue/variant when absent", () => {
    const url = buildEbaySearchUrl("https://api.ebay.com", { title: "Bone" }, "259104", 50);
    expect(new URL(url).searchParams.get("q")).toBe("Bone");
  });
});

describe("summary math + stub flagging", () => {
  it("computes low/median/high over live asks", async () => {
    stubEbayFetch({
      items: [
        { itemId: "1", title: "a", price: { value: "10.00", currency: "USD" } },
        { itemId: "2", title: "b", price: { value: "30.00", currency: "USD" } },
        { itemId: "3", title: "c", price: { value: "20.00", currency: "USD" } },
        { itemId: "4", title: "no price" },
      ],
    });
    const provider = createEbayProvider({ clientId: "cid", clientSecret: "csec" });
    const result = await provider.getComps({ title: "q" });
    expect(result.comps).toHaveLength(3); // priceless item dropped
    expect(result.summary).toEqual({
      low_cents: 1000,
      median_cents: 2000,
      high_cents: 3000,
      currency: "USD",
    });
    expect(result.fetched_at).toBeInstanceOf(Date);
  });

  it("stub provider returns zero comps flagged stub: true and never touches the network", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await createStubEbayProvider().getComps({ title: "anything" });
    expect(result).toMatchObject({ source: "ebay", kind: "live_asks", stub: true, comps: [] });
    expect(spy).not.toHaveBeenCalled();
  });
});
