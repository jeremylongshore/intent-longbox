// 047 I6, I7, I8, I10, I12 and I18 — merges, splits, retirements, the survivor
// projection and `resolve`'s five outcomes.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import {
  merge,
  rebuildSurvivorProjection,
  resolve,
  resolveCurrent,
  retire,
  split,
} from "../../src/catalog/index.js";
import { createScanSession } from "../../src/services/scanSession.js";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { seedCatalog, seedLcid, type CatalogSeed } from "./catalogHelpers.js";

const dbUp = await probeDb();

const FOREST = JSON.parse(
  readFileSync(new URL("../fixtures/catalog/merge-forest.json", import.meta.url), "utf8")
) as {
  chains: { count: number; depth: number }[];
  stars: { count: number; losers: number }[];
  cascades: { count: number; generations: number; widthPerGeneration: number }[];
};

describe.skipIf(!dbUp)("the LCID lifecycle (047 §5–§7, §10)", () => {
  let pool: pg.Pool;
  let seed: CatalogSeed;
  let shopId: string;
  let sessionId: string;

  /** Corpus 0 is the oldest; corpus 2 is the newest, so `resolveCurrent` reads it. */
  const c = (n: number): string => seed.corpusVersionIds[n]!;

  const fact = (corpusIndex = 1) => ({
    corpusVersionId: c(corpusIndex),
    method: "human_review",
    evidence: { note: "test" },
    decidedBy: "tester",
  });

  beforeAll(async () => {
    const url = await createFreshDb("longbox_lcid_lifecycle_e04d01");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    seed = await seedCatalog(pool);
    shopId = await seedShop(pool);
    sessionId = (await createScanSession(pool, shopId)).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** Mint `n` LCIDs in the oldest corpus, so every as-of read can see them. */
  async function lcids(n: number): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) out.push(await seedLcid(pool, c(0)));
    return out;
  }

  // I6 — A MERGE REWRITES NOTHING. 047 §6.4: it does not UPDATE physical_item,
  // does not rewrite identity_resolution, does not touch human_confirmation and
  // does not delete the losing edition rows. Every one would be an edit to an
  // immutable row.
  describe("I6 — a merge rewrites nothing", () => {
    it("leaves every pre-merge row byte-identical", async () => {
      const [loser, survivor, definition] = await lcids(3);

      await pool.query(
        `INSERT INTO edition
           (edition_lcid, definition_lcid, vertical, vertical_pack_version_id, corpus_version_id,
            attributes, signature)
         VALUES ($1,$2,'comic',$3,$4,'{"series":"ASM"}','asm')`,
        [loser!, definition!, seed.packVersionId, c(0)]
      );
      // A real confirmation and a real resolution, because I6's whole claim is
      // that a merge does not touch either of them (047 §6.4).
      const confirmation = await pool.query(
        `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source)
         VALUES ($1,$2,'{}','one_tap') RETURNING id`,
        [sessionId, shopId]
      );
      await pool.query(
        `INSERT INTO identity_resolution
           (shop_id, human_confirmation_id, edition_lcid, corpus_version_id, method, resolved_by)
         VALUES ($1,$2,$3,$4,'barcode','tester')`,
        [shopId, (confirmation.rows[0] as { id: string }).id, loser!, c(0)]
      );

      const snapshot = async (): Promise<string> => {
        const rows = await pool.query(
          `SELECT to_jsonb(e) AS row FROM edition e WHERE edition_lcid = $1
           UNION ALL
           SELECT to_jsonb(r) FROM identity_resolution r WHERE edition_lcid = $1`,
          [loser!]
        );
        return JSON.stringify(rows.rows);
      };

      const before = await snapshot();
      await withTransaction(pool, (tx) =>
        merge(tx, { ...fact(), losingLcid: loser!, survivingLcid: survivor! })
      );
      expect(await snapshot()).toBe(before);
    });
  });

  // I7 — a merged-away LCID stays RESOLVABLE FOREVER, including through a further
  // merge that moves the survivor.
  describe("I7 — a merged-away LCID stays resolvable", () => {
    it("follows a chain to the current root", async () => {
      const [a, b, cc] = await lcids(3);
      await withTransaction(pool, (tx) => merge(tx, { ...fact(), losingLcid: a!, survivingLcid: b! }));
      await withTransaction(pool, (tx) => merge(tx, { ...fact(), losingLcid: b!, survivingLcid: cc! }));

      expect(await resolveCurrent(pool, a!)).toEqual({ status: "merged", survivor: cc! });
      expect(await resolveCurrent(pool, b!)).toEqual({ status: "merged", survivor: cc! });
      expect(await resolveCurrent(pool, cc!)).toEqual({ status: "current", lcid: cc! });

      // And the registry row is still there. A merge deletes nothing.
      const still = await pool.query(`SELECT count(*)::int AS n FROM lcid_registry WHERE lcid = $1`, [a!]);
      expect((still.rows[0] as { n: number }).n).toBe(1);
    });
  });

  // I8 — at most one disposition, and the merge graph is ACYCLIC. Per A10 the
  // bound RAISES at write time and NEVER at read time.
  describe("I8 — one disposition, no cycles, raising only at write time", () => {
    it("refuses a self-merge", async () => {
      const [a] = await lcids(1);
      await expect(
        withTransaction(pool, (tx) => merge(tx, { ...fact(), losingLcid: a!, survivingLcid: a! }))
      ).rejects.toThrow(/lcid_merge_not_self/);
    });

    it("refuses B->A after A->B", async () => {
      const [a, b] = await lcids(2);
      await withTransaction(pool, (tx) => merge(tx, { ...fact(), losingLcid: a!, survivingLcid: b! }));
      await expect(
        withTransaction(pool, (tx) => merge(tx, { ...fact(), losingLcid: b!, survivingLcid: a! }))
      ).rejects.toThrow(/would create a cycle/);
    });

    it("refuses C->A after A->B->C, and A->B->C still resolves to C", async () => {
      const [a, b, cc] = await lcids(3);
      await withTransaction(pool, (tx) => merge(tx, { ...fact(), losingLcid: a!, survivingLcid: b! }));
      await withTransaction(pool, (tx) => merge(tx, { ...fact(), losingLcid: b!, survivingLcid: cc! }));
      await expect(
        withTransaction(pool, (tx) => merge(tx, { ...fact(), losingLcid: cc!, survivingLcid: a! }))
      ).rejects.toThrow(/would create a cycle/);
      expect(await resolveCurrent(pool, a!)).toEqual({ status: "merged", survivor: cc! });
    });

    it("refuses a second merge of the same loser", async () => {
      const [a, b, cc] = await lcids(3);
      await withTransaction(pool, (tx) => merge(tx, { ...fact(), losingLcid: a!, survivingLcid: b! }));
      await expect(
        withTransaction(pool, (tx) => merge(tx, { ...fact(), losingLcid: a!, survivingLcid: cc! }))
      ).rejects.toThrow(/lcid_merge_one_disposition|duplicate key/i);
    });

    // The three-way guard. Each table's own UNIQUE stops a second disposition of
    // the SAME kind; the trigger is what stops a second of a DIFFERENT kind, which
    // no single-table constraint can see.
    it("refuses a retirement of an already-merged LCID, and the reverse", async () => {
      const [a, b] = await lcids(2);
      await withTransaction(pool, (tx) => merge(tx, { ...fact(), losingLcid: a!, survivingLcid: b! }));
      await expect(
        withTransaction(pool, (tx) => retire(tx, { ...fact(), lcid: a!, reason: "phantom" }))
      ).rejects.toThrow(/already merged away/);

      const [x, y, z] = await lcids(3);
      await withTransaction(pool, (tx) => retire(tx, { ...fact(), lcid: x!, reason: "phantom" }));
      await expect(
        withTransaction(pool, (tx) => merge(tx, { ...fact(), losingLcid: x!, survivingLcid: y! }))
      ).rejects.toThrow(/already retired/);
      await expect(
        withTransaction(pool, (tx) =>
          split(tx, { ...fact(), sourceLcid: x!, products: [{ lcid: y! }, { lcid: z! }] })
        )
      ).rejects.toThrow(/already retired/);
    });

    it("returns an outcome rather than throwing when a read meets a long chain", async () => {
      // A10's asymmetry, proved at the read side: the walk that RAISES at write
      // time must not raise at read time, because a catalog anomaly on a pricing
      // lookup would become a 500. Read here against a PAST corpus, which is the
      // path that walks rather than reading the projection.
      const chain = await lcids(6);
      for (let i = 0; i < chain.length - 1; i += 1) {
        await withTransaction(pool, (tx) =>
          merge(tx, { ...fact(0), losingLcid: chain[i]!, survivingLcid: chain[i + 1]! })
        );
      }
      const outcome = await resolve(pool, chain[0]!, c(0));
      expect(outcome).toEqual({ status: "merged", survivor: chain[chain.length - 1]! });
    });
  });

  // I10 — a split source resolves to AMBIGUOUS unless a continuation was earned.
  describe("I10 — ambiguity is the default; continuation must be earned", () => {
    it("resolves a split source to split_ambiguous", async () => {
      const [source, p1, p2] = await lcids(3);
      await withTransaction(pool, (tx) =>
        split(tx, { ...fact(), sourceLcid: source!, products: [{ lcid: p1! }, { lcid: p2! }] })
      );
      const outcome = await resolveCurrent(pool, source!);
      expect(outcome.status).toBe("split_ambiguous");
    });

    it("resolves forward when exactly one continuation was earned", async () => {
      const [source, p1, p2] = await lcids(3);
      await withTransaction(pool, (tx) =>
        split(tx, {
          ...fact(),
          sourceLcid: source!,
          products: [{ lcid: p1!, isContinuation: true }, { lcid: p2! }],
        })
      );
      expect(await resolveCurrent(pool, source!)).toEqual({ status: "merged", survivor: p1! });
    });

    it("refuses a second continuation on one split", async () => {
      const [source, p1, p2] = await lcids(3);
      await expect(
        withTransaction(pool, (tx) =>
          split(tx, {
            ...fact(),
            sourceLcid: source!,
            products: [
              { lcid: p1!, isContinuation: true },
              { lcid: p2!, isContinuation: true },
            ],
          })
        )
      ).rejects.toThrow(/lcid_split_outcome_one_continuation_idx|duplicate key/i);
    });

    it("refuses a one-product split, because that is not a split", async () => {
      const [source, p1] = await lcids(2);
      await expect(
        withTransaction(pool, (tx) =>
          split(tx, { ...fact(), sourceLcid: source!, products: [{ lcid: p1! }] })
        )
      ).rejects.toThrow(/is not a split/);
    });
  });

  // I12 (A3) — `resolve` is TOTAL over five outcomes, and deterministic given the
  // corpus version. "A sixth shape — a throw, an undefined, a bare null — fails."
  describe("I12 — resolve is total over five outcomes", () => {
    it("produces all five, each stable across runs", async () => {
      const [live, loser, survivor, retired, splitSource, p1, p2] = await lcids(7);
      await withTransaction(pool, (tx) =>
        merge(tx, { ...fact(), losingLcid: loser!, survivingLcid: survivor! })
      );
      await withTransaction(pool, (tx) => retire(tx, { ...fact(), lcid: retired!, reason: "phantom" }));
      await withTransaction(pool, (tx) =>
        split(tx, { ...fact(), sourceLcid: splitSource!, products: [{ lcid: p1! }, { lcid: p2! }] })
      );

      // NOT_YET_MINTED: minted in the NEWEST corpus, read as of the OLDEST.
      const future = await seedLcid(pool, c(2));

      const cases: [string, string, string][] = [
        ["current", live!, c(2)],
        ["merged", loser!, c(2)],
        ["retired", retired!, c(2)],
        ["split_ambiguous", splitSource!, c(2)],
        ["not_yet_minted", future, c(0)],
      ];

      const seen = new Set<string>();
      for (const [expected, lcid, asOf] of cases) {
        const runs = new Set<string>();
        for (let i = 0; i < 3; i += 1) runs.add(JSON.stringify(await resolve(pool, lcid, asOf)));
        expect(runs.size, `${expected} is not deterministic`).toBe(1);
        const outcome = await resolve(pool, lcid, asOf);
        expect(outcome.status, `${lcid} as of ${asOf}`).toBe(expected);
        seen.add(outcome.status);
      }
      expect([...seen].sort()).toEqual(["current", "merged", "not_yet_minted", "retired", "split_ambiguous"]);
    });

    it("treats an unknown string as not_yet_minted rather than throwing", async () => {
      // Never throws past its caller (A10). Returning "not found" would conflate a
      // name that did not exist YET with one that never existed — 030 A1's
      // two-meanings hazard arriving in a return value.
      expect(await resolveCurrent(pool, "lb.e.cmc.0000000000000000v")).toEqual({ status: "not_yet_minted" });
      expect(await resolveCurrent(pool, "not-an-lcid")).toEqual({ status: "not_yet_minted" });
      expect(await resolve(pool, "not-an-lcid", "00000000-0000-0000-0000-000000000000")).toEqual({
        status: "not_yet_minted",
      });
    });

    // ⚠ THE TIE. `corpus_version.built_at` defaults to `now()`, which in Postgres
    // is TRANSACTION-START time — so two corpus versions registered in ONE
    // transaction carry the same timestamp, which is the ordinary case for an
    // importer that registers two snapshots together. Under the original
    // `built_at <= …` predicate a read as of either one saw the other's facts,
    // and 047 §10.2's rule failed as a WRONG ANSWER rather than an error. The
    // helper used to space its fixtures a minute apart, which is precisely what
    // kept this suite from noticing. It now mints the tie deliberately.
    it("keeps two corpus versions built in ONE transaction distinct for an as-of read", async () => {
      const tied = await withTransaction(pool, async (tx) => {
        const a = await tx.query(`INSERT INTO corpus_version (notes) VALUES ('tied a') RETURNING id`);
        const b = await tx.query(`INSERT INTO corpus_version (notes) VALUES ('tied b') RETURNING id`);
        return [(a.rows[0] as { id: string }).id, (b.rows[0] as { id: string }).id];
      });

      // Reproduce the precondition rather than assume it: the two really do share
      // a timestamp, so this test is exercising the tie and not a near-miss.
      const stamps = await pool.query(`SELECT built_at FROM corpus_version WHERE id = ANY($1)`, [tied]);
      const distinct = new Set((stamps.rows as { built_at: Date }[]).map((r) => r.built_at.toISOString()));
      expect(distinct.size, "the fixture no longer produces a built_at tie").toBe(1);

      // Order them the way the predicate does — by the TUPLE — and mint one LCID
      // in the later of the two.
      const ordered = await pool.query(
        `SELECT id FROM corpus_version WHERE id = ANY($1) ORDER BY built_at, id`,
        [tied]
      );
      const [earlier, later] = (ordered.rows as { id: string }[]).map((r) => r.id) as [string, string];
      const mintedLater = await seedLcid(pool, later);

      // Exact, in both directions: invisible as of the earlier sibling, current as
      // of the later one. `built_at` alone cannot tell these apart.
      expect(await resolve(pool, mintedLater, earlier)).toEqual({ status: "not_yet_minted" });
      expect(await resolve(pool, mintedLater, later)).toEqual({ status: "current", lcid: mintedLater });

      // And the same for a MERGE decided against the later sibling.
      const [a, b] = await lcids(2);
      await withTransaction(pool, (tx) =>
        merge(tx, {
          corpusVersionId: later,
          method: "human_review",
          evidence: {},
          decidedBy: "tester",
          losingLcid: a!,
          survivingLcid: b!,
        })
      );
      expect(await resolve(pool, a!, earlier)).toEqual({ status: "current", lcid: a! });
      expect(await resolve(pool, a!, later)).toEqual({ status: "merged", survivor: b! });
    });

    it("does not show a merge decided in a later corpus to an earlier as-of read", async () => {
      // 047 §10.2: "a merge decided against corpus N is NOT VISIBLE from a read as
      // of corpus N−1". This is the whole reason the as-of is mandatory — an
      // eval replay must see the catalog as it then was.
      const [a, b] = await lcids(2);
      await withTransaction(pool, (tx) => merge(tx, { ...fact(2), losingLcid: a!, survivingLcid: b! }));
      expect(await resolve(pool, a!, c(0))).toEqual({ status: "current", lcid: a! });
      expect(await resolve(pool, a!, c(2))).toEqual({ status: "merged", survivor: b! });
    });
  });

  // I18 (A2) — the projection cannot disagree with the log, and the hot path stays
  // index-only.
  describe("I18 — the survivor projection is a derivation, not a status column", () => {
    it("equals a one-pass rebuild after a randomized merge sequence", async () => {
      // The forest's SHAPE is checked in (tests/fixtures/catalog/merge-forest.json);
      // its measurement is deliberately absent until a run on named hardware.
      const built: [string, string][] = [];

      for (const chain of FOREST.chains) {
        for (let n = 0; n < chain.count; n += 1) {
          const nodes = await lcids(chain.depth);
          for (let i = 0; i < nodes.length - 1; i += 1) built.push([nodes[i]!, nodes[i + 1]!]);
        }
      }
      for (const star of FOREST.stars) {
        for (let n = 0; n < star.count; n += 1) {
          const nodes = await lcids(star.losers + 1);
          const hub = nodes[0]!;
          for (const loser of nodes.slice(1)) built.push([loser, hub]);
        }
      }
      for (const cascade of FOREST.cascades) {
        for (let n = 0; n < cascade.count; n += 1) {
          let hub = (await lcids(1))[0]!;
          for (let g = 0; g < cascade.generations; g += 1) {
            const losers = await lcids(cascade.widthPerGeneration);
            for (const loser of losers) built.push([loser, hub]);
            const nextHub = (await lcids(1))[0]!;
            built.push([hub, nextHub]);
            hub = nextHub;
          }
        }
      }

      // RANDOMIZED ORDER. The incremental maintenance has to reach the same answer
      // whichever order the facts arrive in, and a fixed order would only ever
      // exercise the easy one.
      for (let i = built.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [built[i], built[j]] = [built[j]!, built[i]!];
      }

      for (const [loser, survivor] of built) {
        await withTransaction(pool, (tx) =>
          merge(tx, { ...fact(0), losingLcid: loser, survivingLcid: survivor })
        );
      }

      const read = async (): Promise<string> => {
        const res = await pool.query(`SELECT lcid, survivor_lcid FROM lcid_current_survivor ORDER BY lcid`);
        return JSON.stringify(res.rows);
      };

      const maintained = await read();
      expect(maintained).not.toBe("[]");

      await withTransaction(pool, (tx) => rebuildSurvivorProjection(tx));
      expect(await read()).toBe(maintained);
    });

    it("is unchanged by a merge transaction that rolls back", async () => {
      const before = await pool.query(`SELECT count(*)::int AS n FROM lcid_current_survivor`);
      const [a, b] = await lcids(2);
      await expect(
        withTransaction(pool, async (tx) => {
          await merge(tx, { ...fact(), losingLcid: a!, survivingLcid: b! });
          throw new Error("rolled back");
        })
      ).rejects.toThrow(/rolled back/);
      const after = await pool.query(`SELECT count(*)::int AS n FROM lcid_current_survivor`);
      expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);
      // And the log agrees: the merge fact is not there either.
      const facts = await pool.query(`SELECT count(*)::int AS n FROM lcid_merge WHERE losing_lcid = $1`, [
        a!,
      ]);
      expect((facts.rows[0] as { n: number }).n).toBe(0);
    });

    it("keeps the hot-path read INDEX-ONLY (A2 obligation 2)", async () => {
      // "A performance property nothing checks is a performance property that has
      // already regressed." A plan that degrades to a sequential scan or a
      // recursive CTE fails the build.
      await pool.query(`VACUUM ANALYZE lcid_current_survivor`);
      const explain = await pool.query(
        `EXPLAIN (FORMAT JSON) SELECT survivor_lcid FROM lcid_current_survivor WHERE lcid = 'lb.e.cmc.0000000000000000v'`
      );
      const plan = JSON.stringify((explain.rows[0] as { "QUERY PLAN": unknown })["QUERY PLAN"]);
      expect(plan).toContain("Index Only Scan");
      expect(plan).not.toContain("Seq Scan");
      expect(plan).not.toContain("Recursive");
    });

    it("carries a checked-in benchmark fixture that declares a shape and no unmeasured number", async () => {
      const raw = JSON.parse(
        readFileSync(new URL("../fixtures/catalog/merge-forest.json", import.meta.url), "utf8")
      ) as Record<string, unknown>;
      expect(Object.keys(raw)).toContain("measurements");
      // 018 §2 A3 / 030 A7: a threshold is set from the first MEASURED run on
      // named hardware, never guessed. Until then the block is empty except for
      // its own explanation, and this assertion is what stops someone filling it
      // in with a plausible number.
      const measurements = raw.measurements as Record<string, unknown>;
      expect(Object.keys(measurements).filter((k) => !k.startsWith("_"))).toEqual([]);
    });
  });
});
