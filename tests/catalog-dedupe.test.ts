// SIGNATURE AND CROSSWALK LOOKUPS — THREE OUTCOMES EACH, AND THE THIRD IS THE
// ONE THAT MATTERS (E04-D06; 030 §3.1, §4, A4; 014 §4.3; 047 A3).
//
// Both lookups are total over `matched` / `no_match` / `ambiguous`, and the
// ambiguous branch is where an automatic merge would otherwise be invented. 030
// §3.3 is explicit that a collision is "a dedupe candidate… never an automatic
// merge", and 030 §4 rule 1 says `(provider, external_id)` "is not unique and is
// not a primary key. Providers reuse, recycle and mis-issue IDs."
//
// A lookup that PICKED — first row, highest id, most recent corpus — would be
// indistinguishable from a correct one on every test that only ever set up one
// row, and would silently choose a canonical name for the shared catalog. So
// every case here sets up TWO and asserts the decline.
import { describe, expect, it } from "vitest";
import {
  findAllDedupeCandidates,
  findDedupeCandidate,
  findEditionsBySignature,
  lookupByExternalId,
  lookupBySignature,
  type SignatureQuery,
} from "../src/catalog/index.js";
import { fakeTx } from "./fakes.js";

const CORPUS = "c0000000-0000-4000-8000-000000000001";
const query: SignatureQuery = {
  vertical: "comic",
  signature: "amazing spider-man|300",
  normalizationVersion: 1,
  asOfCorpusVersionId: CORPUS,
};

function withLcids(lcids: string[]) {
  return fakeTx((text) =>
    text.includes("FROM edition_signature") || text.includes("FROM edition_external_id")
      ? { rows: lcids.map((edition_lcid) => ({ edition_lcid })) }
      : undefined
  );
}

describe("lookupBySignature — total over three outcomes (047 A3)", () => {
  it("answers `no_match` when nothing carries the signature", async () => {
    const w = withLcids([]);
    await expect(lookupBySignature(w.db, query)).resolves.toEqual({ status: "no_match" });
  });

  it("answers `matched` for exactly one edition", async () => {
    const w = withLcids(["LBX-E-CMC-one"]);
    await expect(lookupBySignature(w.db, query)).resolves.toEqual({
      status: "matched",
      editionLcid: "LBX-E-CMC-one",
    });
  });

  it("DECLINES rather than picking when two editions carry the signature", async () => {
    const w = withLcids(["LBX-E-CMC-a", "LBX-E-CMC-b"]);
    await expect(lookupBySignature(w.db, query)).resolves.toEqual({
      status: "ambiguous",
      candidate: {
        vertical: "comic",
        signature: query.signature,
        normalizationVersion: 1,
        editionLcids: ["LBX-E-CMC-a", "LBX-E-CMC-b"],
      },
    });
  });

  it("reads as of the given corpus and orders the result totally", async () => {
    // Ascending by LCID, so a queue item is stable across reads rather than
    // plan-dependent; and filtered by the same as-of tuple `resolve` compares.
    const w = withLcids(["x"]);
    await lookupBySignature(w.db, query);
    const read = w.only("FROM edition_signature");
    expect(read.text).toContain("(c.built_at, c.id) <=");
    expect(read.text).toContain("ORDER BY s.edition_lcid");
    expect(read.values).toEqual(["comic", CORPUS, query.signature, 1]);
  });

  it("DISTINCTs on the edition, so one edition with two alias rows is not a collision with itself", async () => {
    // 030 A4 lets one edition carry several `edition_signature` rows. Without the
    // DISTINCT the alias case would report a dedupe candidate for every aliased
    // edition in the catalog.
    const w = withLcids(["only"]);
    await findEditionsBySignature(w.db, query);
    expect(w.only("FROM edition_signature").text).toContain("SELECT DISTINCT s.edition_lcid");
  });
});

describe("findDedupeCandidate — nothing to review is not an empty queue item", () => {
  it("answers null for no match and for a single match", async () => {
    await expect(findDedupeCandidate(withLcids([]).db, query)).resolves.toBeNull();
    await expect(findDedupeCandidate(withLcids(["one"]).db, query)).resolves.toBeNull();
  });

  it("returns the colliding set, ascending, when there is a real collision", async () => {
    const w = withLcids(["a", "b", "c"]);
    await expect(findDedupeCandidate(w.db, query)).resolves.toEqual({
      vertical: "comic",
      signature: query.signature,
      normalizationVersion: 1,
      editionLcids: ["a", "b", "c"],
    });
  });
});

describe("findAllDedupeCandidates — the review queue's feed", () => {
  it("groups by signature and counts DISTINCT editions, not rows", async () => {
    const w = fakeTx((text) =>
      text.includes("FROM edition_signature")
        ? {
            rows: [
              { signature: "sig-1", normalization_version: 1, edition_lcids: ["a", "b"] },
              { signature: "sig-2", normalization_version: 1, edition_lcids: ["c", "d"] },
            ],
          }
        : undefined
    );
    const out = await findAllDedupeCandidates(w.db, "comic", CORPUS);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      vertical: "comic",
      signature: "sig-1",
      normalizationVersion: 1,
      editionLcids: ["a", "b"],
    });
    const read = w.only("FROM edition_signature");
    expect(read.text).toContain("HAVING count(DISTINCT s.edition_lcid) > 1");
    expect(read.values).toEqual(["comic", CORPUS, 100]);
  });

  it("bounds the feed, and the caller may narrow it further", async () => {
    const w = fakeTx(() => ({ rows: [] }));
    await findAllDedupeCandidates(w.db, "comic", CORPUS, 5);
    expect(w.only("FROM edition_signature").values?.[2]).toBe(5);
  });
});

describe("lookupByExternalId — a provider ID is an ALIAS, never a key (030 §4 rule 1)", () => {
  const aliasQuery = { provider: "pricecharting", externalId: "PC-1", asOfCorpusVersionId: CORPUS };

  it("answers `no_match`, `matched` and `ambiguous` over the same three shapes", async () => {
    await expect(lookupByExternalId(withLcids([]).db, aliasQuery)).resolves.toEqual({
      status: "no_match",
    });
    await expect(lookupByExternalId(withLcids(["one"]).db, aliasQuery)).resolves.toEqual({
      status: "matched",
      editionLcid: "one",
    });
    await expect(lookupByExternalId(withLcids(["a", "b"]).db, aliasQuery)).resolves.toEqual({
      status: "ambiguous",
      editionLcids: ["a", "b"],
    });
  });

  it("carries a BARE LCID list when ambiguous — the reviewable object is an EDGE, not a signature", async () => {
    // Returning a `DedupeCandidate` here would file a conflicting crosswalk edge
    // into the signature queue, which is the wrong queue and the wrong repair.
    const w = withLcids(["a", "b"]);
    const out = await lookupByExternalId(w.db, aliasQuery);
    expect(out).not.toHaveProperty("candidate");
  });

  it("EXCLUDES superseded edges, so a withdrawn mapping cannot answer a lookup", async () => {
    // `edition_external_id` is append-only with `supersedes_id` (041), so a
    // corrected edge leaves its predecessor in place. A lookup reading both would
    // resolve to an edition the crosswalk has already withdrawn.
    const w = withLcids(["a"]);
    await lookupByExternalId(w.db, aliasQuery);
    const read = w.only("FROM edition_external_id");
    expect(read.text).toContain("NOT EXISTS (SELECT 1 FROM edition_external_id later");
    expect(read.text).toContain("later.supersedes_id = x.id");
    expect(read.values).toEqual(["pricecharting", CORPUS, "PC-1"]);
  });
});
