// L2 contract: 042 §3.4 half two — the part that actually holds.
//
// A plugin boundary is a convention a determined author routes around, exactly
// as `const base` was. So this walks FASTIFY'S REGISTERED ROUTE TABLE — 019
// T35(b) is explicit that it must be "a CI walk of Fastify's registered route
// table (NOT a hand-kept list) that fails closed on any unclassified route" —
// and fails closed on anything that is neither under the tenant prefix nor on
// 042 §3.4's allowlist with a kind, a reason and (for a defect) a closing bead.
//
// It needs no database: `buildApp` registers its routes before it touches one.
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { buildApp } from "../../src/app.js";
import {
  AUTH_ALLOWLIST,
  AUTH_ALLOWLIST_ACTIVE,
  ROUTES,
  ROUTE_ALLOWLIST,
  STATIC_MOUNTS,
} from "../../src/contracts/v1/routes.js";
import { TENANT_PREFIX } from "../../src/contracts/v1/schemas.js";
import { TEST_PIN_PEPPER } from "../testConfig.js";

const UPLOADS_DIR = "tests/.tmp-routewalk-uploads";

/** A pool that is never queried: registration reaches no statement. */
const inertPool = new pg.Pool({ connectionString: "postgres://unused:unused@127.0.0.1:1/none" });

const app = await buildApp(inertPool, {
  port: 0,
  databaseUrl: "postgres://unused:unused@127.0.0.1:1/none",
  uploadsDir: UPLOADS_DIR,
  bands: { high: 0.85, medium: 0.5 },
  pinPepper: TEST_PIN_PEPPER,
  publicOrigins: [],
});

/**
 * The static mounts are NOT routes (042 §3.1) and are treated in §3.5.
 *
 * There is ONE now: E03-D05 deleted the `uploads/` mount, so a URL under the
 * uploads dir is no longer "a declared mount" here — it is unclassified, which
 * is what makes the assertion below bite if anyone re-registers it.
 */
function isStaticMount(url: string): boolean {
  return url === "/" || url === "/*";
}

describe("the registered route table (042 §3.4, 019 T35(b))", () => {
  const registered = app.registeredRoutes.filter((r) => r.method !== "HEAD" && r.method !== "OPTIONS");

  it("registers something to walk, and walks Fastify rather than a list", () => {
    expect(registered.length).toBeGreaterThan(8);
    expect(registered.some((r) => r.url === `${TENANT_PREFIX}/scan-sessions/:id/confirm`)).toBe(true);
  });

  it("fails closed: every route is tenant-scoped, allowlisted, or a declared mount", () => {
    const unclassified = registered.filter((route) => {
      if (route.url.startsWith(TENANT_PREFIX)) return false;
      if (isStaticMount(route.url)) return false;
      return !ROUTE_ALLOWLIST.some(
        (row) => row.path === route.url && (row.method === "ALL" || row.method === route.method)
      );
    });
    // The failure mode this closes is not carelessness — it is E4: nobody
    // DECIDED to publish the tenant list; a route was registered outside a
    // `const` and looked identical to a reviewer.
    expect(unclassified).toEqual([]);
  });

  it("finds every allowlist row actually registered, so the list cannot go stale", () => {
    for (const row of ROUTE_ALLOWLIST) {
      expect(
        registered.some((r) => r.url === row.path),
        `${row.method} ${row.path} is on the allowlist and is not registered`
      ).toBe(true);
    }
  });

  it("mounts the ONE static tree the record declares, and nothing under uploads", () => {
    // `@fastify/static` registers one wildcard per mount; the bare `/` is the
    // index it serves from the same wildcard.
    const mounts = registered.filter((r) => isStaticMount(r.url)).map((r) => r.url);
    expect(mounts).toEqual(["/*"]);
    expect(STATIC_MOUNTS).toHaveLength(1);
    // E03-D05 / 046 §6 Q5: the public uploads tree is GONE. Asserted on the
    // registered table rather than on the record, because the record is a
    // declaration and this is the thing that actually serves bytes.
    expect(registered.filter((r) => r.url.includes(UPLOADS_DIR))).toEqual([]);
  });

  it("walks the tenant-scoped photo route (E03-D05), which replaced that mount", () => {
    expect(
      registered.some(
        (r) => r.method === "GET" && r.url === `${TENANT_PREFIX}/scan-sessions/:id/photos/:photoId`
      )
    ).toBe(true);
  });

  it("puts every write inside the tenant prefix, or on the auth allowlist (042 §3.4, 048 §6.2)", () => {
    const writesOutside = registered.filter(
      (r) =>
        r.method === "POST" &&
        !r.url.startsWith(TENANT_PREFIX) &&
        !r.url.startsWith("/api/shops") &&
        !AUTH_ALLOWLIST_ACTIVE.some((row) => row.path === r.url)
    );
    // Two classes of POST sit outside the prefix and both are declared. The alias
    // handler is `app.all` and is a 308 onto a path that IS inside. The three
    // authentication writes are 048 §6.2's: they are how a caller ACQUIRES a
    // tenant, so a tenant-prefixed authentication route would need the answer
    // before it could ask the question — and each carries its own reason row in
    // BOTH allowlists, which is R12's "two lists, each fail-closed".
    expect(writesOutside).toEqual([]);
  });

  // 048 §6.2 (R12) — THE AUTH ALLOWLIST IS A SECOND LIST AND IS WALKED TOO.
  it("classifies every registered route TWICE: tenancy and principal", () => {
    const unclassified = registered.filter((route) => {
      if (isStaticMount(route.url)) return false;
      if (route.url.startsWith(TENANT_PREFIX)) return false; // covered by the hook's default
      return !AUTH_ALLOWLIST_ACTIVE.some(
        (row) => row.path === route.url && (row.method === "ALL" || row.method === route.method)
      );
    });
    // A route in neither list, or in only one, fails the build (I5). The DEFAULT
    // for anything the auth list does not name is `device+operator` — the
    // strongest requirement — so a route added next year is behind it by
    // omission rather than in front of it.
    expect(unclassified).toEqual([]);
  });

  it("keeps the two lists SEPARATE, and infers no row from the other (R12)", () => {
    // The same path can be an `exemption` on one list and require a session on
    // the other; `GET /api/v1/shops` is both a tenancy DEFECT and a `device`
    // principal, and `POST /api/v1/operator-sessions` is a tenancy exemption and
    // NOT anonymous. Collapsing the lists means one of the two answers is
    // inferred, and an inferred security answer is the shape E3 already took.
    const pin = AUTH_ALLOWLIST_ACTIVE.find((r) => r.path === "/api/v1/operator-sessions");
    expect(pin?.principal).toBe("device");
    const shops = AUTH_ALLOWLIST_ACTIVE.find((r) => r.path === "/api/v1/shops");
    expect(shops?.principal).toBe("device");
    expect(ROUTE_ALLOWLIST.find((r) => r.path === "/api/v1/shops")?.kind).toBe("defect");
    // The 308 aliases take their own kind and NOT the `none` principal's meaning.
    for (const alias of ["/api/shops", "/api/shops/*"]) {
      expect(AUTH_ALLOWLIST_ACTIVE.find((r) => r.path === alias)?.kind).toBe("redirect");
    }
  });

  it("keeps a pending auth row ABSENT from the route table until its bead lands", () => {
    // E03-D07's device-enrollment route is DECLARED and NOT REGISTERED. The
    // assertion runs in the direction that catches the stale case: if somebody
    // registers the route without flipping the flag, the row above stops being
    // walked and this fails.
    const pending = AUTH_ALLOWLIST.filter((r) => r.pending === true);
    expect(pending.length).toBeGreaterThan(0);
    for (const row of pending) {
      expect(
        registered.some((r) => r.url === row.path),
        `${row.path} is declared PENDING and is registered; drop the flag`
      ).toBe(false);
      expect(row.closingBead, `${row.path} is pending with no closing bead`).toBeTruthy();
    }
  });

  it("gives every route exactly one rate class, including the sessionless ones (R14)", () => {
    for (const route of ROUTES) {
      expect(["metered", "ordinary", "device", "none"]).toContain(route.rateClass);
    }
    // The four routes that have no session-resolved shop to key on are keyed on
    // the DEVICE, never on an IP (042 §8.1 unchanged) and never on the person —
    // which would let a stranger exhaust a named person's budget.
    const deviceClass = ROUTES.filter((r) => r.rateClass === "device").map((r) => r.path);
    expect(deviceClass.sort()).toEqual(
      [
        "/api/v1/device-sessions",
        "/api/v1/operator-sessions",
        "/api/v1/operator-sessions/end",
        "/api/v1/operators",
      ].sort()
    );
  });

  afterAll(async () => {
    await app.close();
    await inertPool.end();
  });
});
