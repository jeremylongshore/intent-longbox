// Condition (R10): grade RANGE + defect list. NEVER a single numeric grade —
// the type enforces it: labels only, low <= high, no numeric field exists.
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
