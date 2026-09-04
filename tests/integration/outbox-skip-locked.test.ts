// L4 integration — 043 §11 I12 and I13, ADVERSARIAL (A9).
//
// WHY THIS FILE HAS TO BE ADVERSARIAL AND NOT RUN-TWICE-ASSERT-ONCE. 043 §2.2(c)
// rejects a hardened queue library (pg-boss, graphile-worker) as a DECISION
// constrained by locked decision 4 — a library's job schema is mutable by
// design, lives outside `migrations/`, and cannot be brought inside 041 §9.2's
// declared trigger set at all. The cannon upgraded that rejection and attached a
// bill (A9, Hickey 5):
//
//   "§11 I5 and I13 stand in for the concurrency suite a hardened library would
//    have shipped, and they are therefore required to be ADVERSARIAL rather than
//    run-twice-assert-once: crash mid-attempt, two pollers racing one row, a
//    poller that dies after claiming and before its terminal write. A test that
//    merely calls the handler twice and asserts one row would leave this decision
//    unpaid for."
//
// So: (a) two concurrent claimers over a seeded queue, (b) A1's overlapping-
// visibility-window property, (c) a poller killed after the claim and before its
// terminal write, and (d) a deliberately SPLIT-TRANSACTION fixture claimer that
// makes (b) FAIL — 029 §5 move 8's "prove the gate can fail".
//
// Bead: longbox-e5b.2.17 (E02-D07). Docs: 043 §2.4, §5.4, §7.2, A1, A7, A9, §11 I12, I13.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import { createScanSession } from "../../src/services/scanSession.js";
import {
  claimBatch,
  claimQuerySql,
  DEFAULT_OUTBOX_PARAMS,
  enqueue,
  recordAttempt,
  type OutboxParams,
} from "../../src/services/outbox.js";
import { DRAFT_REQUESTED } from "../../src/events/catalogue.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

// A one-second visibility window so the expiry cases finish in a test's lifetime.
// The PROVISIONAL production value is five minutes (043 §5.4) and is NOT what is
// under test here — what is under test is that the LEASE IS A PREDICATE, and a
// predicate does not care what its constant is.
const FAST: OutboxParams = {
  ...DEFAULT_OUTBOX_PARAMS,
  attemptVisibilityMs: 1_000,
  backoffBaseMs: 500,
  backoffCeilingMs: 2_000,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!dbUp)("the derived lease and SKIP LOCKED (043 §2.4, §7.2)", () => {
  let pool: pg.Pool;
  let shopId: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_e02d07_skiplocked");
    await runMigrations(url);
    // Sized so a blocked transaction cannot starve its own test: every case
    // below holds at most three connections at once.
    pool = new pg.Pool({ connectionString: appUrl(url), max: 8 });
    shopId = await seedShop(pool, { name: "SkipLocked Shop" });
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function seedJob(): Promise<string> {
    const sessionId = (await createScanSession(pool, shopId, "employee")).id;
    const res = await withTransaction(pool, (tx) =>
      enqueue(tx, { shopId, event: DRAFT_REQUESTED, scanSessionId: sessionId, authoredBy: "human" })
    );
    return res.id;
  }

  const attemptsOf = async (outboxId: string) =>
    (
      await pool.query(
        `SELECT attempt_no, kind, created_at FROM outbox_attempt
          WHERE outbox_id = $1 ORDER BY created_at, id`,
        [outboxId]
      )
    ).rows as Array<{ attempt_no: number; kind: string; created_at: Date }>;

  it("claims a fresh row exactly once and writes its `started` attempt", async () => {
    const id = await seedJob();
    const claims = await claimBatch(pool, FAST, { shopId });
    expect(claims.map((c) => c.outboxId)).toContain(id);
    expect((await attemptsOf(id)).map((a) => a.kind)).toEqual(["started"]);
  });

  it("does NOT re-claim a row whose `started` attempt is still inside the window", async () => {
    const id = await seedJob();
    await claimBatch(pool, FAST, { shopId });
    const second = await claimBatch(pool, FAST, { shopId });
    expect(second.map((c) => c.outboxId)).not.toContain(id);
  });

  it("I12: a stale claim needs NO reaper — the row becomes eligible when the predicate's inputs change", async () => {
    // Nothing runs in between. There is no sweeper, no cron and no repair job,
    // and this test asserts that by simply waiting: a fact about the past stops
    // satisfying a predicate about the present.
    const id = await seedJob();
    const first = await claimBatch(pool, FAST, { shopId });
    expect(first.map((c) => c.outboxId)).toContain(id);

    expect((await claimBatch(pool, FAST, { shopId })).map((c) => c.outboxId)).not.toContain(id);
    await sleep(FAST.attemptVisibilityMs + 250);
    const after = await claimBatch(pool, FAST, { shopId });
    expect(after.map((c) => c.outboxId)).toContain(id);

    // The lost attempt is still on the record: a `started` row with no terminal
    // partner IS the record of a crash, readable by a human without a log
    // (043 §5.1). Nothing wrote a "recovery" row.
    const kinds = (await attemptsOf(id)).map((a) => a.kind);
    expect(kinds).toEqual(["started", "started"]);
    expect(kinds).not.toContain("recovered");
  });

  it("I13(c) ADVERSARIAL: a poller killed AFTER the claim and BEFORE its terminal write", async () => {
    // The failure mode a run-twice test never reaches. The worker holds a claim
    // and dies; nothing writes `delivered` or `failed`; the attempt count must
    // still record that a try happened, and the row must come back.
    const id = await seedJob();
    const claim = (await claimBatch(pool, FAST, { shopId })).find((c) => c.outboxId === id)!;
    expect(claim.attemptNo).toBe(1);
    // ...the process dies here. No terminal row is written.
    await sleep(FAST.attemptVisibilityMs + 250);
    const retry = (await claimBatch(pool, FAST, { shopId })).find((c) => c.outboxId === id)!;
    // 043 §5.1: without the `started` row the attempt count would UNDERCOUNT
    // exactly the failures that matter most — the ones that killed the worker —
    // and the ceiling would never be reached by the class of failure most likely
    // to be systemic.
    expect(retry.attemptNo).toBe(2);
  });

  it("a terminal row is never claimed again — `delivered` and `dead_lettered` both end it", async () => {
    for (const kind of ["delivered", "dead_lettered"] as const) {
      const id = await seedJob();
      const claim = (await claimBatch(pool, FAST, { shopId })).find((c) => c.outboxId === id)!;
      await recordAttempt(pool, { shopId, outboxId: id, attemptNo: claim.attemptNo, kind });
      await sleep(FAST.attemptVisibilityMs + 250);
      expect((await claimBatch(pool, FAST, { shopId })).map((c) => c.outboxId)).not.toContain(id);
    }
  });

  it("a `failed` row is NOT terminal, but is not due until its backoff elapses (043 §5.2)", async () => {
    const id = await seedJob();
    const claim = (await claimBatch(pool, FAST, { shopId })).find((c) => c.outboxId === id)!;
    await recordAttempt(pool, { shopId, outboxId: id, attemptNo: claim.attemptNo, kind: "failed" });

    // Immediately after the failure the backoff has not elapsed even at its
    // minimum jitter (0.5 x 500 ms), so the row is not due.
    expect((await claimBatch(pool, FAST, { shopId })).map((c) => c.outboxId)).not.toContain(id);
    // After the MAXIMUM jitter (1.5 x 500 ms) it must be due whatever random()
    // returned — asserting past the whole jitter range rather than flaking on it.
    await sleep(Math.ceil(FAST.backoffBaseMs * 1.5) + 250);
    expect((await claimBatch(pool, FAST, { shopId })).map((c) => c.outboxId)).toContain(id);
  });

  it("I13(a): two CONCURRENT claimers partition the queue — the second SKIPS, never blocks", async () => {
    const ids = [await seedJob(), await seedJob(), await seedJob(), await seedJob()];
    const [a, b] = await Promise.all([
      claimBatch(pool, FAST, { shopId, limit: 4 }),
      claimBatch(pool, FAST, { shopId, limit: 4 }),
    ]);
    const claimedA = a.map((c) => c.outboxId);
    const claimedB = b.map((c) => c.outboxId);

    // Every row claimed exactly once...
    const all = [...claimedA, ...claimedB];
    expect(new Set(all).size).toBe(all.length);
    // ...and the union covers the whole eligible set. `SKIP LOCKED` means the
    // second claimer takes DIFFERENT rows rather than waiting for the first,
    // which is the whole of the multi-process story: no lease table, no worker
    // registry, no partitioning, no leader election.
    for (const id of ids) expect(all).toContain(id);
  });

  it("I13(b) A1: no two `started` rows for one outbox_id have OVERLAPPING visibility windows", async () => {
    // THE MECHANICAL FORM OF 043 §2.4's ATOMICITY DECISION, and the assertion
    // that FOUND A REAL DEFECT rather than merely restating one.
    //
    // ⚠ THIS TEST FAILED IN CI AND PASSED LOCALLY, which is the shape A9 warned
    // about — "an intermittent failure that reproduces on nobody's laptop". The
    // cause was not the claim/`started` transaction boundary, which was correct:
    // it was that READ COMMITTED gives every STATEMENT its own snapshot, so a
    // claimer whose SELECT began before a rival's COMMIT evaluated "not in
    // flight" against a snapshot with no rival `started` row in it — and by the
    // time it examined the row, the rival's lock was already gone. Postgres'
    // EvalPlanQual re-check does not cover it, because the rival modified a CHILD
    // table and not the locked row. `claimBatch` now re-checks terminal and
    // in-flight in a SECOND statement once the locks are held.
    //
    // The loop below is the regression guard: a single round reproduced the bug
    // only on a loaded CI runner, so the race is now run repeatedly with more
    // claimers than rows, which is the configuration that maximises contention.
    const ids: string[] = [];
    for (let round = 0; round < 6; round += 1) {
      const roundIds = await Promise.all([seedJob(), seedJob(), seedJob()]);
      ids.push(...roundIds);
      // Four claimers for three rows: every claimer that finds nothing free is
      // one more chance to observe a stale snapshot of somebody else's claim.
      await Promise.all([
        claimBatch(pool, FAST, { shopId, limit: 3 }),
        claimBatch(pool, FAST, { shopId, limit: 3 }),
        claimBatch(pool, FAST, { shopId, limit: 3 }),
        claimBatch(pool, FAST, { shopId, limit: 3 }),
      ]);
    }

    for (const id of ids) {
      const started = (await attemptsOf(id)).filter((a) => a.kind === "started");
      const windows = started.map((a) => ({
        from: a.created_at.getTime(),
        to: a.created_at.getTime() + FAST.attemptVisibilityMs,
      }));
      for (let i = 0; i < windows.length; i += 1) {
        for (let j = i + 1; j < windows.length; j += 1) {
          const overlap = windows[i]!.from < windows[j]!.to && windows[j]!.from < windows[i]!.to;
          expect(overlap, `two started rows for ${id} overlap: ${JSON.stringify(windows)}`).toBe(false);
        }
      }
    }
  });

  it("I13(d): a SPLIT-TRANSACTION claimer makes (b) FAIL — proving the assertion can fail", async () => {
    // 029 §5 move 8: prove the gate can fail. This fixture is the FORBIDDEN
    // shape from 043 §7.2's diagram — claim in one transaction, `started` in
    // another. The lock is released before the log records the claim, so a
    // second claimer sees a row that is not terminal, not in flight and due, and
    // takes it. Both then hold overlapping visibility windows.
    const id = await seedJob();

    /** Phase 1 of the FORBIDDEN shape: take the lock and give it straight back. */
    async function pick(): Promise<string | undefined> {
      return withTransaction(pool, async (tx) => {
        const res = await tx.query(claimQuerySql(), [
          FAST.attemptVisibilityMs,
          FAST.backoffBaseMs,
          FAST.backoffCeilingMs,
          1,
          shopId,
        ]);
        return (res.rows[0] as { id: string } | undefined)?.id;
      });
      // ...the transaction COMMITS here, so the lock is gone and the log says
      // NOTHING about the claim. That is the whole defect.
    }

    /** Phase 2: the `started` row, far too late to have held anything. */
    async function writeStarted(outboxId: string): Promise<void> {
      const next = Number(
        (
          await pool.query(
            `SELECT coalesce(max(attempt_no),0) + 1 AS n FROM outbox_attempt WHERE outbox_id = $1`,
            [outboxId]
          )
        ).rows[0]!.n
      );
      await pool.query(
        `INSERT INTO outbox_attempt (shop_id, outbox_id, attempt_no, kind, authored_by)
         VALUES ($1,$2,$3,'started','system')`,
        [shopId, outboxId, next]
      );
    }

    // Sequenced rather than raced, so the demonstration is deterministic: under
    // `Promise.all` the two SELECTs would overlap and SKIP LOCKED would still
    // protect them, which would prove the lock works and say nothing about the
    // boundary. The bug needs A's transaction to have COMMITTED — releasing the
    // lock — before B looks.
    const a = await pick();
    const b = await pick();

    // ⚠ BOTH CLAIMERS TOOK THE SAME ROW. B saw a row that was not terminal, not
    // in flight (no `started` exists yet) and due.
    expect(a).toBe(id);
    expect(b).toBe(id);

    await writeStarted(a!);
    await writeStarted(b!);

    const started = (await attemptsOf(id)).filter((a2) => a2.kind === "started");
    expect(started.length).toBe(2); // two live attempts on one row
    const windows = started.map((a) => ({
      from: a.created_at.getTime(),
      to: a.created_at.getTime() + FAST.attemptVisibilityMs,
    }));
    const overlap = windows[0]!.from < windows[1]!.to && windows[1]!.from < windows[0]!.to;
    // The property asserted two tests above is FALSE here. That is the point:
    // an assertion that cannot fail is not evidence of anything, and this shows
    // exactly which line of `claimBatch` is load-bearing.
    expect(overlap).toBe(true);
  });
});
