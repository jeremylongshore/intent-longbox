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
import { ROUTE_ALLOWLIST, STATIC_MOUNTS } from "../../src/contracts/v1/routes.js";
import { TENANT_PREFIX } from "../../src/contracts/v1/schemas.js";

const UPLOADS_DIR = "tests/.tmp-routewalk-uploads";

/** A pool that is never queried: registration reaches no statement. */
const inertPool = new pg.Pool({ connectionString: "postgres://unused:unused@127.0.0.1:1/none" });

const app = await buildApp(inertPool, {
  port: 0,
  databaseUrl: "postgres://unused:unused@127.0.0.1:1/none",
  uploadsDir: UPLOADS_DIR,
  bands: { high: 0.85, medium: 0.5 },
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

  it("puts every write inside the tenant prefix (042 §3.4 half one)", () => {
    const writesOutside = registered.filter(
      (r) => r.method === "POST" && !r.url.startsWith(TENANT_PREFIX) && !r.url.startsWith("/api/shops")
    );
    // The alias handler is registered with `app.all` and is the only POST
    // outside; it is a 308 onto a path that IS inside.
    expect(writesOutside).toEqual([]);
  });

  afterAll(async () => {
    await app.close();
    await inertPool.end();
  });
});
