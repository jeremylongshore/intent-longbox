// THE THREE LIFECYCLE FACTS AND THE CROSSWALK WRITES (047 §5–§8).
//
// Every function here APPENDS ONE ROW. None updates, none deletes, and none
// repoints a reference — 047 §6.4: a merge does not `UPDATE physical_item`, does
// not rewrite `identity_resolution`, does not touch `human_confirmation` and does
// not delete the losing edition rows. Every one of those would be an edit to an
// immutable row, refused by `forbid_mutation()` at `ENABLE ALWAYS`, and 030 §2.5
// chose the LCID-not-row-id rule precisely so that none of them is necessary.
//
// WHERE THE RULES ACTUALLY LIVE. The cycle refusal, the at-most-once disposition
// guard across all three tables, and the survivor projection's maintenance are
// TRIGGERS IN `migrations/017`, not checks in this file. That is deliberate: a
// guard in application code is a guard a second writer can be written without,
// and 041 §9.2's ranking puts the database first for exactly this reason. These
// functions are the ONE writing path today; the triggers are what makes them the
// one writing path forever.

import type { Tx } from "../db.js";

/**
 * The roles that may AUTHOR a crosswalk edge (047 A4, §8.4).
 *
 * ⚠ A CERTIFICATION WRITE IS A CATALOG-AUTHORING ACT, NEVER A SHOP-WORKFLOW ACT.
 * The crosswalk is a NON-TENANT-SCOPED table written during work that always has
 * a tenant in scope. If a shop-scoped session's identity can author an edge, one
 * tenant's operational choice mutates a table that deliberately carries no
 * `shop_id` — 047 §6.3(b)'s rejected merge rule arriving through a different
 * door. 019 T24 signs cross-tenant influence at zero and is non-waivable, but
 * T24's tenant-DATA detector CANNOT SEE THIS: no shop's data crosses to another
 * shop. What crosses is AUTHORITY.
 *
 * This list plus the `edition_external_id_catalog_authoring_role` CHECK in
 * `migrations/016` is the HONEST FLOOR available today — authn and the real role
 * model are E03's, and 047 §12.3 assigns E04-B06 the job of stating and building
 * the detector, with a failing fixture in which a shop-context request attempts
 * an edge and is refused. A text column with a CHECK refuses `'shop_operator'` at
 * the database NOW rather than waiting for a role system to exist.
 */
export const CATALOG_AUTHORING_ROLES = ["catalog_author", "catalog_reviewer", "catalog_importer"] as const;

export type CatalogAuthoringRole = (typeof CATALOG_AUTHORING_ROLES)[number];

export class NotACatalogAuthorError extends Error {
  constructor(role: string) {
    super(
      `role ${JSON.stringify(role)} may not author a crosswalk edge: a certification is a ` +
        `catalog-authoring act, never a shop-workflow act (047 A4 / §8.4). Permitted roles: ` +
        CATALOG_AUTHORING_ROLES.join(", ")
    );
    this.name = "NotACatalogAuthorError";
  }
}

function assertCatalogAuthor(role: string): asserts role is CatalogAuthoringRole {
  if (!(CATALOG_AUTHORING_ROLES as readonly string[]).includes(role)) throw new NotACatalogAuthorError(role);
}

/** The envelope every lifecycle fact carries (047 §5.3). */
export interface LifecycleFact {
  /** As of what catalog state — 041 §2.4's `definition_version` role, typed. */
  readonly corpusVersionId: string;
  /** How it was decided. */
  readonly method: string;
  /** What was relied on. */
  readonly evidence: unknown;
  /** WHO — 041 §2.3's `authored_by` role for a catalog fact. */
  readonly decidedBy: string;
}

/**
 * Append a merge fact (047 §6.1).
 *
 * The SURVIVOR IS NAMED IN THE FACT (§6.3(c)) — not derived from age (§6.3(a):
 * "a rule that needs no evidence and produces no reason", and systematically
 * backwards when a fortnightly import near-duplicates a row a human authored last
 * week) and not derived from reference count (§6.3(b): those are shop-scoped
 * `physical_item` rows, so that rule lets the shop with the most copies decide
 * the shared catalog's canonical names).
 *
 * The `lcid_merge_no_cycle` trigger REFUSES at write time if the survivor is
 * already reachable from the loser, or if the chain exceeds the bound (047 A10).
 * The `lcid_merge_maintains_survivor` trigger updates `lcid_current_survivor`
 * INSIDE THIS TRANSACTION, so the projection cannot disagree with the log for
 * longer than a transaction (047 A2, I18).
 */
export async function merge(
  tx: Tx,
  fact: LifecycleFact & { losingLcid: string; survivingLcid: string }
): Promise<string> {
  const res = await tx.query(
    `INSERT INTO lcid_merge
       (losing_lcid, surviving_lcid, corpus_version_id, method, evidence, decided_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [
      fact.losingLcid,
      fact.survivingLcid,
      fact.corpusVersionId,
      fact.method,
      JSON.stringify(fact.evidence ?? {}),
      fact.decidedBy,
    ]
  );
  return (res.rows[0] as { id: string }).id;
}

/**
 * Append a split fact and its outcomes (047 §7).
 *
 * AMBIGUITY IS THE DEFAULT AND CONTINUATION MUST BE EARNED (§7.2). The source is
 * disposed of; `resolve(source)` thereafter returns `SPLIT_AMBIGUOUS`, which is
 * not an error to be swallowed but a value callers must handle — the same shape
 * as locked decision 7's contradiction gate: ambiguity forces a human and no
 * guess is substituted.
 *
 * Marking one outcome `isContinuation` is a CLAIM WITH A BURDEN: the evidence
 * must support that every existing reference belongs to it. The clean case is
 * real — a later corpus discovers a variant that was never in the shop's stock,
 * so the second product has zero pre-split references by construction. The
 * partial unique index makes "at most one" a database fact; 047 I10's data-level
 * check (a continuation may not be marked while a row citing the source cannot be
 * resolved to it) needs `physical_item`, which is E02-B05's and does not exist.
 */
export async function split(
  tx: Tx,
  fact: LifecycleFact & {
    sourceLcid: string;
    products: readonly { lcid: string; isContinuation?: boolean }[];
  }
): Promise<string> {
  if (fact.products.length < 2) {
    throw new Error(
      `split of ${fact.sourceLcid}: a split asserts one name was always TWO things (047 §7.1); ` +
        `${fact.products.length} product(s) is not a split`
    );
  }
  const res = await tx.query(
    `INSERT INTO lcid_split (source_lcid, corpus_version_id, method, evidence, decided_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id`,
    [fact.sourceLcid, fact.corpusVersionId, fact.method, JSON.stringify(fact.evidence ?? {}), fact.decidedBy]
  );
  const splitId = (res.rows[0] as { id: string }).id;
  for (const product of fact.products) {
    await tx.query(
      `INSERT INTO lcid_split_outcome (split_id, product_lcid, is_continuation) VALUES ($1, $2, $3)`,
      [splitId, product.lcid, product.isContinuation === true]
    );
  }
  return splitId;
}

/**
 * Append a retirement fact (047 §5.4). THIS LCID NAMES NOTHING.
 *
 * Not a merge (there is no survivor) and not a deletion (the row stays, the
 * string stays resolvable, every reference stays readable). AND IT DOES NOT
 * REPAIR THE ROWS THAT CITE IT: they cite a name that names nothing, which is a
 * true statement about a past act, and 041 §3.6's "never edits, never hides"
 * forbids improving it. The citing rows enter E11-B08's review queue, derived by
 * query, with no column added to any citing table.
 */
export async function retire(
  tx: Tx,
  fact: LifecycleFact & { lcid: string; reason: string }
): Promise<string> {
  const res = await tx.query(
    `INSERT INTO lcid_retirement (lcid, corpus_version_id, reason, method, evidence, decided_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [
      fact.lcid,
      fact.corpusVersionId,
      fact.reason,
      fact.method,
      JSON.stringify(fact.evidence ?? {}),
      fact.decidedBy,
    ]
  );
  return (res.rows[0] as { id: string }).id;
}

/**
 * ⚠ NO SUPERSESSION POINTER, AND THE ABSENCE IS A DECISION (041 §3.3).
 *
 * `edition_external_id` CARRIES a supersession column — it is in 030 §4's
 * ratified column list, and adding it later would be a schema change on an
 * immutable table — but NOTHING IN THIS MODULE WRITES IT. 041 §3.3 gives
 * supersession exactly one writer, `src/services/supersession.ts`, and
 * `scripts/architectureRules.ts` enforces that as an exact inventory: "a
 * correction is not an INSERT with an extra column; it is a read of the
 * predecessor, a scope check, a `session_seq` assignment under the anchor lock
 * and an insert, in that order". A second writer is a second, unreviewed
 * definition of all four.
 *
 * Catalog cannot call that helper — `catalog-is-a-leaf` forbids importing
 * `src/services/` — and it must not grow a parallel one. So superseding a
 * crosswalk edge belongs to E04-B06, which owns "the crosswalk edge model, its
 * four states and the review queue" (047 §12.3) and is the bead that has to
 * decide whether a shop-neutral, session-less table supersedes through 041's
 * session-scoped helper or through a sibling of it. This module writes
 * PROPOSALS and CERTIFICATIONS; it does not retract.
 */
export interface AliasRequest {
  readonly editionLcid: string;
  /** The namespace. Never a cert namespace — the DB CHECK refuses those (I13). */
  readonly provider: string;
  readonly externalId: string;
  readonly vertical: string;
  readonly corpusVersionId: string;
  /** 019 T25, NON-WAIVABLE: nothing imports without a rights row. */
  readonly dataSourceId: string;
  readonly matchMethod: "exact" | "rule" | "similarity" | "human";
  /** NEVER numeric (022 P1, 019 T7). */
  readonly confidence?: string;
  readonly contradiction?: unknown;
  readonly providerSchemaVersion?: string;
  readonly sourceRecordHash?: string;
  readonly targetRecordHash?: string;
}

/**
 * Append an UNCERTIFIED crosswalk edge — a PROPOSAL (030 §4, 047 §8).
 *
 * "Exact identifiers win. Similarity/LLM may propose a mapping but cannot
 * silently certify it" (014 §4.3). An edge added here is exactly that proposal:
 * it carries no `decided_by`, no role and no `certified_at`, and E04-B06's review
 * queue is what turns one into a certification.
 */
export async function addAlias(tx: Tx, req: AliasRequest): Promise<string> {
  const res = await tx.query(
    `INSERT INTO edition_external_id
       (edition_lcid, provider, external_id, vertical, provider_schema_version, corpus_version_id,
        match_method, confidence, contradiction, data_source_id, source_record_hash,
        target_record_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
     RETURNING id`,
    [
      req.editionLcid,
      req.provider,
      req.externalId,
      req.vertical,
      req.providerSchemaVersion ?? null,
      req.corpusVersionId,
      req.matchMethod,
      req.confidence ?? null,
      req.contradiction === undefined ? null : JSON.stringify(req.contradiction),
      req.dataSourceId,
      req.sourceRecordHash ?? null,
      req.targetRecordHash ?? null,
    ]
  );
  return (res.rows[0] as { id: string }).id;
}

/**
 * Append a CERTIFIED crosswalk edge.
 *
 * Role-checked here AND at the database. The application check gives a readable
 * refusal at the call site; the CHECK constraint is what makes the rule true of
 * every writer, including one nobody has written yet. Neither is redundant: 041
 * §9.2's ranking is that the database is the guarantee and the application is the
 * ergonomics.
 *
 * A certification whose `dataSourceId` names a community-catalog or
 * commercial-provider namespace and whose role is `catalog_importer` is refused
 * by the `edition_external_id_certification_class` trigger (047 §8.2): only a
 * REGISTRAR-issued namespace may auto-certify, everything else proposes, and a
 * model never certifies.
 */
export async function certifyAlias(
  tx: Tx,
  req: AliasRequest & { decidedBy: string; decidedByRole: string; reviewer?: string }
): Promise<string> {
  assertCatalogAuthor(req.decidedByRole);
  const res = await tx.query(
    `INSERT INTO edition_external_id
       (edition_lcid, provider, external_id, vertical, provider_schema_version, corpus_version_id,
        match_method, confidence, contradiction, data_source_id, source_record_hash,
        target_record_hash, reviewer, certified, certified_at,
        decided_by, decided_by_role, authored_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,true,now(),$14,$15,'human')
     RETURNING id`,
    [
      req.editionLcid,
      req.provider,
      req.externalId,
      req.vertical,
      req.providerSchemaVersion ?? null,
      req.corpusVersionId,
      req.matchMethod,
      req.confidence ?? null,
      req.contradiction === undefined ? null : JSON.stringify(req.contradiction),
      req.dataSourceId,
      req.sourceRecordHash ?? null,
      req.targetRecordHash ?? null,
      req.reviewer ?? req.decidedBy,
      req.decidedBy,
      req.decidedByRole,
    ]
  );
  return (res.rows[0] as { id: string }).id;
}
