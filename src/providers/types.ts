// Provider seam (BYOK). One interface, two v0 adapters. Registry SHAPE borrowed
// from @intentsolutions/refiner (the shape, not the package).

export interface ImageRef {
  /** absolute or app-relative path on local disk (v0 stores uploads locally) */
  path: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  kind: "cover" | "barcode" | "defect";
}

export interface CandidateMeta {
  title: string;
  issue: string;
  publisher?: string;
  year?: number;
  variant?: string;
}

export interface RankedCandidate extends CandidateMeta {
  confidence: number;
  variantHints?: string[];
}

/** REQUIRED structured evidence — the contradiction gate's raw material (R7). */
export interface Evidence {
  issue_number_read: string | null;
  price_box_text: string | null;
  logo_era_guess: string | null;
}

export interface IdentifyRequest {
  images: ImageRef[];
  /** present for re-rank; absent for vision-candidate mode */
  candidates?: CandidateMeta[];
}

export type IdentifyResult =
  | {
      ok: true;
      ranked: RankedCandidate[];
      evidence: Evidence;
      confidence: number;
      raw: unknown; // stored verbatim in llm_rerank.response
      usage: { tokensIn: number; tokensOut: number };
    }
  | {
      // Transport returns status instead of throwing on 4xx/5xx.
      ok: false;
      status: number;
      error: string;
      raw?: unknown;
    };

export interface VisionProvider {
  id: "anthropic" | "openai-compat";
  model: string;
  identify(req: IdentifyRequest): Promise<IdentifyResult>;
}

/** Per-provider transport config resolved per shop (never logged). */
export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

/** Reliability lore: reasoning models need max_tokens >= 2048. */
export const MAX_OUTPUT_TOKENS_FLOOR = 2048;

export const IDENTIFY_PROMPT = `You are identifying a comic book from photographs of its cover (and possibly its barcode area).
Return ONLY a JSON object with this exact shape, no prose:
{
  "candidates": [
    { "title": string, "issue": string, "publisher": string, "year": number, "variant": string|null, "variantHints": string[], "confidence": number }
  ],
  "evidence": {
    "issue_number_read": string|null,
    "price_box_text": string|null,
    "logo_era_guess": string|null
  },
  "confidence": number
}
Rules:
- candidates: up to 5, best first, confidence in [0,1].
- evidence fields are REQUIRED: report exactly what you can read on the cover (issue number printed, cover price box text, publisher logo era guess). Use null only when genuinely unreadable.
- Condition/grade is out of scope; identify the book only.`;

/** Strip <think>...</think> blocks (reasoning models) then parse the first JSON object. */
export function parseModelJson(text: string): unknown {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no JSON object found in model output");
  }
  return JSON.parse(stripped.slice(start, end + 1));
}
