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
import { serviceDb } from "../../src/db.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { API_PREFIX } from "../../src/contracts/v1/schemas.js";
import { DEVICE_COOKIE, OPERATOR_COOKIE } from "../../src/services/auth/index.js";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import {
  TEST_PIN,
  cookieHeader,
  grant,
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
    asShop(pool, shopA).query(sql, values);

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
    // The `device-session-open` scope, because the rows this counts have a NULL
    // `shop_id` — a failed device-session open names no shop yet (E03-B04), and a
    // NULL matches no tenant policy, ever.
    const res = await serviceDb(pool, "device-session-open").query(
      `SELECT count(*)::int AS n FROM auth_attempt`
    );
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

  // -------------------------------------------------------------------------
  // 048 §6.4 / 019 T24 — *MY SHOPS*. E03-D08.
  //
  // The route this suite's own I2 comment calls "the table `GET /api/v1/shops`
  // enumerates" no longer enumerates it. These are the assertions that make that
  // sentence true rather than asserted: shop B exists, is seeded, has a name and
  // a slug, and never appears in shop A's answer.
  // -------------------------------------------------------------------------

  it("shows a DEVICE-ONLY session exactly its own shop, and never the other one", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/shops`,
      headers: { cookie: authed(deviceA.token) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { shops: Array<Record<string, unknown>> };
    expect(body.shops.map((s) => s["id"])).toEqual([shopA]);
    // 019 T24 is non-waivable and cross-tenant access is signed at ZERO, so the
    // assertion is on the whole answer and not on a count: a second shop leaking
    // in under any key fails here.
    expect(JSON.stringify(body)).not.toContain(shopB);
    // The DTO declares three fields and the route projects three. Nothing about
    // the operator, the device, a confidence, a provider or a cost (042 §3.3,
    // 019 T35) — my-shops is a picker, and a picker that grew a "last used"
    // would be the roster's leaderboard failure on a different surface.
    for (const shop of body.shops) expect(Object.keys(shop).sort()).toEqual(["id", "name", "slug"]);
  });

  it("shows an OPERATOR session the shop its session pins, and no other membership", async () => {
    // The operator is granted a live membership at shop B as well. The session
    // is still pinned to shop A by the device it was opened on, so shop B is a
    // shop this session cannot reach — and a picker that listed it would be
    // offering an entry whose every click answers SHOP_NOT_FOUND, while
    // disclosing the name of another shop this person works at to whoever is
    // holding shop A's counter phone (022 P3).
    await grant(pool, idA.operatorId, shopB, "operator");
    const res = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/shops`,
      headers: { cookie: authed(deviceA.token, operatorA.token) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { shops: Array<{ id: string }> };
    expect(body.shops.map((s) => s.id)).toEqual([shopA]);
  });

  it("shows an operator NOTHING once the membership behind the session is revoked", async () => {
    // The session is evidence of WHO is asking, never of what they may reach
    // (048 §2.3, §3.4). A revoked membership empties my-shops on the next
    // request with no sweep and no logout — the same derivation the hook uses.
    const solo = await seedIdentity(pool, shopB, { suffix: "myshops" });
    const device = await openDevice(pool, solo);
    const operator = await openOperator(pool, device, solo.operatorId);
    const cookie = authed(device.token, operator.token);

    const before = await app.inject({ method: "GET", url: `${API_PREFIX}/shops`, headers: { cookie } });
    expect((before.json() as { shops: Array<{ id: string }> }).shops.map((s) => s.id)).toEqual([shopB]);

    // Shop B's context: the revocation is a fact about shop B's grant, and this
    // suite's default context is shop A's (E03-B04). Under the wrong one the
    // SELECT feeding the INSERT sees no membership and the statement writes
    // nothing — a silent no-op, which is the failure mode worth naming.
    await asShop(pool, shopB).query(
      `INSERT INTO membership_revocation (shop_id, membership_id, reason)
       SELECT shop_id, id, 'test' FROM membership WHERE app_user_id = $1 AND shop_id = $2`,
      [solo.operatorId, shopB]
    );

    const after = await app.inject({ method: "GET", url: `${API_PREFIX}/shops`, headers: { cookie } });
    expect(after.statusCode).toBe(200);
    expect((after.json() as { shops: unknown[] }).shops).toEqual([]);
  });

  it("throttles an AUTHENTICATED burst on my-shops, keyed on the device (048 R14)", async () => {
    // ⚠ THE OTHER BURST TEST DOES NOT COVER THIS BRANCH. PR #71's burst hits
    // `POST /api/v1/device-sessions`, which is anonymous and therefore takes the
    // hook's `takeRoute` bucket — the one for a request with no principal yet.
    // `takeDevice` is a DIFFERENT branch, further down the hook, reached only
    // after a session resolves, and until now nothing exercised it through HTTP:
    // the two sessionless routes that declare `rateClass: "device"` and DO have
    // a session (`GET /api/v1/operators`, and now my-shops) were never burst.
    //
    // E03-D08 moved my-shops from `none` to `device`, so this is the assertion
    // that the class it declares is the class it actually spends. A declaration
    // asserted by the route walk with no enforcement behind it is exactly the
    // shape the E03-D09 invariant review found on `/device-sessions`.
    const limiter = new ShopRateLimiter({ ordinaryPerMinute: 2 });
    const bounded = await buildApp(pool, testConfig({ databaseUrl: "", uploadsDir: UPLOADS_DIR }), {
      limiter,
    });
    try {
      const cookie = authed(deviceA.token, operatorA.token);
      const codes: number[] = [];
      let retryAfter: string | undefined;
      for (let i = 0; i < 4; i += 1) {
        const res = await bounded.inject({ method: "GET", url: `${API_PREFIX}/shops`, headers: { cookie } });
        codes.push(res.statusCode);
        if (res.statusCode === 429) {
          retryAfter = res.headers["retry-after"] as string;
          expect(res.json().error.code).toBe("RATE_LIMITED");
        }
      }
      // Two through, then the bucket bites — and it bites with a `Retry-After`,
      // because a throttle a client cannot schedule around is a throttle that
      // becomes a retry storm.
      expect(codes.slice(0, 2)).toEqual([200, 200]);
      expect(codes).toContain(429);
      expect(Number(retryAfter)).toBeGreaterThan(0);
      expect(limiter.events.ordinaryThrottled).toBeGreaterThan(0);

      // AND IT IS KEYED ON THE DEVICE, NOT ON THE PERSON AND NOT ON THE SHOP.
      // A second phone at the SAME shop, held by the SAME two people, is still
      // served while the first one is spent — which is what makes it a device
      // bucket rather than a shop bucket wearing a device's name. 048 §9.1's
      // rule that a stranger must never exhaust a named person's budget is the
      // same rule one level up.
      const second = await seedIdentity(pool, shopA, { suffix: "burst" });
      const secondDevice = await openDevice(pool, second);
      const secondOperator = await openOperator(pool, secondDevice, second.operatorId);
      const other = await bounded.inject({
        method: "GET",
        url: `${API_PREFIX}/shops`,
        headers: { cookie: authed(secondDevice.token, secondOperator.token) },
      });
      expect(other.statusCode).toBe(200);
    } finally {
      await bounded.close();
    }
  });

  it("refuses /api/shops and /api/v1/shops identically for a FORGED cookie (048 I6(f))", async () => {
    // The half of I6(f) the contract suite cannot assert: its pool cannot
    // connect, and a forged cookie has to be LOOKED UP before it is refused. So
    // the alias-and-target comparison for a request that reaches the database
    // lives here, where one exists.
    const headers = { cookie: `${DEVICE_COOKIE}=not-a-real-token` };
    const direct = await app.inject({ method: "GET", url: `${API_PREFIX}/shops`, headers });
    expect(direct.statusCode).toBe(401);
    expect(direct.json().error.code).toBe("SESSION_REQUIRED");

    const viaAlias = await app.inject({ method: "GET", url: "/api/shops", headers });
    expect(viaAlias.statusCode).toBe(308);
    const followed = await app.inject({
      method: "GET",
      url: viaAlias.headers.location as string,
      headers,
    });
    expect(followed.statusCode).toBe(direct.statusCode);
    expect(followed.json().error.code).toBe(direct.json().error.code);
    expect(followed.json().error.details).toEqual(direct.json().error.details);
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
    const person = await shopQuery(
      `INSERT INTO app_user (email, display_name) VALUES ($1,'Leaver') RETURNING id`,
      [`leaver-${randomUUID()}@example.invalid`]
    );
    const appUserId = (person.rows[0] as { id: string }).id;
    const membership = await shopQuery(
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

    await shopQuery(
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

    const row = await shopQuery(
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
    const confirmed = await shopQuery(
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
    const check = await shopQuery(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'membership' AND c.conname = 'membership_role_check'`
    );
    const def = (check.rows[0] as { def: string }).def;
    for (const role of ["owner", "manager", "operator", "support_break_glass"]) {
      expect(def, role).toContain(role);
    }
    await expect(
      shopQuery(
        `INSERT INTO membership (app_user_id, shop_id, scope_kind, role) VALUES ($1,$2,'shop','district')`,
        [idA.operatorId, shopA]
      )
    ).rejects.toThrow(/membership_role_check|violates check constraint/);

    // **A role present in 034 and absent from the code fails the build.**
    // `manager` is absent from the representative shop (034 §2.6 sources it to
    // the 19% with a second storefront), which is exactly why it is the role an
    // implementation drops silently and a second shop discovers by being unable
    // to express its own staffing.
    const manager = await shopQuery(
      `INSERT INTO app_user (email, display_name) VALUES ($1,'Manager') RETURNING id`,
      [`manager-${randomUUID()}@example.invalid`]
    );
    const managerId = (manager.rows[0] as { id: string }).id;
    await shopQuery(
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
    const legacy = await shopQuery(
      `INSERT INTO scan_session (shop_id, created_by) VALUES ($1,'employee') RETURNING id`,
      [shopA]
    );
    const id = (legacy.rows[0] as { id: string }).id;
    const row = await shopQuery(`SELECT operator_id, actor_verified FROM scan_session WHERE id = $1`, [id]);
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
