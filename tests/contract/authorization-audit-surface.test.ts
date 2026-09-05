// L2 contract: **the actor audit is a decision record and never becomes a
// per-operator surface** (022 P3, 019 T35, non-waivable).
//
// Bead: longbox-e5b.3.3 (alias E03-B03). Docs: 054 §4; 022 P3; 019 T35(a);
// 034 §3.3; 041 §9.2.
//
// 022 P3's CFO constraint is the sentence this file enforces: *"the cheapest way
// to satisfy T35 is never to build a per-operator surface, and no such surface
// may be built and then restricted."* A table that records who was allowed to do
// what is one column and one route away from being exactly that surface — so the
// column list is CLOSED here, in a test, and the absence of a route is asserted
// rather than assumed.
//
// Every assertion below is a specific way the table could turn into surveillance,
// written down so that the day somebody needs one of them, they have to argue
// with a named line instead of adding a field.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPEND_ONLY_TABLES, APPEND_ONLY_EXEMPTIONS } from "../../src/db/appendOnlyTables.js";
import { ROUTES } from "../../src/contracts/v1/routes.js";

const repoRoot = join(import.meta.dirname, "..", "..");
const migration = readFileSync(join(repoRoot, "migrations", "028_authorization_decision.sql"), "utf8");

/** The `CREATE TABLE authorization_decision ( … );` body, comments removed. */
function tableBody(): string {
  const start = migration.indexOf("CREATE TABLE IF NOT EXISTS authorization_decision");
  expect(start, "the table is gone or renamed").toBeGreaterThan(-1);
  const end = migration.indexOf("\n);", start);
  return migration.slice(start, end).replace(/--[^\n]*/g, "");
}

describe("the column list is CLOSED (054 §4.2)", () => {
  it("declares exactly these columns and no others", () => {
    const body = tableBody();
    // Anchored on the TYPE, not on whitespace: column alignment is cosmetic and
    // the longest name has one space after it, which a whitespace-counting
    // matcher silently skipped — a checker with a blind spot, on the test whose
    // whole job is a closed list.
    const declared = [...body.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|timestamptz)\b/gm)].map((m) => m[1]!);
    expect(declared.sort()).toEqual(
      [
        "decided_at",
        "decision",
        "id",
        // K2: the semver names a code CONSTANT; the commit names bytes. Two
        // deployments can both say `1.0.0` while one carries an edit nobody
        // bumped.
        "matrix_commit",
        "matrix_version",
        "membership_id",
        "permission",
        "refusal_reason",
        "role",
        "route_method",
        "route_path",
        "session_chain_id",
        "shop_id",
      ].sort()
    );
    // F10: `authored_by` is ABSENT and the absence is a decision. 041 §2.3's
    // envelope records WHICH KIND of actor produced a witness row; every row
    // here is written by one rule in one function, so the column could only hold
    // `'system'` — and a column with one possible value teaches a reader nothing
    // while inviting a second writer to set it to something else.
    expect(declared).not.toContain("authored_by");
  });

  it("carries NO column that would make a row joinable to a person or to an item", () => {
    // Each name here is a real proposal somebody will make, and the reason it is
    // refused is in 054 §4.2:
    //   app_user_id / display_name — the person is one join away THROUGH the
    //     membership, and that join is what 034 §3.3's accessor gates;
    //   scan_session_id — joins the decision to the book, which turns "who was
    //     allowed" into "what they did to this item";
    //   correlation_id — joins it to the request, and thereby to everything else
    //     the request touched;
    //   ip_address / user_agent — a request log, and 042 §8.1 already refuses the
    //     IP as a rate key for the same reason it is useless here;
    //   duration_ms / count — measurement of a person, which is P3's whole subject.
    const body = tableBody();
    for (const forbidden of [
      "app_user_id",
      "display_name",
      "operator_id",
      "created_by",
      "confirmed_by",
      "scan_session_id",
      "correlation_id",
      "ip_address",
      "user_agent",
      "duration_ms",
      "count",
    ]) {
      expect(body, `authorization_decision must not carry ${forbidden} (022 P3, 054 §4.2)`).not.toContain(
        forbidden
      );
    }
  });

  it("indexes the ONE access path it has, and neither of the two per-person ones", () => {
    // F1 / S6, and the finding is worth the length. The first version of this
    // migration carried `authorization_decision_chain_idx` and justified it as
    // serving 019 T35(c) — which was FALSE: the reconciliation runs
    // `app_session` → `membership` and touches this table not at all. What the
    // index actually bought was a fast "everything this person did on this phone
    // that day", which is the covert timeclock 022 P3 forbids, sitting inside a
    // table whose own record argued it was not a per-operator surface.
    //
    // Both per-person indexes are now refused BY NAME: the chain and the grant.
    // Every such join still works — a sequential scan is the right cost for a
    // scheduled job and the wrong cost for a casual question.
    expect(migration).toContain("authorization_decision_shop_time_idx");
    expect(migration).not.toMatch(/CREATE INDEX[^;]*authorization_decision \(session_chain_id/);
    expect(migration).not.toMatch(/CREATE INDEX[^;]*authorization_decision \(membership_id/);
    // And exactly one index is created, so a third cannot arrive unnoticed.
    const created = [...migration.matchAll(/CREATE INDEX[^;]*ON authorization_decision/g)];
    expect(created).toHaveLength(1);
  });
});

describe("it is append-only and the app role can only append to it", () => {
  it("is a DECLARED append-only table, so the grant step gives it SELECT, INSERT", () => {
    const row = APPEND_ONLY_TABLES.find((t) => t.table === "authorization_decision");
    expect(row, "authorization_decision is not declared in appendOnlyTables.ts").toBeDefined();
    expect(row!.trigger).toBe("authorization_decision_append_only");
    expect(row!.since).toBe("028_authorization_decision.sql");
    // Not lockable, not observed externally, not session-scoped — three
    // properties a reader would otherwise have to infer.
    expect(row!.ordersByObservedAt).toBe(false);
    expect(row!.sessionSeq).toBe(false);
    expect(
      APPEND_ONLY_EXEMPTIONS.some((e) => e.table === "authorization_decision"),
      "it must not be BOTH declared and exempt"
    ).toBe(false);
  });

  it("creates the trigger and sets it to ENABLE ALWAYS in the same statement block", () => {
    // 041 §9.2 item 1: `CREATE TRIGGER` lands at the bypassable 'O' default, so
    // the pairing is the control. The integration lane asserts it against
    // `pg_trigger`; this asserts the migration cannot land without it.
    expect(migration).toContain("forbid_mutation()");
    expect(migration).toContain("ENABLE ALWAYS TRIGGER");
  });
});

describe("it has ONE writer and NO reader on the wire (054 §4.4)", () => {
  const sources = walk(join(repoRoot, "src")).filter((p) => p.endsWith(".ts"));

  it("is inserted into by exactly one module", () => {
    const writers = sources
      .filter((p) => /INSERT\s+INTO\s+authorization_decision/i.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(repoRoot.length + 1));
    expect(writers).toEqual(["src/services/auth/authorizationAudit.ts"]);
  });

  it("is named by no route, no response DTO and no generated document", () => {
    // The negative that matters most: 019 T35 is about RENDERING. A table nobody
    // can reach over HTTP cannot render a per-operator anything, whatever a
    // future report would like to do with it.
    // Comments are stripped first, for the reason the `authorize(` scan in
    // `permission-enforcement.test.ts` learned: the contract layer DISCUSSES this
    // table in prose (the role enum is its `CHECK`, and the rank decides which
    // grant a row names), and a checker that counted prose would teach the next
    // author to stop explaining themselves — the opposite of what these files want.
    for (const path of sources.filter((p) => p.includes("/src/routes/") || p.includes("/src/contracts/"))) {
      expect(stripComments(readFileSync(path, "utf8")), `${path} names the audit table`).not.toContain(
        "authorization_decision"
      );
    }
    const openapi = readFileSync(join(repoRoot, "contracts", "openapi.v1.json"), "utf8");
    expect(openapi).not.toContain("authorization_decision");
    expect(openapi).not.toContain("matrix_version");
    // And no route accepts a permission, a role or a membership as a parameter —
    // 019 T35(a)'s "no filter, sort or grouping parameter", applied to the
    // dimensions this table introduces.
    for (const route of ROUTES) {
      expect(route.path).not.toMatch(/:membershipId|:role|:permission/);
    }
  });
});

/** `//` and block comments removed, so a mention in prose is not a reference. */
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
