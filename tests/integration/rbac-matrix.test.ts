// L4: **one HTTP case per (role, route) pair, generated FROM the matrix.**
//
// Bead: longbox-e5b.3.3 (alias E03-B03). Docs: 054 §3, §6; 034 §2.6, §3.4;
// 048 §3.5, §6.5; 019 T24 (non-waivable); 022 P3.
//
// ============================================================================
// THE TEST'S SOURCE IS THE CONSTANT — AND WHAT THAT DOES AND DOES NOT PROVE
// ============================================================================
//
// The cases below are not written out. They are the cross product of
// `ROLE_GRANTS`'s four roles with the route table's shop-scoped rows, and the
// EXPECTATION for each cell is read off the matrix. That is deliberate: a
// hand-written list of forty-odd expectations is a second copy of the policy,
// and the day somebody widens a role, the second copy is what tells them their
// change is fine.
//
// ⚠ **BE PRECISE ABOUT WHAT IT BUYS** (invariant review, note 7). Generating the
// expectations from the constant means this suite proves **ENFORCEMENT** — that
// the running server does what the matrix says, for every pair — and it CANNOT
// prove the matrix is the intended one, because a widened `ROLE_GRANTS` widens
// these expectations with it and the suite stays green. **The constant itself is
// pinned character by character in `tests/auth-permissions.test.ts`**, which is
// the test that goes red on a widening. Two tests, two jobs: the unit pin says
// *"this is the policy"* and this suite says *"and the server obeys it"*. Saying
// they jointly make drift impossible would be the over-claim; saying neither is
// sufficient alone is the truth.
//
// What the cell asserts is narrow on purpose: **was the request refused for
// PERMISSION, or not.** A route that a role may reach can still answer 404 for a
// session id this test invented, or 400 for a body it did not send — those are
// other beads' properties and asserting them here would make this suite fail for
// reasons that have nothing to do with authorization. The one thing that must be
// exactly right is whether the permission gate stood in the way.
//
// ============================================================================
// AND THE REFUSALS ARE NOT THE SAME REFUSAL
// ============================================================================
//
// A role that does not hold a permission gets `403 PERMISSION_DENIED`. A person
// whose grant is at ANOTHER LOCATION gets `404 SHOP_NOT_FOUND`, byte-identical
// to what a caller with no membership at all receives — 019 T24's
// indistinguishability, asserted by comparing the two bodies rather than by
// reading two code paths.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { ROUTES } from "../../src/contracts/v1/routes.js";
import { TENANT_PREFIX } from "../../src/contracts/v1/schemas.js";
import { ROLE_GRANTS, type Role } from "../../src/services/auth/index.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import {
  cookieHeader,
  insertUser,
  openDevice,
  openOperator,
  seedIdentity,
  writeHeaders,
  type SeededIdentity,
} from "./authHelpers.js";
import { testConfig } from "../testConfig.js";

const dbUp = await probeDb();
const UPLOADS_DIR = "tests/.tmp-rbac-uploads";

/** Every shop-scoped route, which is exactly the set the permission gate covers. */
const TENANT_ROUTES = ROUTES.filter((r) => r.path.startsWith(TENANT_PREFIX));
const ROLES = Object.keys(ROLE_GRANTS) as Role[];

describe.skipIf(!dbUp)("least privilege, one case per (role, route) pair (054 §3)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;
  let identity: SeededIdentity;
  let device: Awaited<ReturnType<typeof openDevice>>;
  /** One live operator session per role, on the same enrolled phone. */
  const cookies = new Map<Role, string>();
  let otherLocationId: string;

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_rbac_matrix");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Matrix Shop", slug: `rbac-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    app = await buildApp(pool, testConfig({ databaseUrl: appUrl(migrateUrl), uploadsDir: UPLOADS_DIR }));

    identity = await seedIdentity(pool, shopId);
    device = await openDevice(pool, identity);

    // A second location at the same shop, for the location-scope cases. The
    // device (and therefore every session in this suite) is pinned to the FIRST
    // one, so a grant scoped here is a grant somewhere the phone is not.
    const other = await pool.query(
      `INSERT INTO location (shop_id, kind, name) VALUES ($1,'store','Second counter') RETURNING id`,
      [shopId]
    );
    otherLocationId = (other.rows[0] as { id: string }).id;

    for (const role of ROLES) {
      const userId = await insertUser(pool, `${role}-${Date.now()}@example.invalid`, `Person ${role}`);
      await grantAt(userId, role, "shop", null);
      const session = await openOperator(pool, device, userId);
      cookies.set(role, cookieHeader(device.token, session.token));
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  /** A grant of any role at any scope. Break-glass carries its mandatory expiry and reason. */
  async function grantAt(
    appUserId: string,
    role: Role,
    scopeKind: "shop" | "location",
    locationId: string | null
  ): Promise<string> {
    const res = await pool.query(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, location_id, role, effective_until, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        appUserId,
        shopId,
        scopeKind,
        locationId,
        role,
        role === "support_break_glass" ? new Date(Date.now() + 3_600_000) : null,
        role === "support_break_glass" ? "matrix suite grant" : null,
      ]
    );
    return (res.rows[0] as { id: string }).id;
  }

  async function call(cookie: string, route: (typeof TENANT_ROUTES)[number], shop = shopId) {
    const url = route.path
      .replace(":shopId", shop)
      .replace(":id", randomUUID())
      .replace(":photoId", randomUUID());
    return app.inject({
      method: route.method,
      url,
      headers: route.mutating ? { ...writeHeaders(), cookie } : { "sec-fetch-site": "same-origin", cookie },
      ...(route.mutating && route.request !== null ? { payload: {} } : {}),
    });
  }

  // -------------------------------------------------------------------------
  // The cross product. Four roles × nine routes, generated.
  // -------------------------------------------------------------------------
  for (const role of ROLES) {
    for (const route of TENANT_ROUTES) {
      const permission = route.requires!;
      const allowed = ROLE_GRANTS[role].includes(permission);
      const label = `${role} ${allowed ? "MAY" : "may NOT"} ${route.method} ${route.path} (${permission})`;

      it(label, async () => {
        const res = await call(cookies.get(role)!, route);
        const code = (res.json() as { error?: { code?: string } }).error?.code;
        if (allowed) {
          // Not 403, and not the tenancy 404 either — a permitted role must not
          // be refused by either arm of the gate. Whatever else the route
          // answers (a 404 for the invented session id, a 400 for the empty
          // body) belongs to another bead.
          expect(code, `${label}: refused with ${code}`).not.toBe("PERMISSION_DENIED");
          expect(code, `${label}: refused as a wrong tenant`).not.toBe("SHOP_NOT_FOUND");
        } else {
          expect(res.statusCode, label).toBe(403);
          expect(code, label).toBe("PERMISSION_DENIED");
        }
      });
    }
  }

  it("covers every shop-scoped route and every role, so nothing is missing by omission", () => {
    // The guard on the generator itself: if the route table were filtered wrong,
    // the loop above would silently assert nothing. Nine routes today.
    expect(TENANT_ROUTES.length).toBeGreaterThanOrEqual(9);
    expect(ROLES.sort()).toEqual(["manager", "operator", "owner", "support_break_glass"]);
    for (const route of TENANT_ROUTES) expect(route.requires).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Location scope, and the refusal that must be indistinguishable (019 T24).
  // -------------------------------------------------------------------------

  describe("a location-scoped grant is refused at another location, as an ABSENT shop", () => {
    let elsewhereCookie: string;
    let strangerCookie: string;
    let hereCookie: string;

    beforeAll(async () => {
      // Same role, same shop, three different grants: one scoped to the OTHER
      // location, one to no shop at all, one to the location the phone is at.
      const elsewhere = await insertUser(pool, `elsewhere-${Date.now()}@example.invalid`, "Person Elsewhere");
      await grantAt(elsewhere, "operator", "location", otherLocationId);
      elsewhereCookie = cookieHeader(device.token, (await openOperator(pool, device, elsewhere)).token);

      const stranger = await insertUser(pool, `stranger-${Date.now()}@example.invalid`, "Person Stranger");
      strangerCookie = cookieHeader(device.token, (await openOperator(pool, device, stranger)).token);

      const here = await insertUser(pool, `here-${Date.now()}@example.invalid`, "Person Here");
      await grantAt(here, "operator", "location", identity.locationId);
      hereCookie = cookieHeader(device.token, (await openOperator(pool, device, here)).token);
    });

    const route = TENANT_ROUTES.find((r) => r.path.endsWith("/scan-sessions") && r.method === "POST")!;

    it("ALLOWS the same grant at the location the phone is pinned to", async () => {
      const res = await call(hereCookie, route);
      const code = (res.json() as { error?: { code?: string } }).error?.code;
      expect(code).not.toBe("PERMISSION_DENIED");
      expect(code).not.toBe("SHOP_NOT_FOUND");
    });

    it("refuses the other location BYTE-IDENTICALLY to a caller with no membership at all", async () => {
      // 019 T24 and 048 §6.5. The two requests differ in everything an attacker
      // controls and in nothing they can observe. `correlation_id` is per-request
      // by construction (042 §4.7) and is the only field excluded.
      const elsewhere = await call(elsewhereCookie, route);
      const stranger = await call(strangerCookie, route);
      expect(elsewhere.statusCode).toBe(404);
      expect(stranger.statusCode).toBe(404);
      expect(withoutCorrelation(elsewhere.json())).toEqual(withoutCorrelation(stranger.json()));
      expect((elsewhere.json() as { error: { code: string; details: unknown } }).error.code).toBe(
        "SHOP_NOT_FOUND"
      );
      expect((elsewhere.json() as { error: { details: unknown } }).error.details).toEqual({});
    });

    it("refuses a SHOP-scoped permission to a location-scoped manager, wherever they stand", async () => {
      // `membership.invite` has no route yet (E03-D11), so the assertion is on
      // the decision the CLI path takes — recorded here because the ROUTE will
      // inherit it and this suite is where a reader looks for the answer.
      const manager = await insertUser(pool, `locmgr-${Date.now()}@example.invalid`, "Person LocMgr");
      await grantAt(manager, "manager", "location", identity.locationId);
      const { authorize, membershipsAt } = await import("../../src/services/auth/index.js");
      const held = await membershipsAt(pool, manager, shopId);
      expect(
        authorize(held, "membership.invite", { atLocation: identity.locationId, now: new Date() }).kind
      ).toBe("refused_scope");
      expect(
        authorize(held, "device.enrollment.issue", { atLocation: identity.locationId, now: new Date() }).kind
      ).toBe("allowed");
    });
  });
});

function withoutCorrelation(body: unknown): unknown {
  const b = body as { error: Record<string, unknown> };
  const { correlation_id: _ignored, ...rest } = b.error;
  return { error: rest };
}
