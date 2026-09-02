import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Evidence, IdentifyRequest, IdentifyResult, RankedCandidate } from "./types.js";

export function imageToBase64(path: string): string {
  return readFileSync(path).toString("base64");
}

const candidateSchema = z.object({
  title: z.string(),
  issue: z.string(),
  publisher: z.string().optional(),
  year: z.number().optional(),
  variant: z.string().nullable().optional(),
  variantHints: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
});

const identifyPayloadSchema = z.object({
  candidates: z.array(candidateSchema),
  evidence: z.object({
    issue_number_read: z.string().nullable(),
    price_box_text: z.string().nullable(),
    logo_era_guess: z.string().nullable(),
  }),
  confidence: z.number().min(0).max(1),
});

/** Validate model JSON payload into the IdentifyResult success shape. */
export function toIdentifyResult(
  payload: unknown,
  raw: unknown,
  usage: { tokensIn: number; tokensOut: number }
): IdentifyResult {
  const parsed = identifyPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, status: 502, error: `model payload failed validation: ${parsed.error.message}`, raw };
  }
  const ranked: RankedCandidate[] = parsed.data.candidates.map((c) => {
    const r: RankedCandidate = { title: c.title, issue: c.issue, confidence: c.confidence };
    if (c.publisher !== undefined) r.publisher = c.publisher;
    if (c.year !== undefined) r.year = c.year;
    if (c.variant !== undefined && c.variant !== null) r.variant = c.variant;
    if (c.variantHints !== undefined) r.variantHints = c.variantHints;
    return r;
  });
  const evidence: Evidence = parsed.data.evidence;
  return { ok: true, ranked, evidence, confidence: parsed.data.confidence, raw, usage };
}

/** Build user-text portion: prompt plus candidate metadata for re-rank mode. */
export function buildUserText(prompt: string, req: IdentifyRequest): string {
  if (!req.candidates || req.candidates.length === 0) return prompt;
  return `${prompt}\n\nCandidate metadata to re-rank (choose/rank among these where they match what you see):\n${JSON.stringify(req.candidates, null, 2)}`;
}
