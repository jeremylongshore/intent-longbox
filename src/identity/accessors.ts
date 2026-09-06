// THE FOUR READS IN THIS SYSTEM THAT TURN A KEY INTO A PERSON.
//
// Bead: longbox-e5b.3.27 (alias E03-D17). Docs: 000-docs/060 in full;
// 019 T35(b) (NON-WAIVABLE — *"`created_by`/`operator_id` selectable only inside
// one audited accessor module"*); 034 §3.3 (the contract, verbatim); 048 §3.5
// (the operator picker, and the roster/leaderboard line), §7.1 (an invitation
// names its person), §4.3 (the otpauth label); 054 §8 (the fifth path); 022 P3.
//
// ============================================================================
// WHY THESE FOUR AND NOT MORE
// ============================================================================
//
// Every read in `src/` and `scripts/` that projects a person's attributes was
// enumerated by grep before this module existed, and there were five: two copies
// of the same display-name lookup (`src/services/auth/api.ts`'s `readUser` and
// `src/services/auth/people.ts`'s `readPerson`, which had drifted into being the
// same query in two files), the operator picker's roster, the invitation
// receipt's, and `pnpm enroll-authenticator`'s otpauth label. They are the four
// functions below; the duplicate is gone.
//
// **What is NOT here, and why each absence is a decision and not an oversight:**
//
//   * `findPersonIdByEmail` (`src/services/auth/credentials.ts`) — projects
//     `u.id` ALONE, from a value the caller supplied. It resolves nothing about
//     a person the caller did not already name, and it is the FIRST statement of
//     an unauthenticated sign-in: routing it through here would let anybody with
//     a socket grow `identity_access` without holding a session. It is a
//     declared exemption row in `pnpm arch`'s rule, with that reason
//     (000-docs/060 §5.3).
//   * `upsertPerson` and the two `register-shop` inserts — WRITES. A write
//     carries a name INTO the database that the caller already holds; the
//     disclosure direction is the opposite one. `upsertPerson` did return
//     `display_name` and no longer does: `RETURNING id` is all any caller used.
//   * `unreconciledBreakGlassSessions` (`src/services/auth/authorizationAudit.ts`)
//     — projects `app_session.app_user_id`, which is an operator identifier and
//     NOT a person's attributes. 019 T35(c) needs it and 054 §6 sanctions it;
//     turning that id into a NAME is what this module gates, and the
//     reconciliation deliberately never does.

import type { Queryable, Tx } from "../db.js";
import { recordIdentityAccess, type IdentityAccessContext } from "./access.js";

/** A person, as far as anything outside this module is ever allowed to see one. */
export interface Person {
  readonly id: string;
  readonly display_name: string;
}

/** A person, plus the login identifier an authenticator label needs. */
export interface PersonWithLoginIdentifier extends Person {
  /**
   * `app_user.email` — a LOGIN IDENTIFIER and not a delivery channel (048 §7.2:
   * no mailer exists in this repository and this system does not invent one).
   * Reached by exactly one accessor, which prints it into an otpauth URI on a
   * terminal the person is standing at.
   */
  readonly email: string;
}

/**
 * **One person, by key.**
 *
 * ⚠ **THIS WAS TWO FUNCTIONS AT v1.0.0 AND THE DATA-MODEL LENS WAS RIGHT TO
 * REFUSE THAT** (Hickey 4). `resolvePersonForSession` and
 * `resolvePersonForInvitation` issued the IDENTICAL statement and differed only
 * in the `purpose` their caller cited. The argument for keeping them apart was
 * that one function taking a purpose lets a caller cite the wrong one by copying
 * a line — but `isDeclaredAccess` already polices the (method, path, purpose)
 * triple, and since the security lens's F3 the pair is OBSERVED from the request
 * and the triple is checked at `httpAccessor` before any read. So the split
 * bought nothing the declaration did not already buy, and cost a second copy of
 * the one statement this module exists to have exactly one of — which is the
 * defect it was built to remove, reintroduced by the removal.
 *
 * Returns `undefined` rather than throwing, deliberately: an accessor is a data
 * read and the HTTP consequence of "no such person" differs by caller — the
 * operator-session route answers `SESSION_REQUIRED`, the invitation route
 * `INVITATION_INVALID`. A module that threw would be choosing a caller's refusal
 * code, and 048 §9.3's constant-answer rule is the caller's to keep.
 *
 * **The fact is written even when nobody is found** (`resolved_count = 0`). An
 * access that resolved nobody still happened, and a rule that only recorded
 * successes would leave a probing accessor invisible.
 */
export async function resolvePersonByKey(
  db: Queryable | Tx,
  context: IdentityAccessContext,
  appUserId: string
): Promise<Person | undefined> {
  const res = await db.query(`SELECT u.id, u.display_name FROM app_user u WHERE u.id = $1`, [appUserId]);
  const row = res.rows[0] as Person | undefined;
  await recordIdentityAccess(db, context, "app_user_id", row === undefined ? 0 : 1);
  return row;
}

/**
 * **The operator picker's payload, and the line 022 P3 is easiest to breach by
 * accident** (048 §3.5, I7). Moved here from `src/services/auth/memberships.ts`
 * unchanged, because it is the one bulk person-read in the system.
 *
 * The picker is an AUTHENTICATION AFFORDANCE. It may show the roster of display
 * names for the shop. It may **not** be ordered by recency or activity, carry a
 * count, a "last used", a badge, a streak or any per-person datum whatsoever.
 *
 * Stated plainly, because the difference is one line of SQL: **a roster is a list
 * of who could be holding the phone; a leaderboard is a list of what they did.**
 * So the projection is two columns and the sort is `display_name, id` — stable,
 * activity-independent, and unable to become an ordering by anything a person
 * did even if a later reader adds a join.
 *
 * The roster renders only to a live device session (048 R8): "who works here" is
 * a per-shop datum a passer-by on the same Wi-Fi has no claim on.
 *
 * Its `key_kind` is `shop_roster` and not `app_user_id`: the key resolved is a
 * SHOP, and a bulk read that recorded itself as a single-person lookup would
 * make the one shape an audit most wants to see indistinguishable from the
 * commonest one.
 */
export async function resolveShopRoster(
  db: Queryable | Tx,
  context: IdentityAccessContext,
  shopId: string
): Promise<Person[]> {
  const res = await db.query(
    `SELECT DISTINCT u.id, u.display_name
       FROM membership m
       JOIN app_user u ON u.id = m.app_user_id
      WHERE m.shop_id = $1
        AND u.status = 'active'
        AND m.role <> 'support_break_glass'
        AND membership_is_live(m)
      ORDER BY u.display_name, u.id`,
    [shopId]
  );
  const rows = res.rows as Person[];
  await recordIdentityAccess(db, context, "shop_roster", rows.length);
  return rows;
}

/**
 * **The login identifier an otpauth label needs** (048 §4.3).
 *
 * The ONE accessor that projects `email`, and it exists because an authenticator
 * app showing `Longbox: 7f3a…` is an authenticator app nobody can tell apart
 * from the other one on the same phone. It is reached from a schema-owner CLI
 * with no tenant — a second factor belongs to a PERSON (034 §2.6) — so its fact
 * carries a NULL `shop_id`, which `migrations/035`'s CHECK ties to
 * `accessor_method = 'CLI'` and which the tenant policy makes unwritable by the
 * running server.
 */
export async function resolvePersonForAuthenticatorEnrollment(
  db: Queryable | Tx,
  context: IdentityAccessContext,
  appUserId: string
): Promise<PersonWithLoginIdentifier | undefined> {
  const res = await db.query(`SELECT u.id, u.email, u.display_name FROM app_user u WHERE u.id = $1`, [
    appUserId,
  ]);
  const row = res.rows[0] as PersonWithLoginIdentifier | undefined;
  await recordIdentityAccess(db, context, "app_user_id", row === undefined ? 0 : 1);
  return row;
}
