// L4: a correction reaches the listing (041 §3.4, I8) — asserted by BEHAVIOUR.
//
// `readDraftFacts` used to read the newest INSERTED row of each witness table.
// After one correction the newest row and the CURRENT row are different rows, so
// a draft composed from the newest insert publishes the record the operator
// REPLACED — quietly, and on the one surface a shop's customers see.
//
// The existing coverage for that fix is a unit test asserting the SQL names
// `_current`, which is an assertion about a string. This one runs the whole path:
// confirm, correct, price, request the draft, drain the outbox, and read what the
// Shopify client was actually asked to create. If the read regressed to
// `ORDER BY created_at DESC` the title below would carry the superseded issue and
// this test would say so — which a grep for a view name cannot.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { buildConsumerRegistry } from "../../src/consumers/index.js";
import { DEFAULT_OUTBOX_PARAMS, drainOnce } from "../../src/services/outbox.js";
import { fakeShopifyClient } from "../fakes.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();
const UPLOADS_DIR = "tests/.tmp-draftcurrent-uploads";

describe.skipIf(!dbUp)("the draft is composed from the CURRENT records (041 I8)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;
  let base: string;

  beforeAll(async () => {
    delete process.env["SHOPIFY_ADMIN_TOKEN"];
    delete process.env["PRICECHARTING_TOKEN"];
    const migrateUrl = await createFreshDb("longbox_draft_current_test");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Corrections Shop", slug: `current-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    app = await buildApp(pool, {
      port: 0,
      databaseUrl: appUrl(migrateUrl),
      uploadsDir: UPLOADS_DIR,
      bands: { high: 0.85, medium: 0.5 },
    });
    base = `/api/v1/shops/${shopId}/scan-sessions`;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function post(url: string, payload: object) {
    return app.inject({ method: "POST", url, payload, headers: { "idempotency-key": randomUUID() } });
  }

  it("drafts the SUCCESSOR's issue after an owner correction, never the superseded one", async () => {
    const created = await post(base, {});
    const sid = (created.json() as { session: { id: string } }).session.id;

    // The employee's call at the counter.
    const first = await post(`${base}/${sid}/confirm`, {
      issue: { title: "Incredible Hulk", issue: "180", publisher: "Marvel" },
      source: "grid_pick",
    });
    expect(first.statusCode).toBe(201);
    const wrong = (first.json() as { confirmation: { id: string } }).confirmation.id;

    // The owner's correction — 037 §4.4's path, appended and never edited.
    const corrected = await post(`${base}/${sid}/confirm`, {
      issue: { title: "Incredible Hulk", issue: "181", publisher: "Marvel" },
      source: "owner_review",
      against: { table: "human_confirmation", id: wrong },
    });
    expect(corrected.statusCode).toBe(201);
    const right = (corrected.json() as { confirmation: { id: string } }).confirmation.id;

    // BOTH rows are in the log — a correction appends (locked decision 4) — and
    // exactly one of them is current.
    const rows = await pool.query(
      `SELECT id, supersedes_id FROM human_confirmation WHERE scan_session_id = $1 ORDER BY session_seq`,
      [sid]
    );
    expect(rows.rowCount).toBe(2);
    const current = await pool.query(`SELECT id FROM human_confirmation_current WHERE scan_session_id = $1`, [
      sid,
    ]);
    expect((current.rows[0] as { id: string }).id).toBe(right);

    await post(`${base}/${sid}/condition`, {
      grade_range_low: "FN",
      grade_range_high: "VF",
      defects: [],
      against: { table: "human_confirmation", id: right },
    });
    const priced = await post(`${base}/${sid}/price`, { title: "Incredible Hulk", issue: "181" });
    expect(priced.statusCode).toBe(201);

    const draft = await post(`${base}/${sid}/draft`, {});
    expect(draft.statusCode).toBe(202);

    const shopify = fakeShopifyClient();
    const drained = await drainOnce(
      pool,
      buildConsumerRegistry({ resolveClient: async () => ({ client: shopify.client, stub: true }) }),
      DEFAULT_OUTBOX_PARAMS,
      { shopId }
    );
    expect(drained).toMatchObject({ claimed: 1, delivered: 1, failed: 0, deadLettered: 0 });

    // THE ASSERTION THIS FILE EXISTS FOR: what the shop's customers would see.
    expect(shopify.inputs).toHaveLength(1);
    const title = shopify.inputs[0]!.title;
    expect(title).toContain("#181");
    expect(title).not.toContain("#180");
  });
});
