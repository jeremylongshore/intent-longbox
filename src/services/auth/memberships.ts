// Tenancy resolution and the operator roster.
//
// **048 §6.1: `shop_id` is resolved from the session's MEMBERSHIPS, before any
// handler runs. The `shopId` in the URL is a value to be CHECKED against it,
// never the tenant itself.** That is 034 §3.1's `RequestContext` finally having
// something trustworthy to fill in, and it is the sentence 046 §9.2 put on this
// bead.
import type { Queryable } from "../../db.js";

/**
 * 034 §2.6's four roles, ranked for RESOLUTION only.
 *
 * "The highest role held at that scope" (034 §3.1) needs an order, and this is
 * it. **It grants nothing.** Which role may do what — the matrix, its positive
 * and negative tests, the T24 runtime assertion — is E03-B03's (048 §12.3), and
 * a rank here that started deciding permissions would be that bead's decision
 * made from a lookup table.
 *
 * `support_break_glass` sits below `owner`/`manager` on purpose: it is a
 * DISTINCT named role and never a policy overlay on an admin session (034 §2.6,
 * 022 P3), so ranking it at the top would quietly make it a super-admin — the
 * exact thing 022 P7 says does not exist here.
 */
const ROLE_RANK: Record<string, number> = {
  owner: 4,
  manager: 3,
  support_break_glass: 2,
  operator: 1,
};

export type Role = "owner" | "manager" | "operator" | "support_break_glass";

export interface MembershipScope {
  shopId: string;
  role: Role;
  locationId: string | null;
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
  const res = await db.query(
    `SELECT m.role, m.shop_id, m.location_id
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
  const rows = res.rows as Array<{ role: Role; shop_id: string; location_id: string | null }>;
  if (rows.length === 0) return undefined;
  const best = rows.reduce((a, b) => ((ROLE_RANK[b.role] ?? 0) > (ROLE_RANK[a.role] ?? 0) ? b : a));
  return { shopId: best.shop_id, role: best.role, locationId: best.location_id };
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
