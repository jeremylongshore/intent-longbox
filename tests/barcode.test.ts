import { describe, expect, it } from "vitest";
import { parseComicBarcode, upcCheckDigitValid } from "../src/services/barcode.js";

// 03600029145 → check digit 2 (valid example UPC-A: 036000291452)
const VALID_UPC = "036000291452";

describe("upcCheckDigitValid", () => {
  it("accepts a valid UPC-A", () => {
    expect(upcCheckDigitValid(VALID_UPC)).toBe(true);
  });
  it("rejects a corrupted check digit", () => {
    expect(upcCheckDigitValid("036000291453")).toBe(false);
  });
  it("rejects wrong lengths and non-digits", () => {
    expect(upcCheckDigitValid("12345")).toBe(false);
    expect(upcCheckDigitValid("03600029145a")).toBe(false);
  });
});

describe("parseComicBarcode", () => {
  it("parses a bare 12-digit UPC-A", () => {
    const r = parseComicBarcode(VALID_UPC);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.upc).toBe(VALID_UPC);
      expect(r.supplement).toBeUndefined();
    }
  });

  it("parses UPC-A + 5-digit supplement into issue/cover/printing", () => {
    const r = parseComicBarcode(`${VALID_UPC}12111`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.supplement).toEqual({ raw: "12111", issue: 121, cover: 1, printing: 1 });
    }
  });

  it("tolerates spaces and hyphens", () => {
    const r = parseComicBarcode(`0-36000-29145-2 00311`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.supplement?.issue).toBe(3);
      expect(r.supplement?.cover).toBe(1);
      expect(r.supplement?.printing).toBe(1);
    }
  });

  it("rejects bad check digit", () => {
    const r = parseComicBarcode("036000291453");
    expect(r.ok).toBe(false);
  });

  it("rejects odd lengths", () => {
    const r = parseComicBarcode("0360002914521");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("expected 12");
  });

  it("rejects non-digits", () => {
    expect(parseComicBarcode("hello").ok).toBe(false);
  });
});
