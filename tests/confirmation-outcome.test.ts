// L3: the confirmation-outcome rule (019 §3.0, T1, T3, T20; 035 §4.3).
// Pure logic, no database. Beads longbox-e5b.2.13 (E02-D03) and, for the
// vertical-aware key and the card cases, longbox-e5b.4.16 (E04-D04).
import { describe, expect, it } from "vitest";
import {
  MEASURED_VERTICALS,
  UnmeasurableVerticalError,
  decideOutcome,
  identityKey,
  topCandidateOf,
} from "../src/services/confirmationOutcome.js";

// The three registered verticals, spelled here rather than imported from the
// catalog on purpose: this suite is the workflow side of 047 A8, and a shared
// constant between the two sides is the first step of the merge A8 forbids. That
// the two registries agree is asserted in tests/edition-signature.test.ts, which
// is the file that exists to compare them.
const COMIC = "comic";
const SPORTS = "sports-card";
const TCG = "tcg-card";

const ASM300 = { title: "Amazing Spider-Man", issue: "300", variant: "Direct" };

/** A sports card: 1986 Fleer #57, Silver parallel, English. */
const CARD57 = { set: "1986 Fleer", number: "57", parallel: "Silver", language: "en" };

describe("identityKey — the COMIC vertical (019 T1)", () => {
  // ⚠ THE PIN, AND IT IS THE POINT OF THIS BEAD'S TEST LANE. E04-D04 made the key
  // vertical-aware, which is a change to a 019 measurement input (019:57, 019:59;
  // 047 A8's paired-edit gate exists because of it). The one thing that must NOT
  // move is what a COMIC confirmation keys to, because every outcome ever scored
  // — and therefore T1's comparison and T3's numerator — was computed with it.
  // The literal is written out rather than derived, so a future edit to the
  // composer, the separator, the order or the normalisation fails HERE with the
  // old bytes beside the new ones, instead of passing a test that recomputes the
  // same mistake on both sides.
  it("keys byte-for-byte to what it keyed to before the key became vertical-aware", () => {
    expect(identityKey(COMIC, ASM300)).toBe("amazing spider-man\u001f300\u001fdirect");
    expect(identityKey(COMIC, { title: "Hulk", issue: "181" })).toBe("hulk\u001f181\u001f");
  });

  it("keys on title + issue + variant", () => {
    expect(identityKey(COMIC, ASM300)).toBe(["amazing spider-man", "300", "direct"].join("\u001f"));
  });

  it("normalizes case, padding and collapsed whitespace so a round-tripped pick still matches", () => {
    expect(identityKey(COMIC, { title: "  AMAZING   Spider-Man ", issue: " 300 ", variant: "DIRECT" })).toBe(
      identityKey(COMIC, ASM300)
    );
  });

  it("treats a leading # on the issue as punctuation, not identity", () => {
    expect(identityKey(COMIC, { title: "Daredevil", issue: "#181" })).toBe(
      identityKey(COMIC, { title: "Daredevil", issue: "181" })
    );
  });

  it("does not conflate an issue with a lettered issue", () => {
    expect(identityKey(COMIC, { title: "Daredevil", issue: "181" })).not.toBe(
      identityKey(COMIC, { title: "Daredevil", issue: "181A" })
    );
  });

  it("accepts a numeric issue field and keys it the same as its string form", () => {
    expect(identityKey(COMIC, { title: "Hulk", issue: 181 })).toBe(
      identityKey(COMIC, { title: "Hulk", issue: "181" })
    );
  });

  it("treats missing, null and empty variant as the same claim", () => {
    const bare = identityKey(COMIC, { title: "Hulk", issue: "181" });
    expect(identityKey(COMIC, { title: "Hulk", issue: "181", variant: null })).toBe(bare);
    expect(identityKey(COMIC, { title: "Hulk", issue: "181", variant: "" })).toBe(bare);
  });

  it("distinguishes a variant from the base issue", () => {
    expect(identityKey(COMIC, { title: "Hulk", issue: "181", variant: "Newsstand" })).not.toBe(
      identityKey(COMIC, { title: "Hulk", issue: "181" })
    );
  });

  it("ignores publisher and year, which the operator does not pick between", () => {
    expect(identityKey(COMIC, { ...ASM300, publisher: "Marvel", year: 1988, confidence: 0.91 })).toBe(
      identityKey(COMIC, ASM300)
    );
  });

  it("returns null for a payload with no usable identity", () => {
    expect(identityKey(COMIC, { publisher: "Marvel", year: 1988 })).toBeNull();
    expect(identityKey(COMIC, {})).toBeNull();
    expect(identityKey(COMIC, null)).toBeNull();
    expect(identityKey(COMIC, undefined)).toBeNull();
    expect(identityKey(COMIC, "Amazing Spider-Man 300")).toBeNull();
  });

  it("keeps a title-only or issue-only payload comparable, and does not conflate the two", () => {
    const titleOnly = identityKey(COMIC, { title: "Amazing Spider-Man" });
    const issueOnly = identityKey(COMIC, { issue: "300" });
    expect(titleOnly).not.toBeNull();
    expect(issueOnly).not.toBeNull();
    expect(titleOnly).not.toBe(issueOnly);
    expect(titleOnly).not.toBe(identityKey(COMIC, ASM300));
  });
});

describe("topCandidateOf", () => {
  it("returns the first-ranked entry", () => {
    expect(topCandidateOf([ASM300, { title: "Other", issue: "1" }])).toEqual(ASM300);
  });

  it("returns undefined for an empty or non-array candidates payload", () => {
    expect(topCandidateOf([])).toBeUndefined();
    expect(topCandidateOf(null)).toBeUndefined();
    expect(topCandidateOf({ candidates: [ASM300] })).toBeUndefined();
  });
});

describe("decideOutcome", () => {
  it("is always confirm for one_tap, which is the act of accepting the proposal", () => {
    expect(
      decideOutcome({ vertical: COMIC, source: "one_tap", confirmed: ASM300, topProposal: ASM300 })
    ).toBe("confirm");
  });

  it("is confirm for one_tap even with no proposal on record (T3's denominator is every one-tap)", () => {
    expect(
      decideOutcome({ vertical: COMIC, source: "one_tap", confirmed: ASM300, topProposal: undefined })
    ).toBe("confirm");
  });

  it("is confirm when a grid pick lands on the top-ranked proposal", () => {
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "grid_pick",
        confirmed: { ...ASM300, confidence: 0.62 },
        topProposal: ASM300,
      })
    ).toBe("confirm");
  });

  it("is correct when a grid pick lands on a different candidate", () => {
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "grid_pick",
        confirmed: { title: "Amazing Spider-Man", issue: "301" },
        topProposal: ASM300,
      })
    ).toBe("correct");
  });

  it("is correct when only the variant differs — variant is identity (019 T1)", () => {
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "grid_pick",
        confirmed: { title: "Amazing Spider-Man", issue: "300", variant: "Newsstand" },
        topProposal: ASM300,
      })
    ).toBe("correct");
  });

  it("is correct for a manual search on a session with no candidates", () => {
    expect(
      decideOutcome({ vertical: COMIC, source: "manual_search", confirmed: ASM300, topProposal: undefined })
    ).toBe("correct");
  });

  it("is correct when the latest candidate_set has no comparable identity (a bare barcode parse)", () => {
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "manual_search",
        confirmed: ASM300,
        topProposal: { ok: true, upc: "759606043019", supplement: "01711" },
      })
    ).toBe("correct");
  });

  it("is confirm when a manual search retypes exactly what was proposed", () => {
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "manual_search",
        confirmed: { title: "amazing spider-man", issue: "#300", variant: "direct" },
        topProposal: ASM300,
      })
    ).toBe("confirm");
  });

  it("is correct when the operator supplies an identity-less payload", () => {
    expect(
      decideOutcome({ vertical: COMIC, source: "manual_search", confirmed: {}, topProposal: ASM300 })
    ).toBe("correct");
  });

  it("falls back to the top proposal for a first confirmation, with no prior on the session", () => {
    expect(
      decideOutcome({ vertical: COMIC, source: "owner_review", confirmed: ASM300, topProposal: ASM300 })
    ).toBe("confirm");
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "owner_review",
        confirmed: { title: "Hulk", issue: "181" },
        topProposal: ASM300,
      })
    ).toBe("correct");
  });
});

// T20 is "draft → publish without owner edits to identity or condition": the
// owner is reviewing the identity they INHERITED, not the model's ranking. Every
// case below is scored wrong if the prior confirmation is ignored.
describe("decideOutcome — the prior confirmation is the baseline (T20)", () => {
  const HULK181 = { title: "Hulk", issue: "181" };

  it("scores confirm when the owner agrees with the employee's correction, against the model", () => {
    // Employee manual-searched to Hulk 181 while the model's top pick was ASM 300.
    // The owner agreeing with Hulk 181 has edited NOTHING.
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "owner_review",
        confirmed: HULK181,
        topProposal: ASM300,
        priorConfirmation: HULK181,
      })
    ).toBe("confirm");
  });

  it("scores correct when the owner reverts to the model's top candidate", () => {
    // Employee confirmed Hulk 181; the owner changes it to ASM 300, which is what
    // the model proposed. Matching the model does not make it a non-edit.
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "owner_review",
        confirmed: ASM300,
        topProposal: ASM300,
        priorConfirmation: HULK181,
      })
    ).toBe("correct");
  });

  it("applies the same baseline to a second employee confirmation, not only owner_review", () => {
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "grid_pick",
        confirmed: HULK181,
        topProposal: ASM300,
        priorConfirmation: HULK181,
      })
    ).toBe("confirm");
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "manual_search",
        confirmed: ASM300,
        topProposal: ASM300,
        priorConfirmation: HULK181,
      })
    ).toBe("correct");
  });

  it("still confirms a one_tap regardless of the prior confirmation", () => {
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "one_tap",
        confirmed: ASM300,
        topProposal: ASM300,
        priorConfirmation: HULK181,
      })
    ).toBe("confirm");
  });

  it("falls through to the top proposal when the prior confirmation has no usable identity", () => {
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "owner_review",
        confirmed: ASM300,
        topProposal: ASM300,
        priorConfirmation: { publisher: "Marvel" },
      })
    ).toBe("confirm");
  });

  it("is correct when neither a prior confirmation nor a proposal offers a baseline", () => {
    expect(
      decideOutcome({
        vertical: COMIC,
        source: "owner_review",
        confirmed: ASM300,
        topProposal: undefined,
        priorConfirmation: undefined,
      })
    ).toBe("correct");
  });
});

// ═══ E04-D04 — the vertical is a parameter, and an unregistered one is refused ═══
//
// 049 §11.1 H1, adopted and deferred by that record, fixed here: `identityKey`
// used to compute `[title, issue, variant]` unconditionally, so a card
// confirmation would have found all three `undefined`, keyed every card in the
// shop to the same degenerate string, and corrupted T1/T3 silently from the first
// item. Every case below is a case that used to be impossible to write.
describe("identityKey — the CARD verticals (049 §3.2)", () => {
  it("keys on set + number + variant + parallel + language", () => {
    expect(identityKey(SPORTS, CARD57)).toBe(["1986 fleer", "57", "", "silver", "en"].join("\u001f"));
  });

  it("keys a card and a comic to different strings from the same-looking payload", () => {
    // The defect this bead closes, stated as an assertion: before E04-D04 both
    // sides of this comparison were computed by the comic composer, so the card
    // payload keyed to null and every card collapsed together.
    expect(identityKey(SPORTS, CARD57)).not.toBe(identityKey(COMIC, ASM300));
    expect(identityKey(COMIC, CARD57)).toBeNull();
  });

  it("uses ONE composer for both card verticals, because their edition schemas are identical", () => {
    expect(identityKey(TCG, CARD57)).toBe(identityKey(SPORTS, CARD57));
  });

  it("normalizes case, padding and whitespace around a hyphenated number", () => {
    expect(identityKey(SPORTS, { set: " 1986   FLEER ", number: "RC - 12" })).toBe(
      identityKey(SPORTS, { set: "1986 Fleer", number: "rc-12" })
    );
  });

  it("treats a leading # on the card number as punctuation, and keeps the hyphen as data", () => {
    expect(identityKey(SPORTS, { set: "Prizm", number: "#12" })).toBe(
      identityKey(SPORTS, { set: "Prizm", number: "12" })
    );
    expect(identityKey(SPORTS, { set: "Prizm", number: "RC-12" })).not.toBe(
      identityKey(SPORTS, { set: "Prizm", number: "RC12" })
    );
  });

  it("distinguishes a parallel from the base card — a parallel is a different printing", () => {
    expect(identityKey(SPORTS, { set: "Prizm", number: "12", parallel: "Silver" })).not.toBe(
      identityKey(SPORTS, { set: "Prizm", number: "12" })
    );
  });

  it("distinguishes a language, and never defaults an absent one to English", () => {
    // 049 §5.3's ruling, applied to the measurement: an omitted language is not
    // 'en'. Scoring a switch to the Japanese printing as a CONFIRM would hide a
    // real miss, and 021 forbids the direction that flatters.
    expect(identityKey(TCG, { set: "Base Set", number: "4", language: "ja" })).not.toBe(
      identityKey(TCG, { set: "Base Set", number: "4" })
    );
    expect(identityKey(TCG, { set: "Base Set", number: "4", language: "EN" })).not.toBe(
      identityKey(TCG, { set: "Base Set", number: "4", language: "English" })
    );
    expect(identityKey(TCG, { set: "Base Set", number: "4", language: "pt_BR" })).toBe(
      identityKey(TCG, { set: "Base Set", number: "4", language: "pt-br" })
    );
  });

  it("treats missing, null and empty the same in every optional position", () => {
    const bare = identityKey(SPORTS, { set: "Prizm", number: "12" });
    expect(identityKey(SPORTS, { set: "Prizm", number: "12", parallel: null, language: "" })).toBe(bare);
  });

  it("accepts the provider spellings of set, number and language", () => {
    expect(identityKey(SPORTS, { setName: "Prizm", cardNumber: 12, lang: "EN" })).toBe(
      identityKey(SPORTS, { set: "Prizm", number: "12", language: "en" })
    );
  });

  it("returns null for a payload naming neither a set nor a number", () => {
    expect(identityKey(SPORTS, { player: "A Player", year: "1986" })).toBeNull();
    expect(identityKey(SPORTS, {})).toBeNull();
    expect(identityKey(TCG, null)).toBeNull();
  });

  it("ignores the year and the manufacturer, which a manual entry omits", () => {
    expect(identityKey(SPORTS, { ...CARD57, year: "1986", manufacturer: "Fleer", sport: "basketball" })).toBe(
      identityKey(SPORTS, CARD57)
    );
  });
});

describe("an unregistered vertical is REFUSED, never degraded to comic", () => {
  it("throws from identityKey rather than returning a comic key or a null", () => {
    expect(() => identityKey("coin", ASM300)).toThrow(UnmeasurableVerticalError);
    // The two silent alternatives, named in the message so the next reader does
    // not reinvent one: a comic composer over a coin payload keys to null and
    // scores every confirmation 'correct'; a null return does the same thing
    // one level up. Both corrupt T3 while every test still passes.
    expect(() => identityKey("coin", ASM300)).toThrow(/019 T1\/T3 cannot be measured/);
  });

  it("throws from decideOutcome BEFORE the one_tap shortcut", () => {
    // A one-tap is 'confirm' whatever the key says, so a check placed after the
    // shortcut would let an unmeasurable vertical into T3's DENOMINATOR while its
    // numerator stayed uncountable. Fail closed on the way in.
    expect(() =>
      decideOutcome({ vertical: "coin", source: "one_tap", confirmed: ASM300, topProposal: ASM300 })
    ).toThrow(UnmeasurableVerticalError);
  });

  // ⚠ THE INHERITED-KEY HOLE, closed by the registry being a `Map` (PR #80,
  // MiniMax finding 2). With a plain object, `KEYS[vertical]` resolves members of
  // `Object.prototype`, which are not `undefined` — so `identityKey("toString",
  // x)` returned `Object.prototype.toString.call(x)`, a plausible STRING that
  // `decideOutcome` then compared like any other key. Not a crash: the fail-OPEN
  // this file exists to make impossible, reachable by a vertical whose name is a
  // JavaScript builtin. Every one of these passed the first version of the suite.
  it.each(["toString", "valueOf", "constructor", "hasOwnProperty", "__proto__", "isPrototypeOf"])(
    "refuses %s, which a plain-object registry would have resolved to Object.prototype",
    (vertical) => {
      expect(() => identityKey(vertical, ASM300)).toThrow(UnmeasurableVerticalError);
      expect(() =>
        decideOutcome({ vertical, source: "grid_pick", confirmed: ASM300, topProposal: ASM300 })
      ).toThrow(UnmeasurableVerticalError);
    }
  );

  it("registers exactly the three verticals the catalog packs register", () => {
    // The set equality against the CATALOG's registry lives in
    // tests/edition-signature.test.ts (the one file allowed to import both sides).
    // Here we pin the membership so a silent deletion is caught in this suite too.
    expect([...MEASURED_VERTICALS].sort()).toEqual([COMIC, SPORTS, TCG].sort());
  });
});

describe("decideOutcome — a card session is measured on card fields (019 T1, T3)", () => {
  it("is confirm when a grid pick lands on the proposed card", () => {
    expect(
      decideOutcome({
        vertical: SPORTS,
        source: "grid_pick",
        confirmed: { ...CARD57, confidence: 0.62 },
        topProposal: CARD57,
      })
    ).toBe("confirm");
  });

  it("is correct when only the parallel differs — the case the old key could not see", () => {
    // Before E04-D04 both payloads keyed to null, the baseline was null, and the
    // outcome was 'correct' for the wrong reason — which reads identically in the
    // column and is why the defect was invisible.
    expect(
      decideOutcome({
        vertical: SPORTS,
        source: "grid_pick",
        confirmed: { ...CARD57, parallel: "Gold" },
        topProposal: CARD57,
      })
    ).toBe("correct");
  });

  it("scores two different cards in one set as a correction, not as one collapsed key", () => {
    expect(
      decideOutcome({
        vertical: TCG,
        source: "grid_pick",
        confirmed: { set: "Base Set", number: "4" },
        topProposal: { set: "Base Set", number: "58" },
      })
    ).toBe("correct");
  });

  it("keeps T20's prior-confirmation baseline for cards too", () => {
    const gold = { ...CARD57, parallel: "Gold" };
    expect(
      decideOutcome({
        vertical: SPORTS,
        source: "owner_review",
        confirmed: gold,
        topProposal: CARD57,
        priorConfirmation: gold,
      })
    ).toBe("confirm");
  });
});

// The reviewer of PR #80 read the two composers as capable of colliding across
// verticals. They cannot, and the reason is worth pinning rather than arguing:
// the key is never persisted, never returned, and never compared with a key from
// another call — `decideOutcome` composes all three of its payloads with the SAME
// composer, inside one session, which has one vertical. The arity difference is
// asserted here so the property is checkable and not merely stated.
describe("a key is session-scoped, and the two shapes are distinguishable anyway", () => {
  it("does not collide when the same words are read as a comic and as a card", () => {
    const comic = identityKey(COMIC, { title: "Prizm", issue: "12", variant: "Silver" });
    const card = identityKey(SPORTS, { set: "Prizm", number: "12", variant: "Silver" });
    expect(comic).not.toBe(card);
    // Three positions versus five: two separators versus four. A comic key can
    // never be a card key even before the field NAMES are considered.
    expect(comic?.split("\u001f")).toHaveLength(3);
    expect(card?.split("\u001f")).toHaveLength(5);
  });

  it("does not read a comic issue as a card number, or a card set as a comic title", () => {
    expect(identityKey(SPORTS, { issue: "300" })).toBeNull();
    expect(identityKey(SPORTS, { title: "Amazing Spider-Man" })).toBeNull();
    expect(identityKey(COMIC, { set: "1986 Fleer", number: "57" })).toBeNull();
  });
});
