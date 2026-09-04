// `identity_resolution`'s DECISIONS, unit-tested against a fake connection
// (E04-B02; 047 §9.1, §9.2; 030 §7.1, §3.3).
//
// The integration lane proves the table, the UNIQUE and the append-only trigger.
// What is worth testing HERE is the ladder: which rung answers, when the rung
// DECLINES, and — the one that matters most — that a dedupe candidate is never
// resolved to an arbitrary winner. Those are pure decisions over query results,
// so a fake connection reaches them without a database and without hiding them
// inside a suite that skips when Postgres is absent.
import { describe, expect, it } from "vitest";
import type { Tx } from "../src/db.js";
import { readResolutions, resolveConfirmationIdentity } from "../src/services/identityResolution.js";

interface Recorded {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * A connection that answers by SQL shape. Deliberately dumb: it matches on the
 * table each query names, because the point is to drive the DECISION branches,
 * not to re-implement Postgres.
 */
function fakeTx(answers: {
  corpus?: string | null;
  externalId?: string[];
  signature?: string[];
  insertReturns?: boolean;
  resolutions?: Record<string, string>[];
}): { tx: Tx; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const query = async (sql: string, params: readonly unknown[] = []): Promise<{ rows: unknown[] }> => {
    calls.push({ sql, params });
    if (sql.includes("FROM corpus_version") && sql.includes("LIMIT 1")) {
      return {
        rows: answers.corpus === null || answers.corpus === undefined ? [] : [{ id: answers.corpus }],
      };
    }
    if (sql.includes("FROM edition_external_id")) {
      return { rows: (answers.externalId ?? []).map((edition_lcid) => ({ edition_lcid })) };
    }
    if (sql.includes("FROM edition_signature")) {
      return { rows: (answers.signature ?? []).map((edition_lcid) => ({ edition_lcid })) };
    }
    if (sql.includes("INSERT INTO identity_resolution")) {
      return { rows: answers.insertReturns === false ? [] : [{ id: "resolution-1" }] };
    }
    if (sql.includes("FROM identity_resolution")) {
      return { rows: answers.resolutions ?? [] };
    }
    throw new Error(`fakeTx: unexpected query ${sql}`);
  };
  return { tx: { query } as unknown as Tx, calls };
}

const request = {
  shopId: "shop-1",
  humanConfirmationId: "conf-1",
  vertical: "comic",
  resolvedBy: "test",
  confirmedIssue: { title: "Amazing Spider-Man", issue: "300", variant: "direct" },
};

describe("the resolution ladder (047 §9.1)", () => {
  it("declines when no corpus has ever been built — the catalog has said nothing", () => {
    // Not an error: the pipeline predates the catalog by design, and 030 §12
    // leaves whether pre-catalog confirmations are ever resolved to E06.
    return expect(resolveConfirmationIdentity(fakeTx({ corpus: null }).tx, request)).resolves.toEqual({
      status: "skipped",
      reason: "no_corpus",
    });
  });

  it("resolves through a BARCODE alias when one is on the claim, and calls it `barcode`", async () => {
    const { tx, calls } = fakeTx({ corpus: "c1", externalId: ["lb.e.x"] });
    const out = await resolveConfirmationIdentity(tx, {
      ...request,
      confirmedIssue: { ...request.confirmedIssue, upc: "759606043002" },
    });
    expect(out).toMatchObject({ status: "resolved", editionLcid: "lb.e.x", method: "barcode" });
    // The strongest rung ANSWERED, so the signature read never happened —
    // 014 §4.3's "exact identifiers win".
    expect(calls.some((c) => c.sql.includes("FROM edition_signature"))).toBe(false);
  });

  it("accepts a barcode under `barcode` as well as `upc`, and trims it", async () => {
    const { tx, calls } = fakeTx({ corpus: "c1", externalId: ["lb.e.x"] });
    await resolveConfirmationIdentity(tx, {
      ...request,
      confirmedIssue: { ...request.confirmedIssue, barcode: "  759606043002 " },
    });
    const alias = calls.find((c) => c.sql.includes("FROM edition_external_id"))!;
    expect(alias.params).toContain("759606043002");
  });

  it("STOPS at an ambiguous barcode instead of falling through to the signature", async () => {
    // Falling through would answer a question the strongest available evidence
    // just refused to answer, and the fallback would look like a clean
    // resolution in the row.
    const { tx, calls } = fakeTx({ corpus: "c1", externalId: ["lb.e.a", "lb.e.b"], signature: ["lb.e.c"] });
    const out = await resolveConfirmationIdentity(tx, {
      ...request,
      confirmedIssue: { ...request.confirmedIssue, upc: "759606043002" },
    });
    expect(out).toEqual({ status: "skipped", reason: "ambiguous", editionLcids: ["lb.e.a", "lb.e.b"] });
    expect(calls.some((c) => c.sql.includes("FROM edition_signature"))).toBe(false);
    expect(calls.some((c) => c.sql.includes("INSERT INTO identity_resolution"))).toBe(false);
  });

  it("resolves through the SIGNATURE when no barcode is on the claim", async () => {
    const { tx } = fakeTx({ corpus: "c1", signature: ["lb.e.y"] });
    await expect(resolveConfirmationIdentity(tx, request)).resolves.toMatchObject({
      status: "resolved",
      editionLcid: "lb.e.y",
      method: "signature",
    });
  });

  // THE ONE THAT MATTERS MOST. 030 §3.3: two rows with the same signature are a
  // dedupe candidate — "a human-queue item … never an automatic merge".
  it("DECLINES a signature that names two editions, and writes no row", async () => {
    const { tx, calls } = fakeTx({ corpus: "c1", signature: ["lb.e.a", "lb.e.b"] });
    const out = await resolveConfirmationIdentity(tx, request);
    expect(out).toEqual({ status: "skipped", reason: "ambiguous", editionLcids: ["lb.e.a", "lb.e.b"] });
    expect(calls.some((c) => c.sql.includes("INSERT INTO identity_resolution"))).toBe(false);
  });

  it("declines a claim with neither a series nor an issue", async () => {
    const { tx } = fakeTx({ corpus: "c1" });
    await expect(
      resolveConfirmationIdentity(tx, { ...request, confirmedIssue: { publisher: "Marvel" } })
    ).resolves.toEqual({ status: "skipped", reason: "unusable_claim" });
  });

  // E04-B03, and the reason it is here rather than only one layer down: this file
  // is the ONLY place that drives `resolveConfirmationIdentity` itself, and until
  // now every case ran with `vertical: "comic"`. The defect the bead found lived
  // exactly here — `!fields.series && !fields.issue` asked the COMIC question of
  // every vertical, so a card claim (which carries neither key) was skipped as
  // `unusable_claim` on every call, silently. `isUsableClaim` now asks the PACK.
  // A card case that reaches the signature read is what makes that regression
  // visible in the layer where it happened.
  it("carries a CARD claim to the signature read instead of calling it unusable (E04-B03)", async () => {
    const { tx, calls } = fakeTx({ corpus: "c1", signature: ["lb.e.card"] });
    const out = await resolveConfirmationIdentity(tx, {
      ...request,
      vertical: "sports-card",
      confirmedIssue: { set: "1986 Topps", number: "661", language: "en" },
    });
    expect(out).toMatchObject({ status: "resolved", editionLcid: "lb.e.card", method: "signature" });
    const read = calls.find((c) => c.sql.includes("FROM edition_signature"))!;
    // The vertical reaches the query, and the signature is the CARD pack's five
    // positions — not four comic fields normalised to empty.
    expect(read.params).toContain("sports-card");
    expect(read.params).toContain(["1986 topps", "661", "", "", "en"].join(""));
  });

  it("still declines a card claim that names neither a set nor a number", async () => {
    const { tx } = fakeTx({ corpus: "c1" });
    await expect(
      resolveConfirmationIdentity(tx, {
        ...request,
        vertical: "sports-card",
        confirmedIssue: { parallel: "Gold" },
      })
    ).resolves.toEqual({ status: "skipped", reason: "unusable_claim" });
  });

  it("reports no_match when the catalog simply does not have the book", async () => {
    const { tx } = fakeTx({ corpus: "c1", signature: [] });
    await expect(resolveConfirmationIdentity(tx, request)).resolves.toEqual({
      status: "skipped",
      reason: "no_match",
    });
  });

  it("honours an explicit corpus version instead of reading the newest", async () => {
    const { tx, calls } = fakeTx({ corpus: "newest", signature: ["lb.e.y"] });
    const out = await resolveConfirmationIdentity(tx, { ...request, corpusVersionId: "older" });
    expect(out).toMatchObject({ corpusVersionId: "older" });
    // An eval replay asks about a PAST world; reading "newest" anyway would make
    // the replay a measurement of today's catalog.
    expect(calls.some((c) => c.sql.includes("ORDER BY built_at DESC"))).toBe(false);
  });
});

describe("the append (030 §7.1's at-most-once-per-corpus)", () => {
  it("reports already_resolved when the UNIQUE swallows the insert", async () => {
    // A second resolution in the same corpus version is the constraint doing its
    // job, not an error — and `ON CONFLICT DO NOTHING` keeps the caller's
    // transaction alive where a raised 23505 would poison it.
    const { tx } = fakeTx({ corpus: "c1", signature: ["lb.e.y"], insertReturns: false });
    await expect(resolveConfirmationIdentity(tx, request)).resolves.toEqual({
      status: "already_resolved",
      corpusVersionId: "c1",
    });
  });

  it("never writes a confidence — both rungs are deterministic (019 T7, 022 P1)", async () => {
    const { tx, calls } = fakeTx({ corpus: "c1", signature: ["lb.e.y"] });
    await resolveConfirmationIdentity(tx, request);
    const insert = calls.find((c) => c.sql.includes("INSERT INTO identity_resolution"))!;
    expect(insert.sql).not.toContain("confidence");
  });

  it("stores the LCID AS STATED — nothing here resolves forward (047 §9.2, I9)", async () => {
    const { tx, calls } = fakeTx({ corpus: "c1", signature: ["lb.e.y"] });
    await resolveConfirmationIdentity(tx, request);
    const insert = calls.find((c) => c.sql.includes("INSERT INTO identity_resolution"))!;
    expect(insert.params).toContain("lb.e.y");
    // A survivor lookup here would silently restate what a person confirmed.
    expect(calls.some((c) => c.sql.includes("lcid_current_survivor"))).toBe(false);
  });
});

describe("readResolutions — a trail read", () => {
  it("maps the row shape and orders newest corpus first", async () => {
    const { tx, calls } = fakeTx({
      resolutions: [
        { id: "r2", edition_lcid: "lb.e.b", method: "signature", corpus_version_id: "c2" },
        { id: "r1", edition_lcid: "lb.e.a", method: "barcode", corpus_version_id: "c1" },
      ],
    });
    const rows = await readResolutions(tx, "shop-1", "conf-1");
    expect(rows).toEqual([
      { id: "r2", editionLcid: "lb.e.b", method: "signature", corpusVersionId: "c2" },
      { id: "r1", editionLcid: "lb.e.a", method: "barcode", corpusVersionId: "c1" },
    ]);
    expect(calls[0]!.sql).toContain("ORDER BY c.built_at DESC");
  });
});
