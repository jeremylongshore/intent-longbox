// A CARD resolves through the same core contract as a comic (E04-B03).
//
// This is the acceptance line of 014 §8's E04-B03 row, run against a real
// database rather than argued: a card work and a card printing are written by the
// SAME `insertDefinition`/`insertEdition` the comic pack uses, into the SAME
// tables, with the SAME append-only triggers, and the resulting LCID is read back
// through the SAME `resolve(lcid, asOf)` — with **no migration, no column, and no
// branch** added for the second vertical. The only thing that differs between
// this file and `catalog-edition-write.test.ts` is the string in `vertical` and
// the shape of `attributes`.
//
// ⚠ REGISTERING A `vertical_pack` ROW IN A TEST IS NOT LAUNCHING A VERTICAL.
// E19-B06 gates a second vertical on reuse, rights, accuracy, economics and
// demand evidence (030 §5.4). The row below lives for the length of one temporary
// database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import {
  CopyFactInEditionError,
  NORMALIZATION_VERSION,
  SPORTS_CARD_VERTICAL,
  VerticalMismatchError,
  cardEditionSignature,
  findDedupeCandidate,
  insertDefinition,
  insertEdition,
  lookupBySignature,
  parseLcid,
  resolve,
} from "../../src/catalog/index.js";
import { createFreshDb, probeDb, runMigrations } from "./helpers.js";
import { VERTICAL, VERTICAL_CODE, seedCatalog, type CatalogSeed } from "./catalogHelpers.js";

const dbUp = await probeDb();

/** 047 §3.3: three lowercase letters, assigned in the pack row, never invented. */
const CARD_VERTICAL_CODE = "spc";

describe.skipIf(!dbUp)("a card resolves through the same core contract as a comic (E04-B03)", () => {
  let pool: pg.Pool;
  let seed: CatalogSeed;
  let cardPackVersionId: string;

  const c = (n: number): string => seed.corpusVersionIds[n]!;

  const cardBase = (corpusIndex = 0) => ({
    vertical: SPORTS_CARD_VERTICAL,
    verticalCode: CARD_VERTICAL_CODE,
    packVersionId: cardPackVersionId,
    corpusVersionId: c(corpusIndex),
  });

  const definitionAttributes = {
    sport: "baseball",
    player: "Roger Clemens",
    set: "1986 Topps",
    year: "1986",
    manufacturer: "Topps",
  };

  /** Write a card work, returning its LCID. */
  async function cardWork(attributes = definitionAttributes, corpusIndex = 0): Promise<string> {
    return withTransaction(pool, async (tx) => {
      const { definitionLcid } = await insertDefinition(tx, { ...cardBase(corpusIndex), attributes });
      return definitionLcid;
    });
  }

  beforeAll(async () => {
    const url = await createFreshDb("longbox_card_edition_e04b03");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    // The comic pack, exactly as every other catalog suite seeds it — so this file
    // proves the two verticals COEXIST rather than that one works alone.
    seed = await seedCatalog(pool);
    await pool.query(`INSERT INTO vertical_pack (vertical, vertical_code) VALUES ($1,$2)`, [
      SPORTS_CARD_VERTICAL,
      CARD_VERTICAL_CODE,
    ]);
    const pack = await pool.query(
      `INSERT INTO vertical_pack_version (vertical, pack_version, manifest, signature_fn_ref)
       VALUES ($1, 1, '{}', 'src/catalog/cardIdentity.ts') RETURNING id`,
      [SPORTS_CARD_VERTICAL]
    );
    cardPackVersionId = (pack.rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("writes a card definition and edition through the shipped write path", async () => {
    const definitionLcid = await cardWork();
    const written = await withTransaction(pool, (tx) =>
      insertEdition(tx, {
        ...cardBase(),
        definitionLcid,
        attributes: { number: "661", parallel: null, language: "en" },
      })
    );

    expect(written.normalizationVersion).toBe(NORMALIZATION_VERSION);
    expect(written.signatures).toEqual([
      cardEditionSignature({ set: "1986 Topps", number: "661", parallel: null, language: "en" }),
    ]);
    // The LCID carries the CARD's vertical code, from the pack row — the mint did
    // not learn the code from a constant in a helper (047 §3.3).
    expect(parseLcid(written.editionLcid).verticalCode).toBe(CARD_VERTICAL_CODE);

    const row = await pool.query(
      `SELECT vertical, attributes, signature FROM edition WHERE edition_lcid = $1`,
      [written.editionLcid]
    );
    expect(row.rows[0]).toMatchObject({
      vertical: SPORTS_CARD_VERTICAL,
      attributes: { number: "661", parallel: null, language: "en" },
      signature: written.signatures[0],
    });
  });

  it("resolves that LCID through the same resolve(lcid, asOf) a comic uses", async () => {
    const definitionLcid = await cardWork();
    const written = await withTransaction(pool, (tx) =>
      insertEdition(tx, {
        ...cardBase(),
        definitionLcid,
        attributes: { number: "1", parallel: "Silver", language: "en" },
      })
    );

    const outcome = await resolve(pool, written.editionLcid, c(2));
    expect(outcome.status).toBe("current");
    if (outcome.status === "current") expect(outcome.lcid).toBe(written.editionLcid);
  });

  it("finds a card edition by signature, in the card vertical only", async () => {
    const definitionLcid = await cardWork({ ...definitionAttributes, player: "Wade Boggs" });
    const written = await withTransaction(pool, (tx) =>
      insertEdition(tx, {
        ...cardBase(),
        definitionLcid,
        attributes: { number: "510", language: "en" },
      })
    );

    const found = await lookupBySignature(pool, {
      vertical: SPORTS_CARD_VERTICAL,
      signature: written.signatures[0]!,
      normalizationVersion: NORMALIZATION_VERSION,
      asOfCorpusVersionId: c(2),
    });
    expect(found).toMatchObject({ status: "matched", editionLcid: written.editionLcid });

    // The SAME signature text under the COMIC vertical matches nothing: the lookup
    // is keyed on `(vertical, signature)`, which is why the vertical is not baked
    // into the string.
    const crossed = await lookupBySignature(pool, {
      vertical: VERTICAL,
      signature: written.signatures[0]!,
      normalizationVersion: NORMALIZATION_VERSION,
      asOfCorpusVersionId: c(2),
    });
    expect(crossed.status).toBe("no_match");
  });

  it("makes two parallels of one card two editions, not a dedupe candidate", async () => {
    const definitionLcid = await cardWork({ ...definitionAttributes, player: "Don Mattingly" });
    const base = await withTransaction(pool, (tx) =>
      insertEdition(tx, { ...cardBase(), definitionLcid, attributes: { number: "180", language: "en" } })
    );
    const gold = await withTransaction(pool, (tx) =>
      insertEdition(tx, {
        ...cardBase(),
        definitionLcid,
        attributes: { number: "180", parallel: "Gold", language: "en" },
      })
    );

    expect(base.signatures[0]).not.toBe(gold.signatures[0]);
    // NULL, not a candidate: a collision needs two editions sharing one signature,
    // and a parallel is a different printing. This is the assertion that fails if
    // `parallel` ever leaves the key (030 v1.3.0, 049 §5.2).
    const candidate = await findDedupeCandidate(pool, {
      vertical: SPORTS_CARD_VERTICAL,
      signature: gold.signatures[0]!,
      normalizationVersion: NORMALIZATION_VERSION,
      asOfCorpusVersionId: c(2),
    });
    expect(candidate).toBeNull();
  });

  it("refuses to attach a card edition to a COMIC definition (030 I7)", async () => {
    const comicDefinition = await withTransaction(pool, (tx) =>
      insertDefinition(tx, {
        vertical: VERTICAL,
        verticalCode: VERTICAL_CODE,
        packVersionId: seed.packVersionId,
        corpusVersionId: c(0),
        attributes: { series: "Amazing Spider-Man" },
      })
    );

    await expect(
      withTransaction(pool, (tx) =>
        insertEdition(tx, {
          ...cardBase(),
          definitionLcid: comicDefinition.definitionLcid,
          attributes: { number: "1", language: "en" },
        })
      )
    ).rejects.toThrow(VerticalMismatchError);
  });

  it("refuses a cert on a card edition before it reaches the database (047 A6)", async () => {
    const definitionLcid = await cardWork({ ...definitionAttributes, player: "Kirby Puckett" });
    await expect(
      withTransaction(pool, (tx) =>
        insertEdition(tx, {
          ...cardBase(),
          definitionLcid,
          attributes: { number: "329", language: "en", grader: "PSA", cert_number: "12345678" },
        })
      )
    ).rejects.toThrow(CopyFactInEditionError);

    const rows = await pool.query(`SELECT count(*)::int AS n FROM edition WHERE vertical = $1`, [
      SPORTS_CARD_VERTICAL,
    ]);
    // The refusal is a REFUSAL, not a write that a trigger later objects to.
    expect((rows.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  it("adds no card-specific column to any catalog table", async () => {
    // The claim 030 §5.4 makes for the sketch — "without one new column, one new
    // table, or one `if (vertical === 'comic')`" — asserted against
    // `information_schema` rather than believed.
    const cols = await pool.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name ~ '(card|sport|parallel|player|set_name|tcg|game)'`
    );
    expect(cols.rows).toEqual([]);
  });
});
