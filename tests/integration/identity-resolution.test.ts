// `identity_resolution` as a FACT: appended per (confirmation, corpus version),
// as-stated, never edited (E04-B02; 047 §9.1, §9.2, I11, I12; 030 §7.1).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import { insertDefinition, insertEdition, merge } from "../../src/catalog/index.js";
import { createScanSession } from "../../src/services/scanSession.js";
import {
  COMIC_VERTICAL,
  readResolutions,
  resolveConfirmationIdentity,
} from "../../src/services/identityResolution.js";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { VERTICAL_CODE, seedCatalog, type CatalogSeed } from "./catalogHelpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("identity_resolution (047 §9)", () => {
  let pool: pg.Pool;
  let seed: CatalogSeed;
  let shopId: string;
  let sessionId: string;

  const c = (n: number): string => seed.corpusVersionIds[n]!;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_identity_resolution_e04b02");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    seed = await seedCatalog(pool);
    shopId = await seedShop(pool);
    sessionId = (await createScanSession(pool, shopId)).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** One edition of one work, written in `corpusIndex`. */
  async function edition(
    series: string,
    attributes: Record<string, unknown>,
    corpusIndex = 0
  ): Promise<string> {
    return withTransaction(pool, async (tx) => {
      const base = {
        vertical: COMIC_VERTICAL,
        verticalCode: VERTICAL_CODE,
        packVersionId: seed.packVersionId,
        corpusVersionId: c(corpusIndex),
      };
      const { definitionLcid } = await insertDefinition(tx, { ...base, attributes: { series } });
      const written = await insertEdition(tx, { ...base, definitionLcid, attributes });
      return written.editionLcid;
    });
  }

  async function confirmation(payload: Record<string, unknown>): Promise<string> {
    const res = await pool.query(
      `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source)
       VALUES ($1,$2,$3,'grid_pick') RETURNING id`,
      [sessionId, shopId, JSON.stringify(payload)]
    );
    return (res.rows[0] as { id: string }).id;
  }

  const claim = (payload: Record<string, unknown>, id: string, corpusIndex?: number) => ({
    shopId,
    humanConfirmationId: id,
    confirmedIssue: payload,
    vertical: COMIC_VERTICAL,
    resolvedBy: "integration-test",
    ...(corpusIndex === undefined ? {} : { corpusVersionId: c(corpusIndex) }),
  });

  it("appends a row naming the edition the signature matched", async () => {
    const payload = { title: "Saga", issue: "1", variant: "cover a" };
    const editionLcid = await edition("Saga", { issue: "1", variant: "cover a" });
    const id = await confirmation(payload);

    const out = await withTransaction(pool, (tx) => resolveConfirmationIdentity(tx, claim(payload, id, 0)));
    expect(out).toMatchObject({ status: "resolved", editionLcid, method: "signature" });

    const rows = await pool.query(
      `SELECT edition_lcid, method, confidence, shop_id FROM identity_resolution
        WHERE human_confirmation_id = $1`,
      [id]
    );
    expect(rows.rows).toHaveLength(1);
    // Deterministic rungs carry no confidence, and the column is never numeric
    // (047 I14, 019 T7, locked decision 5).
    expect(rows.rows[0]).toMatchObject({ edition_lcid: editionLcid, method: "signature", confidence: null });
    // The one shop-scoped table in the catalog cluster (030 §2.6).
    expect((rows.rows[0] as { shop_id: string }).shop_id).toBe(shopId);
  });

  // The other half of "a later corpus may answer differently": sometimes the
  // different answer is that there is no longer ONE answer. A corpus advance that
  // introduces a near-duplicate turns the signature into a dedupe candidate, and
  // the resolver declines instead of picking — while the first corpus's row,
  // which is still true as of ITS corpus, is left exactly as written.
  it("declines when a corpus advance made the signature a candidate, and edits nothing", async () => {
    const payload = { title: "Nausicaa", issue: "1" };
    const first = await edition("Nausicaa", { issue: "1" }, 0);
    const id = await confirmation(payload);
    await withTransaction(pool, (tx) => resolveConfirmationIdentity(tx, claim(payload, id, 0)));

    // A later corpus describes the same book as a different edition — the
    // ordinary consequence of a corpus advance, not a correction of the first
    // statement. BOTH are true as of their corpus.
    const second = await edition("Nausicaa", { issue: "1" }, 1);
    expect(second).not.toBe(first);
    const out = await withTransaction(pool, (tx) => resolveConfirmationIdentity(tx, claim(payload, id, 1)));
    // Corpus 1 sees BOTH editions, so the signature is now a dedupe candidate and
    // the resolver declines — which is itself the rule under test one layer up.
    expect(out).toEqual(expect.objectContaining({ status: "skipped", reason: "ambiguous" }));

    // The first row is untouched either way.
    const rows = await readResolutions(pool, shopId, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ editionLcid: first, corpusVersionId: c(0) });
  });

  it("appends a second row when the new corpus resolves the claim unambiguously", async () => {
    // The same shape as above with the collision removed: one edition in corpus
    // 0, a DIFFERENT one in corpus 2 whose series spelling only corpus 2 has.
    const early = { title: "Bone", issue: "1" };
    const editionOne = await edition("Bone", { issue: "1" }, 0);
    const id = await confirmation(early);
    await withTransaction(pool, (tx) => resolveConfirmationIdentity(tx, claim(early, id, 0)));

    const late = { title: "Bone Complete", issue: "1" };
    const editionTwo = await edition("Bone Complete", { issue: "1" }, 2);
    const out = await withTransaction(pool, (tx) => resolveConfirmationIdentity(tx, claim(late, id, 2)));
    expect(out).toMatchObject({ status: "resolved", editionLcid: editionTwo });

    const rows = await readResolutions(pool, shopId, id);
    expect(rows.map((r) => r.editionLcid).sort()).toEqual([editionOne, editionTwo].sort());
  });

  it("refuses a SECOND resolution in the SAME corpus version (030 §7.1's UNIQUE)", async () => {
    const payload = { title: "Akira", issue: "1" };
    await edition("Akira", { issue: "1" });
    const id = await confirmation(payload);
    await withTransaction(pool, (tx) => resolveConfirmationIdentity(tx, claim(payload, id, 0)));
    const again = await withTransaction(pool, (tx) => resolveConfirmationIdentity(tx, claim(payload, id, 0)));
    expect(again).toEqual({ status: "already_resolved", corpusVersionId: c(0) });
    expect(await readResolutions(pool, shopId, id)).toHaveLength(1);
  });

  it("is deterministic across runs given the same corpus version (047 §9.2, I12)", async () => {
    const payload = { title: "Blame", issue: "1" };
    const editionLcid = await edition("Blame", { issue: "1" });
    const answers = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const id = await confirmation(payload);
      const out = await withTransaction(pool, (tx) => resolveConfirmationIdentity(tx, claim(payload, id, 0)));
      answers.add(JSON.stringify([out.status, (out as { editionLcid?: string }).editionLcid]));
    }
    expect([...answers]).toEqual([JSON.stringify(["resolved", editionLcid])]);
  });

  // 047 §9.2 and I9. THE ROW IS NOT REWRITTEN, and nothing on the read path
  // resolves forward — answering with the survivor would silently restate what a
  // person confirmed.
  it("keeps the as-stated LCID after the edition is merged away", async () => {
    const payload = { title: "Berserk", issue: "1" };
    const loser = await edition("Berserk", { issue: "1" });
    const survivor = await edition("Berserk Deluxe", { issue: "1" });
    const id = await confirmation(payload);
    await withTransaction(pool, (tx) => resolveConfirmationIdentity(tx, claim(payload, id, 0)));

    await withTransaction(pool, (tx) =>
      merge(tx, {
        corpusVersionId: c(1),
        losingLcid: loser,
        survivingLcid: survivor,
        method: "human_review",
        evidence: { note: "test" },
        decidedBy: "tester",
      })
    );

    const rows = await readResolutions(pool, shopId, id);
    expect(rows[0]!.editionLcid).toBe(loser);
  });

  it("writes nothing when the catalog cannot name one edition", async () => {
    const payload = { title: "Never Imported", issue: "9999" };
    const id = await confirmation(payload);
    const out = await withTransaction(pool, (tx) => resolveConfirmationIdentity(tx, claim(payload, id, 0)));
    expect(out).toEqual({ status: "skipped", reason: "no_match" });
    expect(await readResolutions(pool, shopId, id)).toHaveLength(0);
  });

  it("refuses an UPDATE and a DELETE — the row is a fact (047 I11)", async () => {
    const payload = { title: "Lone Wolf", issue: "1" };
    await edition("Lone Wolf", { issue: "1" });
    const id = await confirmation(payload);
    await withTransaction(pool, (tx) => resolveConfirmationIdentity(tx, claim(payload, id, 0)));
    await expect(
      pool.query(`UPDATE identity_resolution SET method = 'human' WHERE human_confirmation_id = $1`, [id])
    ).rejects.toThrow();
    await expect(
      pool.query(`DELETE FROM identity_resolution WHERE human_confirmation_id = $1`, [id])
    ).rejects.toThrow();
  });
});
