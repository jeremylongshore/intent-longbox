// Confidence bands (R8): high = one-tap confirm, medium = forced grid pick,
// low = manual search. Thresholds live in config. Pure function.
import type { BandThresholds } from "../config.js";

export type Band = "high" | "medium" | "low";

export function assignBand(confidence: number, thresholds: BandThresholds): Band {
  if (confidence >= thresholds.high) return "high";
  if (confidence >= thresholds.medium) return "medium";
  return "low";
}

/**
 * The contradiction gate (R7): evidence contradicting the chosen candidate
 * forces human review regardless of confidence — a high band is downgraded to
 * medium (forced pick); medium/low stay where they are.
 */
export function applyContradiction(band: Band, contradiction: boolean): Band {
  if (!contradiction) return band;
  return band === "high" ? "medium" : band;
}
