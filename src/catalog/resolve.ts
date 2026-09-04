// `resolve(lcid, asOf)` — TOTAL, MANDATORY AS-OF, AND IT NEVER THROWS (047 §10).
//
// ⚠ `asOf` IS REQUIRED AT THIS MODULE'S BOUNDARY (047 A11, the Q3 ruling). v1.0.0
// of that record made the parameter optional with a current-corpus default and
// the cannon OVERRULED it: an optional parameter with a silent default lets a
// caller be "accidentally correct in dev and silently wrong in an eval-replay
// context months later", which is precisely the failure §6.2 built two named
// reads to prevent. The present tense is available, but ASKING FOR IT IS NOW AN
// EXPLICIT ACT WITH A NAME — `resolveCurrent`, used at NAMED call sites only
// (pricing, listing render, duplicate detection) and nowhere else. There is no
// second resolver and no second mechanism: `resolveCurrent` reads the current
// corpus version and calls `resolve`.
//
// ⚠ `resolve` IS TOTAL OVER FIVE OUTCOMES (047 A3, REQUIRED). "A resolver that
// returns a value on the happy path and SOMETHING ELSE on the rest is a resolver
// whose callers handle the rest by accident." So the return is a closed sum and
// every caller matches on it exhaustively. A sixth shape — a throw, an
// `undefined`, a bare `null` — fails `tests/integration/lcid-lifecycle.test.ts`
// (I12), which constructs all five outcomes and asserts each stable across runs.
//
// ⚠ AND IT NEVER THROWS PAST ITS CALLER (047 A10). At WRITE time an over-long or
// cyclic chain is a defect in the fact being proposed, and `migrations/017`'s
// trigger RAISES and refuses the INSERT. At READ time the same condition is a
// property of data that already committed, and a resolver that throws turns a
// catalog anomaly into a 500 on a pricing lookup. So a read that meets an
// anomalous chain returns `SPLIT_AMBIGUOUS`-shaped honesty — the `ambiguous`
// outcome — and the caller fails closed to the manual path (042 §8.3). Chain
// depth is MONITORED here, not enforced.
//
// ⚠ HOW THE READ IS COMPUTED, AND WHY IT IS NOT A RECURSIVE CTE ON THE HOT PATH
// (047 A2, §6.2). The current-corpus read is ONE index-only lookup on
// `lcid_current_survivor`, the materialized projection `migrations/017`
// maintains inside the merge's own transaction.
//
//   A DECISION THIS FILE HAD TO MAKE, because 047 states both halves and joins
//   neither: §6.2 says `resolve` reads the projection, and §10.2 makes `asOf`
//   mandatory — but the projection is CURRENT state and cannot answer a past
//   corpus. So there are two paths and the record's own logic picks between them:
//
//     * `asOf` IS the newest corpus version  -> read the projection (index-only,
//       the plan-shape gate's subject);
//     * `asOf` is a PAST corpus version      -> a bounded forward walk over
//       `lcid_merge` filtered to facts dated at or before `asOf`.
//
//   The second path is the eval-replay and audit path, which is by construction
//   not hot: 047 §10.2's whole argument for the as-of is that replay must see the
//   catalog as it then was, and a replay is a batch. Caching it is E06-B02's, and
//   047 A2 binds that bead: any cache of `resolve()` is keyed by corpus version
//   AND INVALIDATED TRANSACTIONALLY by inserts into the three lifecycle tables,
//   never by TTL — "a TTL is a guess about how long being wrong is acceptable".
//
//   A SECOND DECISION: HOW CORPUS VERSIONS ARE ORDERED. 047 says "a merge decided
//   against corpus N is not visible from a read as of corpus N−1" and never says
//   what N is. `corpus_version` has exactly one ordering column —
//   `built_at timestamptz` (`001:56`) — so "dated at or before `asOf`" is the
//   TUPLE `(built_at, id)`, compared as a row value. The id is not decoration: it
//   is what makes the order TOTAL when two corpus versions share a `built_at`,
//   which they do whenever an importer registers both in one transaction, because
//   `now()` is transaction-start time. See `AS_OF` below for the reproduction.
//   Recorded rather than assumed, because a later corpus-ingest bead (E04-B11)
//   may introduce an explicit sequence, and if it does this comparison moves with
//   it — one constant, one place.

import type { Queryable } from "../db.js";

/** The five outcomes, and there is no sixth (047 §10.2). */
export type ResolveOutcome =
  /** The LCID is live as of `asOf` and no disposition applies. */
  | { readonly status: "current"; readonly lcid: string }
  /** A merge dated at or before `asOf` names it as the losing side. */
  | { readonly status: "merged"; readonly survivor: string }
  /** A retirement dated at or before `asOf` names it. It names nothing — that is an answer. */
  | { readonly status: "retired" }
  /** A split dated at or before `asOf` names it as the source with no earned continuation. */
  | { readonly status: "split_ambiguous"; readonly splitId: string | null }
  /**
   * `asOf` precedes `minted_in_corpus_version_id` — the name did not exist in the
   * world being read.
   *
   * ⚠ AN UNKNOWN STRING LANDS HERE TOO, and that is a decision. 047 names five
   * outcomes and no sixth, so a value with no registry row must map to one of
   * them. `NOT_YET_MINTED` is the honest reading — as of any corpus, it has not
   * been minted — and it is what the record's own reasoning demands: returning
   * "not found" would conflate a name that did not exist YET with a name that
   * never existed, which is 030 A1's two-meanings-of-NULL hazard arriving in a
   * return value. Callers that need the distinction ask the registry directly.
   */
  | { readonly status: "not_yet_minted" };

/**
 * Read-path chain bound. MONITORED, NOT ENFORCED (047 A10): exceeding it yields
 * `split_ambiguous` and a warning, never a throw. Provisional and
 * non-evidentiary, like the write-side bound it mirrors.
 */
export const READ_CHAIN_BOUND = 64;

/**
 * THE AS-OF PREDICATE. Two properties, and both were bugs before they were rules.
 *
 * ⚠ 1. IT COMPARES THE TUPLE `(built_at, id)`, NOT `built_at` ALONE.
 *
 * `corpus_version.built_at` DEFAULTs to `now()`, which in Postgres is
 * TRANSACTION-START time — so two corpus versions inserted in one transaction
 * carry the SAME timestamp. Under a `built_at <= …` predicate a read as of
 * either one would see the other's mints, merges, splits and retirements: 047
 * §10.2's rule ("a merge decided against corpus N is not visible from a read as
 * of corpus N−1") would silently fail for every tied pair, and it would fail as a
 * WRONG ANSWER rather than as an error. `id` is a `uuid` with a total order, so
 * the tuple is a total order over corpus versions whether or not the timestamps
 * tie, and `newestCorpusId` below sorts on the same tuple so "newest" and
 * "at or before" can never disagree.
 *
 * The tie is not hypothetical and is not a test artefact: an importer that
 * registers two corpus snapshots in one transaction is the ordinary case, and
 * `catalogHelpers.ts` originally spaced its fixtures a minute apart to avoid it
 * — a workaround that hid the defect from the very suite meant to catch it. The
 * spacing is gone and `tests/integration/lcid-lifecycle.test.ts` now mints two
 * corpora inside ONE transaction and asserts the as-of read is exact.
 *
 * ⚠ 2. IT IS EVALUATED IN SQL, NEVER IN JAVASCRIPT.
 *
 * `timestamptz` has MICROSECOND precision; a JavaScript `Date` has MILLISECOND
 * precision. Reading `built_at` into JS and passing it back as a parameter
 * TRUNCATES it, so the predicate would exclude the very row the caller named.
 * Same class of failure as the tie, same direction: a wrong answer, not an error.
 * So the as-of is always the corpus version's ID and the comparison is a
 * row-valued scalar subquery.
 */
const AS_OF = `(SELECT c2.built_at, c2.id FROM corpus_version c2 WHERE c2.id = $2)`;

/** `(built_at, id) <= asOf`, for a `corpus_version` aliased `c`. */
const AT_OR_BEFORE_AS_OF = `(c.built_at, c.id) <= ${AS_OF}`;

/**
 * A syntactically valid uuid. Checked in JS so that a MALFORMED id is a caller
 * mistake answered with an outcome, while a REAL database error — a dropped
 * table, a lost connection, a permission refusal — propagates instead of being
 * laundered into `not_yet_minted`.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function corpusExists(db: Queryable, corpusVersionId: string): Promise<boolean> {
  // `resolve` never throws PAST ITS CALLER about the DATA it reads (047 A10) —
  // that is a rule about catalog anomalies, not a licence to swallow
  // infrastructure failures. A caught-and-discarded connection error would report
  // "this name did not exist yet", which is a confident wrong answer about the
  // catalog when the truth is that nobody could read it.
  if (!UUID_RE.test(corpusVersionId)) return false;
  const res = await db.query(`SELECT 1 FROM corpus_version WHERE id = $1`, [corpusVersionId]);
  return res.rows.length > 0;
}

async function newestCorpusId(db: Queryable): Promise<string | null> {
  // The same tuple the as-of predicate compares, in the same order.
  const res = await db.query(`SELECT id FROM corpus_version ORDER BY built_at DESC, id DESC LIMIT 1`);
  return (res.rows[0] as { id: string } | undefined)?.id ?? null;
}

/**
 * The catalog's one resolver. `asOf` is a `corpus_version.id` and is REQUIRED.
 *
 * Never throws. A malformed LCID, an unknown LCID, a missing corpus version and
 * an anomalous merge chain all return outcomes.
 */
export async function resolve(
  db: Queryable,
  lcid: string,
  asOfCorpusVersionId: string
): Promise<ResolveOutcome> {
  if (!(await corpusExists(db, asOfCorpusVersionId))) {
    // A corpus version that does not exist describes no world, so nothing was
    // minted in it. Still an outcome, still not a throw.
    return { status: "not_yet_minted" };
  }
  const asOf = asOfCorpusVersionId;

  const reg = await db.query(
    `SELECT r.lcid
       FROM lcid_registry r
       JOIN corpus_version c ON c.id = r.minted_in_corpus_version_id
      WHERE r.lcid = $1 AND ${AT_OR_BEFORE_AS_OF}`,
    [lcid, asOf]
  );
  const registry = reg.rows[0] as { lcid: string } | undefined;
  if (!registry) return { status: "not_yet_minted" };

  // Dispositions are mutually exclusive by construction (047 §5.1, the
  // three-way guard in migrations/017), so the order of these two lookups is
  // presentational, not semantic.
  const retired = await db.query(
    `SELECT 1 FROM lcid_retirement r
       JOIN corpus_version c ON c.id = r.corpus_version_id
      WHERE r.lcid = $1 AND ${AT_OR_BEFORE_AS_OF}`,
    [lcid, asOf]
  );
  if (retired.rows.length > 0) return { status: "retired" };

  const splitRes = await db.query(
    `SELECT s.id,
            (SELECT o.product_lcid FROM lcid_split_outcome o
              WHERE o.split_id = s.id AND o.is_continuation) AS continuation
       FROM lcid_split s
       JOIN corpus_version c ON c.id = s.corpus_version_id
      WHERE s.source_lcid = $1 AND ${AT_OR_BEFORE_AS_OF}`,
    [lcid, asOf]
  );
  const splitRow = splitRes.rows[0] as { id: string; continuation: string | null } | undefined;
  if (splitRow) {
    // 047 §7.2: continuation must be EARNED. When one was earned the source
    // resolves forward to it; otherwise the answer is ambiguity, which callers
    // handle rather than swallow.
    if (splitRow.continuation) return { status: "merged", survivor: splitRow.continuation };
    return { status: "split_ambiguous", splitId: splitRow.id };
  }

  const survivor = await resolveMerges(db, lcid, asOf);
  if (survivor === null) return { status: "current", lcid: registry.lcid };
  if (survivor === AMBIGUOUS) return { status: "split_ambiguous", splitId: null };
  return { status: "merged", survivor };
}

/** Sentinel for an anomalous chain — the read-time counterpart of a write-time raise. */
const AMBIGUOUS = Symbol("lcid chain anomaly");

async function resolveMerges(
  db: Queryable,
  lcid: string,
  asOf: string
): Promise<string | null | typeof AMBIGUOUS> {
  const newest = await newestCorpusId(db);
  if (newest === asOf) {
    // THE HOT PATH. One index-only lookup on the projection.
    // `tests/integration/lcid-lifecycle.test.ts` (I18) asserts the plan is an
    // Index Only Scan; a plan that degrades to a sequential scan or a recursive
    // CTE fails the build (047 A2 obligation 2).
    const res = await db.query(`SELECT survivor_lcid FROM lcid_current_survivor WHERE lcid = $1`, [lcid]);
    const row = res.rows[0] as { survivor_lcid: string } | undefined;
    return row ? row.survivor_lcid : null;
  }

  // THE AS-OF PATH — replay and audit. A bounded forward walk over merges dated
  // at or before `asOf`. `UNIQUE (losing_lcid)` makes the graph functional, so
  // this is a walk and not a search.
  let cursor = lcid;
  let hops = 0;
  for (;;) {
    const res = await db.query(
      `SELECT m.surviving_lcid FROM lcid_merge m
         JOIN corpus_version c ON c.id = m.corpus_version_id
        WHERE m.losing_lcid = $1 AND ${AT_OR_BEFORE_AS_OF}`,
      [cursor, asOf]
    );
    const next = (res.rows[0] as { surviving_lcid: string } | undefined)?.surviving_lcid;
    if (!next) return hops === 0 ? null : cursor;
    hops += 1;
    if (hops > READ_CHAIN_BOUND) {
      // MONITORED, NOT ENFORCED. A depth over the bound pages an operator; it does
      // not raise, because the caller asked a question about committed data.
      console.warn(
        `[catalog] resolve(${lcid}, asOf=${asOf}): merge chain exceeded ${READ_CHAIN_BOUND} hops — ` +
          `returning ambiguous rather than throwing (047 A10)`
      );
      return AMBIGUOUS;
    }
    cursor = next;
  }
}

/**
 * The present tense, as an explicit act.
 *
 * ⚠ PERMITTED AT NAMED CALL SITES ONLY (047 §10.2) — pricing, listing render,
 * duplicate detection — and nowhere else. The named-call-site rule is enforceable
 * the way I16 is, by an architecture-rule assertion listing the files permitted
 * to import it; that assertion belongs with the first real call site and there is
 * none yet, so today the rule is this comment and the surface test.
 *
 * A TRAIL READ NEVER RESOLVES (047 §6.2, I9). A session trail, an audit, a
 * supersession chain, an eval replay and a `GET …/:id` events payload all want
 * `asStated` — the LCID the row actually cites — and answering with the survivor
 * would SILENTLY RESTATE WHAT A PERSON CONFIRMED. `asStated` needs no function:
 * it is the column, read.
 */
export async function resolveCurrent(db: Queryable, lcid: string): Promise<ResolveOutcome> {
  const newest = await newestCorpusId(db);
  if (newest === null) {
    // No corpus has ever been built, so no name has entered any world.
    return { status: "not_yet_minted" };
  }
  return resolve(db, lcid, newest);
}
