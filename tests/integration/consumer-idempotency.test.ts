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
import { withTransaction } from "../../src/db.js";
import { createScanSession } from "../../src/services/scanSession.js";
import { claimBatch, DEFAULT_OUTBOX_PARAMS, enqueue, type Claim } from "../../src/services/outbox.js";
import { buildConsumerRegistry } from "../../src/consumers/index.js";
import { DRAFT_REQUESTED } from "../../src/events/catalogue.js";
import { fakeShopifyClient } from "../fakes.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

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
  countEffects(pool: pg.Pool, subject: string): Promise<number>;
}

const SCENARIOS: Record<string, Scenario> = {
  [DRAFT_REQUESTED]: {
    async seed(pool, shopId) {
      const sessionId = (await createScanSession(pool, shopId, "employee")).id;
      await pool.query(
        `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source)
         VALUES ($1,$2,$3,'one_tap')`,
        [sessionId, shopId, JSON.stringify({ title: "Bone", issue: "1" })]
      );
      await pool.query(
        `INSERT INTO pricing_snapshot (scan_session_id, shop_id, query, suggested_cents)
         VALUES ($1,$2,'x',1200)`,
        [sessionId, shopId]
      );
      return { subject: sessionId };
    },
    async countEffects(pool, sessionId) {
      return Number(
        (
          await pool.query(`SELECT count(*)::int AS n FROM shopify_draft WHERE scan_session_id = $1`, [
            sessionId,
          ])
        ).rows[0]!.n
      );
    },
  },
};

describe.skipIf(!dbUp)("consumer idempotency, gated at the REGISTRY (043 A2)", () => {
  let pool: pg.Pool;
  let shopId: string;
  const registry = buildConsumerRegistry();
  const registered = registry.entries().map(([event]) => event);

  beforeAll(async () => {
    const url = await createFreshDb("longbox_e02d07_consumer_idem");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: appUrl(url), max: 10 });
    shopId = await seedShop(pool, { name: "Idempotency Shop" });
  });

  afterAll(async () => {
    await pool?.end();
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
      const outboxId = (
        await withTransaction(pool, (tx) =>
          enqueue(tx, { shopId, event, scanSessionId: subject, authoredBy: "human" })
        )
      ).id;

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
      expect(await scenario.countEffects(pool, subject)).toBe(1);
      // ONE effect at the provider: 043 §4.3's customId upsert is the
      // provider-side half of the same rule.
      expect(new Set(shopify.products.values()).size).toBe(1);
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
      const outboxId = (
        await withTransaction(pool, (tx) =>
          enqueue(tx, { shopId, event, scanSessionId: subject, authoredBy: "human" })
        )
      ).id;
      await pool.query(
        `INSERT INTO shopify_draft (scan_session_id, shop_id, product_gid, status, outbox_id)
         VALUES ($1,$2,'gid://a','draft',$3)`,
        [subject, shopId, outboxId]
      );
      await expect(
        pool.query(
          `INSERT INTO shopify_draft (scan_session_id, shop_id, product_gid, status, outbox_id)
           VALUES ($1,$2,'gid://b','draft',$3)`,
          [subject, shopId, outboxId]
        )
      ).rejects.toThrow(/duplicate key|unique/i);
    }
  );

  it("a request-written draft row carries NULL outbox_id and is not caught by the partial index", async () => {
    // The uniqueness is PARTIAL for a reason: many rows legitimately carry NULL
    // (043 §8.1's one-meaning rule — "written by a request, not a job"), and a
    // total unique index would let exactly one of them exist in the whole table.
    const sessionId = (await createScanSession(pool, shopId, "employee")).id;
    for (const gid of ["gid://p", "gid://q"]) {
      await pool.query(
        `INSERT INTO shopify_draft (scan_session_id, shop_id, product_gid, status) VALUES ($1,$2,$3,'draft')`,
        [sessionId, shopId, gid]
      );
    }
    expect(
      Number(
        (
          await pool.query(`SELECT count(*)::int AS n FROM shopify_draft WHERE scan_session_id = $1`, [
            sessionId,
          ])
        ).rows[0]!.n
      )
    ).toBe(2);
  });
});
