// L4: 048 I10 — "a PIN is worthless off an enrolled device, and lockout is a
// delay that never closes."
//
// The write-skew case is the one that matters most and is the easiest to write
// wrong: N concurrent attempts must consume N budget, not one. 041 §4.2 named
// the anomaly; `operator_pin` is the anchor that closes it, and this suite runs
// the attempts concurrently rather than in a loop.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import {
  BACKOFF_BASE_MS,
  PAIR_FREE_ATTEMPTS,
  lockoutWait,
  setOperatorPin,
  verifyOperatorPin,
} from "../../src/services/auth/index.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { TEST_PIN, seedIdentity, type SeededIdentity } from "./authHelpers.js";
import { TEST_PIN_PEPPER } from "../testConfig.js";

const dbUp = await probeDb();
const WRONG_PIN = "913574";

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
    // Still free: the fat-fingered operator has not been charged anything.
    expect(await lockoutWait(pool, pair.deviceId, pair.appUserId, new Date())).toBe(0);

    expect((await verify(pair, WRONG_PIN)).ok).toBe(false);
    const first = await lockoutWait(pool, pair.deviceId, pair.appUserId, new Date());
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(BACKOFF_BASE_MS);

    // A correct PIN inside the wait is refused — refused UNTIL, not refused
    // FOREVER — and the distinction is the whole of R5.
    expect((await verify(pair, TEST_PIN)).ok).toBe(false);

    // NO OTHER OPERATOR ON THE SAME PHONE IS AFFECTED beyond the device ceiling,
    // which these few failures are nowhere near.
    expect(await lockoutWait(pool, bystander.deviceId, bystander.appUserId, new Date())).toBe(0);
    expect((await verify(bystander, TEST_PIN)).ok).toBe(true);
  });

  it("lets a CORRECT PIN through once the delay has passed — no state is terminal", async () => {
    const pair = await freshPair();
    for (let i = 0; i < PAIR_FREE_ATTEMPTS + 4; i += 1) {
      await verify(pair, WRONG_PIN);
    }
    expect(await lockoutWait(pool, pair.deviceId, pair.appUserId, new Date())).toBeGreaterThan(0);

    // "There is no state from which a correct PIN is refused; there is only a
    // state in which it is refused *until*." The clock is an input, so the test
    // moves it rather than sleeping.
    const afterBackoff = new Date(Date.now() + 60 * 60 * 1000);
    expect(await lockoutWait(pool, pair.deviceId, pair.appUserId, afterBackoff)).toBe(0);
    expect((await verify(pair, TEST_PIN, afterBackoff)).ok).toBe(true);
  });

  it("survives a process restart, because the count is a FACT and not a counter in a Map", async () => {
    const pair = await freshPair();
    for (let i = 0; i < PAIR_FREE_ATTEMPTS + 1; i += 1) await verify(pair, WRONG_PIN);
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
    // budget, and the DEVICE is not.
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
    await Promise.all(Array.from({ length: N }, () => verify(pair, WRONG_PIN)));

    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM auth_attempt WHERE device_id = $1 AND app_user_id = $2`,
      [pair.deviceId, pair.appUserId]
    );
    // **EXACTLY the free budget plus one**, and the number is not incidental: it
    // is what perfect serialization produces. Under the anchor lock, attempt k
    // sees k-1 failures, so attempts 1..FREE and the one after it are charged
    // and every later attempt in the burst finds a wait already imposed and is
    // refused without testing a credential.
    //
    // **Without the lock this number would be N**: every one of the six would
    // read a count below the threshold, all would proceed, and the effective
    // budget would be six times the intended one — which is the write skew 041
    // §4.2 names and the only reason `operator_pin` is an anchor at all.
    expect((rows.rows[0] as { n: number }).n).toBe(PAIR_FREE_ATTEMPTS + 1);
    expect(N).toBeGreaterThan(PAIR_FREE_ATTEMPTS + 1);
    expect(await lockoutWait(pool, pair.deviceId, pair.appUserId, new Date())).toBeGreaterThan(0);
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
