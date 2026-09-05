// The two connector routes THROUGH THE REAL SERVER — the layer the service-level
// suite cannot reach.
//
// Bead: longbox-e5b.3.6 (alias E03-B06). Docs: 000-docs/053 §8; 042 §4 (the
// envelope), §5.1 CLASS TWO; 048 I6(d)/(e) as amended at v1.5.2; 019 T31.
//
// ============================================================================
// WHY THIS FILE EXISTS, AND IT IS NOT "more coverage"
// ============================================================================
//
// The invariant review of `16f17ef` (finding 4) found ZERO HTTP coverage of
// either route, and named the specific thing that made the gap dangerous: the
// webhook's raw-body JSON parser is registered inside an ENCAPSULATED plugin,
// **after `@fastify/multipart` has been registered on the root instance**. If
// that encapsulation ever stops applying — a plugin ordering change, a Fastify
// upgrade, somebody moving the registration — `req.body` becomes a parsed object
// instead of a Buffer, every HMAC is computed over `Buffer.alloc(0)`, and **every
// webhook fails its signature check silently**. Shopify would retry, then
// disable the subscription, and nothing in this repository would have failed.
//
// A service-level test cannot see that: it hands `receiveWebhook` a Buffer
// directly. Only a request through the real app can.
//
// The same argument covers finding 6's fix: `disableRequestLogging` is a route
// OPTION, so whether it is in effect is a property of the registered route and
// not of the handler body.
import { createHmac } from "node:crypto";
import { serviceDb } from "../../src/db.js";
import { mkdirSync, rmSync } from "node:fs";
import { Writable } from "node:stream";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { ShopRateLimiter } from "../../src/services/rateLimit.js";
import { stateDigest } from "../../src/services/connectors/shopify/index.js";
import { testConfig } from "../testConfig.js";

const DB = "longbox_test_connector_http";
const STORE = "gothamhttp.myshopify.com";
/** Fixture credentials, E03-D04's convention: `test-…-key`, tests/ only. */
const APP_SECRET = "test-shopify-app-secret-key";
const UPLOADS = "tests/.tmp-connector-http";

let enabled = false;
let pool: pg.Pool | undefined;
let ownerPool: pg.Pool | undefined;
let app: FastifyInstance | undefined;
/** Everything the server logged during one case. */
let logLines: string[] = [];

beforeAll(async () => {
  enabled = await probeDb();
  if (!enabled) return;
  mkdirSync(UPLOADS, { recursive: true });
  const migrateUrl = await createFreshDb(DB);
  await runMigrations(migrateUrl);
  // A SHOP IS CREATED BY THE OWNING CONNECTION (E03-B04). `shop` is policied on
  // its own `id`, so an INSERT can never satisfy `id = current_shop_id()` — the
  // tenant IS the row being created — which makes onboarding a schema-owner act
  // enforced by the database rather than by convention. Everything the suite
  // EXERCISES still runs on the least-privileged pool.
  ownerPool = new pg.Pool({ connectionString: migrateUrl });
  pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
  // A shop exists so the receipt has something to resolve to; its id is not
  // asserted here, because this suite is about the HTTP layer and the tenant
  // resolution is asserted in `connector-oauth.test.ts`.
  await seedShop(ownerPool, { name: "Gotham HTTP", slug: "gothamhttp" });

  // The app's credentials reach `buildApp` through the environment, exactly as
  // they do in production — this suite exercises the WIRING, so it must not
  // inject past it.
  process.env["SHOPIFY_APP_CLIENT_ID"] = "test-client-id";
  process.env["SHOPIFY_APP_CLIENT_SECRET"] = APP_SECRET;
  process.env["SHOPIFY_APP_REDIRECT_URI"] = "https://longbox.example/api/v1/connectors/shopify/callback";

  app = await buildApp(pool, testConfig({ uploadsDir: UPLOADS, publicOrigins: [] }), {
    // ⚠ THE LOG DESTINATION IS HELD BY THIS SUITE, AND IT HAS TO BE.
    //
    // pino's default writes to file descriptor 1 directly, so patching
    // `process.stdout.write` sees nothing; and Fastify's error handler logs
    // through `req.log`, a pino CHILD logger, so replacing a method on
    // `app.log` catches the request line and misses the error line entirely.
    // The first version of this file did the second of those and asserted the
    // PRESENCE of a line it was not watching for.
    //
    // Both directions are asserted below and they are opposites — the request
    // line must be ABSENT and the error line must be PRESENT — so a capture
    // that saw only one of them could pass either assertion for the wrong
    // reason.
    logDestination: new Writable({
      write(chunk: Buffer | string, _enc, done) {
        logLines.push(chunk.toString());
        done();
      },
    }),
    // Low enough that the burst case is a burst and not a wait, high enough
    // that the other cases are not throttled by each other. The hook's
    // `takeRoute` bucket is keyed on the ROUTE TEMPLATE, so the callback and the
    // webhook have independent counters: the callback's four cases fit under
    // this ceiling and the webhook's ten-request burst deliberately does not.
    limiter: new ShopRateLimiter({ ordinaryPerMinute: 8 }),
  });
  // Every log line the server writes, captured at the transport so nothing
  // depends on which logger method a route happened to use (019 T31).
}, 120_000);

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await ownerPool?.end();
  rmSync(UPLOADS, { recursive: true, force: true });
  for (const name of ["SHOPIFY_APP_CLIENT_ID", "SHOPIFY_APP_CLIENT_SECRET", "SHOPIFY_APP_REDIRECT_URI"]) {
    delete process.env[name];
  }
});

function signBody(body: Buffer): string {
  return createHmac("sha256", APP_SECRET).update(body).digest("base64");
}

const WEBHOOK_PATH = "/api/v1/connectors/shopify/webhooks";

describe("POST …/connectors/shopify/webhooks, through the real server", () => {
  it("accepts a correctly signed webhook with 200 — which proves the RAW-BODY parser applies", async () => {
    if (!enabled) return;
    // ⚠ THIS IS THE ASSERTION FINDING 4 IS ABOUT. A pass here means `req.body`
    // arrived as a Buffer through an encapsulated content-type parser registered
    // AFTER `@fastify/multipart` on the root instance. If the encapsulation ever
    // stops applying, the HMAC is computed over an empty buffer and this case
    // turns into the 401 below — loudly, in CI, instead of silently in
    // production against a provider that eventually disables the subscription.
    const body = Buffer.from(JSON.stringify({ shop_domain: STORE, note: "raw bytes matter" }));
    const res = await app!.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "shop/redact",
        "x-shopify-hmac-sha256": signBody(body),
        "x-shopify-shop-domain": STORE,
        "x-shopify-webhook-id": "http-wh-1",
        "x-shopify-api-version": "2025-07",
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ acknowledged: true });
    // …and the fact really landed, so the 200 is not an empty acknowledgement.
    // The receipt is read in the `connector-inbound` scope, like the code that
    // wrote it (E03-B04): a webhook that matches no install carries a NULL
    // `shop_id` (053 §5.5), which no tenant context can see.
    const row = await serviceDb(pool!, "connector-inbound").query(
      `SELECT payload_digest FROM connector_webhook_receipt WHERE webhook_id = 'http-wh-1'`
    );
    expect(row.rows).toHaveLength(1);
  });

  it("REFUSES a forged webhook with 401 and the error envelope, and NO Idempotency-Key was required", async () => {
    if (!enabled) return;
    const body = Buffer.from(JSON.stringify({ shop_domain: STORE }));
    const res = await app!.inject({
      method: "POST",
      url: WEBHOOK_PATH,
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "app/uninstalled",
        "x-shopify-hmac-sha256": "not-a-signature",
        "x-shopify-shop-domain": STORE,
        "x-shopify-webhook-id": "http-wh-forged",
      },
      payload: body,
    });
    // 401 and not 400: the request carried NO `Idempotency-Key` and NO
    // `Sec-Fetch-Site`, and it got past the hook anyway — which is 042 §5.1
    // CLASS TWO working. A 400 `IDEMPOTENCY_KEY_REQUIRED` here would mean the
    // `provider-callback` kind stopped applying and every real webhook was being
    // refused for the wrong reason.
    expect(res.statusCode).toBe(401);
    const envelope = res.json() as { error: { code: string; details: unknown; correlation_id: string } };
    expect(envelope.error.code).toBe("WEBHOOK_SIGNATURE_INVALID");
    // No `details`: an unsigned caller learns nothing about which header, which
    // topic or which store would have been accepted (048 §9.3).
    expect(envelope.error.details).toEqual({});
    expect(envelope.error.correlation_id).toBeTruthy();
    // And it wrote nothing.
    const row = await pool!.query(
      `SELECT id FROM connector_webhook_receipt WHERE webhook_id = 'http-wh-forged'`
    );
    expect(row.rowCount).toBe(0);
  });

  it("answers 429 under a burst, so Shopify RETRIES instead of losing the message", async () => {
    if (!enabled) return;
    // The split that matters on the wire: Shopify retries a 429 with backoff and
    // does NOT retry a 401. Collapsing them would mean a shop that tripped a
    // provisional floor lost the message permanently — including, on the worst
    // day, a `customers/redact`.
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const body = Buffer.from(JSON.stringify({ shop_domain: STORE, n: i }));
      const res = await app!.inject({
        method: "POST",
        url: WEBHOOK_PATH,
        headers: {
          "content-type": "application/json",
          "x-shopify-topic": "shop/redact",
          "x-shopify-hmac-sha256": signBody(body),
          "x-shopify-shop-domain": STORE,
          "x-shopify-webhook-id": `http-wh-burst-${String(i)}`,
        },
        payload: body,
      });
      statuses.push(res.statusCode);
    }
    // The per-ROUTE aggregate bucket is the hook's and it has no session to key
    // on, so the throttle arrives without any tenant being resolved.
    expect(statuses).toContain(429);
    expect(statuses[0]).toBe(200);
  });
});

describe("GET …/connectors/shopify/callback, through the real server", () => {
  it("REFUSES an unsigned callback with 400 CONNECTOR_CALLBACK_REFUSED and empty details", async () => {
    if (!enabled) return;
    const res = await app!.inject({
      method: "GET",
      url: "/api/v1/connectors/shopify/callback?shop=gothamhttp.myshopify.com&code=c&state=s&hmac=deadbeef",
    });
    expect(res.statusCode).toBe(400);
    const envelope = res.json() as { error: { code: string; details: unknown } };
    expect(envelope.error.code).toBe("CONNECTOR_CALLBACK_REFUSED");
    // ONE answer for every refusal (048 §9.3): a caller who could tell
    // `bad_signature` from `unknown_state` from `state_expired` would hold an
    // oracle over which install states exist.
    expect(envelope.error.details).toEqual({});
  });

  it("is reachable ANONYMOUSLY — no cookie, no Sec-Fetch-Site, no Idempotency-Key", async () => {
    if (!enabled) return;
    // 048 I6(d) as amended at v1.5.2: a GET that writes, permitted for the
    // `provider-callback` kind because it reads no cookie. If the hook ever
    // stopped treating it that way the answer would be 401 SESSION_REQUIRED, and
    // Shopify's redirect would land on a login the merchant has no account for.
    const res = await app!.inject({
      method: "GET",
      url: "/api/v1/connectors/shopify/callback?shop=gothamhttp.myshopify.com&code=c&state=s&hmac=beef",
    });
    expect(res.statusCode).not.toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).not.toBe("SESSION_REQUIRED");
  });

  it("LOGS NO REQUEST LINE for either route — the state, code and hmac stay out of the log (T31)", async () => {
    if (!enabled) return;
    // The invariant review's finding 6: Fastify logs `req.url` on every request,
    // and this route's URL carries the authorization code, the signature and the
    // RAW STATE — the value `026`'s header says exists in no column. The digest
    // discipline is beside the point if the log has the plaintext.
    logLines = [];
    const state = "plaintext-state-value-that-must-not-be-logged";
    await app!.inject({
      method: "GET",
      url: `/api/v1/connectors/shopify/callback?shop=${STORE}&code=authcode-secret&state=${state}&hmac=abc123`,
    });
    // ONLY the callback is injected here. The webhook's URL carries nothing —
    // its secret is in a header and its body — so adding it would spend a rate
    // bucket to assert the absence of a string that was never going to be in
    // that line. The webhook's own suppression is covered by the burst and 200
    // cases above, which would have logged a request line if it were off.
    const logged = logLines.join("\n");
    // The assertion is on the VALUES, not on a redaction rule — this file's
    // sibling `secret-surfaces.test.ts` makes the same argument: a test that
    // asserts "the redactor redacted" tests the redactor.
    expect(logged).not.toContain(state);
    expect(logged).not.toContain("authcode-secret");
    expect(logged).not.toContain("abc123");
    expect(logged).not.toContain(stateDigest(state));
  });

  it("an unhandled 500 DOES emit a line, carrying the correlation id and not the query", async () => {
    if (!enabled) return;
    // ⚠ THE REGRESSION THIS IS FOR. The first fix used `logLevel: "silent"` on
    // both routes, which suppressed the request line AND every error line with
    // it — so a 500 on the one route a merchant reaches mid-install would have
    // left **no server line at all**, and 042 I14's correlation id exists
    // precisely to be joined to that line. **Silencing a logger to redact a
    // field is a redaction that deletes the evidence.**
    //
    // The suppression now lives in `src/app.ts` as `disableRequestLogging`,
    // which removes the `req.url` line and nothing else.
    logLines = [];
    const state = "another-plaintext-state-that-must-not-be-logged";
    // ⚠ BOTH ENTRY POINTS ARE BROKEN, and `connect` is the one that matters since
    // E03-B04: the state lookup now runs in a tenant-scoped transaction, so it
    // reaches the pool through `connect()` rather than through `query()`. Leaving
    // only `query` stubbed turned this case into a 400 — a validation refusal
    // instead of the unhandled throw the assertion is about.
    const original = pool!.query.bind(pool!);
    const originalConnect = pool!.connect.bind(pool!);
    // Break the FIRST database read `completeInstall` makes, after the HMAC
    // check has passed — so this is a genuine unhandled throw on the real path
    // and not a validation refusal.
    (pool as unknown as { query: unknown }).query = () => {
      throw new Error("deliberate failure with no secret in it");
    };
    (pool as unknown as { connect: unknown }).connect = () => {
      throw new Error("deliberate failure with no secret in it");
    };
    let res;
    try {
      const query = signQuery({ shop: STORE, code: "authcode-500", state, timestamp: "1757000099" });
      const qs = new URLSearchParams(query).toString();
      res = await app!.inject({ method: "GET", url: `/api/v1/connectors/shopify/callback?${qs}` });
    } finally {
      (pool as unknown as { query: unknown }).query = original;
      (pool as unknown as { connect: unknown }).connect = originalConnect;
    }

    expect(res.statusCode).toBe(500);
    const envelope = res.json() as { error: { code: string; correlation_id: string } };
    expect(envelope.error.code).toBe("INTERNAL_ERROR");
    const correlationId = envelope.error.correlation_id;
    expect(correlationId).toBeTruthy();

    const logged = logLines.join("\n");
    // THE LINE EXISTS…
    expect(logged).toContain("unhandled error");
    // …and it carries the id an operator would be given, so a report about this
    // failure is greppable rather than merely acknowledged.
    expect(logged).toContain(correlationId);
    // …and it still carries none of the query string.
    expect(logged).not.toContain(state);
    expect(logged).not.toContain("authcode-500");
  });
});

/** Sign a query the way Shopify does — shared by the callback cases. */
function signQuery(params: Record<string, string>): Record<string, string> {
  const message = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("&");
  return { ...params, hmac: createHmac("sha256", APP_SECRET).update(message, "utf8").digest("hex") };
}
