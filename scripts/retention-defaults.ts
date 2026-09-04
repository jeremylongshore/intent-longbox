// The default retention policy every shop starts with (022 P7 Q6).
//
// Its own module so that scripts/register-shop.ts (new shops) and the
// integration test that compares it against migration 003's §8 seed (shops that
// existed when the migration ran) read the SAME values. The two paths seeding
// different numbers is exactly the drift the test exists to catch.
//
// `anchor` names the event `window_days` counts from; `ceiling_days` is always
// measured from capture. Keep in step with
// migrations/003_reserve_principle_slots.sql §8.
export interface RetentionDefault {
  readonly artifactClass: "originals" | "derivatives" | "labor_shift";
  readonly anchor: "draft_created" | "listing_end" | "shift_end" | "capture";
  readonly windowDays: number;
  readonly ceilingDays: number;
}

export const DEFAULT_RETENTION: readonly RetentionDefault[] = [
  { artifactClass: "originals", anchor: "draft_created", windowDays: 30, ceilingDays: 90 },
  { artifactClass: "derivatives", anchor: "listing_end", windowDays: 90, ceilingDays: 730 },
  { artifactClass: "labor_shift", anchor: "shift_end", windowDays: 730, ceilingDays: 730 },
];
