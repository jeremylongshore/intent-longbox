// `resolve(lcid, asOf)` — THE FIVE OUTCOMES, AND THERE IS NO SIXTH (E04-D06;
// 047 §10.2, A3, A10, A11).
//
// This is the unit half of the catalog resolver's coverage. The Postgres half
// (`tests/integration/lcid-lifecycle.test.ts`) proves what the DATABASE
// guarantees: the index-only plan on the projection, the no-cycle trigger, the
// as-of tuple against real `timestamptz` microseconds. What it cannot reach is
// the resolver's own branch set — a `resolve` that returned `undefined` on an
// unknown string, or threw on a 65-hop chain, would still pass every trigger
// assertion in that file, because no trigger has an opinion about a READ.
//
// So every case here is a decision 047 ratified and a caller depends on:
// totality (five outcomes, never a throw), the ambiguity that a split with no
// earned continuation must produce, the walk that a past as-of must take instead
// of the projection, and the infrastructure error that must NOT be laundered
// into "that name did not exist yet".
import { describe, expect, it, vi } from "vitest";
import { READ_CHAIN_BOUND, newestCorpusVersionId, resolve, resolveCurrent } from "../src/catalog/index.js";
import { fakeTx } from "./fakes.js";

const CORPUS = "11111111-1111-4111-8111-111111111111";
const OLDER = "22222222-2222-4222-8222-222222222222";

/**
 * A world, expressed as the rows each of the resolver's statements returns.
 * The router keys on the real table names in the real SQL, so a statement the
 * resolver stops issuing stops being answered here too.
 */
function world(opts: {
  corpora?: string[];
  newest?: string | undefined;
  minted?: string[];
  retired?: string[];
  splits?: { source: string; id: string; continuation: string | null }[];
  merges?: Record<string, string>;
  survivors?: Record<string, string>;
}) {
  const corpora = opts.corpora ?? [CORPUS];
  return fakeTx((text, values) => {
    const v = (values ?? []) as string[];
    if (text.includes("SELECT 1 FROM corpus_version WHERE id")) {
      return { rows: corpora.includes(v[0]!) ? [{ n: 1 }] : [] };
    }
    if (text.includes("ORDER BY built_at DESC, id DESC")) {
      const newest = opts.newest ?? corpora[corpora.length - 1];
      return { rows: newest === undefined ? [] : [{ id: newest }] };
    }
    if (text.includes("FROM lcid_registry r")) {
      return { rows: (opts.minted ?? []).includes(v[0]!) ? [{ lcid: v[0] }] : [] };
    }
    if (text.includes("FROM lcid_retirement r")) {
      return { rows: (opts.retired ?? []).includes(v[0]!) ? [{ n: 1 }] : [] };
    }
    if (text.includes("FROM lcid_split s")) {
      const hit = (opts.splits ?? []).find((s) => s.source === v[0]);
      return { rows: hit ? [{ id: hit.id, continuation: hit.continuation }] : [] };
    }
    if (text.includes("FROM lcid_current_survivor WHERE lcid")) {
      const survivor = (opts.survivors ?? {})[v[0]!];
      return { rows: survivor === undefined ? [] : [{ survivor_lcid: survivor }] };
    }
    if (text.includes("FROM lcid_merge m")) {
      const next = (opts.merges ?? {})[v[0]!];
      return { rows: next === undefined ? [] : [{ surviving_lcid: next }] };
    }
    return undefined;
  });
}

describe("resolve — totality over five outcomes (047 A3)", () => {
  it("answers `current` for a minted LCID with no disposition", async () => {
    const w = world({ minted: ["LBX-E-CMC-abc"] });
    await expect(resolve(w.db, "LBX-E-CMC-abc", CORPUS)).resolves.toEqual({
      status: "current",
      lcid: "LBX-E-CMC-abc",
    });
  });

  it("answers `merged` with the survivor the projection names", async () => {
    const w = world({ minted: ["loser"], survivors: { loser: "winner" } });
    await expect(resolve(w.db, "loser", CORPUS)).resolves.toEqual({ status: "merged", survivor: "winner" });
  });

  it("answers `retired`, which names nothing — and that is the answer", async () => {
    const w = world({ minted: ["gone"], retired: ["gone"] });
    await expect(resolve(w.db, "gone", CORPUS)).resolves.toEqual({ status: "retired" });
  });

  it("answers `split_ambiguous` when a split earned no continuation (047 §7.2)", async () => {
    const w = world({ minted: ["src"], splits: [{ source: "src", id: "split-1", continuation: null }] });
    await expect(resolve(w.db, "src", CORPUS)).resolves.toEqual({
      status: "split_ambiguous",
      splitId: "split-1",
    });
  });

  it("resolves a split FORWARD when a continuation was earned", async () => {
    const w = world({ minted: ["src"], splits: [{ source: "src", id: "s", continuation: "kept" }] });
    await expect(resolve(w.db, "src", CORPUS)).resolves.toEqual({ status: "merged", survivor: "kept" });
  });

  it("answers `not_yet_minted` for an LCID minted after `asOf`", async () => {
    // The registry read is filtered by the as-of predicate, so a later mint
    // returns no row — the same shape as a name that was never minted at all.
    const w = world({ minted: [] });
    await expect(resolve(w.db, "later", CORPUS)).resolves.toEqual({ status: "not_yet_minted" });
  });

  it("answers `not_yet_minted` for an unknown string rather than inventing a sixth outcome", async () => {
    const w = world({ minted: ["known"] });
    await expect(resolve(w.db, "not-an-lcid-at-all", CORPUS)).resolves.toEqual({
      status: "not_yet_minted",
    });
  });

  it("answers `not_yet_minted` for a corpus version that describes no world", async () => {
    const w = world({ corpora: [CORPUS], minted: ["x"] });
    const unknownCorpus = "33333333-3333-4333-8333-333333333333";
    await expect(resolve(w.db, "x", unknownCorpus)).resolves.toEqual({ status: "not_yet_minted" });
    // And it stopped there: no registry read was issued against a world that
    // does not exist.
    expect(w.matching("FROM lcid_registry r")).toHaveLength(0);
  });

  it("refuses a MALFORMED as-of in JS, without asking the database", async () => {
    const w = world({ minted: ["x"] });
    await expect(resolve(w.db, "x", "not-a-uuid")).resolves.toEqual({ status: "not_yet_minted" });
    expect(w.calls).toHaveLength(0);
  });
});

describe("resolve — what it does NOT swallow (047 A10)", () => {
  it("propagates a real database failure instead of laundering it into not_yet_minted", async () => {
    // The distinction the resolver's own comment insists on: a caller mistake is
    // an outcome; a dropped table, a lost connection or a permission refusal is
    // not the catalog answering, and reporting "that name did not exist yet"
    // would be a confident wrong answer about data nobody could read.
    const w = fakeTx(() => {
      throw Object.assign(new Error("permission denied for table corpus_version"), { code: "42501" });
    });
    await expect(resolve(w.db, "x", CORPUS)).rejects.toThrow(/permission denied/);
  });

  it("returns ambiguity rather than throwing when a chain exceeds the read bound", async () => {
    // A cycle cannot be written — `lcid_merge_no_cycle` refuses it — so this is
    // the restored/replayed database the bound exists for. At READ time the same
    // condition must not turn a catalog anomaly into a 500 on a pricing lookup.
    const merges: Record<string, string> = {};
    for (let i = 0; i < READ_CHAIN_BOUND + 5; i += 1) merges[`n${i}`] = `n${i + 1}`;
    const w = world({ corpora: [OLDER, CORPUS], newest: CORPUS, minted: ["n0"], merges });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A PAST as-of, so the walk runs rather than the projection lookup.
    await expect(resolve(w.db, "n0", OLDER)).resolves.toEqual({ status: "split_ambiguous", splitId: null });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("merge chain exceeded"));
    warn.mockRestore();
  });
});

describe("resolve — the two read paths (047 §6.2, A2)", () => {
  it("reads the PROJECTION when `asOf` is the newest corpus (the hot path)", async () => {
    const w = world({ minted: ["loser"], survivors: { loser: "winner" } });
    await resolve(w.db, "loser", CORPUS);
    expect(w.matching("FROM lcid_current_survivor WHERE lcid")).toHaveLength(1);
    expect(w.matching("FROM lcid_merge m")).toHaveLength(0);
  });

  it("WALKS `lcid_merge` when `asOf` is a past corpus, and the projection is untouched", async () => {
    // The projection is CURRENT state and cannot answer a past corpus. A replay
    // that read it would see merges decided after the world it asked about.
    const w = world({
      corpora: [OLDER, CORPUS],
      newest: CORPUS,
      minted: ["a"],
      merges: { a: "b", b: "c" },
      survivors: { a: "z" },
    });
    await expect(resolve(w.db, "a", OLDER)).resolves.toEqual({ status: "merged", survivor: "c" });
    expect(w.matching("FROM lcid_current_survivor WHERE lcid")).toHaveLength(0);
    expect(w.matching("FROM lcid_merge m")).toHaveLength(3);
  });

  it("binds the as-of to the corpus ID and compares the tuple in SQL, never in JS", async () => {
    // Both properties were bugs before they were rules: `built_at` ties inside
    // one importer transaction, and a JS `Date` truncates a microsecond
    // `timestamptz` — each a WRONG ANSWER rather than an error.
    const w = world({ minted: ["x"] });
    await resolve(w.db, "x", CORPUS);
    const registryRead = w.only("FROM lcid_registry r");
    expect(registryRead.text).toContain("(c.built_at, c.id) <=");
    expect(registryRead.values).toEqual(["x", CORPUS]);
  });
});

describe("the present tense is an explicit act (047 A11)", () => {
  it("`resolveCurrent` reads the newest corpus and then resolves against it", async () => {
    const w = world({ minted: ["x"] });
    await expect(resolveCurrent(w.db, "x")).resolves.toEqual({ status: "current", lcid: "x" });
    expect(w.matching("ORDER BY built_at DESC, id DESC").length).toBeGreaterThanOrEqual(1);
  });

  it("`resolveCurrent` answers not_yet_minted when no corpus has ever been built", async () => {
    const w = world({ corpora: [], newest: undefined, minted: ["x"] });
    await expect(resolveCurrent(w.db, "x")).resolves.toEqual({ status: "not_yet_minted" });
  });

  it("`newestCorpusVersionId` orders by the SAME tuple the as-of predicate compares", async () => {
    const w = world({ corpora: [CORPUS], newest: CORPUS });
    await expect(newestCorpusVersionId(w.db)).resolves.toBe(CORPUS);
    expect(w.only("FROM corpus_version ORDER BY").text).toContain("ORDER BY built_at DESC, id DESC");
  });

  it("`newestCorpusVersionId` answers null rather than inventing a corpus", async () => {
    const w = world({ corpora: [], newest: undefined });
    await expect(newestCorpusVersionId(w.db)).resolves.toBeNull();
  });
});
