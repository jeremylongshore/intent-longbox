// L4: 048 I10 — "a PIN is worthless off an enrolled device, and lockout is a
// delay that never closes."
//
// The write-skew case is the one that matters most and is the easiest to write
// wrong: N concurrent attempts must consume N budget, not one. 041 §4.2 named
// the anomaly; `operator_pin` is the anchor that closes it, and this suite runs
// the attempts concurrently rather than in a loop.
//
// **E03-D10 — WHAT A CONCURRENCY TEST MAY AND MAY NOT ASSERT.** The burst case
// below used to assert a COUNT: six concurrent wrong PINs must leave exactly
// `PAIR_FREE_ATTEMPTS + 1` rows. That number is the serialised outcome only
// while the whole burst's transaction timestamps fall inside the first backoff
// step (`BACKOFF_BASE_MS`), and under CPU starvation they do not: every failed
// attempt costs an argon2id verification (64 MiB, three passes, WASM, on the one
// Node event loop), so a loaded machine can push the fifth attempt's `BEGIN`
// seconds past the fourth attempt's `created_at` — at which point the 2s delay
// has genuinely elapsed and charging a fifth attempt is 048 §9.1 working as
// ratified ("refused *until*", never refused forever). Reproduced 3 failures in
// 8 bursts under 12 CPU hogs on an 8-core box, always as one extra row 5.1s to
// 28.2s after the previous one; never as a cluster.
//
// So the assertions here are stated over the RECORD rather than over the clock:
// `assertEveryFailureWasPermitted` re-runs the ratified policy at each recorded
// failure's own instant, given the failures that precede it. **What that buys,
// stated exactly rather than generously: any log the checker accepts is a log
// the policy would have authorised anyway.** It is not a proof that the lock was
// taken — a burst that never contended, or one whose charges already sit at or
// past their required delays, is accepted and should be, because nothing wrong
// happened. **The lock is proved by the case that holds the anchor row from a
// second connection** and watches the real `verifyOperatorPin` block on it with
// nothing written, which is the half a burst can never prove on its own.
//
// The same rule runs through the whole file after E03-D10: **an assertion that
// a wait is STILL IN FORCE is an assertion about the machine's clock**, so where
// one is needed the state is built to owe a delay far longer than this suite's
// own per-test timeout (`LOCKOUT_BEYOND_TEST_TIMEOUT`), and every other "the
// pair owes a delay" claim is read off the recorded count instead.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import {
  BACKOFF_BASE_MS,
  PAIR_FREE_ATTEMPTS,
  lockoutWait,
  lockoutWaitMs,
  recordFailure,
  setOperatorPin,
  verifyOperatorPin,
} from "../../src/services/auth/index.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { TEST_PIN, seedIdentity, type SeededIdentity } from "./authHelpers.js";
import { TEST_PIN_PEPPER } from "../testConfig.js";

const dbUp = await probeDb();
const WRONG_PIN = "913574";

/**
 * A recorded-failure count whose owed delay is far longer than this suite's own
 * per-test timeout (`vitest.integration.config.ts`: 30s).
 *
 * Nine failures put a pair six past the free budget, which owes
 * `BACKOFF_BASE_MS * 2^5` = **64 seconds**. That is what makes "a correct PIN is
 * refused while the wait stands" a deterministic claim rather than a race: a run
 * in which those 64 seconds could have elapsed between the last recorded failure
 * and the assertion is a run that has ALREADY failed by timing out, so the
 * assertion can never be the thing that flakes. Two seconds — the first backoff
 * step — is not such a number, and E03-D10 is the bead that found out.
 */
const LOCKOUT_BEYOND_TEST_TIMEOUT = PAIR_FREE_ATTEMPTS + 6;

describe.skipIf(!dbUp)("the operator PIN and its lockout (048 §3.5, §9.1, I10)", () => {
  let pool: pg.Pool;
  let shopId: string;
  let identity: SeededIdentity;
  let otherShopIdentity: SeededIdentity;

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_operator_pin");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "PIN Shop", slug: `pin-${Date.now()}` });
    const otherShop = await seedShop(ownerPool, { name: "Other Shop", slug: `pin-other-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    identity = await seedIdentity(pool, shopId);
    otherShopIdentity = await seedIdentity(pool, otherShop);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  /** A fresh (device, person) pair with its own PIN, so tests do not share a budget. */
  async function freshPair(pin = TEST_PIN): Promise<{ deviceId: string; appUserId: string }> {
    const device = await pool.query(
      `INSERT INTO device (shop_id, location_id, label, kind) VALUES ($1,$2,'phone','phone') RETURNING id`,
      [shopId, identity.locationId]
    );
    const person = await pool.query(
      `INSERT INTO app_user (email, display_name) VALUES ($1,'Person') RETURNING id`,
      [`pin-${randomUUID()}@example.invalid`]
    );
    const deviceId = (device.rows[0] as { id: string }).id;
    const appUserId = (person.rows[0] as { id: string }).id;
    await withTransaction(pool, (tx) =>
      setOperatorPin(tx, { shopId, deviceId, appUserId, pin, pepper: TEST_PIN_PEPPER })
    );
    return { deviceId, appUserId };
  }

  /**
   * Append `count` failures for a pair, through the SAME writer a failed
   * verification uses (`recordFailure`, 048 §9.1's append).
   *
   * Called directly rather than by attempting, because the only way to reach a
   * deep count by attempting is to SERVE the delays in between — which is the
   * sleep this suite refuses, and which is also the thing being asserted. The
   * rows are identical to the ones a wrong PIN writes: same table, same method,
   * same failure class, same `created_at` default.
   */
  async function recordFailures(pair: { deviceId: string; appUserId: string }, count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await withTransaction(pool, (tx) =>
        recordFailure(tx, {
          shopId,
          deviceId: pair.deviceId,
          appUserId: pair.appUserId,
          method: "operator_pin",
          failureClass: "wrong_pin",
        })
      );
    }
  }

  /** How many `operator_pin` failures stand against a pair. */
  async function failureCount(pair: { deviceId: string; appUserId: string }): Promise<number> {
    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM auth_attempt
        WHERE device_id = $1 AND app_user_id = $2 AND method = 'operator_pin'`,
      [pair.deviceId, pair.appUserId]
    );
    return (rows.rows[0] as { n: number }).n;
  }

  /**
   * What the policy requires of a pair AT THE INSTANT OF ITS OWN LAST FAILURE,
   * given the failures on record.
   *
   * This is the record-based form of "the pair owes a delay". `lockoutWait` on a
   * live connection answers `delay − age`, and `age` is measured against the
   * machine's clock — so on a loaded box it can legitimately be 0, and asserting
   * it is greater than 0 is asserting how fast the test's own machine is
   * (E03-D10). The decay of the delay over time is `tests/auth-policy.test.ts`'s.
   */
  async function owedAtLastFailure(pair: { deviceId: string; appUserId: string }): Promise<number> {
    const failures = await failureCount(pair);
    return lockoutWaitMs({
      pairFailures: failures,
      pairLastFailureAgeMs: 0,
      deviceFailures: failures,
      deviceLastFailureAgeMs: 0,
    });
  }

  /** Every `operator_pin` failure recorded against a device, oldest first, as epoch ms. */
  async function failureTimes(deviceId: string): Promise<number[]> {
    const rows = await pool.query(
      `SELECT created_at FROM auth_attempt
        WHERE device_id = $1 AND method = 'operator_pin'
        ORDER BY created_at, id`,
      [deviceId]
    );
    return rows.rows.map((r) => (r as { created_at: Date }).created_at.getTime());
  }

  /**
   * **The write-skew assertion, with the clock taken out of it (E03-D10).**
   *
   * Re-runs the ratified policy at each recorded failure's own `created_at`,
   * over the failures that strictly precede it, and requires the answer to be
   * "no wait" — i.e. **every charge in the log was one the policy authorised at
   * the instant it was made**. That is the property `operator_pin`'s
   * `SELECT … FOR UPDATE` buys, stated without reference to how long the burst
   * took or to how many rows a particular machine produced.
   *
   * It is exact rather than approximate, and the reason is worth writing down:
   * a failure charged past the free budget is only charged when its own instant
   * is at least the required delay after the previous charge, so **from the
   * fifth charge onward the order by `created_at` is the order the anchor
   * serialised** — reconstructing from the log cannot disagree with what the
   * transaction actually saw. Inside the free budget every attempt is authorised
   * whatever its instant, so a reordering there changes no verdict.
   *
   * Under write skew the log usually tells on itself: N attempts read one budget
   * and charge N times within an instant, and rows past the budget then sit a
   * few milliseconds — not `BACKOFF_BASE_MS` — after their predecessor. **What
   * this does NOT claim is that every unserialised run is caught.** A burst
   * without an anchor whose charges happen to land at or past their required
   * delays produces a log this accepts, and rightly: no charge in it was
   * unauthorised. The claim is the weaker, checkable one — **any log this
   * accepts is a log the policy would have authorised anyway** — and the LOCK is
   * proved by the case that holds the anchor row and watches a real attempt
   * block on it.
   *
   * The pair and the device classes are evaluated over the same rows because
   * every caller here uses a device with exactly one pair on it; the roster-walk
   * case is what exercises the two classes apart.
   */
  function assertEveryFailureWasPermitted(createdAt: readonly number[]): void {
    createdAt.forEach((at, k) => {
      const earlier = createdAt.slice(0, k);
      const previous = earlier[earlier.length - 1];
      const ageMs = previous === undefined ? Number.POSITIVE_INFINITY : at - previous;
      const required = lockoutWaitMs({
        pairFailures: earlier.length,
        pairLastFailureAgeMs: ageMs,
        deviceFailures: earlier.length,
        deviceLastFailureAgeMs: ageMs,
      });
      expect(
        required,
        `failure ${k + 1} of ${createdAt.length} was charged ` +
          `${previous === undefined ? "first" : `${ageMs}ms after the previous one`}, but the policy ` +
          `required a ${required}ms wait at that instant: an attempt spent a budget another attempt ` +
          `had already spent, which is the write skew the operator_pin anchor exists to prevent`
      ).toBe(0);
    });
  }

  function verify(
    pair: { deviceId: string; appUserId: string },
    pin: string,
    now = new Date()
  ): Promise<{ ok: boolean }> {
    return withTransaction(pool, (tx) =>
      verifyOperatorPin(tx, {
        shopId,
        deviceId: pair.deviceId,
        appUserId: pair.appUserId,
        pin,
        pepper: TEST_PIN_PEPPER,
        now,
      })
    );
  }

  it("accepts the right PIN for its own pair and refuses every other pairing", async () => {
    const a = await freshPair();
    const b = await freshPair();
    expect((await verify(a, TEST_PIN)).ok).toBe(true);

    // A PIN is NEVER compared across scopes (048 §3.5): the function takes ONE
    // (device, person) pair and refuses any other. It does not "try the person's
    // other PINs" and does not fall back to another device's row — a credential
    // that is worthless off one device stops being worthless the moment one code
    // path compares it somewhere else.
    const crossed = { deviceId: a.deviceId, appUserId: b.appUserId };
    expect((await verify(crossed, TEST_PIN)).ok).toBe(false);
  });

  it("refuses a correct PIN belonging to ANOTHER SHOP's device", async () => {
    const foreign = {
      deviceId: otherShopIdentity.deviceId,
      appUserId: identity.operatorId,
    };
    expect((await verify(foreign, TEST_PIN)).ok).toBe(false);
  });

  it("stores an argon2id digest that is NOT reproducible without the pepper (I9, R6)", async () => {
    const pair = await freshPair();
    const row = await pool.query(`SELECT pin_hash, pepper_version FROM operator_pin WHERE device_id = $1`, [
      pair.deviceId,
    ]);
    const stored = (row.rows[0] as { pin_hash: string; pepper_version: number }).pin_hash;
    expect(stored).toMatch(/^\$argon2id\$/);
    // The PIN itself appears nowhere in it, and neither does the pepper.
    expect(stored).not.toContain(TEST_PIN);
    expect(stored).not.toContain(TEST_PIN_PEPPER);
    expect((row.rows[0] as { pepper_version: number }).pepper_version).toBe(1);

    // And the digest does NOT verify against the PIN alone: a stolen `pg_dump`
    // is not a phone behind a counter, and §9.2's whole argument is that the
    // keyspace stays out of reach without the process-environment secret.
    const { argon2Verify } = await import("hash-wasm");
    await expect(argon2Verify({ password: TEST_PIN, hash: stored })).resolves.toBe(false);
  });

  it("imposes a GROWING delay after the free attempts, on that pair only", async () => {
    const pair = await freshPair();
    const bystander = await freshPair();

    for (let i = 0; i < PAIR_FREE_ATTEMPTS; i += 1) {
      expect((await verify(pair, WRONG_PIN)).ok).toBe(false);
    }
    // Still free: the fat-fingered operator has not been charged anything. A
    // live read is safe here BECAUSE the answer is 0 for every clock — inside
    // the free budget the age term never enters the arithmetic.
    expect(await lockoutWait(pool, pair.deviceId, pair.appUserId, new Date())).toBe(0);

    expect((await verify(pair, WRONG_PIN)).ok).toBe(false);
    // One past the budget owes exactly the first backoff step. Asserted off the
    // RECORD (E03-D10): `lockoutWait` on a live connection answers
    // `delay − age`, and on a loaded box the age can already exceed 2s, so the
    // old `> 0 && <= BACKOFF_BASE_MS` was a statement about this machine.
    expect(await failureCount(pair)).toBe(PAIR_FREE_ATTEMPTS + 1);
    expect(await owedAtLastFailure(pair)).toBe(BACKOFF_BASE_MS);

    // A correct PIN inside the wait is refused — refused UNTIL, not refused
    // FOREVER — and the distinction is the whole of R5. The wait has to be
    // STANDING for that to mean anything, so the pair is taken far enough past
    // the budget that serving it would take longer than this test is allowed to
    // live (see `LOCKOUT_BEYOND_TEST_TIMEOUT`).
    await recordFailures(pair, LOCKOUT_BEYOND_TEST_TIMEOUT - (PAIR_FREE_ATTEMPTS + 1));
    expect(await owedAtLastFailure(pair)).toBeGreaterThan(60_000);
    expect((await verify(pair, TEST_PIN)).ok).toBe(false);

    // NO OTHER OPERATOR ON THE SAME PHONE IS AFFECTED beyond the device ceiling,
    // which these failures are on a different phone entirely.
    expect(await lockoutWait(pool, bystander.deviceId, bystander.appUserId, new Date())).toBe(0);
    expect((await verify(bystander, TEST_PIN)).ok).toBe(true);
  });

  it("lets a CORRECT PIN through once the delay has passed — no state is terminal", async () => {
    const pair = await freshPair();
    await verify(pair, WRONG_PIN);
    await recordFailures(pair, LOCKOUT_BEYOND_TEST_TIMEOUT - 1);
    // The pair owes more than a minute at the instant of its own last failure —
    // asserted off the record rather than off `lockoutWait(…, new Date())`,
    // which answers `delay − age` and can legitimately be 0 on a loaded box
    // (E03-D10). And a correct PIN really is refused while that stands.
    expect(await owedAtLastFailure(pair)).toBeGreaterThan(60_000);
    expect((await verify(pair, TEST_PIN)).ok).toBe(false);

    // "There is no state from which a correct PIN is refused; there is only a
    // state in which it is refused *until*." The clock is an input, so the test
    // moves it rather than sleeping.
    const afterBackoff = new Date(Date.now() + 60 * 60 * 1000);
    expect(await lockoutWait(pool, pair.deviceId, pair.appUserId, afterBackoff)).toBe(0);
    expect((await verify(pair, TEST_PIN, afterBackoff)).ok).toBe(true);
  });

  it("survives a process restart, because the count is a FACT and not a counter in a Map", async () => {
    const pair = await freshPair();
    await verify(pair, WRONG_PIN);
    // Taken well past the budget so the delay a live read reports cannot have
    // been served inside this test's own timeout — which is what makes the two
    // `> 0` reads below claims about the RECORD surviving a new connection
    // rather than claims about how fast this machine is (E03-D10).
    await recordFailures(pair, LOCKOUT_BEYOND_TEST_TIMEOUT - 1);
    const before = await lockoutWait(pool, pair.deviceId, pair.appUserId, new Date());
    expect(before).toBeGreaterThan(0);

    // A NEW pool is a new process's connection as far as any in-memory state is
    // concerned. 046 E25 records the three properties of the `Map` shape — per
    // process, empty on restart, keyed on something a caller chose — and this is
    // the assertion that none of them applies here.
    const fresh = new pg.Pool({ connectionString: pool.options.connectionString });
    try {
      expect(await lockoutWait(fresh, pair.deviceId, pair.appUserId, new Date())).toBeGreaterThan(0);
    } finally {
      await fresh.end();
    }
  });

  it("bounds a ROSTER WALK with the per-device ceiling", async () => {
    // The per-pair delay alone lets an attacker holding the phone walk the
    // roster: a few failures against each of eight display names is eight fresh
    // budgets. The device class is what actually bounds a stolen phone.
    const device = await pool.query(
      `INSERT INTO device (shop_id, location_id, label, kind) VALUES ($1,$2,'walk','phone') RETURNING id`,
      [shopId, identity.locationId]
    );
    const deviceId = (device.rows[0] as { id: string }).id;
    const people: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const person = await pool.query(
        `INSERT INTO app_user (email, display_name) VALUES ($1,'Roster') RETURNING id`,
        [`roster-${randomUUID()}@example.invalid`]
      );
      const appUserId = (person.rows[0] as { id: string }).id;
      people.push(appUserId);
      await withTransaction(pool, (tx) =>
        setOperatorPin(tx, { shopId, deviceId, appUserId, pin: TEST_PIN, pepper: TEST_PIN_PEPPER })
      );
    }
    for (const appUserId of people) {
      for (let i = 0; i < 3; i += 1) {
        await withTransaction(pool, (tx) =>
          verifyOperatorPin(tx, {
            shopId,
            deviceId,
            appUserId,
            pin: WRONG_PIN,
            pepper: TEST_PIN_PEPPER,
            now: new Date(),
          })
        );
      }
    }
    // Eighteen failures across six names: every PAIR is inside its own free
    // budget, and the DEVICE is not. A live read is safe here for the same
    // reason `LOCKOUT_BEYOND_TEST_TIMEOUT` exists: eight past the DEVICE budget
    // owes `BACKOFF_BASE_MS * 2^7` — 256 seconds, capped at 300 — so a run in
    // which it could have been served has already failed by timing out.
    const wait = await lockoutWait(pool, deviceId, people[0]!, new Date());
    expect(wait).toBeGreaterThan(0);
    // And it is still a delay: the ceiling slows the walk, it does not end the
    // shift (the DoS trade 048 §9.1 states rather than hides).
    const later = new Date(Date.now() + 60 * 60 * 1000);
    expect(await lockoutWait(pool, deviceId, people[0]!, later)).toBe(0);
  });

  it("consumes N budget under N CONCURRENT wrong attempts, not one (the write-skew case)", async () => {
    const pair = await freshPair();
    const N = 6;
    // "Derive the lockout, then verify" is a read-then-write across a security
    // boundary: N concurrent attempts all read a count below the threshold, all
    // proceed, and the effective budget is N times the intended one. The
    // `operator_pin` anchor `FOR UPDATE` serialises them.
    expect(N).toBeGreaterThan(PAIR_FREE_ATTEMPTS + 1);
    await Promise.all(Array.from({ length: N }, () => verify(pair, WRONG_PIN)));
    const charged = await failureTimes(pair.deviceId);

    // **Every charge in the log was one the policy authorised at the instant it
    // was made.** Under the anchor, attempt k sees every failure attempts 1..k-1
    // recorded, so the free budget is spent exactly once and a later attempt is
    // charged only when its own delay has really elapsed. Without the anchor all
    // six read a count below the threshold, all six proceed, and the log then
    // holds charges the policy would have refused — 041 §4.2's write skew, and
    // the only reason `operator_pin` is an anchor at all.
    //
    // This is asserted instead of a row count because a row count is a statement
    // about the MACHINE: see the header. The count still gets a floor and a
    // ceiling, both of which serialisation fixes outright.
    assertEveryFailureWasPermitted(charged);
    // The floor is what serialisation fixes outright: the first
    // `PAIR_FREE_ATTEMPTS + 1` attempts to reach the anchor each see a count
    // inside the free budget and are all charged. (No ceiling is asserted: `≤ N`
    // is true of any run of N attempts and would prove nothing.)
    expect(charged.length).toBeGreaterThanOrEqual(PAIR_FREE_ATTEMPTS + 1);

    // Restating that floor in the policy's own terms: a count past the free
    // budget owes a delay. Read at the instant of the burst's OWN last failure,
    // because "how long ago was that failure" is a fact about how long the burst
    // took to run, and a test that asserts on it is asserting on the load of the
    // machine underneath it.
    expect(await owedAtLastFailure(pair)).toBeGreaterThan(0);
  });

  it("HOLDS the anchor through the verification and the INSERT (048 §9.1)", async () => {
    // The burst above proves the OUTCOME is consistent with serialisation. This
    // proves the MECHANISM, and it does so without racing anything: a second
    // connection takes the pair's `operator_pin` row `FOR UPDATE` and keeps it,
    // and the real `verifyOperatorPin` is then observed waiting on that lock —
    // in `pg_blocking_pids`, which is Postgres's own account of who is blocked
    // by whom — with nothing written. Remove the anchor `SELECT … FOR UPDATE`
    // from `verifyOperatorPin` and this test fails on every machine at every
    // speed, because the attempt runs to completion while the row is held.
    const pair = await freshPair();
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      const held = await holder.query(
        `SELECT id FROM operator_pin WHERE device_id = $1 AND app_user_id = $2 FOR UPDATE`,
        [pair.deviceId, pair.appUserId]
      );
      expect(held.rows).toHaveLength(1);
      const holderPid = ((await holder.query(`SELECT pg_backend_pid() AS pid`)).rows[0] as { pid: number })
        .pid;

      let finished = false;
      const attempt = verify(pair, WRONG_PIN).finally(() => {
        finished = true;
      });

      // Poll for the first of the two outcomes to happen — blocked, or finished
      // — rather than sleeping for a duration. A fixed sleep would be the same
      // mistake the burst assertion just stopped making.
      let blocked = false;
      while (!blocked && !finished) {
        const waiting = await pool.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))`,
          [holderPid]
        );
        blocked = (waiting.rows[0] as { n: number }).n > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(
        blocked,
        "verifyOperatorPin ran to completion while another transaction held the pair's operator_pin " +
          "row: the anchor SELECT … FOR UPDATE is not being taken, and the lockout budget is readable " +
          "by two attempts at once"
      ).toBe(true);
      // Blocked BEFORE the count, the verification and the INSERT — which is
      // what "holds it through" means and why a blocked attempt has written
      // nothing at all.
      expect(await failureTimes(pair.deviceId)).toHaveLength(0);

      await holder.query("COMMIT");
      expect((await attempt).ok).toBe(false);
      expect(await failureTimes(pair.deviceId)).toHaveLength(1);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
  });

  it("recognises the write-skew shape and the serialised shape apart", () => {
    // The assertion the burst leans on, checked against the two logs it exists
    // to tell apart. Written over literal instants because the point is what the
    // rule DECIDES, not what any database happened to record: a checker that
    // accepts everything would have made the burst case green forever.
    const t = Date.now();
    // Six attempts that all read one budget: past the free budget the charges
    // sit milliseconds apart instead of `BACKOFF_BASE_MS` apart.
    expect(() => assertEveryFailureWasPermitted([t, t + 1, t + 1, t + 2, t + 2, t + 3])).toThrow(
      /already spent/
    );
    // The serialised log of the same six attempts: the free budget, then one
    // charge after the first delay and one after the second, doubled.
    const fifth = t + 3 + BACKOFF_BASE_MS;
    expect(() =>
      assertEveryFailureWasPermitted([t, t + 1, t + 2, t + 3, fifth, fifth + 2 * BACKOFF_BASE_MS])
    ).not.toThrow();
  });

  it("records FAILURES ONLY — a success writes no row (R16)", async () => {
    const pair = await freshPair();
    expect((await verify(pair, TEST_PIN)).ok).toBe(true);
    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM auth_attempt WHERE device_id = $1 AND app_user_id = $2`,
      [pair.deviceId, pair.appUserId]
    );
    // A success row would be a second, redundant record of an event
    // `app_session` already holds, differing only in being a per-operator log of
    // when each person signed in — the surface 022 P3 forbids, built to serve a
    // reconciliation (T35(c)) that derives from `app_session` and does not need
    // it.
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("refuses a RETIRED PIN, so a membership revocation really ends it (048 §3.5)", async () => {
    const pair = await freshPair();
    expect((await verify(pair, TEST_PIN)).ok).toBe(true);
    await pool.query(`UPDATE operator_pin SET retired_at = now() WHERE device_id = $1`, [pair.deviceId]);
    expect((await verify(pair, TEST_PIN)).ok).toBe(false);
  });

  it("refuses a trivial PIN AT SET TIME rather than at verify time", async () => {
    const device = await pool.query(
      `INSERT INTO device (shop_id, location_id, label, kind) VALUES ($1,$2,'p','phone') RETURNING id`,
      [shopId, identity.locationId]
    );
    const person = await pool.query(
      `INSERT INTO app_user (email, display_name) VALUES ($1,'P') RETURNING id`,
      [`trivial-${randomUUID()}@example.invalid`]
    );
    const set = await withTransaction(pool, (tx) =>
      setOperatorPin(tx, {
        shopId,
        deviceId: (device.rows[0] as { id: string }).id,
        appUserId: (person.rows[0] as { id: string }).id,
        pin: "123456",
        pepper: TEST_PIN_PEPPER,
      })
    );
    expect(set).toEqual({ ok: false, refusal: "trivial" });
    const stored = await pool.query(`SELECT count(*)::int AS n FROM operator_pin WHERE device_id = $1`, [
      (device.rows[0] as { id: string }).id,
    ]);
    expect((stored.rows[0] as { n: number }).n).toBe(0);
  });
});
