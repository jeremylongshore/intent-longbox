// `edition_signature` — the field list, the normalisation, and the separation
// from `identityKey` that 047 §9.3 and A8 make load-bearing.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NORMALIZATION_VERSION,
  UnregisteredVerticalError,
  comicEditionSignature,
  editionSignature,
  normalizeField,
  normalizeIssue,
} from "../src/catalog/index.js";
import { identityKey } from "../src/services/confirmationOutcome.js";

describe("the comic edition signature (030 §3.3)", () => {
  it("is series + issue + variant + printing — 030's ratified four", () => {
    const sig = comicEditionSignature({
      series: "Amazing Spider-Man",
      issue: "300",
      variant: "direct",
      printing: "1",
    });
    expect(sig.split("\u001f")).toEqual(["amazing spider-man", "300", "direct", "1"]);
  });

  it("normalises case, surrounding and internal whitespace, and a leading hash", () => {
    const messy = comicEditionSignature({
      series: "  AMAZING   Spider-Man ",
      issue: "#300",
      variant: "Direct",
      printing: " 1 ",
    });
    const clean = comicEditionSignature({
      series: "Amazing Spider-Man",
      issue: "300",
      variant: "direct",
      printing: "1",
    });
    expect(messy).toBe(clean);
  });

  it("treats missing, null and empty as the same claim", () => {
    const a = comicEditionSignature({ series: "X", issue: "1" });
    const b = comicEditionSignature({ series: "X", issue: "1", variant: null, printing: "  " });
    expect(a).toBe(b);
  });

  it("separates fields with a character no normalised field can contain", () => {
    // Without this the pair ("ab", "") and ("a", "b") would collide, and two
    // different editions would dedupe into one.
    const joined = comicEditionSignature({ series: "ab", issue: "" });
    const split = comicEditionSignature({ series: "a", issue: "b" });
    expect(joined).not.toBe(split);
  });

  it("is deterministic — the same fields yield the same string every time", () => {
    const fields = { series: "Saga", issue: "1", variant: "cover a", printing: "1" };
    const runs = new Set(Array.from({ length: 25 }, () => comicEditionSignature(fields)));
    expect(runs.size).toBe(1);
  });

  it("fails closed on an unregistered vertical rather than defaulting to comic", () => {
    // 030 §6 rule 3, stated as a prohibition because §8 has to test it.
    //
    // ⚠ THE STAND-IN USED TO BE `"sports-card"`, AND E04-B03 REGISTERED IT. The
    // rule under test is "an unregistered vertical is refused", not "cards are
    // refused", so the fixture moved to a vertical nothing has built — a test that
    // silently starts asserting something else the day a pack lands is worse than
    // one that fails.
    expect(() => editionSignature("coin", {})).toThrow(UnregisteredVerticalError);
    expect(editionSignature("comic", { series: "X", issue: "1" })).toBe(
      comicEditionSignature({ series: "X", issue: "1" })
    );
  });

  it("carries a normalisation version, so a rule change is a new row and not a rewrite", () => {
    expect(NORMALIZATION_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(NORMALIZATION_VERSION)).toBe(true);
  });

  it("normalises a field and an issue by the same rules bar the leading hash", () => {
    expect(normalizeField(" A  B ")).toBe("a b");
    expect(normalizeIssue(" ## 300 ")).toBe("300");
    expect(normalizeField(undefined)).toBe("");
  });
});

// 047 A8, first half. The full static guard — a dependency-cruiser rule plus a
// PR-level check that touching both functions without a 000-docs/006 row FAILS —
// is E04-B02's acceptance line and is NOT built here. What IS built here is the
// property that makes the mechanical merge unavailable.
describe("edition_signature and identityKey are two functions (047 §9.3, A8)", () => {
  it("share no field-list constant and no import edge", () => {
    const source = readFileSync(new URL("../src/catalog/editionSignature.ts", import.meta.url), "utf8");
    // No import edge in either direction. `catalog-is-a-leaf` in
    // .dependency-cruiser.cjs enforces the general rule; this is the specific one.
    expect(source).not.toMatch(/from\s+["'][^"']*services\//);
    // And no exported field-list constant for a workflow-side function to import.
    // A8's mechanical failure mode is exactly one exported `FIELDS` array with two
    // importers; the comic field list is an inline literal inside the function
    // instead, so there is nothing to share.
    expect(source).not.toMatch(/export\s+const\s+\w*FIELDS/);
    // The name appears ONLY in the header comment explaining the separation. If it
    // ever appears in code, the two functions have started to converge.
    const code = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
      .join("\n");
    expect(code).not.toMatch(/identityKey/);
  });

  it("disagree on the fields, which is the whole point", () => {
    // identityKey: title + issue + variant, deliberately EXCLUDING publisher and
    // year (`confirmationOutcome.ts:44-49`) because including them "would score a
    // plain acceptance as a correction and inflate T3". edition_signature:
    // series + issue + variant + PRINTING, because a printing is a different
    // edition and the barcode has been decoding that digit since v0.
    const shared = { issue: "300", variant: "direct" };
    const key = identityKey({ title: "Amazing Spider-Man", ...shared });
    const firstPrinting = comicEditionSignature({ series: "Amazing Spider-Man", ...shared, printing: "1" });
    const secondPrinting = comicEditionSignature({ series: "Amazing Spider-Man", ...shared, printing: "2" });

    // The catalog can tell two printings apart. The session-scoped outcome
    // function cannot, and must not: to an operator picking between candidates
    // they are the same identity claim.
    expect(firstPrinting).not.toBe(secondPrinting);
    expect(key).not.toBe(firstPrinting);
  });
});
