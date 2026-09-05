// Optimistic concurrency on 040 A1's causal reference (042 §6), and the derived
// session state 040 §3.1 makes the only truth about where a session is.
//
// WHY A REFERENCE AND NOT A TIMESTAMP (040 A1). *Time is a proxy for causality;
// record the causality.* A write says what world it was made against, and the
// reader checks — so two devices at one counter are separated by what each
// operator was looking at, not by whose clock ran later.
//
// WHAT REFUSES, AND WHEN. The comparison runs under the anchor lock (041 §4.2),
// which is what makes the refusal DETERMINISTIC rather than racy: the loser
// blocks, reads the winner's row, and is refused with the winner's answer in
// hand. The refusal carries `details.current = {table, id}` — **the reference
// only, never the row and never an actor** (042 §6.4): putting the winning row
// in the error body would be a second read path with its own leak surface, at
// the exact moment two operators are already confused. The client fetches the
// other answer through the ordinary, tenancy-scoped read path.
//
// IT ALSO PERSISTS IT, SINCE E02-D11 — and only by way of this file. 041 §10
// row 2's columns exist on `human_confirmation` and `condition_assessment`
// (migration `030`), and the ONLY value that may reach them is the one
// `assertWorldViewIsCurrent` returns: a `WitnessedReference`, which is this
// module's `Against` under a brand no other module can construct. A caller that
// hands a request body straight to an INSERT does not compile. That is the whole
// mechanism behind 041 §3.5's requirement that the stored reference be the
// CHECKED one — a rule enforced by review would be a rule until the first hurry.
//
// WHAT IS STORED IS WHAT THE ACTOR SAW, NOT WHAT IS CURRENT NOW. The reference
// is written once, inside the transaction that checked it, and never revisited:
// a row that names a record something later supersedes keeps naming it. That is
// the point rather than a limitation — 040 §3.4 clause 2 asks what world a
// decision was made against, and a reference silently advanced to the winner
// would answer a question nobody asked.
import type { Queryable, Tx } from "../db.js";
import { assertSafeIdentifier } from "../db/appRoleGrants.js";
import { LongboxError } from "../contracts/v1/errors.js";
import type { Against } from "../contracts/v1/schemas.js";
// The brand lives in a leaf with no imports because the contract layer imports
// `GRADE_LABELS` from `src/services/condition.ts`, so a shared type that reached
// the contract layer would close a cycle for every writer. See that file.
import type { WitnessedReference } from "./witnessedReference.js";

export type { WitnessedReference };

/**
 * 040 §3.2's implied ladder. `llm_rerank` shares rung 2 with `candidate_set` by
 * that table's own words: "an `llm_rerank` row refines the band but does not
 * raise the rung — a barcode-only resolution is a proposal too".
 */
export const WITNESS_RUNG: Record<Against["table"], number> = {
  scan_photo: 1,
  candidate_set: 2,
  llm_rerank: 2,
  human_confirmation: 3,
  condition_assessment: 4,
  pricing_snapshot: 5,
  shopify_draft: 6,
};

export const RUNG_STATE = [
  "intake",
  "captured",
  "proposed",
  "confirmed",
  "conditioned",
  "priced",
  "drafted",
] as const;

/** The three tables whose currency is a supersession chain, not an existence check. */
const CURRENT_VIEWS: Partial<Record<Against["table"], string>> = {
  human_confirmation: "human_confirmation_current",
  condition_assessment: "condition_assessment_current",
  pricing_snapshot: "pricing_snapshot_current",
};

export interface WitnessFlags {
  captured: boolean;
  proposed: boolean;
  confirmed: boolean;
  conditioned: boolean;
  priced: boolean;
  drafted: boolean;
}

/**
 * The highest rung whose witness exists — "highest rung whose witness exists",
 * never a timestamp comparison, because the rungs are not a total order over
 * time: a re-price after a draft is an ordinary correction and must not push the
 * session back to `priced` (040 §3.2).
 */
export function impliedRung(flags: WitnessFlags): number {
  if (flags.drafted) return 6;
  if (flags.priced) return 5;
  if (flags.conditioned) return 4;
  if (flags.confirmed) return 3;
  if (flags.proposed) return 2;
  if (flags.captured) return 1;
  return 0;
}

/**
 * One statement, and it returns the current row's ID per rung rather than a
 * boolean.
 *
 * The id is what 042 §6.4 asks a refusal to carry — `details.current = {table,
 * id}` — so the losing client can fetch the winning answer through the ordinary
 * read path. A boolean would have made the refusal say WHICH TABLE moved without
 * saying WHICH ROW to read, which is half an answer at the moment two operators
 * are already confused. The flags are derived from the ids, so there is one query
 * and one truth rather than two that can disagree.
 */
const WITNESS_SQL = `SELECT
  (SELECT id FROM scan_photo WHERE scan_session_id = $1 AND shop_id = $2
     ORDER BY taken_at DESC, id DESC LIMIT 1) AS captured,
  (SELECT id FROM candidate_set WHERE scan_session_id = $1 AND shop_id = $2
     ORDER BY created_at DESC, id DESC LIMIT 1) AS proposed,
  (SELECT id FROM human_confirmation_current WHERE scan_session_id = $1 AND shop_id = $2) AS confirmed,
  (SELECT id FROM condition_assessment_current WHERE scan_session_id = $1 AND shop_id = $2) AS conditioned,
  (SELECT id FROM pricing_snapshot_current WHERE scan_session_id = $1 AND shop_id = $2) AS priced,
  (SELECT id FROM shopify_draft WHERE scan_session_id = $1 AND shop_id = $2 AND status = 'draft'
     ORDER BY created_at DESC, id DESC LIMIT 1) AS drafted`;

/** The current row per rung, `null` where that rung has no witness. */
export interface WitnessIds {
  captured: string | null;
  proposed: string | null;
  confirmed: string | null;
  conditioned: string | null;
  priced: string | null;
  drafted: string | null;
}

export async function readWitnessIds(db: Queryable, shopId: string, sessionId: string): Promise<WitnessIds> {
  const res = await db.query(WITNESS_SQL, [sessionId, shopId]);
  return res.rows[0] as WitnessIds;
}

export function flagsOf(ids: WitnessIds): WitnessFlags {
  return {
    captured: ids.captured !== null,
    proposed: ids.proposed !== null,
    confirmed: ids.confirmed !== null,
    conditioned: ids.conditioned !== null,
    priced: ids.priced !== null,
    drafted: ids.drafted !== null,
  };
}

export async function readWitnessFlags(
  db: Queryable,
  shopId: string,
  sessionId: string
): Promise<WitnessFlags> {
  return flagsOf(await readWitnessIds(db, shopId, sessionId));
}

export interface TransitionRow {
  id: string;
  kind: "parked" | "resumed" | "voided" | "reopened";
  reopened_to_rung: string | null;
  created_at: string;
}

export async function readTransitions(
  db: Queryable,
  shopId: string,
  sessionId: string
): Promise<TransitionRow[]> {
  const res = await db.query(
    `SELECT id, kind, reopened_to_rung, created_at FROM scan_session_transition
      WHERE scan_session_id = $1 AND shop_id = $2 ORDER BY created_at, id`,
    [sessionId, shopId]
  );
  return res.rows as TransitionRow[];
}

/**
 * 040 §3.4's derived-state rule, as far as the tree can honestly carry it.
 *
 * Clause 1 (`voided` is terminal whatever else exists) and clause 4 (the implied
 * rung) are implemented in full. Clause 2's causal comparison degrades to "the
 * newest transition still speaks" because `scan_session_transition.against_*`
 * has no writer yet — nothing writes a transition at all (the endpoint is 040
 * §7's and is not built) — so the branch is reachable only through a hand-seeded
 * row today.
 *
 * **Clause 3 (`abandoned`) is deliberately NOT implemented.** `abandon_after` is
 * a SIGNED OPEN parameter (040 §3.5): 042 A3 gave the two rate parameters
 * provisional floors precisely because they PROTECT the system, and left this
 * one open because it DESCRIBES a session — "a provisional value there would
 * manufacture provisional facts". Implementing it would require inventing the
 * number this project has twice refused to invent.
 */
export function deriveState(
  flags: WitnessFlags,
  transitions: readonly TransitionRow[]
): (typeof RUNG_STATE)[number] | "parked" | "voided" {
  if (transitions.some((t) => t.kind === "voided")) return "voided";
  const newest = transitions[transitions.length - 1];
  const implied = RUNG_STATE[impliedRung(flags)]!;
  if (!newest) return implied;
  if (newest.kind === "parked") return "parked";
  if (newest.kind === "reopened" && newest.reopened_to_rung) {
    return newest.reopened_to_rung as (typeof RUNG_STATE)[number];
  }
  return implied;
}

/**
 * 040 A1's LOGGED fallback counter (040 I18), process-local.
 *
 * `against` is OPTIONAL in `v1` (042 §6.5) because making it required on day one
 * would 400 every replay from a queue written by yesterday's client. **An
 * uncounted fallback is a silent return to the rule it replaced**, so the count
 * is the evidence that the fallback is not quietly becoming the norm — and it is
 * what a `v2` decision to make the field required will be taken from.
 */
export const againstFallback = { count: 0 };

export interface CurrencyCheck {
  /** The rung of the record the actor says they were shown. */
  againstRung: number;
  /** The session's highest existing witness. */
  impliedRung: number;
  /** For a superseded-chain table: is the referenced row still the current one? */
  rowIsCurrent: boolean;
}

/**
 * The pure half of the comparison — extracted so the rule is testable without a
 * database, and so a reader can see that it is three clauses and not a query.
 *
 * A reference is stale when the record it names has been SUPERSEDED (someone
 * corrected the very row the actor was looking at) or when the session has
 * MOVED PAST its rung (040 §3.4 clause 2: "the session advanced past what its
 * author was looking at"). A reference ABOVE the implied rung is not stale: that
 * is the ordinary case of an actor holding a row this transaction is about to
 * count.
 */
export function isStale(check: CurrencyCheck): boolean {
  if (!check.rowIsCurrent) return true;
  return check.againstRung < check.impliedRung;
}

/**
 * Refuse a write whose world-view has moved (042 §6.1), and RETURN the reference
 * it accepted. Call under the anchor lock, after `lockScanSession` and after the
 * idempotency INSERT.
 *
 * The return value is the seam E02-D11 needed: a caller that wants to persist
 * what the actor was looking at takes it from here, so the value in the column
 * is by construction the value this function read out of the named table in this
 * transaction. `null` means 042 §6.5's counted fallback — no reference was sent,
 * nothing is refused, and the row stores NULL for both columns rather than a
 * reference somebody guessed.
 */
export async function assertWorldViewIsCurrent(
  tx: Tx,
  shopId: string,
  sessionId: string,
  against: Against | undefined
): Promise<WitnessedReference | null> {
  if (!against) {
    againstFallback.count += 1;
    return null;
  }

  const view = CURRENT_VIEWS[against.table];
  // The identifier comes from a CLOSED enum (`AGAINST_TABLES`) via the map
  // above, and is asserted anyway — the same `assertSafeIdentifier` the grant
  // plan and `assignSessionSeq` use. The assertion is what keeps the guarantee
  // true if the list ever starts being built from something else.
  const existsIn = assertSafeIdentifier(view ?? against.table, "against table");
  const res = await tx.query(
    `SELECT 1 FROM ${existsIn} WHERE id = $1 AND scan_session_id = $2 AND shop_id = $3`,
    [against.id, sessionId, shopId]
  );
  const ids = await readWitnessIds(tx, shopId, sessionId);
  const check: CurrencyCheck = {
    againstRung: WITNESS_RUNG[against.table],
    impliedRung: impliedRung(flagsOf(ids)),
    rowIsCurrent: res.rows.length > 0,
  };
  // The brand is applied HERE and nowhere else: the value returned is the one
  // just proved to name a live row of `against.table` in this shop and this
  // session, read inside this transaction under the anchor lock.
  if (!isStale(check)) return against as WitnessedReference;

  throw new LongboxError("STALE_WORLD_VIEW", { current: currentReference(ids) });
}

/**
 * `details.current` — **the reference, and nothing but the reference** (042 §6.4).
 *
 * A table and an id, which is exactly what a client needs to fetch the winning
 * answer through the ordinary read path — already tenancy-scoped and, once 034
 * §3.3's accessor lands, already break-glass-gated for per-operator fields.
 * Never the row and never an actor: putting the winner's record in the error body
 * would be a second read path with its own leak surface, at the moment two
 * operators are already confused, against a T35 that 019 signs at zero.
 */
function currentReference(ids: WitnessIds): { table: string; id: string | null } {
  const rung = impliedRung(flagsOf(ids));
  const byRung = [
    { table: "scan_session", id: null },
    { table: "scan_photo", id: ids.captured },
    { table: "candidate_set", id: ids.proposed },
    { table: "human_confirmation", id: ids.confirmed },
    { table: "condition_assessment", id: ids.conditioned },
    { table: "pricing_snapshot", id: ids.priced },
    { table: "shopify_draft", id: ids.drafted },
  ] as const;
  const row = byRung[rung] ?? byRung[0]!;
  return { table: row.table, id: row.id };
}
