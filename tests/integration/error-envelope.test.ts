// L4: ONE ENVELOPE, NO EXCEPTIONS (042 I10), plus the correlation id (I14) and
// the causal refusal under the anchor lock (I3).
//
// 042 I10 says it plainly: drive every route into every failure it can produce,
// INCLUDING the 413 and an unhandled throw, and assert every non-2xx body is
// exactly `{error:{code,message,details,correlation_id,retryable}}` with `code`
// in the registry and `retryable` matching the registry's declaration. Before
// this bead there were three shapes, and the only machine-readable code in the
// API was the one no handler composed.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { ERROR_CODES, type ErrorCode } from "../../src/contracts/v1/errors.js";
import { ShopRateLimiter } from "../../src/services/rateLimit.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { TEST_PIN_PEPPER } from "../testConfig.js";
import { signIn, type AuthedInject } from "./authHelpers.js";

const dbUp = await probeDb();
const UPLOADS_DIR = "tests/.tmp-envelope-uploads";
const MISSING = "00000000-0000-4000-8000-000000000000";

/** The envelope's key set, exactly (042 §4.1). Five fields, no more, no fewer. */
const ENVELOPE_KEYS = ["code", "correlation_id", "details", "message", "retryable"];

describe.skipIf(!dbUp)("the one error envelope (042 §4)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  /** `app.inject` carrying a live device + operator session (048 I1). */
  let inject: AuthedInject;
  let shopId: string;
  let base: string;
  let sessionId: string;

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_envelope_test");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Envelope Shop", slug: `envelope-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    app = await buildApp(
      pool,
      {
        port: 0,
        databaseUrl: appUrl(migrateUrl),
        uploadsDir: UPLOADS_DIR,
        bands: { high: 0.85, medium: 0.5 },
        pinPepper: TEST_PIN_PEPPER,
        publicOrigins: [],
      },
      // A generous bucket so the flow below cannot throttle itself; the throttle
      // has its own test at the bottom with its own instance.
      { limiter: new ShopRateLimiter({ ordinaryPerMinute: 10_000 }) }
    );
    base = `/api/v1/shops/${shopId}/scan-sessions`;

    // E03-D09: there is no anonymous route left to open a session on (048 I1),
    // so the phone signs in before the flow the envelope assertions run over.
    ({ inject } = await signIn(pool, app, shopId));

    const created = await inject({
      method: "POST",
      url: base,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    sessionId = (created.json() as { session: { id: string } }).session.id;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  function assertEnvelope(res: {
    statusCode: number;
    json: () => { error: Record<string, unknown> };
  }): ErrorCode {
    const body = res.json();
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(ENVELOPE_KEYS);
    const code = body.error["code"] as ErrorCode;
    expect(Object.keys(ERROR_CODES)).toContain(code);
    // The status a code maps to and its retryability are DECLARED, not inferred:
    // 042 §4.4's whole point is that a client cannot always derive the second
    // from the first, and E05-B08's queue is the caller that has to.
    expect(res.statusCode).toBe(ERROR_CODES[code].status);
    expect(body.error["retryable"]).toBe(ERROR_CODES[code].retryable);
    expect(typeof body.error["message"]).toBe("string");
    expect(body.error["correlation_id"]).toMatch(/^[0-9a-f-]{36}$/);
    return code;
  }

  it("puts every handler-authored failure in the envelope", async () => {
    const cases: Array<[string, ErrorCode, () => Promise<{ statusCode: number; json: () => never }>]> = [
      [
        "unknown shop",
        "SHOP_NOT_FOUND",
        () =>
          inject({
            method: "POST",
            url: `/api/v1/shops/${MISSING}/scan-sessions`,
            payload: {},
            headers: { "idempotency-key": randomUUID() },
          }) as never,
      ],
      [
        "unknown session",
        "SESSION_NOT_FOUND",
        () => inject({ method: "GET", url: `${base}/${MISSING}` }) as never,
      ],
      [
        "malformed uuid",
        "VALIDATION_FAILED",
        () => inject({ method: "GET", url: `${base}/not-a-uuid` }) as never,
      ],
      [
        "missing key",
        "IDEMPOTENCY_KEY_REQUIRED",
        () => inject({ method: "POST", url: base, payload: {} }) as never,
      ],
      [
        "no confirmation",
        "SESSION_HAS_NO_CONFIRMATION",
        () =>
          inject({
            method: "POST",
            url: `${base}/${sessionId}/draft`,
            payload: {},
            headers: { "idempotency-key": randomUUID() },
          }) as never,
      ],
      [
        "unrouted path",
        "ROUTE_NOT_FOUND",
        () => inject({ method: "GET", url: "/api/v1/nothing-here" }) as never,
      ],
    ];
    for (const [name, expected, run] of cases) {
      const res = await run();
      expect(assertEnvelope(res as never), name).toBe(expected);
    }
  });

  it("gives the three former prose-only 409s three different codes (042 E11)", async () => {
    // "A prose match is the only discriminator that exists, in the tests and in
    // the client alike." Now: `draft` before a confirmation and `draft` before a
    // price are distinguishable without reading English.
    const noConfirmation = await inject({
      method: "POST",
      url: `${base}/${sessionId}/draft`,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    expect(noConfirmation.json().error.code).toBe("SESSION_HAS_NO_CONFIRMATION");

    await inject({
      method: "POST",
      url: `${base}/${sessionId}/confirm`,
      payload: { issue: { title: "Hulk", issue: "181" }, source: "grid_pick" },
      headers: { "idempotency-key": randomUUID() },
    });
    const noPrice = await inject({
      method: "POST",
      url: `${base}/${sessionId}/draft`,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    expect(noPrice.json().error.code).toBe("SESSION_HAS_NO_PRICING");
    expect(noPrice.statusCode).toBe(409);
  });

  it("puts the validation detail in `details`, where it has a type (042 E9)", async () => {
    const res = await inject({
      method: "POST",
      url: `${base}/${sessionId}/condition`,
      payload: { grade_range_low: "ZZ", grade_range_high: "VF" },
      headers: { "idempotency-key": randomUUID() },
    });
    expect(res.statusCode).toBe(400);
    const details = res.json().error.details as { fieldErrors?: Record<string, string[]> };
    // The flatten output is genuinely useful and used to be loose in the `error`
    // key with no type — sometimes a string, sometimes an object.
    expect(details.fieldErrors?.["grade_range_low"]).toBeTruthy();
  });

  it("returns a correlation id on SUCCESS as well as on failure (§4.7)", async () => {
    const ok = await inject({ method: "GET", url: `${base}/${sessionId}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("honours a caller's own correlation id so a trace can be joined end to end", async () => {
    const supplied = "trace-from-the-caller";
    const res = await inject({
      method: "GET",
      url: `${base}/${MISSING}`,
      headers: { "x-correlation-id": supplied },
    });
    expect(res.headers["x-correlation-id"]).toBe(supplied);
    expect(res.json().error.correlation_id).toBe(supplied);
  });

  it("throttles the ORDINARY class with 429, Retry-After and retryable:true (042 §8.2)", async () => {
    const limiter = new ShopRateLimiter({ ordinaryPerMinute: 1 });
    const throttled = await buildApp(
      pool,
      {
        port: 0,
        databaseUrl: "",
        uploadsDir: UPLOADS_DIR,
        bands: { high: 0.85, medium: 0.5 },
        pinPepper: TEST_PIN_PEPPER,
        publicOrigins: [],
      },
      { limiter }
    );
    // A SECOND app instance needs its own signed-in phone. The bucket is now
    // keyed on the SESSION's shop rather than on `req.params.shopId` (048 §6.2,
    // closing 046 G-20), so a throttle test that sent no cookies would be
    // throttling nothing and asserting a 401.
    const { inject: throttledInject } = await signIn(pool, throttled, shopId);
    try {
      await throttledInject({ method: "GET", url: `${base}/${sessionId}` });
      const res = await throttledInject({ method: "GET", url: `${base}/${sessionId}` });
      expect(res.statusCode).toBe(429);
      expect(res.json().error.code).toBe("RATE_LIMITED");
      expect(res.json().error.retryable).toBe(true);
      expect(res.headers["retry-after"]).toBeTruthy();
      expect(limiter.events.ordinaryThrottled).toBe(1);
    } finally {
      await throttled.close();
    }
  });
});
