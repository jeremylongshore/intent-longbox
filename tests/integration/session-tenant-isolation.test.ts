// L4: 048 I1, I2, I8 and I6(a) — the properties that only exist once a request
// carries a name.
//
//   I1  no route reaches the database or the filesystem without a resolved
//       session, and a DEVICE-ONLY session reaches an enumerated set of exactly
//       two things (R8);
//   I2  a session at shop A cannot reach shop B, and the refusal is
//       INDISTINGUISHABLE from absence (019 T24, non-waivable);
//   I8  `operator_id` is written from the session and from nowhere else;
//   I6(a) every `Set-Cookie` this server emits carries the full attribute set.
//
// **I1 failed on the tree as it stood, by design** (048 §11): every route was
// anonymous, and a test asserting otherwise was the gate doing its job.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { API_PREFIX } from "../../src/contracts/v1/schemas.js";
import { DEVICE_COOKIE, OPERATOR_COOKIE } from "../../src/services/auth/index.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import {
  TEST_PIN,
  cookieHeader,
  openDevice,
  openOperator,
  seedIdentity,
  writeHeaders,
  type SeededIdentity,
} from "./authHelpers.js";
import { ShopRateLimiter } from "../../src/services/rateLimit.js";
import { testConfig } from "../testConfig.js";

const dbUp = await probeDb();
const UPLOADS_DIR = "tests/.tmp-tenant-uploads";

describe.skipIf(!dbUp)("the session is the only source of shop_id (048 §6, I1/I2/I8)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopA: string;
  let shopB: string;
  let idA: SeededIdentity;
  let idB: SeededIdentity;
  let deviceA: Awaited<ReturnType<typeof openDevice>>;
  let operatorA: Awaited<ReturnType<typeof openOperator>>;

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_tenant_isolation");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopA = await seedShop(ownerPool, { name: "Shop A", slug: `tenant-a-${Date.now()}` });
    shopB = await seedShop(ownerPool, { name: "Shop B", slug: `tenant-b-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    app = await buildApp(pool, testConfig({ databaseUrl: appUrl(migrateUrl), uploadsDir: UPLOADS_DIR }));
    idA = await seedIdentity(pool, shopA);
    idB = await seedIdentity(pool, shopB);
    deviceA = await openDevice(pool, idA);
    operatorA = await openOperator(pool, deviceA, idA.operatorId);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const authed = cookieHeader.bind(null);

  async function attemptCount(): Promise<number> {
    const res = await pool.query(`SELECT count(*)::int AS n FROM auth_attempt`);
    return (res.rows[0] as { n: number }).n;
  }
  const bothCookies = (): string => cookieHeader(deviceA.token, operatorA.token);

  // -------------------------------------------------------------------------
  // I1 — anonymous reaches nothing; device-only reaches exactly two things.
  // -------------------------------------------------------------------------

  it("refuses every shop-scoped route anonymously, with ONE code and no details", async () => {
    const routes = app.registeredRoutes.filter(
      (r) => r.url.startsWith(`${API_PREFIX}/shops/:shopId`) && r.method !== "HEAD"
    );
    expect(routes.length).toBeGreaterThan(5);
    for (const route of routes) {
      const url = route.url.replace(":shopId", shopA).replace(":id", randomUUID());
      const res = await app.inject({
        method: route.method as "GET" | "POST",
        url,
        headers: writeHeaders(),
        ...(route.method === "POST" ? { payload: {} } : {}),
      });
      expect(res.statusCode, `${route.method} ${route.url}`).toBe(401);
      expect(res.json().error.code).toBe("SESSION_REQUIRED");
      expect(res.json().error.details).toEqual({});
    }
  });

  it("lets a DEVICE-ONLY session reach exactly the picker and the shops route, and nothing else", async () => {
    const deviceOnly = { cookie: authed(deviceA.token) };

    // The enumerated set (R8), asserted POSITIVELY so a route added later is
    // outside it by default rather than inside it by omission.
    const roster = await app.inject({ method: "GET", url: `${API_PREFIX}/operators`, headers: deviceOnly });
    expect(roster.statusCode).toBe(200);
    const shops = await app.inject({ method: "GET", url: `${API_PREFIX}/shops`, headers: deviceOnly });
    expect(shops.statusCode).toBe(200);

    // Everything else refuses — and with a DIFFERENT code, because the action
    // differs: this one means "tap your name", not "this phone is not set up".
    const write = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/shops/${shopA}/scan-sessions`,
      headers: { ...writeHeaders(), ...deviceOnly },
      payload: {},
    });
    expect(write.statusCode).toBe(401);
    expect(write.json().error.code).toBe("OPERATOR_REQUIRED");

    const read = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/shops/${shopA}/scan-sessions/${randomUUID()}`,
      headers: deviceOnly,
    });
    expect(read.statusCode).toBe(401);
    expect(read.json().error.code).toBe("OPERATOR_REQUIRED");
  });

  it("renders a roster of display names and NOTHING per-person (I7, 022 P3)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/operators`,
      headers: { cookie: authed(deviceA.token) },
    });
    const body = res.json() as { operators: Array<Record<string, unknown>> };
    expect(body.operators.length).toBeGreaterThan(0);
    for (const entry of body.operators) {
      // **A roster is a list of who could be holding the phone; a leaderboard is
      // a list of what they did, and the difference is one sort order.** No
      // count, no timestamp, no ordering key, no "last used", no badge.
      expect(Object.keys(entry).sort()).toEqual(["display_name", "id"]);
    }
    // Sorted by a stable, activity-independent key.
    const names = body.operators.map((o) => o["display_name"] as string);
    expect(names).toEqual([...names].sort());
  });

  // -------------------------------------------------------------------------
  // I2 — a wrong tenant is indistinguishable from absence.
  // -------------------------------------------------------------------------

  it("answers a wrong tenant EXACTLY as it answers a shop that never existed", async () => {
    const wrongTenant = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/shops/${shopB}/scan-sessions`,
      headers: { ...writeHeaders(), cookie: bothCookies() },
      payload: {},
    });
    const neverIssued = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/shops/${randomUUID()}/scan-sessions`,
      headers: { ...writeHeaders(), cookie: bothCookies() },
      payload: {},
    });

    expect(wrongTenant.statusCode).toBe(404);
    expect(wrongTenant.json().error.code).toBe("SHOP_NOT_FOUND");
    // BYTE-IDENTICAL but for the correlation id, which differs per request by
    // construction (042 §4.7). A distinct "you may not access this shop" answer
    // would CONFIRM the shop exists, which is an enumeration oracle over exactly
    // the table `GET /api/v1/shops` enumerates — and 019 T24 signs cross-tenant
    // access at zero, NON-WAIVABLE.
    const strip = (r: typeof wrongTenant): unknown => {
      const body = r.json() as { error: Record<string, unknown> };
      delete body.error["correlation_id"];
      return body;
    };
    expect(neverIssued.statusCode).toBe(wrongTenant.statusCode);
    expect(strip(neverIssued)).toEqual(strip(wrongTenant));
  });

  it("refuses the moment the membership is revoked, without waiting for an expiry", async () => {
    const person = await pool.query(
      `INSERT INTO app_user (email, display_name) VALUES ($1,'Leaver') RETURNING id`,
      [`leaver-${randomUUID()}@example.invalid`]
    );
    const appUserId = (person.rows[0] as { id: string }).id;
    const membership = await pool.query(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, role)
       VALUES ($1,$2,'shop','operator') RETURNING id`,
      [appUserId, shopA]
    );
    const session = await openOperator(pool, deviceA, appUserId);
    const cookies = cookieHeader(deviceA.token, session.token);

    const before = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/shops/${shopA}/scan-sessions/${randomUUID()}`,
      headers: { cookie: cookies },
    });
    // Past the tenant check; the session id is simply unknown.
    expect(before.json().error.code).toBe("SESSION_NOT_FOUND");

    await pool.query(
      `INSERT INTO membership_revocation (shop_id, membership_id, reason) VALUES ($1,$2,'left')`,
      [shopA, (membership.rows[0] as { id: string }).id]
    );

    const after = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/shops/${shopA}/scan-sessions/${randomUUID()}`,
      headers: { cookie: cookies },
    });
    // The session is not evidence of a membership; it is evidence of WHO IS
    // ASKING, and the membership is checked every request (048 §2.3).
    expect(after.statusCode).toBe(404);
    expect(after.json().error.code).toBe("SHOP_NOT_FOUND");
  });

  // -------------------------------------------------------------------------
  // I8 — the operator comes from the session and from nowhere else.
  // -------------------------------------------------------------------------

  it("stamps operator_id and actor_verified from the SESSION on every write", async () => {
    const created = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/shops/${shopA}/scan-sessions`,
      headers: { ...writeHeaders(), cookie: bothCookies() },
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    const sessionId = (created.json() as { session: { id: string } }).session.id;

    const row = await pool.query(
      `SELECT operator_id, actor_verified, created_by FROM scan_session WHERE id = $1`,
      [sessionId]
    );
    expect(row.rows[0]).toEqual({
      operator_id: idA.operatorId,
      actor_verified: true,
      // 041 §8.4: `created_by` keeps its DEFAULT and gains no writer. A system
      // that wrote both a verified id and an unverified string would have two
      // attributions and no rule for which is true.
      created_by: "employee",
    });

    const confirm = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/shops/${shopA}/scan-sessions/${sessionId}/confirm`,
      headers: { ...writeHeaders(), cookie: bothCookies() },
      payload: { issue: { title: "A Book", issue: "1" }, source: "grid_pick" },
    });
    expect(confirm.statusCode).toBe(201);
    const confirmed = await pool.query(
      `SELECT operator_id, actor_verified FROM human_confirmation WHERE scan_session_id = $1`,
      [sessionId]
    );
    expect(confirmed.rows[0]).toEqual({ operator_id: idA.operatorId, actor_verified: true });
  });

  it("refuses a body that tries to supply its own operator", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/shops/${shopA}/scan-sessions`,
      headers: { ...writeHeaders(), cookie: bothCookies() },
      payload: { operator_id: idB.operatorId, created_by: "somebody else" },
    });
    // The `.strict()` schema refuses it before any service runs — I8's first
    // clause, and the reason it is a SCHEMA rule rather than a handler check.
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  // -------------------------------------------------------------------------
  // I13 — all four roles are implemented, including the one the pilot does not use.
  // -------------------------------------------------------------------------

  it("carries EXACTLY 034's four roles in the CHECK, and resolves the one no pilot shop has", async () => {
    const check = await pool.query(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'membership' AND c.conname = 'membership_role_check'`
    );
    const def = (check.rows[0] as { def: string }).def;
    for (const role of ["owner", "manager", "operator", "support_break_glass"]) {
      expect(def, role).toContain(role);
    }
    await expect(
      pool.query(
        `INSERT INTO membership (app_user_id, shop_id, scope_kind, role) VALUES ($1,$2,'shop','district')`,
        [idA.operatorId, shopA]
      )
    ).rejects.toThrow(/membership_role_check|violates check constraint/);

    // **A role present in 034 and absent from the code fails the build.**
    // `manager` is absent from the representative shop (034 §2.6 sources it to
    // the 19% with a second storefront), which is exactly why it is the role an
    // implementation drops silently and a second shop discovers by being unable
    // to express its own staffing.
    const manager = await pool.query(
      `INSERT INTO app_user (email, display_name) VALUES ($1,'Manager') RETURNING id`,
      [`manager-${randomUUID()}@example.invalid`]
    );
    const managerId = (manager.rows[0] as { id: string }).id;
    await pool.query(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, location_id, role)
       VALUES ($1,$2,'location',$3,'manager')`,
      [managerId, shopA, idA.locationId]
    );
    const session = await openOperator(pool, deviceA, managerId);
    const res = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/shops/${shopA}/scan-sessions/${randomUUID()}`,
      headers: { cookie: cookieHeader(deviceA.token, session.token) },
    });
    // Past the tenant check — the manager's membership resolved and scoped the
    // request; the session id is simply unknown.
    expect(res.json().error.code).toBe("SESSION_NOT_FOUND");
  });

  it("never flips a pre-G2 row's actor_verified to true", async () => {
    // A row written before any of this existed: `operator_id` NULL,
    // `actor_verified` false. 034 §4.4 and `003:44-51` forbid backfilling it,
    // and the append-only trigger makes the prohibition structural rather than
    // procedural.
    const legacy = await pool.query(
      `INSERT INTO scan_session (shop_id, created_by) VALUES ($1,'employee') RETURNING id`,
      [shopA]
    );
    const id = (legacy.rows[0] as { id: string }).id;
    const row = await pool.query(`SELECT operator_id, actor_verified FROM scan_session WHERE id = $1`, [id]);
    expect(row.rows[0]).toEqual({ operator_id: null, actor_verified: false });
  });

  // -------------------------------------------------------------------------
  // I6(a) — every Set-Cookie this server emits, on a real response.
  // -------------------------------------------------------------------------

  it("sets both cookies with the full attribute set and no Domain", async () => {
    const device = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/device-sessions`,
      headers: writeHeaders(),
      payload: { device_secret: idB.deviceSecret },
    });
    expect(device.statusCode).toBe(201);
    const deviceCookie = setCookieOf(device.headers, DEVICE_COOKIE);
    assertCookieShape(deviceCookie, DEVICE_COOKIE);

    const operator = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/operator-sessions`,
      headers: { ...writeHeaders(), cookie: valueOf(deviceCookie) },
      payload: { app_user_id: idB.operatorId, pin: TEST_PIN },
    });
    expect(operator.statusCode).toBe(201);
    assertCookieShape(setCookieOf(operator.headers, OPERATOR_COOKIE), OPERATOR_COOKIE);
  });

  it("refuses an unknown device secret with the same code as no cookie at all", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/device-sessions`,
      headers: writeHeaders(),
      payload: { device_secret: "not-a-real-secret" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("SESSION_REQUIRED");
    expect(res.json().error.details).toEqual({});
  });

  // -------------------------------------------------------------------------
  // The one anonymous, mutating, append-only-WRITING route is bounded (048 R14).
  //
  // The invariant review found it unmetered: `rateClass: "device"` was declared
  // in the route table and asserted by the route walk, while the hook's bucket
  // sat AFTER the `required === "none"` short-circuit and keyed on a session
  // that cannot exist here. Four hundred anonymous POSTs produced four hundred
  // refusals, zero throttles and four hundred `auth_attempt` rows. **A declared
  // rate class nobody takes is a rate class in a table**, which is the same
  // failure mode 048 R10 names for a check that runs in the wrong place.
  // -------------------------------------------------------------------------
  it("throttles a burst on POST /device-sessions, and stops appending attempts once it does", async () => {
    const limiter = new ShopRateLimiter({ ordinaryPerMinute: 3 });
    const bounded = await buildApp(pool, testConfig({ databaseUrl: "", uploadsDir: UPLOADS_DIR }), {
      limiter,
    });
    try {
      const before = await attemptCount();
      const codes: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        const res = await bounded.inject({
          method: "POST",
          url: `${API_PREFIX}/device-sessions`,
          headers: writeHeaders(),
          // A DIFFERENT wrong secret each time: keying on the presented digest
          // alone would hand every guess a fresh budget, which is why the hook
          // takes a route-wide bucket as well.
          payload: { device_secret: `wrong-${randomUUID()}` },
        });
        codes.push(res.statusCode);
      }

      expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
      expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(3);
      expect(limiter.events.ordinaryThrottled).toBeGreaterThan(0);

      // AND THE TABLE STOPPED GROWING. A throttled request is refused before a
      // credential is tested, so there is nothing to record — the same rule the
      // blocked PIN follows (048 §9.1, R5), and the reason a flooder cannot grow
      // the very table the lockout derivation reads.
      const after = await attemptCount();
      expect(after - before).toBe(codes.filter((c) => c === 401).length);
      expect(after - before).toBeLessThanOrEqual(3);
    } finally {
      await bounded.close();
    }
  });

  it("bounds a REPLAY of one secret on its own digest, not on the person (048 R14)", async () => {
    // The second bucket: `openDeviceSession` keys on `sha256(secret)` before it
    // looks anything up. The route bucket is generous here so the digest bucket
    // is the one under test.
    const limiter = new ShopRateLimiter({ ordinaryPerMinute: 10_000 });
    const bounded = await buildApp(pool, testConfig({ databaseUrl: "", uploadsDir: UPLOADS_DIR }), {
      limiter,
    });
    try {
      const secret = `replayed-${randomUUID()}`;
      const codes: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const res = await bounded.inject({
          method: "POST",
          url: `${API_PREFIX}/device-sessions`,
          headers: writeHeaders(),
          payload: { device_secret: secret },
        });
        codes.push(res.statusCode);
      }
      // Distinct from the route bucket: a different secret is still served while
      // this one is spent, because the key is the credential and not the caller.
      expect(codes).toContain(401);
      const other = await bounded.inject({
        method: "POST",
        url: `${API_PREFIX}/device-sessions`,
        headers: writeHeaders(),
        payload: { device_secret: `other-${randomUUID()}` },
      });
      expect(other.statusCode).toBe(401);
    } finally {
      await bounded.close();
    }
  });

  it("refuses a wrong PIN with ONE code and no details, whatever went wrong", async () => {
    const device = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/device-sessions`,
      headers: writeHeaders(),
      payload: { device_secret: idB.deviceSecret },
    });
    const cookie = valueOf(setCookieOf(device.headers, DEVICE_COOKIE));

    const wrongPin = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/operator-sessions`,
      headers: { ...writeHeaders(), cookie },
      payload: { app_user_id: idB.operatorId, pin: "913574" },
    });
    const strangerAtThisShop = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/operator-sessions`,
      headers: { ...writeHeaders(), cookie },
      // A real person, with a real PIN — on ANOTHER shop's device.
      payload: { app_user_id: idA.operatorId, pin: TEST_PIN },
    });

    for (const res of [wrongPin, strangerAtThisShop]) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("PIN_INVALID");
      // No `details`, and in particular no retry-after: publishing the delay
      // would say that THIS pair has recent failures, which is a per-operator
      // fact leaking out of an authentication boundary (022 P3).
      expect(res.json().error.details).toEqual({});
      expect(res.headers["retry-after"]).toBeUndefined();
    }
  });
});

function setCookieOf(headers: Record<string, unknown>, name: string): string {
  const raw = headers["set-cookie"];
  const all = Array.isArray(raw) ? raw : [String(raw)];
  const found = all.find((c) => c.startsWith(`${name}=`));
  if (!found) throw new Error(`no ${name} in Set-Cookie: ${JSON.stringify(all)}`);
  return found;
}

function valueOf(setCookie: string): string {
  return setCookie.split(";")[0]!;
}

function assertCookieShape(header: string, name: string): void {
  expect(header.startsWith(`${name}=`)).toBe(true);
  expect(header).toContain("HttpOnly");
  expect(header).toContain("Secure");
  expect(header).toContain("SameSite=Strict");
  expect(header).toContain("Path=/");
  expect(header).not.toContain("Domain=");
  expect(name.startsWith("__Host-")).toBe(true);
}
