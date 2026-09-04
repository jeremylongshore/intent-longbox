// The comic identity schema and its normalisation (E04-B02; 030 §3.3, §5.3;
// 047 §2.3, A6; 014 §8's E04-B02 acceptance line: "Attributes resolve a labeled
// set of hard examples (variants, reprints, newsstand vs direct); unknown vs
// absent is preserved").
import { describe, expect, it } from "vitest";
import {
  COMIC_IDENTITY_SCHEMA_VERSION,
  CopyFactInEditionError,
  ProviderKeyInAttributesError,
  UnregisteredVerticalError,
  comicDefinitionSignature,
  comicEditionSignature,
  comicSignatureClaim,
  comicSignatureInput,
  definitionSignature,
  parseIdentityAttributes,
  signatureClaim,
  signatureInput,
} from "../src/catalog/index.js";

const SEP = "";

describe("the normalisation rule, as a table of hard examples (030 §3.3)", () => {
  // TABLE-DRIVEN ON PURPOSE. Each row is a claim about what the rule collapses
  // and what it keeps, and the two columns are the whole content of the rule:
  // a `same` pair must produce one signature, a `differ` pair must produce two.
  // Written as data so a future rule change shows up as a row that flipped
  // rather than as a paragraph somebody has to re-read.
  const same: ReadonlyArray<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["leading and trailing whitespace", { series: "  Saga  ", issue: "1" }, { series: "Saga", issue: "1" }],
    [
      "collapsed internal whitespace",
      { series: "Amazing   Spider-Man", issue: "300" },
      { series: "Amazing Spider-Man", issue: "300" },
    ],
    ["case", { series: "SAGA", issue: "1" }, { series: "saga", issue: "1" }],
    ["a leading hash on the issue", { series: "Saga", issue: "#1" }, { series: "Saga", issue: "1" }],
    ["several leading hashes and a space", { series: "Saga", issue: "## 1" }, { series: "Saga", issue: "1" }],
    [
      "absent, null and blank as one claim",
      { series: "Saga", issue: "1" },
      { series: "Saga", issue: "1", variant: null, printing: "   " },
    ],
    [
      "a 2nd-printing marker written two ways, once normalisation runs",
      { series: "Saga", issue: "1", printing: "2nd Printing" },
      { series: "saga", issue: "1", printing: "  2nd   printing " },
    ],
  ];

  it.each(same)("collapses %s", (_label, a, b) => {
    expect(comicEditionSignature(a)).toBe(comicEditionSignature(b));
  });

  const differ: ReadonlyArray<[string, Record<string, unknown>, Record<string, unknown>]> = [
    [
      "the definite article, which is part of the series name and not punctuation",
      // THE ONE EVERYONE EXPECTS TO COLLAPSE, AND IT MUST NOT. "The Amazing
      // Spider-Man" and "Amazing Spider-Man" are how two corpora spell one
      // series, so the temptation is to strip a leading article. Doing so would
      // also merge "The Question" with "Question" and "The Boys" with "Boys",
      // and it would do it INSIDE the dedupe key where the decision is
      // invisible. Two signatures is the honest answer, and the repair is an
      // ALIAS signature row (030 A4) or a human-reviewed merge — both of which
      // are recoverable, unlike a collapse baked into the rule.
      { series: "The Amazing Spider-Man", issue: "300" },
      { series: "Amazing Spider-Man", issue: "300" },
    ],
    [
      "a printing, which is a different edition",
      { series: "Saga", issue: "1", printing: "1" },
      { series: "Saga", issue: "1", printing: "2" },
    ],
    [
      "a variant suffix on the issue number",
      { series: "Saga", issue: "300a" },
      { series: "Saga", issue: "300" },
    ],
    [
      "a variant designator",
      { series: "Saga", issue: "1", variant: "cover b" },
      { series: "Saga", issue: "1", variant: "cover a" },
    ],
    [
      "a field boundary — 'ab'+'' must not equal 'a'+'b'",
      { series: "ab", issue: "" },
      { series: "a", issue: "b" },
    ],
    [
      "an interior hash, which is data rather than decoration",
      { series: "Saga", issue: "1#2" },
      { series: "Saga", issue: "12" },
    ],
  ];

  it.each(differ)("keeps %s distinct", (_label, a, b) => {
    expect(comicEditionSignature(a)).not.toBe(comicEditionSignature(b));
  });

  it("is the ratified four fields in the ratified order", () => {
    expect(
      comicEditionSignature({ series: "S", issue: "I", variant: "V", printing: "P" }).split(SEP)
    ).toEqual(["s", "i", "v", "p"]);
  });
});

describe("unknown is not absent (the bead's own note)", () => {
  it("keeps an ABSENT key absent through the schema", () => {
    const parsed = parseIdentityAttributes("comic", "edition", { issue: "300" });
    expect("variant" in parsed).toBe(false);
    expect(Object.keys(parsed)).toEqual(["issue"]);
  });

  it("keeps an EXPLICIT null as a stated null", () => {
    const parsed = parseIdentityAttributes("comic", "edition", { issue: "300", variant: null });
    expect("variant" in parsed).toBe(true);
    expect(parsed.variant).toBeNull();
  });

  it("survives the JSON round-trip the jsonb column performs", () => {
    // The distinction is only real if it reaches the database. `JSON.stringify`
    // DROPS an undefined value and PRESERVES a null, which is exactly the
    // behaviour wanted — but only because the schema never materialises
    // `undefined` for an absent key (no `.default()`, no `.optional()` fill).
    const absent = JSON.parse(JSON.stringify(parseIdentityAttributes("comic", "edition", { issue: "1" })));
    const unknown = JSON.parse(
      JSON.stringify(parseIdentityAttributes("comic", "edition", { issue: "1", variant: null }))
    );
    expect("variant" in absent).toBe(false);
    expect("variant" in unknown).toBe(true);
    expect(unknown.variant).toBeNull();
  });

  it("collapses the two in the SIGNATURE, which is the other half of the rule", () => {
    // A dedupe key must not distinguish two records that describe the same book
    // with different degrees of silence.
    expect(comicEditionSignature({ series: "Saga", issue: "1" })).toBe(
      comicEditionSignature({ series: "Saga", issue: "1", variant: null })
    );
  });
});

describe("the labelled hard examples 014 §8 asks for", () => {
  it("accepts newsstand and direct as an edition attribute, outside the signature", () => {
    const newsstand = parseIdentityAttributes("comic", "edition", {
      issue: "300",
      distribution: "newsstand",
    });
    const direct = parseIdentityAttributes("comic", "edition", { issue: "300", distribution: "direct" });
    expect(newsstand.distribution).toBe("newsstand");
    // Distribution is NOT in 030 §3.3's ratified four, so it must not move the
    // signature — widening the signature is an amendment to a ratified record.
    const definition = { series: "Amazing Spider-Man" };
    expect(comicEditionSignature(comicSignatureInput(definition, newsstand))).toBe(
      comicEditionSignature(comicSignatureInput(definition, direct))
    );
  });

  it("refuses a distribution value the schema does not know", () => {
    expect(() => parseIdentityAttributes("comic", "edition", { issue: "1", distribution: "whs" })).toThrow();
  });

  it("carries the barcode's cover and printing digits (030 E10)", () => {
    const parsed = parseIdentityAttributes("comic", "edition", {
      issue: "300",
      cover: "1",
      printing: "1",
    });
    expect(parsed).toMatchObject({ cover: "1", printing: "1" });
  });

  it("refuses a blank series or issue rather than signing an empty field", () => {
    expect(() => parseIdentityAttributes("comic", "definition", { series: "   " })).toThrow();
    expect(() => parseIdentityAttributes("comic", "edition", { issue: "" })).toThrow();
  });
});

describe("what an edition may never carry (047 §2.3, A6; 030 §4 rule 2)", () => {
  it.each(["grader", "cert_number", "certNumber", "grade", "slab", "CONDITION"])(
    "refuses the copy fact %s by name",
    (key) => {
      expect(() => parseIdentityAttributes("comic", "edition", { issue: "1", [key]: "CGC 9.8" })).toThrow(
        CopyFactInEditionError
      );
    }
  );

  it.each(["gcd_id", "metron_id", "pricecharting_id", "ebayid"])(
    "refuses the provider key %s by name",
    (key) => {
      expect(() => parseIdentityAttributes("comic", "edition", { issue: "1", [key]: "123" })).toThrow(
        ProviderKeyInAttributesError
      );
    }
  );

  it("refuses any other unknown key through strictness", () => {
    expect(() => parseIdentityAttributes("comic", "edition", { issue: "1", slabLabel: "x" })).toThrow();
  });

  it("fails closed on an unregistered vertical rather than defaulting to comic", () => {
    expect(() => parseIdentityAttributes("sports-card", "edition", { issue: "1" })).toThrow(
      UnregisteredVerticalError
    );
  });
});

describe("the work-level signature is its own function", () => {
  it("is series + volume, and not the edition function with volume where issue goes", () => {
    expect(comicDefinitionSignature({ series: "Saga", volume: "1" }).split(SEP)).toEqual(["saga", "1"]);
    // Two fields, not four: a work has no issue and no printing.
    expect(comicDefinitionSignature({ series: "Saga" }).split(SEP)).toHaveLength(2);
  });

  it("ignores the publisher, so two corpora attributing a series differently still dedupe", () => {
    expect(comicDefinitionSignature({ series: "Saga", publisher: "Image" })).toBe(
      comicDefinitionSignature({ series: "Saga", publisher: "Image Comics" })
    );
  });
});

describe("comicSignatureClaim — the flat payload mapping (047 A8's third-copy hazard)", () => {
  it("accepts `title` as the shipped synonym for `series`", () => {
    expect(comicSignatureClaim({ title: "Saga", issue: "1" })).toMatchObject({ series: "Saga" });
  });

  it("prefers `series` when both are present", () => {
    expect(comicSignatureClaim({ title: "The Saga", series: "Saga", issue: "1" })).toMatchObject({
      series: "Saga",
    });
  });

  it("coerces a numeric issue, which manual entry and some providers produce", () => {
    expect(comicSignatureClaim({ title: "Saga", issue: 1 })).toMatchObject({ issue: "1" });
  });

  it("drops a field whose value is not a string, rather than stringifying an object", () => {
    // `String({})` is "[object Object]", which would become a signature field and
    // dedupe two unrelated books together. Absent is the honest answer.
    expect(comicSignatureClaim({ title: "Saga", issue: "1", variant: { a: 1 } }).variant).toBeUndefined();
  });

  it("returns an empty claim for a non-object payload rather than throwing", () => {
    expect(comicSignatureClaim(null)).toEqual({
      series: undefined,
      issue: undefined,
      variant: undefined,
      printing: undefined,
    });
  });
});

describe("the schema version", () => {
  it("is a positive integer, distinct from the normalisation version", () => {
    expect(Number.isInteger(COMIC_IDENTITY_SCHEMA_VERSION)).toBe(true);
    expect(COMIC_IDENTITY_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});

// The invariant review of `b8fa4d8` found `editionWrite.ts` calling the COMIC
// composer and the COMIC definition-signature by name for every vertical. That is
// the `if comic` branch 014 §3.4 forbids, hidden inside a helper: `editionSignature`
// would refuse an unregistered vertical while the two functions beside it silently
// applied the comic field list to it. All three now resolve through a per-pack map
// with the same fail-closed shape.
describe("the per-pack registries fail closed (030 §6 rule 3)", () => {
  const registryEntryPoints: ReadonlyArray<[string, () => unknown]> = [
    ["definitionSignature", () => definitionSignature("sports-card", { series: "Topps" })],
    ["signatureInput", () => signatureInput("sports-card", { series: "Topps" }, { issue: "1" })],
    ["signatureClaim", () => signatureClaim("sports-card", { title: "Topps", issue: "1" })],
    ["parseIdentityAttributes", () => parseIdentityAttributes("sports-card", "edition", { issue: "1" })],
  ];

  it.each(registryEntryPoints)(
    "%s refuses a second, unregistered vertical rather than comic-signing it",
    (_name, call) => {
      expect(call).toThrow(UnregisteredVerticalError);
    }
  );

  it("routes the registered vertical to the comic functions unchanged", () => {
    // The registry must be a dispatch table, not a rewrite: a comic goes exactly
    // where it went before.
    expect(definitionSignature("comic", { series: "Saga", volume: "1" })).toBe(
      comicDefinitionSignature({ series: "Saga", volume: "1" })
    );
    expect(signatureInput("comic", { series: "Saga" }, { issue: "1" })).toEqual(
      comicSignatureInput({ series: "Saga" }, { issue: "1" })
    );
    expect(signatureClaim("comic", { title: "Saga", issue: "1" })).toEqual(
      comicSignatureClaim({ title: "Saga", issue: "1" })
    );
  });

  it("refuses an unknown vertical too, not merely a known-but-unregistered one", () => {
    expect(() => definitionSignature("not-a-vertical", {})).toThrow(UnregisteredVerticalError);
  });
});
