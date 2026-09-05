// L2 contract: **every route's declared rate class is ENFORCED at a site this
// file names, and the site is proved REACHABLE for that route.**
//
// ============================================================================
// WHY THIS FILE EXISTS, IN THREE FINDINGS OF ONE SHAPE
// ============================================================================
//
// **(1)** `POST /api/v1/device-sessions` declared `rateClass: "device"` through
// the whole of E03-D09's first pass and was bucketed by nothing: the block that
// took the device bucket sat after the anonymous short-circuit and keyed on a
// session that route does not have. Four hundred anonymous POSTs produced four
// hundred refusals, zero throttles and four hundred `auth_attempt` rows.
// `route-table-scoping.test.ts` asserted the DECLARATION and passed throughout.
//
// **(2)** `POST /api/v1/device-enrollments` (E03-D07) is anonymous and declares
// `ordinary`, and the hook's sessionless bucket was keyed on
// `rateClass === "device"` — the same defect one route later. This file's first
// version caught it.
//
// **(3)** `POST /api/v1/invitations/redemptions` (E03-D07) declared `ordinary`
// and enforced NOTHING — and **this file's first version did not catch it**,
// because it only checked that the named call was a SUBSTRING of the named file.
// Both of that route's rows pointed at real calls in real files that could never
// run for it: the hook's bucket is gated on `rateClass === "device"`, and
// `app.ts`'s `takeOrdinary` hook lives INSIDE the tenant plugin while the route
// is registered on the root instance. Two hundred posts, two hundred refusals,
// zero limiter calls. Found by the invariant review of `b855255`.
//
// **So a substring is not evidence, and this file no longer accepts one.** Each
// row now names the FUNCTION the call must sit inside, and the suite:
//
//   * extracts that function's body by brace-matching and requires the call to
//     be inside it — not merely somewhere in the file;
//   * requires a `guard` for a call that sits behind a condition, and checks the
//     guard is SATISFIABLE for this route (a `rateClass === "device"` guard on a
//     route declaring `ordinary` is finding (3), mechanically);
//   * refuses a row naming `src/app.ts`'s tenant-plugin bucket for a route whose
//     `pluginPath` is null — that hook cannot see a root-instance route, which is
//     the other half of finding (3);
//   * requires a service-module site to be reachable from the HTTP edge, by
//     asserting the handler file actually calls the named function.
//
// The end-to-end proof that a burst answers `429` lives in the integration lane
// (`invitation.test.ts`), because only a real server can show that. What a
// static test can do — and what all three findings needed — is make the LINK
// between a declaration and a reachable enforcement site something a build
// checks.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTES, authRowFor, type RouteSpec } from "../../src/contracts/v1/routes.js";
import { TENANT_PREFIX } from "../../src/contracts/v1/schemas.js";

interface EnforcementRow {
  readonly method: string;
  readonly path: string;
  /** The file the enforcement lives in. */
  readonly file: string;
  /** The function the call must sit INSIDE. Checked by brace-matching, never by substring. */
  readonly fn: string;
  /** The literal call. */
  readonly call: string;
  /**
   * The condition the call sits behind, when it sits behind one. The suite
   * checks the guard exists AND that it can be true for this route.
   */
  readonly guard?: string;
  /**
   * For a site in a service module: the file whose handler reaches `fn`. The
   * suite asserts that file actually calls it, so a service function nothing
   * routes to cannot be cited as a control.
   */
  readonly reachedFrom?: string;
  readonly why: string;
}

const ENFORCEMENT: readonly EnforcementRow[] = [
  {
    method: "POST",
    path: "/api/v1/device-sessions",
    file: "src/services/auth/hook.ts",
    fn: "registerAuthentication",
    call: "deps.limiter.takeRoute(url)",
    guard: 'required === "none" && spec !== undefined && spec.rateClass !== "none"',
    why:
      "anonymous and sessionless, so there is no shop and no device to key on at `onRequest`. The " +
      "hook's per-ROUTE bucket bounds the aggregate; `openDeviceSession` takes a second bucket " +
      "keyed on the presented credential's digest, which is the question this one cannot answer.",
  },
  {
    method: "POST",
    path: "/api/v1/device-sessions",
    file: "src/services/auth/api.ts",
    fn: "openDeviceSession",
    call: "deps.limiter.takeDevice(`credential:${digest}`)",
    reachedFrom: "src/routes/auth.ts",
    why:
      "048 R14's second half, and the question the hook's route bucket cannot answer: how many " +
      "times this EXACT secret has been tried. Taken in the service because the credential arrives " +
      "in the BODY and `onRequest` runs before any body parsing.",
  },
  {
    method: "GET",
    path: "/api/v1/shops",
    file: "src/services/auth/hook.ts",
    fn: "registerAuthentication",
    call: "deps.limiter.takeDevice(outcome.device.device_id)",
    guard: 'spec?.rateClass === "device"',
    why:
      "*MY SHOPS* (048 §6.4, E03-D08). It requires a `device` principal and sits outside the " +
      "tenant prefix, so the hook's device bucket is what covers it. This row exists because the " +
      "suite FAILED when E03-D08 merged — that bead gave the route a class and named no site.",
  },
  {
    method: "GET",
    path: "/api/v1/operators",
    file: "src/services/auth/hook.ts",
    fn: "registerAuthentication",
    call: "deps.limiter.takeDevice(outcome.device.device_id)",
    guard: 'spec?.rateClass === "device"',
    why:
      "the operator picker's roster. It requires a live device session, so the hook keys the bucket " +
      "on the device that session names — never on the person, whose display name is what the " +
      "route is about (019 T35).",
  },
  {
    method: "POST",
    path: "/api/v1/operator-sessions",
    file: "src/services/auth/hook.ts",
    fn: "registerAuthentication",
    call: "deps.limiter.takeDevice(outcome.device.device_id)",
    guard: 'spec?.rateClass === "device"',
    why:
      "048 R14: the device is authenticated and the PERSON is what is being tested, so keying on " +
      "`app_user_id` would let a stranger exhaust a named person's budget.",
  },
  {
    method: "POST",
    path: "/api/v1/operator-sessions/end",
    file: "src/services/auth/hook.ts",
    fn: "registerAuthentication",
    call: "deps.limiter.takeDevice(outcome.device.device_id)",
    guard: 'spec?.rateClass === "device"',
    why:
      "switching operator mid-shift, on the same phone: the device is authenticated and the " +
      "operator chain is what is being ended, so the bucket keys on the device exactly as the PIN " +
      "route's does.",
  },
  {
    method: "POST",
    path: "/api/v1/invitations/redemptions",
    file: "src/services/auth/api.ts",
    fn: "redeemInvitation",
    call: "deps.limiter.takeOrdinary(device.shop_id)",
    reachedFrom: "src/routes/auth.ts",
    why:
      "E03-D07, AND THIS IS THE ROW FINDING (3) IS ABOUT. 048 R14 keys invitation acceptance on " +
      "the shop the token names, and R15 makes that the device session's shop on every path that " +
      "can succeed. It is taken in the SERVICE and BEFORE `verifyInvitation`, because a throttled " +
      "request must test no credential and append no `auth_attempt` row. The two rows this " +
      "replaces named the hook's device bucket (gated on a class this route does not declare) and " +
      "`app.ts`'s tenant-plugin bucket (which never sees a root-instance route) — both real calls " +
      "in real files, neither reachable, and a substring check could not tell.",
  },
  {
    method: "POST",
    path: "/api/v1/device-enrollments",
    file: "src/services/auth/hook.ts",
    fn: "registerAuthentication",
    call: "deps.limiter.takeRoute(url)",
    guard: 'required === "none" && spec !== undefined && spec.rateClass !== "none"',
    why:
      "E03-D07. Anonymous, so the hook can key on nothing but the route itself. The condition that " +
      "reaches this call was widened from `rateClass === 'device'` to any declared class BY THIS " +
      "BEAD — finding (2).",
  },
  {
    method: "POST",
    path: "/api/v1/device-enrollments",
    file: "src/services/auth/api.ts",
    fn: "redeemEnrollmentCode",
    call: "deps.limiter.takeOrdinary(verdict.code.shop_id)",
    reachedFrom: "src/routes/auth.ts",
    why:
      "E03-D07. 048 R14 keys device enrollment on the shop the CODE names — unknown until the code " +
      "is looked up, and the code is in the body, so this bucket cannot be taken in the hook. Two " +
      "buckets, two questions.",
  },
  // -------------------------------------------------------------------------
  // E03-B06's two connector routes. Each takes TWO buckets for the same reason
  // the two E03-D07 routes do — the shop is not knowable at `onRequest` — and
  // the second one is taken AFTER the signature verifies, which is the ordering
  // worth stating: an UNSIGNED flood is refused more cheaply than a signed one,
  // because it never reaches a shop lookup at all.
  // -------------------------------------------------------------------------
  {
    method: "GET",
    path: "/api/v1/connectors/shopify/callback",
    file: "src/services/auth/hook.ts",
    fn: "registerAuthentication",
    call: "deps.limiter.takeRoute(url)",
    guard: 'required === "none" && spec !== undefined && spec.rateClass !== "none"',
    why:
      "the OAuth callback is anonymous by construction — a merchant's browser at the end of " +
      "Shopify's redirect holds no Longbox session — so the hook can key on nothing but the route " +
      "itself. The shop is unknown until the single-use install state is resolved, and 042 §8.1 " +
      "forbids keying on an IP.",
  },
  {
    method: "GET",
    path: "/api/v1/connectors/shopify/callback",
    file: "src/services/connectors/shopify/api.ts",
    fn: "completeInstall",
    call: "deps.limiter.takeOrdinary(row.shop_id)",
    reachedFrom: "src/routes/connectors.ts",
    why:
      "048 R14's second half: the bucket keyed on the shop the STATE names. It is taken in the " +
      "service because the state is in the query and the hook cannot resolve it, and AFTER the " +
      "HMAC check so a forged callback is refused without a database round trip — the same " +
      "ordering `receiveWebhook` uses one route over.",
  },
  {
    method: "POST",
    path: "/api/v1/connectors/shopify/webhooks",
    file: "src/services/auth/hook.ts",
    fn: "registerAuthentication",
    call: "deps.limiter.takeRoute(url)",
    guard: 'required === "none" && spec !== undefined && spec.rateClass !== "none"',
    why:
      "Shopify's servers post here with no session and no cookie, so the hook's per-route bucket " +
      "is what bounds the aggregate. The second bucket cannot be taken here: the store is in a " +
      "header this hook could read, but trusting it before the HMAC verifies would let an " +
      "unauthenticated caller choose which shop's budget to exhaust.",
  },
  {
    method: "POST",
    path: "/api/v1/connectors/shopify/webhooks",
    file: "src/services/connectors/shopify/api.ts",
    fn: "receiveWebhook",
    call: "deps.limiter.takeOrdinary(shopId)",
    reachedFrom: "src/routes/connectors.ts",
    why:
      "the bucket keyed on the shop the SIGNED domain resolves to, taken only after the HMAC has " +
      "verified — so the key is a fact Shopify authenticated rather than a header a caller chose. " +
      "This is the row that made the ordering explicit: an unsigned flood costs one HMAC and " +
      "reaches no shop's counter at all.",
  },
];

const read = (path: string): string => readFileSync(path, "utf8");

/**
 * The body of `fn` in `source`, by brace-matching from its declaration.
 *
 * Deliberately crude and deliberately NOT a search over the whole file: the
 * whole point of finding (3) is that "the string appears in the file" is not
 * evidence that the string runs for this route. Returns `undefined` when the
 * function is not found, which the caller turns into a failure naming the row.
 */
function functionBody(source: string, fn: string): string | undefined {
  const decl = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\s*\\(`).exec(source);
  if (!decl) return undefined;

  // Walk the PARAMETER LIST to its closing paren first. Taking "the next `{`"
  // instead lands inside a destructured or inline-typed parameter — which is how
  // the first version of this helper read `redeemInvitation`'s
  // `{ code; pin; idempotencyKey }` as the function body and reported a call it
  // could not see. A checker with a blind spot is the thing this file exists to
  // stop shipping.
  let paren = 0;
  let i = source.indexOf("(", decl.index);
  for (; i < source.length; i += 1) {
    if (source[i] === "(") paren += 1;
    else if (source[i] === ")") {
      paren -= 1;
      if (paren === 0) break;
    }
  }
  if (paren !== 0) return undefined;

  // Then skip the return-type annotation, which may carry its own angle
  // brackets (`Promise<AuthResult>`), and take the first brace outside them.
  let angle = 0;
  let open = -1;
  for (let j = i + 1; j < source.length; j += 1) {
    const c = source[j];
    if (c === "<") angle += 1;
    else if (c === ">") angle -= 1;
    else if (c === "{" && angle === 0) {
      open = j;
      break;
    }
  }
  if (open === -1) return undefined;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return undefined;
}

const routeSpec = (row: EnforcementRow): RouteSpec | undefined =>
  ROUTES.find((r) => r.method === row.method && r.path === row.path);

describe("a declared rate class is an ENFORCED rate class (048 R14, 042 §8.1)", () => {
  it("accounts for every rate-classed route, and for no route that has none", () => {
    const classed = ROUTES.filter((r) => r.rateClass !== "none").map((r) => `${r.method} ${r.path}`);
    const covered = new Set<string>();

    for (const route of ROUTES) {
      const key = `${route.method} ${route.path}`;
      if (route.rateClass === "none") {
        // A route with no class must have no enforcement row either — a bucket
        // taken on a route that declares none is a control nobody can find.
        expect(ENFORCEMENT.some((e) => `${e.method} ${e.path}` === key)).toBe(false);
        continue;
      }
      // The tenant plugin's `onRequest` covers everything inside the prefix, and
      // it is the ONE enforcement site a row does not have to name because the
      // prefix itself is the declaration (042 §3.4 half one). `pluginPath` is
      // asserted non-null here for the same reason the refusal below exists: it
      // is how the route table records "this really is inside the plugin".
      if (route.path.startsWith(TENANT_PREFIX)) {
        expect(route.rateClass === "ordinary" || route.rateClass === "metered").toBe(true);
        expect(route.pluginPath, `${key} is tenant-prefixed but declares no pluginPath`).not.toBeNull();
        covered.add(key);
        continue;
      }
      const rows = ENFORCEMENT.filter((e) => `${e.method} ${e.path}` === key);
      expect(
        rows.length,
        `${key} declares rateClass "${route.rateClass}" and names no enforcement site`
      ).toBeGreaterThan(0);
      covered.add(key);
    }

    expect([...covered].sort()).toEqual([...classed].sort());
  });

  it("finds every named call INSIDE the function the row names, not merely in the file", () => {
    for (const row of ENFORCEMENT) {
      const label = `${row.method} ${row.path} -> ${row.file}:${row.fn}`;
      const body = functionBody(read(row.file), row.fn);
      expect(body, `${label}: no function \`${row.fn}\` found`).toBeDefined();
      expect(body!, `${label}: \`${row.fn}\` no longer contains ${row.call}`).toContain(row.call);
    }
  });

  it("makes the reachability fields MANDATORY, so a row cannot dodge the check by omitting one", () => {
    // Without this, finding (3) survives its own fix: the guard check below only
    // runs for a row that DECLARES a guard, so a row citing the hook's device
    // bucket with no `guard` field would sail through exactly as the original
    // ones did. Every bucket in the hook is conditional, so a hook row owes a
    // guard; every service-module site is only a control if something routes to
    // it, so it owes a `reachedFrom`.
    for (const row of ENFORCEMENT) {
      const label = `${row.method} ${row.path} -> ${row.file}:${row.fn}`;
      if (row.file === "src/services/auth/hook.ts") {
        expect(
          row.guard,
          `${label}: every limiter call in the hook sits behind a condition, so this row must ` +
            `declare the guard it runs behind — otherwise nothing checks it can run at all`
        ).toBeDefined();
      }
      if (row.file.startsWith("src/services/") && row.file !== "src/services/auth/hook.ts") {
        expect(
          row.reachedFrom,
          `${label}: a service-module site must name the file whose handler reaches it`
        ).toBeDefined();
      }
      // A row must always say enough to be checkable at all.
      expect(row.fn.length, `${label}: no function named`).toBeGreaterThan(0);
      expect(row.why.length, `${label}: no reason`).toBeGreaterThan(40);
    }
  });

  it("REFUSES a row whose guard cannot be true for the route it claims to cover", () => {
    // This is finding (3), mechanically. A row may name a real call in a real
    // function and still be inert, because the call sits behind a condition the
    // route can never satisfy.
    for (const row of ENFORCEMENT) {
      if (row.guard === undefined) continue;
      const label = `${row.method} ${row.path} -> ${row.file}:${row.fn}`;
      const body = functionBody(read(row.file), row.fn)!;
      expect(body, `${label}: the guard \`${row.guard}\` is no longer in ${row.fn}`).toContain(row.guard);

      const spec = routeSpec(row);
      expect(spec, `${label}: not a declared route`).toBeDefined();

      // A guard on the DEVICE class only runs for a route that declares it.
      if (row.guard.includes('rateClass === "device"')) {
        expect(
          spec!.rateClass,
          `${label}: the guard requires the device class, the route declares "${spec!.rateClass}"`
        ).toBe("device");
      }
      // A guard on the sessionless branch only runs for an anonymous route.
      if (row.guard.includes('required === "none"')) {
        expect(
          authRowFor(row.method, row.path)?.principal,
          `${label}: the guard requires an anonymous route, but the AUTH allowlist demands a principal`
        ).toBe("none");
        expect(spec!.rateClass).not.toBe("none");
      }
    }
  });

  it("REFUSES a row naming the tenant-plugin bucket for a route outside the tenant plugin", () => {
    // The other half of finding (3). `app.ts` registers its `takeOrdinary` hook
    // INSIDE the prefixed plugin, so it cannot see a route on the root instance —
    // and `pluginPath === null` is exactly how the route table says "root
    // instance". A row citing it for such a route cites a hook that never runs.
    for (const row of ENFORCEMENT) {
      if (row.file !== "src/app.ts") continue;
      const spec = routeSpec(row);
      expect(
        spec?.pluginPath,
        `${row.method} ${row.path} names src/app.ts's tenant-plugin bucket, but the route is ` +
          `registered on the root instance (pluginPath null) where that hook never runs`
      ).not.toBeNull();
    }
  });

  it("proves a service-module site is reachable from the HTTP edge", () => {
    // A limiter call inside a function nothing routes to is not a control. The
    // check is deliberately shallow — the handler file must call the function —
    // because anything deeper is what the integration lane's real burst proves.
    for (const row of ENFORCEMENT) {
      if (row.reachedFrom === undefined) continue;
      expect(
        read(row.reachedFrom),
        `${row.method} ${row.path}: ${row.reachedFrom} does not call ${row.fn}`
      ).toContain(`${row.fn}(`);
    }
  });

  it("names no enforcement site for a route that is not in the route table", () => {
    const known = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    for (const row of ENFORCEMENT) {
      expect(known.has(`${row.method} ${row.path}`), `${row.path} is not a declared route`).toBe(true);
    }
  });

  it("keeps the hook's sessionless bucket keyed on ANY declared class, not just `device`", () => {
    // The exact shape of the widened condition. Asserted literally because the
    // narrow version passed every other test in this repository while leaving one
    // anonymous, mutating, append-only-writing route unmetered.
    expect(read("src/services/auth/hook.ts")).toContain(
      'if (required === "none" && spec !== undefined && spec.rateClass !== "none")'
    );
  });

  it("every sessionless rate-classed route is on the AUTH allowlist as `none`", () => {
    // The two lists have to agree for the hook's sessionless branch to be the one
    // that runs. A route that declared a class, sat outside the tenant prefix and
    // required a principal the allowlist did not grant would be bucketed by the
    // OTHER branch, which is the kind of near-miss this file exists to catch.
    for (const row of ENFORCEMENT) {
      if (row.call !== "deps.limiter.takeRoute(url)") continue;
      expect(authRowFor(row.method, row.path)?.principal).toBe("none");
    }
  });
});
