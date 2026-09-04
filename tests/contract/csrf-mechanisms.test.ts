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
import type { LightMyRequestResponse } from "fastify";
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

  it("has credentialed cross-origin nowhere in the tree, in any spelling", () => {
    // The day a CORS plugin is added for a legitimate reason, credentialed
    // cross-origin is the setting that quietly removes mechanism (3).
    //
    // ⚠ THIS USED TO BE A FOUR-FILE LIST, AND A FOUR-FILE LIST IS NOT A TREE
    // ASSERTION. 048 I6(c) says "`credentials: true` appears nowhere in the
    // tree"; naming four files asserts it about four files and reads as though
    // it asserted it about the codebase — the same shape as a hand-kept route
    // list, which 019 T35(b) already refuses.
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      for (const { name, pattern } of CREDENTIALED_ORIGIN_PATTERNS) {
        expect(text, `${file} matched ${name}`).not.toMatch(pattern);
      }
    }
  });

  // The predicates are asserted to REFUSE, not just to be present. A grep-shaped
  // guard whose regex nobody tested is a guard that reads as coverage and is
  // one quote character away from silence — which is why each shape below is a
  // fixture rather than a comment claiming the regex handles it.
  const REFUSED_FIXTURES = [
    ["bare object key", "app.register(cors, { credentials: true });"],
    ["double-quoted key", 'app.register(cors, { "credentials": true });'],
    ["single-quoted key", "app.register(cors, { 'credentials': true });"],
    ["minifier truthy", "app.register(cors,{credentials:!0});"],
    ["assignment form", "opts.credentials = true;"],
    ["extra whitespace", "const o = {\n  credentials :   true,\n};"],
    ["the header, any case", 'reply.header("Access-Control-Allow-Credentials", "true");'],
    ["the header, concatenated", 'reply.header("Access-Control-" + "Allow-Credentials", "true");'],
    ["the header, templated", "reply.header(`Access-Control-${part}`, `true`);"],
    ["an import of a cors plugin", 'import cors from "@fastify/cors";'],
    ["a require of one", 'const cors = require("cors");'],
  ] as const;

  for (const [name, fixture] of REFUSED_FIXTURES) {
    it(`refuses the ${name} spelling`, () => {
      // At least one predicate must fire on every fixture. Asserting "some"
      // rather than a named one keeps the fixtures about the PROPERTY — no
      // credentialed cross-origin, in any spelling — instead of about which
      // regex happens to catch it today.
      const fired = CREDENTIALED_ORIGIN_PATTERNS.filter((p) => p.pattern.test(fixture));
      expect(
        fired.map((p) => p.name),
        fixture
      ).not.toEqual([]);
    });
  }

  it("does not fire on the credential vocabulary this codebase legitimately uses", () => {
    // A predicate that also refuses `shop_credentials`, `client_credentials` or
    // `resolveDeviceCredential` would be turned off within a week, and a guard
    // that gets turned off protects nothing. The tree walk above passing at all
    // is the real proof; these are the specific near-misses worth naming.
    const legitimate = [
      "SELECT kind, key_ref FROM shop_credentials WHERE shop_id = $1",
      "body: `grant_type=client_credentials&scope=${s}`",
      "const credential = await resolveDeviceCredential(tx, hash);",
      "// the device CREDENTIAL is the authentication (048 §7.3)",
    ];
    for (const line of legitimate) {
      for (const { name, pattern } of CREDENTIALED_ORIGIN_PATTERNS) {
        expect(pattern.test(line), `${name} false-positived on: ${line}`).toBe(false);
      }
    }
  });
});

/**
 * 048 I6(c)'s predicates, as data so they can be asserted to REFUSE.
 *
 * ⚠ `\/credentials\s*:\s*true\/` ALONE IS DEFEATABLE, and the shapes that defeat
 * it are ordinary rather than adversarial: a quoted key (`"credentials": true`),
 * an assignment instead of a property, a minifier's `!0`, or a header name built
 * by concatenation or a template. Each is a real thing a bundler or a tired
 * engineer produces, so each is a fixture above.
 *
 * `\/\bcors\b\/i` is the blunt one and is deliberately blunt: mechanism (3) is
 * the ABSENCE OF THE CAPABILITY, so the word appearing in a source file at all
 * is worth a failing build and a deliberate exemption, not a silent pass. It is
 * word-bounded so `shop_credentials`, `client_credentials` and every
 * `…Credential…` symbol in `src/services/auth/` stay clean — asserted, not hoped.
 */
const CREDENTIALED_ORIGIN_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: "credentials:true (any quoting, : or =, true or !0)",
    pattern: /["']?credentials["']?\s*[:=]\s*(true|!0)\b/i,
  },
  // Deliberately the WHOLE prefix and not the full header name. Matching
  // `access-control-allow-credentials` exactly is defeated by
  // `"Access-Control-" + "Allow-Credentials"` and by a template — both ordinary
  // outputs of a bundler or a wrapped line, neither adversarial. This server
  // sets no `Access-Control-*` header of any kind, so the prefix appearing in a
  // source file at all is worth a failing build: there is no legitimate use to
  // carve an exception around.
  { name: "any Access-Control header name, whole, split or templated", pattern: /access-control/i },
  { name: "the word cors", pattern: /\bcors\b/i },
];

/**
 * Every `.ts`/`.js` file under `src/`, `public/` and `scripts/` — the tree
 * I6(c) means. `scripts/` is in it because `pnpm migrate`, `register-shop` and
 * `contracts:emit` are code that ships in this repository and runs against this
 * database; leaving them out would make "the tree" mean "the parts of the tree
 * somebody remembered".
 */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) out.push(path);
    }
  };
  for (const root of ["src", "public", "scripts"]) if (existsSync(root)) walk(root);
  return out;
}

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

  // E03-D08 — THE BARE `/api/shops` ALIAS, WHICH ONLY BECAME TESTABLE HERE TODAY.
  //
  // Until this bead `GET /api/v1/shops` answered 200 to anybody, so "the alias
  // and its target refuse identically" had no refusal to compare on the one path
  // whose alias is registered separately (`app.all("/api/shops")`, not the `/*`
  // wildcard). Now that it is *my shops* behind a device session, the pair
  // refuses — and the assertion is that it refuses THE SAME.
  // No forged-cookie shape HERE, and the omission is the suite's design rather
  // than a gap: this file's pool cannot connect, so every assertion that passes
  // proves the refusal happened before Postgres. A forged cookie must be LOOKED
  // UP to be refused, so its identical-refusal case belongs in the integration
  // lane where a database exists (`session-tenant-isolation.test.ts`).
  const anonymousShapes = [
    { name: "anonymous", headers: {} as Record<string, string> },
    { name: "cross-site-shaped", headers: { "sec-fetch-site": "cross-site" } },
  ];

  for (const shape of anonymousShapes) {
    it(`refuses /api/shops and /api/v1/shops identically — ${shape.name}`, async () => {
      const direct = await app.inject({ method: "GET", url: `${API_PREFIX}/shops`, headers: shape.headers });
      expect(direct.statusCode).toBe(401);
      expect(direct.json().error.code).toBe("SESSION_REQUIRED");

      const viaAlias = await app.inject({ method: "GET", url: "/api/shops", headers: shape.headers });
      // The alias redirects WITHOUT authenticating and WITHOUT touching a shop —
      // 048 R12's `kind: "redirect"`. It answers 308 to the anonymous, the
      // cross-site-shaped and the forged-cookie request alike, so the redirect
      // itself discloses nothing about the session it was handed.
      expect(viaAlias.statusCode).toBe(308);
      expect(viaAlias.headers.location).toBe(`${API_PREFIX}/shops`);
      expect(viaAlias.headers.deprecation).toBe("true");

      const followed = await app.inject({
        method: "GET",
        url: viaAlias.headers.location as string,
        headers: shape.headers,
      });
      expect(followed.statusCode).toBe(direct.statusCode);
      // Same code, same envelope, no body difference — a redirect that answered
      // differently from its target would be an oracle sitting on the front door
      // with the word "deprecated" over it.
      //
      // `correlation_id` is excluded because it is per-request BY DESIGN (042
      // §4.1) and is the one field that MUST differ between two calls; comparing
      // it would assert the opposite of what the envelope is for.
      const strip = (r: LightMyRequestResponse): unknown => {
        const { correlation_id: _c, ...rest } = (r.json() as { error: Record<string, unknown> }).error;
        return rest;
      };
      expect(strip(followed)).toEqual(strip(direct));
      expect(Object.keys((followed.json() as { error: object }).error).sort()).toEqual(
        Object.keys((direct.json() as { error: object }).error).sort()
      );
    });
  }

  it("hands the alias no session-shaped answer of its own (048 R12)", () => {
    // The redirect rows must NOT carry the `none` principal, which would read as
    // "this endpoint serves unauthenticated callers". What they are is a
    // method-and-body-preserving redirect that reads nothing, writes nothing and
    // resolves no tenant — and the `kind` is where that is said.
    for (const path of ["/api/shops", "/api/shops/*"]) {
      const row = AUTH_ALLOWLIST_ACTIVE.find((r) => r.path === path);
      expect(row, path).toBeDefined();
      expect(row!.kind).toBe("redirect");
      expect(row!.method).toBe("ALL");
    }
    // And the target is an ordinary auth-allowlist ROUTE requiring a device
    // session — so the pair is "redirect, then authenticate", never "redirect
    // instead of authenticate".
    const target = AUTH_ALLOWLIST_ACTIVE.find((r) => r.path === `${API_PREFIX}/shops`);
    expect(target?.kind).toBe("route");
    expect(target?.principal).toBe("device");
  });
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
