// Seeding for the catalog integration suites (E04-D01).
//
// Every catalog write hangs off four NOT NULL foreign keys — a registered
// vertical, a pack version, a corpus version and (for the crosswalk) a rights row
// — and that is the schema enforcing 030 §5.2, 030 §2.2 and 019 T25 rather than
// ceremony this file works around.
import type pg from "pg";
import { mintLcidString, type LcidKind } from "../../src/catalog/index.js";

export const VERTICAL = "comic";
export const VERTICAL_CODE = "cmc";

export interface CatalogSeed {
  readonly packVersionId: string;
  /** Corpus versions in `built_at` order — `[0]` is the oldest. */
  readonly corpusVersionIds: readonly string[];
  readonly registrarSourceId: string;
  readonly communitySourceId: string;
}

/**
 * Register the comic pack, `count` corpus versions and two rights rows.
 *
 * ⚠ THE CORPUS VERSIONS TAKE THE DEFAULT `built_at`, WITH NO SPACING. An earlier
 * version of this helper inserted them `now() + i minutes` apart, and the
 * invariant review was right that the offset was a WORKAROUND HIDING A DEFECT:
 * the as-of predicates compared `built_at` alone, so any two corpus versions
 * sharing a timestamp — which is every pair an importer registers in one
 * transaction, because `now()` is transaction-start time — would each see the
 * other's facts. Spacing the fixtures apart meant the one suite that could have
 * caught it never did. The predicate now compares the tuple `(built_at, id)`
 * (`src/catalog/resolve.ts`), so this helper no longer needs to arrange anything,
 * and `lcid-lifecycle.test.ts` mints a tied pair on purpose.
 *
 * Each INSERT is its own transaction, so these usually differ in `built_at`
 * anyway — "usually" being exactly the property a test must not depend on, which
 * is why the ordering guarantee is the tuple and not the clock.
 */
export async function seedCatalog(db: pg.Pool, count = 3): Promise<CatalogSeed> {
  await db.query(`INSERT INTO vertical_pack (vertical, vertical_code) VALUES ($1,$2)`, [
    VERTICAL,
    VERTICAL_CODE,
  ]);
  const pack = await db.query(
    `INSERT INTO vertical_pack_version (vertical, pack_version, manifest, signature_fn_ref)
     VALUES ($1, 1, '{}', 'src/catalog/editionSignature.ts') RETURNING id`,
    [VERTICAL]
  );

  const corpusVersionIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const res = await db.query(`INSERT INTO corpus_version (notes) VALUES ($1) RETURNING id`, [
      `corpus ${i}`,
    ]);
    corpusVersionIds.push((res.rows[0] as { id: string }).id);
  }
  // Return them in the SAME total order the as-of predicate uses, rather than in
  // insertion order — those coincide today and the point of the tuple is that the
  // code must not care.
  const ordered = await db.query(`SELECT id FROM corpus_version WHERE id = ANY($1) ORDER BY built_at, id`, [
    corpusVersionIds,
  ]);

  const registrar = await db.query(
    `INSERT INTO data_source (name, namespace_class) VALUES ('upc','registrar') RETURNING id`
  );
  const community = await db.query(
    `INSERT INTO data_source (name, namespace_class, licence) VALUES ('gcd','community','CC BY-SA 4.0') RETURNING id`
  );

  return {
    packVersionId: (pack.rows[0] as { id: string }).id,
    corpusVersionIds: (ordered.rows as { id: string }[]).map((r) => r.id),
    registrarSourceId: (registrar.rows[0] as { id: string }).id,
    communitySourceId: (community.rows[0] as { id: string }).id,
  };
}

/** Mint one registry row directly. The INSERT *is* the mint (047 §4.1). */
export async function seedLcid(
  db: pg.Pool | pg.PoolClient,
  corpusVersionId: string,
  kind: LcidKind = "edition"
): Promise<string> {
  const lcid = mintLcidString(kind, VERTICAL_CODE);
  await db.query(
    `INSERT INTO lcid_registry (lcid, kind, vertical_code, minted_in_corpus_version_id, minted_by)
     VALUES ($1,$2,$3,$4,'human_review')`,
    [lcid, kind, VERTICAL_CODE, corpusVersionId]
  );
  return lcid;
}
