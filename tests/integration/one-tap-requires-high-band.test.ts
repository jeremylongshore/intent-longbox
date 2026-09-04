// L4 — 040 v1.3.0 F3 as a SCHEMA-LEVEL rule, not a UI convention (E06-D01).
//
// F3's own words are that the refusal "is a schema-level rule, not a UI
// convention: the API rejects it, so a client that skips the downgrade cannot
// produce the row." The test that matters is therefore the one that skips the
// client entirely — a hand-rolled `POST …/confirm` with `source: 'one_tap'`
// against a re-rank the server itself did not put in the high band.
//
// It used to key on `llm_rerank.contradiction`, and that is the hole 046 finding
// R-3 named: the payload with NO evidence and NO contradiction derives `low` and
// would have walked straight through a contradiction-only check. So the first
// case below writes exactly that row — `band='low', contradiction=false` — and
// the honest control writes `band='high'` and must be ACCEPTED, because a guard
// that refuses everything is an outage rather than a guard.
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { ERROR_CODES } from "../../src/contracts/v1/errors.js";
import { ShopRateLimiter } from "../../src/services/rateLimit.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();
const UPLOADS_DIR = "tests/.tmp-one-tap-uploads";
const ASM300 = { title: "The Amazing Spider-Man", issue: "300" };

describe.skipIf(!dbUp)("a one-tap needs the high band, not the absence of a contradiction", () => {
  let pool: pg.Pool;
  let ownerPool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;
  let base: string;

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_one_tap_band");
    await runMigrations(migrateUrl);
    ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "One Tap Shop", slug: `onetap-${Date.now()}` });
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    app = await buildApp(
      pool,
      {
        port: 0,
        databaseUrl: appUrl(migrateUrl),
        uploadsDir: UPLOADS_DIR,
        bands: { high: 0.85, medium: 0.5 },
      },
      { limiter: new ShopRateLimiter({ ordinaryPerMinute: 10_000 }) }
    );
    base = `/api/v1/shops/${shopId}/scan-sessions`;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await ownerPool?.end();
    rmSync(UPLOADS_DIR, { recursive: true, force: true });
  });

  /** A session carrying one `llm_rerank` row with the given band, written as the schema owner. */
  async function sessionWithRerank(band: string, contradiction: boolean, bandInputs: unknown) {
    const created = await app.inject({
      method: "POST",
      url: base,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    const cs = await ownerPool.query(
      `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates)
         VALUES ($1, $2, 'llm_vision', $3) RETURNING id`,
      [sessionId, shopId, JSON.stringify([ASM300])]
    );
    await ownerPool.query(
      `INSERT INTO llm_rerank
         (candidate_set_id, scan_session_id, shop_id, provider, model, prompt_hash, response,
          confidence, band, contradiction, band_inputs)
       VALUES ($1,$2,$3,'anthropic','claude-sonnet-5','deadbeef',$4,$5,$6,$7,$8)`,
      [
        (cs.rows[0] as { id: string }).id,
        sessionId,
        shopId,
        JSON.stringify({ contradiction_reasons: [] }),
        // The model's number is NOT what the band came from any more, and this
        // row proves it: 0.99 beside a `low` band is a legal, expected pairing.
        0.99,
        band,
        contradiction,
        JSON.stringify(bandInputs),
      ]
    );
    return sessionId;
  }

  function oneTap(sessionId: string) {
    return app.inject({
      method: "POST",
      url: `${base}/${sessionId}/confirm`,
      payload: { issue: ASM300, source: "one_tap" },
      headers: { "idempotency-key": randomUUID() },
    });
  }

  it("REFUSES the 046 R-3 payload's one-tap: band low, contradiction FALSE", async () => {
    const sessionId = await sessionWithRerank("low", false, {
      evidence_missing: ["issue_number_read", "price_box_text", "logo_era_guess"],
      model_confidence: 0.99,
      band: "low",
    });

    const res = await oneTap(sessionId);
    const body = res.json() as { error: Record<string, unknown> };

    expect(res.statusCode).toBe(ERROR_CODES.ONE_TAP_NOT_CORROBORATED.status);
    expect(body.error["code"]).toBe("ONE_TAP_NOT_CORROBORATED");
    // 042 §4.1's envelope, whole and unabbreviated — a new code is only useful
    // if it arrives in the shape every client already parses.
    expect(Object.keys(body.error).sort()).toEqual([
      "code",
      "correlation_id",
      "details",
      "message",
      "retryable",
    ]);
    expect(body.error["retryable"]).toBe(ERROR_CODES.ONE_TAP_NOT_CORROBORATED.retryable);
    expect((body.error["details"] as { band: string }).band).toBe("low");
    // And the refusal is REAL: nothing was appended.
    const rows = await ownerPool.query(
      `SELECT count(*)::int AS n FROM human_confirmation WHERE scan_session_id = $1`,
      [sessionId]
    );
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("still names a CONTRADICTION when that is what happened (021 C3's sentence)", async () => {
    const sessionId = await sessionWithRerank("medium", true, { band: "medium", contradiction: true });
    const res = await oneTap(sessionId);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe("CONTRADICTION_BLOCKS_ONE_TAP");
  });

  it("refuses a one-tap on a session with NO re-rank at all — absent is not high", async () => {
    const created = await app.inject({
      method: "POST",
      url: base,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    const res = await oneTap(sessionId);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe("ONE_TAP_NOT_CORROBORATED");
  });

  it("ACCEPTS the honest control: a re-rank the server itself put in the high band", async () => {
    const sessionId = await sessionWithRerank("high", false, {
      evidence_missing: [],
      barcode_agreement: "agree",
      band: "high",
    });
    const res = await oneTap(sessionId);
    expect(res.statusCode).toBe(201);
    const rows = await ownerPool.query(`SELECT source FROM human_confirmation WHERE scan_session_id = $1`, [
      sessionId,
    ]);
    expect((rows.rows[0] as { source: string }).source).toBe("one_tap");
  });

  it("lets a grid pick through on the low-band session — F3 forbids the one-tap, not the confirmation", async () => {
    const sessionId = await sessionWithRerank("low", false, { band: "low" });
    const res = await app.inject({
      method: "POST",
      url: `${base}/${sessionId}/confirm`,
      payload: { issue: ASM300, source: "grid_pick" },
      headers: { "idempotency-key": randomUUID() },
    });
    expect(res.statusCode).toBe(201);
  });
});
