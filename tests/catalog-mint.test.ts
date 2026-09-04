// THE MINT — the one helper that brings an LCID into existence (E04-D06;
// 047 §4, A1, A5, A12; 042 A3, A6).
//
// `tests/integration/lcid-registry.test.ts` proves what the DATABASE decides: the
// `minted_by` CHECK, the absence of a UNIQUE on `edition_signature` (I17), and
// that a rolled-back batch un-mints its own LCIDs (I5). It cannot reach the
// helper's reconciliation of two retry policies, because provoking an 80-bit
// primary-key collision in Postgres is not something a test can arrange.
//
// That reconciliation is the whole reason this file has a savepoint in it:
//   * `23505` is a PAYLOAD collision. Absorbed here, on a savepoint, with a fresh
//     payload — because inside an open transaction an uncaught 23505 poisons the
//     transaction and the next INSERT would get `25P02` instead.
//   * `40001` / `40P01` are the CALLER's. They propagate so `withTransaction`
//     retries the whole transaction under 041 §4.5's existing rules, rather than
//     this helper inventing a second policy for the same condition.
// Getting that backwards is silent in both directions: a swallowed 40001 loses a
// caller's work, and an unswallowed 23505 fails a mint that should have retried.
import { describe, expect, it } from "vitest";
import { MINT_ATTEMPTS, mint, parseLcid } from "../src/catalog/index.js";
import { fakeTx, pgError } from "./fakes.js";

const CORPUS = "c0000000-0000-4000-8000-000000000001";
const req = {
  kind: "edition" as const,
  verticalCode: "cmc",
  mintedInCorpusVersionId: CORPUS,
  mintedBy: "import" as const,
};

/** A recorder that raises `codes[n]` on the n-th registry INSERT. */
function collidingTx(codes: (string | null)[]) {
  let insert = 0;
  return fakeTx((text) => {
    if (!text.includes("INSERT INTO lcid_registry")) return undefined;
    const code = codes[insert] ?? null;
    insert += 1;
    if (code !== null) throw pgError(code);
    return { rows: [] };
  });
}

describe("mint — the INSERT is the mint (047 §4.1)", () => {
  it("returns a parseable LCID and writes exactly one registry row", async () => {
    const w = collidingTx([]);
    const lcid = await mint(w.tx, req);
    expect(parseLcid(lcid)).toMatchObject({ kind: "edition", verticalCode: "cmc" });
    const insert = w.only("INSERT INTO lcid_registry");
    expect(insert.values?.slice(0, 5)).toEqual([lcid, "edition", "cmc", CORPUS, "import"]);
  });

  it("derives `authored_by` from the CAUSE when the caller does not state one", async () => {
    // 041 §2.3's envelope: who produced the row's content, which is a different
    // question from why it was minted. An import is a system act; a human review
    // is a human's. Stating it explicitly still wins.
    const importer = collidingTx([]);
    await mint(importer.tx, req);
    expect(importer.only("INSERT INTO lcid_registry").values?.[5]).toBe("system");

    const author = collidingTx([]);
    await mint(author.tx, { ...req, mintedBy: "human_review" });
    expect(author.only("INSERT INTO lcid_registry").values?.[5]).toBe("human");

    const stated = collidingTx([]);
    await mint(stated.tx, { ...req, authoredBy: "provider" });
    expect(stated.only("INSERT INTO lcid_registry").values?.[5]).toBe("provider");
  });

  it("takes NO lock and opens NO transaction — it participates in the caller's (047 A5)", async () => {
    const w = collidingTx([]);
    await mint(w.tx, req);
    for (const fragment of ["BEGIN", "COMMIT", "FOR UPDATE", "FOR NO KEY UPDATE", "LOCK TABLE"]) {
      expect(w.matching(fragment)).toHaveLength(0);
    }
  });
});

describe("mint — the two retry policies, and which one owns which SQLSTATE", () => {
  it("absorbs a payload collision on a SAVEPOINT and retries with a fresh payload", async () => {
    const w = collidingTx(["23505"]);
    const lcid = await mint(w.tx, req);
    const inserts = w.matching("INSERT INTO lcid_registry");
    expect(inserts).toHaveLength(2);
    // A FRESH payload, not the same string re-offered — the collision is on the
    // 80 random bits, so re-sending them would collide again by construction.
    expect(inserts[0]!.values?.[0]).not.toBe(inserts[1]!.values?.[0]);
    expect(lcid).toBe(inserts[1]!.values?.[0]);
    expect(w.matching("ROLLBACK TO SAVEPOINT")).toHaveLength(1);
    // The savepoint is released on both paths, so a long-running caller does not
    // accumulate them.
    expect(w.matching("RELEASE SAVEPOINT")).toHaveLength(2);
  });

  it("PROPAGATES a serialization failure so the caller's `withTransaction` retries the whole unit", async () => {
    const w = collidingTx(["40001"]);
    await expect(mint(w.tx, req)).rejects.toMatchObject({ code: "40001" });
    expect(w.matching("INSERT INTO lcid_registry")).toHaveLength(1);
  });

  it("PROPAGATES a deadlock the same way", async () => {
    const w = collidingTx(["40P01"]);
    await expect(mint(w.tx, req)).rejects.toMatchObject({ code: "40P01" });
  });

  it("PROPAGATES a constraint failure that is not a payload collision", async () => {
    // A bad vertical code or a missing corpus version is a defect in the request,
    // not bad luck with a CSPRNG. Retrying it would issue the same broken INSERT
    // three times and then report a collision rate that never happened.
    const w = collidingTx(["23514"]);
    await expect(mint(w.tx, req)).rejects.toMatchObject({ code: "23514" });
    expect(w.matching("INSERT INTO lcid_registry")).toHaveLength(1);
    // Still unwound: the savepoint is rolled back before the throw escapes, so
    // the caller's transaction is usable.
    expect(w.matching("ROLLBACK TO SAVEPOINT")).toHaveLength(1);
  });

  it("gives up after `MINT_ATTEMPTS` and says the circuit breaker is not a measurement", async () => {
    // 042 A3: the bound is a PROVISIONAL floor. Three consecutive 80-bit
    // collisions mean the random source is degenerate, not that the namespace is
    // full, and the message has to say so or somebody will quote it as one.
    const w = collidingTx(Array<string>(MINT_ATTEMPTS).fill("23505"));
    await expect(mint(w.tx, req)).rejects.toThrow(/circuit breaker, not a measurement/);
    expect(w.matching("INSERT INTO lcid_registry")).toHaveLength(MINT_ATTEMPTS);
  });

  it("carries the last collision as the `cause`, so the SQLSTATE is not lost", async () => {
    const w = collidingTx(Array<string>(MINT_ATTEMPTS).fill("23505"));
    await expect(mint(w.tx, req)).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("uses the injected random source, which is what makes the collision path testable at all", async () => {
    const payloads = [Buffer.alloc(10, 1), Buffer.alloc(10, 2)];
    let call = 0;
    const w = collidingTx(["23505"]);
    const lcid = await mint(w.tx, { ...req, randomSource: () => payloads[call++] ?? payloads[1]! });
    const inserts = w.matching("INSERT INTO lcid_registry");
    expect(inserts[0]!.values?.[0]).not.toBe(lcid);
    expect(call).toBe(2);
  });
});
