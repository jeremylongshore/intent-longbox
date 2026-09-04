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
      provider: fakeProvider(okResult()),
      bands: BANDS,
      uploadsDir: "uploads",
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
    ]);

    const rerankInsert = calls.find((c) => c.text.includes("INSERT INTO llm_rerank"));
    expect(rerankInsert).toBeDefined();
    const v = rerankInsert!.values!;
    expect(v[0]).toBe("cs-1"); // FK to the vision candidate_set
    expect(v[3]).toBe("anthropic");
    expect(v[4]).toBe("claude-sonnet-5");
    expect(typeof v[5]).toBe("string"); // prompt hash
    expect(v[8]).toBe("high");
    expect(v[9]).toBe(false); // contradiction
  });

  it("downgrades a high-confidence result to medium on evidence contradiction (R7)", async () => {
    const { pool, calls } = identifyPool([coverPhoto]);
    const out = await runIdentify(pool, {
      shopId: "shop-1",
      sessionId: "s-1",
      provider: fakeProvider(
        okResult({
          evidence: { issue_number_read: "#301", price_box_text: null, logo_era_guess: null },
        })
      ),
      bands: BANDS,
      uploadsDir: "uploads",
    });
    expect(out.contradiction).toBe(true);
    expect(out.contradictionReasons[0]).toMatch(/issue_number_read/);
    expect(out.band).toBe("medium"); // never one-tap on a self-contradicting read
    const rerankInsert = calls.find((c) => c.text.includes("INSERT INTO llm_rerank"));
    expect(rerankInsert?.values?.[8]).toBe("medium");
    expect(rerankInsert?.values?.[9]).toBe(true);
  });
});
