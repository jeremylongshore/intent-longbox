// L3 unit: the audited accessor — what each read projects, what it records, and
// the one thing it can never record.
//
// Bead: longbox-e5b.3.27 (alias E03-D17). Docs: 000-docs/060 §3–§6; 019 T35(b)
// (NON-WAIVABLE); 034 §3.3; 048 §3.5, §4.3, §7.1, §12.4 row 6; 054 §8; 022 P3.
//
// The DATABASE-backed properties — the append-only trigger, the tenant policy,
// the insert-only grant, one fact per migrated caller — are proved against a real
// Postgres in `tests/integration/identity-access.test.ts`, because nothing else
// can prove them. What this suite proves is the other half: **which statement
// each accessor issues, with which parameters, and what is absent from them.**
import { describe, expect, it } from "vitest";
import type { Queryable, Tx } from "../src/db.js";
import { ROUTES } from "../src/contracts/v1/routes.js";
import {
  DECLARED_ACCESSORS,
  DECLARED_ACCESSOR_KEYS,
  IDENTITY_KEY_KINDS,
  IDENTITY_PURPOSES,
  PURPOSE_PROSE,
  accessorKey,
  isDeclaredAccess,
  recordIdentityAccess,
  httpAccessor,
  resolvePersonByKey,
  resolvePersonForAuthenticatorEnrollment,
  resolveShopRoster,
  UndeclaredAccessorError,
  type IdentityAccessContext,
} from "../src/identity/index.js";

interface Call {
  text: string;
  values: unknown[] | undefined;
}

function fakeDb(answer: (text: string) => unknown[] = () => []): {
  db: Tx & Queryable;
  calls: Call[];
} {
  const calls: Call[] = [];
  const db = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: answer(text) };
    },
  };
  return { db: db as unknown as Tx & Queryable, calls };
}

const SHOP = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";

function context(over: Partial<IdentityAccessContext> = {}): IdentityAccessContext {
  return {
    method: "POST",
    path: "/api/v1/operator-sessions",
    purpose: "session_display_name",
    shopId: SHOP,
    ...over,
  };
}

describe("the closed vocabulary (000-docs/060 §4, 034 §3.3)", () => {
  it("declares four purposes, each with prose and each with a live accessor", () => {
    // A purpose with no caller is an affordance nobody asked for, and 022 P3's
    // CFO constraint — never build a per-operator surface and then restrict it —
    // reads on a vocabulary too.
    expect([...IDENTITY_PURPOSES]).toEqual([
      "session_display_name",
      "operator_picker_roster",
      "invitation_addressee",
      "authenticator_enrollment",
    ]);
    for (const purpose of IDENTITY_PURPOSES) {
      expect(PURPOSE_PROSE[purpose].length, purpose).toBeGreaterThan(80);
      const callers = DECLARED_ACCESSORS.filter((a) => (a.purposes as readonly string[]).includes(purpose));
      expect(callers.length, purpose).toBeGreaterThan(0);
    }
  });

  it("does NOT declare break_glass_reconciliation — E11-B09 adds it with its reader", () => {
    // The bead that gives break-glass its read path adds the purpose in the
    // migration that adds the reader. Declaring it here would ship the vocabulary
    // of a surface nobody has reviewed.
    expect([...IDENTITY_PURPOSES] as string[]).not.toContain("break_glass_reconciliation");
  });

  it("names every path 034 §3.3 and 054 §8 do — including the two with no caller", () => {
    // 034 §3.3 names THREE COLUMNS and A5 puts the two legacy strings INSIDE the
    // contract; 054 §8 adds `membership_id` and `session_chain_id`. At v1.0.0
    // this enum held neither legacy string, so the FIRST reader of a pre-G2
    // attribution value could not have written its fact at all — the CHECK would
    // have refused it, and the author's cheapest fix would have been to skip the
    // accessor (the gate audit's F7). A gate whose correct use is impossible is a
    // gate somebody routes around.
    expect([...IDENTITY_KEY_KINDS].sort()).toEqual([
      "app_user_id",
      "confirmed_by",
      "created_by",
      "membership_id",
      "operator_id",
      "session_chain_id",
      "shop_roster",
    ]);
  });

  it("recognises a declared (accessor, purpose) pair and refuses everything else", () => {
    expect(isDeclaredAccess("GET", "/api/v1/operators", "operator_picker_roster")).toBe(true);
    // A declared accessor citing a purpose it was not declared for — the
    // copy-paste failure the audit's finding (b) exists for.
    expect(isDeclaredAccess("GET", "/api/v1/operators", "invitation_addressee")).toBe(false);
    // An accessor nobody declared — finding (a).
    expect(isDeclaredAccess("GET", "/api/v1/leaderboard", "operator_picker_roster")).toBe(false);
    expect(DECLARED_ACCESSOR_KEYS).toContain(accessorKey("CLI", "scripts/enroll-authenticator.ts"));
  });
});

describe("the accessor pair is OBSERVED, not declared (000-docs/060 §4.4, security F3)", () => {
  it("accepts a declared triple and normalises the method", () => {
    expect(
      httpAccessor({ method: "get", path: "/api/v1/operators" }, "operator_picker_roster", SHOP)
    ).toEqual({
      method: "GET",
      path: "/api/v1/operators",
      purpose: "operator_picker_roster",
      shopId: SHOP,
    });
  });

  it("REFUSES a pair nobody declared — the request fails rather than writing a plausible row", () => {
    // The failure v1.0.0 could not have. Both halves of the pair were a literal
    // in the service, so a route could record any pair at all, and the audit's
    // two findings could only ever have caught an author who declared honestly.
    expect(() =>
      httpAccessor({ method: "GET", path: "/api/v1/leaderboard" }, "operator_picker_roster", SHOP)
    ).toThrow(UndeclaredAccessorError);
  });

  it("REFUSES a declared accessor citing a purpose it was not declared for", () => {
    // The copy-paste failure, refused at the door instead of found in an audit.
    expect(() =>
      httpAccessor({ method: "GET", path: "/api/v1/operators" }, "invitation_addressee", SHOP)
    ).toThrow(UndeclaredAccessorError);
  });

  it("REFUSES an unrouted request rather than resolving under a blank template", () => {
    expect(() => httpAccessor({ method: "GET", path: "<unrouted>" }, "operator_picker_roster", SHOP)).toThrow(
      UndeclaredAccessorError
    );
  });

  it("every declared HTTP accessor names a route this application actually registers", () => {
    // The BUILD-TIME half of F3: the pair is observed at runtime, and the
    // DECLARATION is checked against the v1 route table here — so a renamed route
    // is a red build rather than a 500 on a counter phone. CLI rows are out of
    // scope by construction: a script path is not a route.
    const registered = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    for (const row of DECLARED_ACCESSORS) {
      if (row.method === "CLI") continue;
      expect([...registered], `${row.method} ${row.path}`).toContain(`${row.method} ${row.path}`);
    }
  });

  it("every declared accessor states why that surface needs a person's name", () => {
    for (const row of DECLARED_ACCESSORS) expect(row.reason.length, row.path).toBeGreaterThan(80);
  });
});

describe("the access fact (000-docs/060 §5, 022 P3)", () => {
  it("carries the purpose, the accessor, the KIND of key and a count — and no subject", () => {
    const { db, calls } = fakeDb();
    return recordIdentityAccess(db, context(), "app_user_id", 1).then(() => {
      const sql = calls[0]!.text;
      expect(sql).toContain("INSERT INTO identity_access");
      // The column list is the argument: there is no `app_user_id` column, no
      // `email`, no `display_name`. A caller could not record who it looked up
      // even by mistake.
      expect(sql).not.toMatch(/\bapp_user_id\b/);
      expect(sql).not.toMatch(/\bdisplay_name\b/);
      expect(sql).not.toMatch(/\bemail\b/);
      expect(calls[0]!.values).toContain("session_display_name");
      expect(calls[0]!.values).toContain("app_user_id"); // the KIND, as a value
      expect(calls[0]!.values).toContain(SHOP);
    });
  });

  it("takes the accessor from the CALLER and never guesses it", async () => {
    // `authorization_decision`'s reason one table over: a module that guessed its
    // own caller would record the accessor it was written for rather than the one
    // that reached it.
    const { db, calls } = fakeDb();
    await recordIdentityAccess(
      db,
      context({ method: "CLI", path: "scripts/x.ts", shopId: null }),
      "app_user_id",
      0
    );
    expect(calls[0]!.values).toContain("CLI");
    expect(calls[0]!.values).toContain("scripts/x.ts");
    expect(calls[0]!.values).toContain(null);
  });
});

describe("resolvePersonByKey (048 §3.5)", () => {
  it("projects two columns and appends exactly one fact", async () => {
    const { db, calls } = fakeDb((t) => (t.includes("app_user") ? [{ id: PERSON, display_name: "A" }] : []));
    const person = await resolvePersonByKey(db, context(), PERSON);
    expect(person?.display_name).toBe("A");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.text).toContain("SELECT u.id, u.display_name FROM app_user u");
    expect(calls[0]!.text).not.toMatch(/SELECT\s+\*/i);
    expect(calls[1]!.text).toContain("INSERT INTO identity_access");
  });

  it("records the access even when nobody is found", async () => {
    // A rule that only recorded successes would leave a PROBING accessor
    // invisible, which is the one an audit most wants to see.
    const { db, calls } = fakeDb(() => []);
    expect(await resolvePersonByKey(db, context(), PERSON)).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.values).toContain(0);
  });

  it("returns undefined rather than throwing — the refusal is the caller's to choose", async () => {
    // 048 §9.3's constant-answer rule is the caller's to keep: the operator route
    // answers SESSION_REQUIRED and the invitation route INVITATION_INVALID, and a
    // data module that picked one would be choosing somebody else's refusal code.
    const { db } = fakeDb(() => []);
    await expect(resolvePersonByKey(db, context(), PERSON)).resolves.toBeUndefined();
  });
});

describe("the invitation purpose on the same accessor (048 §7.1)", () => {
  it("is a SEPARATE door with its own purpose, not a parameter on the session one", async () => {
    // One function taking the purpose as an argument would let a caller cite
    // `session_display_name` for an invitation read by copying a line — and
    // `isDeclaredAccess` could then say nothing about which surface may cite what.
    const { db, calls } = fakeDb((t) => (t.includes("app_user") ? [{ id: PERSON, display_name: "A" }] : []));
    await resolvePersonByKey(
      db,
      context({ path: "/api/v1/invitations/redemptions", purpose: "invitation_addressee" }),
      PERSON
    );
    expect(calls[1]!.values).toContain("invitation_addressee");
    expect(isDeclaredAccess("POST", "/api/v1/invitations/redemptions", "invitation_addressee")).toBe(true);
  });
});

describe("resolveShopRoster (048 §3.5, I7)", () => {
  it("keeps the roster projection and the activity-independent sort, unchanged by the move", async () => {
    const { db, calls } = fakeDb((t) =>
      t.includes("membership") ? [{ id: PERSON, display_name: "A" }] : []
    );
    await resolveShopRoster(
      db,
      context({ method: "GET", path: "/api/v1/operators", purpose: "operator_picker_roster" }),
      SHOP
    );
    const sql = calls[0]!.text;
    expect(sql).toContain("SELECT DISTINCT u.id, u.display_name");
    expect(sql).toContain("ORDER BY u.display_name, u.id");
    // A roster is a list of who could be holding the phone; a leaderboard is a
    // list of what they did, and the difference is one sort order.
    expect(sql).not.toMatch(/count\(|created_at|last_/i);
    expect(sql).toContain("m.role <> 'support_break_glass'");
  });

  it("records ONE bulk access with the number of people it produced", async () => {
    const { db, calls } = fakeDb((t) =>
      t.includes("membership")
        ? [
            { id: "a", display_name: "A" },
            { id: "b", display_name: "B" },
            { id: "c", display_name: "C" },
          ]
        : []
    );
    await resolveShopRoster(
      db,
      context({ method: "GET", path: "/api/v1/operators", purpose: "operator_picker_roster" }),
      SHOP
    );
    expect(calls).toHaveLength(2);
    // `shop_roster`, not `app_user_id`: the key resolved is a SHOP, and a bulk
    // read recorded as a single-person lookup would be indistinguishable in the
    // audit from the commonest read in the system.
    expect(calls[1]!.values).toContain("shop_roster");
    expect(calls[1]!.values).toContain(3);
    // Nobody in the roster appears in the fact's parameters.
    expect(JSON.stringify(calls[1]!.values)).not.toContain('"a"');
  });
});

describe("resolvePersonForAuthenticatorEnrollment (048 §4.3)", () => {
  it("is the ONE accessor that projects an email, and it names no tenant", async () => {
    const { db, calls } = fakeDb((t) =>
      t.includes("app_user") ? [{ id: PERSON, email: "x@example.invalid", display_name: "A" }] : []
    );
    const person = await resolvePersonForAuthenticatorEnrollment(
      db,
      context({
        method: "CLI",
        path: "scripts/enroll-authenticator.ts",
        purpose: "authenticator_enrollment",
        shopId: null,
      }),
      PERSON
    );
    expect(person?.email).toBe("x@example.invalid");
    expect(calls[0]!.text).toContain("SELECT u.id, u.email, u.display_name");
    // A second factor belongs to a PERSON, who may hold memberships at more than
    // one shop (034 §2.6) — so the fact carries a NULL shop, which
    // `migrations/035`'s CHECK ties to `accessor_method = 'CLI'` and which the
    // tenant policy makes unwritable by the running server.
    expect(calls[1]!.values).toContain(null);
    expect(calls[1]!.values).toContain("CLI");
  });

  it("does not leak the email into the fact", async () => {
    const { db, calls } = fakeDb((t) =>
      t.includes("app_user") ? [{ id: PERSON, email: "x@example.invalid", display_name: "A" }] : []
    );
    await resolvePersonForAuthenticatorEnrollment(
      db,
      context({
        method: "CLI",
        path: "scripts/enroll-authenticator.ts",
        purpose: "authenticator_enrollment",
        shopId: null,
      }),
      PERSON
    );
    expect(JSON.stringify(calls[1]!.values)).not.toContain("example.invalid");
    expect(JSON.stringify(calls[1]!.values)).not.toContain(PERSON);
  });
});
