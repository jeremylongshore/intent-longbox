// L2: the row-level-security PLAN, with no database.
//
// E03-B04. `src/db/rowLevelSecurity.ts` classifies the live schema and emits the
// statements that put every shop-scoped table behind a policy. The classification
// is where the interesting failure lives — a table that carries no `shop_id` and
// no declared exemption is a table somebody forgot, and the whole point of this
// module is that such a table stops the grant step LOUDLY rather than landing
// outside the boundary. That is asserted here, against fixtures, because the live
// schema (by construction) contains no such table to test with.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  POLICIED_WITHOUT_SHOP_ID,
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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every `.ts` file under a directory, so a claim about the tree is about the TREE. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && full.endsWith(".ts") ? [full] : [];
  });
}

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
    // ⚠ **THE OUTER PARENTHESES ARE THE DEPARSER'S, AND THEY ARE LOAD-BEARING**
    // (E03-D21). Postgres re-renders a policy fully parenthesised, and the boot
    // assertion compares live against declared by depth-annotated tokens —
    // because a comparison that erases parentheses erases precedence, which is
    // how a relaxed policy booted green. So the declaration is written in the
    // shape the catalog reports back.
    expect(tenantPredicate("shop")).toBe("(id = current_shop_id())");
    expect(tenantPredicate("scan_session")).toBe("(shop_id = current_shop_id())");
    const sql = buildRlsStatements(plan);
    expect(sql).toContain(
      `CREATE POLICY ${TENANT_POLICY} ON shop FOR ALL ` +
        `USING ((id = current_shop_id())) WITH CHECK ((id = current_shop_id()))`
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
        `USING ((longbox_service_scope() = ANY (ARRAY['session-resolution'])))`
    );
    // …and NOT a write policy: `app_session` is written under the shop its row names.
    expect(sql.some((x) => x.startsWith(`CREATE POLICY ${SERVICE_WRITE_POLICY} ON app_session`))).toBe(false);
  });

  it("gives every writable table an INSERT-only policy with a condition on the ROW", () => {
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
      // E03-D21: `app_user` is the FOURTH, and the only one whose check is about
      // a column rather than about a null — the admission may create an ACTIVE
      // person and nothing else, which is what makes "the running server can
      // never suspend or deactivate somebody" a property of the database.
      "app_user",
      "auth_attempt",
      "connector_token_retirement",
      "connector_webhook_receipt",
      // E03-B08 (000-docs/064 §7.2). `privacy_request` is written where its
      // evidence is written and its tenant may be NULL; `outbox` is the ONE
      // queue table reachable inside a scope, and its check names the EVENT — so
      // the inbound scope can enqueue the privacy job and can never enqueue a
      // draft. That the list had to be edited by hand is the point: a sixth
      // writable table is a decision, and this is where it is taken.
      "privacy_request",
      "outbox",
    ]);
  });

  it("E03-B08: the inbound scope may enqueue ONE event and no other", () => {
    // The widening a reviewer should look at hardest in this bead, pinned so it
    // cannot be relaxed silently. If a future edit drops the event name from this
    // check, the connector's inbound path can enqueue a draft — which is a
    // provider-triggered outward mutation with no human anywhere near it.
    const outbox = SERVICE_TABLES.find((t) => t.table === "outbox")!;
    const check = serviceWritePredicate(outbox);
    expect(check).toContain("connector-inbound");
    expect(check).toContain("event = 'longbox.platform.privacy_request_received'");
    expect(check).toContain("shop_id IS NOT NULL");
    expect(outbox.write?.scopes).toEqual(["connector-inbound"]);
  });

  it("E03-D21: the admission's write check names the ROW, and the scope may not UPDATE", () => {
    const person = SERVICE_TABLES.find((t) => t.table === "app_user")!;
    expect(serviceWritePredicate(person)).toContain("status = 'active'");
    expect(serviceWritePredicate(person)).toContain("person-admission");
    const sql = buildRlsStatements(
      planRowLevelSecurity([{ name: "app_user", relkind: "r", hasShopId: false }])
    );
    // FOR INSERT and FOR SELECT, and no third command anywhere: an `ON CONFLICT
    // DO UPDATE` inside the scope would have been an UPDATE to row-level
    // security, which is why `upsertPerson` stopped using one.
    expect(sql).toContain(
      `CREATE POLICY ${SERVICE_WRITE_POLICY} ON app_user FOR INSERT ` +
        `WITH CHECK (${serviceWritePredicate(person)})`
    );
    expect(sql.some((s) => /POLICY .* ON app_user FOR UPDATE/.test(s))).toBe(false);
    expect(sql.some((s) => /POLICY .* ON app_user FOR DELETE/.test(s))).toBe(false);
  });

  it("E03-D21: `app_user` is POLICIED, on a live membership one join away", () => {
    // The parent-EXISTS idiom 056 §7 already names for `retention_hold_release`,
    // and it does NOT encode "a person belongs to one shop": every shop where the
    // person holds a live grant matches, and no other.
    const plan = planRowLevelSecurity([{ name: "app_user", relkind: "r", hasShopId: false }]);
    expect(plan.policied).toEqual(["app_user"]);
    expect(plan.exempt).toEqual([]);
    expect(POLICIED_WITHOUT_SHOP_ID).toEqual(["app_user", "shop"]);

    const predicate = tenantPredicate("app_user");
    expect(predicate).toContain("EXISTS (SELECT 1 FROM membership m");
    expect(predicate).toContain("m.app_user_id = app_user.id");
    expect(predicate).toContain("m.shop_id = current_shop_id()");
    // ⚠ **THE TRIPLE IS NOT SPELLED HERE, AND THAT IS THE CONSISTENCY LENS'S K2.**
    // Writing it out — even character-faithfully — would have made the BOUNDARY a
    // second definition of *works here* beside the five the application already
    // holds, and two definitions drift the first time either is corrected. There
    // is ONE (`membership_is_live`, `migrations/036`) and six callers.
    expect(predicate).toContain("membership_is_live(m.*)");
    expect(predicate).not.toContain("effective_from");
    expect(predicate).not.toContain("membership_revocation");
    // Both halves of the tenant policy carry it — a `USING` without a matching
    // `WITH CHECK` would read one shop's people and write anybody's.
    const sql = buildRlsStatements(plan);
    expect(sql).toContain(
      `CREATE POLICY ${TENANT_POLICY} ON app_user FOR ALL USING (${predicate}) WITH CHECK (${predicate})`
    );
  });

  it("E03-D21 / K2: ONE definition of a live grant, and SIX callers reach it", () => {
    // The consistency lens's K2. Not "the same text as the application's" — the
    // SAME DEFINITION, so a policy cannot admit somebody the application
    // excludes. Asserted by grep across the tree rather than by claim, in both
    // directions: every reader calls the function, and NO reader still carries a
    // hand-written copy of the triple.
    const migration = readFileSync(
      join(repoRoot, "migrations/036_person_tables_behind_a_membership_policy.sql"),
      "utf8"
    );
    expect(migration).toContain("CREATE OR REPLACE FUNCTION membership_is_live(m membership)");
    expect(migration).toContain("SELECT 1 FROM membership_revocation r WHERE r.membership_id = m.id");

    // ⚠ **IT WALKS `src/` RATHER THAN A LIST OF FILES.** A named list is the shape
    // this case exists to refuse: the claim is that NO reader spells the triple,
    // and a list can only say that of the readers somebody remembered. Walking
    // the tree makes a sixth hand copy — in a file nobody thought to name — a
    // failure rather than an omission.
    let calls = 0;
    for (const file of walk(join(repoRoot, "src"))) {
      const source = readFileSync(file, "utf8");
      calls += (source.match(/membership_is_live\(m\)/g) ?? []).length;
      // The half that keeps this honest: no reader may still spell the triple.
      expect(source, `${file} still spells effective_from`).not.toContain("m.effective_from <= now()");
      expect(source, `${file} still spells the revocation`).not.toContain(
        "SELECT 1 FROM membership_revocation r WHERE r.membership_id = m.id"
      );
    }
    // FIVE application call sites across the whole of `src/` (four in
    // `memberships.ts`, one roster), plus the policy in `TENANT_PREDICATES`, is
    // six readers of one definition. EXACT, never a ceiling: a new caller is a
    // new place the predicate is relied on and belongs in this number.
    expect(calls).toBe(5);
    expect(tenantPredicate("app_user")).toContain("membership_is_live(m.*)");
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
      "(longbox_service_scope() = ANY (ARRAY['code-redemption', 'my-shops']))"
    );
  });

  it("keeps the read predicate SELECT-shaped and the write predicate a conjunction", () => {
    const receipt = SERVICE_TABLES.find((t) => t.table === "connector_webhook_receipt")!;
    expect(serviceReadPredicate(receipt)).toBe(
      "(longbox_service_scope() = ANY (ARRAY['connector-inbound']))"
    );
    expect(serviceWritePredicate(receipt)).toContain(" AND (");
    // The row condition is declared already parenthesised as the deparser
    // renders it, so the conjunction adds its own pair and no more.
    expect(serviceWritePredicate(receipt)).toBe(
      "((longbox_service_scope() = ANY (ARRAY['connector-inbound'])) AND (topic IS NOT NULL))"
    );
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

  it("no longer exempts `shop` OR `app_user` — both are policied, by different predicates", () => {
    // `shop` moved out at E03-B04 (its tenant is its own `id`). `app_user` moved
    // out at E03-D21: 056 §11 R9 said the person table was bounded by CODE and not
    // by the database, and it is now bounded by both.
    expect(RLS_EXEMPTIONS.find((e) => e.table === "shop")).toBeUndefined();
    expect(RLS_EXEMPTIONS.find((e) => e.table === "app_user")).toBeUndefined();
  });

  it("E03-D21: every remaining person-scoped row stands on its OWN ground, not `app_user`'s", () => {
    // ⚠ THE POINT OF THIS CASE. Five rows used to say, in substance, "same reason
    // as `app_user`" — and that row has moved, so a reason pointing at it is a
    // reason nobody has checked. Each is re-decided in 000-docs/062 §4, and the
    // assertion is that none of them delegates.
    const person = [
      "user_credential",
      "user_authenticator",
      "user_authenticator_retirement",
      "recovery_code",
      "recovery_code_use",
      "app_user_origin",
      "app_user_origin_retirement",
    ];
    for (const table of person) {
      const row = RLS_EXEMPTIONS.find((e) => e.table === table);
      // The row must EXIST and its reason must be substantive — a row with an
      // empty reason would satisfy a "does not delegate" check vacuously.
      expect(row?.table, table).toBe(table);
      expect(row!.reason.length, table).toBeGreaterThan(80);
      expect(row!.reason, table).not.toContain("Same reason as `app_user`");
      expect(row!.reason, table).not.toContain("Person-scoped like `app_user`");
    }
    // The decisive one, which no other table shares: a policy over the statement
    // whose AFFECTED-ROW COUNT is the authorization (048 R19) turns a
    // misconfiguration into "this code was already used".
    const totp = RLS_EXEMPTIONS.find((e) => e.table === "user_authenticator")!;
    expect(totp.reason).toContain("AFFECTED-ROW COUNT IS THE AUTHORIZATION");
    // And the origin tables did NOT move for the opposite reason to `app_user`'s:
    // a per-tenant answer is exactly what 019 T35(c) must not get.
    expect(RLS_EXEMPTIONS.find((e) => e.table === "app_user_origin")!.reason).toContain("T35(c)");
  });
});
