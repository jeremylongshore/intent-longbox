// Multi-source pricing (R11/R12): run every configured PricingProvider,
// isolate failures (Promise.allSettled — one bad source never blocks the
// other), write ONE immutable pricing_snapshot row PER source, and compute
// the suggested price from shop policy with a fixed precedence:
//   real historical FMV (PriceCharting) → else live-ask median (eBay) → else
//   empty comps (policy floor wins).
import type pg from "pg";
import {
  applyPricingPolicy,
  buildCompsQueryString,
  summarizeComps,
  type Comp,
  type PricingPolicy,
  type PricingProvider,
  type PricingQuery,
  type PricingResult,
} from "./pricing.js";

export interface SourceOutcome {
  source: string;
  kind: PricingResult["kind"];
  status: "ok" | "failed";
  stub: boolean;
  comps_count: number;
  summary: PricingResult["summary"];
  snapshot_id?: string;
  error?: string;
}

export interface MultiSourcePricing {
  sources: SourceOutcome[];
  suggested_cents: number;
  /** Which source's comps drove the suggestion; "policy_floor" when none had real comps. */
  driven_by: string;
  override_cents: number | null;
  snapshot_count: number;
}

/** Precedence: real historical FMV → real live asks → policy floor. */
export function pickDrivingResult(results: PricingResult[]): PricingResult | undefined {
  const real = (r: PricingResult) => !r.stub && r.comps.length > 0;
  return (
    results.find((r) => r.kind === "historical_fmv" && real(r)) ??
    results.find((r) => r.kind === "live_asks" && real(r)) ??
    results.find(real)
  );
}

export async function priceWithProviders(
  db: pg.Pool,
  args: {
    sessionId: string;
    shopId: string;
    providers: PricingProvider[];
    policy: PricingPolicy;
    policyId: string;
    query: PricingQuery;
    overrideCents?: number;
  }
): Promise<MultiSourcePricing> {
  const shopCtx = { shopId: args.shopId };
  const settled = await Promise.allSettled(args.providers.map((p) => p.getComps(args.query, shopCtx)));

  const fulfilled: PricingResult[] = [];
  const outcomes: SourceOutcome[] = [];
  settled.forEach((s, i) => {
    const provider = args.providers[i]!;
    if (s.status === "fulfilled") {
      fulfilled.push(s.value);
      outcomes.push({
        source: s.value.source,
        kind: s.value.kind,
        status: "ok",
        stub: s.value.stub,
        comps_count: s.value.comps.length,
        summary: s.value.summary,
      });
    } else {
      // Failed source: reported, never blocking; no snapshot row (nothing fetched).
      outcomes.push({
        source: provider.source,
        kind: provider.kind,
        status: "failed",
        stub: false,
        comps_count: 0,
        summary: summarizeComps([]),
        error: String((s.reason as Error)?.message ?? s.reason),
      });
    }
  });

  const driving = pickDrivingResult(fulfilled);
  const drivingComps: Comp[] = driving?.comps ?? [];
  const suggested = applyPricingPolicy(drivingComps, args.policy);
  const queryText = buildCompsQueryString(args.query);

  // One immutable snapshot row per fetched source. suggested_cents on every
  // row is the OVERALL policy-applied suggestion of this pricing event (the
  // per-source medians live in that row's comps) — so the draft step can read
  // any latest row and get the price of record.
  for (const result of fulfilled) {
    const res = await db.query(
      `INSERT INTO pricing_snapshot
         (scan_session_id, shop_id, source, query, comps, suggested_cents, override_cents, policy_id, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        args.sessionId,
        args.shopId,
        result.source,
        queryText,
        JSON.stringify(result.comps),
        suggested,
        args.overrideCents ?? null,
        args.policyId,
        result.fetched_at,
      ]
    );
    const outcome = outcomes.find((o) => o.source === result.source && o.status === "ok");
    if (outcome) outcome.snapshot_id = (res.rows[0] as { id: string }).id;
  }

  return {
    sources: outcomes,
    suggested_cents: suggested,
    driven_by: driving?.source ?? "policy_floor",
    override_cents: args.overrideCents ?? null,
    snapshot_count: fulfilled.length,
  };
}
