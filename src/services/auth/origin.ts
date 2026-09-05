// THE LONGBOX-ORIGIN PREDICATE, AND ITS ONE WRITER (E03-D14; 000-docs/058).
//
// Docs: 058 in full; 054 §6 (the claim this returns from "narrowed" to
// "discharged"); 019 T35(c) (NON-WAIVABLE — *"periodic reconciliation of
// Longbox-origin database sessions against break-glass rows"*); 034 §2.5, §2.7;
// 048 §3; 022 P3, P7; 041 §2.1, §2.3.
//
// **THE HOLE THIS FILLS, IN ONE SENTENCE.** `unreconciledBreakGlassSessions`
// selected the sessions of people who hold a `support_break_glass` grant, so a
// Longbox staff account that reached a shop by ANY OTHER MEANS was invisible to
// it — not missed, but unfindable, because the population was defined by the
// grant the query was checking for. This module is the fact the population was
// missing.
//
// **ONE WRITER, asserted by `pnpm arch` (rule 3c).** `INSERT INTO
// app_user_origin` and `INSERT INTO app_user_origin_retirement` may appear in
// this file and nowhere else under `src/`, on `authorization_decision`'s
// precedent and for the same reason one level in: a second writer of a
// designation is a second definition of who Longbox's own people are, and the
// audit that reads it would be reporting on a population two files disagree
// about.
//
// **THE PREDICATE ITSELF IS NOT HERE.** It is `longbox_is_origin_staff(uuid,
// timestamptz)` in `migrations/032`, and this module calls it by the name below
// rather than re-stating its logic — 058 §3(d). A TypeScript copy would be a
// second definition that drifts silently the first time either side is edited,
// and the reconciliation query in `authorizationAudit.ts` calls the same
// function for the same reason.
//
// **NOTHING IN THE REQUEST PATH IMPORTS THIS.** Designation is a schema-owner
// act reached from `pnpm designate-staff`; the application role holds no
// privilege on either table (`appGrant: "none"`), so even an INSERT it somehow
// reached would be refused by the database.
import type { Queryable } from "../../db.js";

/**
 * The one closed vocabulary of origins, with one member.
 *
 * A second member is a migration (the column's CHECK is closed) AND a decision
 * record, deliberately: the vocabulary of who a person is to Longbox should not
 * be extensible by whoever writes the next INSERT.
 */
export const LONGBOX_STAFF_ORIGIN = "longbox_staff";

/**
 * The SQL function that IS the predicate (`migrations/032`).
 *
 * Exported as a constant so the reconciliation query, the CLIs and the contract
 * test all name the same string, and so a rename in the migration fails a test
 * rather than a production run.
 */
export const ORIGIN_PREDICATE_FUNCTION = "longbox_is_origin_staff";

/** A designation as the audit and the CLI receipt read it. */
export interface OriginDesignation {
  readonly id: string;
  readonly appUserId: string;
  readonly origin: string;
  readonly reason: string;
  readonly effectiveFrom: Date;
  readonly retiredAt: Date | null;
}

interface DesignationRow {
  id: string;
  app_user_id: string;
  origin: string;
  reason: string;
  effective_from: Date | string;
  retired_at: Date | string | null;
}

const toDesignation = (r: DesignationRow): OriginDesignation => ({
  id: r.id,
  appUserId: r.app_user_id,
  origin: r.origin,
  reason: r.reason,
  effectiveFrom: new Date(r.effective_from),
  retiredAt: r.retired_at === null ? null : new Date(r.retired_at),
});

/** Refused before anything is written, so a bad argument leaves no row. */
export class OriginDesignationRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OriginDesignationRefused";
  }
}

export interface DesignateOriginInput {
  readonly appUserId: string;
  /** Why, in a person's words. The column refuses blank (`migrations/032`). */
  readonly reason: string;
  /** The designating person, when they are an `app_user`; null when a CLI operator. */
  readonly designatedBy?: string | null;
  /**
   * When the designation became TRUE, which may predate this row.
   *
   * 058 §3(b): back-dating a START widens the audited population, so it is
   * offered; back-dating an END would narrow it, so the retirement has no
   * equivalent. A FUTURE value is refused here rather than in the database,
   * because `now()` is not immutable and a CHECK cannot express it — a
   * designation that has not started yet is a designation that hides the very
   * sessions somebody is about to open.
   */
  readonly effectiveFrom?: Date | null;
}

/**
 * Record that a person is Longbox-origin, from a moment.
 *
 * Append-only: there is no update path, and a person designated twice has two
 * rows, which is correct — a rehire is a new fact, not a corrected old one.
 */
export async function designateOrigin(
  db: Queryable,
  input: DesignateOriginInput
): Promise<OriginDesignation> {
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new OriginDesignationRefused(
      "a designation must say why: it is the row 022 P3 lets an employee read back."
    );
  }
  const effectiveFrom = input.effectiveFrom ?? null;
  if (effectiveFrom !== null && effectiveFrom.getTime() > Date.now()) {
    throw new OriginDesignationRefused(
      "refusing a designation that starts in the future (058 §3(b)): it would leave every session " +
        "opened between now and then outside the audited population."
    );
  }
  const res = await db.query(
    `INSERT INTO app_user_origin (app_user_id, origin, reason, designated_by, effective_from)
     VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, now()))
     RETURNING id, app_user_id, origin, reason, effective_from, NULL::timestamptz AS retired_at`,
    [input.appUserId, LONGBOX_STAFF_ORIGIN, reason, input.designatedBy ?? null, effectiveFrom]
  );
  return toDesignation(res.rows[0] as DesignationRow);
}

/**
 * End EVERY live designation a person holds, in ONE statement.
 *
 * ⚠ **ONE STATEMENT RATHER THAN A LOOP, and rather than a loop wrapped in a
 * transaction** (the invariant review's NOTE4). `retireStaffDesignation` used to
 * call `retireOrigin` once per designation outside any transaction, so a failure
 * partway through left some designations ended and some live while the CLI's
 * receipt reported a number that had never been true. A transaction would fix the
 * atomicity and would need a CONNECTION — and the callers hand this module a
 * `pg.Pool` as often as a `pg.Client`, where each statement may take a different
 * connection and `BEGIN` would be a lie. A single statement is atomic without
 * either.
 *
 * **`ON CONFLICT DO NOTHING` rather than a `NOT EXISTS` guard**, for two reasons.
 * It makes a second retirement idempotent by the same `UNIQUE (origin_id)` that
 * makes a designation end at most once — the constraint doing the work rather
 * than a predicate racing it — and it keeps this file clear of the shape the
 * contract test bans (H1): `NOT EXISTS (… app_user_origin_retirement …)` is the
 * predicate's own liveness logic, and it has exactly one home.
 *
 * The RETURNING count is what actually happened, so a receipt cannot overstate.
 */
export async function retireAllOriginsOf(
  db: Queryable,
  input: { readonly appUserId: string; readonly reason: string; readonly retiredBy?: string | null }
): Promise<number> {
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new OriginDesignationRefused("a retirement must say why (058 §3(b)).");
  }
  const res = await db.query(
    `INSERT INTO app_user_origin_retirement (origin_id, reason, retired_by)
     SELECT o.id, $2, $3
       FROM app_user_origin o
      WHERE o.app_user_id = $1
        AND o.origin = $4
     ON CONFLICT (origin_id) DO NOTHING
     RETURNING id`,
    [input.appUserId, reason, input.retiredBy ?? null, LONGBOX_STAFF_ORIGIN]
  );
  return res.rows.length;
}

export interface RetireOriginInput {
  readonly originId: string;
  readonly reason: string;
  readonly retiredBy?: string | null;
}

/**
 * End a designation, as a FACT, at this row's own `created_at`.
 *
 * There is deliberately no timestamp argument. 058 §3(b): the writer does not
 * choose when a designation ended, because choosing it is how a session that has
 * already happened is taken out of the audit.
 */
export async function retireOrigin(db: Queryable, input: RetireOriginInput): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new OriginDesignationRefused("a retirement must say why (058 §3(b)).");
  }
  await db.query(`INSERT INTO app_user_origin_retirement (origin_id, reason, retired_by) VALUES ($1,$2,$3)`, [
    input.originId,
    reason,
    input.retiredBy ?? null,
  ]);
}

/**
 * Every designation a person holds, live or ended, newest first.
 *
 * For the CLI's receipt and for a test's assertion. It projects a person, which
 * this codebase otherwise refuses to do (019 T35) — it is inside the identity
 * module, where 034 §3.3 puts every such read, it has no route, and its callers
 * already hold the person's id because they typed it.
 */
export async function originDesignationsOf(db: Queryable, appUserId: string): Promise<OriginDesignation[]> {
  const res = await db.query(
    `SELECT o.id, o.app_user_id, o.origin, o.reason, o.effective_from,
            (SELECT r.created_at FROM app_user_origin_retirement r WHERE r.origin_id = o.id) AS retired_at
       FROM app_user_origin o
      WHERE o.app_user_id = $1
      ORDER BY o.effective_from DESC, o.id`,
    [appUserId]
  );
  return (res.rows as DesignationRow[]).map(toDesignation);
}

/**
 * The predicate, as the database defines it — was this person Longbox-origin
 * AT that moment?
 *
 * `at` is MANDATORY, on `resolve(lcid, asOf)`'s precedent (047 / 058 §3(d)): the
 * question an audit asks is about the moment a session was ISSUED, and a default
 * of "now" would answer a different question for every row.
 */
export async function isLongboxOrigin(db: Queryable, appUserId: string, at: Date): Promise<boolean> {
  const res = await db.query(`SELECT ${ORIGIN_PREDICATE_FUNCTION}($1,$2) AS is_origin`, [appUserId, at]);
  return (res.rows[0] as { is_origin: boolean }).is_origin;
}

/**
 * How many people are Longbox-origin right now — a COUNT and nothing else.
 *
 * The audit prints it so that *"ran and found nothing"* and *"ran over nothing"*
 * are different lines. A reconciliation over an empty designation table is
 * green for the wrong reason, and that is the stale-detector failure 019 T34
 * exists to catch (`scripts/crossTenantAudit.ts` gives the same argument for its
 * edge count).
 */
export async function liveOriginDesignationCount(db: Queryable, at: Date): Promise<number> {
  // ⚠ **IT CALLS THE PREDICATE; IT DOES NOT RE-STATE IT** (the data-model lens's
  // H1). The first version wrote the `effective_from <= $2 AND NOT EXISTS
  // (retirement …)` logic out again, one function away from the one the contract
  // test pins — a second definition of liveness, in the module whose own §3(d)
  // argument is that the predicate has exactly one. It was small and contained,
  // which is precisely what the drift this record warns about looks like on the
  // day it is introduced. The count is now a COUNT over the function's answer,
  // so a change to the predicate reaches this number without anybody editing it.
  const res = await db.query(
    `SELECT count(DISTINCT o.app_user_id)::int AS n
       FROM app_user_origin o
      WHERE o.origin = $1
        AND ${ORIGIN_PREDICATE_FUNCTION}(o.app_user_id, $2)`,
    [LONGBOX_STAFF_ORIGIN, at]
  );
  return (res.rows[0] as { n: number }).n;
}
