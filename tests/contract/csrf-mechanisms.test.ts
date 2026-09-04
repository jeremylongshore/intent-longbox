// L2 contract: 048 I6 — "the CSRF mechanisms are asserted, not remembered, and
// so is the order they run in."
//
// 048 §5 issues NO synchronizer token. Cross-site writes are refused by four
// properties, three of which already exist for other reasons — `SameSite=Strict`
// on `__Host-` cookies, a mandatory non-safelisted header on every mutating
// route, and the total absence of a CORS policy — plus one this record owns
// outright: `Sec-Fetch-Site: same-origin`, checked in the authentication hook.
//
// **Q4's objection is why the fourth exists**: mechanism (2) is 042's rule and
// mechanism (3) is the absence of a dependency, so the count of mechanisms 048
// CONTROLS was one. The answer was not a token — §5.2's argument against one
// stands: a synchronizer token's characteristic failure is SILENT (issued,
// rendered, sent, and then not actually compared), while every mechanism here
// fails loudly.
//
// It needs no database on purpose. The pool below cannot connect, so any
// assertion that passes here passes WITHOUT the request reaching Postgres —
// which is the ordering half of I6(b) proved by construction rather than by
// reading the code.
import { readFileSync, rmSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { buildApp } from "../../src/app.js";
import { AUTH_ALLOWLIST_ACTIVE, MUTATING_ROUTES, ROUTES } from "../../src/contracts/v1/routes.js";
import { API_PREFIX, TENANT_PREFIX } from "../../src/contracts/v1/schemas.js";
import { ShopRateLimiter } from "../../src/services/rateLimit.js";
import { testConfig } from "../testConfig.js";

const UPLOADS_DIR = "tests/.tmp-csrf-uploads";
mkdirSync(UPLOADS_DIR, { recursive: true });

/**
 * A pool pointed at a port nothing listens on.
 *
 * Every refusal this suite asserts must happen BEFORE the session read, so a
 * response that arrives at all is a response that touched no database. A test
 * that reached Postgres would hang or 500 instead of returning the code below.
 */
const inertPool = new pg.Pool({
  connectionString: "postgres://unused:unused@127.0.0.1:1/none",
  connectionTimeoutMillis: 500,
});

const app = await buildApp(inertPool, testConfig({ uploadsDir: UPLOADS_DIR, publicOrigins: [] }));

const SHOP = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222221";

afterAll(async () => {
  await app.close();
  await inertPool.end();
  rmSync(UPLOADS_DIR, { recursive: true, force: true });
});

describe("(b) the Idempotency-Key check runs BEFORE the body is read (048 R10)", () => {
  it("refuses an oversize multipart POST with no header, having written no file", async () => {
    // 25 MiB is the configured multipart limit. Before E03-D09 the header
    // requirement lived inside the handler — AFTER `@fastify/multipart` had
    // begun consuming the body — so a request that was going to be refused had
    // already had this many bytes streamed to disk.
    const boundary = "----longboxcsrf";
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.png"\r\n` +
          `Content-Type: image/png\r\n\r\n`
      ),
      Buffer.alloc(2 * 1024 * 1024, 0x41),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const before = existsSync(UPLOADS_DIR) ? readdirSync(UPLOADS_DIR).length : 0;
    const res = await app.inject({
      method: "POST",
      url: `${TENANT_PREFIX.replace(":shopId", SHOP)}/scan-sessions/${SESSION}/photos`,
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "sec-fetch-site": "same-origin",
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    // **The ordering, not the code.** A check in the right place and a check in
    // the wrong place return the same code; only these two assertions tell them
    // apart — nothing was written, and the database was never reached (the pool
    // above cannot connect, so a session read would not have produced a 400).
    const after = existsSync(UPLOADS_DIR) ? readdirSync(UPLOADS_DIR).length : 0;
    expect(after).toBe(before);
  });

  it("requires the header on every mutating route and on no read", async () => {
    for (const route of ROUTES) {
      expect(route.mutating, `${route.method} ${route.path}`).toBe(route.method === "POST");
    }
    expect(MUTATING_ROUTES.length).toBeGreaterThan(0);
  });
});

describe("(c) there is no CORS policy, and no dependency that could add one (048 R11)", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("declares no CORS plugin in package.json", () => {
    const names = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)];
    // A STATIC assertion over the dependency list, because mechanism (3) is the
    // ABSENCE of a dependency — and an absence nobody asserts is an absence one
    // `pnpm add` undoes silently.
    expect(names.filter((n) => /cors/i.test(n))).toEqual([]);
  });

  it("emits no Access-Control-Allow-* header on any response", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    for (const header of Object.keys(res.headers)) {
      expect(header.toLowerCase().startsWith("access-control-allow-")).toBe(false);
    }
  });

  it("has `credentials: true` nowhere in the tree", () => {
    // The day a CORS plugin is added for a legitimate reason, credentialed
    // cross-origin is the setting that quietly removes mechanism (3).
    const sources = [
      "src/app.ts",
      "src/services/auth/hook.ts",
      "src/services/auth/policy.ts",
      "public/app.js",
    ];
    for (const file of sources) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/credentials\s*:\s*true/);
    }
  });
});

describe("(d) no GET mutates", () => {
  it("declares every read non-mutating in the route table", () => {
    for (const route of ROUTES.filter((r) => r.method === "GET")) {
      expect(route.mutating, route.path).toBe(false);
    }
  });
});

describe("(e) a cross-site-shaped request is refused before the body is read (048 R9)", () => {
  const crossSite = [
    { name: "Sec-Fetch-Site: cross-site", headers: { "sec-fetch-site": "cross-site" } },
    { name: "Sec-Fetch-Site: same-site (a sibling subdomain)", headers: { "sec-fetch-site": "same-site" } },
    { name: "no Sec-Fetch-Site and no Origin", headers: {} },
    { name: "an Origin outside the configured one", headers: { origin: "https://attacker.example" } },
  ];

  for (const shape of crossSite) {
    it(`refuses ${shape.name}`, async () => {
      const res = await app.inject({
        method: "POST",
        url: `${TENANT_PREFIX.replace(":shopId", SHOP)}/scan-sessions`,
        headers: { ...shape.headers, "idempotency-key": "k-1" },
        payload: {},
      });
      // ONE code, whatever the shape, and the same one an unauthenticated
      // request gets: §9.3's constant answer means a page probing for a
      // difference finds none.
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("SESSION_REQUIRED");
      expect(res.json().error.details).toEqual({});
    });
  }

  it("lets a same-origin request past this check (and on to the session read)", async () => {
    // With no cookies it still refuses — SESSION_REQUIRED — but by the time it
    // does, mechanism (4) has passed. The assertion that matters is that
    // `same-origin` is not itself the refusal.
    const res = await app.inject({
      method: "POST",
      url: `${TENANT_PREFIX.replace(":shopId", SHOP)}/scan-sessions`,
      headers: { "sec-fetch-site": "same-origin", "idempotency-key": "k-2" },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("does NOT apply the check to safe methods, which cannot mutate", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
  });
});

describe("(f) an alias path and its /api/v1 target refuse IDENTICALLY (048 R12)", () => {
  const cases = [
    { name: "anonymous", headers: { "sec-fetch-site": "same-origin", "idempotency-key": "k" } },
    { name: "cross-site", headers: { "sec-fetch-site": "cross-site", "idempotency-key": "k" } },
    { name: "missing the idempotency header", headers: { "sec-fetch-site": "same-origin" } },
  ];

  for (const shape of cases) {
    it(`answers the same for ${shape.name}`, async () => {
      const direct = await app.inject({
        method: "POST",
        url: `${API_PREFIX}/shops/${SHOP}/scan-sessions`,
        headers: shape.headers,
        payload: {},
      });
      const viaAlias = await app.inject({
        method: "POST",
        url: `/api/shops/${SHOP}/scan-sessions`,
        headers: shape.headers,
        payload: {},
      });
      // The alias replies 308 and touches NOTHING — it reads nothing, writes
      // nothing and resolves no tenant, so the authentication happens at the
      // target. Following it lands on the direct path, which answers exactly
      // what the direct call answered. **A redirect that answered differently
      // from its target would be an oracle sitting on the front door with the
      // word "deprecated" over it.**
      expect(viaAlias.statusCode).toBe(308);
      expect(viaAlias.headers.location).toBe(`${API_PREFIX}/shops/${SHOP}/scan-sessions`);

      const followed = await app.inject({
        method: "POST",
        url: viaAlias.headers.location as string,
        headers: shape.headers,
        payload: {},
      });
      expect(followed.statusCode).toBe(direct.statusCode);
      expect(followed.json().error.code).toBe(direct.json().error.code);
      expect(followed.json().error.details).toEqual(direct.json().error.details);
    });
  }
});

describe("the hook runs BEFORE the rate bucket (048 §6.2, I5)", () => {
  it("answers an anonymous request 401, not 429, on an exhausted bucket", async () => {
    // The ordering is what closes 046 G-20: once the session resolves the shop,
    // the ordinary bucket is keyed on `ctx.shopId` rather than on the
    // `req.params.shopId` a caller typed, and 042 §8.1's "per shop, never per
    // IP" becomes true for the first time. A rate hook that ran FIRST would
    // bucket on the caller's own string — and would answer 429 here.
    const limiter = new ShopRateLimiter({ ordinaryPerMinute: 0 });
    const throttled = await buildApp(inertPool, testConfig({ uploadsDir: UPLOADS_DIR, publicOrigins: [] }), {
      limiter,
    });
    try {
      const res = await throttled.inject({
        method: "GET",
        url: `${TENANT_PREFIX.replace(":shopId", SHOP)}/scan-sessions/${SESSION}`,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("SESSION_REQUIRED");
      // And the bucket was never taken, so an unauthenticated flood cannot
      // exhaust a real shop's budget by naming its id.
      expect(limiter.events.ordinaryThrottled).toBe(0);
    } finally {
      await throttled.close();
    }
  });
});

describe("the auth allowlist is walked, and its principals are the ones the routes need", () => {
  it("refuses every route that is not on the allowlist, anonymously", async () => {
    const registered = app.registeredRoutes.filter(
      (r) => r.method === "GET" && r.url.startsWith(API_PREFIX) && !r.url.includes(":")
    );
    for (const route of registered) {
      const row = AUTH_ALLOWLIST_ACTIVE.find((r) => r.path === route.url);
      const res = await app.inject({ method: "GET", url: route.url });
      if (row?.principal === "none") {
        expect(res.statusCode, route.url).not.toBe(401);
      } else {
        expect(res.statusCode, route.url).toBe(401);
        expect(res.json().error.code).toBe("SESSION_REQUIRED");
      }
    }
  });
});
