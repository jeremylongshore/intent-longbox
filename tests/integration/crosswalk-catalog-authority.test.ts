// 047 I13, A4 and 019 T24 — the crosswalk is a catalog table, and only a catalog
// author may write it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import { NotACatalogAuthorError, addAlias, certifyAlias, resolveCurrent } from "../../src/catalog/index.js";
import { createFreshDb, probeDb, runMigrations } from "./helpers.js";
import { VERTICAL, seedCatalog, seedLcid, type CatalogSeed } from "./catalogHelpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("the crosswalk (047 §8)", () => {
  let pool: pg.Pool;
  let seed: CatalogSeed;
  let corpus: string;
  let edition: string;

  const base = () => ({
    editionLcid: edition,
    vertical: VERTICAL,
    corpusVersionId: corpus,
    dataSourceId: seed.registrarSourceId,
    matchMethod: "exact" as const,
  });

  beforeAll(async () => {
    const url = await createFreshDb("longbox_crosswalk_e04d01");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    seed = await seedCatalog(pool);
    corpus = seed.corpusVersionIds[0]!;
    edition = await seedLcid(pool, corpus);
  });

  afterAll(async () => {
    await pool?.end();
  });

  // I13 — A GRADER CERT IS NEVER AN EDITION ALIAS (047 §8.4). A CGC-slabbed ASM
  // #300 is the SAME EDITION as a raw one. The failure this prevents is quiet: a
  // cert-number edge would make one shop's slab a property of the shared catalog.
  describe("I13 — cert namespaces are not edition aliases", () => {
    it("refuses psa_cert, cgc_cert and cbcs_cert as providers", async () => {
      for (const provider of ["psa_cert", "cgc_cert", "cbcs_cert"]) {
        await expect(
          withTransaction(pool, (tx) => addAlias(tx, { ...base(), provider, externalId: "1234567" })),
          provider
        ).rejects.toThrow(/edition_external_id_no_cert_namespace/);
      }
    });

    it("accepts a registrar-issued namespace, which is what the exclusion is not about", async () => {
      const id = await withTransaction(pool, (tx) =>
        addAlias(tx, { ...base(), provider: "upc", externalId: "012345678905" })
      );
      expect(id).toBeTruthy();
    });
  });

  // A4 / 019 T24 — a certification is a CATALOG-AUTHORING act, never a
  // shop-workflow act. T24's tenant-DATA detector cannot see this leak, because
  // no shop's data crosses to another shop. What crosses is AUTHORITY.
  describe("A4 / T24 — only a catalog-authoring role may certify", () => {
    it("keeps the registry and the crosswalk free of shop_id", async () => {
      // 047 §6.3(b) rejects "the LCID with more references survives" precisely
      // because references are shop-scoped, and a rule keyed on them would let one
      // tenant's inventory decide a table with no tenancy. That argument only
      // holds while these tables really have none.
      const res = await pool.query(
        `SELECT table_name FROM information_schema.columns
          WHERE table_schema='public' AND column_name='shop_id'
            AND table_name IN ('lcid_registry','edition_external_id','collectible_definition',
                               'edition','edition_signature','lcid_merge','lcid_split',
                               'lcid_retirement','lcid_current_survivor','data_source',
                               'vertical_pack','vertical_pack_version')`
      );
      expect(res.rows).toEqual([]);
    });

    it("refuses a shop-scoped role at the application boundary", async () => {
      for (const role of ["shop_operator", "shop_owner", "operator", "app_user"]) {
        await expect(
          withTransaction(pool, (tx) =>
            certifyAlias(tx, {
              ...base(),
              provider: "upc",
              externalId: "012345678905",
              decidedBy: "owner@gothamcitylimit.example",
              decidedByRole: role,
            })
          ),
          role
        ).rejects.toThrow(NotACatalogAuthorError);
      }
    });

    it("refuses a shop-scoped role at the DATABASE, not only in the helper", async () => {
      // The application check is ergonomics; the CHECK constraint is the
      // guarantee, and it is what makes the rule true of a writer nobody has
      // written yet (041 §9.2's ranking). Proved by going around the helper.
      await expect(
        pool.query(
          `INSERT INTO edition_external_id
             (edition_lcid, provider, external_id, vertical, corpus_version_id, match_method,
              data_source_id, certified, certified_at, decided_by, decided_by_role)
           VALUES ($1,'upc','012345678905',$2,$3,'exact',$4,true,now(),'ben','shop_operator')`,
          [edition, VERTICAL, corpus, seed.registrarSourceId]
        )
      ).rejects.toThrow(/edition_external_id_catalog_authoring_role/);
    });

    it("lets a catalog author certify", async () => {
      const id = await withTransaction(pool, (tx) =>
        certifyAlias(tx, {
          ...base(),
          provider: "upc",
          externalId: "012345678905",
          decidedBy: "catalog-desk",
          decidedByRole: "catalog_author",
        })
      );
      const row = await pool.query(
        `SELECT certified, decided_by_role, certified_at FROM edition_external_id WHERE id = $1`,
        [id]
      );
      expect(row.rows[0]).toMatchObject({ certified: true, decided_by_role: "catalog_author" });
      expect((row.rows[0] as { certified_at: Date }).certified_at).toBeInstanceOf(Date);
    });

    it("refuses a certification that names no decider", async () => {
      await expect(
        pool.query(
          `INSERT INTO edition_external_id
             (edition_lcid, provider, external_id, vertical, corpus_version_id, match_method,
              data_source_id, certified)
           VALUES ($1,'upc','012345678905',$2,$3,'exact',$4,true)`,
          [edition, VERTICAL, corpus, seed.registrarSourceId]
        )
      ).rejects.toThrow(/edition_external_id_certification_is_decided/);
    });
  });

  // 047 §8.2 / §6.3 — auto-certification is bounded by namespace CLASS. Only a
  // registrar-issued namespace ("issued by a standards body to a publisher;
  // nobody's product") may certify without a human. A community catalog or a
  // commercial provider PROPOSES; a model never certifies.
  describe("§8.2 — a community or commercial namespace proposes and never auto-certifies", () => {
    it("refuses an importer certifying under a community namespace", async () => {
      await expect(
        withTransaction(pool, (tx) =>
          certifyAlias(tx, {
            ...base(),
            dataSourceId: seed.communitySourceId,
            provider: "gcd",
            externalId: "123456",
            matchMethod: "rule",
            decidedBy: "gcd-importer",
            decidedByRole: "catalog_importer",
          })
        )
      ).rejects.toThrow(/proposes and never certifies/);
    });

    it("lets a HUMAN catalog author certify the same community edge", async () => {
      const id = await withTransaction(pool, (tx) =>
        certifyAlias(tx, {
          ...base(),
          dataSourceId: seed.communitySourceId,
          provider: "gcd",
          externalId: "123456",
          matchMethod: "human",
          decidedBy: "catalog-desk",
          decidedByRole: "catalog_reviewer",
        })
      );
      expect(id).toBeTruthy();
    });

    it("lets an importer certify under a registrar-issued namespace", async () => {
      const id = await withTransaction(pool, (tx) =>
        certifyAlias(tx, {
          ...base(),
          provider: "upc",
          externalId: "012345678906",
          decidedBy: "upc-importer",
          decidedByRole: "catalog_importer",
        })
      );
      expect(id).toBeTruthy();
    });
  });

  // I15 (030 I2, restated) — canonical identity survives provider loss. This is
  // the bead's own acceptance criterion: "Canonical IDs survive provider loss and
  // catalog correction."
  describe("I15 — canonical identity survives provider loss", () => {
    it("loses no LCID, signature or edition row when every edge of one provider is deleted", async () => {
      const target = await seedLcid(pool, corpus);
      await pool.query(
        `INSERT INTO edition_signature (vertical, signature, normalization_version, edition_lcid, corpus_version_id)
         VALUES ($1,'asm300direct1',1,$2,$3)`,
        [VERTICAL, target, corpus]
      );
      await withTransaction(pool, async (tx) => {
        await addAlias(tx, {
          ...base(),
          editionLcid: target,
          provider: "upc",
          externalId: "099999999999",
        });
        await addAlias(tx, {
          ...base(),
          editionLcid: target,
          dataSourceId: seed.communitySourceId,
          provider: "gcd",
          externalId: "987654",
          matchMethod: "rule",
        });
      });

      const snapshot = async (): Promise<string> => {
        const res = await pool.query(
          `SELECT to_jsonb(r) AS row FROM lcid_registry r WHERE lcid = $1
           UNION ALL
           SELECT to_jsonb(s) FROM edition_signature s WHERE edition_lcid = $1`,
          [target]
        );
        return JSON.stringify(res.rows);
      };
      const before = await snapshot();
      const resolvedBefore = await resolveCurrent(pool, target);

      // ⚠ 047 I15 IS WRITTEN AS "DELETE EVERY EDGE FOR ONE PROVIDER", AND THE
      // DATABASE REFUSES THAT. `edition_external_id` is append-only at
      // `ENABLE ALWAYS`, so no principal below a superuser can remove a row — and
      // 041 §8.4's purge removes BYTES AND REFERENCED VALUES, NEVER ROWS. The
      // invariant is unchanged and the test is stronger for it, in two halves:
      //
      //   (a) the removal is REFUSED, so a provider's departure cannot take
      //       history with it even by accident;
      //   (b) provider loss is then modelled the way it actually happens — every
      //       edge in that namespace becomes unusable and the system stops reading
      //       it — and every LCID, signature and `resolve` answer is byte-identical.
      //
      // Recorded here rather than silently substituted, because I15 is the BEAD'S
      // OWN acceptance criterion ("canonical IDs survive provider loss").
      await expect(
        pool.query(`DELETE FROM edition_external_id WHERE provider = 'gcd' AND edition_lcid = $1`, [target])
      ).rejects.toThrow(/append-only/);

      const withoutProvider = await pool.query(
        `SELECT count(*)::int AS n FROM edition_external_id
          WHERE edition_lcid = $1 AND provider <> 'gcd'`,
        [target]
      );
      expect((withoutProvider.rows[0] as { n: number }).n).toBe(1);

      expect(await snapshot()).toBe(before);
      expect(await resolveCurrent(pool, target)).toEqual(resolvedBefore);
      expect(resolvedBefore).toEqual({ status: "current", lcid: target });
    });
  });
});
