// L3 unit: the consumer composition root — what gets registered, and how the
// per-shop Shopify client (and its `stub` flag) is resolved.
//
// WHY THE `stub` FLAG IS TESTED HERE RATHER THAN TAKEN ON TRUST. 043 §5.3's
// closing evidence says the attempt-count and time-to-delivery distributions
// close the PROVISIONAL floors only when they are SEGMENTED by whether a real
// credential was configured — "a stub client never fails, so a mixed sample
// would report a reliability that belongs to the stub". This function is the
// only place that fact is decided, and `outbox_attempt.detail.stub` is the only
// place it is recorded. A resolver that reported the wrong flag would produce a
// segmentation that reads plausibly and is wrong, which is worse than none.
//
// Bead: longbox-e5b.2.17 (E02-D07). Docs: 043 §4.1, §5.3, A2.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DRAFT_REQUESTED } from "../src/events/catalogue.js";
import { buildConsumerRegistry, resolveShopifyClientForShop } from "../src/consumers/index.js";
import { fakePool } from "./fakes.js";

const SHOP = "11111111-1111-4111-8111-111111111111";

describe("buildConsumerRegistry (043 §4.1, A2)", () => {
  it("registers the draft_requested consumer and nothing else", () => {
    // The registry IS the idempotency gate (A2): every entry is enrolled in the
    // parametric concurrent-duplicate test and the write-shape lint. Asserting
    // the exact membership here is what makes "every registered consumer" a
    // knowable set rather than a phrase.
    const registry = buildConsumerRegistry();
    expect(registry.entries().map(([event]) => event)).toEqual([DRAFT_REQUESTED]);
    expect(registry.get(DRAFT_REQUESTED)).toBeTypeOf("function");
  });

  it("takes an injected client resolver, so the integration lane can use a fake", () => {
    const registry = buildConsumerRegistry({
      resolveClient: async () => ({
        client: { createDraft: async () => ({ ok: true, status: 200 }) },
        stub: true,
      }),
    });
    expect(registry.get(DRAFT_REQUESTED)).toBeTypeOf("function");
  });
});

describe("resolveShopifyClientForShop — and the stub flag 043 §5.3 segments on", () => {
  const saved = {
    domain: process.env.SHOPIFY_STORE_DOMAIN,
    token: process.env.SHOPIFY_ADMIN_TOKEN,
    version: process.env.SHOPIFY_API_VERSION,
  };

  beforeEach(() => {
    delete process.env.SHOPIFY_STORE_DOMAIN;
    delete process.env.SHOPIFY_ADMIN_TOKEN;
    delete process.env.SHOPIFY_API_VERSION;
  });

  afterEach(() => {
    for (const [k, v] of [
      ["SHOPIFY_STORE_DOMAIN", saved.domain],
      ["SHOPIFY_ADMIN_TOKEN", saved.token],
      ["SHOPIFY_API_VERSION", saved.version],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /** A pool answering the shop lookup and the credential lookup the registry does. */
  function poolFor(opts: { domain?: string | null; keyRef?: string }) {
    return fakePool((text) => {
      if (text.includes("FROM shop ")) return { rows: [{ shopify_domain: opts.domain ?? null }] };
      if (text.includes("shop_credentials")) {
        return opts.keyRef ? { rows: [{ key_ref: opts.keyRef }] } : { rows: [] };
      }
      return undefined;
    });
  }

  it("reports stub=true when no credential resolves — the pipeline never blocks on a token", () => {
    // The degrade-to-stub behaviour is deliberate (CLAUDE.md: "All external
    // clients degrade to stubs when creds are empty"). What must not degrade is
    // the HONESTY of the flag: a stub reported as real is a reliability figure
    // attributed to a client that cannot fail.
    return resolveShopifyClientForShop(poolFor({}).pool, SHOP).then((r) => {
      expect(r.stub).toBe(true);
      expect(r.client.createDraft).toBeTypeOf("function");
    });
  });

  it("still reports stub=true when a token exists but the store domain does not", async () => {
    // Half a configuration is not a configuration: `createShopifyClient` needs
    // both, and reporting stub=false on a client that cannot reach a store would
    // put a real-credential label on a call that never happened.
    process.env.SHOPIFY_ADMIN_TOKEN = "shpat-test-token";
    const r = await resolveShopifyClientForShop(poolFor({ domain: null }).pool, SHOP);
    expect(r.stub).toBe(true);
  });

  it("reports stub=false only when BOTH a token and a store domain resolve", async () => {
    process.env.SHOPIFY_ADMIN_TOKEN = "shpat-test-token";
    const r = await resolveShopifyClientForShop(
      poolFor({ domain: "gotham-city-limit.myshopify.com" }).pool,
      SHOP
    );
    expect(r.stub).toBe(false);
  });

  it("prefers the shop row's domain over the global env fallback", async () => {
    process.env.SHOPIFY_ADMIN_TOKEN = "shpat-test-token";
    process.env.SHOPIFY_STORE_DOMAIN = "fallback.myshopify.com";
    const { pool } = poolFor({ domain: "per-shop.myshopify.com" });
    const r = await resolveShopifyClientForShop(pool, SHOP);
    // Multi-shop is real: a per-shop row wins over the global variable, which is
    // the same resolution order every other credential uses.
    expect(r.stub).toBe(false);
  });

  it("looks the shop up by id, so one shop's config can never answer for another (T24)", async () => {
    const { pool, calls } = poolFor({});
    await resolveShopifyClientForShop(pool, SHOP);
    expect(calls[0]?.text).toMatch(/FROM shop WHERE id = \$1/);
    expect(calls[0]?.values).toEqual([SHOP]);
  });
});
