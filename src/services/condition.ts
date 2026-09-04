// Condition (R10): grade RANGE + defect list. NEVER a single numeric grade —
// the type enforces it: labels only, low <= high, no numeric field exists.
//
// The condition module owns `condition_assessment` (029 §2.10), so its reads and
// writes live here rather than in the route: 029 §5 move 2 moves the INSERT out of
// `src/routes/scanSessions.ts`, and `scripts/architectureRules.ts` counts what is
// left. A correction to an assessment is NOT written here — it goes through the
// single `supersedes_id` writer in `supersession.ts` (041 §3.3), and this file
// supplies the two halves that writer needs: the first append, and the read of the
// row a correction replaces.
import type { Tx } from "../db.js";

export const GRADE_LABELS = ["PR", "FR", "GD", "VG", "FN", "VF", "NM"] as const;
export type GradeLabel = (typeof GRADE_LABELS)[number];

export const DEFECT_OPTIONS = [
  "spine_ticks",
  "spine_roll",
  "corner_wear",
  "cover_crease",
  "foxing",
  "tanning",
  "water_damage",
  "writing",
  "tears",
  "detached_cover",
  "missing_pages",
  "restoration",
] as const;

export interface ConditionInput {
  gradeRangeLow: GradeLabel;
  gradeRangeHigh: GradeLabel;
  defects: string[];
  notes?: string;
}

export function gradeIndex(g: GradeLabel): number {
  return GRADE_LABELS.indexOf(g);
}

/** low must not exceed high on the label scale. */
export function validGradeRange(low: GradeLabel, high: GradeLabel): boolean {
  return gradeIndex(low) <= gradeIndex(high);
}

/** Human copy for the range — always a range, never a number. */
export function gradeRangeLabel(low: GradeLabel, high: GradeLabel): string {
  return low === high ? low : `${low}-${high}`;
}

/** The columns a caller needs off an assessment; never a star-select (042 I5(b)). */
export interface ConditionAssessmentRow {
  id: string;
  created_at: string;
  grade_range_low: string;
  grade_range_high: string;
  defects: string[];
  notes: string | null;
  session_seq: string | number | null;
}

/**
 * The session's CURRENT assessment — the newest row nothing supersedes.
 *
 * Read from `condition_assessment_current`, not from the table, and that is 041
 * §3.4's rule rather than a preference: "every read that drives a decision goes
 * through `_current`". This read drives two decisions — whether the incoming call
 * is a correction, and which row it corrects — so reading the raw table by
 * insertion order would pick a superseded row as the predecessor and fork the
 * chain at the first correction (041 I8's defect, one table over).
 *
 * `migrations/013` re-created the view on 041 §5's canonical order, so "newest"
 * here means the highest `session_seq` rather than the `id DESC` coin flip the
 * view shipped with.
 */
export async function readCurrentConditionAssessment(
  tx: Tx,
  shopId: string,
  sessionId: string
): Promise<ConditionAssessmentRow | undefined> {
  const res = await tx.query(
    `SELECT id, created_at, grade_range_low, grade_range_high, defects, notes, session_seq
       FROM condition_assessment_current WHERE scan_session_id = $1 AND shop_id = $2`,
    [sessionId, shopId]
  );
  return res.rows[0] as ConditionAssessmentRow | undefined;
}

/**
 * Append the session's FIRST condition assessment.
 *
 * Deliberately has no `supersedes_id` parameter: a correction is
 * `supersede(tx, …)`'s to write and this function could not be made to write one
 * without becoming a second writer of that column, which `pnpm arch` refuses
 * (041 §3.3). `Tx` first, per 041 §4.1.
 */
export async function insertConditionAssessment(
  tx: Tx,
  args: {
    sessionId: string;
    shopId: string;
    gradeRangeLow: GradeLabel;
    gradeRangeHigh: GradeLabel;
    defects: string[];
    notes: string | null;
    /** 041 §5.3 — from `assignSessionSeq`, under the anchor lock this `tx` holds. */
    sessionSeq: number;
  }
): Promise<{ id: string; created_at: string; session_seq: string | number }> {
  const res = await tx.query(
    `INSERT INTO condition_assessment
       (scan_session_id, shop_id, grade_range_low, grade_range_high, defects, notes, session_seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at, session_seq`,
    [
      args.sessionId,
      args.shopId,
      args.gradeRangeLow,
      args.gradeRangeHigh,
      args.defects,
      args.notes,
      args.sessionSeq,
    ]
  );
  return res.rows[0] as { id: string; created_at: string; session_seq: string | number };
}
