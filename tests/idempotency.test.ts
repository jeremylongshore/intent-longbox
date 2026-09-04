// L3: the idempotency mechanism, against a fake pool (042 §5).
//
// The DATABASE half — that a concurrent same-key request BLOCKS on the unique
// constraint and can never observe a partial row — is in
// `tests/integration/request-idempotency.test.ts`, because a constraint is the
// thing under test there and a fake cannot have one. What is provable here is
// everything the fake CAN decide: the canonical hash, the fixed statement order
// inside the transaction, the replay, the 422 and the held connection.
import { describe, expect, it } from "vitest";
import {
  canonicalize,
  isUniqueViolation,
  requestHash,
  runIdempotent,
  type IdempotentRequest,
} from "../src/services/idempotency.js";
import { fakeTxPool, pgError } from "./fakes.js";

const REQ: IdempotentRequest = {
  shopId: "11111111-1111-4111-8111-111111111111",
  idempotencyKey: "key-1",
  route: "/api/v1/shops/:shopId/scan-sessions/:id/confirm",
  method: "POST",
  params: { shopId: "11111111-1111-4111-8111-111111111111", id: "s-1" },
  body: { issue: { title: "Hulk" }, source: "one_tap" },
};

describe("canonicalize (042 §5.4 — part of the v1 contract, not an implementation detail)", () => {
  it("sorts object keys at every depth so key order cannot change a hash", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalize({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("preserves ARRAY order, because an array's order is content", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("drops undefined values but keeps null, which is a value a client sent", () => {
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
  });
});

describe("requestHash", () => {
  it("is stable across key orderings of the same body", () => {
    const a = requestHash({ ...REQ, body: { source: "one_tap", issue: { title: "Hulk" } } });
    expect(requestHash(REQ)).toBe(a);
  });

  it("changes when `against` changes — which is what makes A9's rule enforceable", () => {
    // 042 A9: refreshing after a 409 and re-submitting is a NEW ACT. `against`
    // is in the BODY (§6.2) precisely so the hash moves with it, which turns
    // "mint a new key" from a rule someone remembers into a 422 if they do not.
    const moved = requestHash({
      ...REQ,
      body: { ...(REQ.body as object), against: { table: "llm_rerank", id: "r-1" } },
    });
    expect(moved).not.toBe(requestHash(REQ));
  });

  it("changes with the route template and with the method", () => {
    expect(requestHash({ ...REQ, route: "/api/v1/x" })).not.toBe(requestHash(REQ));
    expect(requestHash({ ...REQ, method: "PUT" })).not.toBe(requestHash(REQ));
  });

  it("is a SHA-256 hex digest — the class 041 A5 pins, never a fuzzy comparison", () => {
    expect(requestHash(REQ)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("runIdempotent", () => {
  it("INSERTs the idempotency row FIRST, inside the transaction, before any work (042 I22)", async () => {
    const { pool, clients } = fakeTxPool((text) => {
      if (text.includes("INSERT INTO request_idempotency")) return { rows: [{ id: "idem-1" }] };
      return undefined;
    });
    await runIdempotent(pool, REQ, async (tx) => {
      await tx.query("SELECT 1 FROM scan_session WHERE id = $1 FOR UPDATE", ["s-1"]);
      return { status: 201, body: { ok: true } };
    });
    const seen = clients[0]!.calls.map((c) => c.text.trim().slice(0, 24));
    // BEGIN, the identity, the subject, the work's completion, COMMIT. The
    // identity is second only to BEGIN, in every handler, always.
    expect(seen[0]).toBe("BEGIN");
    expect(seen[1]).toContain("INSERT INTO request_idem");
    expect(seen[2]).toContain("SELECT 1 FROM scan_sessi");
    expect(seen[3]).toContain("UPDATE request_idempoten");
    expect(seen[4]).toBe("COMMIT");
  });

  it("runs every statement on ONE held connection (042 I21)", async () => {
    const { pool, clients, calls } = fakeTxPool((text) =>
      text.includes("INSERT INTO request_idempotency") ? { rows: [{ id: "idem-1" }] } : undefined
    );
    await runIdempotent(pool, REQ, async (tx) => {
      await tx.query("SELECT 1", []);
      return { status: 201, body: null };
    });
    // Exactly one checkout, and the only statement NOT on it is the pre-read.
    expect(clients).toHaveLength(1);
    expect(clients[0]!.released).toBe(true);
    const poolLevel = calls.filter((c) => !clients[0]!.calls.includes(c));
    expect(poolLevel.map((c) => c.text)).toEqual([
      expect.stringContaining("SELECT request_hash, response_status, response_body"),
    ]);
  });

  it("replays a committed response without opening a transaction or doing the work", async () => {
    let worked = 0;
    const { pool, clients } = fakeTxPool((text) => {
      if (text.includes("SELECT request_hash")) {
        return {
          rows: [{ request_hash: requestHash(REQ), response_status: 201, response_body: { id: "c-1" } }],
        };
      }
      return undefined;
    });
    const out = await runIdempotent(pool, REQ, async () => {
      worked += 1;
      return { status: 201, body: { id: "c-2" } };
    });
    expect(out).toEqual({ status: 201, body: { id: "c-1" }, replayed: true });
    // 033 §5.1, quoted at 035:316 — "a retry appends; it can never silently
    // overwrite an earlier attempt". The second call writes NOTHING AT ALL.
    expect(worked).toBe(0);
    expect(clients).toHaveLength(0);
  });

  it("refuses the same key with a different body: 422 IDEMPOTENCY_KEY_REUSED", async () => {
    const { pool } = fakeTxPool((text) =>
      text.includes("SELECT request_hash")
        ? { rows: [{ request_hash: "a-different-hash", response_status: 201, response_body: {} }] }
        : undefined
    );
    await expect(runIdempotent(pool, REQ, async () => ({ status: 201, body: null }))).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      status: 422,
    });
  });

  it("on a unique violation it re-reads and replays — step 3 of §5.3", async () => {
    let inserts = 0;
    const { pool } = fakeTxPool((text) => {
      if (text.includes("INSERT INTO request_idempotency")) {
        inserts += 1;
        throw pgError("23505");
      }
      if (text.includes("SELECT request_hash")) {
        // Empty on the pre-read (the winner had not committed yet), populated on
        // the re-read after the loser's insert conflicted.
        return inserts === 0
          ? { rows: [] }
          : {
              rows: [{ request_hash: requestHash(REQ), response_status: 201, response_body: { id: "won" } }],
            };
      }
      return undefined;
    });
    const out = await runIdempotent(pool, REQ, async () => ({ status: 201, body: { id: "lost" } }));
    expect(out).toEqual({ status: 201, body: { id: "won" }, replayed: true });
  });

  it("refuses to invent a replay when a CONFLICTING row has no response (I21's signature)", async () => {
    const { pool } = fakeTxPool((text) => {
      if (text.includes("INSERT INTO request_idempotency")) throw pgError("23505");
      if (text.includes("SELECT request_hash")) {
        return { rows: [{ request_hash: requestHash(REQ), response_status: null, response_body: null }] };
      }
      return undefined;
    });
    // §5.3's "there is no in-flight state" holds ONLY if the connection is held
    // for the request's lifetime. A row that conflicts and carries no response
    // means it was not — so the failure is LOUD rather than a silent duplicate,
    // or a replay of a response nobody produced.
    await expect(runIdempotent(pool, REQ, async () => ({ status: 201, body: null }))).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("stores NOTHING when the handler throws, so the key is free for a fresh act", async () => {
    const { pool, clients } = fakeTxPool((text) =>
      text.includes("INSERT INTO request_idempotency") ? { rows: [{ id: "idem-1" }] } : undefined
    );
    await expect(
      runIdempotent(pool, REQ, async () => {
        throw new Error("gate refused");
      })
    ).rejects.toThrow("gate refused");
    // §5.3 step 4: nothing happened, so nothing should be replayed. The
    // transaction rolls back and takes the idempotency row with it.
    expect(clients[0]!.calls.map((c) => c.text)).toContain("ROLLBACK");
    expect(clients[0]!.calls.some((c) => c.text.includes("UPDATE request_idempotency"))).toBe(false);
  });

  it("does not swallow an unrelated database error as a replay", async () => {
    const { pool } = fakeTxPool((text) => {
      if (text.includes("INSERT INTO request_idempotency")) throw pgError("23503");
      return undefined;
    });
    await expect(runIdempotent(pool, REQ, async () => ({ status: 201, body: null }))).rejects.toMatchObject({
      code: "23503",
    });
  });
});

describe("isUniqueViolation", () => {
  it("recognises 23505 and nothing else", () => {
    expect(isUniqueViolation(pgError("23505"))).toBe(true);
    expect(isUniqueViolation(pgError("40001"))).toBe(false);
    expect(isUniqueViolation(new Error("plain"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
