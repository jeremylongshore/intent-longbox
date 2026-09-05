// REGISTERING THE THREE PACKS IS DATA, NOT A MIGRATION (E04-B04).
//
// The acceptance line of 014 §8's E04-B04 row is "a sample comic and card pack
// register without core-code branching", and this file runs it against a real
// database through the SHIPPED SCRIPT rather than through a helper written for
// the test: `pnpm register-pack --vertical <name>` is what an operator runs, so it
// is what the evidence should exercise.
//
// ⚠ NO MIGRATION IS ADDED BY ANY OF THIS. `vertical_pack` and
// `vertical_pack_version` are shipped tables with text keys
// (`migrations/016_catalog_core.sql:82`); a pack is a ROW. The suite asserts the
// migration ledger is unchanged by the registrations, because "we did not add
// DDL" is the claim and a claim is not evidence.
//
// ⚠ REGISTERING A VERTICAL IS NOT LAUNCHING ONE. E19-B06 gates a second vertical
// on reuse, rights, accuracy, economics and demand evidence (030 §5.4). The card
// rows below live for the length of one temporary database.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import {
  MANIFESTS,
  SPORTS_CARD_VERTICAL,
  TCG_CARD_VERTICAL,
  canonicalManifest,
  comicManifest,
  insertDefinition,
  insertEdition,
  parseLcid,
  resolve,
  sportsCardManifest,
} from "../../src/catalog/index.js";
import { appUrl, createFreshDb, probeDb, runMigrations } from "./helpers.js";

const execFileAsync = promisify(execFile);
const dbUp = await probeDb();

describe.skipIf(!dbUp)("the three packs register as data and resolve through the core (E04-B04)", () => {
  let url: string;
  let pool: pg.Pool;
  let corpusVersionId: string;
  let ledgerBefore: string[];

  /** Run the shipped registration script exactly as an operator would. */
  async function registerPack(vertical: string, extra: string[] = []): Promise<string> {
    const { stdout } = await execFileAsync(
      "npx",
      ["tsx", "scripts/register-pack.ts", "--vertical", vertical, ...extra],
      { env: { ...process.env, MIGRATE_DATABASE_URL: url }, cwd: process.cwd() }
    );
    return stdout;
  }

  beforeAll(async () => {
    url = await createFreshDb("longbox_pack_registration_e04b04");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    const ledger = await pool.query<{ filename: string }>(
      `SELECT filename FROM schema_migrations ORDER BY filename`
    );
    ledgerBefore = ledger.rows.map((r) => r.filename);
    const corpus = await pool.query<{ id: string }>(
      `INSERT INTO corpus_version (notes) VALUES ('E04-B04') RETURNING id`
    );
    corpusVersionId = corpus.rows[0]!.id;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("registers the comic pack and both card packs", async () => {
    for (const vertical of MANIFESTS.keys()) {
      const out = await registerPack(vertical);
      expect(out).toMatch(/pack registered/);
    }

    const packs = await pool.query<{ vertical: string; vertical_code: string }>(
      `SELECT vertical, vertical_code FROM vertical_pack ORDER BY vertical`
    );
    expect(packs.rows).toEqual([
      { vertical: "comic", vertical_code: "cmc" },
      { vertical: SPORTS_CARD_VERTICAL, vertical_code: "spc" },
      { vertical: TCG_CARD_VERTICAL, vertical_code: "tcg" },
    ]);
  }, 180_000);

  it("stores the manifest verbatim, so the row is readable after the code moves on", async () => {
    // 030 §5.2: an old `edition` row is interpretable because "the schema that
    // governed it is still on disk, addressable, unchanged".
    const row = await pool.query<{ manifest: unknown; signature_fn_ref: string; pack_version: number }>(
      `SELECT manifest, signature_fn_ref, pack_version FROM vertical_pack_version WHERE vertical = 'comic'`
    );
    expect(row.rowCount).toBe(1);
    expect(canonicalManifest(row.rows[0]!.manifest)).toBe(canonicalManifest(comicManifest));
    expect(row.rows[0]!.signature_fn_ref).toBe(comicManifest.signatureFnRef);
    expect(row.rows[0]!.pack_version).toBe(comicManifest.packVersion);
  });

  it("adds no migration — a pack is a row, not DDL", async () => {
    const ledger = await pool.query<{ filename: string }>(
      `SELECT filename FROM schema_migrations ORDER BY filename`
    );
    expect(ledger.rows.map((r) => r.filename)).toEqual(ledgerBefore);
  });

  it("is idempotent: a second run writes nothing and says so", async () => {
    const before = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM vertical_pack_version`);
    const out = await registerPack("comic");
    expect(out).toMatch(/already registered/);
    const after = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM vertical_pack_version`);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  }, 120_000);

  it("writes nothing on --dry-run", async () => {
    const fresh = await createFreshDb("longbox_pack_registration_dryrun");
    await runMigrations(fresh);
    const probe = new pg.Pool({ connectionString: fresh });
    try {
      const { stdout } = await execFileAsync(
        "npx",
        ["tsx", "scripts/register-pack.ts", "--vertical", "comic", "--dry-run"],
        { env: { ...process.env, MIGRATE_DATABASE_URL: fresh }, cwd: process.cwd() }
      );
      expect(stdout).toMatch(/dry run/);
      const packs = await probe.query<{ n: string }>(`SELECT count(*) AS n FROM vertical_pack`);
      expect(packs.rows[0]!.n).toBe("0");
    } finally {
      await probe.end();
    }
  }, 180_000);

  it("REFUSES to seed as the application role, and writes nothing (E02-D06)", async () => {
    // The defect this closes: `resolveMigrateUrl` falls back to DATABASE_URL
    // outside production, and `pnpm grant-app-role` gives the app role INSERT on
    // every table — so without `assertSchemaOwnerOrThrow` this script would seed
    // the pack rows as the app role and print "pack registered", producing rows
    // indistinguishable from the owner's.
    const fresh = await createFreshDb("longbox_pack_registration_approle");
    await runMigrations(fresh);
    const probe = new pg.Pool({ connectionString: fresh });
    try {
      await expect(
        execFileAsync("npx", ["tsx", "scripts/register-pack.ts", "--vertical", "comic"], {
          env: { ...process.env, MIGRATE_DATABASE_URL: appUrl(fresh) },
          cwd: process.cwd(),
        })
      ).rejects.toThrow(/refusing to seed/);
      const packs = await probe.query<{ n: string }>(`SELECT count(*) AS n FROM vertical_pack`);
      expect(packs.rows[0]!.n).toBe("0");
    } finally {
      await probe.end();
    }
  }, 180_000);

  it("refuses a vertical no manifest ships for, rather than defaulting to comic", async () => {
    await expect(registerPack("coin")).rejects.toThrow(/no manifest ships/);
  }, 120_000);

  it("resolves a comic edition written against the registered pack version", async () => {
    // The registration is only real if the rest of the catalog can hang off it:
    // the pack version row is a NOT NULL FK on both catalog tables, and
    // `resolve(lcid, asOf)` is the read path 047 A3 made total.
    const packVersion = await pool.query<{ id: string }>(
      `SELECT id FROM vertical_pack_version WHERE vertical = 'comic'`
    );
    const packVersionId = packVersion.rows[0]!.id;

    const written = await withTransaction(pool, async (tx) => {
      const { definitionLcid } = await insertDefinition(tx, {
        vertical: comicManifest.vertical,
        verticalCode: comicManifest.verticalCode,
        packVersionId,
        corpusVersionId,
        attributes: { series: "Amazing Spider-Man", publisher: "Marvel", volume: "1", year: "1963" },
      });
      return insertEdition(tx, {
        vertical: comicManifest.vertical,
        verticalCode: comicManifest.verticalCode,
        packVersionId,
        corpusVersionId,
        definitionLcid,
        attributes: { issue: "300", variant: null, printing: "1", cover: "1" },
      });
    });

    expect(parseLcid(written.editionLcid).verticalCode).toBe("cmc");
    const outcome = await resolve(pool, written.editionLcid, corpusVersionId);
    expect(outcome.status).toBe("current");
  }, 120_000);

  it("resolves a card edition through the same path, with the card pack's own code", async () => {
    const packVersion = await pool.query<{ id: string }>(
      `SELECT id FROM vertical_pack_version WHERE vertical = $1`,
      [SPORTS_CARD_VERTICAL]
    );
    const packVersionId = packVersion.rows[0]!.id;

    const written = await withTransaction(pool, async (tx) => {
      const { definitionLcid } = await insertDefinition(tx, {
        vertical: sportsCardManifest.vertical,
        verticalCode: sportsCardManifest.verticalCode,
        packVersionId,
        corpusVersionId,
        attributes: {
          sport: "baseball",
          player: "Roger Clemens",
          set: "1986 Topps",
          year: "1986",
          manufacturer: "Topps",
        },
      });
      return insertEdition(tx, {
        vertical: sportsCardManifest.vertical,
        verticalCode: sportsCardManifest.verticalCode,
        packVersionId,
        corpusVersionId,
        definitionLcid,
        attributes: { number: "661", parallel: null, language: "en" },
      });
    });

    expect(parseLcid(written.editionLcid).verticalCode).toBe("spc");
    const outcome = await resolve(pool, written.editionLcid, corpusVersionId);
    expect(outcome.status).toBe("current");
  }, 120_000);

  it("refuses to re-register a vertical under a different code", async () => {
    // 047 §2: "the prefix may encode a fact if and only if that fact can never be
    // corrected". The code is inside every LCID already minted in this vertical,
    // so changing it is a retire-and-re-mint (049 §4), never an UPDATE — and the
    // script must refuse rather than quietly leave the old code in place.
    const fresh = await createFreshDb("longbox_pack_registration_codeclash");
    await runMigrations(fresh);
    const probe = new pg.Pool({ connectionString: fresh });
    try {
      await probe.query(`INSERT INTO vertical_pack (vertical, vertical_code) VALUES ('comic','cmx')`);
      await expect(
        execFileAsync("npx", ["tsx", "scripts/register-pack.ts", "--vertical", "comic"], {
          env: { ...process.env, MIGRATE_DATABASE_URL: fresh },
          cwd: process.cwd(),
        })
      ).rejects.toThrow(/retire-and-re-mint/);
      const after = await probe.query<{ vertical_code: string }>(
        `SELECT vertical_code FROM vertical_pack WHERE vertical = 'comic'`
      );
      expect(after.rows[0]!.vertical_code).toBe("cmx");
      const versions = await probe.query<{ n: string }>(`SELECT count(*) AS n FROM vertical_pack_version`);
      expect(versions.rows[0]!.n).toBe("0");
    } finally {
      await probe.end();
    }
  }, 180_000);
});
