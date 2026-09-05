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
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { buildConsumerRegistry } from "../../src/consumers/index.js";
import { DEFAULT_OUTBOX_PARAMS, drainOnce } from "../../src/services/outbox.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { TEST_PIN_PEPPER } from "../testConfig.js";
import { TEST_PIN, injectAs, seedIdentity, type AuthedInject, type SeededIdentity } from "./authHelpers.js";

const dbUp = await probeDb();

// Relative to repo root (buildApp joins uploadsDir onto process.cwd()).
const UPLOADS_DIR = "tests/.tmp-smoke-uploads";

describe.skipIf(!dbUp)("HTTP smoke: scan-to-draft flow", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  /** `app.inject` carrying a live device + operator session (048 I1). */
  let inject: AuthedInject;
  let identity: SeededIdentity;
  let shopId: string;

  beforeAll(async () => {
    // Force the stub clients: no external tokens visible to this process.
    delete process.env["PRICECHARTING_TOKEN"];
    delete process.env["EBAY_CLIENT_ID"];
    delete process.env["EBAY_CLIENT_SECRET"];
    delete process.env["SHOPIFY_ADMIN_TOKEN"];
    delete process.env["SHOPIFY_STORE_DOMAIN"];

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
      pinPepper: TEST_PIN_PEPPER,
      publicOrigins: [],
    });

    // E03-D09: THE SMOKE TEST LOGS IN, over HTTP, exactly as the phone does.
    //
    // Every other suite issues its sessions directly (`signIn`) because the
    // session is not what it is testing. This one is the end-to-end walk, so it
    // goes through the two REAL routes: the phone exchanges the credential it
    // was enrolled with for a device session, then a person taps their name and
    // enters six digits for an operator session on top of it (048 §3.5, §7.3).
    // Anything less would leave the front door untested in the one suite whose
    // job is to walk through it.
    identity = await seedIdentity(pool, shopId);

    const opened = await app.inject({
      method: "POST",
      url: "/api/v1/device-sessions",
      headers: { "sec-fetch-site": "same-origin", "idempotency-key": randomUUID() },
      payload: { device_secret: identity.deviceSecret },
    });
    expect(opened.statusCode).toBe(201);
    const deviceCookie = firstCookie(opened.headers["set-cookie"]);

    const signedIn = await app.inject({
      method: "POST",
      url: "/api/v1/operator-sessions",
      headers: {
        "sec-fetch-site": "same-origin",
        "idempotency-key": randomUUID(),
        cookie: deviceCookie,
      },
      payload: { app_user_id: identity.operatorId, pin: TEST_PIN },
    });
    expect(signedIn.statusCode).toBe(201);
    const operatorCookie = firstCookie(signedIn.headers["set-cookie"]);

    inject = injectAs(app, `${deviceCookie}; ${operatorCookie}`);
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    rmSync(UPLOADS_DIR, { recursive: true, force: true });
  });

  /**
   * Every write carries a key (042 §5.1) and the record it was made against
   * (042 §6.1). A fresh key per call: each step of the flow is a different ACT,
   * and a key is a fact about an act, not about an attempt.
   */
  async function post(url: string, payload: object = {}): Promise<ReturnType<typeof app.inject>> {
    return inject({ method: "POST", url, payload, headers: { "idempotency-key": randomUUID() } });
  }

  it("goes register shop → session → confirm → condition → price → draft → drafted", async () => {
    // Shop shows up in the picker list.
    const shops = await inject({ method: "GET", url: "/api/v1/shops" });
    expect(shops.statusCode).toBe(200);
    expect(shops.json().shops.map((s: { id: string }) => s.id)).toContain(shopId);

    const base = `/api/v1/shops/${shopId}/scan-sessions`;

    // Create session. `created_by` is GONE from the request (041 §8.4, 042
    // §3.1 R2) and `status` is gone from the response (040 A8): the state is
    // derived from the log and appears under `state` on the GET.
    const created = await post(base);
    expect(created.statusCode).toBe(201);
    const sessionId: string = created.json().session.id;
    expect(created.json().session).not.toHaveProperty("status");
    expect(created.json().session).not.toHaveProperty("created_by");
    // 042 §4.7 / I14: every response carries the correlation id, success too —
    // "what happened to this request" needs something to join on whether or not
    // it went wrong.
    expect(created.headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);

    // Confirm identification (grid pick). `confirmed_by` is gone for the same
    // reason `created_by` is: 019 T35 signs per-operator rendering at zero and
    // an append-only row cannot be corrected later (042 I1).
    const confirm = await post(`${base}/${sessionId}/confirm`, {
      // E03-D02: `year` is a bounded STRING in the v1 contract, not a number.
      // The client stringifies before it posts (`public/app.js` `boundedIssue`),
      // in the same PR as this change per 042 A4.
      issue: { title: "Amazing Spider-Man", issue: "300", publisher: "Marvel", year: "1988" },
      source: "grid_pick",
    });
    expect(confirm.statusCode).toBe(201);

    // Condition: range + defects, never a numeric grade (R10).
    const condition = await post(`${base}/${sessionId}/condition`, {
      grade_range_low: "FN",
      grade_range_high: "VF",
      defects: ["spine_ticks", "corner_wear"],
      // 042 §6.1: the write says what world it was made against — here, the
      // confirmation this operator was looking at.
      against: { table: "human_confirmation", id: confirm.json().confirmation.id },
    });
    expect(condition.statusCode).toBe(201);

    // Price: BOTH sources run (stub PriceCharting historical + stub eBay live
    // asks) → zero comps each → policy floor applies (R11/R12). One snapshot
    // row per source.
    const price = await post(`${base}/${sessionId}/price`, {
      title: "Amazing Spider-Man",
      issue: "300",
      against: { table: "condition_assessment", id: condition.json().assessment.id },
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
    const draft = await post(`${base}/${sessionId}/draft`);
    expect(draft.statusCode).toBe(202);
    expect(draft.json().status).toBe("accepted");
    expect(draft.json().outbox_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(draft.json().already_requested).toBe(false);

    // The listing does not exist yet, and the session does not claim it does.
    const midway = await inject({ method: "GET", url: `${base}/${sessionId}` });
    expect(midway.json().events.shopify_draft).toHaveLength(0);
    // The DERIVED state, not a column: nothing witnesses `drafted` yet, so the
    // session reads `priced` (040 §3.2's ladder).
    expect(midway.json().state).toBe("priced");
    expect(midway.json().session).not.toHaveProperty("status");

    // One drain cycle: the worker claims the row, calls the STUB Shopify client
    // (no creds configured), and records shopify_draft in its own transaction.
    const drained = await drainOnce(pool, buildConsumerRegistry(), DEFAULT_OUTBOX_PARAMS, { shopId });
    expect(drained).toMatchObject({ claimed: 1, delivered: 1, failed: 0, deadLettered: 0 });

    // GET shows the drafted session with its full event trail.
    const final = await inject({ method: "GET", url: `${base}/${sessionId}` });
    expect(final.statusCode).toBe(200);
    const body = final.json();
    expect(body.state).toBe("drafted");
    expect(body.events.human_confirmation).toHaveLength(1);
    expect(body.events.condition_assessment).toHaveLength(1);
    expect(body.events.pricing_snapshot).toHaveLength(2); // one row per pricing source
    expect(body.events.shopify_draft).toHaveLength(1);
    // The stub's GID is derived from the copy key, not the clock, so a retry
    // against it behaves like the upsert it stands in for (043 §4.3).
    expect(body.events.shopify_draft[0].product_gid).toMatch(/^gid:\/\/shopify\/Product\/stub-/);
    expect(body.events.shopify_draft[0].outbox_id).toBe(draft.json().outbox_id);

    // 042 §3.3 / I5: the trail is a DECLARED projection. The `llm_rerank` row
    // carries `provider`, `model`, `confidence` and `cost_usd`; its DTO carries
    // none of them, and `human_confirmation` no longer publishes `confirmed_by`.
    // Without this the response grows a column on the day any migration adds one.
    for (const row of body.events.human_confirmation) {
      expect(Object.keys(row).sort()).toEqual(
        [
          // E02-D11: the causal reference joins the projection — a pointer to
          // another record of this session, like `supersedes_id` beside it.
          "against_id",
          "against_table",
          "confirmed_issue",
          "created_at",
          "id",
          "outcome",
          "source",
          "supersedes_id",
        ].sort()
      );
    }
    for (const row of body.events.pricing_snapshot) {
      expect(row).not.toHaveProperty("policy_id");
    }
  });

  it("guards the edges: unknown shop 404s, draft without confirmation 409s", async () => {
    const missing = await post("/api/v1/shops/00000000-0000-0000-0000-000000000000/scan-sessions");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("SHOP_NOT_FOUND");

    const created = await post(`/api/v1/shops/${shopId}/scan-sessions`);
    const bareSession: string = created.json().session.id;
    const draft = await post(`/api/v1/shops/${shopId}/scan-sessions/${bareSession}/draft`);
    expect(draft.statusCode).toBe(409);
    // 042 E11: three unrelated conditions shared a 409 and the ONLY discriminator
    // that existed — in the tests and in the client alike — was matching English
    // prose. This assertion used to be `toMatch(/no human confirmation/)`.
    expect(draft.json().error.code).toBe("SESSION_HAS_NO_CONFIRMATION");
    expect(draft.json().error.retryable).toBe(false);
  });

  // 042 §2.3 / §9.1 row 5: the unversioned paths survive as method-preserving
  // aliases with `Deprecation` on them until E02-B10's contract step removes
  // them. 308 and not 301, because 301 lets an agent rewrite a POST into a GET.
  it("redirects the unversioned aliases with 308 and a Deprecation header", async () => {
    const res = await inject({ method: "GET", url: "/api/shops" });
    expect(res.statusCode).toBe(308);
    expect(res.headers.location).toBe("/api/v1/shops");
    expect(res.headers["deprecation"]).toBe("true");

    const write = await inject({
      method: "POST",
      url: `/api/shops/${shopId}/scan-sessions`,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    expect(write.statusCode).toBe(308);
    expect(write.headers.location).toBe(`/api/v1/shops/${shopId}/scan-sessions`);
  });

  // 042 §5.1: not "should", and not "on the paths that matter".
  it("refuses a mutating call with no Idempotency-Key", async () => {
    const res = await inject({
      method: "POST",
      url: `/api/v1/shops/${shopId}/scan-sessions`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  // 042 I10 / §4.5: one envelope, no exceptions — including the paths no handler
  // authored. Fastify's own 404 was its own shape.
  it("answers an unrouted path in the envelope", async () => {
    const res = await inject({ method: "GET", url: "/api/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(Object.keys(res.json().error).sort()).toEqual([
      "code",
      "correlation_id",
      "details",
      "message",
      "retryable",
    ]);
    expect(res.json().error.code).toBe("ROUTE_NOT_FOUND");
  });
});

/**
 * The first `Set-Cookie` value, as a `Cookie` header sends it back.
 *
 * The attributes are asserted in `session-tenant-isolation.test.ts` (I6(a)); all
 * this needs is the `name=value` pair, which is the only part a browser ever
 * sends — and the only part this server ever reads.
 */
function firstCookie(header: string | string[] | undefined): string {
  const all = Array.isArray(header) ? header : [String(header)];
  return all[0]!.split(";")[0]!;
}
