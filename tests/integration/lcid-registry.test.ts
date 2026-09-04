// 047 I1, I2, I3, I5 and I17 — the registry's own invariants.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import { mint, mintLcidString } from "../../src/catalog/index.js";
import { createFreshDb, probeDb, runMigrations } from "./helpers.js";
import { VERTICAL_CODE, seedCatalog, seedLcid, type CatalogSeed } from "./catalogHelpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("lcid_registry (047 §4)", () => {
  let pool: pg.Pool;
  let seed: CatalogSeed;
  let corpus: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_lcid_registry_e04d01");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    seed = await seedCatalog(pool);
    corpus = seed.corpusVersionIds[0]!;
  });

  afterAll(async () => {
    await pool?.end();
  });

  // I1 — the one invariant in 047 with NO acceptable exception. A reused LCID
  // makes every historical reference silently mean something new, and under
  // append-only rules there is no repair: the referencing rows cannot be updated
  // and nothing records that the meaning moved.
  describe("I1 — an LCID is never reused and never removed", () => {
    it("refuses a second INSERT of an existing lcid", async () => {
      const lcid = await seedLcid(pool, corpus);
      await expect(
        pool.query(
          `INSERT INTO lcid_registry (lcid, kind, vertical_code, minted_in_corpus_version_id, minted_by)
           VALUES ($1,'edition',$2,$3,'import')`,
          [lcid, VERTICAL_CODE, corpus]
        )
      ).rejects.toThrow(/duplicate key|unique/i);
    });

    it("refuses UPDATE and DELETE, so a mistaken mint is permanent", async () => {
      const lcid = await seedLcid(pool, corpus);
      await expect(
        pool.query(`UPDATE lcid_registry SET minted_by = 'import' WHERE lcid = $1`, [lcid])
      ).rejects.toThrow(/append-only/);
      await expect(pool.query(`DELETE FROM lcid_registry WHERE lcid = $1`, [lcid])).rejects.toThrow(
        /append-only/
      );
      // 047 §4.3's stated cost: the registry only grows. §5.4's retirement fact is
      // what makes that survivable — the mistake becomes READABLE, not absent.
      const still = await pool.query(`SELECT count(*)::int AS n FROM lcid_registry WHERE lcid = $1`, [lcid]);
      expect((still.rows[0] as { n: number }).n).toBe(1);
    });

    it("carries no supersession column at all", async () => {
      // 047 §4.2: "a registry row has NO CONTENT — it asserts that a name has been
      // issued. There is nothing to correct." Every other immutable table in this
      // system supersedes; this one deliberately cannot.
      const cols = await pool.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'lcid_registry' AND column_name = 'supersedes_id'`
      );
      expect(cols.rows).toEqual([]);
    });
  });

  // I2 (030 I3, inherited) — every `*_lcid` column is a REAL foreign key. This is
  // the one thing 047 §12.4 says cannot be added retroactively, because doing so
  // would require touching immutable rows. It is why the registry landed now.
  describe("I2 — every *_lcid column foreign-keys lcid_registry(lcid)", () => {
    it("finds no *_lcid column anywhere without the FK", async () => {
      const columns = await pool.query(
        `SELECT c.table_name, c.column_name
           FROM information_schema.columns c
           JOIN information_schema.tables t
             ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
            AND c.column_name LIKE '%\\_lcid'`
      );
      expect(columns.rows.length).toBeGreaterThan(0);

      const fks = await pool.query(
        `SELECT tc.table_name, kcu.column_name, ccu.table_name AS referenced_table
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
      );
      const covered = new Set(
        (fks.rows as { table_name: string; column_name: string; referenced_table: string }[])
          .filter((r) => r.referenced_table === "lcid_registry")
          .map((r) => `${r.table_name}.${r.column_name}`)
      );

      const missing = (columns.rows as { table_name: string; column_name: string }[])
        .map((r) => `${r.table_name}.${r.column_name}`)
        .filter((key) => !covered.has(key));
      expect(missing).toEqual([]);
    });
  });

  // I3 — 047 §3.2's enforced redundancy. "A redundancy a constraint checks is not
  // duplication; a redundancy nothing checks is drift waiting."
  describe("I3 — the string agrees with the row", () => {
    it("refuses a row whose kind disagrees with the prefix", async () => {
      const lcid = mintLcidString("edition", VERTICAL_CODE); // `lb.e.…`
      await expect(
        pool.query(
          `INSERT INTO lcid_registry (lcid, kind, vertical_code, minted_in_corpus_version_id, minted_by)
           VALUES ($1,'definition',$2,$3,'import')`,
          [lcid, VERTICAL_CODE, corpus]
        )
      ).rejects.toThrow(/lcid_registry_string_agrees_with_row/);
    });

    it("refuses a row whose vertical disagrees with the prefix", async () => {
      await pool.query(`INSERT INTO vertical_pack (vertical, vertical_code) VALUES ('other','oth')`);
      const lcid = mintLcidString("edition", VERTICAL_CODE); // `lb.e.cmc.…`
      await expect(
        pool.query(
          `INSERT INTO lcid_registry (lcid, kind, vertical_code, minted_in_corpus_version_id, minted_by)
           VALUES ($1,'edition','oth',$2,'import')`,
          [lcid, corpus]
        )
      ).rejects.toThrow(/lcid_registry_string_agrees_with_row/);
    });

    it("refuses a string that is not the grammar at all", async () => {
      await expect(
        pool.query(
          `INSERT INTO lcid_registry (lcid, kind, vertical_code, minted_in_corpus_version_id, minted_by)
           VALUES ('ASM-300','edition',$1,$2,'import')`,
          [VERTICAL_CODE, corpus]
        )
      ).rejects.toThrow(/lcid_registry_grammar/);
    });

    it("refuses a vertical with no registered pack (030 §6 rule 3, fail closed)", async () => {
      const lcid = `lb.e.zzz.${mintLcidString("edition", VERTICAL_CODE).split(".")[3]}`;
      await expect(
        pool.query(
          `INSERT INTO lcid_registry (lcid, kind, vertical_code, minted_in_corpus_version_id, minted_by)
           VALUES ($1,'edition','zzz',$2,'import')`,
          [lcid, corpus]
        )
      ).rejects.toThrow(/foreign key|vertical_pack/i);
    });
  });

  // I5 — a mint is never speculative, and per A12's Q7 ruling the citing fact for
  // a BATCHED import is the import-batch fact itself: one per batch, mints atomic
  // WITH IT. So the test asserts batch-granular atomicity, which is the form an
  // importer can actually satisfy.
  describe("I5 — a mint is never speculative", () => {
    it("leaves no registry row when the batch that cites it rolls back", async () => {
      const before = await pool.query(`SELECT count(*)::int AS n FROM lcid_registry`);
      const minted: string[] = [];

      await expect(
        withTransaction(pool, async (tx) => {
          for (let i = 0; i < 5; i += 1) {
            minted.push(
              await mint(tx, {
                kind: "edition",
                verticalCode: VERTICAL_CODE,
                mintedInCorpusVersionId: corpus,
                mintedBy: "import",
              })
            );
          }
          throw new Error("batch failed after minting");
        })
      ).rejects.toThrow(/batch failed/);

      const after = await pool.query(`SELECT count(*)::int AS n FROM lcid_registry`);
      expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);

      const survivors = await pool.query(`SELECT lcid FROM lcid_registry WHERE lcid = ANY($1)`, [minted]);
      expect(survivors.rows).toEqual([]);
    });

    it("commits the mint and its citing edition row together", async () => {
      const lcid = await withTransaction(pool, async (tx) => {
        const definition = await mint(tx, {
          kind: "definition",
          verticalCode: VERTICAL_CODE,
          mintedInCorpusVersionId: corpus,
          mintedBy: "human_review",
        });
        const edition = await mint(tx, {
          kind: "edition",
          verticalCode: VERTICAL_CODE,
          mintedInCorpusVersionId: corpus,
          mintedBy: "human_review",
        });
        await tx.query(
          `INSERT INTO edition
             (edition_lcid, definition_lcid, vertical, vertical_pack_version_id, corpus_version_id,
              attributes, signature)
           VALUES ($1,$2,'comic',$3,$4,'{"series":"ASM","issue":"300"}','asm300')`,
          [edition, definition, seed.packVersionId, corpus]
        );
        return edition;
      });

      const row = await pool.query(`SELECT count(*)::int AS n FROM edition WHERE edition_lcid = $1`, [lcid]);
      expect((row.rows[0] as { n: number }).n).toBe(1);
    });

    it("takes no lock of its own — the registry has no shop anchor (047 A5)", async () => {
      // The mint is a PARTICIPANT in the caller's transaction, never the owner of
      // one, and `lcid_registry` carries no `shop_id`, so the INSERT adds no edge
      // to the lock graph. Proved by concurrency: two open transactions each mint
      // and neither blocks the other.
      const a = await pool.connect();
      const b = await pool.connect();
      try {
        await a.query("BEGIN");
        await b.query("BEGIN");
        await mint(a, {
          kind: "edition",
          verticalCode: VERTICAL_CODE,
          mintedInCorpusVersionId: corpus,
          mintedBy: "import",
        });
        // If the mint took any shared anchor, this would block until `a` commits
        // and the test would time out rather than fail.
        await mint(b, {
          kind: "edition",
          verticalCode: VERTICAL_CODE,
          mintedInCorpusVersionId: corpus,
          mintedBy: "import",
        });
        await a.query("COMMIT");
        await b.query("COMMIT");
      } finally {
        a.release();
        b.release();
      }
    });

    it("retries a payload collision without poisoning the caller's transaction", async () => {
      // 047 I17 first half: a unique violation on `lcid_registry(lcid)` is a
      // PAYLOAD collision and retries (§3.2). A degenerate random source produces
      // one deliberately.
      const fixed = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const first = await withTransaction(pool, (tx) =>
        mint(tx, {
          kind: "edition",
          verticalCode: VERTICAL_CODE,
          mintedInCorpusVersionId: corpus,
          mintedBy: "import",
          randomSource: () => fixed,
        })
      );

      // The same degenerate source now collides on every attempt and the circuit
      // breaker fires — but the transaction is still usable afterwards, which is
      // the property the SAVEPOINT buys.
      await expect(
        withTransaction(pool, async (tx) => {
          await mint(tx, {
            kind: "edition",
            verticalCode: VERTICAL_CODE,
            mintedInCorpusVersionId: corpus,
            mintedBy: "import",
            randomSource: () => fixed,
          });
        })
      ).rejects.toThrow(/consecutive primary-key collisions/);

      // And a real source succeeds inside a transaction that has already absorbed
      // a collision — the savepoint rolled back the failed INSERT, not the work.
      const second = await withTransaction(pool, async (tx) => {
        let collided = false;
        try {
          await mint(tx, {
            kind: "edition",
            verticalCode: VERTICAL_CODE,
            mintedInCorpusVersionId: corpus,
            mintedBy: "import",
            randomSource: () => fixed,
          });
        } catch {
          collided = true;
        }
        expect(collided).toBe(true);
        return mint(tx, {
          kind: "edition",
          verticalCode: VERTICAL_CODE,
          mintedInCorpusVersionId: corpus,
          mintedBy: "import",
        });
      });

      expect(second).not.toBe(first);
    });
  });

  // I17 (A1, REQUIRED) — the mint is AP on a signature collision, and the two
  // unique violations are DIFFERENT EVENTS.
  describe("I17 — the mint is AP on a signature collision", () => {
    it("has no UNIQUE index on edition_signature's signature column", async () => {
      // "Adding one is the regression this invariant exists to catch" (030 §3.3).
      // A UNIQUE here would convert a dedupe candidate into a write failure and
      // push the arbitration onto whichever writer lost the race.
      const indexes = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='edition_signature'`
      );
      const unique = (indexes.rows as { indexdef: string }[]).filter(
        (r) => /UNIQUE/i.test(r.indexdef) && /\bsignature\b/.test(r.indexdef)
      );
      expect(unique).toEqual([]);

      const constraints = await pool.query(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'edition_signature'::regclass AND contype IN ('u','p')`
      );
      const uniqueOnSignature = (constraints.rows as { def: string }[]).filter((r) =>
        /\bsignature\b/.test(r.def)
      );
      expect(uniqueOnSignature).toEqual([]);
    });

    it("lets two CONCURRENT mints of one signature both commit", async () => {
      const signature = "amazing spider-man300direct1";
      const a = await pool.connect();
      const b = await pool.connect();
      try {
        await a.query("BEGIN");
        await b.query("BEGIN");

        const lcidA = await mint(a, {
          kind: "edition",
          verticalCode: VERTICAL_CODE,
          mintedInCorpusVersionId: corpus,
          mintedBy: "import",
        });
        const lcidB = await mint(b, {
          kind: "edition",
          verticalCode: VERTICAL_CODE,
          mintedInCorpusVersionId: corpus,
          mintedBy: "human_review",
        });

        for (const [client, lcid] of [
          [a, lcidA],
          [b, lcidB],
        ] as const) {
          await client.query(
            `INSERT INTO edition_signature
               (vertical, signature, normalization_version, edition_lcid, corpus_version_id)
             VALUES ('comic',$1,1,$2,$3)`,
            [signature, lcid, corpus]
          );
        }

        // BOTH COMMIT. That is not a tolerated race: it is the ratified behaviour.
        await a.query("COMMIT");
        await b.query("COMMIT");

        const rows = await pool.query(
          `SELECT edition_lcid FROM edition_signature WHERE signature = $1 ORDER BY edition_lcid`,
          [signature]
        );
        expect(rows.rows).toHaveLength(2);
        // Reconciling them is a LATER, human-arbitrated `lcid_merge` fact — never
        // an automatic merge (030 §3.3, 047 §4.4).
        expect([lcidA, lcidB].sort()).toEqual(
          (rows.rows as { edition_lcid: string }[]).map((r) => r.edition_lcid)
        );
      } finally {
        a.release();
        b.release();
      }
    });
  });
});
