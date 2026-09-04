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
    // ⚠ OBSERVED, AND IT IS NOT WHAT THE `survivor === loser` GUARD READS LIKE.
    // Filed as E04-D08 (`longbox-e5b.4.20`), which decides whether that guard
    // stays as belt-and-braces or goes; this case moves with that decision.
    // A self-edge is a one-node cycle, so the walk exhausts `READ_CHAIN_BOUND`
    // and `rootOf` returns null BEFORE the guard is consulted — the loser lands
    // in `anomalies` rather than being quietly skipped. The outcome is the same
    // where it matters (no row is written, no survivor is guessed) and it is
    // arguably the better one, because a self-edge in `lcid_merge` is exactly the
    // "this database took writes that did not go through the trigger" condition
    // the anomaly list exists to surface. Asserted as it BEHAVES rather than as
    // the comment describes it: `lcid_merge_not_self` (migrations/017) refuses the row
    // at write time, so neither path can be reached by a database whose writes
    // all went through it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = withEdges([["a", "a"]]);
    const result = await rebuildSurvivorProjection(w.tx);
    expect(result.rows).toBe(0);
    expect(result.anomalies).toEqual(["a"]);
    expect(w.matching("INSERT INTO lcid_current_survivor")).toHaveLength(0);
    warn.mockRestore();
  });
});
