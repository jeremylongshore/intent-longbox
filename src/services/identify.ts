// Identify orchestration: barcode (deterministic) + vision call (probabilistic)
// + evidence-contradiction gate + band assignment. Appends candidate_set and
// llm_rerank rows; never mutates prior records.
import { createHash } from "node:crypto";
import type pg from "pg";
import type { BandThresholds } from "../config.js";
import type { ImageRef, VisionProvider } from "../providers/types.js";
import { IDENTIFY_PROMPT } from "../providers/types.js";
import { parseComicBarcode } from "./barcode.js";
import { assignBand, applyContradiction, type Band } from "./bands.js";
import { checkEvidenceContradiction } from "./rerank.js";
import { appendCostLog } from "./costLog.js";
import { listSessionPhotos } from "./scanSession.js";

export interface IdentifyOutcome {
  candidateSetIds: string[];
  candidates: unknown[];
  band: Band;
  contradiction: boolean;
  contradictionReasons: string[];
  confidence: number;
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

export async function runIdentify(
  db: pg.Pool,
  args: {
    shopId: string;
    sessionId: string;
    provider: VisionProvider;
    bands: BandThresholds;
    uploadsDir: string;
    /** decoded barcode digits from the client, when the scanner read one */
    barcodeDigits?: string;
  }
): Promise<IdentifyOutcome> {
  const candidateSetIds: string[] = [];
  let barcodeResult: unknown;

  // 1. Deterministic: barcode first (R4).
  if (args.barcodeDigits) {
    const parsed = parseComicBarcode(args.barcodeDigits);
    barcodeResult = parsed;
    if (parsed.ok) {
      const ins = await db.query(
        `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates, barcode_raw)
         VALUES ($1, $2, 'barcode', $3, $4) RETURNING id`,
        [args.sessionId, args.shopId, JSON.stringify([parsed]), args.barcodeDigits]
      );
      candidateSetIds.push((ins.rows[0] as { id: string }).id);
    }
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
    return {
      candidateSetIds,
      candidates: [],
      band: "low",
      contradiction: false,
      contradictionReasons: [],
      confidence: 0,
      provider: args.provider.id,
      model: args.provider.model,
      costUsd: 0,
      ...(barcodeResult !== undefined ? { barcode: barcodeResult } : {}),
      error: "no cover/barcode photos on session",
    };
  }

  const result = await args.provider.identify({ images });
  if (!result.ok) {
    return {
      candidateSetIds,
      candidates: [],
      band: "low",
      contradiction: false,
      contradictionReasons: [],
      confidence: 0,
      provider: args.provider.id,
      model: args.provider.model,
      costUsd: 0,
      ...(barcodeResult !== undefined ? { barcode: barcodeResult } : {}),
      error: `provider error (status ${result.status}): ${result.error}`,
    };
  }

  const ins = await db.query(
    `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates)
     VALUES ($1, $2, 'llm_vision', $3) RETURNING id`,
    [args.sessionId, args.shopId, JSON.stringify(result.ranked)]
  );
  const visionSetId = (ins.rows[0] as { id: string }).id;
  candidateSetIds.push(visionSetId);

  // 3. Evidence-contradiction gate (R7) + band assignment (R8).
  const top = result.ranked[0];
  const check = checkEvidenceContradiction(top, result.evidence);
  const band = applyContradiction(assignBand(result.confidence, args.bands), check.contradiction);

  const promptHash = createHash("sha256").update(IDENTIFY_PROMPT).digest("hex").slice(0, 16);
  const costUsd = await appendCostLog(db, {
    shopId: args.shopId,
    scanSessionId: args.sessionId,
    provider: args.provider.id,
    model: args.provider.model,
    tokensIn: result.usage.tokensIn,
    tokensOut: result.usage.tokensOut,
  });

  await db.query(
    `INSERT INTO llm_rerank
       (candidate_set_id, scan_session_id, shop_id, provider, model, prompt_hash, response,
        confidence, band, contradiction, tokens_in, tokens_out, cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      visionSetId,
      args.sessionId,
      args.shopId,
      args.provider.id,
      args.provider.model,
      promptHash,
      JSON.stringify({ raw: result.raw, evidence: result.evidence, contradiction_reasons: check.reasons }),
      result.confidence,
      band,
      check.contradiction,
      result.usage.tokensIn,
      result.usage.tokensOut,
      costUsd,
    ]
  );

  return {
    candidateSetIds,
    candidates: result.ranked,
    band,
    contradiction: check.contradiction,
    contradictionReasons: check.reasons,
    confidence: result.confidence,
    provider: args.provider.id,
    model: args.provider.model,
    costUsd,
    ...(barcodeResult !== undefined ? { barcode: barcodeResult } : {}),
  };
}
