// Multi-source pricing (R11/R12): run every configured PricingProvider,
// isolate failures (Promise.allSettled — one bad source never blocks the
// other), write ONE immutable pricing_snapshot row PER source, and compute
// the suggested price from shop policy with a fixed precedence:
//   real historical FMV (PriceCharting) → else live-ask median (eBay) → else
//   empty comps (policy floor wins).
import type { Queryable } from "../db.js";
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

export interface PricingArgs {
  sessionId: string;
  shopId: string;
  providers: PricingProvider[];
  policy: PricingPolicy;
  policyId: string;
  query: PricingQuery;
  overrideCents?: number;
}

/**
 * Everything the provider fan-out decides, before anything is written.
 *
 * SPLIT FROM THE WRITE BY E02-D08, for the reason 041 §4.1 gives and 042 §5
 * needs: the snapshot rows must commit in the same transaction as the request's
 * `request_idempotency` row, and an HTTP call to eBay must not be inside that
 * transaction — a retried attempt would re-fetch, and a held connection would
 * wait on somebody else's server.
 */
export interface PricingPlan {
  fulfilled: PricingResult[];
  outcomes: SourceOutcome[];
  suggested: number;
  queryText: string;
  drivenBy: string;
}

export async function fetchPricing(args: PricingArgs): Promise<PricingPlan> {
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

  return { fulfilled, outcomes, suggested, queryText, drivenBy: driving?.source ?? "policy_floor" };
}

/**
 * The write half: one immutable snapshot row per FETCHED source, on the handle
 * the caller owns (a held `Tx` inside a request, the pool outside one).
 *
 * `suggested_cents` on every row is the OVERALL policy-applied suggestion of
 * this pricing event — the per-source medians live in that row's comps — so the
 * draft step can read any latest row and get the price of record.
 */
export async function recordPricing(
  db: Queryable,
  args: PricingArgs,
  plan: PricingPlan
): Promise<MultiSourcePricing> {
  const { fulfilled, outcomes, suggested, queryText } = plan;
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
    driven_by: plan.drivenBy,
    override_cents: args.overrideCents ?? null,
    snapshot_count: fulfilled.length,
  };
}

/** Fetch then record on one handle, for callers with no transaction to join. */
export async function priceWithProviders(db: Queryable, args: PricingArgs): Promise<MultiSourcePricing> {
  return recordPricing(db, args, await fetchPricing(args));
}
