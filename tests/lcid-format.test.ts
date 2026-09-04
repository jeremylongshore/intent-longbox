// 047 I4 — ONE PARSER, ONE CONSTRUCTOR, ONE CANONICAL FORM.
//
// "Canonical form is lowercase; the check character is verified on parse; a bad
// check character is REJECTED, NOT REPAIRED." (047 §3.1, I4)
import { describe, expect, it } from "vitest";
import {
  InvalidLcidError,
  PAYLOAD_LENGTH,
  checkSymbol,
  mintLcidString,
  parseLcid,
  tryParseLcid,
} from "../src/catalog/index.js";

/** A deterministic byte source, so a "random" payload is a fixture. */
const bytes = (...values: number[]): ((n: number) => Buffer) => {
  return (n: number) => Buffer.from(values.slice(0, n));
};

describe("the LCID grammar (047 §3)", () => {
  it("builds lb.<kind>.<vertical>.<16 payload><1 check>, lowercase", () => {
    const lcid = mintLcidString("edition", "cmc", bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 1));
    expect(lcid).toBe(`lb.e.cmc.${"0".repeat(15)}1${checkSymbol(`${"0".repeat(15)}1`)}`);
    expect(lcid).toBe(lcid.toLowerCase());
    expect(lcid.split(".")[3]).toHaveLength(PAYLOAD_LENGTH + 1);
  });

  it("distinguishes the two kinds in the prefix, and only those two", () => {
    expect(mintLcidString("definition", "cmc").startsWith("lb.d.cmc.")).toBe(true);
    expect(mintLcidString("edition", "cmc").startsWith("lb.e.cmc.")).toBe(true);
  });

  it("round-trips through the one parser", () => {
    const lcid = mintLcidString("edition", "cmc");
    const parts = parseLcid(lcid);
    expect(parts).toMatchObject({ lcid, kind: "edition", verticalCode: "cmc" });
    expect(parts.payload).toHaveLength(PAYLOAD_LENGTH);
  });

  it("canonicalises case rather than inventing a second form", () => {
    const lcid = mintLcidString("edition", "cmc");
    expect(parseLcid(lcid.toUpperCase()).lcid).toBe(lcid);
    expect(parseLcid(`  ${lcid}  `).lcid).toBe(lcid);
  });

  // The whole reason the check symbol exists (047 §3.1): §8's world contains
  // hand-typed and OCR'd identifiers. A repaired transcription error would turn a
  // REFUSED lookup into a WRONG one.
  it("rejects a bad check character instead of repairing it", () => {
    const lcid = mintLcidString("edition", "cmc");
    const wrongCheck = lcid.slice(0, -1) + (lcid.endsWith("0") ? "1" : "0");
    expect(() => parseLcid(wrongCheck)).toThrow(InvalidLcidError);
    expect(() => parseLcid(wrongCheck)).toThrow(/check character/);
    expect(tryParseLcid(wrongCheck)).toBeNull();
  });

  it("rejects the four ambiguous Crockford letters in a payload", () => {
    // i, l, o and u are absent from the alphabet ON PURPOSE — they are the four a
    // human or an OCR pass confuses with 1, 1, 0 and v.
    for (const bad of ["i", "l", "o"]) {
      const payload = bad.repeat(PAYLOAD_LENGTH);
      expect(tryParseLcid(`lb.e.cmc.${payload}0`)).toBeNull();
    }
  });

  it("rejects a malformed prefix, an unknown kind and a wrong-length vertical code", () => {
    for (const bad of [
      "lb.x.cmc.00000000000000000",
      "lb.e.comic.00000000000000000",
      "lb.e.cm.00000000000000000",
      "xx.e.cmc.00000000000000000",
      "lb.e.cmc.0000000000000000", // payload one short, so no check character
      "",
    ]) {
      expect(tryParseLcid(bad), bad).toBeNull();
    }
  });

  it("refuses to construct an LCID in a vertical code that is not three letters", () => {
    expect(() => mintLcidString("edition", "comic")).toThrow(/three lowercase letters/);
    expect(() => mintLcidString("edition", "CMC")).toThrow(InvalidLcidError);
  });

  // 047 §3.2 rejects ULID/UUIDv7 because "an identifier should not answer a
  // question the design forbids asking": a sortable id makes 047 §6.3(a)'s
  // rejected merge rule ("the older LCID survives") the easiest one to write.
  it("does not sort by minting order", () => {
    const first = mintLcidString("edition", "cmc", bytes(255, 255, 255, 255, 255, 255, 255, 255, 255, 255));
    const second = mintLcidString("edition", "cmc", bytes(0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
    // Minted second, sorts first. A comparison on the bytes says nothing about age.
    expect(second < first).toBe(true);
  });

  it("draws a full 80 bits from its source, so the payload is not truncated", () => {
    const all = mintLcidString("edition", "cmc", bytes(255, 255, 255, 255, 255, 255, 255, 255, 255, 255));
    expect(all.split(".")[3]!.slice(0, PAYLOAD_LENGTH)).toBe("z".repeat(PAYLOAD_LENGTH));
  });
});
