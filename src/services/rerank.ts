// Evidence-contradiction check (R7, Chip Huyen guard). Pure function:
// cross-validate the model's structured evidence against the top candidate's
// metadata. Any contradiction forces human review.
import type { Evidence, RankedCandidate } from "../providers/types.js";

export interface ContradictionResult {
  contradiction: boolean;
  reasons: string[];
}

/**
 * Extract a numeric issue number from strings like "121", "#121", "121A".
 *
 * Exported for `bands.ts` (E06-D01): the barcode-vs-candidate agreement check
 * compares the SAME way this gate does, and two spellings of "what is the issue
 * number" that could disagree would be a second defect of the first one's kind.
 */
export function issueNumber(s: string): number | null {
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** Rough decade extraction from a price-box text like "$1.25 US" → era check is out of v0 scope for price alone. */
export function checkEvidenceContradiction(
  top: RankedCandidate | undefined,
  evidence: Evidence
): ContradictionResult {
  const reasons: string[] = [];
  if (!top) {
    return { contradiction: false, reasons };
  }

  // 1. Issue number read vs. candidate's issue field.
  if (evidence.issue_number_read !== null) {
    const read = issueNumber(evidence.issue_number_read);
    const claimed = issueNumber(top.issue);
    if (read !== null && claimed !== null && read !== claimed) {
      reasons.push(
        `issue_number_read "${evidence.issue_number_read}" contradicts candidate issue "${top.issue}"`
      );
    }
  }

  // 2. Price-box era vs. candidate year: a cover price implies a rough era.
  //    US newsstand prices are monotonically non-decreasing over time; a large
  //    mismatch between price-implied era and candidate year is a contradiction.
  if (evidence.price_box_text !== null && top.year !== undefined) {
    const priceMatch = evidence.price_box_text.match(/(\d+)\s*[¢c]|\$\s*(\d+(?:\.\d{1,2})?)/);
    if (priceMatch) {
      const cents =
        priceMatch[1] !== undefined ? Number(priceMatch[1]) : Math.round(Number(priceMatch[2]) * 100);
      const era = priceEraBounds(cents);
      if (era && (top.year < era.min || top.year > era.max)) {
        reasons.push(
          `price_box_text "${evidence.price_box_text}" implies ~${era.min}-${era.max}, contradicts candidate year ${top.year}`
        );
      }
    }
  }

  // 3. Logo era guess vs. candidate year, when the guess carries a decade.
  if (evidence.logo_era_guess !== null && top.year !== undefined) {
    const decadeMatch = evidence.logo_era_guess.match(/(19|20)(\d)0s/);
    if (decadeMatch) {
      const decadeStart = Number(`${decadeMatch[1]}${decadeMatch[2]}0`);
      if (top.year < decadeStart - 5 || top.year > decadeStart + 14) {
        reasons.push(`logo_era_guess "${evidence.logo_era_guess}" contradicts candidate year ${top.year}`);
      }
    }
  }

  return { contradiction: reasons.length > 0, reasons };
}

/** Coarse US newsstand cover-price era table. Generous bounds — the gate should catch decade-scale misses, not quibble. */
function priceEraBounds(cents: number): { min: number; max: number } | null {
  if (cents <= 0) return null;
  if (cents <= 12) return { min: 1930, max: 1969 };
  if (cents <= 25) return { min: 1961, max: 1976 };
  if (cents <= 60) return { min: 1975, max: 1985 };
  if (cents <= 150) return { min: 1982, max: 1995 };
  if (cents <= 300) return { min: 1990, max: 2010 };
  return { min: 1998, max: 2100 };
}
