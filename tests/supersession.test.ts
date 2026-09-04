// L3: the single `supersedes_id` writer (041 §3.3), against a fake `Tx`.
//
// WHAT THIS FILE PROVES AND WHAT IT DOES NOT. It proves the MESSAGE half of 041
// §3.3 reason 1 — that a refusal arrives as a typed `code` a route can act on
// rather than as a Postgres string — and the statement shape the helper emits.
// It does NOT prove the rule. R1, R2 and R4 are enforced by `migrations/008`,
// `003`'s partial unique index and `migrations/013`, and a fake connection cannot
// refuse anything; `tests/integration/supersession-forward-ordering.test.ts` is
// where the refusals are proved against a real cluster. The two layers are tested
// separately on purpose, the same way the role-separation tests split the
// privilege claim from the trigger claim: a service check treated as the
// guarantee is exactly the shape 041 §9 exists to prevent.
import { describe, expect, it } from "vitest";
import type { Tx } from "../src/db.js";
import {
  supersede,
  type SupersedableTable,
  SupersessionError,
  SUPERSEDABLE_TABLES,
} from "../src/services/supersession.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222221";
const PRIOR = "55555555-5555-4555-8555-555555555551";

interface Recorded {
  text: string;
  values: unknown[] | undefined;
}

/**
 * A fake `Tx` that answers by statement shape. `rows` is consulted in order: the
 * first entry whose `match` hits answers the call. Anything unmatched answers
 * empty, which is how "no predecessor" and "nothing supersedes it" are expressed.
 */
function fakeTx(rows: Array<{ match: RegExp; rows: unknown[] }>): { tx: Tx; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const tx = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: rows.find((r) => r.match.test(text))?.rows ?? [] };
    },
  };
  return { tx: tx as unknown as Tx, calls };
}

const priorRow = (over: Partial<Record<string, unknown>> = {}) => ({
  match: /SELECT id, shop_id, scan_session_id, session_seq FROM/,
  rows: [{ id: PRIOR, shop_id: SHOP, scan_session_id: SESSION, session_seq: "3", ...over }],
});

const noSuccessor = { match: /WHERE supersedes_id = \$1 LIMIT 1/, rows: [] };
const seqRead = { match: /coalesce\(max/, rows: [{ m: "4" }] };
const inserted = {
  match: /INSERT INTO/,
  rows: [{ id: "new-id", created_at: "2026-09-04T00:00:00Z", session_seq: "5" }],
};

const confirmationRow = {
  table: "human_confirmation" as const,
  values: {
    confirmedIssue: { title: "X" },
    source: "owner_review",
    confirmedBy: "owner",
    outcome: "correct",
  },
};

describe("supersede()", () => {
  it("names every table that carries supersedes_id, and only those", () => {
    // 003:84-86 added the column to exactly these three. The list is exported so
    // the integration lane can iterate it rather than restate it — the same
    // one-list-many-readers shape `src/db/appendOnlyTables.ts` exists for.
    expect([...SUPERSEDABLE_TABLES]).toEqual([
      "human_confirmation",
      "condition_assessment",
      "pricing_snapshot",
    ]);
  });

  it("reads the predecessor, assigns a session_seq and inserts the successor naming it", async () => {
    const { tx, calls } = fakeTx([priorRow(), noSuccessor, seqRead, inserted]);
    const row = await supersede(tx, {
      shopId: SHOP,
      sessionId: SESSION,
      priorId: PRIOR,
      row: confirmationRow,
    });

    expect(row.id).toBe("new-id");
    // Order is the contract: predecessor, R2 check, counter, insert. The counter
    // is assigned LAST before the write because it must be the highest in the
    // session at the moment of the insert (041 §5.3).
    expect(calls.map((c) => c.text.trim().slice(0, 12))).toEqual([
      "SELECT id, s",
      "SELECT id FR",
      "SELECT coale",
      "INSERT INTO ",
    ]);
    const insert = calls[3]!;
    expect(insert.text).toContain("supersedes_id");
    // …$7 session_seq, $8 supersedes_id — the predecessor's id, not the caller's.
    expect(insert.values?.[7]).toBe(PRIOR);
    expect(insert.values?.[6]).toBe(5); // max(4) + 1
    expect(insert.values?.[0]).toBe(SESSION);
    expect(insert.values?.[1]).toBe(SHOP);
  });

  it("refuses when the named predecessor does not exist", async () => {
    const { tx } = fakeTx([]);
    await expect(
      supersede(tx, { shopId: SHOP, sessionId: SESSION, priorId: PRIOR, row: confirmationRow })
    ).rejects.toMatchObject({ code: "prior-not-found", table: "human_confirmation", priorId: PRIOR });
  });

  // R1 — 019 T24 is non-waivable, and the message must not confirm that a row
  // exists in another tenant. The typed `code` is what a route maps to a 404.
  it("refuses a predecessor in another shop, without naming that shop", async () => {
    const { tx } = fakeTx([priorRow({ shop_id: "99999999-9999-4999-8999-999999999999" }), noSuccessor]);
    const err = await supersede(tx, {
      shopId: SHOP,
      sessionId: SESSION,
      priorId: PRIOR,
      row: confirmationRow,
    }).then(
      () => undefined,
      (e: unknown) => e as SupersessionError
    );
    expect(err).toBeInstanceOf(SupersessionError);
    expect(err!.code).toBe("prior-out-of-scope");
    expect(err!.message).not.toContain("99999999");
  });

  it("refuses a predecessor in another session of the same shop", async () => {
    const { tx } = fakeTx([priorRow({ scan_session_id: "22222222-2222-4222-8222-222222222299" })]);
    await expect(
      supersede(tx, { shopId: SHOP, sessionId: SESSION, priorId: PRIOR, row: confirmationRow })
    ).rejects.toMatchObject({ code: "prior-out-of-scope" });
  });

  // R2 — this is the refusal 040 A9 turns into "here is the answer that won", so
  // the winning row's id has to survive into the message.
  it("refuses a predecessor something already supersedes, and names the winner", async () => {
    const { tx } = fakeTx([
      priorRow(),
      { match: /WHERE supersedes_id = \$1 LIMIT 1/, rows: [{ id: "winner-id" }] },
    ]);
    const err = await supersede(tx, {
      shopId: SHOP,
      sessionId: SESSION,
      priorId: PRIOR,
      row: confirmationRow,
    }).then(
      () => undefined,
      (e: unknown) => e as SupersessionError
    );
    expect(err!.code).toBe("prior-already-superseded");
    expect(err!.message).toContain("winner-id");
  });

  it("does not reach the counter or the insert once it has refused", async () => {
    const { tx, calls } = fakeTx([]);
    await supersede(tx, { shopId: SHOP, sessionId: SESSION, priorId: PRIOR, row: confirmationRow }).catch(
      () => undefined
    );
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => /INSERT INTO/.test(c.text))).toBe(false);
  });

  // The union is the point of the typed helper: each table's INSERT names its own
  // columns, in its own order, and `supersedes_id` is always last.
  it.each([
    [
      "condition_assessment",
      {
        table: "condition_assessment" as const,
        values: { gradeRangeLow: "VG", gradeRangeHigh: "FN", defects: ["spine_ticks"], notes: null },
      },
      8,
    ],
    [
      "pricing_snapshot",
      {
        table: "pricing_snapshot" as const,
        values: {
          source: "pricecharting",
          query: "X #1",
          comps: [],
          suggestedCents: 599,
          overrideCents: null,
          policyId: null,
        },
      },
      10,
    ],
  ])("writes %s with its own column list", async (table, row, argc) => {
    const { tx, calls } = fakeTx([priorRow(), noSuccessor, seqRead, inserted]);
    await supersede(tx, { shopId: SHOP, sessionId: SESSION, priorId: PRIOR, row });
    const insert = calls.find((c) => /INSERT INTO/.test(c.text))!;
    expect(insert.text).toContain(`INSERT INTO ${table as SupersedableTable}`);
    expect(insert.values).toHaveLength(argc);
    expect(insert.values?.[argc - 1]).toBe(PRIOR);
    expect(insert.values?.[argc - 2]).toBe(5);
  });

  it("sends jsonb payloads as strings, not as objects", async () => {
    const { tx, calls } = fakeTx([priorRow(), noSuccessor, seqRead, inserted]);
    await supersede(tx, { shopId: SHOP, sessionId: SESSION, priorId: PRIOR, row: confirmationRow });
    const insert = calls.find((c) => /INSERT INTO/.test(c.text))!;
    expect(insert.values?.[2]).toBe('{"title":"X"}');
  });

  // A legacy predecessor written before `007` has no `session_seq`. The helper
  // does not care — R4's trigger is where that case is decided (`013` clause 4),
  // and duplicating the judgement here would be a second rule to keep in step.
  it("supersedes a pre-envelope row with no session_seq", async () => {
    const { tx, calls } = fakeTx([priorRow({ session_seq: null }), noSuccessor, seqRead, inserted]);
    await expect(
      supersede(tx, { shopId: SHOP, sessionId: SESSION, priorId: PRIOR, row: confirmationRow })
    ).resolves.toMatchObject({ id: "new-id" });
    expect(calls.some((c) => /INSERT INTO/.test(c.text))).toBe(true);
  });
});
