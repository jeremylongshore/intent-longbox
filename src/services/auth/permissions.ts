// THE ROLE→PERMISSION MATRIX, AS DATA — and the one function that reads it.
//
// Bead: longbox-e5b.3.3 (alias E03-B03). Docs: 054 §2–§5; 034 §2.6 (four roles,
// a closed enum), §2.7 (a membership is a GRANT with a scope), §3.1 (the request
// context), §3.2 (the three isolation layers); 048 §2.2, §3.5, §6.1, §12.3
// (*"the permission matrix … is E03-B03's. This record establishes WHO is asking
// and at WHICH shop; it grants nothing"*); 022 P3; 019 T24, T35.
//
// ============================================================================
// ONE TABLE, TWO READERS, NO SECOND SPELLING
// ============================================================================
//
// `ROLE_GRANTS` below is the ONLY statement in this repository of who may do
// what. Two things read it and nothing else may:
//
//   1. `authorize()` — the pure decision, called by the authentication hook for
//      every shop-scoped request and by the two issuance services the CLI reaches;
//   2. `tests/integration/rbac-matrix.test.ts` — which generates one HTTP case
//      per (role, route) PAIR from this constant, so the test and the constant
//      cannot drift. A row added here without a route to exercise it fails the
//      contract test; a route added without a row fails the hook, closed.
//
// **The matrix is versioned, and the version is recorded on every decision.**
// `authorization_decision.matrix_version` (migration 028) is what makes a past
// decision readable after this constant changes: memberships are append-only and
// reconstructible (034 §2.7), but the RULE that was applied to them is not — it
// is code, and code is not a row. Without the version, answering *"under what
// authority was this done"* about a decision taken before a matrix change means
// re-running today's rules over yesterday's grants and calling the answer
// history. That is the one thing this module refuses to let happen.
//
// ============================================================================
// WHAT THE MATRIX DELIBERATELY DOES NOT DIFFERENTIATE
// ============================================================================
//
// **`owner`, `manager` and `operator` hold the SAME nine scan-flow permissions,
// and that is a decision rather than an oversight.** 034 §2.6 gives the operator
// *"the scan flow"* and the manager *"the same surfaces, scoped to their
// locations"*; 031's representative shop is one owner and two operators who all
// stand at the same counter doing the same work. Inventing a differentiation the
// shop does not have — an operator who may photograph but not price, say — would
// be a permission system growing a UI, which is exactly what 034 §6 alternative 2
// refused. The three roles differ where the shop differs: who may bring a person
// or a phone into the shop.
//
// **`support_break_glass` holds NOTHING here, and that is the strongest sentence
// in the file.** Longbox's own support role cannot open a scan, cannot upload a
// photograph, cannot spend the shop's lookup budget and cannot send a draft to
// the shop's store. It is *"the only technical read path to per-operator data"*
// (034 §2.6, 022 P3) — a read path that is not an HTTP route and is not built
// here — and it is emphatically not an administrator. 022 P7's *"no invisible
// super-admin"* is enforced by an empty list rather than by a promise.
import type { Permission } from "../../contracts/v1/permissions.js";
import { PERMISSIONS, PERMISSION_NAMES, outranks } from "../../contracts/v1/permissions.js";
import type { MembershipRow, Role } from "./memberships.js";

/**
 * The matrix version, stamped on every `authorization_decision` row.
 *
 * SemVer over the GRANTS, not over this file: a comment change does not move it,
 * and any change to `ROLE_GRANTS` or `ROLE_GRANTABLE` must. `1.0.0` is the first
 * matrix; `tests/auth-permissions.test.ts` pins both the version and the full
 * grant set, so bumping one without the other is a red build.
 */
export const PERMISSION_MATRIX_VERSION = "1.0.0";

/** Every scan-flow permission, which the three shop roles hold identically. */
const SCAN_FLOW: readonly Permission[] = [
  "scan.session.open",
  "scan.session.read",
  "scan.photo.write",
  "scan.photo.read",
  "scan.identify",
  "scan.confirm",
  "condition.record",
  "pricing.request",
  "listing.draft.request",
];

/**
 * **THE MATRIX.** Four roles, and the permissions each holds.
 *
 * Read it as least privilege from the bottom up: an `operator` does the work, a
 * `manager` does the work and can staff and equip their own store, an `owner`
 * does everything a manager does at every location of the shop, and Longbox's
 * support role does none of it.
 */
export const ROLE_GRANTS: Record<Role, readonly Permission[]> = {
  owner: [...SCAN_FLOW, "membership.invite", "device.enrollment.issue"],
  manager: [...SCAN_FLOW, "membership.invite", "device.enrollment.issue"],
  operator: [...SCAN_FLOW],
  // NOT AN OVERSIGHT. See the header: break-glass is a read path, not an
  // administrator, and its read path is not an HTTP route.
  support_break_glass: [],
};

/**
 * **Nobody grants above their own rank** (048 §7.1, and the E03-D07 finding this
 * bead closes).
 *
 * `issueInvitation` checked that the inviter held *a* membership and nothing
 * else, so an `operator` could invite an `owner` — an escalation reachable from
 * `scripts/issue-invitation.ts` by anyone who could run it. The route table's
 * own comment claimed the service *"checks the role"*; it did not.
 *
 * The rule is data because it is a fact about ROLES, not about routes: a route
 * requires `membership.invite`, and this says what a holder of that permission
 * may hand out. An owner may name a second owner — 048 §8.2's recovery
 * nomination needs it, and a shop with exactly one owner and no second is a shop
 * one lost phone from having nobody. A manager may staff their store and may not
 * make another manager or an owner.
 */
export const ROLE_GRANTABLE: Record<Role, readonly Role[]> = {
  owner: ["owner", "manager", "operator"],
  manager: ["operator"],
  operator: [],
  support_break_glass: [],
};

/** May a person holding `actor` invite somebody as `target`? */
export function mayGrantRole(actor: Role, target: Role): boolean {
  return ROLE_GRANTABLE[actor].includes(target);
}

export type RefusalReason = "role" | "scope";

export type AuthorizationVerdict =
  | { readonly kind: "allowed"; readonly membershipId: string; readonly role: Role }
  /**
   * The role holds the permission, but not HERE — a location-scoped grant at
   * another location, or a location-scoped grant against a shop-scoped
   * permission. **Answered to the caller byte-identically to a shop that does
   * not exist** (019 T24, 048 §6.5): the hook turns it into `SHOP_NOT_FOUND`
   * with no `details`, exactly as it answers a caller who holds no membership at
   * all. A person standing at the wrong counter must not be able to learn that
   * the right counter exists.
   */
  | { readonly kind: "refused_scope"; readonly role: Role }
  /**
   * No membership this person holds grants the permission anywhere. Answered as
   * `PERMISSION_DENIED`, which is a fact about the caller's OWN role and
   * therefore discloses nothing they could not already see — the tenancy answer
   * above is the one that has to be indistinguishable.
   */
  | { readonly kind: "refused_role"; readonly role: Role | null };

/**
 * **THE DECISION. Pure, total, and the only place a permission is granted.**
 *
 * Inputs are the live memberships this person holds AT THIS SHOP (already
 * filtered for revocation and effective dates by `membershipsAt`), the
 * permission the route requires, and the LOCATION THE SESSION IS PINNED TO —
 * which comes from the enrolled device (048 §3.5) and never from a request.
 *
 * **Three filters, in this order, and the order is why the refusals differ.**
 *
 *   1. **Break-glass shape.** A `support_break_glass` membership that has no
 *      expiry, no stated reason, or an expiry already past grants NOTHING —
 *      dropped here, before its role is even consulted. 034 §2.7 puts both
 *      requirements in a database CHECK and `membershipsAt` filters the expiry in
 *      SQL; this is the third copy on purpose (034 §3.2's *"each layer fails
 *      differently"*), because the failure this guards against is the CHECK being
 *      dropped by a future migration, which no query and no constraint can catch.
 *   2. **Role.** Does `ROLE_GRANTS` give this membership's role the permission?
 *   3. **Scope.** Does this membership's scope cover the place the session is
 *      standing in? An organisation- or shop-scoped grant covers every location;
 *      a location-scoped grant covers its own location, and — for a
 *      `shop`-scoped PERMISSION — covers nothing, because running one storefront
 *      is not the same authority as changing who works at the shop.
 *
 * Splitting 2 from 3 is what lets the caller be told "your role cannot do this"
 * while a person at the wrong location is told nothing at all.
 */
export function authorize(
  memberships: readonly MembershipRow[],
  permission: Permission,
  context: { atLocation: string | null; now: Date }
): AuthorizationVerdict {
  const usable = memberships.filter((m) => breakGlassIsWellFormed(m, context.now));
  const byRole = usable.filter((m) => ROLE_GRANTS[m.role].includes(permission));

  if (byRole.length === 0) {
    return { kind: "refused_role", role: highestRoleOf(usable) };
  }
  const inScope = byRole.filter((m) => coversScope(m, permission, context.atLocation));
  if (inScope.length === 0) {
    return { kind: "refused_scope", role: highestRoleOf(byRole)! };
  }
  // The SAME rank `memberships.highestRole()` uses (054 §2.2 K3). What a request
  // context says a person IS and what an audit row says they ACTED AS cannot
  // disagree, because there is one table and both read it.
  const best = inScope.reduce((a, b) => (outranks(b.role, a.role) ? b : a));
  return { kind: "allowed", membershipId: best.id, role: best.role };
}

/**
 * 034 §2.7's two CHECKs, restated where a dropped CHECK cannot hide them, plus
 * the expiry predicate 034 I5 asks for.
 *
 * A non-break-glass membership is well-formed by definition — `effective_until`
 * is optional for a permanent grant, which is what a permanent grant IS.
 */
function breakGlassIsWellFormed(m: MembershipRow, now: Date): boolean {
  if (m.role !== "support_break_glass") return true;
  if (m.effectiveUntil === null) return false;
  if (m.reason === null || m.reason.trim().length === 0) return false;
  return m.effectiveUntil.getTime() > now.getTime();
}

/** Does this grant's scope reach the permission's scope at this location? */
function coversScope(m: MembershipRow, permission: Permission, atLocation: string | null): boolean {
  if (m.scopeKind === "organization" || m.scopeKind === "shop") return true;
  // A location-scoped grant, from here down.
  if (PERMISSIONS[permission].scope === "shop") return false;
  if (atLocation === null) return false;
  return m.locationId === atLocation;
}

function highestRoleOf(memberships: readonly MembershipRow[]): Role | null {
  if (memberships.length === 0) return null;
  return memberships.reduce((a, b) => (outranks(b.role, a.role) ? b : a)).role;
}

/**
 * Every permission the matrix names is required by some route, and every route
 * that resolves a role requires one. Exported so the contract test reads the
 * same list the hook does rather than a copy of it.
 */
export const GRANTED_PERMISSIONS: readonly Permission[] = PERMISSION_NAMES.filter((p) =>
  Object.values(ROLE_GRANTS).some((granted) => granted.includes(p))
);
