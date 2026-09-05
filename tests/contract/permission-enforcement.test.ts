// L2 contract: **every route's declared permission is ENFORCED at a site this
// file names, and the site is proved reachable for that route.**
//
// Bead: longbox-e5b.3.3 (alias E03-B03). Docs: 054 §3; 042 §3.1, §3.4; 048 R12;
// 019 T24, T35(b); 046 G-2, G-11.
//
// ============================================================================
// IT IS THE RATE-CLASS SUITE'S EVIDENCE STANDARD, APPLIED BEFORE THE MISTAKE
// ============================================================================
//
// `rate-class-enforcement.test.ts` exists because three routes DECLARED a rate
// class and were bucketed by nothing, and because its own first version accepted
// "the string appears in the file" as proof and therefore missed the third. The
// lesson generalises: **a declaration whose enforcement nobody proved reachable
// is a declaration, not a control.**
//
// So this file does not merely check that every shop-scoped route names a
// permission. It checks that:
//
//   * the ONE enforcement call sits inside `registerAuthentication`, and INSIDE
//     the tenant branch — proved by comparing offsets, because a permission check
//     that ran outside that branch would be a check on routes that have no role
//     resolved and no check on the routes that do;
//   * `enforcePermission` really consults the matrix and really writes the audit
//     row — the two calls it exists to make;
//   * the fail-closed default is present as a literal, because a missing
//     `requires` that defaulted to *allow* would pass every other test here;
//   * nothing else in the tree takes its own permission decision.
//
// The end-to-end proof that a given role is refused a given route lives in
// `tests/integration/rbac-matrix.test.ts`, where a real server answers. What a
// static test can do — and what the rate-class findings needed — is make the LINK
// between a declaration and a reachable enforcement site something a build checks.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PERMISSION_NAMES,
  ROLE_NAMES,
  ROLE_RANK,
  type RoleName,
} from "../../src/contracts/v1/permissions.js";
import { AUTH_ALLOWLIST, ROUTES, ROUTE_ALLOWLIST } from "../../src/contracts/v1/routes.js";
import { TENANT_PREFIX } from "../../src/contracts/v1/schemas.js";
import type { MembershipRow } from "../../src/services/auth/memberships.js";
import { highestRole } from "../../src/services/auth/memberships.js";
import { ROLE_GRANTS, authorize } from "../../src/services/auth/permissions.js";

const repoRoot = join(import.meta.dirname, "..", "..");
const read = (p: string): string => readFileSync(join(repoRoot, p), "utf8");
const hook = read("src/services/auth/hook.ts");

/** The body of `fn`, by brace-matching — the same crude, deliberate helper the rate-class suite uses. */
function functionBody(source: string, fn: string): string | undefined {
  const decl = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\s*\\(`).exec(source);
  if (!decl) return undefined;
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
  for (let k = open; k < source.length; k += 1) {
    const ch = source[k];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, k + 1);
    }
  }
  return undefined;
}

describe("every shop-scoped route declares a permission (054 §3.2)", () => {
  it("gives every tenant-prefixed route a non-null `requires`", () => {
    for (const route of ROUTES) {
      if (!route.path.startsWith(TENANT_PREFIX)) continue;
      expect(
        route.requires,
        `${route.method} ${route.path} is shop-scoped and declares no permission. The hook REFUSES ` +
          `such a route (fail closed), so this is a broken route rather than an open one — but it ` +
          `is still a route somebody meant to work.`
      ).not.toBeNull();
      expect(PERMISSION_NAMES).toContain(route.requires!);
    }
  });

  it("gives every route with NO RESOLVED ROLE `requires: null`, and says why that is not a hole", () => {
    // These are the routes that ESTABLISH a tenant: the probe, the two credential
    // exchanges, the picker, *my shops*, the two redemptions, and the privileged
    // sign-in. No membership has been resolved when they run, so there is no role
    // for a permission to test. They are constrained by their PRINCIPAL instead —
    // the other of 048 R12's two lists — which this test cross-checks rather than
    // assumes.
    //
    // ⚠ **THE RULE IS "NO ROLE YET", NOT "OUTSIDE THE PREFIX", AND E03-D11 IS
    // WHY THE TWO STOPPED BEING THE SAME SET** (057 §4.4). This test used to key
    // on the tenant prefix, which was a correct proxy while every role was
    // resolved from a URL's `:shopId`. A PRIVILEGED session resolves its shop at
    // SIGN-IN, so `POST /api/v1/invitations` and `POST …/device-enrollment-codes`
    // sit outside the prefix WITH a resolved role — and the old rule would have
    // exempted the two most privileged acts in the system from the one
    // enforcement site 054 §3 built. The ground the field's own documentation
    // gave has not moved; the proxy has.
    for (const route of ROUTES) {
      if (route.path.startsWith(TENANT_PREFIX)) continue;
      const auth = AUTH_ALLOWLIST.find((r) => r.path === route.path);
      expect(auth, `${route.path} has no auth-allowlist row`).toBeDefined();
      if (auth!.principal === "privileged") {
        // A privileged route names a permission, or declares itself self-service
        // — the hook refuses anything else, which is the fail-closed default the
        // tenant branch has had since E03-B03.
        if (auth!.selfService === true) {
          expect(
            route.requires,
            `${route.path} declares itself self-service AND names a permission — pick one`
          ).toBeNull();
        } else {
          expect(
            route.requires,
            `${route.method} ${route.path} runs on a resolved role and names no permission, so the ` +
              `hook refuses it — declare one, or declare the row self-service`
          ).not.toBeNull();
          expect(PERMISSION_NAMES).toContain(route.requires!);
        }
        continue;
      }
      expect(
        route.requires,
        `${route.method} ${route.path} has no resolved role and declares a permission, ` +
          `which nothing evaluates`
      ).toBeNull();
    }
  });

  it("requires every permission the matrix names — a permission no route asks for is invented", () => {
    // 034 §6 alternative 2: a permission system is a SURFACE. This is the
    // mechanism that keeps the vocabulary closed — including the two permissions
    // whose routes are PENDING, which name themselves on the auth allowlist so
    // E03-D11 inherits the answer instead of choosing one.
    const required = new Set<string>();
    for (const route of ROUTES) if (route.requires) required.add(route.requires);
    for (const row of AUTH_ALLOWLIST) if (row.requires) required.add(row.requires);
    expect([...required].sort()).toEqual([...PERMISSION_NAMES].sort());
  });

  it("lets no auth-allowlist row under the tenant prefix loosen its principal (F5)", () => {
    // 048 E3's shape, refused before it can happen again. A route INSIDE the
    // tenant prefix has a tenant by construction, so an allowlist row granting
    // it `none` or `device` would be a shop-scoped route reachable without an
    // operator — which is how `GET /api/v1/shops` came to return every shop in
    // the database. The list is empty today; the assertion is what keeps a row
    // from being added to it in a hurry.
    for (const row of AUTH_ALLOWLIST) {
      if (!row.path.startsWith(TENANT_PREFIX)) continue;
      expect(
        row.principal,
        `${row.method} ${row.path} is tenant-prefixed and declares principal "${row.principal}"`
      ).toBe("device+operator");
    }
  });

  it("keeps the two E03-D11 rows REGISTERED, permissioned and behind a privileged session", () => {
    // ⚠ **THIS ASSERTION INVERTED WHEN E03-D11 LANDED, AND THE INVERSION IS THE
    // EVIDENCE.** Until then it asserted the two rows were PENDING and named
    // E03-D11 as their closing bead — the construction that stops a declared
    // route from quietly going stale. The bead has landed, so the same two paths
    // are now asserted from the other side: registered, still carrying the
    // permission E03-B03 decided for them, and behind the third session kind
    // rather than the `device+operator` they could only approximate before.
    //
    // The permission is the SAME STRING it was while pending. That is the whole
    // point of having declared it early (054 §3.4): E03-D11 inherited an answer
    // instead of choosing one, and this test is where a later edit that widens it
    // stops being invisible.
    const expected: ReadonlyArray<[string, string]> = [
      ["/api/v1/invitations", "membership.invite"],
      ["/api/v1/device-enrollment-codes", "device.enrollment.issue"],
    ];
    for (const [path, permission] of expected) {
      const row = AUTH_ALLOWLIST.find((r) => r.path === path && r.method === "POST");
      expect(row, `${path} has no auth-allowlist row`).toBeDefined();
      expect(row!.pending, `${path} is still pending, and E03-D11 was supposed to land it`).toBeUndefined();
      expect(row!.principal, `${path} is not behind a privileged session`).toBe("privileged");
      expect(row!.requires, `${path} lost the permission E03-B03 decided for it`).toBe(permission);
      const spec = ROUTES.find((r) => r.path === path && r.method === "POST");
      expect(spec, `${path} is declared on the auth allowlist and absent from the route table`).toBeDefined();
      expect(spec!.requires, `${path}'s route table row disagrees with its auth row`).toBe(permission);
    }
  });

  it("gives every pending row a closing bead", () => {
    // ⚠ **THE SECOND HALF IS NARROWER THAN IT LOOKS, AND THE NARROWING IS THE
    // POINT.** A pending row waits on a bead; that bead is where its permission
    // gets decided. For the two rows THIS bead's matrix covers — issuing an
    // invitation and issuing an enrollment code, both waiting on E03-D11's
    // privileged session — the permission is decided HERE and must be declared,
    // so E03-D11 inherits an answer rather than choosing one.
    //
    // For a row waiting on somebody else's bead it must NOT be: E03-B06's
    // `GET /api/v1/connectors/shopify/install` waits on **E10-B02** (the Shopify
    // app lifecycle), and inventing a `connector.install.*` permission here to
    // satisfy a blanket assertion would put a permission in the matrix that no
    // bead asked for — which is precisely the "permission system grows a UI"
    // hazard 034 §6 alternative 2 refused, arriving through a test instead of
    // through a feature.
    const pending = AUTH_ALLOWLIST.filter((r) => r.pending === true);
    expect(pending.length).toBeGreaterThan(0);
    for (const row of pending) {
      // The SHAPE, not merely non-empty: `closingBead: "TODO"` would satisfy a
      // truthiness check and satisfy nobody else. Every closing bead in this
      // tree names an alias (`E02-B10`, `E03-D11`, `E10-B02`), which is the
      // thing a reader can look up.
      expect(
        row.closingBead ?? "",
        `${row.path} is pending and names no bead alias in its closing bead`
      ).toMatch(/\bE\d{2}-[BD]\d{2}\b/);
      if (row.requires !== undefined) {
        // A pending row MAY name a permission — the two E03-D11 rows did, so
        // that bead inherited an answer — and when it does, the permission must
        // be one the matrix contains. A pending row declaring a permission the
        // matrix does not have would be a promise its closing bead could not
        // keep.
        expect(
          PERMISSION_NAMES,
          `${row.path} is pending and declares ${row.requires}, which the matrix does not contain`
        ).toContain(row.requires);
      }
    }
  });
});

describe("the declaration is ENFORCED, at a site this file names", () => {
  it("calls the permission check from inside `registerAuthentication`", () => {
    const body = functionBody(hook, "registerAuthentication");
    expect(body, "registerAuthentication is gone or renamed").toBeDefined();
    expect(body!).toContain(
      "await enforcePermission(req, deps, { url, spec, session: operator, memberships })"
    );
  });

  it("has exactly TWO callers of the check, and the second one is the privileged branch", () => {
    // ⚠ **054 §3's "one site" IS STILL ONE SITE, AND THIS IS WHERE THAT IS
    // PROVED RATHER THAN ASSERTED** (E03-D11, 057 §4.4). There is one DECISION
    // FUNCTION and it is reached from the two branches of one hook — the tenant
    // branch, for a session that resolved its shop from a URL, and the privileged
    // branch, for a session that resolved its shop at sign-in. A third caller
    // anywhere, or a handler taking its own decision, is the second policy 054
    // §3.5 forbids, and the count is exact rather than a ceiling for that reason.
    const callers = (hook.match(/await enforcePermission\(/g) ?? []).length;
    expect(callers, "enforcePermission is reached from more than the hook's two branches").toBe(2);
    // …and the privileged one is inside `enforcePrivileged`, not sprinkled.
    const privileged = functionBody(hook, "enforcePrivileged");
    expect(privileged, "enforcePrivileged is gone or renamed").toBeDefined();
    expect(privileged!).toContain("await enforcePermission(req, deps, { url: ctx.url, spec: ctx.spec,");
  });

  it("makes the privileged branch fail closed on a route that declares neither", () => {
    // The same default the tenant branch has had since E03-B03, one principal
    // over: a privileged route that names no permission is REFUSED unless its
    // auth row declares itself self-service. Without it, a privileged route added
    // next year would inherit "any privileged session at any shop".
    const body = functionBody(hook, "enforcePrivileged")!;
    expect(body).toMatch(/selfService !== true\) throw new LongboxError\("PERMISSION_DENIED"\)/);
    // Exactly one row may use the escape hatch today, and it is the sign-out.
    const selfService = AUTH_ALLOWLIST.filter((r) => r.selfService === true).map((r) => r.path);
    expect(selfService).toEqual(["/api/v1/privileged-sessions/end"]);
  });

  it("puts that call INSIDE the tenant branch, proved by offset and not by reading", () => {
    // A permission check outside `url.startsWith(TENANT_PREFIX)` would run for
    // routes with no resolved role (refusing all of them) and would not be inside
    // the branch that has one. The offsets are the only evidence that
    // distinguishes the two, and they are what the rate-class findings taught us
    // to check.
    const body = functionBody(hook, "registerAuthentication")!;
    const branch = body.indexOf("if (url.startsWith(TENANT_PREFIX))");
    const call = body.indexOf("await enforcePermission(");
    expect(branch, "the tenant branch is gone").toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(branch);
    // …and after the membership read, so the decision is taken on live grants.
    expect(call).toBeGreaterThan(body.indexOf("await membershipsAt("));
  });

  it("makes `enforcePermission` consult the matrix and write the decision", () => {
    const body = functionBody(hook, "enforcePermission");
    expect(body, "enforcePermission is gone or renamed").toBeDefined();
    expect(body!).toContain("authorize(ctx.memberships, permission,");
    // E03-B04: the write goes through a TENANT-SCOPED handle, because
    // `authorization_decision` carries a `shop_id` and therefore a policy — a
    // pool-level INSERT would be refused by the `WITH CHECK` with no context set.
    expect(body!).toContain("recordAuthorizationDecision(tenantDb(deps.pool, ctx.session.shop_id)");
    expect(body!).toContain("shouldRecord(verdict,");
  });

  it("keeps the FAIL-CLOSED default as a literal", () => {
    // The assertion that cannot be replaced by any behavioural one, because the
    // behaviour it guards has no route today: a shop-scoped route added later
    // with no `requires` must be REFUSED, not permitted.
    const body = functionBody(hook, "enforcePermission")!;
    expect(body).toContain("const permission = ctx.spec?.requires ?? null;");
    expect(body).toMatch(
      /if \(permission === null\) \{[\s\S]{0,400}?throw new LongboxError\("PERMISSION_DENIED"\)/
    );
  });

  it("answers a SCOPE refusal as an absent shop and a ROLE refusal as a 403", () => {
    // 019 T24 / 048 §6.5 in the one place the difference is decided.
    const body = functionBody(hook, "enforcePermission")!;
    expect(body).toContain('if (verdict.kind === "refused_scope") throw new LongboxError("SHOP_NOT_FOUND")');
    expect(body).toContain('throw new LongboxError("PERMISSION_DENIED")');
  });
});

describe("no second decision-maker (054 §3.5)", () => {
  const sources = walk(join(repoRoot, "src")).filter((p) => p.endsWith(".ts"));

  it("calls `authorize(` only from the identity module", () => {
    // Comments are stripped first: half a dozen files DISCUSS `authorize()` in
    // prose, and a checker that counted those would train the next author to
    // stop naming it in comments — the opposite of what this file wants.
    const callers = sources.filter((p) => /\bauthorize\(/.test(stripComments(readFileSync(p, "utf8"))));
    const relative = callers.map((p) => p.slice(repoRoot.length + 1)).sort();
    expect(relative).toEqual([
      "src/services/auth/enrollment.ts",
      "src/services/auth/hook.ts",
      "src/services/auth/invitations.ts",
      "src/services/auth/permissions.ts",
    ]);
  });

  it("lets no route hand-roll a role comparison", () => {
    // The shape that would quietly reintroduce a second policy: an `if
    // (req.auth.role === "owner")` in a handler, which is a permission decision
    // taken outside the matrix and invisible to every test in this file.
    for (const path of sources.filter((p) => p.includes("/src/routes/"))) {
      const text = readFileSync(path, "utf8");
      expect(text, `${path} compares a role directly`).not.toMatch(/role\s*[=!]==\s*["']/);
      expect(text, `${path} reads the grant table directly`).not.toMatch(/ROLE_GRANTS/);
    }
  });
});

describe("ONE rank table, derived and not duplicated (054 I13, the consistency lens's K3)", () => {
  // ==========================================================================
  // WHAT THIS REPLACES, AND WHY A TEST WAS NOT ENOUGH ON ITS OWN
  // ==========================================================================
  //
  // `memberships.ts` ranked roles to answer 034 §3.1's "the highest role held at
  // this scope" — what a request context says a person IS — and
  // `permissions.ts` ranked them again to choose which of several allowing
  // grants an `authorization_decision` row NAMES — what an audit row says they
  // ACTED AS. Two constants, identical values, and a comment in each explaining
  // why they were separate.
  //
  // The consistency lens refused the comment: *"I do not accept a comment as a
  // mechanism. Either derive one from the other, or assert their agreement in a
  // test, so the day they diverge is a build failure."* Both were offered;
  // DERIVATION is the stronger, so there is now one table in the contract layer
  // and both readers import it.
  //
  // **That makes an equality test vacuous — you cannot assert a table equals
  // itself and learn anything — so this block asserts the thing derivation can
  // still lose: that no SECOND table comes back.** A future author who wants a
  // different order for one of the two questions will write one, and the two
  // behavioural cases below are what notice.
  const sources = walk(join(repoRoot, "src")).filter((p) => p.endsWith(".ts"));

  it("declares the rank in exactly one file — the contract layer", () => {
    const declarers = sources
      .filter((p) => /\bROLE_RANK\s*(:|=)/.test(stripComments(readFileSync(p, "utf8"))))
      .map((p) => p.slice(repoRoot.length + 1))
      .sort();
    expect(declarers).toEqual(["src/contracts/v1/permissions.ts"]);
  });

  it("contains no second rank table under any other name", () => {
    // The shape, not the name: a `Record<…, number>` (or an object literal)
    // whose keys are the four roles is a rank table whatever it is called, and
    // `DECISION_RANK` — the one this bead deleted — is proof that the name is
    // the part an author changes.
    const shape = /\bowner\s*:\s*\d+\s*,[\s\S]{0,120}?\bmanager\s*:\s*\d+/;
    for (const path of sources) {
      const relative = path.slice(repoRoot.length + 1);
      if (relative === "src/contracts/v1/permissions.ts") continue;
      expect(
        stripComments(readFileSync(path, "utf8")),
        `${relative} declares a second role-rank table; there is one, in the contract layer (054 I13)`
      ).not.toMatch(shape);
    }
  });

  it("ranks every role, distinctly, with no fifth and none missing", () => {
    // A rank with a duplicate makes `outranks` order-dependent, so which grant
    // an audit row names would depend on the order Postgres returned the rows.
    expect(Object.keys(ROLE_RANK).sort()).toEqual([...ROLE_NAMES].sort());
    const values = Object.values(ROLE_RANK);
    expect(new Set(values).size, "two roles share a rank").toBe(values.length);
    // 034 §2.6 / 022 P7: break-glass ranks BELOW owner and manager, so it can
    // never become the super-admin by being the highest thing in the room.
    expect(ROLE_RANK.support_break_glass).toBeLessThan(ROLE_RANK.manager);
    expect(ROLE_RANK.support_break_glass).toBeLessThan(ROLE_RANK.owner);
  });

  it("makes the resolver and the decision agree on EVERY pair of roles", () => {
    // K3's sentence, as an assertion over behaviour rather than over constants:
    // for any two live grants that both allow the act, the role the request
    // context reports (`highestRole`) is the role the audit row records
    // (`authorize`). This is what would go red if a second table came back and
    // disagreed — and it reads the two functions the hook actually calls, not
    // the tables underneath them.
    const scoped = (id: string, role: RoleName): MembershipRow => ({
      id,
      role,
      scopeKind: "shop",
      locationId: null,
      effectiveUntil: role === "support_break_glass" ? new Date(Date.now() + 3_600_000) : null,
      reason: role === "support_break_glass" ? "pair test" : null,
    });
    const now = new Date();
    for (const a of ROLE_NAMES) {
      for (const b of ROLE_NAMES) {
        const held = [scoped("grant-a", a), scoped("grant-b", b)];
        const verdict = authorize(held, "scan.session.open", { atLocation: null, now });
        if (verdict.kind !== "allowed") continue; // neither grant carries it
        // The resolver's answer, restricted to the grants that could allow —
        // which is what the decision is choosing among.
        const allowing = held.filter((m) => ROLE_GRANTS[m.role].includes("scan.session.open"));
        expect(
          verdict.role,
          `authorize() acted as ${verdict.role} where highestRole() reports ${highestRole(allowing)} for (${a}, ${b})`
        ).toBe(highestRole(allowing));
      }
    }
  });
});

describe("the G2 exit condition, which had no mechanism (046 G-11, 042 §3.4 A8)", () => {
  it("holds ZERO defect-kind rows on the tenancy allowlist", () => {
    // 042 A8: "no defect-kind row may exist at G2", and until now nothing could
    // fail on it — the walk asserted that a defect NAMED its closing bead, which
    // is a different sentence. E03-D08 retired the last row; this is the
    // assertion that keeps it retired.
    const defects = ROUTE_ALLOWLIST.filter((r) => r.kind === "defect");
    expect(
      defects.map((d) => `${d.method} ${d.path}`),
      "a defect-kind row is present and G2 cannot pass with one"
    ).toEqual([]);
  });
});

/** `//` and block comments removed, so a mention in prose is not a call. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
