// L3: the causal comparison and the derived state (042 §6, 040 §3.2/§3.4).
//
// The rungs and the staleness rule are pure functions on purpose — the rule is
// three clauses and a reader should be able to see that it is not a query. The
// refusal's behaviour under the anchor lock, where two writers actually race, is
// `tests/integration/stale-world-view.test.ts`.
import { describe, expect, it } from "vitest";
import {
  againstFallback,
  assertWorldViewIsCurrent,
  deriveState,
  flagsOf,
  impliedRung,
  isStale,
  readWitnessFlags,
  readWitnessIds,
  WITNESS_RUNG,
  type TransitionRow,
  type WitnessFlags,
  type WitnessIds,
} from "../src/services/worldView.js";
import { fakePool } from "./fakes.js";
import type { Tx } from "../src/db.js";

const none: WitnessFlags = {
  captured: false,
  proposed: false,
  confirmed: false,
  conditioned: false,
  priced: false,
  drafted: false,
};

/** What the witness query returns: the CURRENT row's id per rung, or null. */
const noIds: WitnessIds = {
  captured: null,
  proposed: null,
  confirmed: null,
  conditioned: null,
  priced: null,
  drafted: null,
};

/** The witness statement, recognised by a column only it declares. */
const isWitnessQuery = (text: string): boolean => text.includes("AS captured");

const asTx = (pool: unknown): Tx => pool as Tx;

describe("the implied ladder (040 §3.2)", () => {
  it("puts llm_rerank on candidate_set's rung, because a re-rank refines a proposal", () => {
    // 040 §3.2 in as many words: "an `llm_rerank` row refines the band but does
    // not raise the rung — a barcode-only resolution is a proposal too".
    expect(WITNESS_RUNG.llm_rerank).toBe(WITNESS_RUNG.candidate_set);
  });

  it("reads the HIGHEST rung whose witness exists, not the newest thing that happened", () => {
    // The rungs are not a total order over time: a re-price after a draft is an
    // ordinary correction and must not push the session back to `priced`.
    expect(impliedRung({ ...none, captured: true, priced: true, drafted: true })).toBe(6);
    expect(impliedRung({ ...none, captured: true, proposed: true })).toBe(2);
    expect(impliedRung(none)).toBe(0);
  });
});

describe("isStale (042 §6.1)", () => {
  it("refuses a reference to a SUPERSEDED row, whatever its rung", () => {
    expect(isStale({ againstRung: 3, impliedRung: 3, rowIsCurrent: false })).toBe(true);
  });

  it("refuses a reference the session has moved PAST", () => {
    expect(isStale({ againstRung: 2, impliedRung: 3, rowIsCurrent: true })).toBe(true);
  });

  it("accepts a reference at or above the implied rung", () => {
    expect(isStale({ againstRung: 3, impliedRung: 3, rowIsCurrent: true })).toBe(false);
    // Above is the ORDINARY case, not an error: the actor holds a row this
    // transaction is about to count.
    expect(isStale({ againstRung: 5, impliedRung: 3, rowIsCurrent: true })).toBe(false);
  });
});

describe("deriveState (040 §3.4)", () => {
  const t = (kind: TransitionRow["kind"], rung: string | null = null): TransitionRow => ({
    id: `t-${kind}`,
    kind,
    reopened_to_rung: rung,
    created_at: "2026-09-04T00:00:00Z",
  });

  it("is `intake` for a session with no records at all", () => {
    expect(deriveState(none, [])).toBe("intake");
  });

  it("makes `voided` terminal WHATEVER else exists (clause 1, 040 I5)", () => {
    expect(deriveState({ ...none, drafted: true }, [t("voided")])).toBe("voided");
    // Order-independent by construction: it is the last row a session may ever
    // receive, so a later `resumed` cannot revive it.
    expect(deriveState({ ...none, drafted: true }, [t("voided"), t("resumed")])).toBe("voided");
  });

  it("reads `parked` from the newest transition and `implied` after a resume", () => {
    expect(deriveState({ ...none, confirmed: true }, [t("parked")])).toBe("parked");
    // A resume asserts no rung of its own; it only ends a park.
    expect(deriveState({ ...none, confirmed: true }, [t("parked"), t("resumed")])).toBe("confirmed");
  });

  it("honours a reopen's declared rung", () => {
    expect(deriveState({ ...none, priced: true }, [t("reopened", "captured")])).toBe("captured");
  });
});

describe("assertWorldViewIsCurrent", () => {
  it("counts the fallback when no reference is sent, and refuses nothing (040 I18, 042 §6.5)", async () => {
    const before = againstFallback.count;
    const { pool, calls } = fakePool();
    await assertWorldViewIsCurrent(asTx(pool), "shop-1", "s-1", undefined);
    // `against` is OPTIONAL in v1 — making it required would 400 every replay
    // from a queue written by yesterday's client — but AN UNCOUNTED FALLBACK IS
    // A SILENT RETURN TO THE RULE IT REPLACED.
    expect(againstFallback.count).toBe(before + 1);
    expect(calls).toEqual([]);
  });

  it("checks a confirmation against the `_current` VIEW, not the raw table (041 §3.4)", async () => {
    const { pool, calls } = fakePool((text) => {
      // The witness query NAMES the three views, so it has to be matched first.
      if (isWitnessQuery(text)) {
        return { rows: [{ ...noIds, captured: "p-1", proposed: "cs-1", confirmed: "c-1" }] };
      }
      if (text.includes("human_confirmation_current")) return { rows: [{ "?column?": 1 }] };
      return undefined;
    });
    await assertWorldViewIsCurrent(asTx(pool), "shop-1", "s-1", {
      table: "human_confirmation",
      id: "c-1",
    });
    expect(calls[0]!.text).toContain("FROM human_confirmation_current");
    expect(calls[0]!.values).toEqual(["c-1", "s-1", "shop-1"]);
  });

  it("refuses a superseded reference with STALE_WORLD_VIEW and a REFERENCE, never a row", async () => {
    const { pool } = fakePool((text) => {
      if (isWitnessQuery(text)) return { rows: [{ ...noIds, confirmed: "winner-1" }] };
      if (text.includes("human_confirmation_current")) return { rows: [] };
      return undefined;
    });
    const err = await assertWorldViewIsCurrent(asTx(pool), "shop-1", "s-1", {
      table: "human_confirmation",
      id: "old",
    }).catch((e: unknown) => e);
    // 042 §6.4: the reference only. Putting the winning row in the error body
    // would be a second read path with its own leak surface, at the exact moment
    // two operators are already confused — and 019 T35 signs per-operator
    // rendering at zero, non-waivable.
    expect(err).toMatchObject({ code: "STALE_WORLD_VIEW", status: 409 });
    // 042 §6.4 wants the reference, and a reference is a table AND an id: without
    // the id the refusal says which table moved without saying which row to read,
    // which is half an answer at the worst possible moment.
    expect((err as { details: Record<string, unknown> }).details).toEqual({
      current: { table: "human_confirmation", id: "winner-1" },
    });
    expect(JSON.stringify(err)).not.toMatch(/confirmed_by|created_by|operator/);
  });

  it("refuses a reference the session has moved past", async () => {
    const { pool } = fakePool((text) => {
      if (isWitnessQuery(text)) return { rows: [{ ...noIds, proposed: "cs-1", confirmed: "c-1" }] };
      if (text.includes("FROM llm_rerank")) return { rows: [{ "?column?": 1 }] };
      return undefined;
    });
    await expect(
      assertWorldViewIsCurrent(asTx(pool), "shop-1", "s-1", { table: "llm_rerank", id: "r-1" })
    ).rejects.toMatchObject({ code: "STALE_WORLD_VIEW" });
  });
});

describe("readWitnessIds / readWitnessFlags", () => {
  it("derives the flags from the ids, so there is ONE query and one truth", async () => {
    // The query returns the current row's ID per rung, not a boolean, because
    // 042 §6.4's refusal carries `{table, id}` — a client told which TABLE moved
    // without being told which ROW to read has half an answer. Two queries (one
    // for existence, one for the id) would be two truths that can disagree.
    const { pool, calls } = fakePool(() => ({ rows: [{ ...noIds, confirmed: "c-1" }] }));
    expect(flagsOf(await readWitnessIds(pool, "shop-1", "s-1"))).toEqual({ ...none, confirmed: true });
    expect(await readWitnessFlags(pool, "shop-1", "s-1")).toEqual({ ...none, confirmed: true });
    expect(calls).toHaveLength(2); // one per call above, never two per call
  });

  it("asks for the three superseded-chain rungs through their views, in one statement", async () => {
    const { pool, calls } = fakePool(() => ({ rows: [noIds] }));
    await readWitnessFlags(pool, "shop-1", "s-1");
    expect(calls).toHaveLength(1);
    for (const view of [
      "human_confirmation_current",
      "condition_assessment_current",
      "pricing_snapshot_current",
    ]) {
      expect(calls[0]!.text).toContain(view);
    }
    // 040 §3.2 rung 6: a `shopify_draft` row witnesses `drafted` only when it is
    // a draft — a failed one is a record of a failure, not of a listing.
    expect(calls[0]!.text).toContain("status = 'draft'");
    // Shop-scoped, non-waivable (019 T24).
    expect(calls[0]!.values).toEqual(["s-1", "shop-1"]);
  });
});
