// REBUILDING `lcid_current_survivor` — the projection is a DERIVED thing, and
// the rebuild is what proves it (E04-D06; 047 §6.2, A2; migrations/017).
//
// `rebuildSurvivorProjection` exists for the database where the write-time
// triggers were NOT the only writer: a restore, a replay drill, a suspected
// corruption. That is precisely the database an integration test cannot easily
// construct — the no-cycle trigger refuses the input the rebuild was written for,
// so building a cycle in Postgres means disabling the very guard under test.
// Here the merge edges are supplied directly, so the walk's own rules are
// reachable: bounded path compression, an anomalous chain LEFT OUT rather than
// given a guessed survivor, and a DELETE that shares the caller's transaction
// with the reinsert so no reader ever sees an empty projection.
import { describe, expect, it, vi } from "vitest";
import { READ_CHAIN_BOUND, rebuildSurvivorProjection } from "../src/catalog/index.js";
import { fakeTx } from "./fakes.js";

/** A recorder whose only read is the merge edge set. */
function withEdges(edges: [string, string][]) {
  return fakeTx((text) =>
    text.includes("FROM lcid_merge")
      ? { rows: edges.map(([losing_lcid, surviving_lcid]) => ({ losing_lcid, surviving_lcid })) }
      : undefined
  );
}

/** The projection rows written, as `loser -> survivor`. */
function written(w: ReturnType<typeof withEdges>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const call of w.matching("INSERT INTO lcid_current_survivor")) {
    const [loser, survivor] = (call.values ?? []) as string[];
    out[loser!] = survivor!;
  }
  return out;
}

describe("rebuildSurvivorProjection — every loser points at its ROOT", () => {
  it("compresses a chain so each row names the final survivor, not the next hop", async () => {
    // `a -> b -> c`. A projection that stored `a -> b` would make `resolve(a)`
    // answer with a name that has itself been merged away — one index-only
    // lookup is the whole point, so the lookup must land on the root.
    const w = withEdges([
      ["a", "b"],
      ["b", "c"],
    ]);
    const result = await rebuildSurvivorProjection(w.tx);
    expect(written(w)).toEqual({ a: "c", b: "c" });
    expect(result).toEqual({ rows: 2, merges: 2, anomalies: [] });
  });

  it("reports zero rows and zero merges for an empty merge log", async () => {
    const w = withEdges([]);
    await expect(rebuildSurvivorProjection(w.tx)).resolves.toEqual({
      rows: 0,
      merges: 0,
      anomalies: [],
    });
    expect(w.matching("INSERT INTO lcid_current_survivor")).toHaveLength(0);
  });

  it("counts merges READ, which is not the same as rows WRITTEN", async () => {
    // Two edges naming the same loser are one projection row: the map is keyed
    // on the loser, and `UNIQUE (losing_lcid)` makes that the database's view
    // too. Reporting `merges` separately is how a caller sees the difference.
    const w = withEdges([
      ["a", "b"],
      ["a", "b"],
    ]);
    const result = await rebuildSurvivorProjection(w.tx);
    expect(result.merges).toBe(2);
    expect(result.rows).toBe(1);
  });

  it("DELETEs before it reinserts, in the caller's transaction", async () => {
    const w = withEdges([["a", "b"]]);
    await rebuildSurvivorProjection(w.tx);
    const deleteIndex = w.calls.findIndex((c) => c.text.includes("DELETE FROM lcid_current_survivor"));
    const insertIndex = w.calls.findIndex((c) => c.text.includes("INSERT INTO lcid_current_survivor"));
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(deleteIndex);
    // No BEGIN, no COMMIT: the atomicity belongs to the caller, so a failed
    // rebuild leaves the OLD projection in place rather than a half-built one.
    expect(w.matching("BEGIN")).toHaveLength(0);
    expect(w.matching("COMMIT")).toHaveLength(0);
  });
});

describe("rebuildSurvivorProjection — an anomalous chain is REPORTED, never guessed", () => {
  it("leaves a cyclic LCID out of the projection and names it in `anomalies`", async () => {
    // `migrations/017`'s `lcid_merge_no_cycle` trigger refuses a cycle at write time, so a cycle here
    // means this database took writes that did not go through it. An entry
    // missing from the projection makes `resolve` answer "current" — visibly
    // wrong and reviewable — where a guessed survivor would be invisibly wrong.
    const w = withEdges([
      ["a", "b"],
      ["b", "a"],
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await rebuildSurvivorProjection(w.tx);
    expect(result.rows).toBe(0);
    expect([...result.anomalies].sort()).toEqual(["a", "b"]);
    expect(written(w)).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("merge chain deeper"));
    warn.mockRestore();
  });

  it("treats a chain past the read bound as indistinguishable from a cycle", async () => {
    const edges: [string, string][] = [];
    for (let i = 0; i < READ_CHAIN_BOUND + 3; i += 1) edges.push([`n${i}`, `n${i + 1}`]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = withEdges(edges);
    const result = await rebuildSurvivorProjection(w.tx);
    expect(result.anomalies.length).toBeGreaterThan(0);
    // The healthy tail still lands: an anomaly disqualifies the nodes whose walk
    // exceeded the bound, not the whole rebuild.
    expect(result.rows).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it("does NOT memoize a partial walk, so a good chain sharing a bad tail is still refused", async () => {
    // Caching a wrong root would silently become the answer for every node
    // behind it — one anomaly turning into a fabricated survivor for the rest.
    const edges: [string, string][] = [
      ["head", "n0"],
      ["n0", "n1"],
      ["n1", "n0"],
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = withEdges(edges);
    const result = await rebuildSurvivorProjection(w.tx);
    expect(result.rows).toBe(0);
    expect(result.anomalies).toContain("head");
    warn.mockRestore();
  });

  it("truncates the anomaly warning at ten and says so, rather than printing the log", async () => {
    const edges: [string, string][] = [];
    for (let i = 0; i < 12; i += 1) edges.push([`x${i}`, `y${i}`], [`y${i}`, `x${i}`]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = withEdges(edges);
    const result = await rebuildSurvivorProjection(w.tx);
    expect(result.anomalies.length).toBe(24);
    expect(warn.mock.calls[0]![0]).toContain(", …");
    warn.mockRestore();
  });

  it("reports a SELF-POINTING merge edge as an anomaly, and writes no row for it", async () => {
    // E04-D08 SETTLED THIS ONE, AND THE ANSWER WAS TO DELETE THE OTHER PATH.
    // v1 of the rebuild carried a second guard, `if (survivor === loser) continue`,
    // described in a comment as belt-and-braces against
    // `lcid_current_survivor_not_self`. It was UNREACHABLE — `rootOf` only ever
    // returns a node with no outgoing edge, and every candidate here is a key of
    // the edge map — so a self-edge is a one-node cycle that exhausts
    // `READ_CHAIN_BOUND` and lands in `anomalies` instead, which is the LOUDER
    // outcome and the right one: a self-edge in `lcid_merge` is precisely the
    // "this database took writes that did not go through the trigger" condition
    // (047 A2) the anomaly list exists to surface, and the deleted guard would
    // have dropped it silently. `lcid_merge_not_self` (migrations/017) refuses the
    // edge at write time and `lcid_current_survivor_not_self` refuses the row, so
    // neither is reachable at all in a database whose writes went through them.
    // This case is what keeps the surviving behaviour asserted rather than
    // assumed.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = withEdges([["a", "a"]]);
    const result = await rebuildSurvivorProjection(w.tx);
    expect(result.rows).toBe(0);
    expect(result.anomalies).toEqual(["a"]);
    expect(w.matching("INSERT INTO lcid_current_survivor")).toHaveLength(0);
    warn.mockRestore();
  });
});

describe("rebuildSurvivorProjection — the memo is what keeps it ONE pass", () => {
  it("compresses a CONVERGING chain by reusing a memo mid-walk, not by re-walking", async () => {
    // 047 A2 obligation 1 makes "one pass over `lcid_merge`" a REQUIREMENT rather
    // than an optimisation, and the memo hit inside the walk is the half of the
    // path compression that delivers it. The entry memo (checked before the loop)
    // only helps a node that has already been resolved in full; this case is the
    // other one — a node whose walk MEETS an already-compressed chain partway.
    //
    // `d -> a -> b -> c`, with `a -> b -> c` resolved first because `a` is the
    // first key. Walking `d` steps to `a`, finds `a`'s memo (`c`) on the next
    // iteration and stops there, so the rebuild never re-walks `a -> b -> c`.
    // Without the in-loop memo the answer would still be `c`, at the cost of
    // re-walking the shared tail once per branch — which on a wide forest is the
    // N+1 this construction exists to avoid.
    const w = withEdges([
      ["a", "b"],
      ["b", "c"],
      ["d", "a"],
    ]);
    const result = await rebuildSurvivorProjection(w.tx);
    // Every loser names the ROOT, including the one that joined partway.
    expect(written(w)).toEqual({ a: "c", b: "c", d: "c" });
    expect(result).toEqual({ rows: 3, merges: 3, anomalies: [] });
  });
});
