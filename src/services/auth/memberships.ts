// Tenancy resolution and the operator roster.
//
// **048 §6.1: `shop_id` is resolved from the session's MEMBERSHIPS, before any
// handler runs. The `shopId` in the URL is a value to be CHECKED against it,
// never the tenant itself.** That is 034 §3.1's `RequestContext` finally having
// something trustworthy to fill in, and it is the sentence 046 §9.2 put on this
// bead.
import { outranks, type RoleName } from "../../contracts/v1/permissions.js";
import type { Queryable, Tx } from "../../db.js";
import { retireOperatorPins } from "./pin.js";
import { revokeSessionsOf } from "./sessions.js";

/**
 * 034 §2.6's four roles.
 *
 * **DERIVED, not re-spelled** (054 §2.2 K3): the closed enum and its rank live
 * in `src/contracts/v1/permissions.ts`, because the same four names are the
 * `membership.role` CHECK, the `authorization_decision.role` CHECK and the
 * vocabulary the matrix is keyed on. This alias exists so the many callers that
 * import `Role` from the identity module keep working; it is the same type.
 *
 * The rank this module uses for *"the highest role held at that scope"* (034
 * §3.1) is now the SAME constant `authorize()` uses to choose which grant an
 * audit row names. They were two identical tables with a comment explaining why,
 * and a comment is not a mechanism.
 */
export type Role = RoleName;

export interface MembershipScope {
  shopId: string;
  role: Role;
  locationId: string | null;
}

/**
 * ONE live grant, in the shape the permission decision reads (E03-B03).
 *
 * It carries the grant's `id` because that is what an `authorization_decision`
 * row names — the AUTHORITY the act was taken under, which a role name alone
 * cannot identify when a person holds two — and its `scopeKind` / `locationId`
 * because 054 §3's scope rule is a property of the grant rather than of the
 * person. `effectiveUntil` and `reason` are here for one role only: 034 §2.7
 * requires a `support_break_glass` grant to carry both, and `authorize()` checks
 * that in code as well as in the database's CHECK (034 §3.2's "each layer fails
 * differently" — a CHECK cannot notice its own removal).
 */
export interface MembershipRow {
  id: string;
  role: Role;
  scopeKind: "organization" | "shop" | "location";
  locationId: string | null;
  effectiveUntil: Date | null;
  reason: string | null;
}

/**
 * **Membership-first EXECUTION, not merely membership-first logic (048 R13).**
 *
 * §6.1 says `shop_id` is resolved from the session's memberships. It does not say
 * what the resolver may touch on the way, and the difference is an oracle: a
 * lookup of the URL's shop followed by a membership check on the result answers
 * "exists but not yours" and "does not exist" in measurably different time.
 *
 * So this is ONE query ROOTED AT `membership`, with the `app_user_id` and the
 * live-revocation predicate applied, joining `shop` rather than starting from it.
 * A shop the caller holds no membership at is a shop whose row this request never
 * loads — no timing difference, no log line, no distinguishable error path. §6.5
 * makes the two answers the same; this makes them cost the same, and the second
 * is what survives an attacker with a stopwatch.
 */
export async function membershipAt(
  db: Queryable,
  appUserId: string,
  shopId: string
): Promise<MembershipScope | undefined> {
  const rows = await membershipsAt(db, appUserId, shopId);
  if (rows.length === 0) return undefined;
  const best = rows.reduce((a, b) => (outranks(b.role, a.role) ? b : a));
  return { shopId, role: best.role, locationId: best.locationId };
}

/**
 * **EVERY live grant this person holds at this shop** — the query above, widened
 * from one row to all of them (E03-B03).
 *
 * `membershipAt` answers 034 §3.1's *"the highest role held at this scope"*,
 * which is the right answer for a request context and the WRONG input to a
 * permission decision. A person can hold two grants at one shop — 034 §2.7's
 * *"a role change is two rows"* makes that a normal state during a handover, and
 * a location-scoped manager who also holds a shop-scoped operator grant is a
 * shape the schema allows today. Collapsing those to one role before deciding
 * throws away the SCOPE that decides, and it can throw away the grant that would
 * have allowed the act while keeping the one that does not.
 *
 * So the decision reads all of them and `authorize()` picks (054 §3). The SQL is
 * unchanged in every property that matters: ONE query, ROOTED AT `membership`,
 * joining `shop` rather than starting from it, so a shop this person holds no
 * grant at is a shop whose row this request never loads (048 R13's
 * membership-first EXECUTION, and its timing half).
 */
export async function membershipsAt(
  db: Queryable,
  appUserId: string,
  shopId: string
): Promise<MembershipRow[]> {
  const res = await db.query(
    `SELECT m.id, m.role, m.scope_kind, m.location_id, m.effective_until, m.reason
       FROM membership m
       JOIN shop s ON s.id = m.shop_id
      WHERE m.app_user_id = $1
        AND m.shop_id = $2
        AND m.effective_from <= now()
        AND (m.effective_until IS NULL OR m.effective_until > now())
        AND NOT EXISTS (
              SELECT 1 FROM membership_revocation r WHERE r.membership_id = m.id)`,
    [appUserId, shopId]
  );
  return (
    res.rows as Array<{
      id: string;
      role: Role;
      scope_kind: MembershipRow["scopeKind"];
      location_id: string | null;
      effective_until: Date | string | null;
      reason: string | null;
    }>
  ).map((r) => ({
    id: r.id,
    role: r.role,
    scopeKind: r.scope_kind,
    locationId: r.location_id,
    effectiveUntil: r.effective_until === null ? null : new Date(r.effective_until),
    reason: r.reason,
  }));
}

/**
 * 034 §3.1's *"the highest role held at this scope"*, over rows already read.
 *
 * It is what fills `RequestContext.role`, and — as ever — **it grants nothing**:
 * `authorize()` reads the individual grants, not this. The two exist together
 * because they answer different questions, and the request context's question
 * ("what is this person here?") has an answer even when the permission
 * question's answer is no.
 */
export function highestRole(memberships: readonly MembershipRow[]): Role | undefined {
  if (memberships.length === 0) return undefined;
  return memberships.reduce((a, b) => (outranks(b.role, a.role) ? b : a)).role;
}

export interface ShopSummary {
  id: string;
  name: string;
  slug: string;
}

/**
 * ***MY SHOPS*** — 048 §6.4, and the query that retires the tenancy allowlist's
 * last `defect` row.
 *
 * What this replaced was `SELECT id, name, slug FROM shop ORDER BY created_at`
 * with no caller and no predicate: every shop in the database to anybody who
 * could reach the port (042 E4, 034 E9, a live 019 T24 exposure). The fix is not
 * a filter bolted onto that query — it is a query rooted somewhere else.
 *
 * **Two principals, two answers, one rule.**
 *   - A **device-only** session (no operator yet) gets *exactly the one shop the
 *     device is enrolled to* (§6.4's own words). That is not a lookup of a shop
 *     id a caller supplied — it is the enrollment fact the device session
 *     already carries, so there is nothing to enumerate and no oracle to build.
 *   - A **device+operator** session gets the shop **the session pins**, and only
 *     when the operator holds a live membership there. The query is ROOTED AT
 *     `membership` and joins `shop` (R13's membership-first EXECUTION), never a
 *     lookup of the shop followed by a membership check on the result.
 *
 * **Only the second branch is membership-rooted, and that is not sloppiness.** A
 * device-only session names no person, so it HOLDS no membership: there is
 * nothing for R13 to root at. Its shop comes from the enrollment id the session
 * already carries, which is why reading `shop` directly there is not the oracle
 * R13 forbids — the forbidden shape is a lookup of a shop id a CALLER supplied
 * followed by a membership check on the result, and no caller supplied this one.
 *
 * ⚠ **048 §6.4 IS AMENDED TO v1.3.0 FOR THIS** (E03-D08 invariant review,
 * ratified by the acting head 2026-09-04). §6.4 read "the shops the caller holds
 * a live membership at", which for an operator with memberships at two shops
 * would list both. It now returns the pinned shop, on two grounds: 048 §3.5 pins
 * `shop_id`/`location_id` on the DEVICE session and denormalizes them onto the
 * operator session, so every other shop already answers `SHOP_NOT_FOUND` (§6.5,
 * hook step 5) and listing one would be a picker whose every other entry 404s —
 * and it would disclose the NAME of another shop the person works at to whoever
 * is holding this shop's counter phone, a per-person datum 022 P3 and 019 T35
 * keep off this surface. The DTO stays an array so a genuinely multi-shop
 * session needs no wire change.
 *
 * **The consequence, stated because it is a PRODUCT decision and not a display
 * narrowing: an operator with memberships at two shops CANNOT SWITCH SHOPS FROM
 * THE PICKER.** Switching shops is a device re-enrollment (048 §7.3) — the phone
 * is the thing bound to a shop — so there is no in-app shop switch for anybody.
 * Right for a counter phone that lives in one store, wrong for a roaming owner
 * with two storefronts; the roaming case is not served by v0 and is E03-D07's to
 * reconsider when enrollment gets its screens.
 */
export async function shopsForSession(
  db: Queryable,
  session: { appUserId?: string; shopId: string }
): Promise<ShopSummary[]> {
  if (session.appUserId === undefined) {
    const res = await db.query(`SELECT id, name, slug FROM shop WHERE id = $1`, [session.shopId]);
    return res.rows as ShopSummary[];
  }
  const res = await db.query(
    `SELECT DISTINCT s.id, s.name, s.slug
       FROM membership m
       JOIN shop s ON s.id = m.shop_id
      WHERE m.app_user_id = $1
        AND m.shop_id = $2
        AND m.effective_from <= now()
        AND (m.effective_until IS NULL OR m.effective_until > now())
        AND NOT EXISTS (
              SELECT 1 FROM membership_revocation r WHERE r.membership_id = m.id)
      ORDER BY s.name, s.id`,
    [session.appUserId, session.shopId]
  );
  return res.rows as ShopSummary[];
}

/** Every shop this person holds a live membership at. The basis for E03-D08's *my shops*. */
export async function liveMembershipShopIds(db: Queryable, appUserId: string): Promise<string[]> {
  const res = await db.query(
    `SELECT DISTINCT m.shop_id
       FROM membership m
      WHERE m.app_user_id = $1
        AND m.effective_from <= now()
        AND (m.effective_until IS NULL OR m.effective_until > now())
        AND NOT EXISTS (
              SELECT 1 FROM membership_revocation r WHERE r.membership_id = m.id)`,
    [appUserId]
  );
  return (res.rows as Array<{ shop_id: string }>).map((r) => r.shop_id);
}

/**
 * Every role this person holds live, anywhere (E03-D06).
 *
 * It exists for 048 §4.1's question — *does this person need a second factor?* —
 * which is a property of the PERSON across every scope and not of one shop: an
 * owner at one shop who is an operator at another is still an owner, and the
 * factor they hold is theirs rather than a shop's.
 *
 * ⚠ **It grants nothing.** 048 §12.3 assigns the permission matrix to E03-B03, and
 * this returns a set to be tested against a REQUIREMENT (may this person enrol a
 * second factor at all), never against a permission.
 */
export async function liveRolesOf(db: Queryable, appUserId: string): Promise<Role[]> {
  const res = await db.query(
    `SELECT DISTINCT m.role
       FROM membership m
      WHERE m.app_user_id = $1
        AND m.effective_from <= now()
        AND (m.effective_until IS NULL OR m.effective_until > now())
        AND NOT EXISTS (
              SELECT 1 FROM membership_revocation r WHERE r.membership_id = m.id)`,
    [appUserId]
  );
  return (res.rows as Array<{ role: Role }>).map((r) => r.role);
}

export interface RosterEntry {
  id: string;
  display_name: string;
}

/**
 * **The operator picker's payload, and the line 022 P3 is easiest to breach by
 * accident** (048 §3.5, I7).
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
 */
export async function shopRoster(db: Queryable, shopId: string): Promise<RosterEntry[]> {
  const res = await db.query(
    `SELECT DISTINCT u.id, u.display_name
       FROM membership m
       JOIN app_user u ON u.id = m.app_user_id
      WHERE m.shop_id = $1
        AND u.status = 'active'
        AND m.role <> 'support_break_glass'
        AND m.effective_from <= now()
        AND (m.effective_until IS NULL OR m.effective_until > now())
        AND NOT EXISTS (
              SELECT 1 FROM membership_revocation r WHERE r.membership_id = m.id)
      ORDER BY u.display_name, u.id`,
    [shopId]
  );
  return res.rows as RosterEntry[];
}

/**
 * **Revoking a membership, with everything 048 requires it to drag with it**
 * (E03-D07).
 *
 * §2.7's grant/release idiom says the ending is a ROW: the grant was never
 * wrong, and `membership_revocation` carries `UNIQUE (membership_id)` so two
 * concurrent revocations leave one. This function adds the two consequences 048
 * attaches to that row and which, left to a caller to remember, are exactly the
 * kind of thing a caller forgets:
 *
 *   1. **§3.4 — every live session of that person is revoked in the SAME
 *      transaction.** A membership write that leaves a live session behind is a
 *      person acting under a scope they no longer hold, for as long as the
 *      session lasts.
 *   2. **§3.5 — that person's PIN rows at that scope are RETIRED, as an
 *      append-only fact** (`operator_pin_retirement`). Otherwise a fired
 *      employee's PIN sits live on the counter phone against a membership that
 *      no longer exists, and the only thing between it and an operator session
 *      is a membership check somebody has to remember to write.
 *
 * The order is deliberate: the revocation row first, so the retirement can NAME
 * it (`operator_pin_retirement.membership_revocation_id`) and the two facts are
 * one chain rather than two rows with a similar timestamp.
 *
 * `ON CONFLICT DO NOTHING` on the revocation makes the whole call idempotent —
 * a second revocation of the same grant writes nothing new, and the PIN
 * retirement it would have caused is itself deduplicated by its own UNIQUE. The
 * return value says what this call actually wrote.
 */
export async function revokeMembership(
  tx: Tx,
  args: { membershipId: string; revokedBy?: string | null; reason: string }
): Promise<{ revoked: boolean; sessionsRevoked: number; pinsRetired: number }> {
  const membership = await tx.query(
    `SELECT m.id, m.shop_id, m.app_user_id FROM membership m WHERE m.id = $1`,
    [args.membershipId]
  );
  const row = membership.rows[0] as { id: string; shop_id: string; app_user_id: string } | undefined;
  if (!row) return { revoked: false, sessionsRevoked: 0, pinsRetired: 0 };

  const revocation = await tx.query(
    `INSERT INTO membership_revocation (shop_id, membership_id, revoked_by, reason)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (membership_id) DO NOTHING
     RETURNING id`,
    [row.shop_id, row.id, args.revokedBy ?? null, args.reason]
  );
  const revocationId = (revocation.rows[0] as { id: string } | undefined)?.id;

  // Run BOTH consequences even when the revocation row already existed. A
  // previous call that crashed between the revocation and the retirement would
  // otherwise leave a live PIN behind a revoked membership forever, and "the
  // second attempt is a no-op" would be the reason nobody noticed.
  const sessionsRevoked = await revokeSessionsOf(tx, row.app_user_id);
  const pinsRetired = await retireOperatorPins(tx, {
    appUserId: row.app_user_id,
    shopId: row.shop_id,
    reason: args.reason,
    membershipRevocationId: revocationId ?? null,
  });

  return { revoked: revocationId !== undefined, sessionsRevoked, pinsRetired };
}
