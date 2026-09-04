// Contract: eBay OAuth2 client-credentials + Browse item_summary/search
// (R11 — dual pricing, live asks side). L4 recorded-fixture contract: exact
// token request, token cache timing against the 60s safety margin, exact
// Browse request, and Comp mapping from a recorded itemSummaries shape.
// Injected fetch only — no network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEbayProvider } from "../../src/services/ebay.js";
import { fakeResponse } from "../fakes.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const TOKEN_PATH = /\/identity\/v1\/oauth2\/token$/;
const CREDS = {
  clientId: "test-ebay-client-id-token",
  clientSecret: "test-ebay-client-secret",
};

// Recorded-shape fixtures (eBay Browse API v1, marketplace EBAY_US).
const RECORDED_TOKEN = {
  access_token: "v^1.1#i^1#f^0#p^1#r^0#I^3#t^H4sIAAAA",
  expires_in: 7200,
  token_type: "Application Access Token",
};

const RECORDED_SEARCH = {
  href: "https://api.ebay.com/buy/browse/v1/item_summary/search?q=Uncanny%20X-Men%20%23266&limit=50",
  total: 3,
  limit: 50,
  offset: 0,
  itemSummaries: [
    {
      itemId: "v1|256789012345|0",
      title: "Uncanny X-Men #266 Newsstand 1st Gambit Marvel 1990 VF/NM",
      price: { value: "185.00", currency: "USD" },
      condition: "Very Good",
      itemWebUrl: "https://www.ebay.com/itm/256789012345",
      buyingOptions: ["FIXED_PRICE"],
      itemLocation: { country: "US", postalCode: "303**" },
    },
    {
      itemId: "v1|187654321098|0",
      title: "Uncanny X-Men 266 newsstand variant (1990) reader copy",
      price: { value: "42.5", currency: "USD" },
      condition: "Acceptable",
      itemWebUrl: "https://www.ebay.com/itm/187654321098",
      buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
    },
    {
      itemId: "v1|112233445566|0",
      title: "Uncanny X-Men #266 CGC 9.6 Newsstand",
      price: { value: "699.99", currency: "USD" },
      itemWebUrl: "https://www.ebay.com/itm/112233445566",
    },
  ],
};

function recordFetch(opts: { token?: unknown; search?: unknown } = {}) {
  const spy = vi.fn(async (url: string | URL, _init?: RequestInit) =>
    TOKEN_PATH.test(String(url))
      ? fakeResponse(200, opts.token ?? RECORDED_TOKEN)
      : fakeResponse(200, opts.search ?? RECORDED_SEARCH)
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function tokenCalls(spy: ReturnType<typeof recordFetch>) {
  return spy.mock.calls.filter((c) => TOKEN_PATH.test(String(c[0])));
}

describe("eBay OAuth client-credentials — request contract", () => {
  it("POSTs Basic(clientId:secret) with the exact form body grant_type + api_scope", async () => {
    const spy = recordFetch();
    await createEbayProvider(CREDS).getComps({ title: "Uncanny X-Men", issue: "266" });
    const [url, init] = spy.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      authorization:
        "Basic " + Buffer.from("test-ebay-client-id-token:test-ebay-client-secret").toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(init.body).toBe(
      "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope"
    );
  });

  it("targets the sandbox token endpoint when baseUrl is the sandbox host (trailing slash stripped)", async () => {
    const spy = recordFetch();
    await createEbayProvider({ ...CREDS, baseUrl: "https://api.sandbox.ebay.com/" }).getComps({
      title: "Bone",
    });
    expect(spy.mock.calls[0]![0]).toBe("https://api.sandbox.ebay.com/identity/v1/oauth2/token");
    expect(String(spy.mock.calls[1]![0]).startsWith("https://api.sandbox.ebay.com/buy/browse/v1/")).toBe(
      true
    );
  });

  it("rejects a token response that lacks access_token without calling Browse", async () => {
    const spy = recordFetch({ token: { token_type: "Application Access Token", expires_in: 7200 } });
    await expect(createEbayProvider(CREDS).getComps({ title: "Bone" })).rejects.toThrow(
      "ebay oauth response missing access_token"
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("eBay OAuth client-credentials — token cache timing", () => {
  it("reuses the token inside expires_in minus the 60s safety margin", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T14:00:00Z"));
    const spy = recordFetch();
    const provider = createEbayProvider(CREDS);
    await provider.getComps({ title: "Uncanny X-Men", issue: "266" });
    vi.setSystemTime(new Date("2026-09-02T15:58:59Z")); // 7139s later: 1s inside the margin
    await provider.getComps({ title: "Uncanny X-Men", issue: "267" });
    expect(tokenCalls(spy)).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(3); // token, browse, browse
    const [, browseInit] = spy.mock.calls[2]! as unknown as [string, RequestInit];
    expect((browseInit.headers as Record<string, string>).authorization).toBe(
      "Bearer v^1.1#i^1#f^0#p^1#r^0#I^3#t^H4sIAAAA"
    );
  });

  it("re-fetches the token once the clock crosses expires_in minus 60s", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T14:00:00Z"));
    let issued = 0;
    const spy = vi.fn(async (url: string | URL) => {
      if (TOKEN_PATH.test(String(url))) {
        issued += 1;
        return fakeResponse(200, { ...RECORDED_TOKEN, access_token: `tok-${issued}` });
      }
      return fakeResponse(200, RECORDED_SEARCH);
    });
    vi.stubGlobal("fetch", spy);
    const provider = createEbayProvider(CREDS);
    await provider.getComps({ title: "Uncanny X-Men", issue: "266" });
    vi.setSystemTime(new Date("2026-09-02T15:59:00Z")); // exactly 7140s: margin reached
    await provider.getComps({ title: "Uncanny X-Men", issue: "267" });
    expect(tokenCalls(spy)).toHaveLength(2);
    const [, secondBrowse] = spy.mock.calls[3]! as unknown as [string, RequestInit];
    expect((secondBrowse.headers as Record<string, string>).authorization).toBe("Bearer tok-2");
  });
});

describe("eBay Browse item_summary/search — request contract", () => {
  it("GETs with q from title/#issue/variant, default category 259104, default limit 50, Bearer + EBAY_US", async () => {
    const spy = recordFetch();
    await createEbayProvider(CREDS).getComps({
      title: "Uncanny X-Men",
      issue: "266",
      variant: "Newsstand",
      grade: "VF",
      upc: "071486024293",
    });
    const [url, init] = spy.mock.calls[1]! as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://api.ebay.com/buy/browse/v1/item_summary/search");
    expect([...parsed.searchParams.entries()]).toEqual([
      ["q", "Uncanny X-Men #266 Newsstand"],
      ["category_ids", "259104"],
      ["limit", "50"],
    ]);
    expect(init.method).toBeUndefined(); // fetch default: GET
    expect(init.headers).toEqual({
      authorization: "Bearer v^1.1#i^1#f^0#p^1#r^0#I^3#t^H4sIAAAA",
      "x-ebay-c-marketplace-id": "EBAY_US",
    });
    expect(init.body).toBeUndefined();
  });

  it("honors configured categoryId, limit and marketplaceId verbatim", async () => {
    const spy = recordFetch();
    await createEbayProvider({ ...CREDS, categoryId: "63", limit: 200, marketplaceId: "EBAY_GB" }).getComps({
      title: "2000 AD",
      issue: "1",
    });
    const [url, init] = spy.mock.calls[1]! as [string, RequestInit];
    const params = new URL(url).searchParams;
    expect(params.get("category_ids")).toBe("63");
    expect(params.get("limit")).toBe("200");
    expect((init.headers as Record<string, string>)["x-ebay-c-marketplace-id"]).toBe("EBAY_GB");
  });
});

describe("eBay Browse item_summary/search — recorded response mapping", () => {
  it("maps each priced summary to a live_ask Comp with cents and itemId as source_id", async () => {
    recordFetch();
    const result = await createEbayProvider(CREDS).getComps({ title: "Uncanny X-Men", issue: "266" });
    expect(result.source).toBe("ebay");
    expect(result.kind).toBe("live_asks");
    expect(result.stub).toBe(false);
    expect(result.comps).toEqual([
      {
        title: "Uncanny X-Men #266 Newsstand 1st Gambit Marvel 1990 VF/NM",
        grade_label: "live_ask",
        price_cents: 18500,
        source_id: "v1|256789012345|0",
      },
      {
        title: "Uncanny X-Men 266 newsstand variant (1990) reader copy",
        grade_label: "live_ask",
        price_cents: 4250,
        source_id: "v1|187654321098|0",
      },
      {
        title: "Uncanny X-Men #266 CGC 9.6 Newsstand",
        grade_label: "live_ask",
        price_cents: 69999,
        source_id: "v1|112233445566|0",
      },
    ]);
    expect(result.summary).toEqual({
      low_cents: 4250,
      median_cents: 18500,
      high_cents: 69999,
      currency: "USD",
    });
  });

  it("returns zero comps (not an error) when the recorded empty-result envelope has no itemSummaries key", async () => {
    recordFetch({
      search: {
        href: "https://api.ebay.com/buy/browse/v1/item_summary/search?q=x",
        total: 0,
        limit: 50,
        offset: 0,
      },
    });
    const result = await createEbayProvider(CREDS).getComps({ title: "Nonexistent Comic", issue: "999" });
    expect(result.comps).toEqual([]);
    expect(result.summary).toEqual({ low_cents: 0, median_cents: 0, high_cents: 0, currency: "USD" });
    expect(result.stub).toBe(false);
  });

  it("rounds fractional-cent price strings to whole cents", async () => {
    recordFetch({
      search: {
        itemSummaries: [
          { itemId: "v1|1|0", title: "Sandman #8", price: { value: "12.345", currency: "USD" } },
        ],
      },
    });
    const result = await createEbayProvider(CREDS).getComps({ title: "Sandman", issue: "8" });
    expect(result.comps[0]!.price_cents).toBe(1235);
  });
});
