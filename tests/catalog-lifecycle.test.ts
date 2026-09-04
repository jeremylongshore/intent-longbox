// LIFECYCLE FACTS AND CROSSWALK EDGES — what each one is allowed to SAY
// (E04-D06; 047 §5–§8, A4; 030 §4; 014 §4.3).
//
// These five helpers are the only writers of the catalog's lifecycle tables, and
// each of them appends a fact that no later row can edit. The database enforces
// the shape (the no-cycle trigger, the partial unique on the continuation, the
// certification-class trigger, the append-only refusal) and
// `tests/integration/lcid-lifecycle.test.ts` and `crosswalk-catalog-authority.test.ts`
// assert it there. What lives ONLY here is the decision each helper makes before
// it issues any SQL: that a split of one product is refused rather than written,
// that a proposal carries no `decided_by_role` and a certification carries one,
// that continuation is `false` unless claimed, and that an absent contradiction
// is a NULL rather than the string "undefined".
//
// The distinction matters because the failure mode is silent. A `certifyAlias`
// that forgot to pass the role would still INSERT — the column is nullable at the
// application boundary — and the row would read as a certification nobody made.
import { describe, expect, it } from "vitest";
import {
  CATALOG_AUTHORING_ROLES,
  NotACatalogAuthorError,
  addAlias,
  certifyAlias,
  merge,
  retire,
  split,
  type AliasRequest,
} from "../src/catalog/index.js";
import { fakeTx } from "./fakes.js";

const CORPUS = "c0000000-0000-4000-8000-000000000001";

/** Every lifecycle INSERT ends in `RETURNING id`, so one router answers them all. */
function recorder() {
  return fakeTx((text) => (text.includes("RETURNING id") ? { rows: [{ id: "row-1" }] } : undefined));
}

const fact = {
  corpusVersionId: CORPUS,
  method: "human_arbitration",
  evidence: { note: "same book" },
  decidedBy: "reviewer",
};

describe("merge — the survivor is NAMED in the fact (047 §6.3(c))", () => {
  it("writes the loser, the survivor and the corpus version, and returns the fact id", async () => {
    const w = recorder();
    await expect(merge(w.tx, { ...fact, losingLcid: "loser", survivingLcid: "winner" })).resolves.toBe(
      "row-1"
    );
    const insert = w.only("INSERT INTO lcid_merge");
    expect(insert.values).toEqual([
      "loser",
      "winner",
      CORPUS,
      "human_arbitration",
      JSON.stringify({ note: "same book" }),
      "reviewer",
    ]);
  });

  it("serialises a missing evidence payload as `{}` rather than as SQL NULL", async () => {
    // `evidence` is 047 §5.3's "what was relied on". An empty object is an
    // honest "nothing was recorded"; a NULL in a jsonb column is 030 A1's
    // two-meanings-of-NULL arriving in the audit trail.
    const w = recorder();
    await merge(w.tx, {
      corpusVersionId: CORPUS,
      method: "import",
      evidence: undefined,
      decidedBy: "importer",
      losingLcid: "a",
      survivingLcid: "b",
    });
    expect(w.only("INSERT INTO lcid_merge").values).toContain("{}");
  });
});

describe("split — ambiguity is the default and continuation must be EARNED (047 §7.2)", () => {
  it("REFUSES a split naming fewer than two products, before issuing any SQL", async () => {
    const w = recorder();
    await expect(split(w.tx, { ...fact, sourceLcid: "src", products: [{ lcid: "only" }] })).rejects.toThrow(
      /is not a split/
    );
    expect(w.calls).toHaveLength(0);
  });

  it("REFUSES a split naming no products at all", async () => {
    const w = recorder();
    await expect(split(w.tx, { ...fact, sourceLcid: "src", products: [] })).rejects.toThrow(
      /0 product\(s\) is not a split/
    );
    expect(w.calls).toHaveLength(0);
  });

  it("writes one outcome row per product, and continuation is FALSE unless claimed", async () => {
    const w = recorder();
    await split(w.tx, {
      ...fact,
      decidedBy: "reviewer",
      sourceLcid: "src",
      products: [{ lcid: "kept", isContinuation: true }, { lcid: "other" }],
    });
    const outcomes = w.matching("INSERT INTO lcid_split_outcome");
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.values).toEqual(["row-1", "kept", true]);
    expect(outcomes[1]!.values).toEqual(["row-1", "other", false]);
  });

  it("treats a MISSING `isContinuation` as an un-earned claim, not as unknown", async () => {
    const w = recorder();
    await split(w.tx, {
      ...fact,
      decidedBy: "reviewer",
      sourceLcid: "src",
      products: [{ lcid: "a" }, { lcid: "b" }],
    });
    for (const outcome of w.matching("INSERT INTO lcid_split_outcome")) {
      expect(outcome.values?.[2]).toBe(false);
    }
  });
});

describe("retire — this LCID names nothing (047 §5.4)", () => {
  it("carries a reason, and writes no repair to the rows that cite it", async () => {
    const w = recorder();
    await expect(
      retire(w.tx, { ...fact, lcid: "gone", reason: "never existed as a printing" })
    ).resolves.toBe("row-1");
    expect(w.only("INSERT INTO lcid_retirement").values).toEqual([
      "gone",
      CORPUS,
      "never existed as a printing",
      "human_arbitration",
      JSON.stringify({ note: "same book" }),
      "reviewer",
    ]);
    // 041 §3.6: a retirement never edits, never hides. Only the one INSERT.
    expect(w.calls).toHaveLength(1);
  });
});

const alias: AliasRequest = {
  editionLcid: "LBX-E-CMC-aaa",
  provider: "pricecharting",
  externalId: "PC-123",
  vertical: "comic",
  corpusVersionId: CORPUS,
  dataSourceId: "src-1",
  matchMethod: "exact",
};

describe("crosswalk edges — a proposal is not a certification (014 §4.3, 047 §8)", () => {
  it("`addAlias` writes an UNCERTIFIED edge: no reviewer, no decided_by, no certified_at", async () => {
    const w = recorder();
    await expect(addAlias(w.tx, alias)).resolves.toBe("row-1");
    const insert = w.only("INSERT INTO edition_external_id");
    expect(insert.text).not.toContain("certified");
    expect(insert.text).not.toContain("decided_by");
    expect(insert.text).not.toContain("reviewer");
  });

  it("`addAlias` writes an ABSENT contradiction as NULL, never as a JSON `undefined`", async () => {
    const w = recorder();
    await addAlias(w.tx, alias);
    expect(w.only("INSERT INTO edition_external_id").values?.[8]).toBeNull();
  });

  it("`addAlias` serialises a PRESENT contradiction, including an explicit `null`", async () => {
    // `null` is a recorded finding ("checked, nothing contradicted"); `undefined`
    // is "never checked". Collapsing the two would lose the only distinction the
    // evidence-contradiction gate has (locked decision 7).
    const w = recorder();
    await addAlias(w.tx, { ...alias, contradiction: null });
    expect(w.only("INSERT INTO edition_external_id").values?.[8]).toBe("null");
    const w2 = recorder();
    await addAlias(w2.tx, { ...alias, contradiction: { field: "issue" } });
    expect(w2.only("INSERT INTO edition_external_id").values?.[8]).toBe(JSON.stringify({ field: "issue" }));
  });

  it("`certifyAlias` REFUSES a shop-workflow role before issuing any SQL (047 A4 / §8.4)", async () => {
    const w = recorder();
    await expect(
      certifyAlias(w.tx, { ...alias, decidedBy: "u-1", decidedByRole: "shop_employee" })
    ).rejects.toBeInstanceOf(NotACatalogAuthorError);
    expect(w.calls).toHaveLength(0);
  });

  it("`certifyAlias` names the permitted roles in its refusal, so the call site can act on it", async () => {
    const w = recorder();
    await expect(certifyAlias(w.tx, { ...alias, decidedBy: "u-1", decidedByRole: "owner" })).rejects.toThrow(
      /catalog_author, catalog_reviewer, catalog_importer/
    );
  });

  it("accepts every role in `CATALOG_AUTHORING_ROLES` and stamps the role onto the row", async () => {
    for (const role of CATALOG_AUTHORING_ROLES) {
      const w = recorder();
      await expect(certifyAlias(w.tx, { ...alias, decidedBy: "u-1", decidedByRole: role })).resolves.toBe(
        "row-1"
      );
      const insert = w.only("INSERT INTO edition_external_id");
      expect(insert.text).toContain("certified");
      expect(insert.values).toContain(role);
    }
  });

  it("defaults the reviewer to the decider rather than leaving the row unattributed", async () => {
    const w = recorder();
    await certifyAlias(w.tx, { ...alias, decidedBy: "u-1", decidedByRole: "catalog_reviewer" });
    expect(w.only("INSERT INTO edition_external_id").values?.[12]).toBe("u-1");
    const w2 = recorder();
    await certifyAlias(w2.tx, {
      ...alias,
      decidedBy: "u-1",
      decidedByRole: "catalog_reviewer",
      reviewer: "u-2",
    });
    expect(w2.only("INSERT INTO edition_external_id").values?.[12]).toBe("u-2");
  });

  it("neither helper writes a supersession pointer — that writer lives elsewhere (041 §3.3)", async () => {
    const w = recorder();
    await addAlias(w.tx, alias);
    await certifyAlias(w.tx, { ...alias, decidedBy: "u-1", decidedByRole: "catalog_author" });
    for (const call of w.calls) expect(call.text).not.toContain("supersedes_id");
  });
});
