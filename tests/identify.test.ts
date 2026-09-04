// Identify orchestration (R4/R6/R7/R8): barcode-first, vision candidates,
// contradiction gate, band assignment, cost logging — against a fake pool and
// a fake provider (the provider adapters have their own transport tests).
import { describe, expect, it } from "vitest";
import { runIdentify } from "../src/services/identify.js";
import type { IdentifyResult, VisionProvider } from "../src/providers/types.js";
import { fakePool } from "./fakes.js";

const BANDS = { high: 0.85, medium: 0.5 };
// "036000291452" is a check-digit-valid UPC-A; "00311" = issue 003, cover 1, printing 1.
const VALID_UPC_SUPP = "036000291452 00311";
// The same UPC with a supplement naming issue 300 — the barcode AGREES with the
// `okResult` candidate, which E06-D01 requires before any result reaches `high`.
const UPC_AGREEING_WITH_300 = "036000291452 30011";

/** Three readable evidence fields that agree with the candidate: the honest case. */
const COMPLETE_EVIDENCE = {
  issue_number_read: "#300",
  price_box_text: "$1.00 US",
  logo_era_guess: "1980s",
};

function fakeProvider(result: IdentifyResult): VisionProvider {
  return {
    id: "anthropic",
    model: "claude-sonnet-5",
    identify: async () => result,
  };
}

function okResult(overrides: Partial<Extract<IdentifyResult, { ok: true }>> = {}): IdentifyResult {
  return {
    ok: true,
    ranked: [{ title: "Amazing Spider-Man", issue: "300", year: 1988, confidence: 0.92 }],
    evidence: { issue_number_read: null, price_box_text: null, logo_era_guess: null },
    confidence: 0.92,
    raw: { fake: true },
    usage: { tokensIn: 1000, tokensOut: 500 },
    ...overrides,
  };
}

/** Pool wired for the happy path: candidate_set inserts return ids, photos exist. */
function identifyPool(photos: Array<{ id: string; kind: string; storage_url: string }>) {
  let csCount = 0;
  return fakePool((text) => {
    if (text.includes("INSERT INTO candidate_set")) return { rows: [{ id: `cs-${++csCount}` }] };
    // 042 §6.3 / I13: the rerank INSERT now carries `RETURNING id`, because a
    // client instructed to send the record it was shown needs that id.
    if (text.includes("INSERT INTO llm_rerank")) return { rows: [{ id: "rr-1" }] };
    if (text.includes("FROM scan_photo")) return { rows: photos };
    return undefined;
  });
}

const coverPhoto = { id: "p1", kind: "cover", storage_url: "uploads/s/cover.jpg" };

describe("runIdentify", () => {
  it("records a barcode candidate_set first when the UPC parses (R4)", async () => {
    const { pool, calls } = identifyPool([coverPhoto]);
    const out = await runIdentify(pool, {
      shopId: "shop-1",
      sessionId: "s-1",
      provider: fakeProvider(okResult()),
      bands: BANDS,
      uploadsDir: "uploads",
      barcodeDigits: VALID_UPC_SUPP,
    });
    expect(out.candidateSetIds).toEqual(["cs-1", "cs-2"]);
    expect(out.llmRerankId).toBe("rr-1");
    expect(out.barcode).toMatchObject({
      ok: true,
      upc: "036000291452",
      supplement: { issue: 3, cover: 1, printing: 1 },
    });
    const barcodeInsert = calls.find((c) => c.text.includes("'barcode'"));
    expect(barcodeInsert?.values?.[3]).toBe(VALID_UPC_SUPP);
  });

  it("skips the barcode candidate_set on an invalid check digit but keeps the parse error", async () => {
    const { pool } = identifyPool([coverPhoto]);
    const out = await runIdentify(pool, {
      shopId: "shop-1",
      sessionId: "s-1",
      provider: fakeProvider(okResult()),
      bands: BANDS,
      uploadsDir: "uploads",
      barcodeDigits: "036000291453", // bad check digit
    });
    expect(out.candidateSetIds).toEqual(["cs-1"]); // vision set only
    expect(out.barcode).toMatchObject({ ok: false });
  });

  it("returns a low-band error outcome when the session has no photos", async () => {
    const { pool } = identifyPool([]);
    const out = await runIdentify(pool, {
      shopId: "shop-1",
      sessionId: "s-1",
      provider: fakeProvider(okResult()),
      bands: BANDS,
      uploadsDir: "uploads",
    });
    expect(out.error).toMatch(/no cover\/barcode photos/);
    expect(out.band).toBe("low");
    expect(out.candidates).toEqual([]);
  });

  it("surfaces provider transport failures without inserting a vision set", async () => {
    const { pool, calls } = identifyPool([coverPhoto]);
    const out = await runIdentify(pool, {
      shopId: "shop-1",
      sessionId: "s-1",
      provider: fakeProvider({ ok: false, status: 429, error: "rate limited" }),
      bands: BANDS,
      uploadsDir: "uploads",
    });
    expect(out.error).toBe("provider error (status 429): rate limited");
    expect(calls.some((c) => c.text.includes("'llm_vision'"))).toBe(false);
  });

  it("assigns the high band and logs cost + rerank on a clean identify (R6/R8/R13)", async () => {
    const { pool, calls } = identifyPool([
      coverPhoto,
      { id: "p2", kind: "barcode", storage_url: "uploads/s/barcode.png" },
    ]);
    const out = await runIdentify(pool, {
      shopId: "shop-1",
      sessionId: "s-1",
      // E06-D01 — "clean" now means what the SERVER can corroborate: three
      // readable evidence fields and a barcode that agrees, not a number the
      // model chose. The old version of this test passed with all three evidence
      // fields null, which is the payload 046 finding R-3 is about.
      provider: fakeProvider(okResult({ evidence: COMPLETE_EVIDENCE })),
      bands: BANDS,
      uploadsDir: "uploads",
      barcodeDigits: UPC_AGREEING_WITH_300,
    });
    expect(out.band).toBe("high");
    expect(out.contradiction).toBe(false);
    expect(out.confidence).toBe(0.92);
    expect(out.costUsd).toBeCloseTo(0.0105, 10); // 1000 in + 500 out on claude-sonnet-5

    const costInsert = calls.find((c) => c.text.includes("INSERT INTO cost_log"));
    expect(costInsert?.values).toEqual([
      "shop-1",
      "s-1",
      "anthropic",
      "claude-sonnet-5",
      1000,
      500,
      out.costUsd,
      // outbox_id: null — a REQUEST spent this, not a job (043 §8.1, 030 A1).
      null,
      // credential_version_id: null — this fixture's caller passed none, so no
      // live per-shop version resolved the call (050 §6.2).
      null,
      // …and `spend_owner` is DERIVED from exactly that (050 §2 Q4(a)). It is
      // present on EVERY row: 050 §1 E12's ledger that mixed two people's money
      // is what this column ends.
      "longbox",
    ]);

    const rerankInsert = calls.find((c) => c.text.includes("INSERT INTO llm_rerank"));
    expect(rerankInsert).toBeDefined();
    const v = rerankInsert!.values!;
    expect(v[0]).toBe("cs-2"); // FK to the vision candidate_set (cs-1 is the barcode set)
    expect(v[3]).toBe("anthropic");
    expect(v[4]).toBe("claude-sonnet-5");
    expect(typeof v[5]).toBe("string"); // prompt hash
    expect(v[8]).toBe("high");
    expect(v[9]).toBe(false); // contradiction
    // E06-D01 — the derivation's inputs land on the same immutable row as the
    // conclusion, so 019 T3 is sliceable by evidence completeness.
    const inputs = JSON.parse(v[13] as string) as Record<string, unknown>;
    expect(inputs["band"]).toBe("high");
    expect(inputs["evidence_missing"]).toEqual([]);
    expect(inputs["barcode_agreement"]).toBe("agree");
    expect(inputs["model_confidence"]).toBe(0.92);
  });

  it("downgrades a high-confidence result to medium on evidence contradiction (R7)", async () => {
    const { pool, calls } = identifyPool([coverPhoto]);
    const out = await runIdentify(pool, {
      shopId: "shop-1",
      sessionId: "s-1",
      provider: fakeProvider(okResult({ evidence: { ...COMPLETE_EVIDENCE, issue_number_read: "#301" } })),
      bands: BANDS,
      uploadsDir: "uploads",
      barcodeDigits: UPC_AGREEING_WITH_300,
    });
    expect(out.contradiction).toBe(true);
    expect(out.contradictionReasons[0]).toMatch(/issue_number_read/);
    expect(out.band).toBe("medium"); // never one-tap on a self-contradicting read
    const rerankInsert = calls.find((c) => c.text.includes("INSERT INTO llm_rerank"));
    expect(rerankInsert?.values?.[8]).toBe("medium");
    expect(rerankInsert?.values?.[9]).toBe(true);
  });

  // ── E06-D01 ──────────────────────────────────────────────────────────────
  it("refuses the high band to the 046 R-3 payload: null evidence, maximum confidence", async () => {
    const { pool, calls } = identifyPool([coverPhoto]);
    const out = await runIdentify(pool, {
      shopId: "shop-1",
      sessionId: "s-1",
      // Exactly the payload the finding names. It validates, it raises no
      // contradiction, and before this bead it took the one-tap path.
      provider: fakeProvider(
        okResult({
          evidence: { issue_number_read: null, price_box_text: null, logo_era_guess: null },
          confidence: 0.99,
        })
      ),
      bands: BANDS,
      uploadsDir: "uploads",
      barcodeDigits: UPC_AGREEING_WITH_300,
    });
    expect(out.band).toBe("low");
    expect(out.contradiction).toBe(false); // the gate is silent — that WAS the defect
    const inputs = JSON.parse(
      calls.find((c) => c.text.includes("INSERT INTO llm_rerank"))!.values!.at(-1) as string
    ) as Record<string, unknown>;
    expect(inputs["evidence_missing"]).toHaveLength(3);
    expect(inputs["model_confidence"]).toBe(0.99);
  });

  it("caps at medium when the barcode is unavailable, however complete the evidence", async () => {
    const { pool } = identifyPool([coverPhoto]);
    const out = await runIdentify(pool, {
      shopId: "shop-1",
      sessionId: "s-1",
      provider: fakeProvider(okResult({ evidence: COMPLETE_EVIDENCE })),
      bands: BANDS,
      uploadsDir: "uploads",
    });
    expect(out.band).toBe("medium");
  });

  it("records a null confidence rather than refusing a model that reported none", async () => {
    const { pool, calls } = identifyPool([coverPhoto]);
    const out = await runIdentify(pool, {
      shopId: "shop-1",
      sessionId: "s-1",
      provider: fakeProvider(okResult({ evidence: COMPLETE_EVIDENCE, confidence: null })),
      bands: BANDS,
      uploadsDir: "uploads",
      barcodeDigits: UPC_AGREEING_WITH_300,
    });
    expect(out.confidence).toBeNull();
    expect(out.band).toBe("high"); // the omission costs nothing; it was never trusted
    expect(calls.find((c) => c.text.includes("INSERT INTO llm_rerank"))?.values?.[7]).toBeNull();
  });
});
