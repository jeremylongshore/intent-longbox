// `identity` — the audited accessor. **The only public surface of this module.**
//
// Bead: longbox-e5b.3.27 (alias E03-D17). Docs: 000-docs/060 in full; 019 T35(b)
// (NON-WAIVABLE, and OPEN with no owner until this bead); 034 §3.3; 048 §12.4
// row 6, §3.5; 054 §8; 022 P3; 029 §2, §3.1, §3.3.
//
// ============================================================================
// WHY A DIRECTORY OF ITS OWN, AND WHAT IT IS NOT
// ============================================================================
//
// **This is NOT a tenth module in 029 §3.1's layer stack.** The identity module
// already exists in the flat layout as `src/services/auth/` — `authorizationAudit.ts`
// says so in as many words ("It lives inside the identity module, which is where
// 034 §3.3 puts every such read"). This directory is that module's AUDITED
// ACCESSOR: a sub-boundary inside it, which becomes `src/modules/identity/access/`
// when E02-B03 move 3 relocates the flat layout. An edge from
// `src/services/auth/api.ts` into here is identity→identity and creates no new
// layer edge.
//
// **It is a directory rather than a file because the rule needs a path to key
// on.** `src/catalog/`'s precedent is exact (E04-D01): two `.dependency-cruiser.cjs`
// rules — `identity-public-surface-only` and `identity-reaches-only-platform` —
// make this barrel the module's one door and make the module unable to reach
// anything but the database and the process's own configuration. Neither is
// expressible over a file inside a 22-file directory whose siblings freely import
// `pg`, the contract layer and each other.
//
// **And the direction that matters is the one the import graph CANNOT see.** No
// dependency rule can stop a file elsewhere from writing `JOIN app_user` in a
// string. That half is `pnpm arch`'s `identity-is-the-only-person-join`, over
// `src/` AND `scripts/`, and it is the half 019 T35(b) actually asks for.
//
// ============================================================================
// THE CONTRACT, AND HOW MUCH OF IT THIS BEAD CLOSES
// ============================================================================
//
// 034 §3.3, verbatim:
//
//   > *"Exactly one module — `identity` — may `SELECT` `operator_id`,
//     `created_by` or `confirmed_by`, through one named, audited accessor
//     function. Every call to it requires the `support_break_glass` role, writes
//     an access-audit row before returning, and is covered by the T34 heartbeat.
//     No other module, route, view, export or report may name those columns in a
//     projection."*
//
// **CLOSED here:** the module, the audited accessor, the access-audit row on
// every call, the gate that makes it the only person-join in the tree, and the
// reconciliation that reads the rows back (`pnpm audit:identity-access`).
//
// **NOT closed, and named rather than glossed:**
//
//   * *"requires the `support_break_glass` role"* — and the reason is NOT the
//     one v1.0.0 gave. That version said *"the reads that resolve a third
//     party's record do not exist yet"*, and the security lens's F4 reproduced
//     that this is **false**: the roster hands EVERY operator's display name at
//     the shop to any live device session, and `pnpm enroll-authenticator` reads
//     another person's email. Two of the three surfaces here resolve third
//     parties, and saying otherwise was the record describing a system it did
//     not have.
//
//     **What actually bounds them is not a role.** The roster is bounded by a
//     live DEVICE session at that shop (048 R8 — "who works here" is a per-shop
//     datum a passer-by on the same Wi-Fi has no claim on), by a TWO-COLUMN
//     projection, and by an activity-independent sort: it is a list of who could
//     be holding the phone and cannot become a list of what they did. The
//     enrollment CLI is bounded by schema-owner database access plus a shell on
//     the host. `support_break_glass` is not among those bounds and cannot
//     become one — it holds NOTHING (054 §3), so requiring it would make the
//     counter flow unreachable rather than gated. The role belongs to a
//     surface that renders a NAMED person's RECORD to somebody who is not them,
//     which is E11-B09's read path — and E11-B09 reaches it *through* this
//     module rather than around it. 000-docs/060 §4.3.
//   * *"covered by the T34 heartbeat"* — a heartbeat needs a scheduler, and
//     every detector's is **E13-B04-D1 (`longbox-e5b.13.4.1`)**. The audit is the
//     query and its exit code; a detector nobody runs reports nothing.
//
// So 019 T35(b) moves from OPEN-with-no-owner to **instrumented**, and the 019
// amendment row says exactly that and no more.
export { recordIdentityAccess, type IdentityAccessContext } from "./access.js";
export {
  resolvePersonByKey,
  resolvePersonForAuthenticatorEnrollment,
  resolveShopRoster,
  type Person,
  type PersonWithLoginIdentifier,
} from "./accessors.js";
export {
  accessorKey,
  DECLARED_ACCESSOR_KEYS,
  DECLARED_ACCESSORS,
  httpAccessor,
  IDENTITY_KEY_KINDS,
  IDENTITY_PURPOSES,
  isDeclaredAccess,
  UndeclaredAccessorError,
  type ObservedRoute,
  PURPOSE_PROSE,
  type DeclaredAccessor,
  type IdentityKeyKind,
  type IdentityPurpose,
} from "./purposes.js";
