// L6 smoke: one pass through the real HTTP app (fastify inject) with stub
// clients — register shop → create session → confirm → condition → price →
// draft → GET shows drafted. Stub Shopify/PriceCharting engage automatically
// because no tokens are configured (R11, R12, R14 with status DRAFT).
import { mkdirSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

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
    delete process.env.SHOPIFY_ADMIN_TOKEN;
    delete process.env.SHOPIFY_STORE_DOMAIN;

    const url = await createFreshDb("longbox_smoke_test");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    // "Register shop": shop row + pricing policy (what pnpm register-shop seeds).
    shopId = await seedShop(pool, { name: "Gotham City Limit", compPercent: 90, floorCents: 300 });

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

    // Price: stub PriceCharting → zero comps → policy floor applies (R11/R12).
    const price = await app.inject({
      method: "POST",
      url: `${base}/${sessionId}/price`,
      payload: { query: "amazing spider-man 300" },
    });
    expect(price.statusCode).toBe(201);
    expect(price.json().stub).toBe(true);
    expect(price.json().suggested_cents).toBe(300); // floor_cents wins over empty comps
    expect(price.json().comps_count).toBe(0);

    // Draft: stub Shopify client returns a fake GID; status lands as draft.
    const draft = await app.inject({ method: "POST", url: `${base}/${sessionId}/draft` });
    expect(draft.statusCode).toBe(201);
    expect(draft.json().stub).toBe(true);
    expect(draft.json().draft.status).toBe("draft");
    expect(draft.json().draft.product_gid).toMatch(/^gid:\/\/shopify\/Product\/stub-/);
    // The productSet payload is DRAFT-only — nothing publishes without a human.
    expect(draft.json().product_set_input.input.status).toBe("DRAFT");

    // GET shows the drafted session with its full event trail.
    const final = await app.inject({ method: "GET", url: `${base}/${sessionId}` });
    expect(final.statusCode).toBe(200);
    const body = final.json();
    expect(body.session.status).toBe("drafted");
    expect(body.events.human_confirmation).toHaveLength(1);
    expect(body.events.condition_assessment).toHaveLength(1);
    expect(body.events.pricing_snapshot).toHaveLength(1);
    expect(body.events.shopify_draft).toHaveLength(1);
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
