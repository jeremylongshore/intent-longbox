// L4: the observed-listing-lifecycle fact, proved against real Postgres.
//
// What this asserts, and why each one matters:
//   * migration 005 applies clean AND re-applies by hand (expand-only, re-runnable);
//   * the append-only trigger refuses UPDATE and DELETE on the new table;
//   * `shopify_draft` itself STILL cannot be UPDATEd to 'published' — the old path
//     stays closed, which is the whole reason this table exists (040 §4.4);
//   * latest-per-draft picks the newest by observed_at, then by id on a tie;
//   * the FK to shopify_draft is enforced.
//
// Bead: longbox-e5b.2.12 (alias E02-D02). Docs: 040 §4.4, 019 T19, 003:157-166,
// 001:174-182.
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createScanSession } from "../../src/services/scanSession.js";
import {
  isAutoPublishIncident,
  latestListingStatus,
  recordListingStatusObservation,
} from "../../src/services/listingStatus.js";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("listing_status_observation (E02-D02)", () => {
  let pool: pg.Pool;
  let shopId: string;
  let draftId: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_listing_status_test");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    shopId = await seedShop(pool);
    const sessionId = (await createScanSession(pool, shopId)).id;
    const draft = await pool.query(
      `INSERT INTO shopify_draft (scan_session_id, shop_id, status) VALUES ($1,$2,'draft') RETURNING id`,
      [sessionId, shopId]
    );
    draftId = (draft.rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("005 re-applies by hand without error and without duplicating rows", async () => {
    const before = await pool.query(`SELECT count(*)::int AS n FROM listing_status_observation`);
    const sql = await readFile(
      new URL("../../migrations/005_listing_status_observation.sql", import.meta.url),
      "utf8"
    );
    await pool.query(sql);
    const after = await pool.query(`SELECT count(*)::int AS n FROM listing_status_observation`);
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);
  });

  it("indexes the latest-observation-per-draft read", async () => {
    const res = await pool.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'listing_status_observation'
          AND indexname = 'listing_status_observation_latest_idx'`
    );
    expect(res.rowCount).toBe(1);
    const def = (res.rows[0] as { indexdef: string }).indexdef;
    expect(def).toContain("shopify_draft_id");
    expect(def).toContain("observed_at DESC");
    expect(def).toContain("id DESC");
  });

  it("appends an observation and reads it back as the latest", async () => {
    const obs = await recordListingStatusObservation(pool, {
      shopId,
      shopifyDraftId: draftId,
      observedStatus: "draft",
      source: "watcher",
      observedAt: new Date("2026-09-04T10:00:00.000Z"),
      raw: { status: "DRAFT" },
    });
    expect(obs.publishedBy).toBeNull();
    expect(obs.raw).toEqual({ status: "DRAFT" });

    const latest = await latestListingStatus(pool, draftId);
    expect(latest?.id).toBe(obs.id);
    expect(latest?.observedStatus).toBe("draft");
  });

  it("returns null for a draft nothing has ever observed", async () => {
    const session = (await createScanSession(pool, shopId)).id;
    const other = await pool.query(
      `INSERT INTO shopify_draft (scan_session_id, shop_id, status) VALUES ($1,$2,'draft') RETURNING id`,
      [session, shopId]
    );
    const latest = await latestListingStatus(pool, (other.rows[0] as { id: string }).id);
    expect(latest).toBeNull();
  });

  it("picks the newest observation by observed_at, and by id on a tie", async () => {
    const newer = await recordListingStatusObservation(pool, {
      shopId,
      shopifyDraftId: draftId,
      observedStatus: "published",
      publishedBy: "staff@example-shop",
      source: "webhook",
      observedAt: new Date("2026-09-04T12:00:00.000Z"),
    });
    // An OLDER observation written LATER must not win — the derivation orders on
    // observed_at (what the channel said), not on insertion order.
    await recordListingStatusObservation(pool, {
      shopId,
      shopifyDraftId: draftId,
      observedStatus: "delisted",
      source: "watcher",
      observedAt: new Date("2026-09-04T11:00:00.000Z"),
    });
    expect((await latestListingStatus(pool, draftId))?.id).toBe(newer.id);

    // Two observations sharing an observed_at resolve deterministically on id DESC.
    const tie = new Date("2026-09-04T12:00:00.000Z");
    const ids: string[] = [];
    for (const source of ["watcher", "webhook"] as const) {
      const row = await recordListingStatusObservation(pool, {
        shopId,
        shopifyDraftId: draftId,
        observedStatus: "archived",
        source,
        observedAt: tie,
      });
      ids.push(row.id);
    }
    const expected = [...ids, newer.id].sort().reverse()[0];
    expect((await latestListingStatus(pool, draftId))?.id).toBe(expected);
  });

  it("finds an app-published row through the T19 predicate", async () => {
    const session = (await createScanSession(pool, shopId)).id;
    const draft = await pool.query(
      `INSERT INTO shopify_draft (scan_session_id, shop_id, status) VALUES ($1,$2,'draft') RETURNING id`,
      [session, shopId]
    );
    const incidentDraft = (draft.rows[0] as { id: string }).id;
    await recordListingStatusObservation(pool, {
      shopId,
      shopifyDraftId: incidentDraft,
      observedStatus: "published",
      publishedBy: "app",
      source: "webhook",
    });
    const latest = await latestListingStatus(pool, incidentDraft);
    expect(latest).not.toBeNull();
    expect(isAutoPublishIncident(latest!)).toBe(true);
  });

  it("rejects an observation against a draft that does not exist (FK)", async () => {
    await expect(
      recordListingStatusObservation(pool, {
        shopId,
        shopifyDraftId: randomUUID(),
        observedStatus: "published",
        source: "watcher",
      })
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it("rejects a status outside 040 §4.4's set at the database, not only in Zod", async () => {
    await expect(
      pool.query(
        `INSERT INTO listing_status_observation (shop_id, shopify_draft_id, observed_status, source)
         VALUES ($1,$2,'sold','watcher')`,
        [shopId, draftId]
      )
    ).rejects.toThrow(/observed_status/);
  });

  it("refuses UPDATE and DELETE on an observation (append-only trigger)", async () => {
    const obs = await recordListingStatusObservation(pool, {
      shopId,
      shopifyDraftId: draftId,
      observedStatus: "draft",
      source: "watcher",
    });
    await expect(
      pool.query(`UPDATE listing_status_observation SET observed_status = 'published' WHERE id = $1`, [
        obs.id,
      ])
    ).rejects.toThrow(/append-only|immutable|forbid/i);
    await expect(
      pool.query(`DELETE FROM listing_status_observation WHERE id = $1`, [obs.id])
    ).rejects.toThrow(/append-only|immutable|forbid/i);
  });

  it("still cannot UPDATE shopify_draft to 'published' — the old path stays closed", async () => {
    // This is the finding that justifies the whole table (040 §4.4): 003 widened
    // the status CHECK, but 001's append-only trigger means no writer can ever
    // reach those values. Proving it here keeps the justification honest.
    await expect(
      pool.query(`UPDATE shopify_draft SET status = 'published' WHERE id = $1`, [draftId])
    ).rejects.toThrow(/append-only|immutable|forbid/i);
    const row = await pool.query(`SELECT status FROM shopify_draft WHERE id = $1`, [draftId]);
    expect((row.rows[0] as { status: string }).status).toBe("draft");
  });
});
