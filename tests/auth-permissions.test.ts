// L1: the role→permission matrix, pinned; and `authorize()`, exhaustively.
//
// Bead: longbox-e5b.3.3 (alias E03-B03). Docs: 054 §3, §5; 034 §2.6, §2.7;
// 048 §12.3; 022 P3; 019 T24, T35.
//
// **The matrix is pinned here CHARACTER BY CHARACTER, and that is the point.**
// 034 §2.6 chose a closed enum over a permission table because *"four fixed roles
// cannot be misconfigured into a fifth"*; a constant nothing asserts is a table
// with slower writes. Widening a role's grants means editing this file too, in
// the same commit, where a reviewer reads it as the diff it is.
import { describe, expect, it } from "vitest";
import { PERMISSIONS, PERMISSION_NAMES, isPrivileged } from "../src/contracts/v1/permissions.js";
import type { MembershipRow, Role } from "../src/services/auth/memberships.js";
import {
  GRANTED_PERMISSIONS,
  PERMISSION_MATRIX_VERSION,
  ROLE_GRANTABLE,
  ROLE_GRANTS,
  authorize,
  mayGrantRole,
} from "../src/services/auth/permissions.js";
import { shouldRecord } from "../src/services/auth/authorizationAudit.js";

const NOW = new Date("2026-09-04T12:00:00Z");
const LOCATION_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_B = "22222222-2222-4222-8222-222222222222";

function grant(over: Partial<MembershipRow> & { role: Role }): MembershipRow {
  return {
    id: `membership-${over.role}-${over.scopeKind ?? "shop"}-${over.locationId ?? "none"}`,
    scopeKind: "shop",
    locationId: null,
    effectiveUntil: null,
    reason: null,
    ...over,
  };
}

describe("the matrix is data, and this is the pin (054 §3.1)", () => {
  it("is version 1.0.0 with exactly these grants, role by role", () => {
    // If this test and the constant disagree, ONE of them is a decision somebody
    // made without saying so. Neither may be updated to match the other without
    // the 054 amendment that authorises it.
    expect(PERMISSION_MATRIX_VERSION).toBe("1.0.0");
    expect(ROLE_GRANTS.owner).toEqual([
      "scan.session.open",
      "scan.session.read",
      "scan.photo.write",
      "scan.photo.read",
      "scan.identify",
      "scan.confirm",
      "condition.record",
      "pricing.request",
      "listing.draft.request",
      "membership.invite",
      "device.enrollment.issue",
    ]);
    expect(ROLE_GRANTS.manager).toEqual(ROLE_GRANTS.owner);
    expect(ROLE_GRANTS.operator).toEqual([
      "scan.session.open",
      "scan.session.read",
      "scan.photo.write",
      "scan.photo.read",
      "scan.identify",
      "scan.confirm",
      "condition.record",
      "pricing.request",
      "listing.draft.request",
    ]);
  });

  it("gives `support_break_glass` NOTHING, which is the strongest line in the matrix", () => {
    // 022 P7's "no invisible super-admin" and 034 §2.6's "a distinct named role,
    // never a policy overlay on an admin session", as an empty list rather than
    // as a promise. Longbox's own support role cannot open a scan, cannot spend
    // the shop's lookup budget and cannot send anything to the shop's store.
    expect(ROLE_GRANTS.support_break_glass).toEqual([]);
    for (const permission of PERMISSION_NAMES) {
      const verdict = authorize(
        [grant({ role: "support_break_glass", effectiveUntil: future(), reason: "why" })],
        permission,
        {
          atLocation: LOCATION_A,
          now: NOW,
        }
      );
      expect(verdict.kind, `break-glass was granted ${permission}`).toBe("refused_role");
    }
  });

  it("covers all four roles and no fifth", () => {
    expect(Object.keys(ROLE_GRANTS).sort()).toEqual(["manager", "operator", "owner", "support_break_glass"]);
    expect(Object.keys(ROLE_GRANTABLE).sort()).toEqual(Object.keys(ROLE_GRANTS).sort());
  });

  it("grants no permission that the vocabulary does not declare, and none it declares twice", () => {
    for (const [role, granted] of Object.entries(ROLE_GRANTS)) {
      expect(new Set(granted).size, `${role} lists a permission twice`).toBe(granted.length);
      for (const p of granted) expect(PERMISSION_NAMES).toContain(p);
    }
  });

  it("leaves no permission ungranted to every role — a permission nobody holds is dead policy", () => {
    // The other direction is the contract test's (every permission is REQUIRED
    // by a route). This one catches the cheaper mistake: a vocabulary entry added
    // and then forgotten in the matrix.
    expect([...GRANTED_PERMISSIONS].sort()).toEqual([...PERMISSION_NAMES].sort());
  });

  it("explains every permission in plain English, with no jargon a shop would not use", () => {
    for (const [name, spec] of Object.entries(PERMISSIONS)) {
      expect(spec.explanation.length, `${name} has no usable explanation`).toBeGreaterThan(30);
      // 021 discipline and locked decisions 5 and 7: no model talk, no numeric
      // grade, no statute, no measurement of a person.
      expect(spec.explanation).not.toMatch(/\bAI\b|\bmodel\b|\bLLM\b/i);
      expect(spec.explanation).not.toMatch(/\bgrade\s+\d|\b\d+\.\d\b/);
      expect(spec.explanation).not.toMatch(/§|U\.S\.C|Stat\./);
    }
  });
});

describe("nobody grants above their own rank (054 §5, the E03-D07 finding)", () => {
  it("lets an owner name a second owner and a manager name only operators", () => {
    expect(mayGrantRole("owner", "owner")).toBe(true);
    expect(mayGrantRole("owner", "manager")).toBe(true);
    expect(mayGrantRole("owner", "operator")).toBe(true);
    expect(mayGrantRole("manager", "operator")).toBe(true);
  });

  it("lets NO role, through ANY path, hand out `support_break_glass` (S5′, 022 P7)", () => {
    // Stated as a property rather than left to the reader of two lists. The role
    // that is "the only technical read path to per-operator data" (034 §2.6)
    // cannot be granted by anybody through the grant rule, and `InvitableRole`
    // does not contain it either — so there is no code path in this system that
    // mints it. It arrives by a deliberate operator act against the database,
    // under a CHECK that requires an expiry, a stated reason and a granter who
    // is not its holder (migration 028). That is the whole of how a super-admin
    // does not exist here.
    // Pinned as a literal pair as well as by the loop (invariant review, note 8):
    // `owner` is the only role anybody would expect to be able to, and a reader
    // grepping for the answer should find it spelled rather than derived.
    expect(mayGrantRole("owner", "support_break_glass")).toBe(false);
    for (const actor of Object.keys(ROLE_GRANTABLE) as Role[]) {
      expect(mayGrantRole(actor, "support_break_glass"), `${actor} may hand out break-glass`).toBe(false);
    }
  });

  it("REFUSES the escalations, including the one that shipped", () => {
    // `issueInvitation` checked membership and not role, so this pair was live
    // on the CLI path until this bead.
    expect(mayGrantRole("operator", "owner")).toBe(false);
    expect(mayGrantRole("operator", "operator")).toBe(false);
    expect(mayGrantRole("manager", "manager")).toBe(false);
    expect(mayGrantRole("manager", "owner")).toBe(false);
    expect(mayGrantRole("support_break_glass", "operator")).toBe(false);
  });
});

describe("authorize() — the decision, and its two different refusals", () => {
  it("allows a shop-scoped grant to work at any location of its shop", () => {
    const verdict = authorize([grant({ role: "operator" })], "scan.identify", {
      atLocation: LOCATION_B,
      now: NOW,
    });
    expect(verdict).toEqual({
      kind: "allowed",
      membershipId: "membership-operator-shop-none",
      role: "operator",
    });
  });

  it("allows a location-scoped grant AT ITS OWN LOCATION", () => {
    const at = [grant({ role: "operator", scopeKind: "location", locationId: LOCATION_A })];
    expect(authorize(at, "scan.identify", { atLocation: LOCATION_A, now: NOW }).kind).toBe("allowed");
  });

  it("REFUSES a location-scoped grant at another location, as `refused_scope`", () => {
    // 019 T24: the hook turns this into SHOP_NOT_FOUND, byte-identical to a shop
    // that was never issued. The verdict is distinguishable here and NOT on the
    // wire, which is exactly the split.
    const at = [grant({ role: "operator", scopeKind: "location", locationId: LOCATION_A })];
    expect(authorize(at, "scan.identify", { atLocation: LOCATION_B, now: NOW })).toEqual({
      kind: "refused_scope",
      role: "operator",
    });
  });

  it("REFUSES a location-scoped grant a SHOP-scoped permission, wherever it stands", () => {
    // A manager who runs one storefront may equip that storefront and may not
    // change who works at the shop. Standing in the right place does not help.
    const at = [grant({ role: "manager", scopeKind: "location", locationId: LOCATION_A })];
    expect(authorize(at, "membership.invite", { atLocation: LOCATION_A, now: NOW }).kind).toBe(
      "refused_scope"
    );
    expect(authorize(at, "device.enrollment.issue", { atLocation: LOCATION_A, now: NOW }).kind).toBe(
      "allowed"
    );
  });

  it("REFUSES a role that does not hold the permission anywhere, as `refused_role`", () => {
    expect(
      authorize([grant({ role: "operator" })], "membership.invite", {
        atLocation: LOCATION_A,
        now: NOW,
      })
    ).toEqual({ kind: "refused_role", role: "operator" });
  });

  it("names the highest role held in a role refusal, and null when nothing usable is held", () => {
    expect(authorize([], "scan.identify", { atLocation: LOCATION_A, now: NOW })).toEqual({
      kind: "refused_role",
      role: null,
    });
  });

  it("records the HIGHEST grant when several would allow the act", () => {
    // 034 §2.7's "a role change is two rows" makes two live grants a normal
    // state during a handover. The decision has to name one, and naming the
    // lower one would understate the authority the act was taken under.
    const both = [grant({ role: "operator" }), grant({ role: "owner" })];
    const verdict = authorize(both, "scan.confirm", { atLocation: LOCATION_A, now: NOW });
    expect(verdict).toMatchObject({ kind: "allowed", role: "owner" });
  });

  it("prefers an IN-SCOPE grant over a higher out-of-scope one", () => {
    // An owner grant scoped to another location plus an operator grant scoped to
    // this one: the act is allowed, under the operator grant, because that is the
    // authority that actually covers where the person is standing.
    const mixed = [
      grant({ role: "owner", scopeKind: "location", locationId: LOCATION_B }),
      grant({ role: "operator", scopeKind: "location", locationId: LOCATION_A }),
    ];
    expect(authorize(mixed, "scan.identify", { atLocation: LOCATION_A, now: NOW })).toMatchObject({
      kind: "allowed",
      role: "operator",
    });
  });

  it("treats an organisation-scoped grant as covering every location", () => {
    const org = [grant({ role: "owner", scopeKind: "organization" })];
    expect(authorize(org, "scan.identify", { atLocation: LOCATION_B, now: NOW }).kind).toBe("allowed");
    expect(authorize(org, "membership.invite", { atLocation: LOCATION_B, now: NOW }).kind).toBe("allowed");
  });

  it("refuses a location-scoped grant when the session is pinned to no location at all", () => {
    // Defensive: `device.location_id` is NOT NULL (034 I3), so this should be
    // unreachable — which is the reason to assert it. An unreachable branch that
    // fails OPEN is one schema change away from being the hole.
    const at = [grant({ role: "operator", scopeKind: "location", locationId: LOCATION_A })];
    expect(authorize(at, "scan.identify", { atLocation: null, now: NOW }).kind).toBe("refused_scope");
  });
});

describe("break-glass is refused by SHAPE as well as by grant (034 I5, 054 §6)", () => {
  // These would all be refused anyway today, because the role holds nothing. The
  // assertions exist for the day E11-B09 gives break-glass its read permission:
  // the shape check must already be the thing standing between an unexpiring
  // grant and that permission, rather than something added at the same time.
  const permission = "scan.session.read" as const;

  function breakGlassWith(over: Partial<MembershipRow>): MembershipRow[] {
    return [grant({ role: "support_break_glass", effectiveUntil: future(), reason: "ticket", ...over })];
  }

  it("drops a grant with no expiry", () => {
    const verdict = authorize(breakGlassWith({ effectiveUntil: null }), permission, {
      atLocation: LOCATION_A,
      now: NOW,
    });
    expect(verdict).toEqual({ kind: "refused_role", role: null });
  });

  it("drops a grant with no stated reason, and a blank one", () => {
    expect(
      authorize(breakGlassWith({ reason: null }), permission, { atLocation: LOCATION_A, now: NOW })
    ).toEqual({ kind: "refused_role", role: null });
    expect(
      authorize(breakGlassWith({ reason: "   " }), permission, { atLocation: LOCATION_A, now: NOW })
    ).toEqual({ kind: "refused_role", role: null });
  });

  it("drops a grant whose expiry has passed", () => {
    expect(
      authorize(breakGlassWith({ effectiveUntil: new Date(NOW.getTime() - 1) }), permission, {
        atLocation: LOCATION_A,
        now: NOW,
      })
    ).toEqual({ kind: "refused_role", role: null });
  });

  it("does not drop a WELL-FORMED grant — the check is a shape test, not a ban", () => {
    // It still refuses, on the empty grant list, and the refusal NAMES the role.
    // A shape check that silently swallowed a valid grant would make the day
    // break-glass gains a permission a debugging session.
    expect(authorize(breakGlassWith({}), permission, { atLocation: LOCATION_A, now: NOW })).toEqual({
      kind: "refused_role",
      role: "support_break_glass",
    });
  });

  it("leaves ordinary roles alone — an operator grant needs no expiry and no reason", () => {
    expect(
      authorize([grant({ role: "operator" })], permission, { atLocation: LOCATION_A, now: NOW }).kind
    ).toBe("allowed");
  });
});

describe("which decisions are recorded (054 §4.3, 022 P3)", () => {
  const allowed = { kind: "allowed", membershipId: "m", role: "owner" } as const;
  const refusedRole = { kind: "refused_role", role: "operator" } as const;
  const refusedScope = { kind: "refused_scope", role: "operator" } as const;
  const read = { mutating: false, privileged: false } as const;
  const write = { mutating: true, privileged: false } as const;
  const privilegedRead = { mutating: false, privileged: true } as const;

  it("records every refusal, on any method and any act", () => {
    expect(shouldRecord(refusedRole, read)).toBe(true);
    expect(shouldRecord(refusedScope, read)).toBe(true);
    expect(shouldRecord(refusedRole, write)).toBe(true);
    expect(shouldRecord(refusedRole, privilegedRead)).toBe(true);
  });

  it("records an allowance where the act MUTATES", () => {
    expect(shouldRecord(allowed, write)).toBe(true);
  });

  it("records an allowance where the act is PRIVILEGED, even with nothing to mutate", () => {
    // S5′: `issueInvitation` and `issueEnrollmentCode` are the two most
    // privileged acts in the system and are reached from scripts, so neither
    // has a route and neither had a `mutating` flag to be true. Under the first
    // version of this rule they recorded nothing at all.
    expect(shouldRecord(allowed, privilegedRead)).toBe(true);
  });

  it("records NOTHING for an ordinary allowed READ", () => {
    // The 022 P3 line, and the whole argument for the table being lawful: an
    // allowance on a READ route, joined through the membership, is a record of
    // what a named person looked at.
    expect(shouldRecord(allowed, read)).toBe(false);
  });

  it("marks exactly the two acts that change who or what may act at the shop", () => {
    // The flag is a property of the PERMISSION, so this is the whole of the
    // privileged set — and it is asserted rather than read off, because adding a
    // third should be a deliberate edit with a reviewer on it.
    const privileged = PERMISSION_NAMES.filter((p) => isPrivileged(p)).sort();
    expect(privileged).toEqual(["device.enrollment.issue", "membership.invite"]);
  });
});

function future(): Date {
  return new Date(NOW.getTime() + 60 * 60 * 1000);
}
