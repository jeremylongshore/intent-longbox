// Pricing (R11/R12): pricing sources behind one PricingProvider seam
// (PriceCharting historical FMV + eBay live asks) + shop policy math (pure).
// Snapshots are immutable rows — one row per source per pricing call.

export interface Comp {
  title: string;
  grade_label: string;
  price_cents: number;
  source_id?: string;
}

// ---------------------------------------------------------------------------
// PricingProvider seam — every comps source (PriceCharting, eBay, future ones)
// implements this. Shop context is bound at construction (registry resolves
// per-shop creds); getComps also receives it for logging/telemetry.
// ---------------------------------------------------------------------------

export interface PricingQuery {
  title: string;
  issue?: string;
  variant?: string;
  grade?: string;
  upc?: string;
}

export interface PricingShopCtx {
  shopId: string;
}

export type PricingKind = "live_asks" | "historical_fmv";

export interface PricingSummary {
  low_cents: number;
  median_cents: number;
  high_cents: number;
  currency: string;
}

export interface PricingResult {
  source: string;
  kind: PricingKind;
  comps: Comp[];
  summary: PricingSummary;
  fetched_at: Date;
  /** true when no creds were configured and the source returned no live data. */
  stub: boolean;
}

export interface PricingProvider {
  source: string;
  kind: PricingKind;
  /** Throws on API/network failure — the multi-source service isolates it. */
  getComps(query: PricingQuery, shopCtx?: PricingShopCtx): Promise<PricingResult>;
}

/** Text query for comps APIs, built from the structured identification. */
export function buildCompsQueryString(q: PricingQuery): string {
  return [q.title, q.issue ? `#${q.issue}` : null, q.variant ?? null].filter(Boolean).join(" ");
}

/** low/median/high over positive-priced comps; zeros when there are none. */
export function summarizeComps(comps: Comp[]): PricingSummary {
  const vals = comps
    .map((c) => c.price_cents)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (vals.length === 0) return { low_cents: 0, median_cents: 0, high_cents: 0, currency: "USD" };
  return {
    low_cents: vals[0]!,
    median_cents: medianCents(comps),
    high_cents: vals[vals.length - 1]!,
    currency: "USD",
  };
}

export interface PriceChartingClient {
  /** Fetch comps for a query. Returns status instead of throwing on API errors. */
  fetchComps(
    query: string
  ): Promise<{ ok: true; comps: Comp[]; fetchedAt: Date } | { ok: false; status: number; error: string }>;
}

export interface PriceChartingConfig {
  token: string;
  baseUrl?: string;
}

/** Live client placeholder: wire the real endpoint when the Premium token exists. */
export function createPriceChartingClient(cfg: PriceChartingConfig): PriceChartingClient {
  const baseUrl = (cfg.baseUrl ?? "https://www.pricecharting.com").replace(/\/$/, "");
  return {
    async fetchComps(query: string) {
      let res: Response;
      try {
        res = await fetch(
          `${baseUrl}/api/products?t=${encodeURIComponent(cfg.token)}&q=${encodeURIComponent(query)}`
        );
      } catch (err) {
        return { ok: false as const, status: 0, error: `network error: ${(err as Error).message}` };
      }
      if (!res.ok) {
        return { ok: false as const, status: res.status, error: `pricecharting api error ${res.status}` };
      }
      const body = (await res.json().catch(() => ({}))) as { products?: Array<Record<string, unknown>> };
      // TODO(pricecharting): the Premium token doesn't exist yet — this mapping
      // follows the documented /api/products shape (loose-price = ungraded,
      // graded-price = graded). Re-verify field names against a live response
      // the day the token lands; the shape stays behind PriceChartingClient.
      const comps: Comp[] = [];
      for (const p of body.products ?? []) {
        const sourceId = p.id !== undefined ? { source_id: String(p.id) } : {};
        comps.push({
          title: String(p["product-name"] ?? ""),
          grade_label: "ungraded",
          price_cents: Number(p["loose-price"] ?? 0),
          ...sourceId,
        });
        const graded = Number(p["graded-price"] ?? 0);
        if (graded > 0) {
          comps.push({
            title: String(p["product-name"] ?? ""),
            grade_label: "graded",
            price_cents: graded,
            ...sourceId,
          });
        }
      }
      return { ok: true as const, comps, fetchedAt: new Date() };
    },
  };
}

/** Stub client used until the PriceCharting token exists: zero comps, clearly marked. */
export function createStubPriceChartingClient(): PriceChartingClient {
  return {
    async fetchComps(_query: string) {
      return { ok: true as const, comps: [], fetchedAt: new Date() };
    },
  };
}

/**
 * PriceCharting behind the PricingProvider seam: historical fair-market values.
 * No token → stub client → zero comps, clearly flagged (stub: true).
 */
export function createPriceChartingProvider(cfg: { token?: string; baseUrl?: string }): PricingProvider {
  const client = cfg.token
    ? createPriceChartingClient({ token: cfg.token, ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}) })
    : createStubPriceChartingClient();
  const stub = !cfg.token;
  return {
    source: "pricecharting",
    kind: "historical_fmv",
    async getComps(query: PricingQuery, _shopCtx?: PricingShopCtx): Promise<PricingResult> {
      const res = await client.fetchComps(buildCompsQueryString(query));
      if (!res.ok) throw new Error(`pricecharting: ${res.error} (status ${res.status})`);
      return {
        source: "pricecharting",
        kind: "historical_fmv",
        comps: res.comps,
        summary: summarizeComps(res.comps),
        fetched_at: res.fetchedAt,
        stub,
      };
    },
  };
}

export interface PricingPolicy {
  compPercent: number; // e.g. 90 = ask 90% of comp median
  floorCents: number;
  roundingRule: "none" | "whole_dollar" | "nearest_99";
}

export function medianCents(comps: Comp[]): number {
  const vals = comps
    .map((c) => c.price_cents)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (vals.length === 0) return 0;
  const mid = Math.floor(vals.length / 2);
  if (vals.length % 2 === 1) return vals[mid]!;
  return Math.round((vals[mid - 1]! + vals[mid]!) / 2);
}

/** Apply shop policy to comps → suggested asking price in cents. Pure. */
export function applyPricingPolicy(comps: Comp[], policy: PricingPolicy): number {
  const base = medianCents(comps);
  let cents = Math.round((base * policy.compPercent) / 100);
  cents = Math.max(cents, policy.floorCents);
  switch (policy.roundingRule) {
    case "whole_dollar":
      cents = Math.round(cents / 100) * 100;
      break;
    case "nearest_99": {
      const dollars = Math.max(Math.round((cents + 1) / 100), 1);
      cents = dollars * 100 - 1;
      break;
    }
    case "none":
      break;
  }
  return Math.max(cents, policy.floorCents);
}
