// The edition write path: the signature written by a SERVICE, 030 I7 asserted at
// the data level, and a dedupe CANDIDATE that never merges (E04-B02).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import {
  CopyFactInEditionError,
  NORMALIZATION_VERSION,
  UnattachedDefinitionError,
  VerticalMismatchError,
  comicEditionSignature,
  findAllDedupeCandidates,
  findDedupeCandidate,
  insertDefinition,
  insertEdition,
  lookupBySignature,
  mintLcidString,
} from "../../src/catalog/index.js";
import { createFreshDb, probeDb, runMigrations } from "./helpers.js";
import { VERTICAL, VERTICAL_CODE, seedCatalog, seedLcid, type CatalogSeed } from "./catalogHelpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("writing an edition and its signature (030 §3.3, §5.3; 047 §9.3)", () => {
  let pool: pg.Pool;
  let seed: CatalogSeed;

  const c = (n: number): string => seed.corpusVersionIds[n]!;

  const base = (corpusIndex = 0) => ({
    vertical: VERTICAL,
    verticalCode: VERTICAL_CODE,
    packVersionId: seed.packVersionId,
    corpusVersionId: c(corpusIndex),
  });

  /** A work, written in the oldest corpus so every as-of read can see it. */
  async function work(series: string, corpusIndex = 0): Promise<string> {
    return withTransaction(pool, async (tx) => {
      const { definitionLcid } = await insertDefinition(tx, {
        ...base(corpusIndex),
        attributes: { series },
      });
      return definitionLcid;
    });
  }

  beforeAll(async () => {
    const url = await createFreshDb("longbox_edition_write_e04b02");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    seed = await seedCatalog(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  describe("the signature is written by the service, not by a trigger", () => {
    it("writes one edition_signature row stamped with the normalisation version", async () => {
      const definitionLcid = await work("Amazing Spider-Man");
      const written = await withTransaction(pool, (tx) =>
        insertEdition(tx, {
          ...base(),
          definitionLcid,
          attributes: { issue: "#300", variant: "Direct", printing: "1" },
        })
      );

      // The service composed the signature ACROSS the two levels: `series` came
      // from the definition, the other three from the edition.
      expect(written.signatures[0]).toBe(
        comicEditionSignature({
          series: "Amazing Spider-Man",
          issue: "300",
          variant: "direct",
          printing: "1",
        })
      );

      const rows = await pool.query(
        `SELECT signature, normalization_version, vertical FROM edition_signature WHERE edition_lcid = $1`,
        [written.editionLcid]
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({
        signature: written.signatures[0],
        normalization_version: NORMALIZATION_VERSION,
        vertical: VERTICAL,
      });
    });

    it("mints the LCID and its citing edition row in ONE transaction (047 I5)", async () => {
      const definitionLcid = await work("Rollback Test");
      let minted = "";
      await expect(
        withTransaction(pool, async (tx) => {
          const written = await insertEdition(tx, {
            ...base(),
            definitionLcid,
            attributes: { issue: "1" },
          });
          minted = written.editionLcid;
          throw new Error("caller rolls back");
        })
      ).rejects.toThrow("caller rolls back");

      const registry = await pool.query(`SELECT 1 FROM lcid_registry WHERE lcid = $1`, [minted]);
      expect(registry.rows).toHaveLength(0);
    });

    it("writes an ALIAS signature row per alias payload (030 A4)", async () => {
      // A series renamed mid-run: one edition, two valid signatures. The table
      // exists for exactly this, and it has no UNIQUE (047 A1/I17) so both land.
      const definitionLcid = await work("Journey Into Mystery");
      const written = await withTransaction(pool, (tx) =>
        insertEdition(tx, {
          ...base(),
          definitionLcid,
          attributes: { issue: "83" },
          aliasAttributes: [{ issue: "83", variant: "thor reprint" }],
        })
      );
      expect(written.signatures).toHaveLength(2);
      const rows = await pool.query(
        `SELECT count(*)::int AS n FROM edition_signature WHERE edition_lcid = $1`,
        [written.editionLcid]
      );
      expect((rows.rows[0] as { n: number }).n).toBe(2);
    });

    it("refuses a copy fact before it reaches the database (047 §2.3, A6)", async () => {
      const definitionLcid = await work("Slab Test");
      await expect(
        withTransaction(pool, (tx) =>
          insertEdition(tx, {
            ...base(),
            definitionLcid,
            attributes: { issue: "1", grader: "CGC" },
          })
        )
      ).rejects.toThrow(CopyFactInEditionError);
    });
  });

  // 030 I7. `migrations/016`'s header records why this is not a DB constraint:
  // the parent is a VERSIONED row set, so there is no single row to FK and the
  // rule is a cross-row assertion Postgres cannot express without a trigger that
  // reads a corpus version the writer has not pinned.
  describe("030 I7 — an edition's vertical equals its definition's", () => {
    it("refuses an edition whose vertical disagrees with its definition's", async () => {
      // A SECOND REGISTERED PACK, so the mismatch is a real disagreement between
      // two verticals the schema accepts rather than a failed foreign key. The
      // definition is written with raw SQL because the service would refuse a
      // vertical with no registered signature function long before I7 could fire
      // — and I7 is not that rule, it is the PARENT rule.
      await pool.query(
        `INSERT INTO vertical_pack (vertical, vertical_code) VALUES ('sports-card','crd')
         ON CONFLICT DO NOTHING`
      );
      const packVersion = await pool.query(
        `INSERT INTO vertical_pack_version (vertical, pack_version, manifest, signature_fn_ref)
         VALUES ('sports-card', 1, '{}', 'none') RETURNING id`
      );
      const cardLcid = mintLcidString("definition", "crd");
      await pool.query(
        `INSERT INTO lcid_registry (lcid, kind, vertical_code, minted_in_corpus_version_id, minted_by)
         VALUES ($1,'definition','crd',$2,'import')`,
        [cardLcid, c(0)]
      );
      await pool.query(
        `INSERT INTO collectible_definition
           (definition_lcid, vertical, vertical_pack_version_id, corpus_version_id, attributes, signature)
         VALUES ($1,'sports-card',$2,$3,'{"series":"Topps"}','topps')`,
        [cardLcid, (packVersion.rows[0] as { id: string }).id, c(0)]
      );

      // A COMIC edition claiming a SPORTS-CARD work. Every later read would
      // follow the broken parent pointer silently, which is what I7 refuses.
      await expect(
        withTransaction(pool, (tx) =>
          insertEdition(tx, { ...base(), definitionLcid: cardLcid, attributes: { issue: "1" } })
        )
      ).rejects.toThrow(VerticalMismatchError);
    });

    it("refuses when the definition's own rows DISAGREE among themselves", async () => {
      // A definition is a versioned row set, so "its vertical" is only well
      // defined if every row agrees. Checking only the newest would let an
      // edition attach to a work that USED to be a comic.
      const definitionLcid = await work("Disagreeing Rows");
      const packVersion = await pool.query(
        `SELECT id FROM vertical_pack_version WHERE vertical = 'sports-card' LIMIT 1`
      );
      await pool.query(
        `INSERT INTO collectible_definition
           (definition_lcid, vertical, vertical_pack_version_id, corpus_version_id, attributes, signature)
         VALUES ($1,'sports-card',$2,$3,'{"series":"Disagreeing Rows"}','x')`,
        [definitionLcid, (packVersion.rows[0] as { id: string }).id, c(1)]
      );
      await expect(
        withTransaction(pool, (tx) =>
          insertEdition(tx, { ...base(), definitionLcid, attributes: { issue: "1" } })
        )
      ).rejects.toThrow(VerticalMismatchError);
    });

    it("refuses an edition whose definition LCID has no definition row", async () => {
      // The FK is to `lcid_registry` (047 I2), which proves the NAME was minted
      // and says nothing about whether the WORK was ever described. A minted
      // definition LCID with no `collectible_definition` row is the exact state
      // a half-finished import leaves behind — and it is reachable by MINTING
      // one, not by deleting a row: `collectible_definition` is append-only and
      // refuses the DELETE, which is the model working.
      const orphan = await seedLcid(pool, c(0), "definition");
      await expect(
        withTransaction(pool, (tx) =>
          insertEdition(tx, { ...base(), definitionLcid: orphan, attributes: { issue: "1" } })
        )
      ).rejects.toThrow(UnattachedDefinitionError);
    });
  });

  // 030 §3.3, verbatim: "Two rows with the same signature are a DEDUPE CANDIDATE
  // — a human-queue item — never an automatic merge."
  describe("two editions may share a signature, and that is a candidate", () => {
    it("lets both writes commit and surfaces them as ONE candidate", async () => {
      const definitionLcid = await work("Duplicate Series");
      const attributes = { issue: "1", variant: "cover a" };
      const first = await withTransaction(pool, (tx) =>
        insertEdition(tx, { ...base(), definitionLcid, attributes })
      );
      const second = await withTransaction(pool, (tx) =>
        insertEdition(tx, { ...base(), definitionLcid, attributes })
      );

      // Two LCIDs, both live. Nothing merged, nothing failed.
      expect(second.editionLcid).not.toBe(first.editionLcid);
      expect(second.signatures[0]).toBe(first.signatures[0]);

      const query = {
        vertical: VERTICAL,
        signature: first.signatures[0]!,
        normalizationVersion: NORMALIZATION_VERSION,
        asOfCorpusVersionId: c(0),
      };
      const candidate = await findDedupeCandidate(pool, query);
      expect(candidate?.editionLcids).toEqual([first.editionLcid, second.editionLcid].sort());

      // And the lookup DECLINES rather than picking a winner.
      await expect(lookupBySignature(pool, query)).resolves.toMatchObject({ status: "ambiguous" });
    });

    it("does not call an edition with two alias signatures a collision with itself", async () => {
      const definitionLcid = await work("Alias Not Collision");
      const written = await withTransaction(pool, (tx) =>
        insertEdition(tx, {
          ...base(),
          definitionLcid,
          attributes: { issue: "7" },
          // The SAME payload twice: two signature rows, one signature string,
          // one edition. `DISTINCT edition_lcid` is what keeps this a match.
          aliasAttributes: [{ issue: "7" }],
        })
      );
      await expect(
        lookupBySignature(pool, {
          vertical: VERTICAL,
          signature: written.signatures[0]!,
          normalizationVersion: NORMALIZATION_VERSION,
          asOfCorpusVersionId: c(0),
        })
      ).resolves.toEqual({ status: "matched", editionLcid: written.editionLcid });
    });

    it("is invisible to a read as of a corpus version that predates the second write", async () => {
      // Determinism given the corpus (047 §9.2): the collision came into being
      // in corpus 1, so a read as of corpus 0 must still see one edition.
      const definitionLcid = await work("As Of Candidate");
      const attributes = { issue: "2" };
      const first = await withTransaction(pool, (tx) =>
        insertEdition(tx, { ...base(0), definitionLcid, attributes })
      );
      await withTransaction(pool, (tx) => insertEdition(tx, { ...base(1), definitionLcid, attributes }));

      const query = {
        vertical: VERTICAL,
        signature: first.signatures[0]!,
        normalizationVersion: NORMALIZATION_VERSION,
        asOfCorpusVersionId: c(0),
      };
      await expect(lookupBySignature(pool, query)).resolves.toEqual({
        status: "matched",
        editionLcid: first.editionLcid,
      });
      await expect(lookupBySignature(pool, { ...query, asOfCorpusVersionId: c(2) })).resolves.toMatchObject({
        status: "ambiguous",
      });
    });

    it("lists every candidate in the vertical for the review queue's feed", async () => {
      const all = await findAllDedupeCandidates(pool, VERTICAL, c(2));
      expect(all.length).toBeGreaterThanOrEqual(2);
      for (const candidate of all) expect(candidate.editionLcids.length).toBeGreaterThanOrEqual(2);
    });

    it("still has NO unique index on the signature column (047 I17)", async () => {
      // The candidate above is only a legal state because the constraint is
      // absent. Asserted here as well as in `lcid-registry.test.ts`, because this
      // is the suite that would tempt someone to add one — a duplicate signature
      // looks like a bug from inside a dedupe test.
      //
      // `\bsignature\b` and not `%signature%`: the table's own name contains the
      // word, so a LIKE would match the `id` primary key's index definition and
      // fail on a constraint that is supposed to be there.
      const indexes = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'edition_signature'`
      );
      expect(
        (indexes.rows as { indexdef: string }[]).filter(
          (r) => /UNIQUE/i.test(r.indexdef) && /\bsignature\b/.test(r.indexdef)
        )
      ).toEqual([]);
    });
  });
});
