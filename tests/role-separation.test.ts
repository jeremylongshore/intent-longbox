// L3: the boot assertion refuses to serve on an over-privileged connection (E02-D06).
//
// The DB-backed proof that the app role genuinely cannot disable a trigger is
// tests/integration/role-separation.test.ts. These are the cases a real Postgres
// makes awkward to produce on demand — a superuser connection, and a role that
// owns some of the append-only tables but not all of them.
import { describe, expect, it } from "vitest";
import {
  assertRoleSeparationOrThrow,
  checkRoleSeparation,
  describeRoleSeparationFailure,
} from "../src/services/roleSeparation.js";

function fakePool(role: string, isSuperuser: boolean, ownedTables: string[]) {
  return {
    query: async (text: string) => {
      if (text.includes("current_user AS role")) {
        return { rows: [{ role, is_superuser: isSuperuser }] };
      }
      return { rows: ownedTables.map((table_name) => ({ table_name })) };
    },
  };
}

const silent = { error: () => undefined, info: () => undefined };

describe("checkRoleSeparation", () => {
  it("passes for a non-superuser that owns nothing", async () => {
    const result = await checkRoleSeparation(fakePool("longbox_app", false, []));
    expect(result).toEqual({
      ok: true,
      role: "longbox_app",
      isSuperuser: false,
      ownedAppendOnlyTables: [],
    });
  });

  it("fails for a superuser even when it owns nothing", async () => {
    // 041 §1 E15: a superuser may SET session_replication_role and bypass even
    // an ENABLE ALWAYS trigger, so owning no table is not sufficient.
    const result = await checkRoleSeparation(fakePool("postgres", true, []));
    expect(result.ok).toBe(false);
    expect(describeRoleSeparationFailure(result)).toContain("SUPERUSER");
  });

  it("fails when the role owns even ONE declared append-only table", async () => {
    const result = await checkRoleSeparation(fakePool("longbox_app", false, ["cost_log"]));
    expect(result.ok).toBe(false);
    expect(result.ownedAppendOnlyTables).toEqual(["cost_log"]);
  });

  it("ignores ownership of tables outside the declared append-only set", async () => {
    // Owning `shop` is not a locked-decision-4 problem: it carries no trigger to
    // disable. Flagging it would make the check noisy and, worse, make a real
    // failure easy to wave through.
    const result = await checkRoleSeparation(fakePool("longbox_app", false, ["shop", "schema_migrations"]));
    expect(result.ok).toBe(true);
  });

  it("reports the owned tables sorted, so the message is stable", async () => {
    const result = await checkRoleSeparation(
      fakePool("owner", false, ["shopify_draft", "cost_log", "candidate_set"])
    );
    expect(result.ownedAppendOnlyTables).toEqual(["candidate_set", "cost_log", "shopify_draft"]);
  });

  it("throws when the identity query returns no row", async () => {
    await expect(checkRoleSeparation({ query: async () => ({ rows: [] }) })).rejects.toThrow(
      /returned no row/
    );
  });
});

describe("assertRoleSeparationOrThrow", () => {
  it("resolves on a least-privileged connection", async () => {
    await expect(
      assertRoleSeparationOrThrow(fakePool("longbox_app", false, []), silent)
    ).resolves.toBeUndefined();
  });

  it("throws, naming both the defect and the fix, when the role owns a table", async () => {
    await expect(
      assertRoleSeparationOrThrow(fakePool("longbox_migrate", false, ["cost_log"]), silent)
    ).rejects.toThrow(/refusing to serve.*owns 1 append-only table\(s\): cost_log.*MIGRATE_DATABASE_URL/s);
  });

  it("logs the failure at error level before throwing", async () => {
    const logged: string[] = [];
    await expect(
      assertRoleSeparationOrThrow(fakePool("postgres", true, []), {
        error: (m) => logged.push(m),
        info: () => undefined,
      })
    ).rejects.toThrow();
    expect(logged[0]).toMatch(/role-separation check FAILED at boot/);
  });
});
