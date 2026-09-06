// 019 T35(b)'s RECONCILIATION, AGGREGATED FOR AN OPERATOR (E03-D17).
//
// Docs: 000-docs/060 §6; 019 T35(b) (NON-WAIVABLE — *"`created_by`/`operator_id`
// selectable only inside one audited accessor module"*), T35's rule (*"any
// rendering → K1"*), T34 (a detector that goes stale is itself a K1); 022 P3;
// 034 §3.3, §3.4 (what a K1 costs); 048 §12.4 row 6; 054 §8.
//
// **WHY IT LIVES UNDER `scripts/` AND NOT UNDER `src/`.** `crossTenantAudit.ts`
// set the precedent two thresholds over and `breakGlassAudit.ts` followed it:
// the only runtime caller is a CLI, so `depcruise`'s no-orphans rule over `src/`
// keeps meaning what it says. Here it is stronger than a convention — **no code
// under `src/` reads `identity_access` at all, and the database enforces it**:
// the application role holds `INSERT` and no `SELECT` (`appGrant: "insert-only"`,
// 000-docs/060 §3.4), so a reader inside the running server would fail at
// runtime rather than merely be untidy. `tests/contract/` asserts the absence.
//
// When E13-B04-D1 (`longbox-e5b.13.4.1`) gives this a scheduled home the file
// moves, and that move is the signal it has become part of the system rather
// than an operator's tool.
//
// ============================================================================
// WHAT A FINDING IS — 019 T35(b)'s TEXT, MADE DECIDABLE
// ============================================================================
//
// T35(b) reads: *"`created_by`/`operator_id` selectable only inside one audited
// accessor module"*. Two halves, and they fail in different places:
//
//   * **"only inside one module"** is a property of the SOURCE TREE, and it is
//     `pnpm arch`'s `identity-is-the-only-person-join` — a red build, before
//     anything runs.
//   * **"audited"** is a property of the RUNNING SYSTEM, and it is this. The
//     source rule proves that every person-resolution goes through the accessor;
//     it cannot prove that what the accessor RECORDED is a vocabulary anybody
//     signed off. That is what these two findings are:
//
//       (a) **an undeclared accessor** — a row whose `(method, path)` pair is in
//           no `DECLARED_ACCESSORS` row. Someone added a surface that resolves
//           people and did not declare it, which means it was not reviewed as
//           one. The `purpose` CHECK cannot catch this: an accessor list grows
//           every time somebody adds a screen and cannot be a constraint.
//
//       (b) **an undeclared purpose for a declared accessor** — a row whose
//           accessor exists but was never declared to cite that purpose. This is
//           the copy-paste failure: a new read reusing the nearest existing
//           `purpose` string because it type-checks.
//
//     Plus one DRIFT check that is neither: the database's own `purpose` CHECK
//     is compared with `IDENTITY_PURPOSES`. A migration that widened the CHECK
//     without widening the code — or the reverse — means the closed vocabulary
//     has two definitions, and 019 T35(b) would then be enforced by whichever
//     one the reader happened to read.
//
// **WHAT IT DOES AND DOES NOT MAKE K1.** 019 §3.4's K1 list is CLOSED and 043
// §5.4 is explicit that a record has no standing to open it; this file opens
// nothing. T35's own rule is *"any rendering → K1"*, and a finding here is
// evidence that a person-resolution reached an unreviewed surface — which is
// where a rendering comes from and is not itself proof that one happened. So the
// exit code is a **T35(b) GATE FAILURE**, reported in those words, and whether a
// given finding is a K1 is decided by reading the accessor it names against
// T35(a). Saying more than that would be inventing a rule; saying less would
// make the exit code advisory.
//
// ============================================================================
// WHAT IT PRINTS
// ============================================================================
//
// **COUNTS, per purpose and per accessor.** Never a person, never a shop, never
// a timestamp of an individual access — and it could not print a person if it
// wanted to, because `identity_access` holds no subject at all (000-docs/060 §5).
// That is a stronger property than `breakGlassAudit.ts`'s, which withholds an
// identifier the row does carry; here the column does not exist.
import { IDENTITY_PURPOSES, isDeclaredAccess, type IdentityPurpose } from "../src/identity/index.js";

/** The minimum client surface this module needs. */
export interface AuditClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * The default lookback for the EXIT CODE, in hours.
 *
 * 24, matching `breakGlassAudit.ts`'s, and a **PROVISIONAL floor** rather than a
 * signed value — no artifact may quote it as a detection guarantee. The history
 * is append-only and cannot be repaired, so an audit that never forgets is an
 * audit that stays red forever after one finding and is therefore ignored; the
 * incident record is the 006 row, and the exit code is for the cadence. The
 * caller's obligation is the same one 058 §4 states: the lookback must exceed
 * the cadence, and a missed run is answered with `--hours` or `--all`.
 */
export const DEFAULT_LOOKBACK_HOURS = 24;

/** One (purpose, accessor) bucket. */
export interface AccessBucket {
  readonly purpose: string;
  readonly method: string;
  readonly path: string;
  /**
   * How many ACCESSES — rows — fell in this bucket.
   *
   * An access, never an "act" and never a "request": one accessor call is one
   * row, and a route that resolved a person twice in one request would be two.
   * The noun discipline is 059 §5's, applied to a second audit table by hand
   * because `pnpm arch`'s rule 3d is scoped to the other one.
   */
  readonly accesses: number;
  /** How many PEOPLE those accesses resolved in total (a roster contributes N). */
  readonly resolved: number;
  /** Is this (accessor, purpose) pair one somebody declared? */
  readonly declared: boolean;
}

export interface IdentityAccessAuditResult {
  readonly windowHours: number | null;
  readonly buckets: readonly AccessBucket[];
  /** Buckets whose accessor or purpose nobody declared. Empty is the healthy state. */
  readonly undeclared: readonly AccessBucket[];
  /**
   * Purposes the database's CHECK allows that the code does not declare, and the
   * reverse. Either direction means the closed vocabulary has two definitions.
   */
  readonly purposeDrift: readonly string[];
  readonly clean: boolean;
}

/**
 * Read the purposes the LIVE database will accept, from its own CHECK.
 *
 * `pg_get_constraintdef` rather than a second hardcoded list, for
 * `rowLevelSecurity.ts`'s reason: a copy of a declaration is a copy that can
 * drift, and the drift is exactly what this is checking for.
 */
export async function livePurposes(client: AuditClient): Promise<string[]> {
  const res = await client.query(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'identity_access'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%purpose%'`
  );
  const defs = (res.rows as Array<{ def: string }>).map((r) => r.def).join(" ");
  return [...defs.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
}

/**
 * The reconciliation. Returns the buckets, the undeclared ones, and the drift.
 *
 * An empty `undeclared` and an empty `purposeDrift` is the healthy state and the
 * caller has nothing to interpret.
 */
export async function runIdentityAccessAudit(
  client: AuditClient,
  options: { readonly windowHours?: number | null } = {}
): Promise<IdentityAccessAuditResult> {
  const windowHours = options.windowHours === undefined ? DEFAULT_LOOKBACK_HOURS : options.windowHours;
  // ⚠ THE WINDOW START IS ITSELF TRUNCATED TO THE HOUR, AND IT HAS TO BE.
  // `identity_access.created_at` defaults to `date_trunc('hour', now())` (the
  // security lens's F5), so a stored timestamp is at most one hour EARLIER than
  // the access it records — and a window starting at a wall-clock instant would
  // therefore drop rows whose true time was inside it. Truncating the start
  // makes the window strictly WIDER and never narrower, which is the direction
  // 000-docs/044 §2 argues for: a false inclusion costs a reader one bucket, a
  // false exclusion costs a detector a finding.
  const since =
    windowHours === null
      ? null
      : new Date(Math.floor((Date.now() - windowHours * 60 * 60 * 1000) / 3_600_000) * 3_600_000);

  const res = await client.query(
    `SELECT a.purpose, a.accessor_method, a.accessor_path,
            count(*)::int AS accesses,
            coalesce(sum(a.resolved_count), 0)::int AS resolved
       FROM identity_access a
      WHERE ($1::timestamptz IS NULL OR a.created_at >= $1)
      GROUP BY a.purpose, a.accessor_method, a.accessor_path
      ORDER BY a.accessor_method, a.accessor_path, a.purpose`,
    [since]
  );

  const buckets: AccessBucket[] = (
    res.rows as Array<{
      purpose: string;
      accessor_method: string;
      accessor_path: string;
      accesses: number;
      resolved: number;
    }>
  ).map((r) => ({
    purpose: r.purpose,
    method: r.accessor_method,
    path: r.accessor_path,
    accesses: r.accesses,
    resolved: r.resolved,
    declared: isDeclaredAccess(r.accessor_method, r.accessor_path, r.purpose),
  }));

  const live = await livePurposes(client);
  const code = [...IDENTITY_PURPOSES].sort();
  const purposeDrift = [
    ...live
      .filter((p) => !(code as string[]).includes(p))
      .map((p) => `database allows '${p}', code does not declare it`),
    ...code
      .filter((p) => !live.includes(p))
      .map((p) => `code declares '${p}', the database CHECK refuses it`),
  ];

  const undeclared = buckets.filter((b) => !b.declared);
  return {
    windowHours,
    buckets,
    undeclared,
    purposeDrift,
    clean: undeclared.length === 0 && purposeDrift.length === 0,
  };
}

/** The declared vocabulary, for a caller that wants to print it. */
export function declaredPurposes(): readonly IdentityPurpose[] {
  return IDENTITY_PURPOSES;
}
