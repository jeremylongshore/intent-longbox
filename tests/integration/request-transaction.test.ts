// L4: the request transaction (041 §4) against a real Postgres — the five
// properties that a fake client cannot show.
//
//  (a) Atomicity: a failure AFTER an append rolls the append back, so no
//      scan_session ever holds a half-written Hickey chain (029 §12, 040 §5.3's
//      risk, I14's shape).
//  (b) The anchor lock serialises two concurrent confirms on one session: the
//      second waits, then reads the first's committed row. No lost update.
//  (c) 041 §4.2's G-c decision, proved in both directions: a retention_hold
//      inserted by a transaction that TAKES the session lock cannot interleave
//      between the draft path's check and its write; one that does NOT take the
//      lock CAN. The lock discipline is the guard — the schema does not supply
//      it. (Wiring the hold-placement route is E02-B08 / E03's.)
//  (d) The retry: an injected 40001 on the first attempt succeeds on the second.
//  (e) 042 §5.3(a) / A5's held-connection precondition: an artificially delayed
//      first transaction BLOCKS a second on the same anchor until it commits.
//
// Bead longbox-e5b.2.14 (E02-D04). Docs: 041 §4, §5.3, §10 step 1; 040 A5,
// §5.3; 042 §5.3(a)/(b), A5; 029 §12.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction, withTransactionResult } from "../../src/db.js";
import {
  createScanSession,
  insertHumanConfirmation,
  insertShopifyDraft,
  assignSessionSeq,
  lockScanSession,
  setSessionStatus,
} from "../../src/services/scanSession.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

const ISSUE = { title: "Hulk", issue: "181" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!dbUp)("the request transaction (041 §4)", () => {
  let pool: pg.Pool;
  let shopId: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_e02d04_request_tx_test");
    await runMigrations(url);
    // The pool connects as `longbox_app` (E02-D06), NOT as the migrate role that
    // owns the schema — because that is what the server connects as, and a
    // concurrency guard proved under a more privileged role than production uses
    // is a guard proved against the wrong principal. Everything this suite does
    // is within the app role's grants by design: `SELECT … FOR UPDATE` and the
    // appends need SELECT+INSERT on append-only tables, the status write needs
    // UPDATE on `scan_session` (a declared exemption with full DML), and
    // `seedShop` needs INSERT on `shop` / `shop_pricing_policy` (likewise). No
    // case here needs DDL: the 40001 is injected from JavaScript, not provoked
    // through the database, so no step escalates to the owner connection.
    //
    // A small pool, sized so a blocked transaction cannot starve its own test:
    // every case below holds at most two connections at once.
    pool = new pg.Pool({ connectionString: appUrl(url), max: 6 });
    shopId = await seedShop(pool, { name: "Transaction Test Shop" });
  });

  afterAll(async () => {
    await pool?.end();
  });

  const newSession = async () => (await createScanSession(pool, shopId)).id;

  const countConfirmations = async (sessionId: string) =>
    Number(
      (
        await pool.query(`SELECT count(*)::int AS n FROM human_confirmation WHERE scan_session_id = $1`, [
          sessionId,
        ])
      ).rows[0].n
    );

  const statusOf = async (sessionId: string) =>
    (await pool.query(`SELECT status FROM scan_session WHERE id = $1`, [sessionId])).rows[0].status;

  // --- (a) atomicity ---------------------------------------------------------

  it("rolls the append back when the request fails after it (no half-written chain)", async () => {
    const sessionId = await newSession();
    const boom = new Error("draft composition blew up after the insert");

    await expect(
      withTransaction(pool, async (tx) => {
        await lockScanSession(tx, shopId, sessionId);
        await insertHumanConfirmation(tx, {
          sessionId,
          shopId,
          confirmedIssue: ISSUE,
          source: "one_tap",
          outcome: "confirm",
          sessionSeq: 1,
        });
        await setSessionStatus(tx, shopId, sessionId, "confirmed");
        throw boom; // anything downstream: a provider 500, a bug, a crash
      })
    ).rejects.toBe(boom);

    // Neither half survived: not the immutable append, not the status write.
    expect(await countConfirmations(sessionId)).toBe(0);
    expect(await statusOf(sessionId)).toBe("in_progress");
  });

  it("commits the append and the status write together", async () => {
    const sessionId = await newSession();
    await withTransaction(pool, async (tx) => {
      await lockScanSession(tx, shopId, sessionId);
      await insertHumanConfirmation(tx, {
        sessionId,
        shopId,
        confirmedIssue: ISSUE,
        source: "one_tap",
        outcome: "confirm",
        sessionSeq: 2,
      });
      await setSessionStatus(tx, shopId, sessionId, "confirmed");
    });
    expect(await countConfirmations(sessionId)).toBe(1);
    expect(await statusOf(sessionId)).toBe("confirmed");
  });

  // --- (b) the anchor lock serialises concurrent writers ---------------------

  it("serialises two concurrent confirms on one session — the second reads the first's row", async () => {
    const sessionId = await newSession();
    const order: string[] = [];

    // Each confirm reads the prior confirmation (the T20 baseline) and then
    // appends. Without the anchor lock both read "no prior" and both append a
    // 'correct' — the lost update this test exists to make impossible.
    const confirm = async (tag: string, holdMs: number) =>
      withTransaction(pool, async (tx) => {
        await lockScanSession(tx, shopId, sessionId);
        order.push(`${tag}:locked`);
        const prior = await tx.query(
          `SELECT confirmed_issue FROM human_confirmation WHERE scan_session_id = $1
           ORDER BY created_at DESC, id DESC LIMIT 1`,
          [sessionId]
        );
        await sleep(holdMs);
        await insertHumanConfirmation(tx, {
          sessionId,
          shopId,
          confirmedIssue: { ...ISSUE, by: tag },
          source: "grid_pick",
          outcome: prior.rowCount === 0 ? "correct" : "confirm",
          // 041 §5.3, assigned under the anchor lock taken above. A literal here
          // COLLIDES on `human_confirmation_session_seq_idx` once both writers land
          // in one session — which is the counter's guard doing exactly its job, and
          // the reason the assignment belongs inside the transaction rather than at
          // the call site.
          sessionSeq: await assignSessionSeq(tx, shopId, sessionId),
        });
        order.push(`${tag}:committed`);
        return prior.rowCount ?? 0;
      });

    const first = confirm("A", 250);
    await sleep(60); // let A take the lock before B tries
    const second = confirm("B", 0);
    const [priorSeenByA, priorSeenByB] = await Promise.all([first, second]);

    expect(priorSeenByA).toBe(0); // A went first: nothing was there
    expect(priorSeenByB).toBe(1); // B waited and SAW A's committed row
    // B did not even reach its lock until A had committed.
    expect(order).toEqual(["A:locked", "A:committed", "B:locked", "B:committed"]);

    const outcomes = await pool.query(
      `SELECT outcome FROM human_confirmation WHERE scan_session_id = $1 ORDER BY created_at, id`,
      [sessionId]
    );
    expect(outcomes.rows.map((r: { outcome: string }) => r.outcome)).toEqual(["correct", "confirm"]);
  });

  // --- (c) the G-c hold decision, proved in BOTH directions ------------------

  const placeHold = async (tx: pg.PoolClient, sessionId: string) =>
    tx.query(
      `INSERT INTO retention_hold (shop_id, target_table, target_id, reason, review_date)
       VALUES ($1, 'scan_session', $2, 'litigation', current_date + 30)`,
      [shopId, sessionId]
    );

  const openHoldCount = async (sessionId: string) =>
    Number(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM retention_hold h
           WHERE h.target_table = 'scan_session' AND h.target_id = $1
             AND NOT EXISTS (SELECT 1 FROM retention_hold_release r WHERE r.hold_id = h.id)`,
          [sessionId]
        )
      ).rows[0].n
    );

  it("a hold placed UNDER the session lock cannot interleave between the draft's check and its write", async () => {
    const sessionId = await newSession();
    const events: string[] = [];

    // The draft path: check for an open hold, do some work, then write.
    const draft = withTransaction(pool, async (tx) => {
      await lockScanSession(tx, shopId, sessionId);
      const holds = await tx.query(
        `SELECT id FROM retention_hold WHERE target_table = 'scan_session' AND target_id = $1`,
        [sessionId]
      );
      events.push(`draft:checked:${holds.rowCount}`);
      await sleep(300); // the window a racing hold would slip through
      await insertShopifyDraft(tx, {
        sessionId,
        shopId,
        productGid: "gid://shopify/Product/1",
        status: "draft",
        error: null,
        sessionSeq: 4,
      });
      await setSessionStatus(tx, shopId, sessionId, "drafted");
      events.push("draft:committed");
    });

    await sleep(60);
    // 041 §4.2's decision: the hold-placement path takes the SAME anchor lock.
    const hold = withTransaction(pool, async (tx) => {
      await lockScanSession(tx, shopId, sessionId);
      await placeHold(tx, sessionId);
      events.push("hold:committed");
    });

    await Promise.all([draft, hold]);
    // The hold landed strictly after the draft committed — the interleaving is
    // blocked by construction, not merely improbable.
    expect(events).toEqual(["draft:checked:0", "draft:committed", "hold:committed"]);
    expect(await openHoldCount(sessionId)).toBe(1);
  });

  it("a hold placed WITHOUT the session lock CAN interleave — the lock discipline is the guard", async () => {
    const sessionId = await newSession();
    const events: string[] = [];

    const draft = withTransaction(pool, async (tx) => {
      await lockScanSession(tx, shopId, sessionId);
      const holds = await tx.query(
        `SELECT id FROM retention_hold WHERE target_table = 'scan_session' AND target_id = $1`,
        [sessionId]
      );
      events.push(`draft:checked:${holds.rowCount}`);
      await sleep(300);
      await insertShopifyDraft(tx, {
        sessionId,
        shopId,
        productGid: "gid://shopify/Product/2",
        status: "draft",
        error: null,
        sessionSeq: 5,
      });
      events.push("draft:committed");
    });

    await sleep(60);
    // The negative: retention_hold is polymorphic (003:205-220) and has no FK
    // and no constraint tying it to the session, so nothing in the SCHEMA stops
    // this. It commits in the middle of the draft's check-to-write window —
    // the write skew 041 §4.2 names, reproduced.
    const hold = withTransaction(pool, async (tx) => {
      await placeHold(tx, sessionId);
      events.push("hold:committed");
    });

    await Promise.all([draft, hold]);
    expect(events).toEqual(["draft:checked:0", "hold:committed", "draft:committed"]);
    // The draft was composed against "no hold" and a hold now exists over it.
    expect(await openHoldCount(sessionId)).toBe(1);
  });

  // --- (d) the retry ---------------------------------------------------------

  it("retries an injected 40001 and succeeds on the second attempt", async () => {
    const sessionId = await newSession();
    let attemptsSeen = 0;

    const { value, attempts } = await withTransactionResult(pool, async (tx) => {
      attemptsSeen += 1;
      await lockScanSession(tx, shopId, sessionId);
      await insertHumanConfirmation(tx, {
        sessionId,
        shopId,
        confirmedIssue: ISSUE,
        source: "one_tap",
        outcome: "confirm",
        sessionSeq: 6,
      });
      if (attemptsSeen === 1) {
        const err = new Error("simulated serialization failure") as Error & { code: string };
        err.code = "40001";
        throw err;
      }
      return "committed";
    });

    expect(value).toBe("committed");
    expect(attempts).toBe(2);
    expect(attemptsSeen).toBe(2);
    // The rolled-back attempt left nothing behind: exactly one row, not two.
    // This is why the retry is sound only because `fn` has no side effect
    // outside the transaction (041 §4.1 / §4.5 — the two rules are one rule).
    expect(await countConfirmations(sessionId)).toBe(1);
  });

  it("does not retry a non-retryable failure and leaves nothing behind", async () => {
    const sessionId = await newSession();
    let attemptsSeen = 0;
    await expect(
      withTransaction(pool, async (tx) => {
        attemptsSeen += 1;
        await lockScanSession(tx, shopId, sessionId);
        await insertHumanConfirmation(tx, {
          sessionId,
          shopId,
          confirmedIssue: ISSUE,
          source: "one_tap",
          outcome: "not_a_valid_outcome", // trips the CHECK: 23514, not retryable
          sessionSeq: 7,
        });
      })
    ).rejects.toMatchObject({ code: "23514" });
    expect(attemptsSeen).toBe(1);
    expect(await countConfirmations(sessionId)).toBe(0);
  });

  // --- (e) the held-connection precondition (042 §5.3(a), A5) ----------------

  it("a delayed first transaction blocks a second on the same anchor until it commits", async () => {
    const sessionId = await newSession();
    let firstCommittedAt = 0;
    let secondAcquiredAt = 0;

    const first = withTransaction(pool, async (tx) => {
      await lockScanSession(tx, shopId, sessionId);
      await sleep(400); // the connection is HELD; the lock is held with it
      firstCommittedAt = Date.now();
    });

    await sleep(80);
    const second = withTransaction(pool, async (tx) => {
      await lockScanSession(tx, shopId, sessionId);
      secondAcquiredAt = Date.now();
    });

    await Promise.all([first, second]);
    // The second could not proceed until the first's COMMIT released the lock.
    // If the helper took a connection per statement instead of holding one, the
    // first's lock would have been released at the first statement boundary and
    // this ordering would not hold — that is 042 A5's whole point.
    expect(secondAcquiredAt).toBeGreaterThanOrEqual(firstCommittedAt);
  });

  it("locks per session, not per shop — a second session is never blocked", async () => {
    const [a, b] = [await newSession(), await newSession()];
    let bFinishedAt = 0;
    let aCommittedAt = 0;

    const holdA = withTransaction(pool, async (tx) => {
      await lockScanSession(tx, shopId, a);
      await sleep(300);
      aCommittedAt = Date.now();
    });
    await sleep(60);
    const touchB = withTransaction(pool, async (tx) => {
      await lockScanSession(tx, shopId, b);
      bFinishedAt = Date.now();
    });

    await Promise.all([holdA, touchB]);
    // Contention is one session — one book at one counter — never the shop.
    expect(bFinishedAt).toBeLessThan(aCommittedAt);
  });

  it("the anchor lock is shop-scoped: another shop's id locks nothing (T24)", async () => {
    const sessionId = await newSession();
    const otherShop = await seedShop(pool, { name: "Other Shop", slug: `other-${Date.now()}` });
    const locked = await withTransaction(pool, (tx) => lockScanSession(tx, otherShop, sessionId));
    expect(locked).toBeUndefined();
  });
});
