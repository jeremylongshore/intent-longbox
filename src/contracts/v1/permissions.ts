// THE PERMISSION VOCABULARY — what a route may ask for, in the contract layer.
//
// Bead: longbox-e5b.3.3 (alias E03-B03). Docs: 034 §2.6 (the closed role enum),
// §3.1 (the request context's `role`), 048 §12.3 ("the permission matrix … is
// E03-B03's"), 042 §3.1 (the declared route table), 022 P3, 019 T24/T35.
//
// ============================================================================
// WHY THE VOCABULARY IS HERE AND THE GRANT IS NOT
// ============================================================================
//
// A route DECLARES the permission it requires; it does not decide who holds it.
// So the NAME of a permission — and the scope at which it is held, and the
// sentence explaining what it lets a person do — lives beside the route table it
// annotates, and the ROLE→permission grant lives in the identity module
// (`src/services/auth/permissions.ts`), which is the only module that knows what
// a membership is.
//
// **The split is the least-privilege property, not a filing preference.** With
// the grant in this file, a route could be added and given its own permission and
// its own grant in one edit, by one author, in the layer that wants the route to
// work. With the grant one module away, adding a route can only ever NAME an
// existing permission — widening who holds one is an edit to the identity module,
// which is where a reviewer looks for exactly that.
//
// ============================================================================
// THIS IS A CLOSED LIST, AND 034 §6 ALTERNATIVE 2 IS WHY
// ============================================================================
//
// 034 rejected "a `role` table with permission rows" because *"a permission
// system is a SURFACE: it grows a UI, an admin screen and a way to grant yourself
// more"*. The same argument applies one level down, so this list is closed by two
// mechanisms rather than by intent:
//
//   1. every permission here is REQUIRED by at least one row of the route table —
//      a permission nothing asks for is a permission somebody invented, and
//      `tests/contract/permission-enforcement.test.ts` fails the build on one;
//   2. the grants are a constant, not rows — there is no write path, no
//      migration and no admin screen that can move a permission between roles.
//
// A fifth role, or a permission with no route, is therefore a deliberate code
// change with a reviewer on it, which 034 §2.6 calls *"the correct cost"*.
//
// ============================================================================
// THE PROSE IS PART OF THE ARTIFACT (021)
// ============================================================================
//
// Each row carries an `explanation` written for a person who does not read this
// repository — the sentence an owner would be shown if a screen ever explained
// what their staff can do. It states an act, never a capability of the system,
// and it names no threshold, no statute and no measurement of a person. 021's
// registered copy is still the only place a customer-facing string may come from;
// these are the developer-facing statements those strings would be written from.

/**
 * The scope at which a permission is held.
 *
 * `location` — the permission is exercised AT a place, so a membership granted
 * at one location covers that location and no other. An organisation- or
 * shop-scoped membership covers every location in the shop, which is what makes
 * an owner able to work at either counter without a second grant.
 *
 * `shop` — the permission is about the shop itself rather than about work done
 * at a place, so a location-scoped membership does NOT carry it. A manager
 * responsible for one storefront can run that storefront; adding a person to the
 * shop's roster is not a thing that happens at a counter.
 *
 * There is deliberately no `organization` value. 034 §2.2 keeps `organization`
 * as the legal and billing entity and gives it no operational surface, so a
 * permission held "at the organisation" would be a scope with nothing in it. An
 * organisation-scoped MEMBERSHIP exists and covers every shop-scoped permission
 * at its shops; that is the direction the scope is read in.
 */
export type PermissionScope = "location" | "shop";

/**
 * **034 §2.6's closed role enum, spelled ONCE.**
 *
 * It lives in the contract layer because it is a ratified, wire-visible fact
 * rather than an implementation detail of a query: it is the `CHECK` on
 * `membership.role`, the `CHECK` on `authorization_decision.role`, and the
 * vocabulary every other module's `Role` type is derived from. A fifth role is a
 * migration, an edit here, and a deliberate decision — which 034 §2.6 calls
 * *"the correct cost"*.
 */
export const ROLE_NAMES = ["owner", "manager", "operator", "support_break_glass"] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

/**
 * **THE RANK — one table, two readers, and the reason it is here rather than in
 * either of them.**
 *
 * Two questions in this system need roles ordered, and they are different
 * questions asked by different modules:
 *
 *   1. `memberships.highestRole()` — 034 §3.1's *"the highest role held at this
 *      scope"*, which fills `RequestContext.role`: **what is this person, here?**
 *   2. `permissions.authorize()` — when several live grants would each allow the
 *      act, which one does the `authorization_decision` row NAME:  **what did
 *      they act as?**
 *
 * They were separate constants with identical values and a comment explaining
 * why, and **the consistency lens refused the comment as a mechanism** (054 §2.2
 * K3): *"either derive one from the other, or assert their agreement in a test,
 * so the day they diverge is a build failure rather than an inconsistency
 * between what a request context says a person IS and what an audit row says
 * they ACTED AS."* Derivation is the stronger of the two options offered, so
 * both readers now import this, and `tests/contract/permission-enforcement.test.ts`
 * asserts that no second rank table exists anywhere under `src/`.
 *
 * ⚠ **IT STILL GRANTS NOTHING.** A permission is held because `ROLE_GRANTS` says
 * so and for no other reason. This orders roles; it does not compare them
 * against a threshold, and a rank that started deciding permissions would be a
 * policy made from a lookup table — which is the objection 034 §2.6 raises
 * against a `role` table in the first place. `support_break_glass` sits BELOW
 * `owner` and `manager` deliberately (034 §2.6): it is a distinct named role and
 * never a policy overlay on an admin session, so ranking it at the top would
 * quietly make it the super-admin 022 P7 says does not exist here.
 */
export const ROLE_RANK: Record<RoleName, number> = {
  owner: 4,
  manager: 3,
  support_break_glass: 2,
  operator: 1,
};

/** The higher-ranked of two roles. Ties are impossible — every rank is distinct (asserted). */
export function outranks(a: RoleName, b: RoleName): boolean {
  return ROLE_RANK[a] > ROLE_RANK[b];
}

export interface PermissionSpec {
  readonly scope: PermissionScope;
  /** Plain English, for a person who does not read code. No jargon, no numbers. */
  readonly explanation: string;
  /** The record or finding this permission exists to satisfy. */
  readonly implements: string;
  /**
   * **A PRIVILEGED act: one that changes who or what may act at this shop**
   * (054 §4.3, the security lens's S5′).
   *
   * It is a property of the PERMISSION and not of the route, which is the whole
   * reason the flag exists. `shouldRecord` originally keyed on whether the ROUTE
   * mutated — and the two most privileged acts in the system, inviting a person
   * and enrolling a phone, are reached from CLI scripts that have no route and
   * therefore no `mutating` flag, so they recorded nothing at all. A grant that
   * records who created it does not record under what authority they were
   * allowed to.
   *
   * Absent means false, and the default is the right one: a scan-flow permission
   * is not privileged, and a new permission has to say that it is.
   */
  readonly privileged?: true;
}

export const PERMISSIONS = {
  "scan.session.open": {
    scope: "location",
    explanation: "Start a new scan for a book at this store.",
    implements: "042 §3.1's route table; the scan flow is the whole of the pilot's work",
  },
  "scan.session.read": {
    scope: "location",
    explanation: "Open a scan that is in progress at this store and see what has been recorded on it.",
    implements: "042 §3.1; 040 §4's derived state is read through this route",
  },
  "scan.photo.write": {
    scope: "location",
    explanation: "Add a photograph of the book to a scan at this store.",
    implements: "E03-B07's upload guard sits behind this permission",
  },
  "scan.photo.read": {
    scope: "location",
    explanation: "Look at a photograph already taken for a scan at this store.",
    implements: "E03-D05 — the tenant-scoped replacement for the deleted public uploads mount",
  },
  "scan.identify": {
    scope: "location",
    explanation:
      "Ask the system to work out which book is in the photograph. This spends the shop's own " +
      "budget for outside lookups, which is why it is named separately from the rest of the scan.",
    implements: "042 §8.2 — the only metered route; 050 §6 spend ownership",
  },
  "scan.confirm": {
    scope: "location",
    explanation: "Confirm which book it is. The person decides; nothing is confirmed on their behalf.",
    implements: "locked decision 7's evidence gate; 040 §4's confirmation transition",
  },
  "condition.record": {
    scope: "location",
    explanation: "Record the condition of the book as a grade range and a list of what is wrong with it.",
    implements: "locked decision 5 / 037 — a range and callouts, never a single number",
  },
  "pricing.request": {
    scope: "location",
    explanation: "Ask for the price sources to be read and a suggested price to be worked out.",
    implements: "042 §3.1; 011's dual-source pricing",
  },
  "listing.draft.request": {
    scope: "location",
    explanation:
      "Send the finished scan to the shop's store as a DRAFT for the owner to review. It never " +
      "publishes anything.",
    implements: "locked decision 3 — DRAFT only, a person publishes; 043's outbox job",
  },
  "membership.invite": {
    scope: "shop",
    privileged: true,
    explanation:
      "Invite a person to work at this shop, and choose what they may do. Inviting somebody does " +
      "not give them anything you do not already hold yourself.",
    implements:
      "048 §7.1 — issuance is an owner/manager act in a privileged session (E03-D11). The " +
      "companion rule that nobody may grant above their own rank is ROLE_GRANTABLE in the " +
      "identity module, because it is a fact about roles rather than about routes.",
  },
  "device.enrollment.issue": {
    scope: "location",
    privileged: true,
    explanation: "Set up a new phone or counter device for this store.",
    implements: "048 §7.3 — 'an owner or manager, IN A PRIVILEGED SESSION' (E03-D11)",
  },
} as const satisfies Record<string, PermissionSpec>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export function permissionScope(permission: Permission): PermissionScope {
  return PERMISSIONS[permission].scope;
}

/** Does this permission change who or what may act at the shop (054 §4.3)? */
export function isPrivileged(permission: Permission): boolean {
  // `PERMISSIONS` is `as const`, so a row that omits the optional flag has no
  // such property in its literal type at all. The widened view is the honest
  // read of "absent means false" and keeps the flag optional, which is what
  // makes a new permission non-privileged unless it says otherwise.
  return (PERMISSIONS[permission] as PermissionSpec).privileged === true;
}

// ===========================================================================
// THE SELF-SERVICE MARKER — E03-D24 (000-docs/063 §3.1)
// ===========================================================================

/**
 * **What a route declares when NO GRANT DECIDES IT, because its subject is the
 * caller's own person.**
 *
 * ⚠ **IT IS NOT A PERMISSION AND IS DELIBERATELY NOT IN `PERMISSIONS`.** Every
 * member of that map is an answer to *"may this ROLE act on this SHOP's
 * things"*: each one carries a `scope` of `shop` or `location`, each is decided
 * against a MEMBERSHIP, and `authorize()` reads the grants a person holds AT ONE
 * SHOP. A person's password and their second factor are not one shop's things.
 * `user_credential` and `user_authenticator` carry no `shop_id` at all and are
 * declared row-level-security exemptions for exactly that reason (056 §11 R9,
 * 057 §9 R7): a person may hold memberships at several shops (034 §2.6) and has
 * ONE password across all of them.
 *
 * **So a permission would be a category error with a failure mode.** Keyed on a
 * membership, "may I change my own password" would be answered per shop — and
 * the first shop whose role did not carry it would make a person unable to
 * change a password that is not that shop's to withhold. The marker says the
 * true thing instead: *the caller's own identity is the whole of the authority,
 * and no grant was consulted.*
 *
 * **It is still a DECLARED VALUE and the hook still fails closed.** A privileged
 * route that declares neither a permission nor this marker is REFUSED (054 §3's
 * default, one principal over), so the class is entered by writing a word with a
 * reason beside it — never by an omission. That is the same property 057 §4.4
 * built the auth-allowlist `selfService` flag for; this marker REPLACES that
 * flag, so the rule has one home in the table every route already declares in
 * rather than two homes that can disagree (000-docs/063 §3.2).
 *
 * **The class is closed by argument as well as by type.** A route joins it only
 * when every row it reads or writes is keyed on the CALLER'S OWN
 * `app_user_id` — their session, their credential, their authenticator, their
 * recovery set. A route that touches another person's anything, a membership, a
 * device or a shop's configuration is not self-service however it is spelled,
 * and the permission it needs is a decision for 054's matrix.
 */
export const SELF_SERVICE = "self_service" as const;

/** What `RouteSpec.requires` may hold: a permission, the marker, or nothing yet. */
export type RouteAuthority = Permission | typeof SELF_SERVICE;

/** Is this authority the self-service marker rather than a permission? */
export function isSelfService(value: RouteAuthority | null | undefined): value is typeof SELF_SERVICE {
  return value === SELF_SERVICE;
}
