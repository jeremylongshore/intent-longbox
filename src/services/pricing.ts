// Pricing (R11/R12): PriceCharting comps behind an interface (stub until the
// token exists) + shop policy math (pure). Snapshots are immutable rows.

export interface Comp {
  title: string;
  grade_label: string;
  price_cents: number;
  source_id?: string;
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
      const comps: Comp[] = (body.products ?? []).map((p) => ({
        title: String(p["product-name"] ?? ""),
        grade_label: "ungraded",
        price_cents: Number(p["loose-price"] ?? 0),
        ...(p.id !== undefined ? { source_id: String(p.id) } : {}),
      }));
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
