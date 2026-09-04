// At the ceiling the system degrades to the MANUAL PATH, never to a stub —
// 050 §9 I6, through the real HTTP surface.
//
// Bead: longbox-e5b.3.5 (alias E03-B05), the code half. Docs: 050 §2 Q4(c)/(d),
// §6.4, §9 I6; 042 §8.2–§8.4; 019 K4 ("the pipeline never blocks on a
// provider"); 022 P1 (the human is in authority over identity) and P8 (honesty
// about what the machine did); 021 §2 (the retirement of "verified").
//
// THE RULE, AND WHY IT IS THE ONE WORTH A LIVE-DATABASE TEST. A throttle we
// impose on ourselves is a provider outage we caused, so handling it worse than
// one we did not would be incoherent — the operator keeps working on the manual
// route, which already exists and is already tested. **What must never happen is
// a fabricated or stubbed identification presented as a result.** A stub answer
// at a spend ceiling would be the first time this system lied to an operator to
// stay inside a budget, and it is the assertion below that would catch it.
//
// THE TWO CEILINGS ARE PER OWNER (050 §2 Q4(c)). A shop spending its own money
// gets the higher floor; a shop on the SERVICE ACCOUNT gets the lower one,
// because a shop that can reach the service account can spend an unbounded
// amount of somebody else's money by looping. Both are PROVISIONAL floors in
// 042 §8.4's class — non-evidentiary, never quoted as capacity, cost or
// reliability at any class (021 B16).
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { ShopRateLimiter } from "../../src/services/rateLimit.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { TEST_PIN_PEPPER } from "../testConfig.js";
import { signIn, type AuthedInject } from "./authHelpers.js";

const dbUp = await probeDb();
const UPLOADS_DIR = "tests/.tmp-spend-ceiling-uploads";

describe.skipIf(!dbUp)("the metered ceiling degrades to the manual path (050 §9 I6)", () => {
  let pool: pg.Pool;
  let ownerPool: pg.Pool;
  let app: FastifyInstance;
  let inject: AuthedInject;
  let shopId: string;
  let base: string;
  let limiter: ShopRateLimiter;

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_spend_ceiling");
    await runMigrations(migrateUrl);
    ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Ceiling Shop", slug: `ceiling-${Date.now()}` });
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    // A metered budget of ZERO is a legal operator setting (see
    // `assertSpendCeilingsOrThrow`): it puts every identify call on the manual
    // path, which is a supported route rather than an outage.
    limiter = new ShopRateLimiter({ ordinaryPerMinute: 10_000, meteredPerDay: 0, serviceAccountPerDay: 0 });
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
      { limiter }
    );
    base = `/api/v1/shops/${shopId}/scan-sessions`;
    ({ inject } = await signIn(pool, app, shopId));
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await ownerPool?.end();
    rmSync(UPLOADS_DIR, { recursive: true, force: true });
  });

  async function openSession(): Promise<string> {
    const created = await inject({
      method: "POST",
      url: base,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    return (created.json() as { session: { id: string } }).session.id;
  }

  it("answers 200 on the manual route, writes NO llm_rerank and NO cost_log, and counts the throttle", async () => {
    const sessionId = await openSession();
    const before = limiter.events.meteredExhausted;

    const res = await inject({
      method: "POST",
      url: `${base}/${sessionId}/identify`,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      manual_path: boolean;
      band: string;
      llm_rerank_id: string | null;
      candidates: unknown[];
    };
    // 040 §4.6: "not a failure; a different route to the same rung".
    expect(body.manual_path).toBe(true);
    expect(body.band).toBe("low");
    // NO FABRICATION. This is the assertion the whole invariant is about: no
    // candidate, no confidence, no re-rank id — nothing that an operator could
    // mistake for the machine having looked at the book.
    expect(body.llm_rerank_id).toBeNull();
    expect(body.candidates).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/confidence|provider|model|usd/i);

    // Nothing was spent, and the ledger says so by being empty rather than by
    // carrying a zero — a zero-dollar row is a figure in a table 019 T13a and
    // T15 are measured from (043 §8.1's reasoning, applied here).
    const rerank = await ownerPool.query(
      `SELECT count(*)::int AS n FROM llm_rerank WHERE scan_session_id = $1`,
      [sessionId]
    );
    const cost = await ownerPool.query(`SELECT count(*)::int AS n FROM cost_log WHERE shop_id = $1`, [
      shopId,
    ]);
    expect((rerank.rows[0] as { n: number }).n).toBe(0);
    expect((cost.rows[0] as { n: number }).n).toBe(0);

    // 042 §8.4's guard: every throttle event is counted from day one, and a
    // throttle that fires during normal pilot work is itself a 000-docs/006
    // finding.
    expect(limiter.events.meteredExhausted).toBe(before + 1);
  });

  it("the session stays workable: a manual confirmation is still accepted afterwards", async () => {
    const sessionId = await openSession();
    await inject({
      method: "POST",
      url: `${base}/${sessionId}/identify`,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    // 022 P1 puts the human in authority over identity, and the manual-search
    // route exists for exactly this. A ceiling that ended the session would be a
    // budget deciding whether a shop can price a book.
    const confirm = await inject({
      method: "POST",
      url: `${base}/${sessionId}/confirm`,
      // `manual_search` is the route the LOW band already uses — which is the
      // whole point: the ceiling drops the session onto a path that exists,
      // rather than inventing a degraded one (042 §8.3).
      payload: { issue: { title: "The Amazing Spider-Man", issue: "300" }, source: "manual_search" },
      headers: { "idempotency-key": randomUUID() },
    });
    expect(confirm.statusCode).toBe(201);
  });

  it("the ORDINARY class is untouched by the metered ceiling — they are two budgets", async () => {
    // 042 §8.2: only one of the two classes costs money. A shop out of model
    // budget can still open sessions, upload and confirm all day.
    await expect(openSession()).resolves.toBeTruthy();
  });
});

describe.skipIf(!dbUp)("the two ceilings are per OWNER, on one counter (050 §2 Q4(c))", () => {
  it("charges a service-account shop against the lower floor, and does not reset on a change of owner", () => {
    // Unit-shaped but stated here beside the behaviour it protects: the bucket
    // is keyed on the SHOP, so a shop that gains a credential mid-window does
    // not get a fresh higher budget on top of the Longbox money it already
    // spent. The owner selects the ceiling; it never resets the counter.
    const l = new ShopRateLimiter({ meteredPerDay: 5, serviceAccountPerDay: 2 });
    expect(l.takeMetered("shop-a", "longbox").allowed).toBe(true);
    expect(l.takeMetered("shop-a", "longbox").allowed).toBe(true);
    expect(l.takeMetered("shop-a", "longbox").allowed).toBe(false);
    // Now the same shop presents as `shop`-owned. The counter stands at 2 (the
    // refused call spent nothing), so it has THREE of its five left — not five.
    expect(l.takeMetered("shop-a", "shop").allowed).toBe(true);
    expect(l.takeMetered("shop-a", "shop").allowed).toBe(true);
    expect(l.takeMetered("shop-a", "shop").allowed).toBe(true);
    expect(l.takeMetered("shop-a", "shop").allowed).toBe(false);
  });
});
