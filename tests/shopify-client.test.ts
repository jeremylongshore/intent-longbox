// Shopify Admin GraphQL client transport (R14) — stubbed fetch; the pure
// productSet builder lives in tests/shopify.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShopifyClient, createStubShopifyClient } from "../src/services/shopify.js";
import { fakeResponse } from "./fakes.js";

const cfg = {
  storeDomain: "gotham-city-limit.myshopify.com",
  adminToken: "shpat-test",
  apiVersion: "2025-07",
};
const input = {
  title: "Amazing Spider-Man #300",
  descriptionHtml: "<p>Marvel, 1988</p>",
  priceCents: 12999,
  imageUrls: ["/uploads/s/cover.jpg"],
  // 043 §4.3: the upsert key is required, so a call cannot silently create a
  // second product on retry. Today it is the scan_session_id (a forward-
  // compatible stand-in for physical_item_id — see the field's doc comment).
  copyKey: "1f0d1c1c-0000-4000-8000-000000000001",
};

afterEach(() => vi.unstubAllGlobals());

describe("createShopifyClient", () => {
  it("posts the productSet mutation with the access token and returns the GID", async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) =>
      fakeResponse(200, {
        data: { productSet: { product: { id: "gid://shopify/Product/123" }, userErrors: [] } },
      })
    );
    vi.stubGlobal("fetch", spy);
    const result = await createShopifyClient(cfg).createDraft(input);
    expect(result).toEqual({ ok: true, status: 200, productGid: "gid://shopify/Product/123" });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://gotham-city-limit.myshopify.com/admin/api/2025-07/graphql.json");
    expect((init?.headers as Record<string, string>)["x-shopify-access-token"]).toBe("shpat-test");
    const body = JSON.parse(init?.body as string);
    expect(body.variables.input.status).toBe("DRAFT"); // locked decision: nothing publishes itself
    expect(body.variables.input.variants[0].price).toBe("129.99");
  });

  it("fails on userErrors even with HTTP 200", async () => {
    vi.stubGlobal("fetch", async () =>
      fakeResponse(200, {
        data: { productSet: { userErrors: [{ message: "title taken" }] } },
      })
    );
    const result = await createShopifyClient(cfg).createDraft(input);
    expect(result.ok).toBe(false);
    expect(result.error).toEqual([{ message: "title taken" }]);
  });

  it("fails when no product GID comes back", async () => {
    vi.stubGlobal("fetch", async () => fakeResponse(200, { data: { productSet: {} } }));
    const result = await createShopifyClient(cfg).createDraft(input);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no product GID returned");
  });

  it("returns status on HTTP errors and 0 on network failure — never throws", async () => {
    vi.stubGlobal("fetch", async () => fakeResponse(429, {}));
    expect(await createShopifyClient(cfg).createDraft(input)).toMatchObject({ ok: false, status: 429 });

    vi.stubGlobal("fetch", async () => {
      throw new Error("tls error");
    });
    expect(await createShopifyClient(cfg).createDraft(input)).toMatchObject({ ok: false, status: 0 });
  });
});

describe("createStubShopifyClient", () => {
  it("succeeds with a clearly-fake GID (used until store creds exist)", async () => {
    const result = await createStubShopifyClient().createDraft(input);
    expect(result.ok).toBe(true);
    expect(result.productGid).toMatch(/^gid:\/\/shopify\/Product\/stub-/);
  });
});
