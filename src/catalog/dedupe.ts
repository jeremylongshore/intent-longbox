// LOOKUP BY SIGNATURE, LOOKUP BY ALIAS, AND THE DEDUPE CANDIDATE (E04-B02).
//
// ⚠ A SIGNATURE IS NOT AN IDENTITY (030 §3.3, verbatim): "Two rows with the same
// signature are a DEDUPE CANDIDATE — a human-queue item under 014 §4.3's
// 'high-impact or conflicting crosswalks enter a human queue' — never an
// automatic merge." Nothing in this file merges, and nothing in it picks a winner.
// `findDedupeCandidates` RETURNS the collision; `lookupBySignature` REFUSES to
// answer when there is one. Both are the same rule seen from two sides, and the
// rule has teeth in the schema too: `edition_signature` carries no UNIQUE (047
// A1/I17), so a collision is a legal state of the database rather than a write
// failure, and the repair is an `lcid_merge` fact somebody decided (047 §6).
//
// The reason that is not over-caution is what an automatic merge would cost.
// Merging is unrecoverable under append-only rules — 036 §7 says it for copies
// and the argument is identical here — and a signature collision has at least
// three innocent causes: two importers landing the same book from two sources,
// one genuine duplicate, and two DIFFERENT books whose distinguishing field the
// corpus does not record. The third is why the answer is a queue: the machine
// cannot tell it from the second.
//
// ⚠ EVERY READ IS AS-OF, AND THE PREDICATE IS `resolve.ts`'s. 047 §9.2 requires
// resolution to be "deterministic given the corpus version" — same confirmation,
// same corpus, same answer, which is what makes an eval replayable (041 §2.6) and
// a disagreement between two runs a finding rather than noise. A lookup that read
// the whole table would answer differently the day after an import, silently, and
// I12's determinism assertion would be measuring the clock. `AT_OR_BEFORE_AS_OF`
// is imported rather than restated: the tuple comparison and the
// evaluate-it-in-SQL rule were both bugs before they were rules, and a second
// copy is a second definition that drifts the next time one is corrected.

import type { Queryable } from "../db.js";
import { AT_OR_BEFORE_AS_OF } from "./resolve.js";

export interface SignatureQuery {
  readonly vertical: string;
  readonly signature: string;
  readonly normalizationVersion: number;
  /** A `corpus_version.id`. REQUIRED, for the same reason `resolve`'s is (047 A11). */
  readonly asOfCorpusVersionId: string;
}

/**
 * Every edition carrying this signature as of that corpus version, ascending by
 * LCID so the order is total and reproducible rather than plan-dependent.
 *
 * The DISTINCT is on `edition_lcid` and not on the row: one edition legitimately
 * has several `edition_signature` rows (030 A4's aliases), and re-listing the
 * same edition once per alias would turn an edition with two names into a
 * "collision" with itself.
 */
export async function findEditionsBySignature(db: Queryable, q: SignatureQuery): Promise<readonly string[]> {
  const res = await db.query(
    `SELECT DISTINCT s.edition_lcid
       FROM edition_signature s
       JOIN corpus_version c ON c.id = s.corpus_version_id
      WHERE s.vertical = $1 AND ${AT_OR_BEFORE_AS_OF}
        AND s.signature = $3 AND s.normalization_version = $4
      ORDER BY s.edition_lcid`,
    [q.vertical, q.asOfCorpusVersionId, q.signature, q.normalizationVersion]
  );
  return (res.rows as { edition_lcid: string }[]).map((r) => r.edition_lcid);
}

export interface DedupeCandidate {
  readonly vertical: string;
  readonly signature: string;
  readonly normalizationVersion: number;
  /** Two or more, by construction. Ascending, so a queue item is stable across reads. */
  readonly editionLcids: readonly string[];
}

/**
 * The dedupe candidates for one signature: the same signature carried by more
 * than one edition, as of a corpus version.
 *
 * Returns `null` when there is no collision — nothing to review is not an empty
 * queue item, it is the absence of one.
 */
export async function findDedupeCandidate(db: Queryable, q: SignatureQuery): Promise<DedupeCandidate | null> {
  const editionLcids = await findEditionsBySignature(db, q);
  if (editionLcids.length < 2) return null;
  return {
    vertical: q.vertical,
    signature: q.signature,
    normalizationVersion: q.normalizationVersion,
    editionLcids,
  };
}

/**
 * Every dedupe candidate in a vertical as of a corpus version — the review
 * queue's feed (E04-B06 builds the queue itself; this is the query under it).
 *
 * `HAVING count(DISTINCT …) > 1` and not `count(*) > 1`, for the alias reason
 * above: an edition with two signature rows for the same string is one edition.
 */
export async function findAllDedupeCandidates(
  db: Queryable,
  vertical: string,
  asOfCorpusVersionId: string,
  limit = 100
): Promise<readonly DedupeCandidate[]> {
  const res = await db.query(
    `SELECT s.signature,
            s.normalization_version,
            array_agg(DISTINCT s.edition_lcid ORDER BY s.edition_lcid) AS edition_lcids
       FROM edition_signature s
       JOIN corpus_version c ON c.id = s.corpus_version_id
      WHERE s.vertical = $1 AND ${AT_OR_BEFORE_AS_OF}
      GROUP BY s.signature, s.normalization_version
     HAVING count(DISTINCT s.edition_lcid) > 1
      ORDER BY s.signature
      LIMIT $3`,
    [vertical, asOfCorpusVersionId, limit]
  );
  return (res.rows as { signature: string; normalization_version: number; edition_lcids: string[] }[]).map(
    (r) => ({
      vertical,
      signature: r.signature,
      normalizationVersion: r.normalization_version,
      editionLcids: r.edition_lcids,
    })
  );
}

/** Why a signature lookup declined to name an edition. */
export type SignatureLookup =
  | { readonly status: "matched"; readonly editionLcid: string }
  | { readonly status: "no_match" }
  /** A dedupe candidate. The caller does NOT pick; it declines and the queue does. */
  | { readonly status: "ambiguous"; readonly candidate: DedupeCandidate };

/**
 * The Q2/Q3 lookup (030 §3.1): one equality read on
 * `edition_signature (vertical, signature, normalization_version)`.
 *
 * TOTAL over three outcomes, and it never throws — the same shape and the same
 * reason as `resolve` (047 A3, A10). "A resolver that returns a value on the
 * happy path and something else on the rest is a resolver whose callers handle
 * the rest by accident", and here the rest is the case that matters most: the
 * ambiguous branch is where an automatic merge would otherwise be invented.
 */
export async function lookupBySignature(db: Queryable, q: SignatureQuery): Promise<SignatureLookup> {
  const candidate = await findEditionsBySignature(db, q);
  if (candidate.length === 0) return { status: "no_match" };
  if (candidate.length === 1) return { status: "matched", editionLcid: candidate[0]! };
  return {
    status: "ambiguous",
    candidate: {
      vertical: q.vertical,
      signature: q.signature,
      normalizationVersion: q.normalizationVersion,
      editionLcids: candidate,
    },
  };
}

export interface ExternalIdQuery {
  readonly provider: string;
  readonly externalId: string;
  readonly asOfCorpusVersionId: string;
}

/**
 * The crosswalk lookup: an external identifier to an edition, as of a corpus
 * version (030 §4).
 *
 * Total over the same three outcomes, and ambiguity is if anything MORE expected
 * here than on a signature: 030 §4 rule 1 says `(provider, external_id)` "is not
 * unique and is not a primary key. Providers reuse, recycle and mis-issue IDs".
 * Two editions claiming one UPC is a crosswalk conflict, which 014 §4.3 routes to
 * a human queue — so this function declines, exactly like the signature one, and
 * the `candidate` it returns carries no signature because the collision is on the
 * alias rather than on a normalised key — which is why its ambiguous branch
 * carries the bare LCID list and not a `DedupeCandidate`: the reviewable object
 * here is a conflicting EDGE, not a colliding signature, and pretending otherwise
 * would file it into the wrong queue.
 *
 * ⚠ SUPERSEDED EDGES ARE EXCLUDED. `edition_external_id` is append-only with
 * `supersedes_id` (041), so a corrected edge leaves its predecessor in place; a
 * lookup that read both would resolve to an edition the crosswalk has already
 * withdrawn.
 */
export type AliasLookup =
  | { readonly status: "matched"; readonly editionLcid: string }
  | { readonly status: "no_match" }
  | { readonly status: "ambiguous"; readonly editionLcids: readonly string[] };

export async function lookupByExternalId(db: Queryable, q: ExternalIdQuery): Promise<AliasLookup> {
  const res = await db.query(
    `SELECT DISTINCT x.edition_lcid
       FROM edition_external_id x
       JOIN corpus_version c ON c.id = x.corpus_version_id
      WHERE x.provider = $1 AND ${AT_OR_BEFORE_AS_OF} AND x.external_id = $3
        AND NOT EXISTS (SELECT 1 FROM edition_external_id later WHERE later.supersedes_id = x.id)
      ORDER BY x.edition_lcid`,
    [q.provider, q.asOfCorpusVersionId, q.externalId]
  );
  const lcids = (res.rows as { edition_lcid: string }[]).map((r) => r.edition_lcid);
  if (lcids.length === 0) return { status: "no_match" };
  if (lcids.length === 1) return { status: "matched", editionLcid: lcids[0]! };
  return { status: "ambiguous", editionLcids: lcids };
}
