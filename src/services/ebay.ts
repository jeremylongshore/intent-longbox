// eBay Browse adapter (R11 dual pricing): CURRENT ASKING prices, not sales.
// OAuth2 client-credentials app token, cached until expiry. No creds → stub
// provider (zero comps, stub: true) so the pipeline never blocks on eBay.
import {
  buildCompsQueryString,
  summarizeComps,
  type Comp,
  type PricingProvider,
  type PricingQuery,
  type PricingResult,
  type PricingShopCtx,
} from "./pricing.js";

export interface EbayConfig {
  clientId: string;
  clientSecret: string;
  /** API host; default production. Sandbox: https://api.sandbox.ebay.com */
  baseUrl?: string;
  /** Browse category filter; default 259104 = Comics & Graphic Novels. */
  categoryId?: string;
  marketplaceId?: string;
  /** Max item summaries per search (Browse cap is 200). */
  limit?: number;
}

const OAUTH_SCOPE = "https://api.ebay.com/oauth/api_scope";
/** Refresh this many ms before the token actually expires. */
const TOKEN_SAFETY_MS = 60_000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number; // seconds
}

interface ItemSummary {
  itemId?: string;
  title?: string;
  price?: { value?: string; currency?: string };
}

/** Build the Browse search URL (exported for tests — query building is load-bearing). */
export function buildEbaySearchUrl(
  baseUrl: string,
  query: PricingQuery,
  categoryId: string,
  limit: number
): string {
  const params = new URLSearchParams({
    q: buildCompsQueryString(query),
    category_ids: categoryId,
    limit: String(limit),
  });
  return `${baseUrl}/buy/browse/v1/item_summary/search?${params.toString()}`;
}

/** Live eBay Browse provider. Throws on token/API/network failure. */
export function createEbayProvider(cfg: EbayConfig): PricingProvider {
  const baseUrl = (cfg.baseUrl ?? "https://api.ebay.com").replace(/\/$/, "");
  const categoryId = cfg.categoryId ?? "259104";
  const marketplaceId = cfg.marketplaceId ?? "EBAY_US";
  const limit = cfg.limit ?? 50;

  // App-token cache: one token per provider instance, reused until near expiry.
  let cached: { token: string; expiresAt: number } | undefined;

  async function getAppToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt - TOKEN_SAFETY_MS) return cached.token;
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    const res = await fetch(`${baseUrl}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `grant_type=client_credentials&scope=${encodeURIComponent(OAUTH_SCOPE)}`,
    });
    if (!res.ok) throw new Error(`ebay oauth error ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!body.access_token) throw new Error("ebay oauth response missing access_token");
    cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 0) * 1000 };
    return cached.token;
  }

  return {
    source: "ebay",
    kind: "live_asks",
    async getComps(query: PricingQuery, _shopCtx?: PricingShopCtx): Promise<PricingResult> {
      const token = await getAppToken();
      const res = await fetch(buildEbaySearchUrl(baseUrl, query, categoryId, limit), {
        headers: {
          authorization: `Bearer ${token}`,
          "x-ebay-c-marketplace-id": marketplaceId,
        },
      });
      if (!res.ok) throw new Error(`ebay browse api error ${res.status}`);
      const body = (await res.json().catch(() => ({}))) as { itemSummaries?: ItemSummary[] };
      const comps: Comp[] = (body.itemSummaries ?? [])
        .filter((i) => i.price?.value !== undefined)
        .map((i) => ({
          title: String(i.title ?? ""),
          grade_label: "live_ask",
          price_cents: Math.round(Number(i.price!.value) * 100),
          ...(i.itemId !== undefined ? { source_id: String(i.itemId) } : {}),
        }));
      return {
        source: "ebay",
        kind: "live_asks",
        comps,
        summary: summarizeComps(comps),
        fetched_at: new Date(),
        stub: false,
      };
    },
  };
}

/** Stub used when EBAY_CLIENT_ID/EBAY_CLIENT_SECRET aren't configured. */
export function createStubEbayProvider(): PricingProvider {
  return {
    source: "ebay",
    kind: "live_asks",
    async getComps(_query: PricingQuery, _shopCtx?: PricingShopCtx): Promise<PricingResult> {
      return {
        source: "ebay",
        kind: "live_asks",
        comps: [],
        summary: summarizeComps([]),
        fetched_at: new Date(),
        stub: true,
      };
    },
  };
}
