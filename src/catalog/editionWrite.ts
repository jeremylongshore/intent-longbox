// Writing a definition and an edition — and the SIGNATURE, in a SERVICE and not
// in a TRIGGER (E04-B02).
//
// ⚠ THE ARGUMENT FOR A SERVICE, BECAUSE A TRIGGER IS THE OBVIOUS ALTERNATIVE AND
// IT IS THE WRONG ONE. Three reasons, in the order of how much they cost:
//
//  1. **A trigger needs a second copy of the normalisation, in PL/pgSQL.** The
//     rule is `normalizeField`/`normalizeIssue` in `editionSignature.ts` —
//     trim, collapse internal whitespace, casefold, strip a leading `#`, join on
//     `U+001F` — and `NORMALIZATION_VERSION` is the version OF THAT RULE. A
//     trigger that recomputes it in SQL makes the rule have two implementations
//     and one version number, so the first divergence produces rows stamped
//     version 1 that version 1 would not produce. Under append-only rules those
//     rows cannot be repaired; they can only be superseded by a corpus rebuild
//     nobody knows to run. This is the same defect `src/db/appendOnlyTables.ts`
//     exists to prevent for the trigger set, in the opposite direction.
//
//  2. **The signature function is per-pack and registered as DATA** (030 §5.2:
//     `vertical_pack_version.signature_fn_ref`). The registry that resolves a
//     vertical to a function lives in TypeScript and FAILS CLOSED on an
//     unregistered vertical (030 §6 rule 3). A trigger would either hard-code the
//     comic rule — which is the `if comic` branch 014 §3.4 forbids, in the
//     database where it is hardest to see — or reimplement pack resolution in
//     PL/pgSQL. Neither is a version of "the pack owns its signature".
//
//  3. **030 A4: an edition may have MORE THAN ONE valid signature.** A row-level
//     trigger computing one row per INSERT forecloses the alias case the table
//     exists for, and the aliases are exactly what A4 says are unrecoverable once
//     discarded.
//
//  What the DATABASE keeps is what a database is good at and code is not: the
//  append-only trigger that refuses UPDATE and DELETE, the foreign keys to
//  `lcid_registry`, the CHECKs, and the deliberate ABSENCE of a UNIQUE on
//  `edition_signature.signature` (047 A1/I17). The division is 003's
//  deterministic/probabilistic boundary applied to writes: the database enforces
//  what is true of every row, the service computes what a pack decides.
//
// ⚠ 030 I7 IS ASSERTED HERE, AT THE DATA LEVEL, AND `migrations/016` SAYS WHY IT
// IS NOT A CONSTRAINT: "The parent is a VERSIONED row set: there is no single
// `collectible_definition` row to FK, so the rule is a cross-row assertion
// Postgres cannot express as a constraint without a trigger that reads a corpus
// version the writer has not necessarily pinned." So the write path reads the
// definition — which it must do anyway, because `series` lives there and the
// signature needs it (`comicIdentity.ts`) — and refuses a mismatch before the
// INSERT rather than after.

import type { Tx } from "../db.js";
import { NORMALIZATION_VERSION } from "./editionSignature.js";
import {
  definitionSignature,
  editionSignature,
  parseIdentityAttributes,
  signatureInput,
} from "./packRegistry.js";
import { mint } from "./mint.js";

// ⚠ NOTHING HERE WRITES `supersedes_id`, AND THE ARCHITECTURE GATE IS WHY THE
// FIRST DRAFT OF THIS FILE DID. Rule 6 (041 §3.3) gives that column exactly one
// writer — `src/services/supersession.ts` — and the gate caught the second one
// before review did, which is the rule working exactly as designed. The right
// answer is not an exemption row: `supersede()` reads a predecessor, scope-checks
// it against a SHOP and a SESSION and assigns a `session_seq` under the anchor
// lock, and a catalog row has none of those three. So CATALOG SUPERSESSION IS AN
// UNMADE DECISION, not an omission here — a corrected definition or edition is a
// new row in a new corpus version, which is what a corpus advance already does
// (030 §7.1), and whether a catalog row ever needs a supersession CHAIN is
// E04-B11's (corpus ingest and its delta cursor) to decide with its own rule.
// This file writes NEW rows only.

/** Thrown when an edition's `vertical` disagrees with its definition's (030 I7). */
export class VerticalMismatchError extends Error {
  constructor(
    readonly definitionLcid: string,
    readonly definitionVerticals: readonly string[],
    readonly editionVertical: string
  ) {
    super(
      `030 I7: edition vertical ${JSON.stringify(editionVertical)} disagrees with its definition ` +
        `${definitionLcid}, which is [${definitionVerticals.join(", ")}]. An edition is a PRINTING OF ` +
        `A WORK; a printing in a different vertical is not a printing of that work, it is a broken ` +
        `parent pointer that every later read would follow silently.`
    );
    this.name = "VerticalMismatchError";
  }
}

/** Thrown when an edition names a definition LCID that no definition row describes. */
export class UnattachedDefinitionError extends Error {
  constructor(readonly definitionLcid: string) {
    super(
      `no collectible_definition row exists for ${definitionLcid}. The FK is to lcid_registry ` +
        `(047 I2), which proves the NAME was minted and says nothing about whether the WORK was ` +
        `ever described — and an edition whose parent has no attributes has no series, so it has ` +
        `no signature (030 §3.3, comicIdentity.comicSignatureInput). Write the definition first, ` +
        `in this transaction.`
    );
    this.name = "UnattachedDefinitionError";
  }
}

export interface DefinitionWrite {
  readonly vertical: string;
  readonly verticalCode: string;
  readonly packVersionId: string;
  readonly corpusVersionId: string;
  readonly attributes: Record<string, unknown>;
  readonly mintedBy?: "import" | "human_review";
  readonly authoredBy?: "human" | "system" | "provider";
  /** Omit to mint. Supplied only when a caller is adding a version of an existing work. */
  readonly definitionLcid?: string;
}

export interface EditionWrite {
  readonly vertical: string;
  readonly verticalCode: string;
  readonly packVersionId: string;
  readonly corpusVersionId: string;
  readonly definitionLcid: string;
  readonly attributes: Record<string, unknown>;
  readonly isCanonicalEdition?: boolean;
  readonly mintedBy?: "import" | "human_review";
  readonly authoredBy?: "human" | "system" | "provider";
  readonly editionLcid?: string;
  /**
   * ALIAS attribute payloads (030 A4). Each is a complete, valid attribute set
   * describing the SAME edition under another name — a series renamed mid-run, a
   * regional alternate — and each produces its own `edition_signature` row under
   * the same `edition_lcid`. The primary signature is the one computed from
   * `attributes`; these are additional, and the table has no UNIQUE precisely so
   * that they can coexist (047 A1/I17).
   */
  readonly aliasAttributes?: readonly Record<string, unknown>[];
}

export interface EditionWritten {
  readonly id: string;
  readonly editionLcid: string;
  /** Primary first, then the aliases in the order they were supplied. */
  readonly signatures: readonly string[];
  readonly normalizationVersion: number;
}

/**
 * Write one `collectible_definition` row, minting its LCID unless one is given.
 *
 * The mint and the citing row commit together, which is 047 I5's "a mint commits
 * with its citing edition row" — here for the definition level. A rolled-back
 * caller leaves no registry row, because the mint is an INSERT in the caller's
 * transaction and nothing else.
 */
export async function insertDefinition(
  tx: Tx,
  req: DefinitionWrite
): Promise<{ id: string; definitionLcid: string }> {
  const attributes = parseIdentityAttributes(req.vertical, "definition", req.attributes);
  const definitionLcid =
    req.definitionLcid ??
    (await mint(tx, {
      kind: "definition",
      verticalCode: req.verticalCode,
      mintedInCorpusVersionId: req.corpusVersionId,
      mintedBy: req.mintedBy ?? "import",
      ...(req.authoredBy !== undefined ? { authoredBy: req.authoredBy } : {}),
    }));

  const res = await tx.query(
    `INSERT INTO collectible_definition
       (definition_lcid, vertical, vertical_pack_version_id, corpus_version_id,
        attributes, signature, authored_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [
      definitionLcid,
      req.vertical,
      req.packVersionId,
      req.corpusVersionId,
      JSON.stringify(attributes),
      // The WORK's dedupe text, from the work's own field list (see
      // `comicDefinitionSignature`) — not the edition function called with
      // volume where issue goes. Resolved THROUGH THE PACK REGISTRY, so an
      // unregistered vertical is refused here exactly as `editionSignature`
      // refuses it, rather than being quietly comic-signed.
      definitionSignature(req.vertical, attributes),
      req.authoredBy ?? "system",
    ]
  );
  return { id: (res.rows[0] as { id: string }).id, definitionLcid };
}

/**
 * Write one `edition` row and its `edition_signature` row(s).
 *
 * Order, and every step is load-bearing:
 *   1. validate `attributes` against the pack's edition schema (030 §5.1);
 *   2. read the definition — I7's assertion AND the source of `series`;
 *   3. mint the edition LCID, unless one was supplied;
 *   4. INSERT the edition;
 *   5. INSERT one `edition_signature` row per signature, stamped with
 *      `NORMALIZATION_VERSION`.
 *
 * All in the caller's transaction. There is no dedupe check and no merge: two
 * editions with one signature are a CANDIDATE (see `dedupe.ts`), and the write
 * succeeds — 047 A1 makes the mint path "deliberately AP on an
 * `edition_signature` collision".
 */
export async function insertEdition(tx: Tx, req: EditionWrite): Promise<EditionWritten> {
  const attributes = parseIdentityAttributes(req.vertical, "edition", req.attributes);

  const definition = await readDefinition(tx, req.definitionLcid);
  if (definition.verticals.length === 0) throw new UnattachedDefinitionError(req.definitionLcid);
  if (definition.verticals.some((v) => v !== req.vertical)) {
    throw new VerticalMismatchError(req.definitionLcid, definition.verticals, req.vertical);
  }

  // BOTH halves go through the pack registry — the composer as well as the
  // signature function. Calling the comic composer directly would apply the comic
  // field list to any vertical whose signature function happens to exist, which is
  // the `if comic` branch 014 §3.4 forbids with the branch hidden inside a helper.
  const signatures = [
    editionSignature(req.vertical, signatureInput(req.vertical, definition.attributes, attributes)),
    ...(req.aliasAttributes ?? []).map((alias) =>
      editionSignature(
        req.vertical,
        signatureInput(
          req.vertical,
          definition.attributes,
          parseIdentityAttributes(req.vertical, "edition", alias)
        )
      )
    ),
  ];

  const editionLcid =
    req.editionLcid ??
    (await mint(tx, {
      kind: "edition",
      verticalCode: req.verticalCode,
      mintedInCorpusVersionId: req.corpusVersionId,
      mintedBy: req.mintedBy ?? "import",
      ...(req.authoredBy !== undefined ? { authoredBy: req.authoredBy } : {}),
    }));

  const res = await tx.query(
    `INSERT INTO edition
       (edition_lcid, definition_lcid, vertical, vertical_pack_version_id, corpus_version_id,
        attributes, signature, is_canonical_edition, authored_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      editionLcid,
      req.definitionLcid,
      req.vertical,
      req.packVersionId,
      req.corpusVersionId,
      JSON.stringify(attributes),
      // The column carries the PRIMARY signature; `edition_signature` carries all
      // of them. The column is not the key and nothing looks the edition up by it
      // — 030 §3.1's Q2/Q3 lookup is on the table's index — but a reader holding
      // one edition row should not need a join to see what it deduped as.
      signatures[0],
      req.isCanonicalEdition ?? false,
      req.authoredBy ?? "system",
    ]
  );

  for (const signature of signatures) {
    await tx.query(
      `INSERT INTO edition_signature
         (vertical, signature, normalization_version, edition_lcid, corpus_version_id, authored_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        req.vertical,
        signature,
        NORMALIZATION_VERSION,
        editionLcid,
        req.corpusVersionId,
        req.authoredBy ?? "system",
      ]
    );
  }

  return {
    id: (res.rows[0] as { id: string }).id,
    editionLcid,
    signatures,
    normalizationVersion: NORMALIZATION_VERSION,
  };
}

/**
 * Every vertical a definition has ever been written under, plus the attributes of
 * its newest row.
 *
 * ⚠ EVERY ROW, NOT THE NEWEST, FOR THE VERTICAL CHECK. A definition is a versioned
 * row set (`migrations/016`), so "its vertical" is only well defined if every row
 * agrees — and if they do not, the disagreement is the finding. Checking only the
 * newest would let an edition attach itself to a definition that USED to be a
 * comic, which is precisely the broken parent pointer I7 exists to refuse.
 *
 * The attributes come from the newest row by `created_at`, because that is the
 * current statement of what the work is and it is the one the signature must use.
 */
async function readDefinition(
  tx: Tx,
  definitionLcid: string
): Promise<{ verticals: string[]; attributes: Record<string, unknown> }> {
  const res = await tx.query(
    `SELECT vertical, attributes, created_at
       FROM collectible_definition
      WHERE definition_lcid = $1
      ORDER BY created_at DESC, id DESC`,
    [definitionLcid]
  );
  const rows = res.rows as { vertical: string; attributes: Record<string, unknown> }[];
  return {
    verticals: [...new Set(rows.map((r) => r.vertical))],
    attributes: rows[0]?.attributes ?? {},
  };
}
