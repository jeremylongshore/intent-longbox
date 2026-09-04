// L3: the app role's privilege plan is derived from the declared lists, and a
// table in neither list fails LOUDLY rather than defaulting to something (E02-D06).
import { describe, expect, it, vi } from "vitest";
import {
  applyAppRoleGrants,
  buildGrantStatements,
  NO_APP_GRANT_TABLE_NAMES,
  planAppRoleGrants,
  UndeclaredTableError,
} from "../src/db/appRoleGrants.js";
import { APPEND_ONLY_EXEMPTIONS, APPEND_ONLY_TABLE_NAMES } from "../src/db/appendOnlyTables.js";

describe("planAppRoleGrants", () => {
  it("classifies a declared append-only table as append-only", () => {
    expect(planAppRoleGrants(["cost_log", "pricing_snapshot"])).toEqual({
      appendOnly: ["cost_log", "pricing_snapshot"],
      mutable: [],
      noGrant: [],
    });
  });

  it("classifies a declared exemption as mutable", () => {
    expect(planAppRoleGrants(["shop", "scan_session"])).toEqual({
      appendOnly: [],
      mutable: ["scan_session", "shop"],
      noGrant: [],
    });
  });

  it("classifies an appGrant:'none' exemption into the no-grant class, not the mutable one", () => {
    // schema_migrations is exempt from the trigger AND from the application.
    // Granting it the uniform exempt-table DML would let a DELETE on the ledger
    // make the next migrate re-run 003's DROP-then-CREATE trigger loop, which
    // lands triggers back at the bypassable 'O' default.
    expect(planAppRoleGrants(["schema_migrations", "shop"])).toEqual({
      appendOnly: [],
      mutable: ["shop"],
      noGrant: ["schema_migrations"],
    });
  });

  it("names schema_migrations as the only no-grant table today", () => {
    expect(NO_APP_GRANT_TABLE_NAMES).toEqual(["schema_migrations"]);
  });

  it("declares no-grant only for tables that really exist (no pending rows)", () => {
    // A `pending` exemption names a table the schema does not contain, so a
    // no-grant row on one would be unassertable against a live database.
    const pendingNoGrant = APPEND_ONLY_EXEMPTIONS.filter((e) => e.appGrant === "none" && e.pending).map(
      (e) => e.table
    );
    expect(pendingNoGrant).toEqual([]);
  });

  it("throws on a table that appears in neither declared list", () => {
    // This is the bead's "a table absent from both lists fails the grant step
    // loudly" requirement: the next migration that adds a table without
    // declaring it cannot reach a database with privileges nobody chose.
    expect(() => planAppRoleGrants(["cost_log", "invoice", "widget"])).toThrow(UndeclaredTableError);
    try {
      planAppRoleGrants(["cost_log", "invoice", "widget"]);
    } catch (err) {
      expect((err as UndeclaredTableError).tables).toEqual(["invoice", "widget"]);
      expect((err as Error).message).toContain("src/db/appendOnlyTables.ts");
    }
  });

  it("sorts output so the plan is diffable", () => {
    const plan = planAppRoleGrants(["shop", "cost_log", "scan_session", "candidate_set"]);
    expect(plan.appendOnly).toEqual(["candidate_set", "cost_log"]);
    expect(plan.mutable).toEqual(["scan_session", "shop"]);
  });

  it("accepts the full declared append-only set", () => {
    expect(planAppRoleGrants(APPEND_ONLY_TABLE_NAMES).appendOnly).toHaveLength(
      APPEND_ONLY_TABLE_NAMES.length
    );
  });
});

describe("buildGrantStatements", () => {
  const plan = { appendOnly: ["cost_log"], mutable: ["shop"], noGrant: ["schema_migrations"] };

  it("emits no GRANT at all for a no-grant table — the opening REVOKE ALL is its whole story", () => {
    const sql = buildGrantStatements(plan, "longbox_app", ["v"]).join("\n");
    expect(sql).not.toMatch(/GRANT[^\n]*schema_migrations/);
    expect(sql).toContain("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM longbox_app");
  });

  it("still validates a no-grant identifier, so the class cannot smuggle one past the check", () => {
    expect(() => buildGrantStatements({ appendOnly: [], mutable: [], noGrant: ["bad name"] }, "app")).toThrow(
      /unsafe table/
    );
  });

  it("revokes before granting, so the step is corrective and not merely additive", () => {
    const statements = buildGrantStatements(plan, "longbox_app");
    expect(statements[0]).toBe("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM longbox_app");
    expect(statements).toContain("GRANT SELECT, INSERT ON cost_log TO longbox_app");
    expect(statements).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON shop TO longbox_app");
  });

  it("never grants UPDATE or DELETE on an append-only table", () => {
    const sql = buildGrantStatements(plan, "longbox_app").join("\n");
    expect(sql).not.toMatch(/GRANT[^\n]*(UPDATE|DELETE)[^\n]*cost_log/);
  });

  it("grants views SELECT only — an updatable view would be an UPDATE path", () => {
    const statements = buildGrantStatements(plan, "longbox_app", ["pricing_snapshot_current"]);
    expect(statements).toContain("GRANT SELECT ON pricing_snapshot_current TO longbox_app");
  });

  it("never grants DDL or trigger control", () => {
    const sql = buildGrantStatements(plan, "longbox_app", ["v"]).join("\n");
    expect(sql).not.toMatch(/ALL PRIVILEGES|CREATE ON SCHEMA|ALTER|TRIGGER/);
  });

  it("refuses an identifier it would have to interpolate unsafely", () => {
    expect(() => buildGrantStatements(plan, 'app"; DROP DATABASE x; --')).toThrow(/unsafe role/);
    expect(() => buildGrantStatements({ appendOnly: ["a b"], mutable: [], noGrant: [] }, "app")).toThrow(
      /unsafe table/
    );
  });
});

describe("applyAppRoleGrants", () => {
  function fakeClient(tables: string[], views: string[], roleExists = true) {
    const executed: string[] = [];
    const query = vi.fn(async (text: string) => {
      executed.push(text);
      if (text.includes("pg_roles")) return { rows: roleExists ? [{ "?column?": 1 }] : [] };
      if (text.includes("relkind = 'r'")) return { rows: tables.map((name) => ({ name })) };
      if (text.includes("relkind IN ('v', 'm')")) return { rows: views.map((name) => ({ name })) };
      return { rows: [] };
    });
    return { client: { query }, executed };
  }

  it("applies every statement in the plan", async () => {
    const { client, executed } = fakeClient(["cost_log", "shop"], ["shop_current"]);
    const result = await applyAppRoleGrants(client, "longbox_app");
    expect(result.plan).toEqual({ appendOnly: ["cost_log"], mutable: ["shop"], noGrant: [] });
    expect(executed).toContain("GRANT SELECT, INSERT ON cost_log TO longbox_app");
    expect(executed).toContain("GRANT SELECT ON shop_current TO longbox_app");
  });

  it("fails closed when the role does not exist rather than skipping the grants", async () => {
    const { client } = fakeClient(["cost_log"], [], false);
    await expect(applyAppRoleGrants(client, "longbox_app")).rejects.toThrow(
      /role "longbox_app" does not exist/
    );
  });

  it("refuses to grant anything when the schema holds an undeclared table", async () => {
    const { client, executed } = fakeClient(["cost_log", "surprise_table"], []);
    await expect(applyAppRoleGrants(client, "longbox_app")).rejects.toThrow(UndeclaredTableError);
    expect(executed.some((s) => s.startsWith("GRANT"))).toBe(false);
  });
});
