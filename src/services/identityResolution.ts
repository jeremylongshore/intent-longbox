// `identity_resolution` — WHAT THE CATALOG SAID THE PERSON PICKED (E04-B02).
//
// TWO FACTS, NEVER ONE (047 §9.1, 030 §7.1). `human_confirmation` records the
// edition the PERSON PICKED: a person's act, made against what was on a screen at
// a moment, immutable and complete on its own. This table records WHAT THE
// CATALOG SAID THAT WAS, as of a corpus version, by a named method — revisable by
// a later corpus making a different statement. Neither is derivable from the
// other, and the collapse of the two into a nullable `confirmed_edition_lcid` is
// what 030 A1 rejected and `migrations/004:43-48` records the reasoning for: the
// NULL would carry two meanings a reader cannot separate, and the row cannot be
// updated to repair it. 047 I11 asserts by static scan that no such column is
// ever added; this file is the reason nobody needs one.
//
// ⚠ THIS FILE IS `workflow`, NOT `catalog` (030 §2.6), AND THE PLACEMENT IS THE
// POINT. `identity_resolution` is the one shop-scoped table in the catalog
// cluster: it is a statement about one shop's `human_confirmation`, and 029 §2.3
// requires `catalog` to stay readable by a batch importer with no pipeline
// present. A catalog module that wrote a `shop_id` would have a tenant inside it.
// So the READS are catalog's — `lookupByExternalId`, `lookupBySignature`,
// `newestCorpusVersionId`, all through `src/catalog/index.ts`'s public surface —
// and the WRITE is here.
//
// ⚠ AS-STATED IS WHAT IS STORED; NOTHING HERE RESOLVES FORWARD (047 §9.2, I9).
// The row records the `edition_lcid` as stated at the moment of resolution. If
// that LCID is later merged away the row is NOT rewritten (§6.4) — a reader
// asking "what edition is this copy" calls `resolve`; a reader asking "what did
// the catalog say in March" reads this row. One stored fact, two reads. Calling
// `resolve` here and storing the survivor would silently restate what a person
// confirmed, which is the exact failure I9 names.
//
// ⚠ RE-RESOLUTION APPENDS. `UNIQUE (human_confirmation_id, corpus_version_id)`
// says a confirmation is resolved AT MOST ONCE PER CORPUS VERSION — not at most
// once. A later corpus may resolve the same confirmation differently, and BOTH
// STATEMENTS ARE TRUE AS OF THEIR CORPUS. The table is append-only at the trigger
// level, so there is no other shape available even if someone wanted one.
//
// ⚠ AMBIGUITY IS NOT RESOLVED, IT IS DECLINED. Two editions sharing a signature
// are a dedupe candidate — "a human-queue item … never an automatic merge" (030
// §3.3) — so this file writes NO ROW when the lookup is ambiguous. Picking the
// lowest LCID, or the newest, would manufacture a catalog statement nobody made
// and hide the collision behind a resolution that looks decided. The absence of a
// row carries no meaning by design (030 §7.1: "was this confirmation ever
// resolved, and how is answered by a join returning zero rows or one"), which is
// what makes declining safe.

import type { Queryable, Tx } from "../db.js";
import {
  COMIC_VERTICAL as CATALOG_COMIC_VERTICAL,
  NORMALIZATION_VERSION,
  editionSignature,
  isUsableClaim,
  lookupByExternalId,
  lookupBySignature,
  newestCorpusVersionId,
  signatureClaim,
} from "../catalog/index.js";

/**
 * The `method` values `migrations/017`'s CHECK allows. Two of them are reachable
 * from this file today:
 *
 *   `barcode`  — an external-id alias in a barcode namespace resolved it. The
 *                strongest rung, because a UPC is issued by GS1 to a publisher
 *                and 014 §4.3's "exact identifiers win" applies.
 *   `signature` — the normalised comic signature matched exactly one edition.
 *
 * `live`, `human` and `canonical_edition` are NOT written here and that is
 * deliberate rather than unfinished: `canonical_edition` is the definition-level
 * fallback 047 §2.2 describes (a match that "only knew the issue" resolving
 * through `is_canonical_edition`), which belongs with E06's candidate generation;
 * `human` is the review queue's (E04-B06); `live` is a provider call the confirm
 * path must not make inside its transaction (041 §4.1 forbids a side effect in a
 * transaction body).
 */
export type ResolutionMethod = "live" | "barcode" | "signature" | "human" | "canonical_edition";

/**
 * The vertical every v0 session is in.
 *
 * A CONSTANT AND NOT A LOOKUP, on purpose and with an expiry. v0 is comics only —
 * one registered pack, one signature function, and E19-B06 gates any second
 * vertical on reuse, rights, accuracy, economics and demand evidence (030 §5.4:
 * "architectural possibility is not market permission"). Inventing a per-session
 * vertical column now would be a column nothing chooses. When a second pack is
 * earned, this constant is the ONE place a caller names a vertical, so it becomes
 * a lookup in one edit — which is why it is a named export rather than a string
 * literal at the call site.
 */
// ⚠ AND SINCE E04-B03 IT IS THE CATALOG'S CONSTANT, NOT A SECOND LITERAL. The
// pack registry owns the discriminator value; a workflow copy of the string would
// be a second place to edit when one of them changed, and the two would agree
// until the day they did not.
export const COMIC_VERTICAL = CATALOG_COMIC_VERTICAL;

/** The barcode namespaces — issued by a registrar, owned by nobody (030 §4). */
const BARCODE_NAMESPACES = ["upc", "ean", "isbn"] as const;

export interface ResolutionRequest {
  readonly shopId: string;
  readonly humanConfirmationId: string;
  /** The confirmation's `confirmed_issue` payload, verbatim. */
  readonly confirmedIssue: unknown;
  readonly vertical: string;
  /** Who ran the resolution — a service name or an operator, never a secret. */
  readonly resolvedBy: string;
  /**
   * The corpus to resolve against. Omitted means "the newest", read through
   * `newestCorpusVersionId` so this file and `resolve` can never disagree about
   * which one that is.
   */
  readonly corpusVersionId?: string;
}

export type ResolutionOutcome =
  | {
      readonly status: "resolved";
      readonly id: string;
      readonly editionLcid: string;
      readonly method: ResolutionMethod;
      readonly corpusVersionId: string;
    }
  /** Already resolved in THIS corpus version. A later corpus may still resolve it. */
  | { readonly status: "already_resolved"; readonly corpusVersionId: string }
  | {
      readonly status: "skipped";
      readonly reason: "no_corpus" | "unusable_claim" | "no_match" | "ambiguous";
      readonly editionLcids?: readonly string[];
    };

/**
 * Resolve one confirmation against the catalog and append the fact.
 *
 * TOTAL and NEVER THROWS PAST ITS CALLER for a catalog condition, the same rule
 * `resolve` follows (047 A10) and for the same reason: the confirm path is a
 * person standing at a counter, and a catalog that cannot answer must not turn
 * their confirmation into a 500. An empty catalog, an unmatched book and a
 * dedupe candidate are all OUTCOMES. A real database failure still propagates.
 */
export async function resolveConfirmationIdentity(
  tx: Tx,
  req: ResolutionRequest
): Promise<ResolutionOutcome> {
  const corpusVersionId = req.corpusVersionId ?? (await newestCorpusVersionId(tx));
  if (corpusVersionId === null) {
    // No corpus has ever been built, so the catalog has said nothing about
    // anything. Not an error: the pipeline predates the catalog by design (030
    // §12 leaves whether pre-catalog confirmations are ever resolved to E06).
    return { status: "skipped", reason: "no_corpus" };
  }

  const found = await lookupClaim(tx, req.vertical, req.confirmedIssue, corpusVersionId);
  if (found.status !== "matched") return found;

  return append(tx, {
    shopId: req.shopId,
    humanConfirmationId: req.humanConfirmationId,
    editionLcid: found.editionLcid,
    corpusVersionId,
    method: found.method,
    resolvedBy: req.resolvedBy,
  });
}

type ClaimLookup =
  | { readonly status: "matched"; readonly editionLcid: string; readonly method: ResolutionMethod }
  | {
      readonly status: "skipped";
      readonly reason: "unusable_claim" | "no_match" | "ambiguous";
      readonly editionLcids?: readonly string[];
    };

/**
 * The rungs, strongest first, and the ladder STOPS at the first rung that speaks
 * — including when what it says is "ambiguous".
 *
 * A barcode that resolves to two editions must NOT fall through to a signature
 * match, because falling through would answer a question the strongest available
 * evidence just refused to answer, and the fallback answer would look like a
 * clean resolution in the row. 014 §4.3's "a contradiction always reduces or
 * blocks auto-confidence" is the same principle one layer down.
 */
async function lookupClaim(
  db: Queryable,
  vertical: string,
  claim: unknown,
  asOfCorpusVersionId: string
): Promise<ClaimLookup> {
  const c = (claim !== null && typeof claim === "object" ? claim : {}) as Record<string, unknown>;

  for (const provider of BARCODE_NAMESPACES) {
    const externalId = readBarcode(c, provider);
    if (externalId === null) continue;
    const alias = await lookupByExternalId(db, { provider, externalId, asOfCorpusVersionId });
    if (alias.status === "matched")
      return { status: "matched", editionLcid: alias.editionLcid, method: "barcode" };
    if (alias.status === "ambiguous") {
      return { status: "skipped", reason: "ambiguous", editionLcids: alias.editionLcids };
    }
  }

  // Through the registry, so an unregistered vertical is refused rather than
  // having the comic field list applied to it.
  const fields = signatureClaim(vertical, c);
  if (!isUsableClaim(vertical, fields)) {
    // There is no claim to look up — and WHICH FIELDS decide that is the PACK's
    // question, not this file's. It used to read `!fields.series && !fields.issue`
    // here: correct for comics, and silently fatal for anything else, because a
    // card claim carries neither key and would have been skipped as unusable on
    // every call while type-checking cleanly. That is the `if comic` 014 §3.4
    // forbids, wearing field names instead of a vertical literal.
    //
    // The comparison to `identityKey` still holds and still means nothing: it
    // answers the same-shaped question with `null`, and the symmetry is a
    // coincidence of the DATA being thin, not a shared rule (047 A8: these two
    // functions stay apart).
    return { status: "skipped", reason: "unusable_claim" };
  }

  const signature = editionSignature(vertical, fields);
  const match = await lookupBySignature(db, {
    vertical,
    signature,
    normalizationVersion: NORMALIZATION_VERSION,
    asOfCorpusVersionId,
  });
  if (match.status === "matched")
    return { status: "matched", editionLcid: match.editionLcid, method: "signature" };
  if (match.status === "ambiguous") {
    return { status: "skipped", reason: "ambiguous", editionLcids: match.candidate.editionLcids };
  }
  return { status: "skipped", reason: "no_match" };
}

/** A barcode string on the claim, under either the namespace's name or `barcode`. */
function readBarcode(claim: Record<string, unknown>, provider: string): string | null {
  const raw = claim[provider] ?? (provider === "upc" ? claim["barcode"] : undefined);
  if (typeof raw === "number") return String(raw);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

interface AppendRequest {
  readonly shopId: string;
  readonly humanConfirmationId: string;
  readonly editionLcid: string;
  readonly corpusVersionId: string;
  readonly method: ResolutionMethod;
  readonly resolvedBy: string;
}

/**
 * The append.
 *
 * `ON CONFLICT DO NOTHING` rather than a caught unique violation, for a reason
 * that matters inside a transaction: a raised 23505 poisons the transaction
 * (`25P02` on the next statement), so catching it would force a SAVEPOINT dance
 * around a condition that is not an error at all. A second resolution in the same
 * corpus version is the UNIQUE doing its job — 030 §7.1's "at most once per
 * corpus version" — and the honest answer is `already_resolved`.
 *
 * ⚠ `confidence` IS NOT WRITTEN, AND IT IS NOT AN OMISSION. Both rungs here are
 * DETERMINISTIC — an exact alias and an exact normalised key — and
 * `migrations/017` says the column is "NULL for deterministic rungs; NEVER
 * numeric-graded (022 P1, 019 T7, locked decision 5)". A confidence on an exact
 * match would be a number invented to look rigorous, which 021 bars from every
 * surface.
 */
async function append(tx: Tx, req: AppendRequest): Promise<ResolutionOutcome> {
  const res = await tx.query(
    `INSERT INTO identity_resolution
       (shop_id, human_confirmation_id, edition_lcid, corpus_version_id, method, resolved_by, authored_by)
     VALUES ($1,$2,$3,$4,$5,$6,'system')
     ON CONFLICT (human_confirmation_id, corpus_version_id) DO NOTHING
     RETURNING id`,
    [req.shopId, req.humanConfirmationId, req.editionLcid, req.corpusVersionId, req.method, req.resolvedBy]
  );
  const row = res.rows[0] as { id: string } | undefined;
  if (!row) return { status: "already_resolved", corpusVersionId: req.corpusVersionId };
  return {
    status: "resolved",
    id: row.id,
    editionLcid: req.editionLcid,
    method: req.method,
    corpusVersionId: req.corpusVersionId,
  };
}

/**
 * Every resolution of one confirmation, newest corpus first.
 *
 * A TRAIL READ, so it returns `as_stated` values and calls nothing that resolves
 * forward (047 I9). A caller wanting "and what is that edition NOW" calls
 * `resolveCurrent` itself, at a named call site, and can see that it did.
 */
export async function readResolutions(
  db: Queryable,
  shopId: string,
  humanConfirmationId: string
): Promise<readonly { id: string; editionLcid: string; method: string; corpusVersionId: string }[]> {
  const res = await db.query(
    `SELECT r.id, r.edition_lcid, r.method, r.corpus_version_id
       FROM identity_resolution r
       JOIN corpus_version c ON c.id = r.corpus_version_id
      WHERE r.shop_id = $1 AND r.human_confirmation_id = $2
      ORDER BY c.built_at DESC, c.id DESC`,
    [shopId, humanConfirmationId]
  );
  return (res.rows as { id: string; edition_lcid: string; method: string; corpus_version_id: string }[]).map(
    (r) => ({
      id: r.id,
      editionLcid: r.edition_lcid,
      method: r.method,
      corpusVersionId: r.corpus_version_id,
    })
  );
}
