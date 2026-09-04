// Identify orchestration: barcode (deterministic) + vision call (probabilistic)
// + evidence-contradiction gate + band assignment. Appends candidate_set and
// llm_rerank rows; never mutates prior records.
//
// SPLIT INTO plan → record BY E02-D08 (042 §5, 041 §4.1).
//
// The two halves are not a refactor for tidiness. 041 §4.1 forbids a side effect
// inside a transaction body — "no provider call, no Shopify mutation, no file
// write" — and that rule is what makes `withTransaction`'s retry sound: a
// retried attempt must be able to run `fn` again from the top without spending
// money twice. 042 §5 then requires the rows this call writes to commit in the
// SAME transaction as its `request_idempotency` row, or a retry over the
// counter's Wi-Fi appends a second `candidate_set` and a second `llm_rerank`.
//
// Both hold only if the provider call happens OUTSIDE the transaction and the
// writes happen INSIDE it. So: `planIdentify` reads and calls and decides and
// writes nothing; `recordIdentify` writes and calls nobody. `runIdentify` is the
// two in sequence on one handle, kept because a caller with no transaction to
// join (and every existing test) is still correct that way.
import { createHash } from "node:crypto";
import type { Queryable } from "../db.js";
import type { BandThresholds } from "../config.js";
import type { ImageRef, VisionProvider } from "../providers/types.js";
import { IDENTIFY_PROMPT } from "../providers/types.js";
import { parseComicBarcode, type BarcodeResult } from "./barcode.js";
import { barcodeAgreement, deriveBand, type Band, type BandInputs } from "./bands.js";
import { checkEvidenceContradiction } from "./rerank.js";
import { appendCostLog } from "./costLog.js";
import { listSessionPhotos } from "./scanSession.js";

export interface IdentifyOutcome {
  candidateSetIds: string[];
  /**
   * 042 §6.3 / E14 — the id of the `llm_rerank` row this call wrote, or null
   * when it wrote none (no photos, or a provider failure).
   *
   * Its absence was a response-shape defect that made a RATIFIED requirement
   * unsatisfiable: 040 A1 requires a confirmation to name the record the
   * operator was shown, 041 §3.5 puts `against_table`/`against_id` on the row,
   * and a client instructed to send the record it was shown had no id for it.
   * The failure would have surfaced as E05 sending a `candidate_set` id where a
   * rerank id belongs — which the comparison in 040 §3.4 accepts as a lower-rung
   * witness and treats as STALE.
   */
  llmRerankId: string | null;
  candidates: unknown[];
  band: Band;
  contradiction: boolean;
  contradictionReasons: string[];
  /** `null` when the model omitted it (E06-D01) or when no vision call happened. */
  confidence: number | null;
  provider: string;
  model: string;
  costUsd: number;
  barcode?: unknown;
  error?: string;
}

function mediaTypeFor(url: string): ImageRef["mediaType"] {
  if (url.endsWith(".png")) return "image/png";
  if (url.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export interface IdentifyArgs {
  shopId: string;
  sessionId: string;
  provider: VisionProvider;
  bands: BandThresholds;
  uploadsDir: string;
  /** decoded barcode digits from the client, when the scanner read one */
  barcodeDigits?: string;
  /**
   * The credential VERSION that pays for this call, or null when Longbox's own
   * account does (E03-B05, 050 §6).
   *
   * It rides on the args rather than being re-derived inside `recordIdentify`
   * because the resolution has already happened — `resolveVisionProvider`
   * returned it beside the provider — and re-deriving it here would be a SECOND
   * answer to "who paid", computed after the call, from a database that may have
   * changed. One resolution, one attribution.
   */
  credentialVersionId?: string | null;
}

/** Everything decided before anything is written. No INSERT reaches this half. */
export interface IdentifyPlan {
  /** Typed, not `unknown`: E06-D01's barcode-vs-candidate agreement reads it. */
  barcode?: BarcodeResult;
  /** Present when the barcode parsed: the row `recordIdentify` will append. */
  barcodeSet?: { digits: string; candidates: unknown[] };
  vision?: {
    ranked: unknown[];
    raw: unknown;
    evidence: unknown;
    confidence: number | null;
    tokensIn: number;
    tokensOut: number;
  };
  band: Band;
  contradiction: boolean;
  contradictionReasons: string[];
  /**
   * E06-D01 — every input the band was derived from, written to
   * `llm_rerank.band_inputs` so 019 T3 can be sliced by evidence completeness.
   * Absent when no vision call produced a band.
   */
  bandInputs?: BandInputs;
  error?: string;
}

export async function planIdentify(db: Queryable, args: IdentifyArgs): Promise<IdentifyPlan> {
  const plan: IdentifyPlan = { band: "low", contradiction: false, contradictionReasons: [] };

  // 1. Deterministic: barcode first (R4).
  if (args.barcodeDigits) {
    const parsed = parseComicBarcode(args.barcodeDigits);
    plan.barcode = parsed;
    if (parsed.ok) plan.barcodeSet = { digits: args.barcodeDigits, candidates: [parsed] };
  }

  // 2. Probabilistic: vision candidates from the session's photos.
  const photos = await listSessionPhotos(db, args.shopId, args.sessionId);
  const images: ImageRef[] = photos
    .filter((p) => p.kind === "cover" || p.kind === "barcode")
    .map((p) => ({
      path: p.storage_url,
      mediaType: mediaTypeFor(p.storage_url),
      kind: p.kind as ImageRef["kind"],
    }));
  if (images.length === 0) {
    plan.error = "no cover/barcode photos on session";
    return plan;
  }

  const result = await args.provider.identify({ images });
  if (!result.ok) {
    plan.error = `provider error (status ${result.status}): ${result.error}`;
    return plan;
  }

  // 3. Evidence-contradiction gate (R7) + band assignment (R8).
  const top = result.ranked[0];
  const check = checkEvidenceContradiction(top, result.evidence);
  plan.vision = {
    ranked: result.ranked,
    raw: result.raw,
    evidence: result.evidence,
    confidence: result.confidence,
    tokensIn: result.usage.tokensIn,
    tokensOut: result.usage.tokensOut,
  };

  // E06-D01 — THE BAND IS DERIVED HERE, FROM WHAT THE SERVER CAN CORROBORATE.
  //
  // It used to be `applyContradiction(assignBand(result.confidence, …), …)`,
  // which is to say: the model's number, occasionally lowered. `deriveBand`
  // takes evidence completeness, the contradiction gate's verdict, whether the
  // BARCODE (a deterministic rung, printed on the book) agrees with the top
  // candidate, whether the candidate set actually names one book, and the
  // model's number as one input among five — and returns their minimum. The
  // number can lower a band and cannot raise one (046 §5 A8 / R-3).
  const inputs = deriveBand(result.evidence, result.ranked, result.confidence, {
    contradiction: check,
    barcode: barcodeAgreement(plan.barcode, top),
    thresholds: args.bands,
  });
  plan.band = inputs.band;
  plan.bandInputs = inputs;
  plan.contradiction = check.contradiction;
  plan.contradictionReasons = check.reasons;
  return plan;
}

/**
 * Every write this call makes, on ONE handle — a held `Tx` when a request owns
 * one, the pool when `runIdentify` is called outside a request.
 *
 * A failed identify still records its barcode set: the parse happened, and the
 * record of what the deterministic half saw is exactly as much a fact as a
 * successful vision call's.
 */
export async function recordIdentify(
  db: Queryable,
  args: IdentifyArgs,
  plan: IdentifyPlan
): Promise<{ candidateSetIds: string[]; llmRerankId: string | null; costUsd: number }> {
  const candidateSetIds: string[] = [];

  if (plan.barcodeSet) {
    const ins = await db.query(
      `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates, barcode_raw)
         VALUES ($1, $2, 'barcode', $3, $4) RETURNING id`,
      [args.sessionId, args.shopId, JSON.stringify(plan.barcodeSet.candidates), plan.barcodeSet.digits]
    );
    candidateSetIds.push((ins.rows[0] as { id: string }).id);
  }

  if (!plan.vision) return { candidateSetIds, llmRerankId: null, costUsd: 0 };

  const ins = await db.query(
    `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates)
     VALUES ($1, $2, 'llm_vision', $3) RETURNING id`,
    [args.sessionId, args.shopId, JSON.stringify(plan.vision.ranked)]
  );
  const visionSetId = (ins.rows[0] as { id: string }).id;
  candidateSetIds.push(visionSetId);

  const promptHash = createHash("sha256").update(IDENTIFY_PROMPT).digest("hex").slice(0, 16);
  const costUsd = await appendCostLog(db, {
    shopId: args.shopId,
    scanSessionId: args.sessionId,
    provider: args.provider.id,
    model: args.provider.model,
    tokensIn: plan.vision.tokensIn,
    tokensOut: plan.vision.tokensOut,
    credentialVersionId: args.credentialVersionId ?? null,
  });

  // `RETURNING id` — 042 §6.3. One clause, and without it 040 A1's causal
  // reference is unsatisfiable on the confirm path.
  const rerank = await db.query(
    `INSERT INTO llm_rerank
       (candidate_set_id, scan_session_id, shop_id, provider, model, prompt_hash, response,
        confidence, band, contradiction, tokens_in, tokens_out, cost_usd, band_inputs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      visionSetId,
      args.sessionId,
      args.shopId,
      args.provider.id,
      args.provider.model,
      promptHash,
      JSON.stringify({
        raw: plan.vision.raw,
        evidence: plan.vision.evidence,
        contradiction_reasons: plan.contradictionReasons,
      }),
      plan.vision.confidence,
      plan.band,
      plan.contradiction,
      plan.vision.tokensIn,
      plan.vision.tokensOut,
      costUsd,
      // E06-D01 — the derivation's inputs, so 019 T3 is sliceable by evidence
      // completeness rather than reported as one rate over a mixed population.
      // No percentage, no operator identifier: facts about a book and a call.
      plan.bandInputs === undefined ? null : JSON.stringify(plan.bandInputs),
    ]
  );

  return {
    candidateSetIds,
    llmRerankId: (rerank.rows[0] as { id: string }).id,
    costUsd,
  };
}

export interface LatestRerank {
  id: string;
  band: string;
  contradiction: boolean;
  contradiction_reasons: string[];
}

/**
 * The re-rank a one-tap confirmation would be answering (040 F3).
 *
 * `contradiction_reasons` come back out of `llm_rerank.response`, where the gate
 * already stored them — so exposing them in a 409's `details` publishes nothing
 * new; it stops the same information arriving as an unparseable sentence (042
 * §4.6). They are evidence strings about the BOOK, never prose about the person.
 */
export async function readLatestRerank(
  db: Queryable,
  shopId: string,
  sessionId: string
): Promise<LatestRerank | undefined> {
  const res = await db.query(
    `SELECT id, band, contradiction, response FROM llm_rerank
      WHERE scan_session_id = $1 AND shop_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [sessionId, shopId]
  );
  const row = res.rows[0] as
    | { id: string; band: string; contradiction: boolean; response: { contradiction_reasons?: string[] } }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    band: row.band,
    contradiction: row.contradiction,
    contradiction_reasons: row.response?.contradiction_reasons ?? [],
  };
}

/** The plan and the record on one handle, for callers with no transaction. */
export async function runIdentify(db: Queryable, args: IdentifyArgs): Promise<IdentifyOutcome> {
  const plan = await planIdentify(db, args);
  const written = await recordIdentify(db, args, plan);
  return toOutcome(args, plan, written);
}

export function toOutcome(
  args: IdentifyArgs,
  plan: IdentifyPlan,
  written: { candidateSetIds: string[]; llmRerankId: string | null; costUsd: number }
): IdentifyOutcome {
  return {
    candidateSetIds: written.candidateSetIds,
    llmRerankId: written.llmRerankId,
    candidates: plan.vision?.ranked ?? [],
    band: plan.band,
    contradiction: plan.contradiction,
    contradictionReasons: plan.contradictionReasons,
    confidence: plan.vision?.confidence ?? null,
    provider: args.provider.id,
    model: args.provider.model,
    costUsd: written.costUsd,
    ...(plan.barcode !== undefined ? { barcode: plan.barcode } : {}),
    ...(plan.error !== undefined ? { error: plan.error } : {}),
  };
}
