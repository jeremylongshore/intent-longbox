// Shared provider plumbing: payload validation, re-rank prompt building,
// base64 encoding, and reasoning-model JSON extraction.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildUserText, imageToBase64, toIdentifyResult } from "../src/providers/shared.js";
import { IDENTIFY_PROMPT, parseModelJson } from "../src/providers/types.js";

const usage = { tokensIn: 10, tokensOut: 20 };

describe("toIdentifyResult", () => {
  it("accepts a valid payload and normalizes optional fields", () => {
    const result = toIdentifyResult(
      {
        candidates: [
          { title: "ASM", issue: "300", publisher: "Marvel", year: 1988, variant: null, confidence: 0.9 },
        ],
        evidence: { issue_number_read: "#300", price_box_text: "$1.00 US", logo_era_guess: "1980s" },
        confidence: 0.9,
      },
      { raw: 1 },
      usage
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ranked[0]).toEqual({
        title: "ASM",
        issue: "300",
        publisher: "Marvel",
        year: 1988,
        confidence: 0.9,
      });
      expect(result.ranked[0]).not.toHaveProperty("variant"); // null variant dropped
      expect(result.evidence.issue_number_read).toBe("#300");
      expect(result.usage).toEqual(usage);
    }
  });

  it("rejects payloads missing the REQUIRED evidence block (R7) as a 502", () => {
    const result = toIdentifyResult(
      { candidates: [{ title: "ASM", issue: "300", confidence: 0.9 }], confidence: 0.9 },
      {},
      usage
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toMatch(/failed validation/);
    }
  });

  it("rejects out-of-range confidence", () => {
    const result = toIdentifyResult(
      {
        candidates: [{ title: "ASM", issue: "300", confidence: 1.5 }],
        evidence: { issue_number_read: null, price_box_text: null, logo_era_guess: null },
        confidence: 0.9,
      },
      {},
      usage
    );
    expect(result.ok).toBe(false);
  });
});

describe("buildUserText", () => {
  it("returns the bare prompt when there are no candidates", () => {
    expect(buildUserText(IDENTIFY_PROMPT, { images: [] })).toBe(IDENTIFY_PROMPT);
  });
  it("appends candidate metadata for re-rank mode", () => {
    const text = buildUserText(IDENTIFY_PROMPT, {
      images: [],
      candidates: [{ title: "ASM", issue: "300" }],
    });
    expect(text).toContain(IDENTIFY_PROMPT);
    expect(text).toContain("Candidate metadata to re-rank");
    expect(text).toContain('"issue": "300"');
  });
});

describe("imageToBase64", () => {
  const dir = mkdtempSync(join(tmpdir(), "longbox-img-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("round-trips file bytes to base64", () => {
    const path = join(dir, "px.jpg");
    writeFileSync(path, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(Buffer.from(imageToBase64(path), "base64")).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  });
});

describe("parseModelJson", () => {
  it("parses a plain JSON object", () => {
    expect(parseModelJson('{"a": 1}')).toEqual({ a: 1 });
  });
  it("strips <think> blocks and surrounding prose (reasoning models)", () => {
    expect(parseModelJson('<think>hmm {not json}</think>Sure! {"a": 1} hope that helps')).toEqual({ a: 1 });
  });
  it("throws when no JSON object is present", () => {
    expect(() => parseModelJson("no json here")).toThrow(/no JSON object found/);
  });
});
