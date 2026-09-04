// The CARD identity schema, its normalisation and its signature (E04-B03).
//
// The acceptance line 014 §8 sets is "card examples resolve through the same core
// contract as comics without core-code branching", and this file is the first
// half of proving it: every assertion below goes through the SAME registry
// entry points a comic write goes through — `parseIdentityAttributes`,
// `signatureInput`, `editionSignature`, `signatureClaim`, `definitionSignature`,
// `isUsableClaim` — with a different vertical string and nothing else different.
// The second half is `tests/contract/architecture-gate.test.ts` (no branch on a
// vertical outside a pack) and `tests/integration/catalog-card-edition.test.ts`
// (a card edition minted and resolved by the shipped write path).
import { describe, expect, it } from "vitest";
import {
  CopyFactInEditionError,
  ProviderKeyInAttributesError,
  REGISTERED_VERTICALS,
  SIGNATURE_SEPARATOR,
  SPORTS_CARD_VERTICAL,
  TCG_CARD_VERTICAL,
  UnregisteredVerticalError,
  definitionSignature,
  editionSignature,
  isUsableClaim,
  normalizeCardNumber,
  normalizeLanguage,
  parseIdentityAttributes,
  signatureClaim,
  signatureInput,
} from "../src/catalog/index.js";

/** A complete, valid sports-card work + printing, as a corpus would state it. */
const definition = {
  sport: "baseball",
  player: "Roger Clemens",
  set: "1986 Topps",
  year: "1986",
  manufacturer: "Topps",
};
const edition = { number: "661", variant: null, parallel: null, language: "en", printRun: null };

/** The signature the shipped write path computes, for a card. */
const signatureOf = (vertical: string, def: Record<string, unknown>, ed: Record<string, unknown>): string =>
  editionSignature(
    vertical,
    signatureInput(
      vertical,
      parseIdentityAttributes(vertical, "definition", def),
      parseIdentityAttributes(vertical, "edition", ed)
    )
  );

describe("the card pack registers alongside the comic pack (014 §3.4, 030 §5.4)", () => {
  it("registers three verticals across two packs, and refuses a fourth", () => {
    expect(REGISTERED_VERTICALS).toEqual(["comic", SPORTS_CARD_VERTICAL, TCG_CARD_VERTICAL]);
    // 030 §6 rule 3: refused at the boundary, never defaulted to "comic".
    expect(() => editionSignature("coin", {})).toThrow(UnregisteredVerticalError);
    expect(() => parseIdentityAttributes("coin", "edition", {})).toThrow(UnregisteredVerticalError);
    expect(() => signatureClaim("coin", {})).toThrow(UnregisteredVerticalError);
    expect(() => definitionSignature("coin", {})).toThrow(UnregisteredVerticalError);
    expect(() => isUsableClaim("coin", {})).toThrow(UnregisteredVerticalError);
  });

  it("gives a card five signature positions, not the comic's four", () => {
    expect(signatureOf(SPORTS_CARD_VERTICAL, definition, edition).split(SIGNATURE_SEPARATOR)).toEqual([
      "1986 topps",
      "661",
      "",
      "",
      "en",
    ]);
  });

  it("signs a TCG card by the same rule with a different discriminator", () => {
    const sig = signatureOf(
      TCG_CARD_VERTICAL,
      { game: "Magic: The Gathering", cardName: "Black Lotus", set: "Alpha", year: "1993" },
      { number: "232", parallel: null, language: "en" }
    );
    expect(sig.split(SIGNATURE_SEPARATOR)).toEqual(["alpha", "232", "", "", "en"]);
  });

  it("keeps the two card verticals' signature spaces separate at the lookup, not in the string", () => {
    // The same five fields under two verticals produce the SAME text — and that is
    // correct, because `edition_signature` is keyed on `(vertical, signature)`
    // (030 §3.1's Q2/Q3 lookup, migrations/016). A vertical baked into the string
    // would make the column's own discriminator redundant and the index wider.
    const fields = { set: "S", number: "1", variant: null, parallel: null, language: "en" };
    expect(editionSignature(SPORTS_CARD_VERTICAL, fields)).toBe(editionSignature(TCG_CARD_VERTICAL, fields));
  });
});

describe("card normalisation (049 §5.3)", () => {
  it("strips a leading hash and closes the space around a hyphen", () => {
    expect(normalizeCardNumber("#12A")).toBe("12a");
    expect(normalizeCardNumber(" RC - 12 ")).toBe("rc-12");
    expect(normalizeCardNumber("RC-12")).toBe("rc-12");
    expect(normalizeCardNumber(undefined)).toBe("");
  });

  it("KEEPS the hyphen, because merging RC-12 into RC12 could merge two real cards", () => {
    expect(normalizeCardNumber("RC-12")).not.toBe(normalizeCardNumber("RC12"));
  });

  it("folds case and underscores in a language tag and invents nothing", () => {
    expect(normalizeLanguage("PT_BR")).toBe("pt-br");
    expect(normalizeLanguage(" JA ")).toBe("ja");
    // No default. An absent language is absent — see the next test for why.
    expect(normalizeLanguage(undefined)).toBe("");
    // And no synonym table: mapping "English" onto "en" is an INGEST decision
    // (E04-B11), so two spellings are a dedupe CANDIDATE, not a silent merge.
    expect(normalizeLanguage("English")).not.toBe(normalizeLanguage("en"));
  });

  it("does not default an absent language to English, so a Japanese printing stays distinct", () => {
    const english = signatureOf(SPORTS_CARD_VERTICAL, definition, { ...edition, language: "en" });
    const japanese = signatureOf(SPORTS_CARD_VERTICAL, definition, { ...edition, language: "ja" });
    const unstated = signatureOf(SPORTS_CARD_VERTICAL, definition, { ...edition, language: null });
    expect(english).not.toBe(japanese);
    expect(unstated).not.toBe(english);
    expect(unstated).not.toBe(japanese);
  });

  it("treats missing, null and blank as one claim, as every field in this system does", () => {
    const a = signatureOf(SPORTS_CARD_VERTICAL, definition, { number: "661", language: "en" });
    const b = signatureOf(SPORTS_CARD_VERTICAL, definition, {
      number: "661",
      variant: null,
      parallel: "   ",
      language: "en",
    });
    expect(a).toBe(b);
  });

  it("separates fields with a character no normalised field can contain", () => {
    // Straight at the signature function: the SCHEMA refuses a blank number, so a
    // pair that could only collide with one is not constructible through the write
    // path — which is the belt to this brace, not a substitute for it.
    const joined = editionSignature(SPORTS_CARD_VERTICAL, { set: "ab", number: "" });
    const split = editionSignature(SPORTS_CARD_VERTICAL, { set: "a", number: "b" });
    expect(joined).not.toBe(split);
  });

  it("is deterministic", () => {
    const runs = new Set(
      Array.from({ length: 25 }, () => signatureOf(SPORTS_CARD_VERTICAL, definition, edition))
    );
    expect(runs.size).toBe(1);
  });
});

describe("a parallel is a different edition (030 v1.3.0, 049 §5.2)", () => {
  it("distinguishes two parallels of one card", () => {
    const base = signatureOf(SPORTS_CARD_VERTICAL, definition, { ...edition, parallel: null });
    const silver = signatureOf(SPORTS_CARD_VERTICAL, definition, { ...edition, parallel: "Silver Prizm" });
    const gold = signatureOf(SPORTS_CARD_VERTICAL, definition, { ...edition, parallel: "Gold Prizm" });
    expect(new Set([base, silver, gold]).size).toBe(3);
  });

  it("distinguishes a variant from a parallel — two axes, two positions", () => {
    const variant = signatureOf(SPORTS_CARD_VERTICAL, definition, { ...edition, variant: "photo variation" });
    const parallel = signatureOf(SPORTS_CARD_VERTICAL, definition, {
      ...edition,
      parallel: "photo variation",
    });
    expect(variant).not.toBe(parallel);
  });

  it("leaves the print RUN out of the key while keeping it as an attribute", () => {
    // `printRun` is an edition fact — every copy of the parallel shares it — but the
    // parallel name it belongs to is already in the key, so adding a sixth position
    // would split one edition on a corpus's formatting habit.
    const stated = signatureOf(SPORTS_CARD_VERTICAL, definition, {
      ...edition,
      parallel: "Gold",
      printRun: "10",
    });
    const unstated = signatureOf(SPORTS_CARD_VERTICAL, definition, { ...edition, parallel: "Gold" });
    expect(stated).toBe(unstated);
    expect(parseIdentityAttributes(SPORTS_CARD_VERTICAL, "edition", { number: "1", printRun: "10" })).toEqual(
      { number: "1", printRun: "10" }
    );
  });
});

describe("cert and copy facts are refused by name, in every vertical (047 §8.4, A6)", () => {
  const forbidden = [
    { grader: "PSA" },
    { cert_number: "12345678" },
    { certNumber: "12345678" },
    { grade: "9" },
    { slab: "true" },
    { serialNumber: "07/99" },
  ];

  it("refuses them on a card edition", () => {
    for (const attributes of forbidden) {
      expect(() =>
        parseIdentityAttributes(SPORTS_CARD_VERTICAL, "edition", { number: "1", ...attributes })
      ).toThrow(CopyFactInEditionError);
    }
  });

  it("refuses them on a card definition and on a TCG one", () => {
    expect(() =>
      parseIdentityAttributes(SPORTS_CARD_VERTICAL, "definition", { ...definition, grader: "BGS" })
    ).toThrow(CopyFactInEditionError);
    expect(() =>
      parseIdentityAttributes(TCG_CARD_VERTICAL, "definition", {
        game: "Pokemon",
        cardName: "Charizard",
        set: "Base Set",
        cert: "1",
      })
    ).toThrow(CopyFactInEditionError);
  });

  it("refuses them on a COMIC too, because the rule belongs to no pack", () => {
    expect(() => parseIdentityAttributes("comic", "edition", { issue: "300", grader: "CGC" })).toThrow(
      CopyFactInEditionError
    );
  });

  it("refuses provider-named attribute keys, including the card graders (030 §4 rule 2)", () => {
    expect(() =>
      parseIdentityAttributes(SPORTS_CARD_VERTICAL, "edition", { number: "1", psa_id: "9" })
    ).toThrow(ProviderKeyInAttributesError);
    expect(() =>
      parseIdentityAttributes(TCG_CARD_VERTICAL, "edition", { number: "1", tcgplayer_id: "9" })
    ).toThrow(ProviderKeyInAttributesError);
  });

  it("says WHY, rather than 'unrecognized key'", () => {
    expect(() =>
      parseIdentityAttributes(SPORTS_CARD_VERTICAL, "edition", { number: "1", grader: "PSA" })
    ).toThrow(/COPY fact/);
  });
});

describe("the card schema preserves unknown as distinct from absent", () => {
  it("keeps an absent key absent and a null key null", () => {
    const absent = parseIdentityAttributes(SPORTS_CARD_VERTICAL, "edition", { number: "1" });
    const nulled = parseIdentityAttributes(SPORTS_CARD_VERTICAL, "edition", { number: "1", parallel: null });
    expect(Object.hasOwn(absent, "parallel")).toBe(false);
    expect(Object.hasOwn(nulled, "parallel")).toBe(true);
    expect(nulled.parallel).toBeNull();
    // And the signature deliberately collapses them: a DEDUPE key must not
    // distinguish two records describing one card with different degrees of
    // silence (`editionSignature.ts`).
    expect(signatureOf(SPORTS_CARD_VERTICAL, definition, { number: "1" })).toBe(
      signatureOf(SPORTS_CARD_VERTICAL, definition, { number: "1", parallel: null })
    );
  });

  it("requires a set, a number and a subject, and refuses a blank one", () => {
    expect(() => parseIdentityAttributes(SPORTS_CARD_VERTICAL, "edition", { number: "  " })).toThrow();
    expect(() =>
      parseIdentityAttributes(SPORTS_CARD_VERTICAL, "definition", { ...definition, set: "" })
    ).toThrow();
    expect(() =>
      parseIdentityAttributes(SPORTS_CARD_VERTICAL, "definition", { sport: "baseball", set: "1986 Topps" })
    ).toThrow();
  });

  it("refuses the OTHER card vertical's discriminator, so the two schemas cannot be crossed", () => {
    expect(() =>
      parseIdentityAttributes(SPORTS_CARD_VERTICAL, "definition", {
        game: "Magic",
        cardName: "Black Lotus",
        set: "Alpha",
      })
    ).toThrow();
  });

  it("refuses a comic field on a card, and a card field on a comic", () => {
    expect(() =>
      parseIdentityAttributes(SPORTS_CARD_VERTICAL, "edition", { number: "1", printing: "2" })
    ).toThrow();
    expect(() => parseIdentityAttributes("comic", "edition", { issue: "300", parallel: "Gold" })).toThrow();
  });
});

describe("the definition signature is the WORK's own field list (049 §3.1, §5.1)", () => {
  it("is set + subject, and drops the sport, the year and the manufacturer", () => {
    const parsed = parseIdentityAttributes(SPORTS_CARD_VERTICAL, "definition", definition);
    expect(definitionSignature(SPORTS_CARD_VERTICAL, parsed).split(SIGNATURE_SEPARATOR)).toEqual([
      "1986 topps",
      "roger clemens",
    ]);
    // Two corpora disagreeing about the manufacturer describe ONE work, not two —
    // the comic pack's reason for dropping publisher, restated.
    const other = parseIdentityAttributes(SPORTS_CARD_VERTICAL, "definition", {
      ...definition,
      manufacturer: "The Topps Company",
      year: "1986-87",
    });
    expect(definitionSignature(SPORTS_CARD_VERTICAL, other)).toBe(
      definitionSignature(SPORTS_CARD_VERTICAL, parsed)
    );
  });

  it("reads the TCG subject from its own key", () => {
    const parsed = parseIdentityAttributes(TCG_CARD_VERTICAL, "definition", {
      game: "Magic: The Gathering",
      cardName: "Black Lotus",
      set: "Alpha",
    });
    expect(definitionSignature(TCG_CARD_VERTICAL, parsed).split(SIGNATURE_SEPARATOR)).toEqual([
      "alpha",
      "black lotus",
    ]);
  });
});

describe("a flat claim maps onto the pack's fields, and the pack decides if it is usable", () => {
  it("accepts the provider vocabulary's spellings", () => {
    expect(
      signatureClaim(SPORTS_CARD_VERTICAL, { setName: "1986 Topps", cardNumber: 661, lang: "EN" })
    ).toEqual({ set: "1986 Topps", number: "661", variant: undefined, parallel: undefined, language: "EN" });
  });

  it("asks the CARD question of a card claim, not the comic one", () => {
    // The bug this replaced: `!fields.series && !fields.issue` in
    // `src/services/identityResolution.ts` would have called every card claim
    // unusable, because a card claim has neither key.
    const claim = signatureClaim(SPORTS_CARD_VERTICAL, { set: "1986 Topps", number: "661" });
    expect(isUsableClaim(SPORTS_CARD_VERTICAL, claim)).toBe(true);
    expect(
      isUsableClaim(SPORTS_CARD_VERTICAL, signatureClaim(SPORTS_CARD_VERTICAL, { parallel: "Gold" }))
    ).toBe(false);
    expect(isUsableClaim("comic", signatureClaim("comic", { title: "ASM", issue: "300" }))).toBe(true);
    expect(isUsableClaim("comic", signatureClaim("comic", { variant: "direct" }))).toBe(false);
  });
});
