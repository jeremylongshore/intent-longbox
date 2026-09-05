// L2: the tenant context, as a value — no database, exact bytes.
//
// E03-B04. `migrations/029` is the enforcement and the integration lane proves it
// against a real cluster; this file is about the OTHER half, which a database
// cannot check for us: that the statement opening every transaction is the one we
// think it is, that the uuid it interpolates is shape-checked before it gets
// there, and that the set of cross-tenant scopes is CLOSED.
//
// Why the exact bytes matter enough to assert: the context travels WITH `BEGIN`,
// in one string, in one round trip. That is what makes it precede the
// `request_idempotency` INSERT by construction (042 §5.3(b)) rather than by a
// convention somebody could reorder — so the shape of the string is a property of
// the lock order, not a formatting choice.
import { describe, expect, it } from "vitest";
import {
  SERVICE_SCOPES,
  SERVICE_SETTING,
  SHOP_ID_SETTING,
  assertShopId,
  beginWithContext,
  describeContext,
  isServiceScope,
} from "../src/db/tenantContext.js";

const SHOP = "11111111-2222-3333-4444-555555555555";

describe("the statement that opens a transaction", () => {
  it("sets the tenant in the SAME statement as BEGIN, so nothing can precede it", () => {
    const sql = beginWithContext({ shopId: SHOP }, false);
    expect(sql.startsWith("BEGIN;")).toBe(true);
    expect(sql).toContain(`set_config('${SHOP_ID_SETTING}', '${SHOP}', true)`);
  });

  it("writes BOTH settings on every context, so no transaction inherits half of one", () => {
    // `is_local` already reverts them at COMMIT — but "already reverts" is a
    // property of a code path that ran, and this is a property of the statement.
    const tenant = beginWithContext({ shopId: SHOP }, false);
    expect(tenant).toContain(`set_config('${SERVICE_SETTING}', '', true)`);
    const service = beginWithContext({ service: "my-shops" }, false);
    expect(service).toContain(`set_config('${SHOP_ID_SETTING}', '', true)`);
    expect(service).toContain(`set_config('${SERVICE_SETTING}', 'my-shops', true)`);
  });

  it("passes `true` as `is_local` — a session-level set would outlive the request", () => {
    // 034 §3.2's rule and 046 K-5's reproduced failure: a `SET` on a pooled
    // connection leaks into whoever borrows it next. Every `set_config` here ends
    // in `, true)`, and this asserts it rather than trusting the reading.
    for (const sql of [
      beginWithContext({ shopId: SHOP }, false),
      beginWithContext({ service: "my-shops" }, true),
    ]) {
      const calls = sql.match(/set_config\([^)]*\)/g) ?? [];
      expect(calls).toHaveLength(2);
      for (const call of calls) expect(call.endsWith(", true)")).toBe(true);
    }
  });

  it("keeps the isolation level, because SERIALIZABLE is part of the BEGIN", () => {
    expect(beginWithContext({ shopId: SHOP }, true).startsWith("BEGIN ISOLATION LEVEL SERIALIZABLE;")).toBe(
      true
    );
    expect(beginWithContext(undefined, true)).toBe("BEGIN ISOLATION LEVEL SERIALIZABLE");
  });

  it("emits a bare BEGIN when there is no context — an omission is a loud zero, not a default", () => {
    // The migrate-role callers (the CLIs, the fixtures, the runner) own the schema
    // and bypass the policies; for anyone else this transaction sees nothing.
    expect(beginWithContext(undefined, false)).toBe("BEGIN");
  });
});

describe("the uuid check, which is the whole of the injection defence", () => {
  it("accepts the canonical form in either case", () => {
    expect(assertShopId(SHOP)).toBe(SHOP);
    expect(assertShopId(SHOP.toUpperCase())).toBe(SHOP.toUpperCase());
  });

  it("refuses anything else, and refuses it BEFORE a connection is checked out", () => {
    for (const bad of [
      "",
      "not-a-uuid",
      `${SHOP}'`,
      `' OR '1'='1`,
      `${SHOP}; DROP TABLE shop`,
      " 11111111-2222-3333-4444-555555555555 ",
      "11111111-2222-3333-4444-55555555555",
    ]) {
      expect(() => assertShopId(bad)).toThrow(/not a uuid/);
      expect(() => beginWithContext({ shopId: bad }, false)).toThrow(/not a uuid/);
    }
  });

  it("a refused value never reaches the statement", () => {
    // The point of checking rather than escaping: there is no path where a
    // rejected shape is quoted into SQL and then relied on to be inert.
    expect(() => beginWithContext({ shopId: "x'; SET LOCAL longbox.shop_id = 'y" }, false)).toThrow();
  });
});

describe("the service scopes are a CLOSED set with a reason each", () => {
  it("every member carries a reason, and no reason is a placeholder", () => {
    expect(SERVICE_SCOPES.length).toBeGreaterThan(0);
    for (const { scope, reason } of SERVICE_SCOPES) {
      expect(scope).toMatch(/^[a-z-]+$/);
      // Long enough to be an argument rather than a label. A scope is the one
      // hole in the tenant boundary; "internal" is not a reason.
      expect(reason.length).toBeGreaterThan(120);
    }
  });

  it("names each scope exactly once", () => {
    const names = SERVICE_SCOPES.map((s) => s.scope);
    expect(new Set(names).size).toBe(names.length);
  });

  it("recognises its own members and nothing else", () => {
    for (const { scope } of SERVICE_SCOPES) expect(isServiceScope(scope)).toBe(true);
    for (const other of ["", "admin", "service", "all", "session_resolution"]) {
      expect(isServiceScope(other)).toBe(false);
    }
  });

  it("labels a context for the retry log without leaking the tenant into it", () => {
    // The label reaches a log line; a shop id in it would be a tenant identifier
    // in an operational log nobody scoped.
    expect(describeContext({ shopId: SHOP })).toBe("shop");
    expect(describeContext({ shopId: SHOP })).not.toContain(SHOP);
    expect(describeContext({ service: "my-shops" })).toBe("service:my-shops");
    expect(describeContext(undefined)).toBe("no-tenant");
  });
});
