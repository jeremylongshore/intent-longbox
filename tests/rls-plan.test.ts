// L2: the row-level-security PLAN, with no database.
//
// E03-B04. `src/db/rowLevelSecurity.ts` classifies the live schema and emits the
// statements that put every shop-scoped table behind a policy. The classification
// is where the interesting failure lives — a table that carries no `shop_id` and
// no declared exemption is a table somebody forgot, and the whole point of this
// module is that such a table stops the grant step LOUDLY rather than landing
// outside the boundary. That is asserted here, against fixtures, because the live
// schema (by construction) contains no such table to test with.
import { describe, expect, it } from "vitest";
import {
  RLS_EXEMPTIONS,
  SERVICE_CONTEXT_TABLES,
  SERVICE_POLICY,
  SERVICE_TABLES,
  SERVICE_WRITE_POLICY,
  SERVICE_WRITE_TABLES,
  TENANT_POLICY,
  TENANT_PREDICATE,
  UndeclaredTenancyError,
  UnsupportedRelkindError,
  buildRlsStatements,
  planRowLevelSecurity,
  scopePredicate,
  serviceReadPredicate,
  serviceWritePredicate,
  tenantPredicate,
} from "../src/db/rowLevelSecurity.js";
import { SERVICE_SCOPES } from "../src/db/tenantContext.js";

const scanSession = { name: "scan_session", relkind: "r", hasShopId: true };
const appSession = { name: "app_session", relkind: "r", hasShopId: true };
const shop = { name: "shop", relkind: "r", hasShopId: false };

describe("classifying the live schema", () => {
  it("policies every table that carries a tenant, and matches the exemptions by name", () => {
    const org = { name: "organization", relkind: "r", hasShopId: false };
    const plan = planRowLevelSecurity([scanSession, org]);
    expect(plan.policied).toEqual(["scan_session"]);
    expect(plan.exempt).toEqual(["organization"]);
  });

  it("policies `shop` on its OWN id, because its tenant column is not `shop_id`", () => {
    // The invariant review's WARN 3: the tenant table was an exemption on two
    // reasons, and this bead's own `my-shops` scope had made the first one false.
    const plan = planRowLevelSecurity([shop]);
    expect(plan.policied).toEqual(["shop"]);
    expect(plan.exempt).toEqual([]);
    expect(tenantPredicate("shop")).toBe("id = current_shop_id()");
    expect(tenantPredicate("scan_session")).toBe("shop_id = current_shop_id()");
    const sql = buildRlsStatements(plan);
    expect(sql).toContain(
      `CREATE POLICY ${TENANT_POLICY} ON shop FOR ALL ` +
        `USING (id = current_shop_id()) WITH CHECK (id = current_shop_id())`
    );
    // …and the consequence worth having: an INSERT can never satisfy it, so
    // creating a shop is a schema-owner act enforced by the database.
    expect(sql.some((x) => x.includes("CREATE POLICY service_write ON shop"))).toBe(false);
  });

  it("REFUSES a table that carries neither a shop_id nor a declared exemption", () => {
    // The loud failure. Defaulting an unknown table to "exempt" would put a new
    // shop-scoped table whose author forgot the column outside the tenant
    // boundary silently — which is 034 §1 E10, the defect this bead closes.
    expect(() =>
      planRowLevelSecurity([scanSession, { name: "brand_new", relkind: "r", hasShopId: false }])
    ).toThrow(UndeclaredTenancyError);
    try {
      planRowLevelSecurity([{ name: "brand_new", relkind: "r", hasShopId: false }]);
    } catch (err) {
      expect((err as Error).message).toContain("brand_new");
      // The message says both ways out, because the right one depends on what
      // the table is and only its author knows.
      expect((err as Error).message).toContain("shop_id");
      expect((err as Error).message).toContain("RLS_EXEMPTIONS");
    }
  });

  it("marks the declared pre-tenant tables as service-scoped, and nothing else", () => {
    const plan = planRowLevelSecurity([scanSession, appSession]);
    expect(plan.serviceScoped).toEqual(["app_session"]);
    expect(plan.policied).toEqual(["app_session", "scan_session"]);
  });

  it("sorts, so the plan and its diff read the same on every machine", () => {
    const plan = planRowLevelSecurity([
      { name: "zeta", relkind: "r", hasShopId: true },
      { name: "alpha", relkind: "r", hasShopId: true },
    ]);
    expect(plan.policied).toEqual(["alpha", "zeta"]);
  });

  it("POLICIES a partitioned table, because a policy on the parent is what a query hits", () => {
    // Security lens F3: the old enumeration asked for `relkind = 'r'` and a
    // partitioned shop-scoped table was therefore neither policied nor refused.
    const plan = planRowLevelSecurity([{ name: "part", relkind: "p", hasShopId: true }]);
    expect(plan.policied).toEqual(["part"]);
  });

  it("REFUSES a materialized view and a foreign table, and says what to do instead", () => {
    // The other half of F3, and the sharper one: the GRANT plan already hands the
    // app role `SELECT` on materialized views, so the first one in any future
    // migration would have been granted, unpolicied, and green at boot. RLS does
    // not apply to a materialized view at all.
    for (const relkind of ["m", "f"]) {
      const err = (() => {
        try {
          planRowLevelSecurity([{ name: "cached_thing", relkind, hasShopId: true }]);
          return undefined;
        } catch (e) {
          return e as Error;
        }
      })();
      expect(err).toBeInstanceOf(UnsupportedRelkindError);
      expect(err!.message).toContain("cached_thing");
      expect(err!.message).toContain(relkind);
    }
  });

  it("raises the UNSUPPORTED kind before the undeclared one — it names a different fix", () => {
    // A materialized view with no `shop_id` is not a table somebody forgot to give
    // a tenant; reporting it that way would send its author to the wrong repair.
    expect(() =>
      planRowLevelSecurity([
        { name: "cached", relkind: "m", hasShopId: false },
        { name: "forgot", relkind: "r", hasShopId: false },
      ])
    ).toThrow(UnsupportedRelkindError);
  });
});

describe("the statements it emits", () => {
  it("enables RLS and writes ONE policy per table, with the same predicate on both halves", () => {
    const sql = buildRlsStatements(planRowLevelSecurity([scanSession]));
    expect(sql).toContain("ALTER TABLE scan_session ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain(`DROP POLICY IF EXISTS ${TENANT_POLICY} ON scan_session`);
    expect(sql).toContain(
      `CREATE POLICY ${TENANT_POLICY} ON scan_session FOR ALL ` +
        `USING (${TENANT_PREDICATE}) WITH CHECK (${TENANT_PREDICATE})`
    );
  });

  it("DROPS BOTH service policies on every table, so the declaration can NARROW as well as widen", () => {
    // A table removed from `SERVICE_TABLES` must lose its policies on the next
    // run. Emitting the DROPs only for members would make the declaration able to
    // widen the boundary and never to close it again.
    const sql = buildRlsStatements(planRowLevelSecurity([scanSession]));
    expect(sql).toContain(`DROP POLICY IF EXISTS ${SERVICE_POLICY} ON scan_session`);
    expect(sql).toContain(`DROP POLICY IF EXISTS ${SERVICE_WRITE_POLICY} ON scan_session`);
    expect(sql.some((x) => x.startsWith(`CREATE POLICY ${SERVICE_POLICY} ON scan_session`))).toBe(false);
  });

  it("gives a declared pre-tenant table a SELECT-only policy naming its own scopes (F1)", () => {
    // The security lens reproduced what `FOR ALL` over a scope-agnostic boolean
    // meant: inside `my-shops` the app role inserted an owner membership at
    // another shop. A read policy is `FOR SELECT`, and it names the scopes THAT
    // table declares rather than "any scope at all".
    const sql = buildRlsStatements(planRowLevelSecurity([appSession]));
    expect(sql).toContain(
      `CREATE POLICY ${SERVICE_POLICY} ON app_session FOR SELECT ` +
        `USING (longbox_service_scope() = ANY (ARRAY['session-resolution']))`
    );
    // …and NOT a write policy: `app_session` is written under the shop its row names.
    expect(sql.some((x) => x.startsWith(`CREATE POLICY ${SERVICE_WRITE_POLICY} ON app_session`))).toBe(false);
  });

  it("gives the three writable tables an INSERT-only policy with a condition on the ROW", () => {
    const attempt = SERVICE_TABLES.find((t) => t.table === "auth_attempt")!;
    const sql = buildRlsStatements(
      planRowLevelSecurity([{ name: "auth_attempt", relkind: "r", hasShopId: true }])
    );
    expect(sql).toContain(
      `CREATE POLICY ${SERVICE_WRITE_POLICY} ON auth_attempt FOR INSERT ` +
        `WITH CHECK (${serviceWritePredicate(attempt)})`
    );
    // The condition is about the row, not only about the scope — a scope alone
    // would be the `FOR ALL` boolean again, one policy narrower.
    expect(serviceWritePredicate(attempt)).toContain("shop_id IS NULL");
    expect(SERVICE_WRITE_TABLES).toEqual([
      "auth_attempt",
      "connector_token_retirement",
      "connector_webhook_receipt",
    ]);
  });

  it("makes every view security_invoker — the half that would have voided the rest", () => {
    // Without it a view reads its base tables as the VIEW OWNER, which is the
    // schema owner, which `migrations/029` (a) exempts from these policies. The
    // `*_current` read models are exactly what a report reaches for.
    const sql = buildRlsStatements(planRowLevelSecurity([scanSession], ["human_confirmation_current"]));
    expect(sql).toContain("ALTER VIEW human_confirmation_current SET (security_invoker = true)");
  });

  it("refuses to interpolate an identifier that is not a plain lowercase name", () => {
    expect(() =>
      buildRlsStatements({
        policied: ['scan_session"; DROP TABLE shop; --'],
        serviceScoped: [],
        exempt: [],
        views: [],
      })
    ).toThrow(/unsafe table name/);
  });
});

describe("the service declaration", () => {
  it("names only scopes that exist, and gives every table at least one reader", () => {
    const known = SERVICE_SCOPES.map((s) => s.scope);
    for (const table of SERVICE_TABLES) {
      expect(table.readScopes.length).toBeGreaterThan(0);
      for (const scope of table.readScopes) expect(known).toContain(scope);
      for (const scope of table.write?.scopes ?? []) {
        expect(known).toContain(scope);
        // A scope that may WRITE a table must also be able to READ it: an INSERT
        // … RETURNING needs the row back, and every writer here reads first.
        expect(table.readScopes).toContain(scope);
      }
    }
  });

  it("gives every row a reason, and every write its own reason", () => {
    for (const table of SERVICE_TABLES) {
      expect(table.reason.length).toBeGreaterThan(40);
      if (table.write) {
        expect(table.write.reason.length).toBeGreaterThan(40);
        // A write check that is `true` is the `FOR ALL` boolean wearing a
        // narrower name; F1 is not closed by renaming it.
        expect(table.write.check).not.toBe("true");
      }
    }
  });

  it("sorts the scope list, so a policy's text does not depend on declaration order", () => {
    expect(scopePredicate(["my-shops", "code-redemption"])).toBe(
      "longbox_service_scope() = ANY (ARRAY['code-redemption', 'my-shops'])"
    );
  });

  it("keeps the read predicate SELECT-shaped and the write predicate a conjunction", () => {
    const receipt = SERVICE_TABLES.find((t) => t.table === "connector_webhook_receipt")!;
    expect(serviceReadPredicate(receipt)).toBe("longbox_service_scope() = ANY (ARRAY['connector-inbound'])");
    expect(serviceWritePredicate(receipt)).toContain(" AND (");
  });
});

describe("the exemption rows are decisions, not a list", () => {
  it("gives every exempt table a reason that names its CLASS, not a label", () => {
    // Deliberately a floor and not a paragraph: the catalog rows are terse
    // because the class is argued once ("a corpus is the same facts for every
    // shop", 030 §7) and cited by the rest. What the floor forbids is the row
    // that says "internal" or "n/a" and settles nothing.
    for (const { table, reason } of RLS_EXEMPTIONS) {
      expect(table).toMatch(/^[a-z_]+$/);
      expect(reason.length).toBeGreaterThan(20);
      expect(reason).toMatch(/[.§]/);
    }
  });

  it("names each table once, and names no table that is also service-scoped", () => {
    const names = RLS_EXEMPTIONS.map((e) => e.table);
    expect(new Set(names).size).toBe(names.length);
    // A table cannot both carry no tenant and carry a second policy over one.
    for (const t of SERVICE_CONTEXT_TABLES) expect(names).not.toContain(t);
  });

  it("no longer exempts `shop`, and says in `app_user`'s row why THAT one stays", () => {
    // `shop` moved out of this list entirely (it is policied on its own `id`). The
    // person tables stay, and their reason had to be repaired: an EXISTS-over-
    // membership policy would not encode "a person belongs to one shop" — it would
    // refuse a person during the transaction that admits them.
    expect(RLS_EXEMPTIONS.find((e) => e.table === "shop")).toBeUndefined();
    const user = RLS_EXEMPTIONS.find((e) => e.table === "app_user");
    expect(user).toBeDefined();
    expect(user!.reason).toContain("SAME transaction");
    expect(user!.reason).toContain("R9");
  });
});
