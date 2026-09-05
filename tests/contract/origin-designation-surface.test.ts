// L2 contract: **the Longbox-origin designation is a fact for one audit, and
// never becomes a surface** (022 P3, 019 T35(c), non-waivable).
//
// Bead: longbox-e5b.3.24 (alias E03-D14). Docs: 000-docs/058 §3–§4; 054 §6;
// 019 T35(c); 034 §2.7, §3.3; 048 §3; 022 P3, P7; 041 §2.3, §9.2.
//
// This bead adds a table that says, of a named colleague, *"this person is
// watched"*. That is the most sensitive thing this schema has ever held about
// somebody at work, and it is one route away from being the artifact 022 P3
// forbids. So the assertions below are written as a closed list of the ways it
// could turn into one, each with the line it would be violating — the same shape
// `authorization-audit-surface.test.ts` uses one table over.
//
// It also pins the two structural properties the reconciliation depends on and
// that no runtime test can see:
//
//   * the predicate has ONE definition — the SQL function — and the TypeScript
//     names it rather than restating it;
//   * the reconciliation query names NO chain kind, so E03-D11's privileged
//     chain joins the population without an edit.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPEND_ONLY_TABLES } from "../../src/db/appendOnlyTables.js";
import { RLS_EXEMPTIONS } from "../../src/db/rowLevelSecurity.js";
import { NO_APP_GRANT_TABLE_NAMES } from "../../src/db/appRoleGrants.js";
import { ROUTES } from "../../src/contracts/v1/routes.js";
import { ORIGIN_PREDICATE_FUNCTION } from "../../src/services/auth/index.js";
// The same walker `pnpm arch` uses, so this rule and the gate see one tree.
import { collectSources } from "../../scripts/architectureRules.js";

const repoRoot = join(import.meta.dirname, "..", "..");
const migration = readFileSync(join(repoRoot, "migrations", "032_longbox_origin_designation.sql"), "utf8");
const auditSource = readFileSync(join(repoRoot, "src", "services", "auth", "authorizationAudit.ts"), "utf8");
const originSource = readFileSync(join(repoRoot, "src", "services", "auth", "origin.ts"), "utf8");
/** `migrations/033` — the enforcement the cannon's F1 found missing at `635aabe`. */
const enforcement = readFileSync(
  join(repoRoot, "migrations", "033_origin_designation_time_integrity.sql"),
  "utf8"
);

/** How the reconciliation names the predicate: the CONSTANT, interpolated. */
const PREDICATE_CALL_SITE = "${ORIGIN_PREDICATE_FUNCTION}(s.app_user_id, s.issued_at)";

/** One `CREATE TABLE … ( … );` body, comments removed. */
function tableBody(table: string): string {
  const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
  expect(start, `the table ${table} is gone or renamed`).toBeGreaterThan(-1);
  const end = migration.indexOf("\n);", start);
  return migration.slice(start, end).replace(/--[^\n]*/g, "");
}

describe("the designation's column list is CLOSED (058 §3)", () => {
  it("declares exactly these columns and no others", () => {
    const declared = [
      ...tableBody("app_user_origin").matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|timestamptz)\b/gm),
    ].map((m) => m[1]!);
    expect(declared.sort()).toEqual(
      [
        "app_user_id",
        "authored_by",
        "created_at",
        "designated_by",
        "effective_from",
        "id",
        "origin",
        "reason",
      ].sort()
    );
  });

  it("carries no shop, no session, no device and no status", () => {
    const body = tableBody("app_user_origin");
    // A `shop_id` would make origin answer per tenant and hide the single most
    // interesting row: a Longbox account at a shop it holds nothing at (058
    // §3(d)). The other three are the columns that would make it a timeclock.
    for (const forbidden of ["shop_id", "scan_session_id", "device_id", "session_chain_id"]) {
      expect(body, `${forbidden} would join a designation to a place or an act (022 P3)`).not.toContain(
        forbidden
      );
    }
    // No status column, on 034 §2.7's grant/release idiom: liveness is a
    // predicate over a retirement ROW, so it cannot be flipped by an UPDATE.
    for (const status of [" status ", "retired_at", "revoked_at", "is_active"]) {
      expect(body).not.toContain(status);
    }
  });

  it("gives the RETIREMENT no timestamp the writer chooses — the SHAPE half only", () => {
    const body = tableBody("app_user_origin_retirement");
    // ⚠ **THIS WAS THE WHOLE OF I13, AND IT COULD NOT SEE THE ATTACK** (the
    // security lens's F1). It asserts the ABSENCE of three column NAMES — and
    // the back-dated retirement needed none of them: it supplied `created_at`,
    // the column the design put there on purpose, whose `DEFAULT now()` applies
    // only when the writer OMITS it. A test that names what must not exist
    // cannot see a property that fails through what must.
    //
    // The PROPERTY is now proved by execution in
    // `tests/integration/break-glass-origin.test.ts`, which ATTEMPTS the
    // back-dated INSERT as the schema owner and asserts the refusal
    // (`migrations/033`). What survives here is the shape: no second time column
    // may appear, and the writer must offer no timestamp argument.
    expect(body).toContain("created_at  timestamptz NOT NULL DEFAULT now()");
    for (const settable of ["effective_from", "effective_until", "retired_at"]) {
      expect(body, `${settable} would let a writer choose when a designation ended`).not.toContain(settable);
    }
    // And the writer offers no such argument either.
    expect(originSource).not.toMatch(/retireOrigin[\s\S]{0,600}retiredAt/);
  });

  it("F1: the ENFORCEMENT is declared in `migrations/033` — forced now(), no future start, no predate", () => {
    // Three checks that fail differently (034 §3.2), asserted as declarations
    // here and as refusals in the lane. The `ENABLE ALWAYS` half matters as much
    // as the trigger: a control a `session_replication_role` switch turns off is
    // not one.
    expect(enforcement).toContain("NEW.created_at := now()");
    expect(enforcement).toContain("NEW.effective_from > now()");
    expect(enforcement).toContain("NEW.created_at < started");
    for (const trigger of [
      "a_app_user_origin_retirement_forces_now",
      "b_app_user_origin_retirement_not_before_start",
      "a_app_user_origin_not_future",
    ]) {
      expect(enforcement).toContain(`ENABLE ALWAYS TRIGGER ${trigger}`);
    }
    // The forcing trigger must sort BEFORE the comparison, because the
    // comparison reads the value the forcing trigger writes and Postgres fires
    // BEFORE triggers in NAME order. Alphabetical ordering is exactly the kind
    // of dependency that survives review and not a rename, so it is asserted.
    expect("a_app_user_origin_retirement_forces_now" < "b_app_user_origin_retirement_not_before_start").toBe(
      true
    );
  });

  it("keeps single-use and says why in the migration, by a UNIQUE rather than a convention", () => {
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS app_user_origin_retirement_origin_idx");
  });
});

describe("the predicate has ONE definition (058 §3(d))", () => {
  it("is a STABLE SQL function in the migration, named exactly as the code names it", () => {
    expect(ORIGIN_PREDICATE_FUNCTION).toBe("longbox_is_origin_staff");
    expect(migration).toContain(`CREATE OR REPLACE FUNCTION ${ORIGIN_PREDICATE_FUNCTION}(`);
    expect(migration).toMatch(/RETURNS boolean\s+LANGUAGE sql\s+STABLE/);
  });

  it("is SECURITY INVOKER — it never lends the owner's read of a person", () => {
    // The default, and asserted as an ABSENCE because the way this control is
    // lost is somebody adding one line. A definer function over these tables
    // would hand the application the read `appGrant: "none"` just took away.
    expect(migration).not.toContain("SECURITY DEFINER");
  });

  it("is not re-implemented in TypeScript: the reconciliation CALLS it, by the constant", () => {
    // Asserted as the SOURCE LITERAL — the query INTERPOLATES the exported
    // constant rather than hard-coding the function name, so a rename in the
    // migration reaches the query through one edit instead of two.
    expect(auditSource).toContain(PREDICATE_CALL_SITE);
    // A second copy would look like a query over the designation tables here.
    expect(auditSource).not.toMatch(/FROM app_user_origin\b/);
  });

  it("H1: NO file outside the migration re-states the liveness logic", () => {
    // The data-model lens's H1, as a RULE rather than as one fixed call site.
    // `liveOriginDesignationCount` had written `NOT EXISTS (… app_user_origin_
    // retirement …)` out again, one function away from the definition this
    // record's own §3(d) argument says is the only one. Small and contained is
    // exactly what drift looks like on the day it starts, so the shape is banned
    // rather than the instance repaired.
    //
    // ⚠ **IT WALKS THE TREE, AND THE FIRST VERSION WALKED A LIST OF TWO** (the
    // re-verification's finding). The title said *NO file* while the body
    // iterated `origin.ts` and `authorizationAudit.ts`, so a restatement dropped
    // into any OTHER file under `src/` passed — and the reviewer proved it by
    // injecting one and watching 15 of 15 stay green. A test whose title is
    // broader than its subject is worse than a narrow one, because a reader
    // stops looking. `collectSources` is the same walker `pnpm arch` uses, over
    // both trees, so a new file is inside this rule the moment it exists.
    const RESTATEMENT = /NOT\s+EXISTS[\s\S]{0,200}app_user_origin_retirement/i;
    // COMMENTS STRIPPED FIRST, because this rule is about CODE and several files
    // discuss the banned shape at length — a rule that a comment can trip is a
    // rule authors learn to route around by not writing the comment.
    const code = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*$/gm, "");
    const tree = [...collectSources(join(repoRoot, "src")), ...collectSources(join(repoRoot, "scripts"))];
    // The walk is asserted to have found something, so a `collectSources` that
    // silently returned nothing could not make this rule vacuously true.
    expect(tree.length).toBeGreaterThan(50);
    const offenders = tree.filter((f) => RESTATEMENT.test(code(f.text))).map((f) => f.path);
    expect(offenders, "these files re-state the predicate's own liveness logic").toEqual([]);
    // The rule is known to be able to FIRE: the same matcher, over the shape it
    // exists to catch. Without this the assertion above is indistinguishable
    // from a regex that matches nothing.
    expect(
      RESTATEMENT.test(
        "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM app_user_origin_retirement r WHERE r.origin_id = o.id)"
      )
    ).toBe(true);
    // And the migration is where it DOES live, so this is an equality rather
    // than a prohibition — a rule that would still pass if the predicate were
    // deleted outright is not the rule H1 asked for.
    expect(RESTATEMENT.test(migration)).toBe(true);
  });
});

describe("the reconciliation query cannot go blind on a new chain kind (048 §3.1)", () => {
  it("names no `kind` literal, so E03-D11's privileged chain joins without an edit", () => {
    const start = auditSource.indexOf("export async function unreconciledBreakGlassSessions");
    const body = auditSource.slice(start, auditSource.indexOf("\n}", start));
    // The exclusion of device sessions comes from `app_user_id IS NOT NULL` — a
    // phone is not a person — and NOT from `kind = 'operator'`, which would
    // silently exclude every chain kind invented after this was written. That is
    // a query that goes quiet rather than red, which is the worst failure a
    // detector has.
    expect(body).toContain("s.app_user_id IS NOT NULL");
    expect(body.replace(/--[^\n]*/g, "")).not.toMatch(/\bkind\b/);
  });

  it("keeps BOTH populations, because neither contains the other", () => {
    const start = auditSource.indexOf("export async function unreconciledBreakGlassSessions");
    const body = auditSource.slice(start, auditSource.indexOf("\n}", start));
    // (i) Longbox-origin, which is T35(c)'s own sentence and was unexpressible
    // until this bead; (ii) a break-glass holder, which catches a SHOP's own
    // support person straying outside their ticket. Dropping (ii) to tidy the
    // query would remove the half that is already tested.
    expect(body).toContain(PREDICATE_CALL_SITE);
    expect(body).toContain("m.role = 'support_break_glass'");
  });
});

describe("it has no wire surface and no application privilege", () => {
  it("appears in no route, in no DTO and in no generated OpenAPI artifact", () => {
    for (const route of ROUTES) {
      expect(route.path).not.toContain("origin");
      expect(route.path).not.toContain("staff");
    }
    const openapi = readFileSync(join(repoRoot, "contracts", "openapi.v1.json"), "utf8");
    expect(openapi).not.toContain("app_user_origin");
    expect(openapi).not.toContain("longbox_staff");
    expect(openapi).not.toContain(ORIGIN_PREDICATE_FUNCTION);
  });

  it("is append-only under an ENABLE ALWAYS trigger, both tables, declared", () => {
    for (const table of ["app_user_origin", "app_user_origin_retirement"]) {
      const declared = APPEND_ONLY_TABLES.find((t) => t.table === table);
      expect(declared, `${table} is not in the declared append-only set`).toBeDefined();
      expect(declared!.since).toBe("032_longbox_origin_designation.sql");
      expect(migration).toContain(`ALTER TABLE %I ENABLE ALWAYS TRIGGER %I`);
    }
  });

  it("gives the application role NO privilege on either table (058 §3(c))", () => {
    // The control that matters is the refusal of an INSERT: with one, a
    // compromised server could append a RETIREMENT and take a staff account out
    // of 019 T35(c)'s audited population from that moment on. A table that
    // records who is being watched must not be writable by the watched process.
    expect(NO_APP_GRANT_TABLE_NAMES).toContain("app_user_origin");
    expect(NO_APP_GRANT_TABLE_NAMES).toContain("app_user_origin_retirement");
  });

  it("declares both tables as RLS exemptions with a reason, not by omission", () => {
    for (const table of ["app_user_origin", "app_user_origin_retirement"]) {
      const row = RLS_EXEMPTIONS.find((e) => e.table === table);
      expect(row, `${table} carries no tenant and no declared reason`).toBeDefined();
      expect(row!.reason.length).toBeGreaterThan(20);
    }
  });
});
