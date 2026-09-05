// L1: the break-glass audit's PROJECTION — what an operator is allowed to see
// when 019 T35(c) fires (E03-D14).
//
// Bead: longbox-e5b.3.24 (alias E03-D14). Docs: 000-docs/058 §4; 019 T35, T35(c);
// 022 P3; 034 §3.4.
//
// The database half is `tests/integration/break-glass-origin.test.ts`. This file
// asserts the half that has nothing to do with a database and everything to do
// with 022 P3: **a detector's output must name a tenant and never a person.**
// Asserted directly on the pure function rather than inferred from a printed
// line, because "this output contains no person" is a property worth proving.
import { describe, expect, it } from "vitest";
import { DEFAULT_LOOKBACK_HOURS, summariseUnreconciled } from "../scripts/breakGlassAudit.js";
import type { UnreconciledSession } from "../src/services/auth/index.js";

const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";

const session = (shopId: string, longboxOrigin: boolean, n: number): UnreconciledSession => ({
  sessionId: `session-${String(n)}`,
  appUserId: `person-${String(n)}`,
  shopId,
  issuedAt: new Date("2026-09-05T12:00:00Z"),
  longboxOrigin,
});

describe("summariseUnreconciled (058 §4)", () => {
  it("answers nothing for nothing — an empty audit is the healthy state", () => {
    expect(summariseUnreconciled([])).toEqual([]);
  });

  it("counts the two populations SEPARATELY, per shop", () => {
    // They are different incidents. A Longbox account at a shop with no grant is
    // an outsider inside a tenant; a break-glass holder outside their own
    // window is the shop's own support person straying past a ticket. Folding
    // them into one number would tell an operator that something is wrong and
    // not what.
    const rows = [
      session(SHOP_A, true, 1),
      session(SHOP_A, true, 2),
      session(SHOP_A, false, 3),
      session(SHOP_B, false, 4),
    ];
    expect(summariseUnreconciled(rows)).toEqual([
      { shopId: SHOP_A, longboxOrigin: 2, breakGlassHolder: 1 },
      { shopId: SHOP_B, longboxOrigin: 0, breakGlassHolder: 1 },
    ]);
  });

  it("sorts by shop, so two runs over the same rows diff as equal", () => {
    const forward = summariseUnreconciled([session(SHOP_B, true, 1), session(SHOP_A, true, 2)]);
    const backward = summariseUnreconciled([session(SHOP_A, true, 2), session(SHOP_B, true, 1)]);
    expect(forward).toEqual(backward);
    expect(forward.map((f) => f.shopId)).toEqual([SHOP_A, SHOP_B]);
  });

  it("drops EVERY identifier but the tenant (022 P3, 019 T35)", () => {
    // The one identifier this detector may print is the shop, because a tenant
    // is what an operator must know to act on a finding. A session id, an
    // `app_user_id` or a per-session timestamp would make the output the covert
    // per-operator surface 022 P3 forbids — with a cron entry.
    const out = summariseUnreconciled([session(SHOP_A, true, 1)]);
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain("session-1");
    expect(serialised).not.toContain("person-1");
    expect(serialised).not.toContain("2026-09-05");
    expect(Object.keys(out[0]!).sort()).toEqual(["breakGlassHolder", "longboxOrigin", "shopId"]);
  });

  it("keeps the default lookback a PROVISIONAL floor, stated as one number", () => {
    // 058 §4: 24 hours matches the daily cadence 019 T24 and T35(c) describe. It
    // is a floor and not a signed value, so no artifact may quote it as a
    // detection guarantee — the test pins the number so a change is a diff.
    expect(DEFAULT_LOOKBACK_HOURS).toBe(24);
  });
});
