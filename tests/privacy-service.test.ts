// L2 unit — the privacy workflow's four statements, against a faked pg seam.
//
// WHAT THIS FILE IS FOR AND WHAT IT IS NOT. The integration lane proves the
// BEHAVIOUR against a real cluster — a real `UNIQUE` absorbing a real conflict,
// a real policy filtering a real read. This file proves the STATEMENTS: which
// SQL is issued, in which order, with which values, and what each function does
// with what comes back. The two are different questions and the second is the
// one that goes wrong silently, because a statement that reads the wrong column
// or binds the wrong parameter still runs.
//
// Bead: longbox-e5b.3.8 (alias E03-B08). Docs: 000-docs/064 §6; 043 §3.2
// (idempotency by constraint, never by a prior SELECT); 041 §4.2(i), §5.3;
// 022 P3.
import { describe, expect, it } from "vitest";
import type { Tx } from "../src/db.js";
import { fakePool } from "./fakes.js";
import {
  PRIVACY_FULFILMENT_METHODS,
  PRIVACY_OUTCOMES,
  outstandingPrivacyRequests,
  privacyRequestCounts,
  recordFulfilment,
  recordPrivacyRequest,
} from "../src/services/privacy.js";
import { PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS } from "../src/services/connectors/shopify/policy.js";

const ARGS = {
  shopId: "11111111-1111-4111-8111-111111111111",
  connector: "shopify",
  topic: "customers/redact",
  webhookId: "wh-1",
  webhookReceiptId: "22222222-2222-4222-8222-222222222222",
  shopDomain: "gotham.myshopify.com",
  payloadDigest: "a".repeat(64),
};

const ROW = {
  id: "33333333-3333-4333-8333-333333333333",
  shop_id: ARGS.shopId,
  topic: ARGS.topic,
  due_at: new Date("2026-10-01T00:00:00.000Z"),
};

describe("recordPrivacyRequest — the obligation and its clock (064 §6.1)", () => {
  it("INSERTs with ON CONFLICT DO NOTHING and computes due_at from the PROVISIONAL window", async () => {
    const { pool, calls } = fakePool((text) =>
      text.includes("INSERT INTO privacy_request") ? { rows: [ROW] } : undefined
    );
    const result = await recordPrivacyRequest(pool as unknown as Tx, ARGS);

    expect(result).toEqual({
      id: ROW.id,
      shopId: ARGS.shopId,
      topic: ARGS.topic,
      dueAt: ROW.due_at,
      alreadyRecorded: false,
    });
    expect(calls).toHaveLength(1);
    // The INSERT **is** the duplicate check (041 §4.2(i)): no SELECT precedes it.
    expect(calls[0]?.text).toMatch(/ON CONFLICT \(connector, webhook_id\) DO NOTHING/);
    // `due_at` is STORED, not derived on read — a window changed next year must
    // not silently restate what was owed last year (041 §5.3, applied to a
    // deadline). The window is bound as a parameter so the value in the row is
    // the one this build chose.
    expect(calls[0]?.text).toMatch(/make_interval\(days => \$8::int\)/);
    expect(calls[0]?.values?.[7]).toBe(PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS);
    // No customer identifier is bound, because there is none to bind: what the
    // row carries about the message is its DIGEST (041 §8.4).
    expect(calls[0]?.values).toContain(ARGS.payloadDigest);
  });

  it("accepts an explicit window, so a test never has to move a global", async () => {
    const { pool, calls } = fakePool((text) =>
      text.includes("INSERT INTO privacy_request") ? { rows: [ROW] } : undefined
    );
    await recordPrivacyRequest(pool as unknown as Tx, { ...ARGS, windowDays: 3 });
    expect(calls[0]?.values?.[7]).toBe(3);
  });

  it("carries a NULL tenant through, because the commonest shop/redact has one", async () => {
    // 053 §5.5's nullable tenant, one table over: a store that has already been
    // offboarded matches no install, and recording nothing is the worse answer.
    const { pool, calls } = fakePool((text) =>
      text.includes("INSERT INTO privacy_request") ? { rows: [{ ...ROW, shop_id: null }] } : undefined
    );
    const result = await recordPrivacyRequest(pool as unknown as Tx, { ...ARGS, shopId: null });
    expect(calls[0]?.values?.[0]).toBeNull();
    expect(result.shopId).toBeNull();
  });

  it("reads the existing row back when the constraint absorbs the INSERT", async () => {
    const { pool, calls } = fakePool((text) => (text.startsWith("INSERT") ? { rows: [] } : { rows: [ROW] }));
    const result = await recordPrivacyRequest(pool as unknown as Tx, ARGS);
    expect(result.alreadyRecorded).toBe(true);
    expect(result.id).toBe(ROW.id);
    // The read FOLLOWS the constraint rather than preceding a write, which is
    // the shape 043 §3.2 requires and the write-shape lint enforces.
    expect(calls[0]?.text).toMatch(/^INSERT/);
    expect(calls[1]?.text).toMatch(/SELECT id, shop_id, topic, due_at FROM privacy_request/);
  });

  it("REFUSES loudly when the conflict is absorbed and the read back finds nothing", async () => {
    // That combination is not a race — the read runs under the same context as
    // the INSERT — so it is a tenant-context defect, and a silent `undefined`
    // would surface as a missing obligation nobody could explain.
    const { pool } = fakePool(() => ({ rows: [] }));
    await expect(recordPrivacyRequest(pool as unknown as Tx, ARGS)).rejects.toThrow(
      /conflict was absorbed but no existing row/
    );
  });
});

describe("recordFulfilment — the answer, and who it names (064 §6.2)", () => {
  it("writes a machine answer with authored_by=system and NO operator", async () => {
    const { pool, calls } = fakePool(() => ({ rows: [{ id: "f-1" }] }));
    const wrote = await recordFulfilment(pool, {
      shopId: ARGS.shopId,
      privacyRequestId: ROW.id,
      outcome: "no_data_held",
      method: "scope_policy",
      // Deliberately supplied, and deliberately DISCARDED: a machine answer must
      // never name a person, and the CHECK in `migrations/038` refuses the row if
      // this function let one through.
      operatorId: "44444444-4444-4444-8444-444444444444",
    });
    expect(wrote).toBe(true);
    expect(calls[0]?.values).toEqual([ARGS.shopId, ROW.id, "no_data_held", "scope_policy", null, "system"]);
  });

  it("writes a person's answer with authored_by=human and keeps the operator", async () => {
    const { pool, calls } = fakePool(() => ({ rows: [{ id: "f-2" }] }));
    await recordFulfilment(pool, {
      shopId: ARGS.shopId,
      privacyRequestId: ROW.id,
      outcome: "data_erased",
      method: "deletion_procedure",
      operatorId: "44444444-4444-4444-8444-444444444444",
    });
    expect(calls[0]?.values?.[4]).toBe("44444444-4444-4444-8444-444444444444");
    expect(calls[0]?.values?.[5]).toBe("human");
  });

  it("is idempotent by CONSTRAINT and reports the loser, with no prior SELECT", async () => {
    // 043 §3.2: "enforced by a database constraint … never by a read-then-write
    // check". One statement, and the row count is the answer.
    const { pool, calls } = fakePool(() => ({ rows: [] }));
    expect(
      await recordFulfilment(pool, {
        shopId: null,
        privacyRequestId: ROW.id,
        outcome: "not_applicable",
        method: "operator",
      })
    ).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toMatch(/ON CONFLICT \(privacy_request_id\) DO NOTHING/);
  });

  it("declares the same vocabulary the database CHECKs", async () => {
    expect([...PRIVACY_OUTCOMES]).toEqual(["no_data_held", "data_exported", "data_erased", "not_applicable"]);
    expect([...PRIVACY_FULFILMENT_METHODS]).toEqual(["scope_policy", "operator", "deletion_procedure"]);
  });
});

describe("the audit's two reads (064 §6.4)", () => {
  it("reads the VIEW rather than restating its predicate", async () => {
    // One definition of *outstanding*, so the CLI, a future report and the tests
    // cannot disagree about what it means.
    const { pool, calls } = fakePool(() => ({
      rows: [
        {
          privacy_request_id: ROW.id,
          shop_id: null,
          topic: "shop/redact",
          shop_domain: ARGS.shopDomain,
          received_at: new Date("2026-08-01T00:00:00.000Z"),
          due_at: new Date("2026-08-26T00:00:00.000Z"),
          overdue: true,
          dead_letter_reason: "no_recorded_grant",
        },
      ],
    }));
    const rows = await outstandingPrivacyRequests(pool);
    expect(calls[0]?.text).toMatch(/FROM privacy_request_outstanding/);
    expect(calls[0]?.text).toMatch(/ORDER BY d\.received_at ASC/);
    // K6: the join adds a COLUMN and changes no row — the `overdue` predicate is
    // still the view's and is not restated here, which is the property the
    // consistency lens asked not to lose while closing the usability gap.
    expect(calls[0]?.text).toMatch(/LEFT JOIN outbox_dead_letter/);
    expect(calls[0]?.text).not.toMatch(/now\(\)\s*>/);
    // …and the ONE-ROW-PER-REQUEST property is a property of the STATEMENT, not
    // of today's code: `outbox_dead_letter` is one row per dead-lettered ATTEMPT,
    // so a plain LEFT JOIN would duplicate an outstanding request the day a
    // second dead letter existed for one outbox row (043 §5.5 anticipates a
    // human re-drive). `DISTINCT ON` is what makes "adds a column and changes no
    // row" true without depending on that.
    expect(calls[0]?.text).toMatch(/DISTINCT ON \(o\.privacy_request_id\)/);
    // …and newest-wins is TOTAL: `attempt_no` breaks a tie on the timestamp,
    // because two attempts recorded in one transaction share `now()` and an
    // unqualified `DISTINCT ON` would then pick whichever row the planner reached
    // first. A non-deterministic answer is worse than a wrong one — it does not
    // reproduce (the invariant re-verification's finding 5).
    expect(calls[0]?.text).toMatch(/d\.dead_lettered_at DESC NULLS LAST, d\.attempt_no DESC/);
    expect(rows[0]).toEqual({
      privacyRequestId: ROW.id,
      shopId: null,
      topic: "shop/redact",
      shopDomain: ARGS.shopDomain,
      receivedAt: new Date("2026-08-01T00:00:00.000Z"),
      dueAt: new Date("2026-08-26T00:00:00.000Z"),
      overdue: true,
      // K6: WHY it is still outstanding, when the queue knows. `null` here would
      // be a request with no job at all — a `shop/redact`, or a null-tenant one.
      deadLetterReason: "no_recorded_grant",
    });
  });

  it("counts by topic and outcome, and projects NO person (022 P3)", async () => {
    const { pool, calls } = fakePool(() => ({
      rows: [
        { topic: "customers/redact", outcome: null, requests: 2 },
        { topic: "customers/redact", outcome: "no_data_held", requests: 5 },
      ],
    }));
    const buckets = await privacyRequestCounts(pool);
    // The assertion that matters is the ABSENCE: an audit that grew an
    // `operator_id` column would report the worker rather than the work.
    expect(calls[0]?.text).not.toMatch(/operator_id/);
    expect(calls[0]?.text).toMatch(/GROUP BY r\.topic, f\.outcome/);
    expect(buckets).toEqual([
      { topic: "customers/redact", outcome: null, requests: 2 },
      { topic: "customers/redact", outcome: "no_data_held", requests: 5 },
    ]);
  });
});
