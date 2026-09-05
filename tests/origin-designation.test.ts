// L1: the origin module's REFUSALS and its statement shapes, with no database
// (E03-D14; the invariant review's WARN2).
//
// Bead: longbox-e5b.3.24 (alias E03-D14). Docs: 000-docs/058 §3(b), §3(d), §5.
//
// **WHY A UNIT SUITE EXISTS AT ALL BESIDE THE LANE.** Two reasons, and the second
// is the one that filed it.
//
//   1. **A refusal that happens BEFORE any statement cannot be asserted by a row
//      count.** `designateOrigin` refuses a blank reason and a future start with
//      nothing written — and "nothing was written" is a weaker claim than "no
//      query was issued", which only a stub can see. The stub records every call,
//      so the assertion is the absence of a call rather than the absence of a row.
//   2. **Coverage margin** (WARN2): the unit lane's floor is 80 on
//      `src/services` and it sat at 80.09, with this file 8.95 points under. A
//      margin of nine hundredths is a floor the NEXT service PR trips for reasons
//      that have nothing to do with it.
//
// The DATABASE-side properties — the forced timestamp, the refused future start
// at the trigger, the atomic retirement — are in
// `tests/integration/break-glass-origin.test.ts`, where they belong: a stub
// cannot prove what Postgres refuses.
import { describe, expect, it } from "vitest";
import {
  LONGBOX_STAFF_ORIGIN,
  ORIGIN_PREDICATE_FUNCTION,
  OriginDesignationRefused,
  designateOrigin,
  isLongboxOrigin,
  liveOriginDesignationCount,
  originDesignationsOf,
  retireAllOriginsOf,
  retireOrigin,
} from "../src/services/auth/index.js";

interface Call {
  sql: string;
  values: unknown[];
}

/** A `Queryable` that records what it was asked and answers what the case wants. */
function stub(rows: unknown[] = []): { db: { query: typeof q }; calls: Call[] } {
  const calls: Call[] = [];
  async function q(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> {
    calls.push({ sql, values: values ?? [] });
    return Promise.resolve({ rows });
  }
  return { db: { query: q }, calls };
}

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  app_user_id: "22222222-2222-4222-8222-222222222222",
  origin: LONGBOX_STAFF_ORIGIN,
  reason: "support rota",
  effective_from: "2026-09-01T00:00:00.000Z",
  retired_at: null,
};

describe("designateOrigin — the refusals that must leave no statement (058 §3(b))", () => {
  it("refuses a blank reason BEFORE issuing any query", async () => {
    const { db, calls } = stub([ROW]);
    await expect(designateOrigin(db, { appUserId: ROW.app_user_id, reason: "   " })).rejects.toBeInstanceOf(
      OriginDesignationRefused
    );
    // The assertion the lane cannot make: not "no row landed" but "nothing was
    // asked". A designation must say why — it is the row 022 P3 lets an employee
    // read back — and a refusal that reached the database would still have
    // consumed a round trip and a sequence.
    expect(calls).toEqual([]);
  });

  it("refuses a FUTURE start, before any query, and says why in the message", async () => {
    const { db, calls } = stub([ROW]);
    await expect(
      designateOrigin(db, {
        appUserId: ROW.app_user_id,
        reason: "starts tomorrow",
        effectiveFrom: new Date(Date.now() + 86_400_000),
      })
    ).rejects.toThrow(/starts in the future/);
    expect(calls).toEqual([]);
    // ⚠ This check ALSO exists in the database since `migrations/033` (the
    // cannon's F1), and the duplication is deliberate rather than accidental: a
    // CHECK cannot express it (`now()` is not immutable), so the trigger is the
    // enforcement and this is the early, legible refusal. Neither is redundant —
    // the trigger catches the writer that never calls this function.
  });

  it("accepts a BACK-dated start, because widening the population is the allowed direction", async () => {
    const { db, calls } = stub([ROW]);
    const at = new Date(Date.now() - 86_400_000);
    await designateOrigin(db, { appUserId: ROW.app_user_id, reason: "joined last week", effectiveFrom: at });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain("INSERT INTO app_user_origin");
    // COALESCE, so an omitted start defaults to the database's now() rather than
    // to a value this process computed.
    expect(calls[0]!.sql).toContain("COALESCE($5::timestamptz, now())");
    expect(calls[0]!.values[1]).toBe(LONGBOX_STAFF_ORIGIN);
    expect(calls[0]!.values[4]).toBe(at);
  });

  it("trims the reason and passes a null actor through rather than an empty string", async () => {
    const { db, calls } = stub([ROW]);
    await designateOrigin(db, { appUserId: ROW.app_user_id, reason: "  support rota  " });
    expect(calls[0]!.values[2]).toBe("support rota");
    expect(calls[0]!.values[3]).toBeNull();
    expect(calls[0]!.values[4]).toBeNull();
  });
});

describe("the retirement writers", () => {
  it("refuse a blank reason, both of them, before any query", async () => {
    const one = stub();
    await expect(retireOrigin(one.db, { originId: ROW.id, reason: "" })).rejects.toBeInstanceOf(
      OriginDesignationRefused
    );
    expect(one.calls).toEqual([]);

    const many = stub();
    await expect(
      retireAllOriginsOf(many.db, { appUserId: ROW.app_user_id, reason: "\t\n " })
    ).rejects.toBeInstanceOf(OriginDesignationRefused);
    expect(many.calls).toEqual([]);
  });

  it("retire EVERY designation in ONE statement, idempotent by the UNIQUE (NOTE4, H1)", async () => {
    const { db, calls } = stub([{ id: "a" }, { id: "b" }]);
    const n = await retireAllOriginsOf(db, {
      appUserId: ROW.app_user_id,
      reason: "left the company",
      retiredBy: ROW.app_user_id,
    });
    expect(n).toBe(2);
    expect(calls, "a loop would issue one statement per designation").toHaveLength(1);
    // Idempotence comes from the constraint, not from a predicate racing it…
    expect(calls[0]!.sql).toContain("ON CONFLICT (origin_id) DO NOTHING");
    // …and the count is what actually landed, so a receipt cannot overstate.
    expect(calls[0]!.sql).toContain("RETURNING id");
    // H1's banned shape must not appear here: the liveness logic has one home.
    expect(calls[0]!.sql).not.toMatch(/NOT\s+EXISTS/i);
    // It offers NO timestamp (058 §3(b)): an ending the writer could date is the
    // one motion this design refuses to make expressible.
    expect(calls[0]!.sql).not.toContain("created_at");
  });
});

describe("the readers name the ONE definition of the predicate (058 §3(d))", () => {
  it("`isLongboxOrigin` calls the SQL function with a mandatory as-of", async () => {
    const { db, calls } = stub([{ is_origin: true }]);
    const at = new Date("2026-09-01T12:00:00.000Z");
    await expect(isLongboxOrigin(db, ROW.app_user_id, at)).resolves.toBe(true);
    expect(calls[0]!.sql).toContain(`${ORIGIN_PREDICATE_FUNCTION}($1,$2)`);
    expect(calls[0]!.values).toEqual([ROW.app_user_id, at]);
  });

  it("`liveOriginDesignationCount` CALLS the predicate rather than restating it (H1)", async () => {
    const { db, calls } = stub([{ n: 3 }]);
    const at = new Date("2026-09-01T12:00:00.000Z");
    await expect(liveOriginDesignationCount(db, at)).resolves.toBe(3);
    expect(calls[0]!.sql).toContain(`${ORIGIN_PREDICATE_FUNCTION}(o.app_user_id, $2)`);
    // The finding this replaced: a hand-written copy of the liveness logic, one
    // function away from the definition §3(d) calls the only one.
    expect(calls[0]!.sql).not.toMatch(/NOT\s+EXISTS/i);
  });

  it("`originDesignationsOf` maps the row shape and reports an ending as a Date or null", async () => {
    const { db } = stub([ROW, { ...ROW, id: "x", retired_at: "2026-09-02T00:00:00.000Z" }]);
    const held = await originDesignationsOf(db, ROW.app_user_id);
    expect(held).toHaveLength(2);
    expect(held[0]!.retiredAt).toBeNull();
    expect(held[0]!.effectiveFrom).toBeInstanceOf(Date);
    expect(held[1]!.retiredAt).toBeInstanceOf(Date);
  });
});
