// L6 smoke: one pass through the real HTTP app (fastify inject) with stub
// clients — register shop → create session → confirm → condition → price →
// draft → drain the outbox → GET shows drafted. Stub Shopify/PriceCharting/eBay
// engage automatically because no creds are configured (R11, R12, R14 DRAFT
// status).
//
// ⚠ THE DRAFT STEP IS ASYNCHRONOUS SINCE E02-D07 (043 §4.1, §4.2). `POST …/draft`
// no longer calls Shopify: it appends `longbox.commerce.draft_requested` inside
// the request transaction and answers **202** with the outbox row's id. So this
// smoke test now drains one cycle explicitly, which is also what makes it
// deterministic — the server's poller is a timer, and a smoke test that slept
// waiting for one would be a smoke test that flakes on a slow machine.
import { mkdirSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { buildConsumerRegistry } from "../../src/consumers/index.js";
import { DEFAULT_OUTBOX_PARAMS, drainOnce } from "../../src/services/outbox.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

// Relative to repo root (buildApp joins uploadsDir onto process.cwd()).
const UPLOADS_DIR = "tests/.tmp-smoke-uploads";

describe.skipIf(!dbUp)("HTTP smoke: scan-to-draft flow", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;

  beforeAll(async () => {
    // Force the stub clients: no external tokens visible to this process.
    delete process.env.PRICECHARTING_TOKEN;
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_CLIENT_SECRET;
    delete process.env.SHOPIFY_ADMIN_TOKEN;
    delete process.env.SHOPIFY_STORE_DOMAIN;

    const migrateUrl = await createFreshDb("longbox_smoke_test");
    await runMigrations(migrateUrl);
    // E02-D06: the app runs on the LEAST-PRIVILEGED role, exactly as the server
    // does, so this smoke pass is also the proof that the grant plan is
    // sufficient — a route needing a privilege the plan does not give fails here
    // rather than in production. Seeding stays on the owner connection because
    // `pnpm register-shop` is an operator act on the owner role too.
    const url = appUrl(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    // "Register shop": shop row + pricing policy (what pnpm register-shop seeds).
    shopId = await seedShop(ownerPool, {
      name: "Gotham City Limit",
      compPercent: 90,
      floorCents: 300,
    });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: url });

    mkdirSync(UPLOADS_DIR, { recursive: true });
    app = await buildApp(pool, {
      port: 0,
      databaseUrl: url,
      uploadsDir: UPLOADS_DIR,
      bands: { high: 0.85, medium: 0.5 },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    rmSync(UPLOADS_DIR, { recursive: true, force: true });
  });

  it("goes register shop → session → confirm → condition → price → draft → drafted", async () => {
    // Shop shows up in the picker list.
    const shops = await app.inject({ method: "GET", url: "/api/shops" });
    expect(shops.statusCode).toBe(200);
    expect(shops.json().shops.map((s: { id: string }) => s.id)).toContain(shopId);

    const base = `/api/shops/${shopId}/scan-sessions`;

    // Create session.
    const created = await app.inject({
      method: "POST",
      url: base,
      payload: { created_by: "smoke-tester" },
    });
    expect(created.statusCode).toBe(201);
    const sessionId: string = created.json().session.id;
    expect(created.json().session.status).toBe("in_progress");

    // Confirm identification (grid pick).
    const confirm = await app.inject({
      method: "POST",
      url: `${base}/${sessionId}/confirm`,
      payload: {
        issue: { title: "Amazing Spider-Man", issue: "300", publisher: "Marvel", year: 1988 },
        source: "grid_pick",
        confirmed_by: "smoke-tester",
      },
    });
    expect(confirm.statusCode).toBe(201);

    // Condition: range + defects, never a numeric grade (R10).
    const condition = await app.inject({
      method: "POST",
      url: `${base}/${sessionId}/condition`,
      payload: { grade_range_low: "FN", grade_range_high: "VF", defects: ["spine_ticks", "corner_wear"] },
    });
    expect(condition.statusCode).toBe(201);

    // Price: BOTH sources run (stub PriceCharting historical + stub eBay live
    // asks) → zero comps each → policy floor applies (R11/R12). One snapshot
    // row per source.
    const price = await app.inject({
      method: "POST",
      url: `${base}/${sessionId}/price`,
      payload: { title: "Amazing Spider-Man", issue: "300" },
    });
    expect(price.statusCode).toBe(201);
    const priceBody = price.json();
    expect(priceBody.stub).toBe(true);
    expect(priceBody.suggested_cents).toBe(300); // floor_cents wins over empty comps
    expect(priceBody.driven_by).toBe("policy_floor");
    expect(priceBody.snapshot_count).toBe(2);
    expect(priceBody.sources.map((s: { source: string }) => s.source).sort()).toEqual([
      "ebay",
      "pricecharting",
    ]);
    for (const s of priceBody.sources) {
      expect(s.status).toBe("ok");
      expect(s.stub).toBe(true);
      expect(s.comps_count).toBe(0);
    }

    // Draft: the request OWES the effect and returns 202 with the outbox id.
    // Nothing has touched Shopify at this point, which is the whole change: the
    // orphaned-draft window (a real DRAFT product with no shopify_draft row)
    // cannot open, because the external call has not happened yet.
    const draft = await app.inject({ method: "POST", url: `${base}/${sessionId}/draft` });
    expect(draft.statusCode).toBe(202);
    expect(draft.json().status).toBe("accepted");
    expect(draft.json().outbox_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(draft.json().already_requested).toBe(false);

    // The listing does not exist yet, and the session does not claim it does.
    const midway = await app.inject({ method: "GET", url: `${base}/${sessionId}` });
    expect(midway.json().events.shopify_draft).toHaveLength(0);
    expect(midway.json().session.status).not.toBe("drafted");

    // One drain cycle: the worker claims the row, calls the STUB Shopify client
    // (no creds configured), and records shopify_draft in its own transaction.
    const drained = await drainOnce(pool, buildConsumerRegistry(), DEFAULT_OUTBOX_PARAMS, { shopId });
    expect(drained).toMatchObject({ claimed: 1, delivered: 1, failed: 0, deadLettered: 0 });

    // GET shows the drafted session with its full event trail.
    const final = await app.inject({ method: "GET", url: `${base}/${sessionId}` });
    expect(final.statusCode).toBe(200);
    const body = final.json();
    expect(body.session.status).toBe("drafted");
    expect(body.events.human_confirmation).toHaveLength(1);
    expect(body.events.condition_assessment).toHaveLength(1);
    expect(body.events.pricing_snapshot).toHaveLength(2); // one row per pricing source
    expect(body.events.shopify_draft).toHaveLength(1);
    // The stub's GID is derived from the copy key, not the clock, so a retry
    // against it behaves like the upsert it stands in for (043 §4.3).
    expect(body.events.shopify_draft[0].product_gid).toMatch(/^gid:\/\/shopify\/Product\/stub-/);
    expect(body.events.shopify_draft[0].outbox_id).toBe(draft.json().outbox_id);
  });

  it("guards the edges: unknown shop 404s, draft without confirmation 409s", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/api/shops/00000000-0000-0000-0000-000000000000/scan-sessions",
      payload: {},
    });
    expect(missing.statusCode).toBe(404);

    const created = await app.inject({
      method: "POST",
      url: `/api/shops/${shopId}/scan-sessions`,
      payload: {},
    });
    const bareSession: string = created.json().session.id;
    const draft = await app.inject({
      method: "POST",
      url: `/api/shops/${shopId}/scan-sessions/${bareSession}/draft`,
    });
    expect(draft.statusCode).toBe(409);
    expect(draft.json().error).toMatch(/no human confirmation/);
  });
});
