// THE ACTOR AUDIT'S ONE WRITER (E03-B03; 054 §4).
//
// Docs: 054 §4 in full; 034 §8 (*"the access-audit table itself — E03-B03"*);
// 022 P3; 019 T34 (the heartbeat list names *"the break-glass access-audit
// writer"*), T35; 041 §2.1 (a thing that happened is a row).
//
// **One writer, asserted by `pnpm arch`.** `scripts/architectureRules.ts` refuses
// an `INSERT INTO authorization_decision` in any other file, on `cost_log`'s
// precedent and for a sharper reason: a second writer could record a decision
// that no decision function took. An audit table with two authors is an audit
// table whose rows mean two different things.
import type { Permission } from "../../contracts/v1/permissions.js";
import type { Queryable } from "../../db.js";
import type { Role } from "./memberships.js";
import { ORIGIN_PREDICATE_FUNCTION } from "./origin.js";
import type { AuthorizationVerdict, RefusalReason } from "./permissions.js";

/**
 * One session that did not reconcile, and WHY it was in the population at all
 * (E03-D14).
 *
 * `longboxOrigin` is the predicate `migrations/032` defines, evaluated at the
 * session's own issuance. `false` means the row is here on the older ground —
 * the person holds a `support_break_glass` grant at some time — which is a
 * shop's own support person straying outside their ticket rather than a Longbox
 * account at a shop it has no grant at. The two are different incidents and the
 * audit reports them as different counts.
 */
export interface UnreconciledSession {
  readonly sessionId: string;
  readonly appUserId: string;
  readonly shopId: string;
  readonly issuedAt: Date;
  readonly longboxOrigin: boolean;
}

export interface AuthorizationDecisionRecord {
  readonly shopId: string;
  /** The route TEMPLATE, never the request URL (054 §4.2). */
  readonly routeMethod: string;
  readonly routePath: string;
  readonly permission: Permission;
  readonly matrixVersion: string;
  /** The commit the deciding build was made from, or `"unknown"` (054 §4.2, K2). */
  readonly matrixCommit: string;
  readonly membershipId: string | null;
  readonly role: Role | null;
  /**
   * The operator session's chain, or NULL for an act reached from an operator
   * SCRIPT — a CLI has no session (054 §4.3). The migration's CHECK ties the
   * null to `routeMethod === "CLI"`, so it cannot become "a session we failed to
   * record".
   */
  readonly sessionChainId: string | null;
  readonly decision: "allowed" | "refused";
  readonly refusalReason: RefusalReason | null;
}

/**
 * **WHICH DECISIONS ARE RECORDED — the 022 P3 line, as a pure predicate.**
 *
 * *Every refusal; and an allowance when the act MUTATES or the permission is
 * PRIVILEGED.*
 *
 * The asymmetry is the whole argument. A record of every allowance on a read
 * route is a record of what a named person LOOKED AT, once joined through the
 * membership — a browsing history of the shop's own books, which is covert
 * measurement whatever the intent behind it (022 P3, and the CFO's rule that no
 * per-operator surface may be built and then restricted). A record of every
 * allowance on a WRITE route is the decision an auditor needs and is already
 * implied by the row that write produced, which carries `operator_id` and
 * `actor_verified` (048 §6.3) — what this adds is the AUTHORITY: which grant,
 * which role, under which version of the matrix.
 *
 * A refusal is recorded whatever the method, because a refusal is the security
 * event: it is the thing 019 T24 counts, and a refused read is exactly the
 * attempt worth keeping.
 *
 * ⚠ **THE `privileged` CLAUSE IS THE SECURITY LENS'S S5′, AND IT WAS RIGHT.**
 * The first version keyed only on `routeMutates`, and the lens's finding is that
 * this is *"not a rule with a scheduled failure date; it is a rule that is
 * already failing"* — `issueInvitation` and `issueEnrollmentCode` call
 * `authorize()` on the two most privileged acts in the system and recorded
 * nothing, because neither is an HTTP route and neither had a `mutating` flag to
 * be true. Adding a person to a shop and enrolling a phone are now recorded on
 * their own account, whatever surface they are reached from, because *a grant
 * that records who created it does not record under what authority they were
 * allowed to*.
 *
 * It is a pure function so that `tests/auth-permissions.test.ts` can assert the
 * rule directly instead of inferring it from row counts, and so that changing it
 * is a visible edit rather than a moved `if`.
 */
export function shouldRecord(
  verdict: AuthorizationVerdict,
  act: { readonly mutating: boolean; readonly privileged: boolean }
): boolean {
  return verdict.kind !== "allowed" || act.mutating || act.privileged;
}

/**
 * Append one decision. **Outside the request's transaction, deliberately.**
 *
 * Two reasons, and the second is the one that decided it.
 *
 * (1) **The decision is a fact about the REQUEST, not about the write.** A
 * mutation that rolls back — a stale world view, a serialization failure, an
 * exhausted retry — was still authorized, and a rolled-back audit row would
 * erase the record of an authorization that genuinely happened. For refusals it
 * is starker: a refused request has no transaction to join at all, because it
 * never reaches a handler.
 *
 * (2) **It keeps this INSERT out of the hot transaction's write set.** 048 §12.2
 * already records that the session row joins every mutating transaction and is
 * therefore a serialization-failure source under 041 §4.5's `40001` retry
 * budget. Adding a second write to that set would make every authorization
 * decision a retry candidate — and, worse, would make a retried request write
 * its decision twice while the domain write happened once. Out here, one request
 * is one decision row.
 *
 * The cost is stated rather than discovered: **a decision row can commit for a
 * request whose work then fails.** That is the correct direction for an audit of
 * AUTHORITY (the authority really was granted) and the wrong direction for an
 * audit of ACTS — which this is not, and which the domain rows already are.
 *
 * ⚠ **ONE ROW IS ONE AUTHORIZATION, NOT ONE EFFECT — and that is DECIDED, not
 * tolerated (059, E03-D15).** A client that retries with the same
 * `Idempotency-Key` re-enters the hook, so the grants are read again, at a later
 * instant, and answered again: the second authorization HAPPENED, and 041 §2.1
 * is that a thing that happened is a row. So there is **no `ON CONFLICT` clause
 * here, no `UNIQUE` on the table, and no column carrying the idempotency key, a
 * request id, an attempt number or an effect id** — the first three are refused
 * by 059 §4/§5 and the last two would swallow the second decision precisely when
 * it DIFFERS from the first (a grant revoked, a role changed mid-handover, a
 * break-glass window closed between two attempts), which is the row an
 * investigation is looking for. The key itself is additionally refused as a
 * COLUMN because it joins straight to `request_idempotency`, whose row holds the
 * route and the stored RESPONSE BODY — i.e. the item — which is the join 054
 * §4.2 refuses `correlation_id` by name for. `tests/contract/authorization-audit-surface.test.ts`
 * holds all four absences.
 */
export async function recordAuthorizationDecision(
  db: Queryable,
  row: AuthorizationDecisionRecord
): Promise<void> {
  await db.query(
    `INSERT INTO authorization_decision
       (shop_id, route_method, route_path, permission, matrix_version, matrix_commit,
        membership_id, role, session_chain_id, decision, refusal_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      row.shopId,
      row.routeMethod,
      row.routePath,
      row.permission,
      row.matrixVersion,
      row.matrixCommit,
      row.membershipId,
      row.role,
      row.sessionChainId,
      row.decision,
      row.refusalReason,
    ]
  );
}

/**
 * **019 T35(c), as a query rather than as a runbook** — every Longbox-origin
 * session reconciles to a live break-glass grant (048 I14, 034 §2.7).
 *
 * The reconciliation is stated in 048 R16 as deriving from `app_session` and NOT
 * from a success row in `auth_attempt`: a session is the thing that lets somebody
 * act, so a session with no grant covering its issuance is the exposure,
 * whatever the attempt table says. An unmatched row is **K1** (019 §3.4) — pause
 * live batches until the P0 bead closes with an invariant-review PASS.
 *
 * **THE POPULATION IS A UNION OF TWO PREDICATES, AND NEITHER CONTAINS THE
 * OTHER** (E03-D14, 000-docs/058; closing 054 §6's F3).
 *
 * *(i) a LONGBOX-ORIGIN person, as of the moment the session was issued* —
 * `longbox_is_origin_staff(app_user_id, issued_at)`, the predicate
 * `migrations/032` defines and this query calls rather than re-states. This is
 * T35(c)'s own sentence, and until E03-D14 it could not be expressed: 054 §6
 * recorded that *"a Longbox employee who was never granted break-glass is
 * invisible to it"*, which was invisible BY CONSTRUCTION — the population was
 * defined by the grant the query was checking for, so no amount of running it
 * would have found one.
 *
 * *(ii) a person who holds a `support_break_glass` grant at some time* — the
 * original population, KEPT. It is not redundant: a SHOP's own person can be
 * granted break-glass (the role is not reserved to Longbox), and a session of
 * theirs outside its grant's window is exactly the unmatched row 019 §3.4 makes
 * K1. Dropping it to "tidy" the query would remove the half that has already
 * been tested.
 *
 * Each returned row says which predicate put it there, so the audit can report
 * the two counts separately and an operator can tell *"our own support person
 * strayed outside a ticket"* from *"a Longbox account was at a shop with no
 * grant at all"* without reading a single identifier.
 *
 * **The population is deliberately NOT shop-scoped while the COVERING clause is**
 * (invariant review, note 2). A person who holds break-glass anywhere is in
 * scope; a grant only covers a session at ITS OWN shop. Scoping both would make
 * a session at a shop the holder has no grant at simply invisible, and that
 * session is the most interesting row this query can produce.
 *
 * The query returns the sessions that do NOT reconcile, so an empty result is
 * the healthy state and the caller has nothing to interpret.
 *
 * ⚠ **It has no scheduler yet, and that is E13-B04-D1's** (`longbox-e5b.13.4.1`,
 * whose acceptance carries the daily-schedule clause — not its parent E13-B04,
 * which is health and readiness) — the bead that owns
 * every other detector's heartbeat and the T34 liveness signal this writer owes
 * (019 T34 names *"the break-glass access-audit writer"* in its list). Shipping
 * the predicate now means the periodic job is a caller rather than a design.
 *
 * ⚠ **And it projects a person, which is the one thing this module otherwise
 * refuses to do.** `app_session.app_user_id` is an operator identifier, and 019
 * T35 signs per-operator rendering at zero. It is returned here because T35(c)
 * is the SANCTIONED exception — the reconciliation is the audited break-glass
 * path itself, and a reconciliation that could not name the person it failed to
 * reconcile would be a detector with nothing to report. It lives inside the
 * identity module, which is where 034 §3.3 puts every such read, and it has no
 * route: the only callers this function will ever have are `pnpm audit:break-glass`
 * and E13-B04-D1's job.
 *
 * ⚠ **It reconciles APPLICATION sessions.** `app_session` is 048 §3's two chains;
 * a schema-owner DATABASE session leaves no row here and is outside this
 * instrument by construction, which is why every artifact says *discharged for
 * application sessions* (000-docs/058 §7, R5).
 */
export async function unreconciledBreakGlassSessions(
  db: Queryable,
  options: { readonly issuedSince?: Date | null } = {}
): Promise<UnreconciledSession[]> {
  const res = await db.query(
    `SELECT s.id, s.app_user_id, s.shop_id, s.issued_at,
            ${ORIGIN_PREDICATE_FUNCTION}(s.app_user_id, s.issued_at) AS longbox_origin
       FROM app_session s
      WHERE s.app_user_id IS NOT NULL
        -- THE WINDOW (E03-D14). NULL means "every session ever", which is what
        -- an investigation wants and what a DAILY exit code must not have: an
        -- append-only history cannot be repaired, so an audit that never forgets
        -- is an audit that stays red forever after one incident and is therefore
        -- ignored. The incident record is the K1 row in 006; the exit code is
        -- for the cadence.
        AND ($1::timestamptz IS NULL
             OR s.issued_at >= $1
             -- F5. Keyed on issued_at ALONE, a lookback shorter than a session's
             -- life drops a session that is STILL LIVE and still unreconciled —
             -- the 24h default sits beside an OPERATOR_ABSOLUTE_MS of 12h today,
             -- so the two are one configuration change from disagreeing. A
             -- session whose absolute expiry has not passed is in scope whenever
             -- it was issued. There is no watermark: this is a window, not a
             -- cursor, and 058 §4 states the rule the caller owes instead — the
             -- lookback must exceed the cadence, and a missed run is answered
             -- with --hours or --all rather than by the query remembering.
             OR s.absolute_expires_at >= $1)
        -- WARNING: NO PREDICATE ON s.kind, DELIBERATELY (048 §3.1, and E03-D11
        -- is adding a third chain). A device session carries no app_user_id and
        -- is already excluded by the line above; keying on kind = 'operator'
        -- would ALSO exclude, silently, every chain kind invented after this was
        -- written. tests/contract/origin-designation-surface.test.ts asserts the
        -- literal is absent, because the failure it prevents is a query that
        -- goes quietly blind rather than red.
        AND (
              ${ORIGIN_PREDICATE_FUNCTION}(s.app_user_id, s.issued_at)
           OR EXISTS (
              SELECT 1 FROM membership m
               WHERE m.app_user_id = s.app_user_id
                 AND m.role = 'support_break_glass'))
        AND NOT EXISTS (
              SELECT 1 FROM membership m
               WHERE m.app_user_id = s.app_user_id
                 AND m.role = 'support_break_glass'
                 AND m.reason IS NOT NULL
                 AND m.effective_until IS NOT NULL
                 -- THE SAME SHOP as the session (invariant review, note 2).
                 -- Without it, a break-glass grant at shop A "covers" a session
                 -- opened at shop B — which is not a near-miss but the single
                 -- most interesting row in the table: a privileged holder acting
                 -- somewhere their grant does not reach. app_session carries
                 -- shop_id denormalized at issuance (048 §3.5), so the
                 -- comparison is free and needs no join.
                 AND m.shop_id = s.shop_id
                 AND m.effective_from <= s.issued_at
                 AND m.effective_until > s.issued_at
                 -- A REVOCATION IS AN EARLY effective_until (F2). 034 §2.7
                 -- ends a grant with a ROW rather than by editing the grant, so a
                 -- covering window read off effective_until alone reports a
                 -- session issued AFTER the revocation as reconciled — which is
                 -- precisely the session an investigator is looking for. The
                 -- revocation's own created_at is the real end of the window.
                 AND NOT EXISTS (
                       SELECT 1 FROM membership_revocation r
                        WHERE r.membership_id = m.id
                          AND r.created_at <= s.issued_at))
      ORDER BY s.issued_at DESC`,
    [options.issuedSince ?? null]
  );
  return (
    res.rows as Array<{
      id: string;
      app_user_id: string;
      shop_id: string;
      issued_at: Date | string;
      longbox_origin: boolean;
    }>
  ).map((r) => ({
    sessionId: r.id,
    appUserId: r.app_user_id,
    shopId: r.shop_id,
    issuedAt: new Date(r.issued_at),
    longboxOrigin: r.longbox_origin,
  }));
}

/**
 * **K4: which of the unreconciled sessions ACTED, and on what.**
 *
 * The reconciliation above answers *"whose session was live outside its grant"*.
 * An investigator's next question is always *"and did they do anything"*, and
 * until now the only way to ask it was an index on `session_chain_id` — which is
 * the index F1 removed, because a fast "everything this person did on this phone
 * that day" is the covert timeclock 022 P3 forbids.
 *
 * **The answer is not to re-add the index; it is to make the question expensive
 * and scoped.** This helper takes the chains the reconciliation already flagged
 * — a handful of rows on a bad day, none on a good one — and joins them to the
 * decision log by sequential scan. At pilot volume that is milliseconds; at
 * national volume it is a scheduled job's cost, paid by a job that runs when a
 * K1 has already fired. **A query that is cheap only when something is already
 * wrong is the correct shape for this one.**
 *
 * It returns COUNTS and permission names, never route paths per session and
 * never timestamps per decision: enough to say *"this session was authorized
 * twice for this permission"*, which is what an investigation needs, and not
 * enough to reconstruct a shift.
 *
 * ⚠ **THE NUMBER IS DECISIONS, AND SAYING "ACTS" WOULD BE FALSE (059 §7).** This
 * header used to read *"enough to say 'this session was allowed two privileged
 * acts'"* — which is exactly the sentence 054 §4.5 withdrew one page earlier: a
 * replayed `Idempotency-Key` writes a SECOND decision for ONE effect, so two rows
 * may be one act performed once. The projection is therefore named `decisions`
 * rather than `n`, and the field a caller reads is named `decisions` rather than
 * `count`, because the harm K1 found was a false noun in an artifact and a field
 * name is an artifact. **Authorizations, never acts.**
 */
export interface AuthorizationDecisionCount {
  readonly sessionChainId: string;
  readonly permission: string;
  readonly decision: string;
  /**
   * **The ONLY numeric field this type may ever declare, and the name is the
   * boundary** (059 §5, the data-model lens's condition). A field name and a
   * regex over source text are a CONVENTION; a convention decays exactly where
   * 059 §10 predicts it will. A named type makes the wrong noun unable to be
   * expressed: adding `acts`, `effects` or `requests` here fails `pnpm arch`
   * (rule 3d) rather than passing review.
   *
   * It counts AUTHORIZATIONS — evaluations of the grants — never acts. Two rows
   * may be one act replayed (054 I9a, 059 §3).
   */
  readonly decisions: number;
}

export async function decisionsByUnreconciledSessions(
  db: Queryable,
  chainIds: readonly string[]
): Promise<AuthorizationDecisionCount[]> {
  if (chainIds.length === 0) return [];
  const res = await db.query(
    `SELECT d.session_chain_id, d.permission, d.decision, count(*)::int AS decisions
       FROM authorization_decision d
      WHERE d.session_chain_id = ANY($1::uuid[])
      GROUP BY d.session_chain_id, d.permission, d.decision
      ORDER BY d.session_chain_id, d.permission, d.decision`,
    [[...chainIds]]
  );
  return (
    res.rows as Array<{
      session_chain_id: string;
      permission: string;
      decision: string;
      decisions: number;
    }>
  ).map((r) => ({
    sessionChainId: r.session_chain_id,
    permission: r.permission,
    decision: r.decision,
    decisions: r.decisions,
  }));
}
