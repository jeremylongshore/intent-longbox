// L4: **048 I12's enrollment half** — "the same for an enrollment code, by
// `UNIQUE (code_id)` on `device_enrollment_code_use`."
//
// The invitation suite is the other half. What is different here, and what this
// file exists to pin down, is the ruling E03-D07 had to make:
//
//   **§7.1a's device binding cannot hold on this route**, because the caller IS
//   the phone being enrolled and holds no session by construction. So the code
//   is 128 bits rather than eight characters, and the tests below assert the
//   consequences of that rather than the binding §7.1a describes:
//
//     * a redemption from an anonymous caller SUCCEEDS (the route is `none` on
//       the auth allowlist, and if it ever stopped being so the flow would be
//       impossible rather than merely stricter);
//     * an UNKNOWN code appends an `auth_attempt` row with a NULL `shop_id` —
//       `020` made that column nullable for exactly this case;
//     * the enrolled phone can then do what an enrolled phone does, and NOTHING
//       else: it holds a device session and no operator, so 048 R8's enumerated
//       set is what it reaches.
//
// **No real names, no code values** (048 §7.1's header).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { type Tx, serviceDb, withTransaction } from "../../src/db.js";
import {
  DEVICE_COOKIE,
  ENROLLMENT_CODE_LENGTH,
  MAX_OUTSTANDING_ENROLLMENT_CODES_PER_SHOP,
  countOutstandingEnrollmentCodes,
  digestOf,
  enrollDevice,
  issueEnrollmentCode,
  verifyEnrollmentCode,
  type EnrollmentCodeRow,
} from "../../src/services/auth/index.js";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { seedIdentity, type SeededIdentity } from "./authHelpers.js";
import { testConfig } from "../testConfig.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("device enrollment is single-use by constraint (048 §7.3, I12)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;
  // ⚠ AN OWNER POOL, KEPT OPEN (E03-B04). `shop` is policied on its own `id`, so
  // an INSERT can never satisfy `id = current_shop_id()` — the tenant IS the row
  // being created — and creating a shop is therefore a schema-owner act enforced
  // by the database, which is what `pnpm register-shop` already was by convention.
  let ownerPool: pg.Pool;
  let identity: SeededIdentity;

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
    const migrateUrl = await createFreshDb("longbox_enrollment");
    await runMigrations(migrateUrl);
    ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Shop D", slug: `enr-${Date.now()}` });
    const url = appUrl(migrateUrl);
    pool = new pg.Pool({ connectionString: url });
    identity = await seedIdentity(pool, shopId);
    app = await buildApp(pool, testConfig({ databaseUrl: url }));
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await ownerPool?.end();
  });

  async function issue(): Promise<{ code: string; codeId: string }> {
    const out = await shopTx((tx) =>
      issueEnrollmentCode(tx, {
        shopId,
        locationId: identity.locationId,
        deviceLabel: "second counter phone",
        deviceKind: "phone",
        issuedBy: identity.ownerId,
        now: new Date(),
      })
    );
    if (!out.ok) throw new Error(`issue refused: ${out.refusal}`);
    return { code: out.enrollment.code, codeId: out.enrollment.codeId };
  }

  async function redeem(code: string): Promise<{
    status: number;
    error: string | undefined;
    cookies: string[];
    body: unknown;
  }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/device-enrollments",
      // NO cookie. That is the case under test: the phone has none.
      headers: { "sec-fetch-site": "same-origin", "idempotency-key": randomUUID() },
      payload: { code },
    });
    const parsed = res.json() as { error?: { code: string } };
    const raw = res.headers["set-cookie"];
    return {
      status: res.statusCode,
      error: parsed.error?.code,
      cookies: raw === undefined ? [] : Array.isArray(raw) ? raw : [String(raw)],
      body: parsed,
    };
  }

  it("mints 128 bits, not eight characters — the binding is unavailable here", async () => {
    const { code } = await issue();
    expect(code).toHaveLength(ENROLLMENT_CODE_LENGTH);
    // 26 characters over a 32-symbol alphabet is 130 bits, which is the smallest
    // whole number of characters at or above §7.1a's floor.
    expect(ENROLLMENT_CODE_LENGTH * 5).toBeGreaterThanOrEqual(128);
  });

  it("enrolls a phone from an anonymous caller: device, credential, use row, cookie", async () => {
    const before = await countOutstandingEnrollmentCodes(pool, shopId);
    const { code, codeId } = await issue();
    const res = await redeem(code);
    expect(res.status).toBe(201);

    const use = await shopQuery(
      `SELECT u.device_id, u.device_credential_id FROM device_enrollment_code_use u WHERE u.code_id = $1`,
      [codeId]
    );
    expect(use.rows).toHaveLength(1);
    const row = use.rows[0] as { device_id: string; device_credential_id: string };

    const device = await shopQuery(
      `SELECT d.shop_id, d.location_id, d.label, d.kind FROM device d WHERE d.id = $1`,
      [row.device_id]
    );
    expect(device.rows[0]).toEqual({
      shop_id: shopId,
      location_id: identity.locationId,
      label: "second counter phone",
      kind: "phone",
    });

    // The credential was minted, hashed and DISCARDED: the phone holds a session
    // cookie and no secret. The response body carries no secret either — 048 I9's
    // rule applied to a new surface.
    const credential = await shopQuery(
      `SELECT c.token_hash, c.enrolled_by FROM device_credential c WHERE c.id = $1`,
      [row.device_credential_id]
    );
    const stored = credential.rows[0] as { token_hash: string; enrolled_by: string };
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    // `enrolled_by` names the PERSON who issued the code, not the phone: the
    // column is a claim about a person and the phone did not enroll itself.
    expect(stored.enrolled_by).toBe(identity.ownerId);
    expect(JSON.stringify(res.body)).not.toContain("secret");

    const deviceCookie = res.cookies.find((c) => c.startsWith(`${DEVICE_COOKIE}=`));
    expect(deviceCookie).toBeDefined();
    expect(deviceCookie).toContain("HttpOnly");
    expect(deviceCookie).toContain("SameSite=Strict");
    expect(deviceCookie).toContain("Secure");

    // Outstanding fell by a predicate: the code row is untouched.
    expect(await countOutstandingEnrollmentCodes(pool, shopId)).toBe(before);
  });

  it("refuses a SECOND redemption and enrolls no second phone", async () => {
    const { code, codeId } = await issue();
    expect((await redeem(code)).status).toBe(201);

    const second = await redeem(code);
    expect(second.status).toBe(401);
    expect(second.error).toBe("ENROLLMENT_CODE_INVALID");

    const uses = await shopQuery(
      `SELECT count(*)::int AS n FROM device_enrollment_code_use WHERE code_id = $1`,
      [codeId]
    );
    expect((uses.rows[0] as { n: number }).n).toBe(1);
  });

  it("leaves exactly ONE phone when two redemptions race, and no orphan device", async () => {
    const { code, codeId } = await issue();
    const verdicts = await Promise.all([
      shopTx((tx) => verifyEnrollmentCode(tx, { code, now: new Date() })),
      shopTx((tx) => verifyEnrollmentCode(tx, { code, now: new Date() })),
    ]);
    for (const v of verdicts) expect(v.ok).toBe(true);
    const row = (verdicts[0] as { ok: true; code: EnrollmentCodeRow }).code;

    const devicesBefore = await countDevices();
    const results = await Promise.allSettled(
      verdicts.map(() => shopTx((tx) => enrollDevice(tx, { code: row })))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    // The loser's `device` and `device_credential` INSERTs rolled back with its
    // throw — a spent code must not leave a phantom phone in the shop's
    // inventory, which is the whole reason the three rows share one transaction.
    expect(await countDevices()).toBe(devicesBefore + 1);
    const uses = await shopQuery(
      `SELECT count(*)::int AS n FROM device_enrollment_code_use WHERE code_id = $1`,
      [codeId]
    );
    expect((uses.rows[0] as { n: number }).n).toBe(1);
  });

  it("refuses an EXPIRED code, and expiry is a predicate over a row nothing marked", async () => {
    // Written directly, because `issueEnrollmentCode` cannot produce an expired
    // code and must not be able to (`migrations/024`'s CHECK). Both timestamps
    // are in the past — the state a real code reaches by the clock moving.
    const code = "EXPIREDENROLLMENTCODEZZZZZ";
    expect(code).toHaveLength(ENROLLMENT_CODE_LENGTH);
    await shopQuery(
      `INSERT INTO device_enrollment_code
         (shop_id, location_id, device_label, device_kind, code_digest, expires_at, issued_by, created_at)
       VALUES ($1,$2,'late phone','phone',$3, now() - interval '1 minute', $4, now() - interval '20 minutes')`,
      [shopId, identity.locationId, digestOf(code), identity.ownerId]
    );
    const res = await redeem(code);
    expect(res.status).toBe(401);
    expect(res.error).toBe("ENROLLMENT_CODE_INVALID");

    const columns = await shopQuery(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'device_enrollment_code'`
    );
    const names = (columns.rows as Array<{ column_name: string }>).map((r) => r.column_name);
    for (const forbidden of ["status", "used", "spent", "redeemed_at", "is_active"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("records an unknown code as a failure with a NULL shop, because it names no shop", async () => {
    // A NULL `shop_id` matches NO tenant policy — that is what "names no shop"
    // means once E03-B04 is in force — so the count is read in the same
    // `code-redemption` scope the redemption itself runs in.
    const inbound = serviceDb(pool, "code-redemption");
    const before = await inbound.query(
      `SELECT count(*)::int AS n FROM auth_attempt
        WHERE method = 'enrollment_code' AND shop_id IS NULL`
    );
    const res = await redeem("ZZZZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(res.status).toBe(401);
    expect(res.error).toBe("ENROLLMENT_CODE_INVALID");
    const after = await inbound.query(
      `SELECT count(*)::int AS n FROM auth_attempt
        WHERE method = 'enrollment_code' AND shop_id IS NULL`
    );
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n + 1);
    // **And this is the asymmetry the header names.** A wrong guess names no
    // shop, so §7.1a's per-shop ceiling has nothing to be keyed on and cannot
    // bound a guessing attack here. The entropy is what bounds it, which is why
    // this code is 128 bits and the invitation's is not.
  });

  it("refuses to issue past the per-shop outstanding ceiling (048 §7.1a)", async () => {
    const ceilingShop = await seedShop(ownerPool, {
      name: "Shop E",
      slug: `enr-ceiling-${randomUUID().slice(0, 8)}`,
    });
    const ceiling = await seedIdentity(pool, ceilingShop);
    // THE CEILING SHOP'S CONTEXT, because the act is about that shop (E03-B04):
    // `issueEnrollmentCode` records an `authorization_decision` row for the shop it
    // is deciding about, and such a row written under another shop's context is
    // refused by the policy's `WITH CHECK`.
    for (let i = 0; i < MAX_OUTSTANDING_ENROLLMENT_CODES_PER_SHOP; i += 1) {
      const out = await shopTx(
        (tx) =>
          issueEnrollmentCode(tx, {
            shopId: ceilingShop,
            locationId: ceiling.locationId,
            deviceLabel: "phone",
            deviceKind: "phone",
            issuedBy: ceiling.ownerId,
            now: new Date(),
          }),
        ceilingShop
      );
      expect(out.ok).toBe(true);
    }
    const over = await shopTx(
      (tx) =>
        issueEnrollmentCode(tx, {
          shopId: ceilingShop,
          locationId: ceiling.locationId,
          deviceLabel: "phone",
          deviceKind: "phone",
          issuedBy: ceiling.ownerId,
          now: new Date(),
        }),
      ceilingShop
    );
    expect(over).toEqual({ ok: false, refusal: "too_many_outstanding" });
  });

  it("refuses an issuer who is only an OPERATOR, and a location from another shop", async () => {
    const notPrivileged = await shopTx((tx) =>
      issueEnrollmentCode(tx, {
        shopId,
        locationId: identity.locationId,
        deviceLabel: "phone",
        deviceKind: "phone",
        // 048 §7.3: "an owner or MANAGER". An operator may not enroll a phone.
        issuedBy: identity.operatorId,
        now: new Date(),
      })
    );
    expect(notPrivileged).toEqual({ ok: false, refusal: "not_permitted" });

    const elsewhere = await seedShop(ownerPool, {
      name: "Shop F",
      slug: `enr-other-${randomUUID().slice(0, 8)}`,
    });
    const other = await seedIdentity(pool, elsewhere);
    const wrongLocation = await shopTx((tx) =>
      issueEnrollmentCode(tx, {
        shopId,
        // Another shop's location. 034 I7 makes `device.location_id` NOT NULL, so
        // an unchecked one here would enroll a phone into the wrong tenant's
        // counter with a perfectly valid-looking row.
        locationId: other.locationId,
        deviceLabel: "phone",
        deviceKind: "phone",
        issuedBy: identity.ownerId,
        now: new Date(),
      })
    );
    expect(wrongLocation).toEqual({ ok: false, refusal: "unknown_location" });
  });

  it("rolls the phone back with the session: no spent code without a session to show for it", async () => {
    // ⚠ THE REGRESSION TEST FOR A GAP THE INVARIANT REVIEW FOUND, not a test.
    //
    // `redeemEnrollmentCode` used to run THREE transactions: verify, then
    // `enrollDevice` (device + credential + use row), then `issueDeviceSession`.
    // A crash in the gap between the second and the third committed a SPENT code,
    // an enrolled phone and a live credential with no session — the phantom phone
    // `migrations/024`'s header says this design prevents, arriving through the
    // one seam that header did not look at, because `UNIQUE (code_id)` makes the
    // act exactly-once and says nothing about it being COMPLETE.
    //
    // The three writes and the session are now one transaction. This asserts the
    // property that buys: a failure after the rows are written leaves NOTHING —
    // and, the half that matters operationally, the code is still redeemable, so
    // the shop is not left issuing a second one for a phone that half-enrolled.
    const { code, codeId } = await issue();
    const devicesBefore = await countDevices();

    const verdict = await shopTx((tx) => verifyEnrollmentCode(tx, { code, now: new Date() }));
    expect(verdict.ok).toBe(true);
    const row = (verdict as { ok: true; code: EnrollmentCodeRow }).code;

    await expect(
      shopTx(async (tx) => {
        await enrollDevice(tx, { code: row });
        // Stands in for anything that can fail after the rows are written — a
        // dead connection, a refused session INSERT, a process that dies.
        throw new Error("crash after the device rows, before the session");
      })
    ).rejects.toThrow(/crash after the device rows/);

    expect(await countDevices()).toBe(devicesBefore);
    const uses = await shopQuery(
      `SELECT count(*)::int AS n FROM device_enrollment_code_use WHERE code_id = $1`,
      [codeId]
    );
    expect((uses.rows[0] as { n: number }).n).toBe(0);

    // And the code still works, which is the whole point of rolling back rather
    // than leaving a spent code behind.
    const res = await redeem(code);
    expect(res.status).toBe(201);
    expect(res.cookies.some((c) => c.startsWith(`${DEVICE_COOKIE}=`))).toBe(true);
  });

  it("appends to both tables and can UPDATE neither", async () => {
    const { codeId } = await issue();
    await expect(
      shopQuery(`UPDATE device_enrollment_code SET expires_at = now() WHERE id = $1`, [codeId])
    ).rejects.toThrow();
    await expect(shopQuery(`DELETE FROM device_enrollment_code WHERE id = $1`, [codeId])).rejects.toThrow();
  });

  async function countDevices(): Promise<number> {
    const res = await shopQuery(`SELECT count(*)::int AS n FROM device WHERE shop_id = $1`, [shopId]);
    return (res.rows[0] as { n: number }).n;
  }
});
