// L4 integration — 043 §11 I5 and amendment A2 (Kleppmann 2, REQUIRED):
// **EVERY registered consumer stays correct under CONCURRENT duplicate delivery,
// and the gate is at the REGISTRY.**
//
// WHY PARAMETRIC AND NOT ONE HAND-PICKED CONSUMER. The draft of 043 constructed
// the concurrent duplicate against *a* consumer, which proves that consumer and
// says nothing about the next one somebody writes:
//
//   "A rule enforced by one example is a rule enforced by whoever remembers the
//    example."
//
// So this file iterates `buildConsumerRegistry()` and constructs the race
// against every entry. REGISTERING A CONSUMER ENROLS IT HERE; there is no list
// to update and no way to add one untested — which is the property a per-instance
// test cannot have.
//
// WHY *CONCURRENT* AND NOT DELIVER-TWICE-IN-SEQUENCE (A9). At-least-once plus
// `SKIP LOCKED` plus the visibility window means two workers can process two
// deliveries of one event AT THE SAME TIME, not merely one after the other. A
// consumer that is idempotent by CHECKING THEN WRITING is not idempotent under
// that interleaving; one that is idempotent by a UNIQUE CONSTRAINT is. A test
// that delivered twice in sequence would pass against the broken one.
//
// Bead: longbox-e5b.2.17 (E02-D07). Docs: 043 §3.2, §4.3, A2, A9, §11 I5.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { type Tx, withTransaction } from "../../src/db.js";
import { createScanSession } from "../../src/services/scanSession.js";
import { claimBatch, DEFAULT_OUTBOX_PARAMS, enqueue, type Claim } from "../../src/services/outbox.js";
import { buildConsumerRegistry } from "../../src/consumers/index.js";
import { DRAFT_REQUESTED, PRIVACY_REQUEST_RECEIVED } from "../../src/events/catalogue.js";
import { randomUUID } from "node:crypto";
import { CONNECTOR, requireConnectorKey } from "../../src/services/connectors/shopify/index.js";
import { introduceTokenVersion } from "../../src/services/connectors/shopify/custody.js";
import { TEST_CONNECTOR_KEY_V1 } from "../testConfig.js";
import { fakeShopifyClient } from "../fakes.js";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

/**
 * How to build a claim for each registered event, and how to count the effect it
 * is supposed to produce exactly once.
 *
 * ⚠ ADDING A CONSUMER WITHOUT ADDING ITS ROW HERE FAILS THE FIRST TEST BELOW.
 * That is deliberate: the alternative — skipping consumers this file does not
 * know how to seed — would make the sweep silently narrow over time, which is
 * exactly the "enforced by whoever remembers" failure A2 struck.
 */
interface Scenario {
  seed(pool: pg.Pool, shopId: string): Promise<{ subject: string }>;
  countEffects(pool: pg.Pool, subject: string, shopId: string): Promise<number>;
  /**
   * How this event is enqueued for its subject.
   *
   * ⚠ GENERALISED AT E03-B08, and the reason is worth one line: the harness used
   * to hard-code `scanSessionId: subject`, which is the DRAFT event's shape and
   * not the outbox's. `longbox.platform.privacy_request_received` has no scan
   * session at all — a privacy message is about a person or a store, never about
   * a book on a counter — so the shape belongs to the scenario.
   */
  enqueue(tx: Tx, shopId: string, subject: string): Promise<{ id: string }>;
  /**
   * Prove the LOSING writer is stopped by a CONSTRAINT (I5(b)), by trying to
   * defeat it directly. Per-scenario, because the constraint differs: the draft's
   * is a partial unique on `outbox_id`, and the privacy job's is
   * `UNIQUE (privacy_request_id)`.
   */
  defeatTheConstraint(
    query: (sql: string, values?: unknown[]) => Promise<pg.QueryResult>,
    shopId: string,
    subject: string,
    outboxId: string
  ): Promise<void>;
  /** Only for a consumer that reaches a provider. The privacy job reaches none. */
  readonly touchesProvider?: true;
}

const SCENARIOS: Record<string, Scenario> = {
  [DRAFT_REQUESTED]: {
    // A scenario is handed the pool and the shop, so it scopes its own fixtures
    // (E03-B04): these tables all carry a `shop_id` and the suite runs as the
    // app role, which is subject to every policy.
    async seed(pool, shopId) {
      const db = asShop(pool, shopId);
      const sessionId = (await createScanSession(db, shopId)).id;
      await db.query(
        `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source)
         VALUES ($1,$2,$3,'one_tap')`,
        [sessionId, shopId, JSON.stringify({ title: "Bone", issue: "1" })]
      );
      await db.query(
        `INSERT INTO pricing_snapshot (scan_session_id, shop_id, query, suggested_cents)
         VALUES ($1,$2,'x',1200)`,
        [sessionId, shopId]
      );
      return { subject: sessionId };
    },
    async countEffects(pool, sessionId, shopId) {
      return Number(
        (
          await asShop(pool, shopId).query(
            `SELECT count(*)::int AS n FROM shopify_draft WHERE scan_session_id = $1`,
            [sessionId]
          )
        ).rows[0]!.n
      );
    },
    enqueue: (tx, shopId, subject) =>
      enqueue(tx, { shopId, event: DRAFT_REQUESTED, scanSessionId: subject, authoredBy: "human" }),
    async defeatTheConstraint(query, shopId, subject, outboxId) {
      await query(
        `INSERT INTO shopify_draft (scan_session_id, shop_id, product_gid, status, outbox_id)
         VALUES ($1,$2,'gid://a','draft',$3)`,
        [subject, shopId, outboxId]
      );
      await expect(
        query(
          `INSERT INTO shopify_draft (scan_session_id, shop_id, product_gid, status, outbox_id)
           VALUES ($1,$2,'gid://b','draft',$3)`,
          [subject, shopId, outboxId]
        )
      ).rejects.toThrow(/duplicate key|unique/i);
    },
    touchesProvider: true,
  },
  // E03-B08's privacy job (000-docs/064 §7). Its effect is ONE
  // `privacy_request_fulfilment`, and its idempotency is `UNIQUE
  // (privacy_request_id)` with `ON CONFLICT DO NOTHING` — a constraint, not a
  // read-then-write, which is what makes it survive the interleaving below.
  [PRIVACY_REQUEST_RECEIVED]: {
    async seed(pool, shopId) {
      const db = asShop(pool, shopId);
      // A RECORDED GRANT for the store, because F4 makes zero grants a REFUSAL:
      // an empty scope set satisfies *no customer scope was granted* vacuously,
      // so a store with nothing recorded is dead-lettered rather than answered.
      // The scenario's subject is the fulfilment, so it seeds the precondition
      // the guard demands rather than the guard's refusal.
      await introduceTokenVersion(
        db,
        requireConnectorKey({ LONGBOX_CONNECTOR_KEY_V1: TEST_CONNECTOR_KEY_V1 }),
        {
          shopId,
          connector: CONNECTOR,
          versionNo: Math.floor(Math.random() * 1_000_000) + 1,
          shopDomain: "idem.myshopify.com",
          accessToken: "test-shopify-access-token-key",
          grantedScopes: ["write_products", "read_products"],
          installStateId: null,
          authoredBy: "human",
        }
      );
      const receipt = await db.query(
        `INSERT INTO connector_webhook_receipt
           (shop_id, connector, topic, webhook_id, shop_domain, payload_digest, payload_bytes)
         VALUES ($1,'shopify','customers/redact',$2,'idem.myshopify.com',$3,4) RETURNING id`,
        [shopId, `idem-${randomUUID()}`, "1".repeat(64)]
      );
      const request = await db.query(
        `INSERT INTO privacy_request
           (shop_id, connector, topic, webhook_id, webhook_receipt_id, shop_domain, payload_digest, due_at)
         VALUES ($1,'shopify','customers/redact',$2,$3,'idem.myshopify.com',$4,
                 now() + interval '25 days')
         RETURNING id`,
        [shopId, `idem-${randomUUID()}`, (receipt.rows[0] as { id: string }).id, "1".repeat(64)]
      );
      return { subject: (request.rows[0] as { id: string }).id };
    },
    async countEffects(pool, requestId, shopId) {
      return Number(
        (
          await asShop(pool, shopId).query(
            `SELECT count(*)::int AS n FROM privacy_request_fulfilment WHERE privacy_request_id = $1`,
            [requestId]
          )
        ).rows[0]!.n
      );
    },
    // NO `scanSessionId`: a privacy message is about a person or a store, never
    // about a book on a counter, and the reference is the obligation itself.
    enqueue: (tx, shopId, subject) =>
      enqueue(tx, {
        shopId,
        event: PRIVACY_REQUEST_RECEIVED,
        refTable: "privacy_request",
        refId: subject,
        authoredBy: "provider",
      }),
    async defeatTheConstraint(query, shopId, subject) {
      await query(
        `INSERT INTO privacy_request_fulfilment
           (shop_id, privacy_request_id, outcome, method, authored_by)
         VALUES ($1,$2,'no_data_held','scope_policy','system')`,
        [shopId, subject]
      );
      await expect(
        query(
          `INSERT INTO privacy_request_fulfilment
             (shop_id, privacy_request_id, outcome, method, authored_by)
           VALUES ($1,$2,'not_applicable','scope_policy','system')`,
          [shopId, subject]
        )
      ).rejects.toThrow(/duplicate key|unique/i);
    },
  },
};

describe.skipIf(!dbUp)("consumer idempotency, gated at the REGISTRY (043 A2)", () => {
  let pool: pg.Pool;
  let ownerPool: pg.Pool;
  let shopId: string;
  const registry = buildConsumerRegistry();
  const registered = registry.entries().map(([event]) => event);

  /**
   * THE STATEMENTS THIS SUITE ISSUES ITSELF, INSIDE ITS OWN SHOP'S TENANT CONTEXT.
   *
   * E03-B04 put row-level security on every table carrying a `shop_id`, and this
   * suite holds an APP-ROLE pool — the least-privileged role, which is subject to
   * every policy. So a fixture INSERT with no tenant context is refused by
   * `WITH CHECK` and a fixture SELECT returns nothing, exactly as a cross-tenant
   * statement would be. These two helpers name the tenant the way the running
   * system does (`src/db.ts`'s `tenantDb`), and nothing here is sticky: the
   * context is set inside the statement's own transaction and reverts with it.
   *
   * A statement about ANOTHER shop passes that shop explicitly, so a deliberately
   * cross-tenant fixture stays visible rather than reading like the ordinary case.
   */
  const shopQuery = (sql: string, values?: unknown[]): Promise<pg.QueryResult> =>
    asShop(pool, shopId).query(sql, values);

  const shopTx = <T>(fn: (tx: Tx) => Promise<T>, shop: string = shopId): Promise<T> =>
    withTransaction(pool, fn, { tenant: { shopId: shop } });

  beforeAll(async () => {
    const url = await createFreshDb("longbox_e02d07_consumer_idem");
    await runMigrations(url);
    // A SHOP IS CREATED BY THE OWNING CONNECTION (E03-B04). `shop` is policied on
    // its own `id`, so an INSERT can never satisfy `id = current_shop_id()` — the
    // tenant IS the row being created — which makes onboarding a schema-owner act
    // enforced by the database rather than by convention. Everything the suite
    // EXERCISES still runs on the least-privileged pool.
    ownerPool = new pg.Pool({ connectionString: url });
    pool = new pg.Pool({ connectionString: appUrl(url), max: 10 });
    shopId = await seedShop(ownerPool, { name: "Idempotency Shop" });
  });

  afterAll(async () => {
    await pool?.end();
    await ownerPool?.end();
  });

  it("every registered consumer has a scenario — an unseeded consumer is an UNTESTED consumer", () => {
    expect(registered.length).toBeGreaterThan(0);
    const missing = registered.filter((e) => SCENARIOS[e] === undefined);
    expect(
      missing,
      `these consumers are registered but have no concurrent-duplicate scenario: ${missing.join(", ")}. ` +
        `043 A2 gates idempotency AT THE REGISTRY, so adding a consumer means adding its row to ` +
        `SCENARIOS here — skipping it would make this sweep silently narrower than the registry.`
    ).toEqual([]);
  });

  it.each(registered)(
    "%s: two SIMULTANEOUS deliveries of one event produce exactly ONE effect and ONE row",
    async (event) => {
      const scenario = SCENARIOS[event]!;
      const { subject } = await scenario.seed(pool, shopId);
      const outboxId = (await shopTx((tx) => scenario.enqueue(tx, shopId, subject))).id;

      // One claim, then the SAME claim delivered twice at once. This is the
      // duplicate delivery the visibility window makes reachable, constructed
      // rather than waited for.
      const claim = (await claimBatch(pool, DEFAULT_OUTBOX_PARAMS, { shopId })).find(
        (c) => c.outboxId === outboxId
      )!;
      const second: Claim = { ...claim, attemptNo: claim.attemptNo + 1 };

      const shopify = fakeShopifyClient();
      const consumer = buildConsumerRegistry({
        resolveClient: async () => ({ client: shopify.client, stub: true }),
      }).get(event)!;

      const outcomes = await Promise.all([
        consumer({ pool, claim, params: DEFAULT_OUTBOX_PARAMS }),
        consumer({ pool, claim: second, params: DEFAULT_OUTBOX_PARAMS }),
      ]);

      // Both report delivered: the effect each owed HAS happened.
      expect(outcomes.map((o) => o.status)).toEqual(["delivered", "delivered"]);
      // ONE row, by constraint.
      expect(await scenario.countEffects(pool, subject, shopId)).toBe(1);
      // ONE effect at the provider: 043 §4.3's customId upsert is the
      // provider-side half of the same rule. Only asserted for a consumer that
      // reaches a provider — the privacy job reaches none, and asserting a set of
      // size one over an untouched fake would be an assertion about the fake.
      if (scenario.touchesProvider === true) {
        expect(new Set(shopify.products.values()).size).toBe(1);
      } else {
        expect(shopify.products.size).toBe(0);
      }
    }
  );

  it.each(registered)(
    "%s: the losing writer is stopped by a DATABASE CONSTRAINT, not by a prior SELECT",
    async (event) => {
      // I5(b). The mechanism must be a constraint: a read-then-write check is
      // correct one-after-the-other and broken at the same instant, and the
      // difference is invisible in any test that does not construct the race.
      // Here the constraint is asserted directly, by trying to defeat it.
      const scenario = SCENARIOS[event]!;
      const { subject } = await scenario.seed(pool, shopId);
      const outboxId = (await shopTx((tx) => scenario.enqueue(tx, shopId, subject))).id;
      await scenario.defeatTheConstraint(shopQuery, shopId, subject, outboxId);
    }
  );

  it("a request-written draft row carries NULL outbox_id and is not caught by the partial index", async () => {
    // The uniqueness is PARTIAL for a reason: many rows legitimately carry NULL
    // (043 §8.1's one-meaning rule — "written by a request, not a job"), and a
    // total unique index would let exactly one of them exist in the whole table.
    const sessionId = (await createScanSession(asShop(pool, shopId), shopId)).id;
    for (const gid of ["gid://p", "gid://q"]) {
      await shopQuery(
        `INSERT INTO shopify_draft (scan_session_id, shop_id, product_gid, status) VALUES ($1,$2,$3,'draft')`,
        [sessionId, shopId, gid]
      );
    }
    expect(
      Number(
        (
          await shopQuery(`SELECT count(*)::int AS n FROM shopify_draft WHERE scan_session_id = $1`, [
            sessionId,
          ])
        ).rows[0]!.n
      )
    ).toBe(2);
  });
});
