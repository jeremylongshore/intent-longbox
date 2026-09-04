// L4 integration — 043 §11 I8, REWRITTEN at ratification to A3's fail-closed
// polarity, plus I9 (a crash between the call and the recording transaction
// ADOPTS the orphan rather than duplicating it).
//
// THE EMPTY-TABLE CASE IS FIRST. It is the case the pre-A3 draft would have
// PASSED, and it is the state of the world today: `listing_status_observation`
// has no producer (043 §1 E8; the watcher is E10-B05). A test file that ordered
// its cases happy-path-first would bury it.
//
// Bead: longbox-e5b.2.17 (E02-D07). Docs: 043 §4.1, §4.3, §4.5, §5.5, A3,
// §11 I8, I9; 022 P1; 033 B3; 019 T19.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import { createScanSession } from "../../src/services/scanSession.js";
import { claimBatch, DEFAULT_OUTBOX_PARAMS, drainOnce, enqueue } from "../../src/services/outbox.js";
import { buildConsumerRegistry } from "../../src/consumers/index.js";
import { DRAFT_REQUESTED } from "../../src/events/catalogue.js";
import type { ShopifyClient } from "../../src/services/shopify.js";
import { fakeShopifyClient } from "../fakes.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

const FAST = { ...DEFAULT_OUTBOX_PARAMS, attemptVisibilityMs: 500, backoffBaseMs: 200 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!dbUp)("the draft_requested job and its fail-closed guard (043 §4.3)", () => {
  let pool: pg.Pool;
  let shopId: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_e02d07_draft_guard");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: appUrl(url), max: 8 });
    shopId = await seedShop(pool, { name: "Draft Guard Shop" });
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** A session with the two facts the route's 409 gates require. */
  async function draftableSession(): Promise<string> {
    const sessionId = (await createScanSession(pool, shopId)).id;
    await pool.query(
      `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source)
       VALUES ($1,$2,$3,'one_tap')`,
      [sessionId, shopId, JSON.stringify({ title: "Uncanny X-Men", issue: "266", publisher: "Marvel" })]
    );
    await pool.query(
      `INSERT INTO pricing_snapshot (scan_session_id, shop_id, query, suggested_cents)
       VALUES ($1,$2,'x',4750)`,
      [sessionId, shopId]
    );
    return sessionId;
  }

  async function request(sessionId: string): Promise<string> {
    const res = await withTransaction(pool, (tx) =>
      enqueue(tx, { shopId, event: DRAFT_REQUESTED, scanSessionId: sessionId, authoredBy: "human" })
    );
    return res.id;
  }

  function registryWith(shopify: { client: ShopifyClient }) {
    return buildConsumerRegistry({
      resolveClient: async () => ({ client: shopify.client, stub: true }),
    });
  }

  const attempts = async (outboxId: string) =>
    (
      await pool.query(
        `SELECT kind, detail FROM outbox_attempt WHERE outbox_id = $1 ORDER BY created_at, id`,
        [outboxId]
      )
    ).rows as Array<{ kind: string; detail: { reason_code?: string } | null }>;

  const drafts = async (sessionId: string) =>
    (
      await pool.query(
        `SELECT id, product_gid, status, outbox_id FROM shopify_draft WHERE scan_session_id = $1`,
        [sessionId]
      )
    ).rows as Array<{ id: string; product_gid: string | null; status: string; outbox_id: string | null }>;

  it("(a) THE EMPTY-TABLE CASE: a prior draft and ZERO observations is REFUSED, not retried", async () => {
    // Unknown means do not touch. Before A3 this case PROCEEDED — and it is the
    // condition the guard exists for, because `productSet` UPDATES an existing
    // product and the builder hardcodes status: DRAFT, so proceeding against a
    // listing a human had since published would silently UN-PUBLISH it.
    const sessionId = await draftableSession();
    const shopify = fakeShopifyClient();

    // First job: creates the draft.
    await drainOnce(pool, registryWith(shopify), FAST, { shopId });
    const firstOutbox = await request(sessionId);
    await drainOnce(pool, registryWith(shopify), FAST, { shopId });
    expect((await attempts(firstOutbox)).map((a) => a.kind)).toEqual(["started", "delivered"]);
    expect(shopify.calls).toHaveLength(1);

    // Second job for the same copy, with nothing having observed the listing.
    const secondOutbox = await request(sessionId);
    await drainOnce(pool, registryWith(shopify), FAST, { shopId });

    const rows = await attempts(secondOutbox);
    expect(rows.map((a) => a.kind)).toEqual(["started", "dead_lettered"]);
    expect(rows[1]!.detail?.reason_code).toBe("no_observation_evidence");
    // NO PRODUCTSET CALL AT ALL. The refusal happens before the client is even
    // built, so a fail-closed guard costs a read and nothing else.
    expect(shopify.calls).toHaveLength(1);

    // And it is NEVER retried automatically (043 §5.5): a replay is a human act
    // with a record.
    await sleep(FAST.attemptVisibilityMs + 200);
    const reclaim = await claimBatch(pool, FAST, { shopId });
    expect(reclaim.map((c) => c.outboxId)).not.toContain(secondOutbox);
  });

  it("(b) an observation saying the listing LEFT draft is REFUSED as listing_left_draft", async () => {
    const sessionId = await draftableSession();
    const shopify = fakeShopifyClient();
    const firstOutbox = await request(sessionId);
    await drainOnce(pool, registryWith(shopify), FAST, { shopId });
    const draft = (await drafts(sessionId))[0]!;

    await pool.query(
      `INSERT INTO listing_status_observation (shop_id, shopify_draft_id, observed_status, source)
       VALUES ($1,$2,'published','watcher')`,
      [shopId, draft.id]
    );

    const secondOutbox = await request(sessionId);
    await drainOnce(pool, registryWith(shopify), FAST, { shopId });
    const rows = await attempts(secondOutbox);
    expect(rows[rows.length - 1]!.kind).toBe("dead_lettered");
    expect(rows[rows.length - 1]!.detail?.reason_code).toBe("listing_left_draft");
    expect(shopify.calls).toHaveLength(1); // the human's published listing is untouched
    expect(firstOutbox).not.toBe(secondOutbox);
  });

  it("(c) positive evidence — an observation saying `draft` — lets the retry proceed", async () => {
    // This is what E10-B05's watcher BUYS: with it, the safe retries proceed
    // automatically instead of dead-lettering. It is what makes the guard
    // useful; it is not what makes it safe (043 A3).
    const sessionId = await draftableSession();
    const shopify = fakeShopifyClient();
    await request(sessionId);
    await drainOnce(pool, registryWith(shopify), FAST, { shopId });
    const draft = (await drafts(sessionId))[0]!;

    await pool.query(
      `INSERT INTO listing_status_observation (shop_id, shopify_draft_id, observed_status, source)
       VALUES ($1,$2,'draft','watcher')`,
      [shopId, draft.id]
    );

    const secondOutbox = await request(sessionId);
    await drainOnce(pool, registryWith(shopify), FAST, { shopId });
    expect((await attempts(secondOutbox)).map((a) => a.kind)).toEqual(["started", "delivered"]);
    expect(shopify.calls).toHaveLength(2);
    // ...and the UPSERT means the second call resolved to the SAME product.
    expect(new Set(shopify.products.values()).size).toBe(1);
  });

  it("(d) no prior draft at all: the job runs, because there is nothing to un-publish", async () => {
    const sessionId = await draftableSession();
    const shopify = fakeShopifyClient();
    const outboxId = await request(sessionId);
    await drainOnce(pool, registryWith(shopify), FAST, { shopId });

    expect((await attempts(outboxId)).map((a) => a.kind)).toEqual(["started", "delivered"]);
    const rows = await drafts(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("draft");
    // The job reference is what makes the recording idempotent by CONSTRAINT.
    expect(rows[0]!.outbox_id).toBe(outboxId);
    // The copy key is the copy: the fake upserts on it, as productSet does.
    expect(shopify.calls).toEqual([sessionId]);
  });

  it("I9: a crash between the productSet call and the recording transaction ADOPTS the orphan", async () => {
    // THE BEAD'S OWN E02-D04 OBLIGATION, CONSTRUCTED. Kill the worker after
    // createDraft returns and before the recording commit; let the visibility
    // window expire; assert the retry produces ONE product (the upsert matched)
    // and ONE shopify_draft row.
    const sessionId = await draftableSession();
    const outboxId = await request(sessionId);
    const shopify = fakeShopifyClient();

    // Attempt 1: the process dies immediately after the provider call returns.
    let died = false;
    const crashing = fakeShopifyClient({
      onCall: () => {
        died = true;
      },
    });
    // Share one product map so the "same store" survives the crash.
    crashing.products.set(sessionId, "gid://shopify/Product/orphan");
    const registry = buildConsumerRegistry({
      resolveClient: async () => ({
        client: {
          async createDraft(input) {
            // The provider call SUCCEEDS — the product now exists in the store —
            // and the process dies before anything records it. That is the
            // orphan, constructed rather than hoped for.
            await crashing.client.createDraft(input);
            throw new Error("worker killed after the Shopify call returned");
          },
        },
        stub: true,
      }),
    });
    await drainOnce(pool, registry, FAST, { shopId });
    expect(died).toBe(true);
    expect(await drafts(sessionId)).toHaveLength(0); // the orphan: a product, no row

    // Attempt 2, after the backoff: the SAME copy key upserts onto the orphan.
    await sleep(Math.ceil(FAST.backoffBaseMs * 1.5) + 250);
    shopify.products.set(sessionId, "gid://shopify/Product/orphan");
    await drainOnce(pool, registryWith(shopify), FAST, { shopId });

    const rows = await drafts(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.product_gid).toBe("gid://shopify/Product/orphan");
    expect(crashing.products.size).toBe(1); // ONE product in the store, not two
    const kinds = (await attempts(outboxId)).map((a) => a.kind);
    expect(kinds).toEqual(["started", "failed", "started", "delivered"]);
  });

  it("a PERMANENT provider error dead-letters on attempt 1 with no backoff (043 §5.2)", async () => {
    const sessionId = await draftableSession();
    const outboxId = await request(sessionId);
    const shopify = fakeShopifyClient({ fail: { status: 200, permanent: true } });
    await drainOnce(pool, registryWith(shopify), FAST, { shopId });

    const rows = await attempts(outboxId);
    expect(rows.map((a) => a.kind)).toEqual(["started", "dead_lettered"]);
    expect(rows[1]!.detail?.reason_code).toBe("permanent_provider_error");
    // No shopify_draft row on a failure: a failed call created nothing, and a
    // row saying otherwise would be a listing this system believes in and
    // Shopify has never heard of (043 §4.1).
    expect(await drafts(sessionId)).toHaveLength(0);
  });

  it("a transient provider error is `failed`, retried, and dead-letters at the ceiling", async () => {
    const sessionId = await draftableSession();
    const outboxId = await request(sessionId);
    const shopify = fakeShopifyClient({ fail: { status: 502 } });
    const params = { ...FAST, maxAttempts: 2, backoffBaseMs: 100 };

    await drainOnce(pool, registryWith(shopify), params, { shopId });
    await sleep(Math.ceil(params.backoffBaseMs * 1.5) + 200);
    await drainOnce(pool, registryWith(shopify), params, { shopId });

    const rows = await attempts(outboxId);
    expect(rows.map((a) => a.kind)).toEqual(["started", "failed", "started", "dead_lettered"]);
    expect(rows[3]!.detail?.reason_code).toBe("attempt_ceiling_reached");
  });

  it("the dead-letter VIEW separates a guard refusal from a provider failure (043 A5)", async () => {
    const rows = (
      await pool.query(
        `SELECT reason_code, guard_refusal FROM outbox_dead_letter WHERE shop_id = $1 ORDER BY dead_lettered_at`,
        [shopId]
      )
    ).rows as Array<{ reason_code: string; guard_refusal: boolean }>;

    // A dead letter from a Shopify 500 is a provider problem and belongs in 019
    // T17's "declared provider outage" arithmetic. A dead letter carrying
    // 'listing_left_draft' or 'no_observation_evidence' is the guard WORKING.
    // Counted together, a guard doing its job reads as a reliability problem and
    // a reliability problem reads as a guard doing its job.
    const guardRows = rows.filter((r) => r.guard_refusal);
    expect(guardRows.map((r) => r.reason_code).sort()).toEqual([
      "listing_left_draft",
      "no_observation_evidence",
    ]);
    expect(
      rows
        .filter((r) => !r.guard_refusal)
        .map((r) => r.reason_code)
        .sort()
    ).toEqual(["attempt_ceiling_reached", "permanent_provider_error"]);
  });
});
