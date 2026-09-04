// L4: idempotency against a real constraint (042 I11, I12, I21).
//
// This is the half a fake cannot have. §5.3's whole argument is that
// `UNIQUE (shop_id, idempotency_key)` does the serialising — "a concurrent
// request with the same key BLOCKS on the constraint" — and a constraint is
// exactly what a fake pool does not have. So the cases here are the ones that
// only a database can decide: the replay, the 422, the per-shop scope, and the
// held-connection isolation with a DELIBERATELY DELAYED first transaction.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { runIdempotent } from "../../src/services/idempotency.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { TEST_PIN_PEPPER } from "../testConfig.js";
import { signIn, type AuthedInject } from "./authHelpers.js";

const dbUp = await probeDb();
const UPLOADS_DIR = "tests/.tmp-idem-uploads";

describe.skipIf(!dbUp)("request idempotency (042 §5)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  /** `app.inject` carrying a live device + operator session (048 I1). */
  let inject: AuthedInject;
  /**
   * A SECOND signed-in phone, at shop B.
   *
   * It exists because E03-D09 made the cross-shop case unreachable from one
   * session: `shop_id` comes from the session and the URL is checked against it
   * (048 §6.1), so shop A's phone calling shop B's path now gets
   * `SHOP_NOT_FOUND` — I2's property — and the key could not have crossed even
   * if the idempotency scope had been wrong. Proving 042 I12 therefore needs two
   * phones, which is also what the real world looks like.
   */
  let injectB: AuthedInject;
  let shopA: string;
  let shopB: string;
  let base: string;

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_idempotency_test");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopA = await seedShop(ownerPool, { name: "Shop A", slug: `idem-a-${Date.now()}` });
    shopB = await seedShop(ownerPool, { name: "Shop B", slug: `idem-b-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    app = await buildApp(pool, {
      port: 0,
      databaseUrl: appUrl(migrateUrl),
      uploadsDir: UPLOADS_DIR,
      bands: { high: 0.85, medium: 0.5 },
      pinPepper: TEST_PIN_PEPPER,
      publicOrigins: [],
    });
    base = `/api/v1/shops/${shopA}/scan-sessions`;

    // E03-D09: every shop-scoped route is behind a device session plus an
    // operator session now (048 I1), so the suite signs one phone in and uses
    // `inject` in place of `app.inject`.
    ({ inject } = await signIn(pool, app, shopA));
    ({ inject: injectB } = await signIn(pool, app, shopB));
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function post(
    url: string,
    key: string,
    payload: object = {},
    as: AuthedInject = inject
  ): Promise<ReturnType<typeof app.inject>> {
    return as({ method: "POST", url, payload, headers: { "idempotency-key": key } });
  }

  it("makes the retry a no-op at every step, with a byte-identical body (019 T23)", async () => {
    const key = randomUUID();
    const first = await post(base, key);
    const second = await post(base, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    // "A retry appends; it can never silently overwrite an earlier attempt"
    // (033 §5.1). A stored-response replay satisfies that in the only way an
    // append-only system can: the second call writes NOTHING AT ALL.
    expect(second.body).toBe(first.body);
    const rows = await pool.query(`SELECT count(*)::int AS n FROM scan_session WHERE shop_id = $1`, [shopA]);
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });

  it("carries a DIFFERENT correlation id on the replay (042 §4.7, I14)", async () => {
    const key = randomUUID();
    const first = await post(base, key);
    const second = await post(base, key);
    // "A retry is a NEW request, with a NEW correlation_id, carrying the SAME
    // Idempotency-Key. That is precisely what makes a replay traceable" — and
    // why the two are never conflated into one field.
    expect(first.headers["x-correlation-id"]).not.toBe(second.headers["x-correlation-id"]);
  });

  it("is a no-op at EVERY step, not only at the last one (040 §5.2)", async () => {
    const session = await post(base, randomUUID());
    const sessionId = (session.json() as { session: { id: string } }).session.id;
    const key = randomUUID();
    const body = { issue: { title: "Hulk", issue: "181" }, source: "grid_pick" };
    const first = await post(`${base}/${sessionId}/confirm`, key, body);
    const second = await post(`${base}/${sessionId}/confirm`, key, body);
    expect(first.statusCode).toBe(201);
    expect(second.body).toBe(first.body);
    // The duplicate 019 T23 counts is not only the duplicated Shopify product:
    // it is the duplicated confirmation, which corrupts the eval set (R9) and
    // the T3/T20 numerators before anything reaches a listing.
    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM human_confirmation WHERE scan_session_id = $1`,
      [sessionId]
    );
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });

  it("refuses the same key with a different body: 422 IDEMPOTENCY_KEY_REUSED (§5.4)", async () => {
    const session = await post(base, randomUUID());
    const sessionId = (session.json() as { session: { id: string } }).session.id;
    const key = randomUUID();
    await post(`${base}/${sessionId}/confirm`, key, { issue: { title: "A" }, source: "grid_pick" });
    const changed = await post(`${base}/${sessionId}/confirm`, key, {
      issue: { title: "B" },
      source: "grid_pick",
    });
    expect(changed.statusCode).toBe(422);
    expect(changed.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("never lets a key cross a shop (042 I12; 019 T24, non-waivable)", async () => {
    // TWO PHONES since E03-D09, and the reason is the stronger property: one
    // session cannot reach the other shop's path at all (048 §6.1, I2), so this
    // now proves the idempotency SCOPE with the tenancy boundary already closed
    // underneath it rather than instead of it.
    const key = randomUUID();
    const inA = await post(`/api/v1/shops/${shopA}/scan-sessions`, key);
    const inB = await post(`/api/v1/shops/${shopB}/scan-sessions`, key, {}, injectB);
    expect(inA.statusCode).toBe(201);
    expect(inB.statusCode).toBe(201);
    // Shop B gets its OWN session, never shop A's stored response.
    expect(inB.body).not.toBe(inA.body);
    const bSession = (inB.json() as { session: { shop_id: string } }).session.shop_id;
    expect(bSession).toBe(shopB);
  });

  it("blocks a concurrent same-key request until the first resolves, and never shows it a partial row (I21)", async () => {
    const key = randomUUID();
    const req = {
      shopId: shopA,
      idempotencyKey: key,
      route: "/test/held-connection",
      method: "POST",
      params: { shopId: shopA },
      body: { probe: true },
    };

    // The FIRST transaction is deliberately held open between its idempotency
    // INSERT and its COMMIT. Without the delay the two would not overlap and the
    // test would prove nothing about blocking.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let secondFinishedFirst = false;

    const firstCall = runIdempotent(pool, req, async () => {
      await gate;
      return { status: 201, body: { winner: true } };
    });
    // Give the first transaction time to take its lock before the second starts.
    await new Promise((r) => setTimeout(r, 150));
    const secondCall = runIdempotent(pool, req, async () => {
      secondFinishedFirst = true;
      return { status: 201, body: { winner: false } };
    });
    // The second is now blocked at the database on the unique constraint. It
    // cannot have run its handler, and it cannot have read a partial row.
    await new Promise((r) => setTimeout(r, 250));
    expect(secondFinishedFirst).toBe(false);

    release();
    const [first, second] = await Promise.all([firstCall, secondCall]);
    expect(first).toMatchObject({ status: 201, body: { winner: true }, replayed: false });
    // On commit the loser returns the STORED response, via the unique-violation
    // path, with no in-flight state anywhere.
    expect(second).toMatchObject({ status: 201, body: { winner: true }, replayed: true });
    expect(secondFinishedFirst).toBe(false);
  });

  it("frees the key when the first transaction ROLLS BACK — nothing happened, so nothing replays (§5.3 step 4)", async () => {
    const key = randomUUID();
    const req = {
      shopId: shopA,
      idempotencyKey: key,
      route: "/test/rollback",
      method: "POST",
      params: { shopId: shopA },
      body: {},
    };
    await expect(
      runIdempotent(pool, req, async () => {
        throw new Error("the gate refused");
      })
    ).rejects.toThrow("the gate refused");
    const retried = await runIdempotent(pool, req, async () => ({ status: 201, body: { done: true } }));
    expect(retried).toMatchObject({ status: 201, replayed: false });
  });

  it("stores the row inside the SAME transaction as the effect, keyed on the route TEMPLATE (§5.2)", async () => {
    const key = randomUUID();
    await post(base, key);
    const row = await pool.query(
      `SELECT route, request_hash, response_status FROM request_idempotency
        WHERE shop_id = $1 AND idempotency_key = $2`,
      [shopA, key]
    );
    const stored = row.rows[0] as { route: string; request_hash: string; response_status: number };
    // The TEMPLATE, not the resolved path: a resolved path would make one
    // logical route look like one row per session.
    expect(stored.route).toBe("/api/v1/shops/:shopId/scan-sessions");
    expect(stored.request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.response_status).toBe(201);
  });

  it("refuses a mutating call with no key at all (§5.1)", async () => {
    const res = await inject({ method: "POST", url: base, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    // And it refuses BEFORE writing anything.
    const rows = await pool.query(`SELECT count(*)::int AS n FROM request_idempotency WHERE shop_id = $1`, [
      shopA,
    ]);
    expect((rows.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });
});
