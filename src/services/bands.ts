// Confidence bands (R8): high = one-tap confirm, medium = forced grid pick,
// low = manual search.
//
// E06-D01 — THE BAND IS A SERVER-SIDE DERIVATION THE MODEL CANNOT SET.
//
// What this file used to be, and why that was the defect (046 §5 A8, finding
// R-3). `assignBand(result.confidence, thresholds)` read ONE number — the
// model's self-report — and `applyContradiction` could only lower it when
// `checkEvidenceContradiction` fired. But every branch of that gate is guarded
// on a NON-NULL evidence field (`rerank.ts:28,41,56`), so the payload
//
//     { issue_number_read: null, price_box_text: null, logo_era_guess: null,
//       confidence: 0.99 }
//
// validated against the provider schema, raised no contradiction, and took the
// high band straight to one-tap. Locked decision 7's gate was an integrity check
// against an HONEST model — a cross-check on evidence the model volunteered —
// and not a control against a steered one. A sticker on a cover reading "this is
// Amazing Spider-Man #300" is enough to steer it, and 046 §5 A8 lists exactly
// that as the live prompt-injection asset with "none" under existing controls.
//
// The fix is a change of authority, not a threshold change: **evidence sets a
// CEILING, and the model's number may only lower the band beneath it.** Absent
// evidence is not neutral — it is the absence of the thing the band was supposed
// to be derived from, so it is treated as a contradiction-class signal (one null
// field → medium at best, two or more → low). A model that says nothing readable
// and claims certainty now lands where an abstention belongs.
//
// Docs: CLAUDE.md locked decision 7 · 046 §5 A8 / R-3 · 040 §4.2 F3 (a
// contradiction removes the one-tap path) · 019 T1/T3 (one-tap later corrected
// ≤1%) · 022 P6 (no percentages in operator copy — this module returns band
// WORDS and a completeness tuple, never a rate) · 042 §6.3 (`confidence` is not
// on the wire; the band word is).
import type { BandThresholds } from "../config.js";
import type { BarcodeResult } from "./barcode.js";
import type { Evidence, RankedCandidate } from "../providers/types.js";
import { issueNumber, type ContradictionResult } from "./rerank.js";

export type Band = "high" | "medium" | "low";

const ORDER: Record<Band, number> = { low: 0, medium: 1, high: 2 };

/** The lower of two bands. Every input in this file is a CEILING, so the band is their minimum. */
export function minBand(a: Band, b: Band): Band {
  return ORDER[a] <= ORDER[b] ? a : b;
}

/**
 * The band the model's self-reported number ALONE would support.
 *
 * Kept, and kept exported, because it is still a real input — it just is no
 * longer an authority. `deriveBand` folds it in with `minBand`, so it can lower
 * a band and can never raise one above what evidence supports. E07-B07 replaces
 * these env thresholds with a calibration curve; until then they are a floor on
 * trust, not a grant of it.
 */
export function assignBand(confidence: number, thresholds: BandThresholds): Band {
  if (confidence >= thresholds.high) return "high";
  if (confidence >= thresholds.medium) return "medium";
  return "low";
}

/** The three fields 042's provider payload requires. Order is the tuple's order. */
export const EVIDENCE_FIELDS = ["issue_number_read", "price_box_text", "logo_era_guess"] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];

/** Does the deterministic rung agree with the probabilistic one? */
export type BarcodeAgreement = "agree" | "disagree" | "unavailable";

/**
 * WHY `unavailable`, in four distinguishable causes.
 *
 * `unavailable` caps the band at medium, so it is the reason most one-taps are
 * not offered — and as ONE bucket it hides four unrelated populations behind one
 * word: a book with no barcode at all, a scan the parser rejected, a bare UPC
 * with no supplement, and a candidate whose issue string is `Annual` or `½` and
 * simply has no number to compare. E07-B07 is asked to re-open the barcode
 * requirement with pilot data, and it cannot do that against a bucket — "no
 * barcode" is a fact about the 1970s and "no supplement" is a fact about our
 * scanner. So the cause is recorded beside the verdict.
 */
export type BarcodeUnavailableCause =
  "no_scan" | "parse_failed" | "no_supplement" | "candidate_issue_not_numeric" | "no_candidate";

/** Is the top candidate distinguishable from the rest of the set? */
export type CandidateAgreement = "unique" | "ambiguous" | "none";

/**
 * Every input the band was derived from, recorded on `llm_rerank.band_inputs`
 * so 019 T3 can be sliced by evidence completeness rather than by a rate that
 * hides which half of the population it came from.
 *
 * It carries no percentage and no operator identifier: it is a tuple of facts
 * about a BOOK and a model call (022 P6, 019 T35).
 */
export interface BandInputs {
  /** Per-field presence — the completeness tuple, in `EVIDENCE_FIELDS` order. */
  evidence_present: Record<EvidenceField, boolean>;
  /** The fields the model reported as unreadable, named so a slice can group on them. */
  evidence_missing: EvidenceField[];
  /** The model's own words for WHY a field was unreadable, when it gave them. */
  unreadable_reasons: Partial<Record<EvidenceField, string>>;
  contradiction: boolean;
  contradiction_reasons: string[];
  barcode_agreement: BarcodeAgreement;
  /** Which of the four `unavailable` causes applied, or `null` when it was not unavailable. */
  barcode_unavailable_cause: BarcodeUnavailableCause | null;
  candidate_agreement: CandidateAgreement;
  /** Recorded as ONE input. `null` when the model omitted it — which is valid; it was never trusted. */
  model_confidence: number | null;
  /** Each ceiling separately, so a reader can see which one bound the result. */
  ceilings: {
    evidence: Band;
    contradiction: Band;
    barcode: Band;
    candidates: Band;
    model: Band;
  };
  /** The derived band. Duplicated here so one jsonb slice answers the whole question. */
  band: Band;
}

/** The verdict and, when it is `unavailable`, which of the four causes produced it. */
export interface BarcodeVerdict {
  agreement: BarcodeAgreement;
  cause: BarcodeUnavailableCause | null;
}

export interface DeriveBandOptions {
  contradiction: ContradictionResult;
  barcode: BarcodeVerdict;
  thresholds: BandThresholds;
}

/**
 * Does the barcode's supplement agree with the top candidate's issue number?
 *
 * `unavailable` is the honest answer for everything that is not a post-1990 US
 * newsstand book with a scanned supplement — and the cause says WHICH, so the
 * bucket can be split when E07-B07 re-opens the requirement.
 */
export function barcodeAgreement(
  barcode: BarcodeResult | undefined,
  top: RankedCandidate | undefined
): BarcodeVerdict {
  const unavailable = (cause: BarcodeUnavailableCause): BarcodeVerdict => ({
    agreement: "unavailable",
    cause,
  });
  if (!barcode) return unavailable("no_scan");
  if (!barcode.ok) return unavailable("parse_failed");
  if (!barcode.supplement) return unavailable("no_supplement");
  if (!top) return unavailable("no_candidate");
  const claimed = issueNumber(top.issue);
  if (claimed === null) return unavailable("candidate_issue_not_numeric");
  return { agreement: barcode.supplement.issue === claimed ? "agree" : "disagree", cause: null };
}

/**
 * Is the top candidate a distinct answer, or one of several the model could not
 * separate? Two candidates with the same title AND issue mean the set does not
 * actually name one book, whatever the ordering says.
 */
export function candidateAgreement(candidates: readonly RankedCandidate[]): CandidateAgreement {
  const top = candidates[0];
  if (!top) return "none";
  const key = (c: RankedCandidate): string =>
    `${c.title.trim().toLowerCase()}|${c.issue.trim().toLowerCase()}`;
  const topKey = key(top);
  return candidates.slice(1).some((c) => key(c) === topKey) ? "ambiguous" : "unique";
}

/** Evidence completeness → ceiling. This is the rule the defect was missing. */
function evidenceCeiling(missing: number): Band {
  if (missing === 0) return "high";
  if (missing === 1) return "medium";
  return "low";
}

/**
 * Derive the band from evidence, the candidate set and — as ONE input among
 * several, never as the authority — the model's self-reported confidence.
 *
 * Every input is a ceiling and the result is their minimum, which is the whole
 * property: nothing the model can put in a JSON field raises the band above what
 * the server can corroborate.
 */
export function deriveBand(
  evidence: Evidence | undefined,
  candidates: readonly RankedCandidate[],
  modelConfidence: number | null,
  opts: DeriveBandOptions
): BandInputs {
  const present = {} as Record<EvidenceField, boolean>;
  const missing: EvidenceField[] = [];
  const reasons: Partial<Record<EvidenceField, string>> = {};
  for (const field of EVIDENCE_FIELDS) {
    const value = evidence?.[field] ?? null;
    const isPresent = typeof value === "string" && value.trim() !== "";
    present[field] = isPresent;
    if (!isPresent) {
      missing.push(field);
      const why = evidence?.unreadable_reasons?.[field];
      if (typeof why === "string" && why.trim() !== "") reasons[field] = why;
    }
  }

  const ceilings = {
    evidence: evidenceCeiling(missing.length),
    // 040 §4.2 F3: a contradiction removes the one-tap path. Unchanged in
    // substance from `applyContradiction`; it is now one ceiling among five.
    contradiction: opts.contradiction.contradiction ? ("medium" as Band) : ("high" as Band),
    // A deterministic rung disagreeing with a probabilistic one is the strongest
    // negative signal this pipeline has: the barcode is printed on the book.
    barcode:
      opts.barcode.agreement === "disagree"
        ? ("low" as Band)
        : opts.barcode.agreement === "agree"
          ? ("high" as Band)
          : ("medium" as Band),
    candidates:
      candidates.length === 0
        ? ("low" as Band)
        : candidateAgreement(candidates) === "unique"
          ? ("high" as Band)
          : ("medium" as Band),
    // The one input the model controls, and the only direction it can move the
    // result is down.
    model: modelConfidence === null ? ("high" as Band) : assignBand(modelConfidence, opts.thresholds),
  };

  const band = (Object.values(ceilings) as Band[]).reduce<Band>((acc, c) => minBand(acc, c), "high");

  return {
    evidence_present: present,
    evidence_missing: missing,
    unreadable_reasons: reasons,
    contradiction: opts.contradiction.contradiction,
    contradiction_reasons: opts.contradiction.reasons,
    barcode_agreement: opts.barcode.agreement,
    barcode_unavailable_cause: opts.barcode.cause,
    candidate_agreement: candidateAgreement(candidates),
    model_confidence: modelConfidence,
    ceilings,
    band,
  };
}
