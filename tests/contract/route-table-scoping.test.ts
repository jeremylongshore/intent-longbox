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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
    // the other, and the pair below is the cleanest demonstration:
    // `POST /api/v1/operator-sessions` is a tenancy exemption and is NOT
    // anonymous, while `GET /healthz` is a tenancy exemption and IS. Collapsing
    // the lists means one of the two answers is inferred, and an inferred
    // security answer is the shape E3 already took.
    const pin = AUTH_ALLOWLIST_ACTIVE.find((r) => r.path === "/api/v1/operator-sessions");
    expect(pin?.principal).toBe("device");
    expect(ROUTE_ALLOWLIST.find((r) => r.path === "/api/v1/operator-sessions")?.kind).toBe("exemption");
    const health = AUTH_ALLOWLIST_ACTIVE.find((r) => r.path === "/healthz");
    expect(health?.principal).toBe("none");
    expect(ROUTE_ALLOWLIST.find((r) => r.path === "/healthz")?.kind).toBe("exemption");
    // ⚠ THIS TEST USED TO PIN `GET /api/v1/shops` AS `kind: "defect"` — the
    // demonstration that a path can be a tenancy defect and still carry a
    // principal. E03-D08 fixed the route, so the example moved rather than the
    // rule: it is now an `exemption` that still requires a `device` session, and
    // an exemption-plus-a-session is the same "two lists, two answers" point
    // made without a live exposure standing in for it.
    const shops = AUTH_ALLOWLIST_ACTIVE.find((r) => r.path === "/api/v1/shops");
    expect(shops?.principal).toBe("device");
    expect(ROUTE_ALLOWLIST.find((r) => r.path === "/api/v1/shops")?.kind).toBe("exemption");
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
    // The SIX routes that have no session-resolved shop to key on are keyed on
    // the DEVICE, never on an IP (042 §8.1 unchanged) and never on the person —
    // which would let a stranger exhaust a named person's budget.
    //
    // The sixth is `POST /api/v1/privileged-sessions` (E03-D11), and it is here
    // for the FIRST reason rather than the fifth's: a person signing in with a
    // password holds no session at all, so there is no shop the ordinary bucket
    // could key on. Its sibling `POST …/privileged-sessions/end` is NOT here and
    // must not be — that one runs on a resolved privileged session, which names
    // a shop, so `ordinary` is available and is what 042 §8.1 asks for.
    //
    // The fifth is `GET /api/v1/shops` (E03-D08). It carried `none` while it was
    // a declared defect, which made the one route that leaked the `shop` table
    // also the one unmetered read in the system; as *my shops* it is an
    // authenticated read outside the tenant plugin, so the ordinary bucket —
    // which lives INSIDE that plugin — never sees it and the device class is the
    // only correct one.
    //
    // The SIXTH is `POST /api/v1/credentials` (E03-D24). It runs on a
    // device+operator session outside the tenant plugin, which is exactly the
    // shape the PIN route and the operator switch have — the plugin's ordinary
    // hook never sees it, so the hook's device bucket is the only class it can
    // be given. A SECOND bucket, keyed on the session CHAIN, is taken in the
    // service (063 §3.6); the route table names the class the hook enforces,
    // which is what this list is about.
    const deviceClass = ROUTES.filter((r) => r.rateClass === "device").map((r) => r.path);
    expect(deviceClass.sort()).toEqual(
      [
        "/api/v1/credentials",
        "/api/v1/device-sessions",
        "/api/v1/operator-sessions",
        "/api/v1/operator-sessions/end",
        "/api/v1/operators",
        "/api/v1/privileged-sessions",
        "/api/v1/shops",
      ].sort()
    );
    // And NOTHING outside the tenant prefix is unmetered except the probe (042
    // §3.1 R0), asserted positively so a new sessionless route cannot join by
    // omission.
    const unmetered = ROUTES.filter((r) => r.rateClass === "none").map((r) => r.path);
    expect(unmetered).toEqual(["/healthz"]);
  });

  // -------------------------------------------------------------------------
  // E03-B05 (050 §9 I8, second half): NO WIRE SURFACE DECLARES A CREDENTIAL OR A
  // SPEND FACT — and no route accepts an OPERATOR IDENTIFIER as a filter, a sort
  // or a grouping parameter on one.
  //
  // Asserted over the GENERATED document rather than over the Zod modules, on
  // 042 §2.5's reasoning: `contracts/openapi.v1.json` is what a client compiles
  // against, and a field that reaches it has reached the wire whatever the
  // source module intended. The document is emitted from the contract, and a
  // separate contract test already fails when the committed file and the
  // emitter disagree — so scanning the committed bytes is scanning the truth.
  //
  // **Why the negative is worth a test at all.** 019 T35 is NON-WAIVABLE and
  // 022 P3 forbids the SURFACE rather than the signal: `cost_log` gains a
  // credential dimension (050 §6) and must never gain an operator one, because a
  // per-operator cost figure is per-operator telemetry with a dollar sign on it
  // (050 §6.6). The way that arrives is not a schema somebody writes on purpose
  // — it is a reporting parameter added later to a route nobody thought of as a
  // reporting route.
  // -------------------------------------------------------------------------
  describe("I8 — the wire declares no credential and no spend fact", () => {
    const doc = readFileSync(join(repoRoot, "contracts", "openapi.v1.json"), "utf8");

    it("declares no key_ref, credential value, credential_version_id or spend_owner", () => {
      for (const forbidden of [
        "key_ref",
        "keyRef",
        "credential_version_id",
        "credentialVersionId",
        "spend_owner",
        "spendOwner",
        "api_key",
        "apiKey",
      ]) {
        expect(doc, `${forbidden} reached contracts/openapi.v1.json`).not.toContain(forbidden);
      }
    });

    it("declares no dollar figure anywhere on the wire (022 P8, extending 042 I7)", () => {
      for (const forbidden of ["estimated_usd", "estimatedUsd", "costUsd", "cost_usd"]) {
        expect(doc, `${forbidden} reached contracts/openapi.v1.json`).not.toContain(forbidden);
      }
    });

    it("accepts no operator identifier as a parameter on any route (019 T35)", () => {
      // Every declared parameter name in the document, whatever its `in`.
      const parameterNames = [...doc.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]!);
      for (const name of parameterNames) {
        expect(name, `parameter '${name}'`).not.toMatch(
          /operator|app_user|appUser|employee|person_id|personId|device_id|deviceId/i
        );
        // …and no filter/sort/group-by parameter at all, which is the SHAPE a
        // per-operator report would arrive in even under an innocent name.
        expect(name, `parameter '${name}'`).not.toMatch(/^(group_by|groupBy|sort|sort_by|filter)$/i);
      }
      // The walk really had something to walk.
      expect(parameterNames).toContain("shopId");
    });
  });

  afterAll(async () => {
    await app.close();
    await inertPool.end();
  });
});
