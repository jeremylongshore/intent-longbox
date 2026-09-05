// The single writer of `supersedes_id` (041 §3.3), for every table.
//
// > "One helper writes `supersedes_id`, for every table, and no route or service
// >  writes it directly." — 041 §3.3
//
// THIS FILE IS THE ONLY PLACE IN `src/` THAT MAY NAME `supersedes_id` IN AN
// INSERT, and `scripts/architectureRules.ts` asserts it: a second writer fails
// `pnpm arch`. The rule is not tidiness. 041 §3.3 gives three reasons and each is
// a property this file holds and a route could not:
//
//   1. **R1, R3 and R4 are checked in the DATABASE; this is where the error
//      becomes a product answer.** A raw FK or trigger violation surfaces as a
//      Postgres message, and 022 P6 ("a screen never blames the person") plus
//      040 A9's E05 acceptance criterion require that a losing correction shows
//      the other person's answer, not a stack trace. One writer means one place
//      that translates — `SupersessionError` below, with a `code` a route can
//      map to a status without parsing English.
//   2. **The outcome baseline is a property of the supersession, not of the
//      clock.** 041 §3.3 decides that "when a write supersedes, the outcome
//      baseline IS the superseded row", because 019 T20 measures owner edits to
//      the identity the owner INHERITED. The caller reads its predecessor from
//      the `_current` view and hands the same id to this helper, so the row the
//      outcome was decided against and the row being superseded are the same row
//      by construction rather than by coincidence.
//   3. **Idempotency and the transaction.** A correction that retries must not
//      append twice (040 §5.2) and must commit with its consequence (041 §4).
//      Both are properties of the writing path, and there is one.
//
// TWO LAYERS ENFORCE THE SAME FOUR RULES, ON PURPOSE. The checks below produce an
// early, readable refusal; `migrations/008` (R1's composite FK, R3's self-CHECK),
// `003`'s partial unique index (R2) and `migrations/013` (R4's `BEFORE INSERT`
// trigger) are the ENFORCEMENT. If the two ever disagree the database wins, which
// is why the integration lane tests each layer separately: the service tests prove
// the message, the DB tests prove the refusal. A service check that is treated as
// the guarantee is the shape 041 §9 exists to prevent — the guarantee has to
// survive a caller that does not use this file, and only the database does.
import type { Tx } from "../db.js";
import { assignSessionSeq } from "./scanSession.js";
import type { WitnessedReference } from "./witnessedReference.js";

/** The three tables that carry `supersedes_id` (003:84-86, 008, 013). */
export const SUPERSEDABLE_TABLES = [
  "human_confirmation",
  "condition_assessment",
  "pricing_snapshot",
] as const;
export type SupersedableTable = (typeof SUPERSEDABLE_TABLES)[number];

/**
 * 040 A1 / 041 §3.5 — the causal reference, on the two tables migration `030`
 * gave the columns to (E02-D11).
 *
 * IT LIVES IN THE PER-TABLE VALUES AND NOT IN `SupersedeArgs`, and that placement
 * is the enforcement. `pricing_snapshot` is machine-authored (041 §10.1) and 041
 * §3.5 keeps the columns off it, so a field on the shared args would be a field
 * this writer silently dropped for one of its three tables — the quiet-drop shape
 * 041 §12.1 rejects. Here a caller that hands a price correction a world-view
 * does not compile.
 *
 * A CORRECTION CARRIES ITS OWN REFERENCE, not its predecessor's. The person
 * correcting was shown a world of their own, and copying the superseded row's
 * value forward would attribute the first actor's view to the second.
 */
type CausalReference = { readonly against: WitnessedReference | null };

/** A corrected identity (041 §3.3 case 2; 040 S15's undo is the same shape). */
export interface HumanConfirmationValues extends CausalReference {
  readonly confirmedIssue: unknown;
  readonly source: string;
  readonly outcome: string;
}

/** A corrected condition call (037 §4.4 — the owner-review correction). */
export interface ConditionAssessmentValues extends CausalReference {
  readonly gradeRangeLow: string;
  readonly gradeRangeHigh: string;
  readonly defects: readonly string[];
  readonly notes: string | null;
}

/** A corrected price. No caller yet — `POST …/price` is E02-B08's wiring. */
export interface PricingSnapshotValues {
  readonly source: string;
  readonly query: string;
  readonly comps: unknown;
  readonly suggestedCents: number;
  readonly overrideCents: number | null;
  readonly policyId: string | null;
}

/**
 * The successor's payload, discriminated by its table.
 *
 * It is a union rather than a `Record<string, unknown>` for the reason 041 §12.1
 * rejects the one-`event`-table design: "the jsonb payload is where a schema goes
 * to stop being checked". A caller that hands `condition_assessment` a
 * confirmation's fields does not compile.
 */
export type SupersedingRow =
  | { readonly table: "human_confirmation"; readonly values: HumanConfirmationValues }
  | { readonly table: "condition_assessment"; readonly values: ConditionAssessmentValues }
  | { readonly table: "pricing_snapshot"; readonly values: PricingSnapshotValues };

/** Why a supersession was refused before it reached the database. */
export type SupersessionRefusal =
  /** The named predecessor does not exist at all. */
  | "prior-not-found"
  /** It exists in another shop or another session (R1; 019 T24, non-waivable). */
  | "prior-out-of-scope"
  /** Something already supersedes it (R2), so appending a second successor forks the chain. */
  | "prior-already-superseded";

/**
 * A refusal a caller can act on without reading a Postgres message.
 *
 * `code` is the contract; the message is for the log. A route maps
 * `prior-already-superseded` to 409 and shows the winning row (040 A9), and
 * `prior-out-of-scope` to 404 — never to a message naming another shop, which
 * would leak the existence of a tenant's row across a T24 boundary.
 */
export class SupersessionError extends Error {
  constructor(
    readonly code: SupersessionRefusal,
    readonly table: SupersedableTable,
    readonly priorId: string,
    message: string
  ) {
    super(message);
    this.name = "SupersessionError";
  }
}

/** The row every successor returns: enough to answer the request, nothing more. */
export interface SupersededRow {
  readonly id: string;
  readonly created_at: string;
  readonly session_seq: string | number;
}

/**
 * Per table: the scoped read of the predecessor, and the INSERT of the successor.
 *
 * The SQL is written out per table rather than interpolated from `table`, so no
 * identifier ever reaches a query string from a variable and there is nothing for
 * an identifier-safety assertion to guard. Every read names its columns — 042
 * I5(b) forbids a star-select under `src/` outside a declared row, and a predecessor
 * read is exactly the case that rule exists for.
 */
const PRIOR_SQL: Record<SupersedableTable, string> = {
  human_confirmation: `SELECT id, shop_id, scan_session_id, session_seq FROM human_confirmation WHERE id = $1`,
  condition_assessment: `SELECT id, shop_id, scan_session_id, session_seq FROM condition_assessment WHERE id = $1`,
  pricing_snapshot: `SELECT id, shop_id, scan_session_id, session_seq FROM pricing_snapshot WHERE id = $1`,
};

const SUCCESSOR_SQL: Record<SupersedableTable, string> = {
  human_confirmation: `SELECT id FROM human_confirmation WHERE supersedes_id = $1 LIMIT 1`,
  condition_assessment: `SELECT id FROM condition_assessment WHERE supersedes_id = $1 LIMIT 1`,
  pricing_snapshot: `SELECT id FROM pricing_snapshot WHERE supersedes_id = $1 LIMIT 1`,
};

const INSERT_SQL: Record<SupersedableTable, string> = {
  // `confirmed_by` IS ABSENT AND STAYS ABSENT (041 §8.4, 042 I1). The column
  // still exists with its DEFAULT; what stops is a writer putting a person's
  // identifier into an append-only row that can never be corrected. 019 T35
  // signs per-operator rendering at zero, non-waivable.
  // `operator_id` is the LAST parameter on all three, and `actor_verified` is
  // derived from it in the same statement (048 §6.3, E03-D09): a correction is
  // an act by a person too, and a successor that dropped the attribution the
  // predecessor carried would make "who fixed this" unanswerable at exactly the
  // moment 022 P1 needs it answered.
  // `against_table` / `against_id` are LAST on the two tables that carry them
  // (030), and absent from `pricing_snapshot`'s statement because that table has
  // no such columns — 041 §3.5 keeps them off machine-authored records.
  human_confirmation: `INSERT INTO human_confirmation
      (scan_session_id, shop_id, confirmed_issue, source, outcome, session_seq, supersedes_id,
       operator_id, actor_verified, against_table, against_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid,$8::uuid IS NOT NULL,$9,$10)
    RETURNING id, created_at, session_seq`,
  condition_assessment: `INSERT INTO condition_assessment
      (scan_session_id, shop_id, grade_range_low, grade_range_high, defects, notes, session_seq, supersedes_id,
       operator_id, actor_verified, against_table, against_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid,$9::uuid IS NOT NULL,$10,$11)
    RETURNING id, created_at, session_seq`,
  pricing_snapshot: `INSERT INTO pricing_snapshot
      (scan_session_id, shop_id, source, query, comps, suggested_cents, override_cents, policy_id,
       session_seq, supersedes_id, operator_id, actor_verified)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$11::uuid IS NOT NULL) RETURNING id, created_at, session_seq`,
};

/** The successor's column values, in the order its INSERT above declares. */
function successorValues(
  row: SupersedingRow,
  sessionSeq: number,
  priorId: string,
  operatorId: string | null
): unknown[] {
  switch (row.table) {
    case "human_confirmation":
      return [
        JSON.stringify(row.values.confirmedIssue),
        row.values.source,
        row.values.outcome,
        sessionSeq,
        priorId,
        operatorId,
        row.values.against?.table ?? null,
        row.values.against?.id ?? null,
      ];
    case "condition_assessment":
      return [
        row.values.gradeRangeLow,
        row.values.gradeRangeHigh,
        [...row.values.defects],
        row.values.notes,
        sessionSeq,
        priorId,
        operatorId,
        row.values.against?.table ?? null,
        row.values.against?.id ?? null,
      ];
    case "pricing_snapshot":
      return [
        row.values.source,
        row.values.query,
        JSON.stringify(row.values.comps),
        row.values.suggestedCents,
        row.values.overrideCents,
        row.values.policyId,
        sessionSeq,
        priorId,
        operatorId,
      ];
  }
}

export interface SupersedeArgs {
  readonly shopId: string;
  readonly sessionId: string;
  /** The row being replaced — read from the table's `_current` view (041 §3.4). */
  readonly priorId: string;
  readonly row: SupersedingRow;
  /** 048 §6.3 — the operator, from the session and from nowhere else. */
  readonly operatorId?: string | null;
}

/**
 * Append a correction that names its predecessor, and return the new row.
 *
 * **`tx` is first and it is a `Tx`, not a `Queryable`** (041 §4.1): the read of the
 * predecessor, the `session_seq` assignment and the INSERT are one decision, and a
 * writer that could fall back to the pool would scatter them across connections.
 * **Call it after `lockScanSession`** — `assignSessionSeq` computes `max + 1` and is
 * atomic only under the anchor lock (041 §5.3); without it two concurrent
 * corrections read the same maximum and the per-table
 * `UNIQUE (scan_session_id, session_seq)` turns the race into a loud failure
 * instead of a duplicate.
 *
 * The three refusals below are the early, readable half of a rule the database
 * enforces anyway. They are checked in the order a reader would ask them:
 * does the predecessor exist, is it ours, is it still current.
 */
export async function supersede(tx: Tx, args: SupersedeArgs): Promise<SupersededRow> {
  const { table } = args.row;

  const prior = (await tx.query(PRIOR_SQL[table], [args.priorId])).rows[0] as
    { id: string; shop_id: string; scan_session_id: string; session_seq: string | null } | undefined;

  if (!prior) {
    throw new SupersessionError(
      "prior-not-found",
      table,
      args.priorId,
      `${table}: nothing to correct — no row ${args.priorId} exists. A correction names the row it ` +
        `replaces (041 §3.1); a first record supersedes nothing and is a plain append.`
    );
  }

  // R1, stated here and ENFORCED by 008's composite FK. The message never names
  // the other shop: 019 T24 is non-waivable and "no such row here" is all a
  // caller outside the scope may learn.
  if (prior.shop_id !== args.shopId || prior.scan_session_id !== args.sessionId) {
    throw new SupersessionError(
      "prior-out-of-scope",
      table,
      args.priorId,
      `${table}: row ${args.priorId} does not belong to this session. A successor sits in the same ` +
        `shop and the same session as its predecessor (041 §3.2 R1; 019 T24, non-waivable).`
    );
  }

  // R2, stated here and ENFORCED by 003's partial unique index. This is the
  // refusal a route turns into 040 A9's "here is the answer that won" — the
  // caller was looking at a row somebody else has already corrected.
  const existing = (await tx.query(SUCCESSOR_SQL[table], [args.priorId])).rows[0] as
    { id: string } | undefined;
  if (existing) {
    throw new SupersessionError(
      "prior-already-superseded",
      table,
      args.priorId,
      `${table}: row ${args.priorId} was already corrected by ${existing.id}. A row is superseded at ` +
        `most once, so the history is a chain and never a fork (041 §3.2 R2). Re-read the current ` +
        `record and correct that one.`
    );
  }

  // 041 §5.3, under the anchor lock this `tx` already holds. It is COMMIT order,
  // never act order — and it is also what R4's trigger compares, which is why a
  // superseding row assigned outside the lock is refused by `013` rather than
  // silently ordered wrong.
  const sessionSeq = await assignSessionSeq(tx, args.shopId, args.sessionId);

  const res = await tx.query(INSERT_SQL[table], [
    args.sessionId,
    args.shopId,
    ...successorValues(args.row, sessionSeq, args.priorId, args.operatorId ?? null),
  ]);
  return res.rows[0] as SupersededRow;
}
