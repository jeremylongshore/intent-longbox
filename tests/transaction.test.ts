// Unit tests over the request-transaction helper (041 §4, bead E02-D04),
// against a fake pool that hands out recording clients. The Postgres
// integration lane (tests/integration/request-transaction.test.ts) covers the
// properties that only a real database can show: atomicity, the anchor lock's
// blocking, and the held-connection precondition.
import { describe, expect, it } from "vitest";
import { isRetryablePgError, withTransaction, withTransactionResult } from "../src/db.js";
import { fakeTxPool, pgError } from "./fakes.js";

describe("withTransaction", () => {
  it("BEGINs, runs fn and COMMITs on one client, then releases it", async () => {
    const { pool, calls, clients } = fakeTxPool();
    const value = await withTransaction(pool, async (tx) => {
      await tx.query("SELECT 1", []);
      return "ok";
    });
    expect(value).toBe("ok");
    expect(calls.map((c) => c.text)).toEqual(["BEGIN", "SELECT 1", "COMMIT"]);
    // ONE connection for the whole request (042 §5.3(a) / I21): a second
    // checkout would mean the sequence had been scattered across connections.
    expect(clients).toHaveLength(1);
    expect(clients[0]?.released).toBe(true);
  });

  it("does not nest: fn sees exactly one BEGIN, whatever it does", async () => {
    const { pool, calls } = fakeTxPool();
    await withTransaction(pool, async (tx) => {
      await tx.query("INSERT INTO a", []);
      await tx.query("INSERT INTO b", []);
    });
    expect(calls.filter((c) => c.text.startsWith("BEGIN"))).toHaveLength(1);
    expect(calls.filter((c) => c.text === "COMMIT")).toHaveLength(1);
  });

  it("opts into SERIALIZABLE only when asked (041 §4.2: READ COMMITTED default)", async () => {
    const { pool, calls } = fakeTxPool();
    await withTransaction(pool, async () => undefined, { isolation: "serializable" });
    expect(calls[0]?.text).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
  });

  it("ROLLBACKs and releases when fn throws, and rethrows the original error", async () => {
    const { pool, calls, clients } = fakeTxPool();
    const boom = new Error("service blew up");
    await expect(
      withTransaction(pool, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
    expect(calls.map((c) => c.text)).toEqual(["BEGIN", "ROLLBACK"]);
    expect(clients[0]?.released).toBe(true);
  });

  it("DESTROYS the connection when the ROLLBACK itself fails, and still rethrows the original", async () => {
    const rollbackErr = new Error("connection terminated");
    const { pool, clients } = fakeTxPool((text) => {
      if (text === "ROLLBACK") throw rollbackErr;
      return undefined;
    });
    const boom = new Error("original failure");
    // The rollback's own failure must not mask what actually went wrong...
    await expect(
      withTransaction(pool, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
    expect(clients[0]?.released).toBe(true);
    // ...but the connection is still inside an ABORTED transaction, so it must
    // be released WITH the error, which makes node-postgres destroy it. Returned
    // clean, it would answer the next request's every statement with 25P02.
    expect(clients[0]?.releasedWith).toBe(rollbackErr);
  });

  it("returns the connection to the pool (no error argument) on the ordinary paths", async () => {
    const { pool: okPool, clients: okClients } = fakeTxPool();
    await withTransaction(okPool, async () => undefined);
    expect(okClients[0]?.releasedWith).toBeUndefined();

    const { pool: failPool, clients: failClients } = fakeTxPool();
    await expect(
      withTransaction(failPool, async () => {
        throw new Error("fn failed but ROLLBACK succeeded");
      })
    ).rejects.toThrow();
    // A clean rollback leaves a healthy connection: reuse it, don't destroy it.
    expect(failClients[0]?.releasedWith).toBeUndefined();
  });

  it("does NOT retry an ordinary error", async () => {
    const { pool, clients } = fakeTxPool();
    let ran = 0;
    await expect(
      withTransaction(pool, async () => {
        ran += 1;
        throw new Error("unique violation, say");
      })
    ).rejects.toThrow("unique violation");
    expect(ran).toBe(1);
    expect(clients).toHaveLength(1);
  });

  it.each([
    ["40001", "serialization_failure"],
    ["40P01", "deadlock_detected"],
  ])("retries on %s (%s) and succeeds on the second attempt", async (code) => {
    const { pool, clients } = fakeTxPool();
    let ran = 0;
    const { value, attempts } = await withTransactionResult(pool, async () => {
      ran += 1;
      if (ran === 1) throw pgError(code);
      return "second";
    });
    expect(value).toBe("second");
    expect(attempts).toBe(2);
    // A retry gets a FRESH connection: the poisoned one is rolled back first.
    expect(clients).toHaveLength(2);
    expect(clients.every((c) => c.released)).toBe(true);
    expect(clients[0]?.calls.map((c) => c.text)).toEqual(["BEGIN", "ROLLBACK"]);
    expect(clients[1]?.calls.map((c) => c.text)).toEqual(["BEGIN", "COMMIT"]);
  });

  it("gives up after 3 attempts by default and rethrows the last error", async () => {
    const { pool, clients } = fakeTxPool();
    let ran = 0;
    await expect(
      withTransaction(pool, async () => {
        ran += 1;
        throw pgError("40001");
      })
    ).rejects.toMatchObject({ code: "40001" });
    expect(ran).toBe(3);
    expect(clients).toHaveLength(3);
    expect(clients.every((c) => c.released)).toBe(true);
  });

  it("honours a caller-supplied attempt budget", async () => {
    const { pool } = fakeTxPool();
    let ran = 0;
    await expect(
      withTransaction(
        pool,
        async () => {
          ran += 1;
          throw pgError("40P01");
        },
        { maxAttempts: 1 }
      )
    ).rejects.toMatchObject({ code: "40P01" });
    expect(ran).toBe(1);
  });

  it("reports attempts = 1 on a clean first commit", async () => {
    const { pool } = fakeTxPool();
    const { attempts } = await withTransactionResult(pool, async () => 42);
    expect(attempts).toBe(1);
  });

  it("refuses a nonsensical attempt budget rather than looping forever", async () => {
    const { pool } = fakeTxPool();
    await expect(withTransaction(pool, async () => 1, { maxAttempts: 0 })).rejects.toThrow(
      /maxAttempts must be a positive integer/
    );
  });
});

// 041 §4.5's guard is that every retry is COUNTED from day one, whatever
// `tx_max_retries` turns out to be — a retry rate nobody measures is a latency
// problem that arrives as a mystery. Returning the count is not counting it, so
// the helper logs, and these tests are what make the logging a fact.
describe("withTransaction retry logging", () => {
  it("logs each retry with the SQLSTATE, the attempt number and the label", async () => {
    const { pool } = fakeTxPool();
    const lines: string[] = [];
    let ran = 0;
    await withTransaction(
      pool,
      async () => {
        ran += 1;
        if (ran < 3) throw pgError("40001");
        return "ok";
      },
      { label: "confirm", log: (m) => lines.push(m) }
    );
    expect(lines).toHaveLength(3); // two retries + the "committed after" line
    expect(lines[0]).toBe("[tx] confirm: retrying after 40001 (attempt 1 of 3)");
    expect(lines[1]).toBe("[tx] confirm: retrying after 40001 (attempt 2 of 3)");
    expect(lines[2]).toBe("[tx] confirm: committed after 3 attempts (retried)");
  });

  it("says nothing on a clean first commit", async () => {
    const { pool } = fakeTxPool();
    const lines: string[] = [];
    await withTransaction(pool, async () => "ok", { label: "draft", log: (m) => lines.push(m) });
    expect(lines).toEqual([]);
  });

  it("logs the exhausted attempts too — a give-up is the loudest retry fact", async () => {
    const { pool } = fakeTxPool();
    const lines: string[] = [];
    await expect(
      withTransaction(
        pool,
        async () => {
          throw pgError("40P01");
        },
        { label: "draft", log: (m) => lines.push(m), maxAttempts: 2 }
      )
    ).rejects.toMatchObject({ code: "40P01" });
    // One retry line; no "committed" line, because it never committed.
    expect(lines).toEqual(["[tx] draft: retrying after 40P01 (attempt 1 of 2)"]);
  });

  it("falls back to a generic label rather than logging an anonymous retry", async () => {
    const { pool } = fakeTxPool();
    const lines: string[] = [];
    let ran = 0;
    await withTransaction(
      pool,
      async () => {
        ran += 1;
        if (ran === 1) throw pgError("40001");
        return "ok";
      },
      { log: (m) => lines.push(m) }
    );
    expect(lines[0]).toBe("[tx] transaction: retrying after 40001 (attempt 1 of 3)");
  });
});

describe("isRetryablePgError", () => {
  it("is true for 40001 and 40P01 and false for everything else", () => {
    expect(isRetryablePgError(pgError("40001"))).toBe(true);
    expect(isRetryablePgError(pgError("40P01"))).toBe(true);
    expect(isRetryablePgError(pgError("23505"))).toBe(false); // unique_violation
    expect(isRetryablePgError(new Error("no code"))).toBe(false);
    expect(isRetryablePgError(undefined)).toBe(false);
    expect(isRetryablePgError(null)).toBe(false);
  });
});
