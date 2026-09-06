// L4 integration — E03-B08: what a SECOND delivery does, what a LATE one does,
// and what the three topics Shopify requires an app to handle actually produce.
//
// Bead: longbox-e5b.3.8 (alias E03-B08). Docs: 000-docs/064 §4 (replay), §5
// (ordering), §6 (the workflow), §7 (the job and its guard); 053 §5.5, §7.3, §9;
// 043 §3.2, §5.4; 041 §8.4; 022 P3; 019 T24, T32; migration 038.
//
// THE ORDER OF THIS FILE IS THE ARGUMENT. The three REFUSALS come first —
// same-id redelivery, same-body-different-id replay, and a message older than
// the window — because each is a case the subsystem answered wrongly or not at
// all before this bead, and a file that led with the happy path would bury them.
//
// WHY IT RUNS AS THE APP ROLE (E02-D06's argument, borrowed whole): the
// connection the server holds owns nothing, so an append-only refusal seen from
// here is the trigger refusing rather than a grant.
import { createHash, createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceDb, withTransaction } from "../../src/db.js";
import { PRIVACY_REQUEST_RECEIVED } from "../../src/events/catalogue.js";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import {
  CONNECTOR,
  receiveWebhook,
  requireConnectorKey,
  type ConnectorDeps,
  type ShopifyAppCredentials,
} from "../../src/services/connectors/shopify/index.js";
import { introduceTokenVersion } from "../../src/services/connectors/shopify/custody.js";
import { ShopRateLimiter } from "../../src/services/rateLimit.js";
import { DEFAULT_OUTBOX_PARAMS, drainOnce, enqueue } from "../../src/services/outbox.js";
import { buildConsumerRegistry } from "../../src/consumers/index.js";
import { outstandingPrivacyRequests, privacyRequestCounts } from "../../src/services/privacy.js";
import { TEST_CONNECTOR_KEY_V1 } from "../testConfig.js";

const dbUp = await probeDb();

const DB = "longbox_test_webhook_replay_privacy";
const STORE = "gothamreplay.myshopify.com";
/** Fixture credentials. E03-D04's convention: `test-…-key`, tests/ only. */
const APP_SECRET = "test-shopify-app-secret-key";
const ACCESS_TOKEN = "test-shopify-access-token-key";

const APP: ShopifyAppCredentials = {
  clientId: "test-client-id",
  clientSecret: APP_SECRET,
  redirectUri: "https://longbox.example/api/v1/connectors/shopify/callback",
  apiVersion: "2025-07",
};

const FAST = { ...DEFAULT_OUTBOX_PARAMS, attemptVisibilityMs: 500, backoffBaseMs: 200 };

describe.skipIf(!dbUp)("webhook replay, ordering and the privacy workflow (000-docs/064)", () => {
  let pool: pg.Pool;
  let ownerPool: pg.Pool;
  let shopId: string;
  let deps: ConnectorDeps;

  const shopQuery = (sql: string, values?: unknown[]): Promise<pg.QueryResult> =>
    asShop(pool, shopId).query(sql, values);

  /**
   * The reads that are about the SUBSYSTEM rather than about one shop. A receipt
   * and a privacy request may both carry a NULL `shop_id` by design (053 §5.5),
   * so a test that counts the whole subsystem asks the same cross-tenant question
   * the production path does, and says so.
   */
  const inboundQuery = (sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> =>
    serviceDb(pool, "connector-inbound").query(sql, values);

  /** One signed delivery. Headers are chosen by the CALLER, which is the point. */
  async function deliver(opts: {
    topic: string;
    body: string;
    webhookId?: string;
    triggeredAt?: Date;
    shopDomain?: string;
  }) {
    const raw = Buffer.from(opts.body, "utf8");
    return receiveWebhook(
      deps,
      {
        topic: opts.topic,
        hmac: createHmac("sha256", APP_SECRET).update(raw).digest("base64"),
        shopDomain: opts.shopDomain ?? STORE,
        webhookId: opts.webhookId ?? randomUUID(),
        apiVersion: "2025-07",
        triggeredAt: opts.triggeredAt?.toISOString(),
      },
      raw
    );
  }

  async function countRows(table: string): Promise<number> {
    const res = await inboundQuery(`SELECT count(*)::int AS n FROM ${table}`);
    return (res.rows[0] as { n: number }).n;
  }

  const ring = () => requireConnectorKey({ LONGBOX_CONNECTOR_KEY_V1: TEST_CONNECTOR_KEY_V1 });

  /** Introduce a live token version for the store, with the scopes given. */
  async function introduce(
    versionNo: number,
    scopes: readonly string[] = ["write_products", "read_products"],
    forShopId: string = shopId,
    forStore: string = STORE
  ): Promise<string> {
    return introduceTokenVersion(asShop(pool, forShopId), ring(), {
      shopId: forShopId,
      connector: CONNECTOR,
      versionNo,
      shopDomain: forStore,
      accessToken: ACCESS_TOKEN,
      grantedScopes: scopes,
      installStateId: null,
      authoredBy: "human",
    });
  }

  beforeAll(async () => {
    const migrateUrl = await createFreshDb(DB);
    await runMigrations(migrateUrl);
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Gotham Replay", slug: "gothamreplay" });
    deps = {
      pool,
      limiter: new ShopRateLimiter(),
      app: APP,
      keyring: requireConnectorKey({ LONGBOX_CONNECTOR_KEY_V1: TEST_CONNECTOR_KEY_V1 }),
      // A one-hour window and NO skew band, so the lane can construct "one second
      // outside" instead of waiting two days, and can put a token on the far side
      // of an event time without editing an append-only `created_at`.
      webhookWindowSeconds: 3600,
      webhookClockSkewSeconds: 0,
    };
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await ownerPool?.end();
  });

  // ── REFUSAL 1: the provider's own at-least-once delivery ──────────────────
  it("answers a same-id redelivery idempotently: one receipt, one request, zero extra effects", async () => {
    const body = JSON.stringify({ shop_domain: STORE, customer: { id: 1 }, note: "same-id" });
    const webhookId = randomUUID();
    const first = await deliver({ topic: "customers/data_request", body, webhookId });
    const before = await countRows("privacy_request");

    const second = await deliver({ topic: "customers/data_request", body, webhookId });

    expect(second.acknowledged).toBe(true);
    expect(second.duplicate).toBe(true);
    // The SAME receipt, not a second one: the row the UNIQUE already held.
    expect(second.receiptId).toBe(first.receiptId);
    const receipts = await inboundQuery(
      `SELECT count(*)::int AS n FROM connector_webhook_receipt WHERE webhook_id = $1`,
      [webhookId]
    );
    expect((receipts.rows[0] as { n: number }).n).toBe(1);
    expect(await countRows("privacy_request")).toBe(before);
  });

  // ── REFUSAL 2: a deliberate replay, which the id header CANNOT catch ──────
  it("refuses a replay of the same BYTES under a fresh id, and records it as a fact", async () => {
    // THE ADVERSARY THIS CASE IS ABOUT. The HMAC covers the body and not the
    // headers, so anyone holding one captured message can send it again with any
    // `X-Shopify-Webhook-Id` they like. `UNIQUE (connector, webhook_id)` sees a
    // first delivery and lets it through — which, on `app/uninstalled`, means
    // killing a token the merchant re-installed.
    const body = JSON.stringify({ shop_domain: STORE, customer: { id: 2 }, note: "captured" });
    await deliver({ topic: "customers/redact", body });
    const requestsBefore = await countRows("privacy_request");

    const replay = await deliver({ topic: "customers/redact", body, webhookId: randomUUID() });

    // Acknowledged, because telling the caller anything else is an oracle — and
    // RECORDED, because a message this system silently discarded is the failure
    // 053 §9 exists to prevent.
    expect(replay.acknowledged).toBe(true);
    expect(replay.duplicate).toBe(false);
    expect(replay.disposition).toBe("replayed_body");
    const receipt = await inboundQuery(`SELECT disposition FROM connector_webhook_receipt WHERE id = $1`, [
      replay.receiptId,
    ]);
    expect((receipt.rows[0] as { disposition: string }).disposition).toBe("replayed_body");
    // ZERO EFFECTS: no second obligation, and therefore no second job.
    expect(await countRows("privacy_request")).toBe(requestsBefore);
  });

  // ── REFUSAL 3: an old-but-valid message ──────────────────────────────────
  it("refuses a message older than the receipt window, with its own receipt kind", async () => {
    const body = JSON.stringify({ shop_domain: STORE, note: "very late", n: randomUUID() });
    const requestsBefore = await countRows("privacy_request");

    const stale = await deliver({
      topic: "customers/data_request",
      body,
      // One second outside a one-hour window.
      triggeredAt: new Date(Date.now() - 3601 * 1000),
    });

    expect(stale.disposition).toBe("stale");
    const receipt = await inboundQuery(
      `SELECT disposition, triggered_at FROM connector_webhook_receipt WHERE id = $1`,
      [stale.receiptId]
    );
    const row = receipt.rows[0] as { disposition: string; triggered_at: Date | null };
    expect(row.disposition).toBe("stale");
    // The stated event time is KEPT on the refused row: without it the refusal is
    // unexplainable after the fact.
    expect(row.triggered_at).not.toBeNull();
    expect(await countRows("privacy_request")).toBe(requestsBefore);
  });

  it("accepts a message INSIDE the window whose bytes nobody has seen", async () => {
    const body = JSON.stringify({ shop_domain: STORE, note: "fresh", n: randomUUID() });
    const fresh = await deliver({
      topic: "customers/data_request",
      body,
      triggeredAt: new Date(Date.now() - 60 * 1000),
    });
    expect(fresh.disposition).toBe("accepted");
    expect(fresh.privacyRequestId).toBeDefined();
  });

  // ── ORDERING: the uninstall is EVENT-TIME BOUNDED ────────────────────────
  it("an uninstall retires the tokens that existed when it happened, and not a later re-install's", async () => {
    // The sequence, which is the whole reason the bound exists: uninstall at T1
    // while this endpoint is unreachable; re-install at T2; the provider's retry
    // finally lands at T3. Before this bead the retry killed the FRESH token, and
    // the receipt's UNIQUE could not see it — that delivery carries an id nothing
    // has seen.
    await introduce(1);
    // T1 — the moment the merchant uninstalled.
    const uninstalledAt = new Date();
    await new Promise((r) => setTimeout(r, 50));
    // T2 — the re-install, strictly after T1.
    const reinstalledId = await introduce(2);

    const outcome = await deliver({
      topic: "app/uninstalled",
      // `myshopify_domain` and not `domain`: since F1 the store comes from the
      // SIGNED BODY and the header is checked against it, so a payload whose shape
      // this build cannot read gets `unknown` and the DESTRUCTIVE effect is refused.
      body: JSON.stringify({ id: 42, myshopify_domain: STORE, at: uninstalledAt.toISOString() }),
      triggeredAt: uninstalledAt,
    });

    expect(outcome.disposition).toBe("accepted");
    const retiredVersions = outcome.retired.map((r) => r.version_no).sort();
    expect(retiredVersions).toEqual([1]);
    const live = await shopQuery(
      `SELECT v.version_no FROM connector_token_version v
         LEFT JOIN connector_token_retirement r ON r.connector_token_version_id = v.id
        WHERE v.id = $1 AND r.id IS NULL`,
      [reinstalledId]
    );
    expect(live.rowCount).toBe(1);
  });

  it("with NO stated event time, an uninstall still ends every live version", async () => {
    // The conservative direction under a missing header, asserted rather than
    // assumed: a shop that must re-install has a remedy; a token this system
    // believes is live after Shopify killed it is a credential nobody manages.
    await introduce(3);
    const outcome = await deliver({
      topic: "app/uninstalled",
      body: JSON.stringify({ id: 43, myshopify_domain: STORE, n: randomUUID() }),
    });
    const stillLive = await shopQuery(
      `SELECT count(*)::int AS n FROM connector_token_version v
         LEFT JOIN connector_token_retirement r ON r.connector_token_version_id = v.id
        WHERE v.shop_domain = $1 AND r.id IS NULL`,
      [STORE]
    );
    expect(outcome.retired.length).toBeGreaterThan(0);
    expect((stillLive.rows[0] as { n: number }).n).toBe(0);
  });

  // ── THE PRIVACY WORKFLOW ─────────────────────────────────────────────────
  it("records an obligation with a clock, and holds NO payload and NO customer identifier", async () => {
    const secret = "customer-email-that-must-not-be-stored@example.test";
    const body = JSON.stringify({ shop_domain: STORE, customer: { email: secret }, n: randomUUID() });
    const outcome = await deliver({ topic: "customers/redact", body });

    const stored = await inboundQuery(`SELECT to_jsonb(r) AS row FROM privacy_request r WHERE id = $1`, [
      outcome.privacyRequestId,
    ]);
    const whole = JSON.stringify((stored.rows[0] as { row: unknown }).row);
    // Every column of the row, searched for the value the message carried. A
    // future ALTER TABLE adding a "subject" column fails here rather than in a
    // review (041 §8.4).
    expect(whole).not.toContain(secret);
    expect(whole).toContain(createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex"));

    const receipt = await inboundQuery(
      `SELECT to_jsonb(w) AS row FROM connector_webhook_receipt w WHERE id = $1`,
      [outcome.receiptId]
    );
    expect(JSON.stringify((receipt.rows[0] as { row: unknown }).row)).not.toContain(secret);
  });

  it("gives the two customer topics a job, and `shop/redact` none", async () => {
    const customerBody = JSON.stringify({ shop_domain: STORE, customer: { id: 7 }, n: randomUUID() });
    const customer = await deliver({ topic: "customers/data_request", body: customerBody });
    const jobs = await shopQuery(
      `SELECT event FROM outbox WHERE ref_table = 'privacy_request' AND ref_id = $1`,
      [customer.privacyRequestId]
    );
    expect(jobs.rowCount).toBe(1);
    expect((jobs.rows[0] as { event: string }).event).toBe("longbox.platform.privacy_request_received");

    const shopBody = JSON.stringify({ shop_domain: STORE, shop_id: 9, n: randomUUID() });
    const shopRedact = await deliver({ topic: "shop/redact", body: shopBody });
    // The FACT is recorded and the JOB is not: this bead performs no deletion,
    // and a consumer registered to do nothing would be a green delivery that
    // answered nobody. E03-B09 owns the procedure.
    expect(shopRedact.privacyRequestId).toBeDefined();
    const none = await shopQuery(
      `SELECT count(*)::int AS n FROM outbox WHERE ref_table = 'privacy_request' AND ref_id = $1`,
      [shopRedact.privacyRequestId]
    );
    expect((none.rows[0] as { n: number }).n).toBe(0);
  });

  it("drains the job to a `no_data_held` fulfilment, and a re-drain writes no second one", async () => {
    const body = JSON.stringify({ shop_domain: STORE, customer: { id: 11 }, n: randomUUID() });
    const outcome = await deliver({ topic: "customers/data_request", body });

    const drained = await drainOnce(pool, buildConsumerRegistry(), FAST, { shopId });
    expect(drained.delivered).toBeGreaterThanOrEqual(1);

    const answered = await shopQuery(
      `SELECT outcome, method, authored_by, operator_id FROM privacy_request_fulfilment
        WHERE privacy_request_id = $1`,
      [outcome.privacyRequestId]
    );
    expect(answered.rowCount).toBe(1);
    const row = answered.rows[0] as {
      outcome: string;
      method: string;
      authored_by: string;
      operator_id: string | null;
    };
    expect(row.outcome).toBe("no_data_held");
    expect(row.method).toBe("scope_policy");
    expect(row.authored_by).toBe("system");
    // A machine answer never names a person — the CHECK enforces it, and this is
    // the assertion that the CHECK is doing something.
    expect(row.operator_id).toBeNull();

    // A second drain finds nothing due; a direct second consumer run is covered
    // by the parametric concurrent-duplicate test, which iterates the registry.
    await drainOnce(pool, buildConsumerRegistry(), FAST, { shopId });
    const still = await shopQuery(
      `SELECT count(*)::int AS n FROM privacy_request_fulfilment WHERE privacy_request_id = $1`,
      [outcome.privacyRequestId]
    );
    expect((still.rows[0] as { n: number }).n).toBe(1);
  });

  it("REFUSES to answer automatically for a store whose grant could reach a customer", async () => {
    // A second shop, so the guard is exercised on a store this suite's own shop
    // does not hold — and because the first shop's tokens are retired by the
    // uninstall cases above.
    const otherShopId = await seedShop(ownerPool, { name: "Guarded Shop", slug: "guardedshop" });
    const otherStore = "guardedshop.myshopify.com";
    // A scope this connector never requests. If a store's RECORDED grant ever
    // carries one, `no_data_held` stops being a claim this system can check — and
    // unknown means do not touch (043 A3, one subsystem over).
    await introduce(1, ["write_products", "read_products", "read_customers"], otherShopId, otherStore);

    const body = JSON.stringify({ shop_domain: otherStore, customer: { id: 13 }, n: randomUUID() });
    const outcome = await deliver({ topic: "customers/redact", body, shopDomain: otherStore });
    expect(outcome.privacyRequestId).toBeDefined();

    await drainOnce(pool, buildConsumerRegistry(), FAST, { shopId: otherShopId });

    const fulfilment = await asShop(pool, otherShopId).query(
      `SELECT count(*)::int AS n FROM privacy_request_fulfilment WHERE privacy_request_id = $1`,
      [outcome.privacyRequestId]
    );
    // NO automatic answer. The obligation stays outstanding and a person decides.
    expect((fulfilment.rows[0] as { n: number }).n).toBe(0);

    // …and the refusal is visible where a human looks, flagged as a GUARD rather
    // than counted as a provider failure (043 A5, §5.4).
    const dead = await asShop(pool, otherShopId).query(
      `SELECT reason_code, guard_refusal FROM outbox_dead_letter WHERE ref_id = $1`,
      [outcome.privacyRequestId]
    );
    expect(dead.rowCount).toBe(1);
    const letter = dead.rows[0] as { reason_code: string; guard_refusal: boolean };
    expect(letter.reason_code).toBe("customer_scope_was_granted");
    expect(letter.guard_refusal).toBe(true);
  });

  // ── THE DETECTOR ─────────────────────────────────────────────────────────
  it("counts by topic and outcome, and finds an overdue request", async () => {
    // Stamped in the past by the SCHEMA OWNER, because `due_at` is computed at
    // insert from a window measured in days and no test waits that long. The
    // owner is the role the audit itself runs as (`ENABLE`, not `FORCE`).
    const receipt = await ownerPool.query(
      `INSERT INTO connector_webhook_receipt
         (shop_id, connector, topic, webhook_id, shop_domain, payload_digest, payload_bytes)
       VALUES ($1, 'shopify', 'shop/redact', $2, $3, $4, 12) RETURNING id`,
      [shopId, randomUUID(), STORE, createHash("sha256").update("overdue").digest("hex")]
    );
    const receiptId = (receipt.rows[0] as { id: string }).id;
    await ownerPool.query(
      `INSERT INTO privacy_request
         (shop_id, connector, topic, webhook_id, webhook_receipt_id, shop_domain, payload_digest,
          received_at, due_at)
       VALUES ($1, 'shopify', 'shop/redact', $2, $3, $4, $5, now() - interval '60 days',
               now() - interval '35 days')`,
      [shopId, randomUUID(), receiptId, STORE, createHash("sha256").update("overdue").digest("hex")]
    );

    const outstanding = await outstandingPrivacyRequests(ownerPool);
    expect(outstanding.some((r) => r.overdue)).toBe(true);

    const counts = await privacyRequestCounts(ownerPool);
    expect(counts.length).toBeGreaterThan(0);
    // The audit's shape: topics and outcomes and numbers. Nothing here is a
    // person, and nothing here could be — the tables hold no subject column.
    for (const bucket of counts) {
      expect(typeof bucket.requests).toBe("number");
      expect(Object.keys(bucket).sort()).toEqual(["outcome", "requests", "topic"]);
    }
  });

  // ══ THE CANNON'S THREE, beside I4 / I5 / I10 (F7) ═══════════════════════
  it("F1: a captured message re-addressed at another tenant is refused, with ZERO rows", async () => {
    // THE CRITICAL FINDING, as the probe that produced it. `X-Shopify-Shop-Domain`
    // is outside the HMAC, so one captured signed message from ANY store — the
    // isolated dev store this bead names as its own closing evidence will do —
    // retired an unrelated shop's live token and wrote a forged privacy obligation
    // under that shop's tenant. Both halves are constructed here.
    const victimVersion = await introduce(9, ["write_products", "read_products"], shopId, STORE);
    const before = {
      receipts: await countRows("connector_webhook_receipt"),
      requests: await countRows("privacy_request"),
      retirements: await countRows("connector_token_retirement"),
    };

    // (a) the destructive half: a signed uninstall for ANOTHER store, delivered
    //     with this shop's domain in the header.
    await expect(
      deliver({
        topic: "app/uninstalled",
        body: JSON.stringify({ id: 99, myshopify_domain: "attackercapture.myshopify.com" }),
        shopDomain: STORE,
      })
    ).rejects.toThrow();

    // (b) the cross-tenant WRITE half: a signed `customers/redact` for another
    //     store, delivered with this shop's domain — 019 T24's shape, reached with
    //     no credential at all.
    await expect(
      deliver({
        topic: "customers/redact",
        body: JSON.stringify({ shop_domain: "attackercapture.myshopify.com", customer: { id: 1 } }),
        shopDomain: STORE,
      })
    ).rejects.toThrow();

    // ZERO rows from both. The refusal is at the pre-transaction branch, so it
    // costs one HMAC and one JSON.parse.
    expect(await countRows("connector_webhook_receipt")).toBe(before.receipts);
    expect(await countRows("privacy_request")).toBe(before.requests);
    expect(await countRows("connector_token_retirement")).toBe(before.retirements);
    const stillLive = await shopQuery(
      `SELECT count(*)::int AS n FROM connector_token_version v
         LEFT JOIN connector_token_retirement r ON r.connector_token_version_id = v.id
        WHERE v.id = $1 AND r.id IS NULL`,
      [victimVersion]
    );
    expect((stillLive.rows[0] as { n: number }).n).toBe(1);
  });

  it("F1: a payload shape this build cannot read is RECORDED and retires nothing", async () => {
    // `TOPIC_DOMAIN_FIELD` is an ASSUMPTION about a third party's payload
    // (064 §0 A4). A wrong guess must degrade to "a token was not retired", never
    // to "the wrong shop's token was" — so the message is still acknowledged and
    // still recorded, and only the DESTRUCTIVE effect is refused.
    const liveId = await introduce(10);
    const outcome = await deliver({
      topic: "app/uninstalled",
      // No `myshopify_domain` anywhere: the shape this build reads is absent.
      body: JSON.stringify({ id: 100, unexpected_shape: STORE, n: randomUUID() }),
    });
    expect(outcome.acknowledged).toBe(true);
    expect(outcome.disposition).toBe("accepted");
    expect(outcome.retired).toEqual([]);
    const live = await shopQuery(
      `SELECT count(*)::int AS n FROM connector_token_version v
         LEFT JOIN connector_token_retirement r ON r.connector_token_version_id = v.id
        WHERE v.id = $1 AND r.id IS NULL`,
      [liveId]
    );
    expect((live.rows[0] as { n: number }).n).toBe(1);
  });

  it("F-A: an unreadable COMPLIANCE payload attributes NO tenant, and enqueues nothing", async () => {
    // The security re-check's finding 1, as its probe. v1.1.0 gated the
    // RETIREMENT on `agrees` and left the TENANT keyed on the header — so on the
    // three compliance topics an unreadable payload still wrote a
    // `privacy_request` under the shop the UNSIGNED header named, with a job
    // behind it. The F1 repair was off for the privacy half while the record read
    // as though it were on, which is exactly the condition §0 A4's "worst
    // outcome" sentences exist to bound.
    const before = await shopQuery(`SELECT count(*)::int AS n FROM privacy_request WHERE shop_id = $1`, [
      shopId,
    ]);
    const outcome = await deliver({
      topic: "customers/redact",
      // No `shop_domain` and no `myshopify_domain`: nothing this build reads.
      body: JSON.stringify({ customer: { id: 77 }, unexpected_shape: STORE, n: randomUUID() }),
      // …and the victim named in the header, which is the whole attack.
      shopDomain: STORE,
    });

    // RECORDED — never silently dropped (053 §9).
    expect(outcome.acknowledged).toBe(true);
    expect(outcome.disposition).toBe("accepted");
    expect(outcome.privacyRequestId).toBeDefined();

    // …with a NULL tenant, which is R2's bucket: on the clock, counted by the
    // audit as unresolved-tenant, and attributed to nobody.
    const row = await inboundQuery(`SELECT shop_id FROM privacy_request WHERE id = $1`, [
      outcome.privacyRequestId,
    ]);
    expect((row.rows[0] as { shop_id: string | null }).shop_id).toBeNull();

    // The victim's obligation count is UNCHANGED.
    const after = await shopQuery(`SELECT count(*)::int AS n FROM privacy_request WHERE shop_id = $1`, [
      shopId,
    ]);
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);

    // …and ZERO jobs, because the enqueue requires a tenant.
    const jobs = await inboundQuery(
      `SELECT count(*)::int AS n FROM outbox WHERE ref_table = 'privacy_request' AND ref_id = $1`,
      [outcome.privacyRequestId]
    );
    expect((jobs.rows[0] as { n: number }).n).toBe(0);
  });

  it("R7: two CONCURRENT deliveries of one body produce ONE obligation", async () => {
    // The advisory lock, TESTED rather than asserted (the gate re-audit's note on
    // R7). Two real connections, one body, both in flight: without the lock
    // neither sees the other's uncommitted receipt, both classify `accepted`,
    // both carry a different `webhook_id`, and TWO independently-clocked
    // obligations exist for one message. `consumer-idempotency` races the
    // CONSUMER; this races classify-and-insert, which is a different seam.
    const body = JSON.stringify({ shop_domain: STORE, customer: { id: 31 }, n: randomUUID() });
    const [a, b] = await Promise.all([
      deliver({ topic: "customers/redact", body }),
      deliver({ topic: "customers/redact", body }),
    ]);

    // Both are acknowledged — the wire answer is constant — and exactly one ran
    // its effects.
    expect([a.disposition, b.disposition].sort()).toEqual(["accepted", "replayed_body"]);
    const digest = createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex");
    const obligations = await inboundQuery(
      `SELECT count(*)::int AS n FROM privacy_request WHERE payload_digest = $1`,
      [digest]
    );
    expect((obligations.rows[0] as { n: number }).n).toBe(1);
    // …and BOTH deliveries are recorded, because a refusal is a fact (053 §9).
    const receipts = await inboundQuery(
      `SELECT count(*)::int AS n FROM connector_webhook_receipt WHERE payload_digest = $1`,
      [digest]
    );
    expect((receipts.rows[0] as { n: number }).n).toBe(2);
  });

  it("F2: a FUTURE stated event time does not push the uninstall's reach forward", async () => {
    // The probe: `triggered_at` in 2030 on a captured uninstall. Before the fix
    // the message was never stale (the only test was `now - triggeredAt >
    // window`) AND the cutoff became 2030 — retiring every version this shop
    // would ever have, which is Decision B disabled for exactly the adversary it
    // was written against.
    const before = await introduce(11);
    const outcome = await deliver({
      topic: "app/uninstalled",
      body: JSON.stringify({ id: 101, myshopify_domain: STORE, n: randomUUID() }),
      triggeredAt: new Date("2030-01-01T00:00:00.000Z"),
    });
    expect(outcome.disposition).toBe("accepted");
    // The stated time is UNUSABLE, so the cutoff is `undefined` and the uninstall
    // behaves as one with no stated time at all: it ends what is live NOW, and
    // nothing introduced after it. What it must NOT do is reach into the future.
    const later = await introduce(12);
    const laterLive = await shopQuery(
      `SELECT count(*)::int AS n FROM connector_token_version v
         LEFT JOIN connector_token_retirement r ON r.connector_token_version_id = v.id
        WHERE v.id = $1 AND r.id IS NULL`,
      [later]
    );
    expect((laterLive.rows[0] as { n: number }).n).toBe(1);
    expect(outcome.retired.map((r) => r.version_no)).toContain(11);
    expect(before).toBeDefined();
  });

  it("F4: a store with NO recorded grant is REFUSED rather than answered vacuously", async () => {
    // ⚠ **THE JOB IS CONSTRUCTED BY HAND, and that is the finding rather than a
    // shortcut.** Since F-A a store with no recorded grant resolves to a NULL
    // tenant, and the producer enqueues nothing without one — so this branch is
    // UNREACHABLE from the shipped producer, and R1 is *stated with a
    // defence-in-depth branch* rather than *self-enforcing*, which is what the
    // record said at v1.1.0 and no longer says. The branch is kept because a
    // future producer (E16-B02's cutover, a re-drive) can reach it.
    //
    // The shop is real and the store is one it has NO connector version for — the
    // legacy static path, which is the PILOT. Before the fix the empty scope set
    // satisfied *no customer scope was granted* vacuously and the job wrote
    // `no_data_held`: a record indistinguishable from a real check, and a stated
    // residual (R1) that nothing could detect.
    const ungrantedShop = await seedShop(ownerPool, { name: "Static Path Shop", slug: "staticpath" });
    const receipt = await ownerPool.query(
      `INSERT INTO connector_webhook_receipt
         (shop_id, connector, topic, webhook_id, shop_domain, payload_digest, payload_bytes)
       VALUES ($1,'shopify','customers/redact',$2,'staticpath.myshopify.com',$3,10) RETURNING id`,
      [ungrantedShop, randomUUID(), createHash("sha256").update("f4").digest("hex")]
    );
    const request = await ownerPool.query(
      `INSERT INTO privacy_request
         (shop_id, connector, topic, webhook_id, webhook_receipt_id, shop_domain, payload_digest, due_at)
       VALUES ($1,'shopify','customers/redact',$2,$3,'staticpath.myshopify.com',$4,
               now() + interval '25 days')
       RETURNING id`,
      [
        ungrantedShop,
        randomUUID(),
        (receipt.rows[0] as { id: string }).id,
        createHash("sha256").update("f4").digest("hex"),
      ]
    );
    const requestId = (request.rows[0] as { id: string }).id;
    await withTransaction(
      pool,
      (tx) =>
        enqueue(tx, {
          shopId: ungrantedShop,
          event: PRIVACY_REQUEST_RECEIVED,
          refTable: "privacy_request",
          refId: requestId,
          authoredBy: "provider",
        }),
      { tenant: { shopId: ungrantedShop } }
    );

    await drainOnce(pool, buildConsumerRegistry(), FAST, { shopId: ungrantedShop });

    const answered = await asShop(pool, ungrantedShop).query(
      `SELECT count(*)::int AS n FROM privacy_request_fulfilment WHERE privacy_request_id = $1`,
      [requestId]
    );
    expect((answered.rows[0] as { n: number }).n).toBe(0);
    const dead = await asShop(pool, ungrantedShop).query(
      `SELECT reason_code, guard_refusal FROM outbox_dead_letter WHERE ref_id = $1`,
      [requestId]
    );
    expect(dead.rowCount).toBe(1);
    const letter = dead.rows[0] as { reason_code: string; guard_refusal: boolean };
    expect(letter.reason_code).toBe("no_recorded_grant");
    // A GUARD refusal, because the guard is what was MISSING.
    expect(letter.guard_refusal).toBe(true);

    // …and K6: the audit now says WHY this one is still outstanding.
    const outstanding = await outstandingPrivacyRequests(ownerPool);
    const row = outstanding.find((r) => r.privacyRequestId === requestId);
    expect(row?.deadLetterReason).toBe("no_recorded_grant");
  });

  it("a forged signature still leaves no row anywhere, replay columns included", async () => {
    // 053 §11 I2, re-asserted because this bead added two writes to the path: a
    // forged message must still cost one HMAC and nothing else.
    const before = {
      receipts: await countRows("connector_webhook_receipt"),
      requests: await countRows("privacy_request"),
    };
    await expect(
      receiveWebhook(
        deps,
        {
          topic: "customers/redact",
          hmac: "Zm9yZ2Vk",
          shopDomain: STORE,
          webhookId: randomUUID(),
          apiVersion: "2025-07",
          triggeredAt: new Date().toISOString(),
        },
        Buffer.from("{}", "utf8")
      )
    ).rejects.toThrow();
    expect(await countRows("connector_webhook_receipt")).toBe(before.receipts);
    expect(await countRows("privacy_request")).toBe(before.requests);
  });
});
