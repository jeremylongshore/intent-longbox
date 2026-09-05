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

  it("gives every route OUTSIDE the tenant prefix `requires: null`, and says why that is not a hole", () => {
    // These are the routes that ESTABLISH a tenant: the probe, the two credential
    // exchanges, the picker, *my shops*, the two redemptions. No membership has
    // been resolved when they run, so there is no role for a permission to test.
    // They are constrained by their PRINCIPAL instead — the other of 048 R12's
    // two lists — which this test cross-checks rather than assumes.
    for (const route of ROUTES) {
      if (route.path.startsWith(TENANT_PREFIX)) continue;
      expect(
        route.requires,
        `${route.method} ${route.path} sits outside the tenant prefix and declares a permission, ` +
          `which nothing evaluates — the hook resolves a role only under the prefix`
      ).toBeNull();
      const auth = AUTH_ALLOWLIST.find((r) => r.path === route.path);
      expect(auth, `${route.path} has no auth-allowlist row`).toBeDefined();
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

  it("gives every pending row a closing bead, and every E03-D11 row a permission too", () => {
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
      if (row.closingBead!.includes("E03-D11")) {
        // The named permission, not merely "some permission": a pending row that
        // declared a permission the matrix does not contain would be a promise
        // E03-D11 could not keep.
        expect(
          PERMISSION_NAMES,
          `${row.path} waits on E03-D11, whose permissions this bead's matrix owns, and declares ` +
            `${row.requires ?? "none"}`
        ).toContain(row.requires!);
      }
    }
    // …and the two rows that DO owe one still owe it, named, so the narrowing
    // above cannot quietly empty the assertion.
    const owed = pending.filter((r) => r.closingBead!.includes("E03-D11")).map((r) => r.path);
    expect(owed.sort()).toEqual(["/api/v1/device-enrollment-codes", "/api/v1/invitations"]);
  });
});

describe("the declaration is ENFORCED, at a site this file names", () => {
  it("calls the permission check from inside `registerAuthentication`", () => {
    const body = functionBody(hook, "registerAuthentication");
    expect(body, "registerAuthentication is gone or renamed").toBeDefined();
    expect(body!).toContain("await enforcePermission(req, deps, { url, spec, operator, memberships })");
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
    expect(body!).toContain("recordAuthorizationDecision(deps.pool, record)");
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
