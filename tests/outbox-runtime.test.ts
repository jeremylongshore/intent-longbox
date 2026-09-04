// L3 unit: the registry, the enqueue statement shape, the claim's ONE-transaction
// boundary and the drain's outcome→attempt mapping — all against the fake pg
// seam, so the sequencing is observable without a database.
//
// WHAT THIS FILE CAN AND CANNOT SHOW. It can show that `claimBatch` issues its
// SELECT and its `started` INSERT on ONE checked-out client between one BEGIN
// and one COMMIT — which is the mechanical half of 043 A1 and is exactly the
// property a split-transaction refactor would break. It CANNOT show that two
// concurrent pollers never take one row: that needs a real Postgres and lives in
// tests/integration/outbox-skip-locked.test.ts, adversarially, per 043 A9.
//
// Bead: longbox-e5b.2.17 (E02-D07). Docs: 043 §2.3, §3.4, §4.1, §5, §7.2, A1, A2.
import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { Tx } from "../src/db.js";
import { fakeTxPool, fakePool } from "./fakes.js";
import { DRAFT_REQUESTED } from "../src/events/catalogue.js";
import {
  claimBatch,
  createConsumerRegistry,
  DEFAULT_OUTBOX_PARAMS,
  drainOnce,
  enqueue,
  recordAttempt,
  startOutboxPoller,
  UnknownEventError,
  type ConsumerOutcome,
} from "../src/services/outbox.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";

const asTx = (pool: pg.Pool) => pool as unknown as Tx;

describe("enqueue (043 §2.1, §2.3)", () => {
  it("writes the reference and the envelope, and no values from the referenced row", async () => {
    const { pool, calls } = fakePool(() => ({ rows: [{ id: "ob-1" }] }));
    await enqueue(asTx(pool), {
      shopId: SHOP,
      event: "longbox.commerce.draft_recorded",
      refId: "sd-1",
      scanSessionId: SESSION,
      authoredBy: "system",
    });
    const sql = calls[0]!.text;
    expect(sql).toMatch(/INSERT INTO outbox/);
    expect(sql).toContain("ref_table");
    expect(sql).toContain("ref_id");
    // 042 §7.1 / 043 §2.5: a copy is a second source of truth, a copy is
    // un-purgeable, and a copy ages while the row it copied is corrected.
    expect(sql).not.toMatch(/payload|body|title|price/i);
    // 043 A6: payload_hash was struck — the unique constraint already makes the
    // case it existed for unconstructible.
    expect(sql).not.toContain("payload_hash");
  });

  it("self-references for the ONE command event: ref_table='outbox', ref_id=id (043 §3.4)", async () => {
    const { pool, calls } = fakePool((_t, v) => ({ rows: [{ id: (v as string[])[0] }] }));
    const res = await enqueue(asTx(pool), {
      shopId: SHOP,
      event: DRAFT_REQUESTED,
      scanSessionId: SESSION,
      authoredBy: "human",
    });
    const values = calls[0]!.values as unknown[];
    expect(values[0]).toBe(res.id); // the id, minted in TypeScript
    expect(values[5]).toBe("outbox"); // ref_table
    expect(values[6]).toBe(res.id); // ref_id === id
    // Minted here rather than by the column default because an append-only table
    // has no UPDATE with which to point a row at itself after the fact.
  });

  it("refuses a name the authored catalogue does not declare", async () => {
    const { pool } = fakePool();
    await expect(
      enqueue(asTx(pool), { shopId: SHOP, event: "longbox.commerce.invented", authoredBy: "system" })
    ).rejects.toThrow(UnknownEventError);
  });

  it("refuses a ref_table that disagrees with the catalogue's declaration", async () => {
    const { pool } = fakePool();
    await expect(
      enqueue(asTx(pool), {
        shopId: SHOP,
        event: "longbox.commerce.draft_recorded",
        refTable: "scan_session",
        refId: "x",
        authoredBy: "system",
      })
    ).rejects.toThrow(/declares ref_table='shopify_draft'/);
  });

  it("absorbs a duplicate through the UNIQUE constraint, never a read-then-write check", async () => {
    // ON CONFLICT DO NOTHING returns no row; the id is then read back. The read
    // FOLLOWS the constraint rather than preceding a write, which is the shape
    // 043 §3.2 requires and the consumer-write-shape lint hunts for.
    let call = 0;
    const { pool, calls } = fakePool(() => (call++ === 0 ? { rows: [] } : { rows: [{ id: "existing" }] }));
    const res = await enqueue(asTx(pool), {
      shopId: SHOP,
      event: "longbox.commerce.draft_recorded",
      refId: "sd-1",
      authoredBy: "system",
    });
    expect(res).toEqual({ id: "existing", alreadyEnqueued: true });
    expect(calls[0]!.text).toContain("ON CONFLICT ON CONSTRAINT outbox_one_effect_per_reference");
  });

  it("requires a refId for a reference-shaped event rather than inventing one", async () => {
    const { pool } = fakePool();
    await expect(
      enqueue(asTx(pool), { shopId: SHOP, event: "longbox.commerce.draft_recorded", authoredBy: "system" })
    ).rejects.toThrow(/refId is required/);
  });
});

describe("claimBatch — the claim and the `started` INSERT are ONE transaction (043 A1)", () => {
  it("issues both on ONE checked-out client, between one BEGIN and one COMMIT", async () => {
    // THIS IS THE MECHANICAL FORM OF THE MOST IMPORTANT SENTENCE IN 043 §2.4.
    // Split them and the row lock is released before the log records the claim;
    // a second claimer then sees a row that is not terminal, not in flight and
    // due, and takes it. The design's whole claim is that the lease derives from
    // the log, and a lock released before the log records it is a lease derived
    // from nothing.
    const { pool, clients } = fakeTxPool((text) => {
      if (text.includes("FOR UPDATE OF o SKIP LOCKED")) {
        return {
          rows: [
            {
              id: "ob-1",
              shop_id: SHOP,
              scan_session_id: SESSION,
              event: DRAFT_REQUESTED,
              ref_table: "outbox",
              ref_id: "ob-1",
              correlation_id: null,
              definition_version: null,
            },
          ],
        };
      }
      if (text.includes("o.id = ANY(")) return { rows: [{ id: "ob-1" }] };
      if (text.includes("coalesce(max(attempt_no)")) return { rows: [{ n: 3 }] };
      return undefined;
    });

    const claims = await claimBatch(pool, DEFAULT_OUTBOX_PARAMS);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.attemptNo).toBe(3);

    // ONE connection for the whole claim.
    expect(clients).toHaveLength(1);
    const seq = clients[0]!.calls.map((c) => c.text);
    expect(seq[0]).toBe("BEGIN");
    expect(seq[seq.length - 1]).toBe("COMMIT");

    const selectAt = seq.findIndex((t) => t.includes("SKIP LOCKED"));
    const insertAt = seq.findIndex((t) => t.includes("INSERT INTO outbox_attempt"));
    const commitAt = seq.length - 1;
    expect(selectAt).toBeGreaterThan(0);
    expect(insertAt).toBeGreaterThan(selectAt);
    // The lock is released only when the `started` row is durable — i.e. the
    // INSERT precedes the COMMIT and there is no COMMIT between them.
    expect(insertAt).toBeLessThan(commitAt);
    expect(seq.slice(selectAt, insertAt)).not.toContain("COMMIT");
  });

  it("RE-CHECKS eligibility in a second statement after the locks are held", async () => {
    // THIS GUARDS A DEFECT CI FOUND AND THIS LAPTOP COULD NOT REPRODUCE.
    //
    // `withTransaction` runs at READ COMMITTED, where each STATEMENT takes its
    // own snapshot. The eligibility predicates are subqueries over
    // `outbox_attempt` — a different table from the one being locked — so a
    // claimer whose SELECT began before a rival's COMMIT can evaluate "not in
    // flight" against a snapshot that has no rival `started` row in it, and find
    // the row unlocked by the time it examines it. Postgres' EvalPlanQual
    // re-check does not cover it: the rival modified a CHILD table, so there is
    // nothing on the locked row to trigger it.
    //
    // The fix is a SECOND statement, issued after the locks are acquired, whose
    // fresh snapshot necessarily contains every committed claim. The race itself
    // is probabilistic and lives in the integration lane; this assertion is the
    // deterministic half — it fails the moment somebody deletes the re-check as
    // a redundant round trip, which is exactly how it would be lost.
    const { pool, clients } = fakeTxPool((text) => {
      if (text.includes("FOR UPDATE OF o SKIP LOCKED")) {
        return {
          rows: [
            {
              id: "ob-1",
              shop_id: SHOP,
              scan_session_id: SESSION,
              event: DRAFT_REQUESTED,
              ref_table: "outbox",
              ref_id: "ob-1",
              correlation_id: null,
              definition_version: null,
            },
          ],
        };
      }
      if (text.includes("o.id = ANY(")) return { rows: [{ id: "ob-1" }] };
      if (text.includes("coalesce(max(attempt_no)")) return { rows: [{ n: 1 }] };
      return undefined;
    });

    await claimBatch(pool, DEFAULT_OUTBOX_PARAMS);
    const seq = clients[0]!.calls.map((c) => c.text);
    const claimAt = seq.findIndex((t) => t.includes("SKIP LOCKED"));
    const recheckAt = seq.findIndex((t) => t.includes("o.id = ANY("));
    const insertAt = seq.findIndex((t) => t.includes("INSERT INTO outbox_attempt"));

    expect(recheckAt, "the post-lock eligibility re-check is missing").toBeGreaterThan(claimAt);
    expect(recheckAt).toBeLessThan(insertAt);
    // Same connection, same transaction: a re-check on a different connection
    // would take a snapshot without our own locks in view and prove nothing.
    expect(clients).toHaveLength(1);
    // It re-checks terminal and in-flight, and deliberately NOT `due`: re-rolling
    // §5.2's random() jitter would drop rows for no reason but a second dice
    // throw, trading a correctness bug for a non-deterministic one.
    expect(seq[recheckAt]).toContain("'delivered', 'dead_lettered'");
    expect(seq[recheckAt]).toContain("'started'");
    expect(seq[recheckAt]).not.toContain("power(2");
  });

  it("claims nothing when the post-lock re-check rejects every candidate", async () => {
    // The rival won: its `started` row is visible to the second statement's
    // snapshot even though it was not visible to the first. Nothing is claimed
    // and — the part that matters — no `started` row is written for a row this
    // worker does not own.
    const { pool, calls } = fakeTxPool((text) => {
      if (text.includes("FOR UPDATE OF o SKIP LOCKED")) {
        return {
          rows: [
            {
              id: "ob-1",
              shop_id: SHOP,
              scan_session_id: SESSION,
              event: DRAFT_REQUESTED,
              ref_table: "outbox",
              ref_id: "ob-1",
              correlation_id: null,
              definition_version: null,
            },
          ],
        };
      }
      if (text.includes("o.id = ANY(")) return { rows: [] };
      return undefined;
    });

    expect(await claimBatch(pool, DEFAULT_OUTBOX_PARAMS)).toEqual([]);
    expect(calls.filter((c) => c.text.includes("INSERT INTO outbox_attempt"))).toHaveLength(0);
  });

  it("writes the `started` row with authored_by='system' and no client timestamp (A7)", async () => {
    const { pool, calls } = fakeTxPool((text) => {
      if (text.includes("SKIP LOCKED")) {
        return {
          rows: [
            {
              id: "ob-1",
              shop_id: SHOP,
              scan_session_id: null,
              event: DRAFT_REQUESTED,
              ref_table: "outbox",
              ref_id: "ob-1",
              correlation_id: null,
              definition_version: null,
            },
          ],
        };
      }
      if (text.includes("o.id = ANY(")) return { rows: [{ id: "ob-1" }] };
      if (text.includes("coalesce(max(attempt_no)")) return { rows: [{ n: 1 }] };
      return undefined;
    });
    await claimBatch(pool, DEFAULT_OUTBOX_PARAMS);
    const insert = calls.find((c) => c.text.includes("INSERT INTO outbox_attempt"))!;
    expect(insert.text).toContain("'started'");
    // No created_at parameter, and there must never be one: every timestamp in
    // this design is the column default — server-side now() inside the claim
    // transaction (043 A7).
    expect(insert.text).not.toContain("created_at");
  });

  it("passes the four PROVISIONAL floors as binds, not as literals baked into the SQL", async () => {
    const { pool, calls } = fakeTxPool(() => ({ rows: [] }));
    await claimBatch(pool, DEFAULT_OUTBOX_PARAMS, { shopId: SHOP, limit: 7 });
    const claim = calls.find((c) => c.text.includes("SKIP LOCKED"))!;
    expect(claim.values).toEqual([
      DEFAULT_OUTBOX_PARAMS.attemptVisibilityMs,
      DEFAULT_OUTBOX_PARAMS.backoffBaseMs,
      DEFAULT_OUTBOX_PARAMS.backoffCeilingMs,
      7,
      SHOP,
    ]);
  });
});

describe("recordAttempt", () => {
  it("refuses to persist a detail key the allowlist does not name", async () => {
    const { pool, calls } = fakePool();
    await expect(
      recordAttempt(pool, {
        shopId: SHOP,
        outboxId: "ob-1",
        attemptNo: 1,
        kind: "failed",
        detail: { provider_message: "Shopify says no" } as never,
      })
    ).rejects.toThrow(/not an allowlisted key/);
    expect(calls).toHaveLength(0); // nothing was written
  });
});

describe("the consumer registry (043 A2)", () => {
  const noop = async (): Promise<ConsumerOutcome> => ({ status: "delivered" });

  it("registers and dispatches by event name", () => {
    const r = createConsumerRegistry();
    r.register(DRAFT_REQUESTED, noop);
    expect(r.get(DRAFT_REQUESTED)).toBe(noop);
    expect(r.get("longbox.commerce.draft_recorded")).toBeUndefined();
  });

  it("refuses a name the catalogue does not declare — the registry is a second reader of one list", () => {
    const r = createConsumerRegistry();
    expect(() => r.register("longbox.commerce.invented", noop)).toThrow(UnknownEventError);
  });

  it("refuses a SECOND consumer for one event rather than silently picking one", () => {
    // Fan-out is a second event name (043 §3.3's catalogue), not a second
    // handler: two handlers for one name is a dispatch ambiguity nothing here
    // can resolve, and resolving it by insertion order would be a coin flip
    // dressed as a rule.
    const r = createConsumerRegistry();
    r.register(DRAFT_REQUESTED, noop);
    expect(() => r.register(DRAFT_REQUESTED, noop)).toThrow(/second consumer/);
  });

  it("exposes every entry, which is what makes the parametric idempotency test possible", () => {
    const r = createConsumerRegistry();
    r.register(DRAFT_REQUESTED, noop);
    expect(r.entries().map(([e]) => e)).toEqual([DRAFT_REQUESTED]);
  });
});

describe("drainOnce — outcome to attempt kind (043 §5)", () => {
  function poolFor(claimRow: Record<string, unknown> | null) {
    return fakeTxPool((text) => {
      if (text.includes("SKIP LOCKED")) return { rows: claimRow ? [claimRow] : [] };
      // The post-lock eligibility re-check: the candidate survives it here, so
      // these cases exercise the outcome mapping rather than the race.
      if (text.includes("o.id = ANY(")) return { rows: claimRow ? [{ id: claimRow.id }] : [] };
      if (text.includes("coalesce(max(attempt_no)")) return { rows: [{ n: 1 }] };
      return undefined;
    });
  }
  const claimRow = {
    id: "ob-1",
    shop_id: SHOP,
    scan_session_id: SESSION,
    event: DRAFT_REQUESTED,
    ref_table: "outbox",
    ref_id: "ob-1",
    correlation_id: null,
    definition_version: null,
  };

  async function drainWith(outcome: ConsumerOutcome | (() => never), attemptNo = 1) {
    const { pool, calls } = poolFor({ ...claimRow });
    // Override the attempt-number probe when the case needs a later attempt.
    const registry = createConsumerRegistry();
    registry.register(DRAFT_REQUESTED, async () => {
      if (typeof outcome === "function") outcome();
      return outcome as ConsumerOutcome;
    });
    const params = { ...DEFAULT_OUTBOX_PARAMS, maxAttempts: attemptNo === 1 ? 6 : attemptNo };
    const result = await drainOnce(pool, registry, params);
    const terminal = calls.filter(
      (c) => c.text.includes("INSERT INTO outbox_attempt") && !c.text.includes("'started'")
    );
    return { result, terminal };
  }

  it("delivered → a `delivered` attempt carrying a duration and nothing else", async () => {
    const { result, terminal } = await drainWith({ status: "delivered" });
    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0, deadLettered: 0 });
    expect(terminal).toHaveLength(1);
    const detail = JSON.parse(terminal[0]!.values![4] as string) as Record<string, unknown>;
    expect(Object.keys(detail)).toEqual(["duration_ms"]);
  });

  it("a guard refusal → `dead_lettered` with its reason_code, and NO retry", async () => {
    const { result, terminal } = await drainWith({
      status: "dead_letter",
      reasonCode: "no_observation_evidence",
    });
    expect(result.deadLettered).toBe(1);
    expect(terminal[0]!.values![3]).toBe("dead_lettered");
    const detail = JSON.parse(terminal[0]!.values![4] as string) as { reason_code: string };
    expect(detail.reason_code).toBe("no_observation_evidence");
  });

  it("a PERMANENT failure → `dead_lettered` on attempt 1, not `failed` (043 §5.2)", async () => {
    const { result, terminal } = await drainWith({ status: "failed", permanent: true });
    expect(result.deadLettered).toBe(1);
    expect(result.failed).toBe(0);
    const detail = JSON.parse(terminal[0]!.values![4] as string) as { reason_code: string };
    expect(detail.reason_code).toBe("permanent_provider_error");
  });

  it("a transient failure → `failed`, which is NOT terminal and so becomes due again", async () => {
    const { result, terminal } = await drainWith({ status: "failed", detail: { http_status: 502 } });
    expect(result.failed).toBe(1);
    expect(terminal[0]!.values![3]).toBe("failed");
  });

  it("a thrown consumer records the error CLASS and never the message", async () => {
    // An exception string is prose that can carry a response body, a token or a
    // shop's content. `detail` is allowlisted precisely so it cannot.
    const { terminal } = await drainWith(() => {
      throw new TypeError("shop 'Gotham City Limit' token shpat-SECRET rejected");
    });
    const detail = JSON.parse(terminal[0]!.values![4] as string) as Record<string, unknown>;
    expect(detail.error_class).toBe("TypeError");
    expect(JSON.stringify(detail)).not.toContain("shpat-SECRET");
    expect(JSON.stringify(detail)).not.toContain("Gotham");
  });

  it("an unregistered event dead-letters immediately — retrying cannot register a handler", async () => {
    const { pool, calls } = poolFor({ ...claimRow, event: "longbox.commerce.draft_recorded" });
    const result = await drainOnce(pool, createConsumerRegistry(), DEFAULT_OUTBOX_PARAMS);
    expect(result.deadLettered).toBe(1);
    const terminal = calls.find(
      (c) => c.text.includes("INSERT INTO outbox_attempt") && !c.text.includes("'started'")
    )!;
    const detail = JSON.parse(terminal.values![4] as string) as { reason_code: string };
    expect(detail.reason_code).toBe("no_consumer_registered");
  });

  it("claims nothing and does nothing on an empty queue", async () => {
    const { pool } = poolFor(null);
    const registry = createConsumerRegistry();
    registry.register(DRAFT_REQUESTED, async () => ({ status: "delivered" }));
    expect(await drainOnce(pool, registry, DEFAULT_OUTBOX_PARAMS)).toEqual({
      claimed: 0,
      delivered: 0,
      failed: 0,
      deadLettered: 0,
    });
  });
});

describe("the poller (043 §7.1, §11 I20)", () => {
  it("is an unref'd setInterval returning a stop function — the detector's shape, reused", async () => {
    // 041 §9.2 item 4's reasoning about the trigger list, applied to a runtime
    // pattern: a second spelling of one thing is how two things start to drift.
    vi.useFakeTimers();
    try {
      const { pool } = fakeTxPool(() => ({ rows: [] }));
      const lines: string[] = [];
      const stop = startOutboxPoller(pool, createConsumerRegistry(), DEFAULT_OUTBOX_PARAMS, {
        info: (m) => lines.push(m),
        error: (m) => lines.push(m),
      });
      await vi.advanceTimersByTimeAsync(DEFAULT_OUTBOX_PARAMS.pollIntervalMs + 1);
      // The heartbeat fires on EVERY cycle, including an empty one — a heartbeat
      // that only beats when there is work is not a heartbeat.
      expect(lines.some((l) => l.startsWith("[outbox] drain cycle ok: claimed=0"))).toBe(true);
      stop();
      const before = lines.length;
      await vi.advanceTimersByTimeAsync(DEFAULT_OUTBOX_PARAMS.pollIntervalMs * 3);
      expect(lines.length).toBe(before); // stopped means stopped
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs a cycle that could not run rather than letting the rejection escape", async () => {
    vi.useFakeTimers();
    try {
      const pool = {
        async connect() {
          throw new Error("pool exhausted");
        },
      } as unknown as pg.Pool;
      const lines: string[] = [];
      const stop = startOutboxPoller(pool, createConsumerRegistry(), DEFAULT_OUTBOX_PARAMS, {
        info: () => undefined,
        error: (m) => lines.push(m),
      });
      await vi.advanceTimersByTimeAsync(DEFAULT_OUTBOX_PARAMS.pollIntervalMs + 1);
      expect(lines[0]).toContain("drain cycle could not run");
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
