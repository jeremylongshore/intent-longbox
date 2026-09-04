// THE MINT (047 §4). The `lcid_registry` INSERT *is* the mint.
//
// "An LCID comes into existence by inserting one row into `lcid_registry`, inside
// the transaction that writes the first catalog row citing it. The table is
// insert-only: no UPDATE, no DELETE, no supersession, no reuse, ever. Only
// `catalog` mints, through one helper. A mint is never speculative." (047 §4.1)
//
// A MINT IS NEVER SPECULATIVE, AND THIS SIGNATURE IS WHY (047 §4.4). `mint` takes
// a `Tx`, never a `Pool`. There is no overload that opens its own transaction, so
// a caller cannot mint outside the transaction that writes the citing row — the
// helper has no way to do it. Two ways to mint and only two, and `mintedBy`'s
// CHECK closes the set at the database:
//
//   * a CORPUS IMPORT asserting an edition exists (`import`), atomic with the
//     import-batch fact — per 047 A12's Q7 ruling the citing row for a batched
//     import is THE BATCH FACT ITSELF, one per batch, so a rolled-back batch
//     un-mints its own LCIDs and re-mints on retry, which is correct precisely
//     because nothing outside the batch could have referenced them yet;
//   * a HUMAN CATALOG AUTHOR asserting an edition the corpus does not have
//     (`human_review`), in the request transaction that writes the row.
//
// THERE IS NO THIRD WAY, and in particular A RESOLUTION PROPOSAL DOES NOT MINT
// (047 §5.2). A barcode parse, a vision candidate, a similarity hit and a
// crosswalk edge under review already have three places to live —
// `candidate_set.candidates`, `edition_external_id`, and E04-B06's review queue —
// and minting for a guess would put a machine's opinion into a never-reused
// namespace it could never be freed from.
//
// ⚠ WHAT THIS TRANSACTION LOCKS: NOTHING (047 A5). `lcid_registry` has no
// `shop_id` and therefore no shop anchor, so the INSERT takes no anchor lock and
// adds no edge to the lock graph. A mint occurring inside a request that DOES
// hold an anchor lock — the human-authoring path — takes that lock in the order
// the request already established and never acquires a second: the mint is a
// PARTICIPANT in the caller's transaction, never the owner of one.
//
// ⚠ THE TWO UNIQUE VIOLATIONS ARE DIFFERENT EVENTS (047 A1, I17).
//
//   * A violation on `lcid_registry(lcid)` is an 80-bit PAYLOAD COLLISION. It is
//     retried here with a fresh payload.
//   * A duplicate `edition_signature` NEVER RAISES ONE, because no constraint
//     exists to raise it. The mint path is deliberately AP on a signature
//     collision: two concurrent mints of one signature are TWO VALID LCIDs, and
//     the repair is a later human-arbitrated `lcid_merge` fact (030 §3.3: "a
//     dedupe candidate… never an automatic merge"). Do not add a UNIQUE to fix
//     this; `tests/integration/lcid-registry.test.ts` (I17) asserts the
//     constraint's ABSENCE — against both `pg_indexes` and `pg_constraint` —
//     and runs two concurrent mints of one signature that BOTH COMMIT, so
//     adding a UNIQUE fails a build rather than passing a review.
//
// ⚠ HOW THE PAYLOAD RETRY COEXISTS WITH `withTransaction`, WHICH IS A DECISION
// THIS FILE HAD TO MAKE. 047 A5 requires the retry to run "inside the same
// `withTransaction` helper and the same retry-classification codes", and 042 A6 /
// `src/db.ts` fix that classification at `40001` and `40P01` "and on nothing
// else". A `23505` is neither — and inside an open transaction it POISONS the
// transaction, so a bare retry loop would issue its second INSERT against an
// aborted transaction and get `25P02`. The reconciliation, and it invents no
// second retry mechanism:
//
//     a SAVEPOINT is taken per attempt. A 23505 rolls back to the savepoint and
//     retries with a fresh payload, inside the caller's transaction. A 40001 or
//     40P01 is NOT caught here — it propagates, so the CALLER's `withTransaction`
//     retries the whole transaction under 041 §4.5's existing rules.
//
// So there is exactly one serialization-failure policy in the codebase, and the
// payload collision is handled where it can be: locally, without discarding the
// caller's work. `MINT_ATTEMPTS` is a PROVISIONAL CIRCUIT-BREAKER FLOOR in 042
// A3's sense — explicitly non-evidentiary, not a measurement of anything, and
// never to be quoted as a collision rate.

import type { Tx } from "../db.js";
import { type LcidKind, mintLcidString } from "./lcid.js";

/** Attempts, not retries: 3 means one INSERT plus two fresh payloads. */
export const MINT_ATTEMPTS = 3;

/** Postgres `unique_violation`. The ONE code this helper absorbs. */
const UNIQUE_VIOLATION = "23505";

export interface MintRequest {
  /** 047 §2.1: closed at two, and widening it is a new decision record. */
  readonly kind: LcidKind;
  /** The three-character `vertical_pack.vertical_code` (047 §3.3). */
  readonly verticalCode: string;
  /** 047 §10.1: where this name entered the world. Never nullable. */
  readonly mintedInCorpusVersionId: string;
  /** 047 §4.4: the two legitimate causes, and no third. */
  readonly mintedBy: "import" | "human_review";
  /** 041 §2.3's envelope — who produced the row's content, distinct from the cause. */
  readonly authoredBy?: "human" | "system" | "provider";
  /** Injectable CSPRNG, so the collision-and-retry path is testable. */
  readonly randomSource?: (bytes: number) => Buffer;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: unknown } | null | undefined)?.code === UNIQUE_VIOLATION;
}

/**
 * Mint one LCID inside the caller's transaction and return its canonical string.
 *
 * The caller MUST write the citing catalog row — or the import-batch fact — in
 * this same transaction. Nothing in this helper can enforce that (a citing row
 * that does not exist yet cannot be foreign-keyed to), so it is asserted by
 * `tests/integration/lcid-registry.test.ts` (I5) instead: a rolled-back batch
 * leaves no registry row, and a mint commits with its citing edition row.
 */
export async function mint(tx: Tx, req: MintRequest): Promise<string> {
  const authoredBy = req.authoredBy ?? (req.mintedBy === "import" ? "system" : "human");

  let lastError: unknown;
  for (let attempt = 1; attempt <= MINT_ATTEMPTS; attempt += 1) {
    const lcid = mintLcidString(req.kind, req.verticalCode, req.randomSource);
    const savepoint = `lcid_mint_${attempt}`;
    await tx.query(`SAVEPOINT ${savepoint}`);
    try {
      await tx.query(
        `INSERT INTO lcid_registry
           (lcid, kind, vertical_code, minted_in_corpus_version_id, minted_by, authored_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [lcid, req.kind, req.verticalCode, req.mintedInCorpusVersionId, req.mintedBy, authoredBy]
      );
      await tx.query(`RELEASE SAVEPOINT ${savepoint}`);
      return lcid;
    } catch (err) {
      await tx.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await tx.query(`RELEASE SAVEPOINT ${savepoint}`);
      // Anything that is not a payload collision — a bad vertical code, a missing
      // corpus version, a serialization failure — belongs to the caller. In
      // particular 40001/40P01 propagate so `withTransaction` can retry the whole
      // transaction under 041 §4.5, rather than this helper inventing a second
      // policy for the same condition.
      if (!isUniqueViolation(err)) throw err;
      lastError = err;
    }
  }

  throw new Error(
    `lcid mint: ${MINT_ATTEMPTS} consecutive primary-key collisions on lcid_registry. ` +
      `This is a circuit breaker, not a measurement (042 A3): at 80 bits from a CSPRNG it ` +
      `almost certainly means the random source is degenerate, not that the namespace is full.`,
    { cause: lastError }
  );
}
