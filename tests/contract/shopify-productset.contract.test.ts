// Contract: Shopify Admin GraphQL productSet (R14 — draft via productSet with
// status DRAFT; GID + status stored). L4 recorded-fixture contract: the exact
// request the client emits and how recorded-shape responses parse. Injected
// fetch only — no network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShopifyClient, type DraftProductInput } from "../../src/services/shopify.js";
import { fakeResponse } from "../fakes.js";

afterEach(() => vi.unstubAllGlobals());

const cfg = {
  storeDomain: "gotham-city-limit.myshopify.com",
  adminToken: "test-shopify-admin-token",
  apiVersion: "2026-01",
};

// A DELIBERATELY LOW-ENTROPY fixture id, matching the style of every other
// fixture UUID in the suite. The first version of this line was a
// realistic-looking random UUID and gitleaks' `generic-api-key` rule flagged
// it (entropy 3.99) — correctly, in the sense that a scanner cannot tell a
// copy key from a credential by looking. The fix is the fixture, not the
// scanner: `.gitleaks.toml`'s allowlist is deliberately narrow ("fixture
// values are always prefixed test- so a real key can never hide behind
// this"), and widening it to admit arbitrary high-entropy strings in tests
// would buy one green check at the cost of the property that makes the
// allowlist safe. A fixture that cannot be mistaken for a secret is also a
// fixture no reader has to ask about.
const COPY_KEY = "9b1c2d3e-0000-4000-8000-000000000266";

const draft: DraftProductInput = {
  title: "Uncanny X-Men #266 Newsstand",
  descriptionHtml: "<p>Marvel, 1990</p><p>Condition: FN-VF. Noted: spine ticks</p>",
  priceCents: 4750,
  imageUrls: ["/uploads/9b1c/1725292800000-cover.jpg", "/uploads/9b1c/1725292805000-cover.png"],
  copyKey: COPY_KEY,
};

// Recorded-shape fixtures (Shopify Admin GraphQL 2026-01 response envelope).
const RECORDED_SUCCESS = {
  data: {
    productSet: {
      product: { id: "gid://shopify/Product/8827491467401", status: "DRAFT" },
      userErrors: [],
    },
  },
  extensions: {
    cost: {
      requestedQueryCost: 10,
      actualQueryCost: 10,
      throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 1990, restoreRate: 100 },
    },
  },
};

const RECORDED_USER_ERRORS = {
  data: {
    productSet: {
      product: null,
      userErrors: [{ field: ["input", "title"], message: "Title can't be blank" }],
    },
  },
  extensions: { cost: { requestedQueryCost: 10, actualQueryCost: 10 } },
};

const RECORDED_THROTTLED = {
  data: null,
  errors: [
    {
      message: "Throttled",
      extensions: {
        code: "THROTTLED",
        documentation: "https://shopify.dev/api/usage/rate-limits",
      },
    },
  ],
};

function captureFetch(body: unknown, status = 200) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => fakeResponse(status, body));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function sentRequest(spy: ReturnType<typeof captureFetch>) {
  const [url, init] = spy.mock.calls[0]! as [string, RequestInit];
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as {
      query: string;
      variables: { identifier: Record<string, unknown>; input: Record<string, unknown> };
    },
  };
}

describe("Shopify productSet — outgoing request contract", () => {
  it("POSTs JSON to /admin/api/<SHOPIFY_API_VERSION>/graphql.json on the store domain", async () => {
    const spy = captureFetch(RECORDED_SUCCESS);
    await createShopifyClient(cfg).createDraft(draft);
    const { url, init, headers } = sentRequest(spy);
    expect(url).toBe("https://gotham-city-limit.myshopify.com/admin/api/2026-01/graphql.json");
    expect(init.method).toBe("POST");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("authenticates with the X-Shopify-Access-Token header and no Authorization header", async () => {
    const spy = captureFetch(RECORDED_SUCCESS);
    await createShopifyClient(cfg).createDraft(draft);
    const { headers } = sentRequest(spy);
    expect(headers["x-shopify-access-token"]).toBe("test-shopify-admin-token");
    expect(Object.keys(headers).sort()).toEqual(["content-type", "x-shopify-access-token"]);
  });

  it("sends the productSet mutation selecting product{id status} and userErrors{field message}", async () => {
    const spy = captureFetch(RECORDED_SUCCESS);
    await createShopifyClient(cfg).createDraft(draft);
    const { body } = sentRequest(spy);
    expect(
      body.query.startsWith(
        "mutation productSet($identifier: ProductSetIdentifiers, $input: ProductSetInput!)"
      )
    ).toBe(true);
    expect(body.query).toContain("productSet(identifier: $identifier, input: $input)");
    expect(body.query).toContain("product { id status }");
    expect(body.query).toContain("userErrors { field message }");
    expect(Object.keys(body)).toEqual(["query", "variables"]);
  });

  // 043 §4.3 / §11 I7. Shopify's Admin GraphQL API provides NO idempotency-key
  // mechanism for productSet — the mutation takes `identifier`, `input` and
  // `synchronous`, and nothing else. What it offers instead is an UPSERT on a
  // caller-chosen key, which is a stronger guarantee than a retry token because
  // it survives a RESTORE as well as a retry (043 §8.2: 24 h RPO, no PITR).
  it("carries the Longbox-owned customId identifier, so a retry upserts instead of duplicating", async () => {
    const spy = captureFetch(RECORDED_SUCCESS);
    await createShopifyClient(cfg).createDraft(draft);
    const { body } = sentRequest(spy);
    expect(body.variables.identifier).toEqual({
      customId: { namespace: "longbox", key: "copy", value: COPY_KEY },
    });
  });

  it("sends exactly the ProductSetInput fields the code sets, with status DRAFT", async () => {
    const spy = captureFetch(RECORDED_SUCCESS);
    await createShopifyClient(cfg).createDraft(draft);
    const { body } = sentRequest(spy);
    expect(body.variables).toEqual({
      identifier: { customId: { namespace: "longbox", key: "copy", value: COPY_KEY } },
      input: {
        title: "Uncanny X-Men #266 Newsstand",
        descriptionHtml: "<p>Marvel, 1990</p><p>Condition: FN-VF. Noted: spine ticks</p>",
        status: "DRAFT",
        productType: "Comic Book",
        variants: [{ price: "47.50", optionValues: [{ optionName: "Title", name: "Default" }] }],
        productOptions: [{ name: "Title", values: [{ name: "Default" }] }],
        files: [
          { originalSource: "/uploads/9b1c/1725292800000-cover.jpg", contentType: "IMAGE" },
          { originalSource: "/uploads/9b1c/1725292805000-cover.png", contentType: "IMAGE" },
        ],
      },
    });
  });

  it("keeps status DRAFT with no images and a sub-dollar price", async () => {
    const spy = captureFetch(RECORDED_SUCCESS);
    await createShopifyClient(cfg).createDraft({
      title: "Bone #1",
      descriptionHtml: "<p></p>",
      priceCents: 5,
      imageUrls: [],
      copyKey: COPY_KEY,
    });
    const { body } = sentRequest(spy);
    expect(body.variables.input["status"]).toBe("DRAFT");
    expect(body.variables.input["files"]).toEqual([]);
    expect(body.variables.input["variants"]).toEqual([
      { price: "0.05", optionValues: [{ optionName: "Title", name: "Default" }] },
    ]);
  });

  it("never sends status ACTIVE or a publish field on any path", async () => {
    const spy = captureFetch(RECORDED_USER_ERRORS);
    await createShopifyClient(cfg).createDraft(draft);
    const { body } = sentRequest(spy);
    expect(body.variables.input["status"]).toBe("DRAFT");
    expect(body.variables.input).not.toHaveProperty("publishedAt");
    expect(body.variables.input).not.toHaveProperty("publications");
    expect(body.query).not.toContain("publishablePublish");
  });
});

describe("Shopify productSet — recorded response parsing", () => {
  it("parses the recorded success envelope into ok + product GID (extensions ignored)", async () => {
    captureFetch(RECORDED_SUCCESS);
    const result = await createShopifyClient(cfg).createDraft(draft);
    expect(result).toEqual({ ok: true, status: 200, productGid: "gid://shopify/Product/8827491467401" });
  });

  it("surfaces userErrors verbatim (field + message) and reports no GID on HTTP 200", async () => {
    captureFetch(RECORDED_USER_ERRORS);
    const result = await createShopifyClient(cfg).createDraft(draft);
    expect(result).toEqual({
      ok: false,
      status: 200,
      error: [{ field: ["input", "title"], message: "Title can't be blank" }],
      // 043 §5.2: a userErrors entry will fail identically forever, so it is
      // dead-lettered on the first attempt with no backoff. The classification
      // already lived in this client; E02-D07 gives it a consequence.
      permanent: true,
    });
    expect(result).not.toHaveProperty("productGid");
  });

  it("surfaces top-level GraphQL errors (THROTTLED, data null) as a failure carrying the errors array", async () => {
    captureFetch(RECORDED_THROTTLED);
    const result = await createShopifyClient(cfg).createDraft(draft);
    expect(result).toEqual({ ok: false, status: 200, error: RECORDED_THROTTLED.errors });
  });

  it("treats HTTP 401 with a JSON body as a failure carrying that body, not the userErrors path", async () => {
    captureFetch(
      { errors: "[API] Invalid API key or access token (unrecognized login or wrong password)" },
      401
    );
    const result = await createShopifyClient(cfg).createDraft(draft);
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: { errors: "[API] Invalid API key or access token (unrecognized login or wrong password)" },
    });
  });
});
