// THE ONE-PASS REBUILD OF `lcid_current_survivor` (047 A2, §6.2, I18).
//
// The projection is a DERIVED READ MODEL, not a status column, and this file is
// what makes that claim checkable rather than asserted. Hickey's dissent in 047
// §14 is that a status column is "a second place a fact can live and disagree
// from"; the answer is that this projection is (i) written only by the
// transaction that appends the merge fact, and (ii) REPRODUCIBLE FROM
// `lcid_merge` ALONE by the rebuild below. A projection that satisfies both
// cannot disagree with the log for longer than a transaction, and any
// disagreement is A TEST FAILURE, NOT A DATA STATE — which is exactly what
// `tests/integration/lcid-lifecycle.test.ts` (I18) asserts, after a RANDOMIZED
// merge sequence built from the checked-in forest fixture.
//
// IT IS ONE PASS OVER `lcid_merge`, and that is a requirement rather than an
// optimisation (A2 obligation 1). `UNIQUE (losing_lcid)` makes the merge graph
// FUNCTIONAL — every node has at most one outgoing edge — so the whole forest is
// a map from loser to survivor, and the transitive closure is computed in memory
// with path compression in a single linear scan. No recursive CTE, no repeated
// queries, no N+1.
//
// WHEN TO RUN IT. Never on a request path. It exists for three reasons: the
// invariant test above; 041 §6.4's replay drill, which drops every derived read
// model and asserts each rebuilds byte-identically ("a derivation nobody replays
// is not a derivation"); and an operator recovering from a restore in which the
// projection is suspect. `scripts/rebuild-survivor-projection.ts` is the CLI.

import type { Tx } from "../db.js";
import { READ_CHAIN_BOUND } from "./resolve.js";

export interface RebuildResult {
  /** Rows in the rebuilt projection. */
  readonly rows: number;
  /** Merge facts read. One pass, so this is also the read count. */
  readonly merges: number;
  /**
   * LCIDs whose chain hit `READ_CHAIN_BOUND` before reaching a root — a CYCLE or
   * an implausible depth in `lcid_merge`.
   *
   * ⚠ THIS LIST SHOULD ALWAYS BE EMPTY, AND THAT IS EXACTLY WHY IT IS REPORTED
   * RATHER THAN ASSUMED. `migrations/015`'s `lcid_merge_no_cycle` trigger refuses
   * a cycle at WRITE time, so no cycle can exist in a database whose writes all
   * went through it. But this function's whole reason to exist is the database
   * where that is NOT true — a restore, a replay drill, a suspected corruption —
   * and a rebuild that assumed its own precondition would hang on the one input
   * it was written for. So the walk is bounded, the anomaly is a VALUE the caller
   * can act on, and a row whose root cannot be reached is LEFT OUT of the
   * projection rather than given a guessed survivor. An empty projection entry is
   * a `resolve` that answers "current" — visibly wrong and reviewable — where a
   * guessed one would be invisibly wrong.
   */
  readonly anomalies: readonly string[];
}

/**
 * Recompute `lcid_current_survivor` from `lcid_merge` and replace its contents.
 *
 * Runs inside the caller's transaction so the DELETE and the reinsert are atomic:
 * a reader never sees an empty projection, and a failed rebuild leaves the old
 * one in place rather than a half-built one.
 */
export async function rebuildSurvivorProjection(tx: Tx): Promise<RebuildResult> {
  const res = await tx.query(`SELECT losing_lcid, surviving_lcid FROM lcid_merge`);
  const edges = res.rows as { losing_lcid: string; surviving_lcid: string }[];

  const next = new Map<string, string>();
  for (const edge of edges) next.set(edge.losing_lcid, edge.surviving_lcid);

  // Path compression, BOUNDED. Each node is walked at most once across the whole
  // run, because every node it passes through is memoized on the way back out —
  // so this stays one pass over the edge set even for a deep chain. The bound is
  // the same `READ_CHAIN_BOUND` the resolver monitors, imported rather than
  // re-declared so the two can never drift apart.
  const root = new Map<string, string>();
  const anomalies: string[] = [];

  function rootOf(lcid: string): string | null {
    const memo = root.get(lcid);
    if (memo !== undefined) return memo;
    const path: string[] = [];
    let cursor = lcid;
    let hops = 0;
    for (;;) {
      const memoized = root.get(cursor);
      if (memoized !== undefined) {
        cursor = memoized;
        break;
      }
      const step = next.get(cursor);
      if (step === undefined) break;
      path.push(cursor);
      cursor = step;
      hops += 1;
      if (hops > READ_CHAIN_BOUND) {
        // A cycle, or a chain deep enough to be indistinguishable from one. Do
        // NOT memoize the partial walk — a wrong root cached here would silently
        // become the answer for every node behind it.
        return null;
      }
    }
    for (const node of path) root.set(node, cursor);
    return cursor;
  }

  await tx.query(`DELETE FROM lcid_current_survivor`);

  let rows = 0;
  for (const loser of next.keys()) {
    const survivor = rootOf(loser);
    if (survivor === null) {
      anomalies.push(loser);
      continue;
    }
    // The CHECK on the table forbids a self-pointing row; the merge triggers make
    // one impossible, so this is a belt-and-braces skip rather than a repair.
    if (survivor === loser) continue;
    await tx.query(`INSERT INTO lcid_current_survivor (lcid, survivor_lcid) VALUES ($1, $2)`, [
      loser,
      survivor,
    ]);
    rows += 1;
  }

  if (anomalies.length > 0) {
    console.warn(
      `[catalog] rebuildSurvivorProjection: ${anomalies.length} lcid(s) have a merge chain deeper ` +
        `than ${READ_CHAIN_BOUND} hops or a cycle, and are LEFT OUT of the projection rather than ` +
        `given a guessed survivor. migrations/015's lcid_merge_no_cycle trigger refuses these at ` +
        `write time, so their presence means this database took writes that did not go through it: ` +
        `${anomalies.slice(0, 10).join(", ")}${anomalies.length > 10 ? ", …" : ""}`
    );
  }

  return { rows, merges: edges.length, anomalies };
}
