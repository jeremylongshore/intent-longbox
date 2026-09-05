// L3 unit: the two redemption codes (048 §7.1a) and the per-shop bounds that
// make the short one permitted rather than merely convenient.
//
// The DATABASE-backed properties — single use, the device binding, the shop
// delay — are proved against a real Postgres in `tests/integration/invitation`
// and `device-enrollment`. What is provable here is the arithmetic 048 §7.1a
// legislates and the normalisation a person's typing depends on, and both are
// exactly the kind of thing that is asserted by inspection and then silently
// changed.
import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  ENROLLMENT_CODE_LENGTH,
  ENROLLMENT_TTL_MS,
  INVITATION_CODE_LENGTH,
  INVITATION_TTL_MS,
  MAX_OUTSTANDING_ENROLLMENT_CODES_PER_SHOP,
  MAX_OUTSTANDING_INVITATIONS_PER_SHOP,
  SHOP_REDEMPTION_FREE_ATTEMPTS,
  digestOf,
  mintEnrollmentCode,
  mintInvitationCode,
  normaliseCode,
  redemptionWaitMs,
  tokenHash,
} from "../src/services/auth/index.js";

describe("the alphabet (048 §7.1a, Crockford base32)", () => {
  it("carries exactly 32 symbols, so a character is exactly five bits", () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
  });

  it("excludes the four characters a person reading a code aloud gets wrong", () => {
    for (const excluded of ["I", "L", "O", "U"]) {
      expect(CODE_ALPHABET).not.toContain(excluded);
    }
  });

  it("is uppercase and alphanumeric only — a phone keyboard and a spoken code both survive it", () => {
    expect(CODE_ALPHABET).toMatch(/^[0-9A-Z]+$/);
  });
});

describe("entropy is the decision §7.1a refuses to let a build make silently", () => {
  it("gives an ENROLLMENT code at least 128 bits, because its device binding cannot hold", () => {
    // The caller of a device enrollment IS the phone being enrolled, so §7.1a's
    // "already holds a live device session" is unsatisfiable and its other clause
    // — "a short code without both is refused" — governs.
    expect(ENROLLMENT_CODE_LENGTH * 5).toBeGreaterThanOrEqual(128);
    expect(mintEnrollmentCode()).toHaveLength(ENROLLMENT_CODE_LENGTH);
  });

  it("keeps the ENROLLMENT code at the SMALLEST length that clears the floor", () => {
    // Not an aesthetic point: a longer code costs a paste nothing but makes the
    // number in this file look like a guess. 26 × 5 = 130; 25 × 5 = 125 < 128.
    expect((ENROLLMENT_CODE_LENGTH - 1) * 5).toBeLessThan(128);
  });

  it("gives an INVITATION code the six-to-eight characters §7.1a names, and no more", () => {
    expect(INVITATION_CODE_LENGTH).toBeGreaterThanOrEqual(6);
    expect(INVITATION_CODE_LENGTH).toBeLessThanOrEqual(8);
    expect(mintInvitationCode()).toHaveLength(INVITATION_CODE_LENGTH);
  });

  it("draws every character from the alphabet, and does not repeat one code", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const code = mintInvitationCode();
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
      codes.add(code);
    }
    // 200 draws from a 2^40 space collide with probability ~1.8e-8. A repeat here
    // is a broken generator, not bad luck.
    expect(codes.size).toBe(200);
  });
});

describe("normalisation — what a person typed, reduced to what was minted", () => {
  it("uppercases, and drops the separators a person copies along with the code", () => {
    expect(normaliseCode("ab3d-9f2h")).toBe("AB3D9F2H");
    expect(normaliseCode("  AB3D 9F2H \n")).toBe("AB3D9F2H");
  });

  it("applies Crockford's three confusions, so the reader is not punished for them", () => {
    expect(normaliseCode("I")).toBe("1");
    expect(normaliseCode("l")).toBe("1");
    expect(normaliseCode("O")).toBe("0");
    expect(normaliseCode("o")).toBe("0");
  });

  it("drops anything the alphabet cannot hold rather than refusing it", () => {
    // A refusal here would be a validation error on a screen for a code that is
    // in fact correct, which is the failure mode 048 §9.3's constant answer
    // cannot help with because it is not an authentication outcome at all.
    expect(normaliseCode("**AB3D9F2H**")).toBe("AB3D9F2H");
    expect(normaliseCode("")).toBe("");
  });

  it("makes two spellings of one code one digest", () => {
    expect(digestOf("ab3d-9f2h")).toBe(digestOf("AB3D9F2H"));
    expect(digestOf("Ol")).toBe(digestOf("01"));
  });
});

describe("the digest is the only form the database ever sees (048 §7.1, I9)", () => {
  it("is 64 hex characters and contains no part of the code", () => {
    const code = mintInvitationCode();
    const digest = digestOf(code);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(code);
    expect(digest).not.toContain(code.slice(0, 3));
  });

  it("is sha256 of the NORMALISED code and nothing else", () => {
    // Stated as an identity against `tokenHash` so the two hashing paths in this
    // module cannot drift into two algorithms.
    expect(digestOf("ab3d-9f2h")).toBe(tokenHash("AB3D9F2H"));
  });
});

describe("the per-shop bounds that make a short invitation code permitted (§7.1a)", () => {
  it("caps outstanding codes, and caps enrollment codes lower than invitations", () => {
    // The outstanding count is the divisor on the short code's effective
    // keyspace: N live codes are N simultaneous chances for a guess to land.
    expect(MAX_OUTSTANDING_INVITATIONS_PER_SHOP).toBeGreaterThan(0);
    expect(MAX_OUTSTANDING_ENROLLMENT_CODES_PER_SHOP).toBeGreaterThan(0);
    // A shop hires more often than it buys phones.
    expect(MAX_OUTSTANDING_ENROLLMENT_CODES_PER_SHOP).toBeLessThan(MAX_OUTSTANDING_INVITATIONS_PER_SHOP);
  });

  it("gives an enrollment code a much shorter life than an invitation", () => {
    // 048 §7.3 says "short-lived" in those words: the owner reads it off their own
    // screen to a phone standing next to them. §7.2's invitation crosses a
    // counter and is redeemed on the employee's next shift.
    expect(ENROLLMENT_TTL_MS).toBeLessThan(INVITATION_TTL_MS);
  });

  it("lets a shop make its free attempts and then makes it WAIT", () => {
    expect(redemptionWaitMs({ failures: 0, lastFailureAgeMs: 0 })).toBe(0);
    expect(redemptionWaitMs({ failures: SHOP_REDEMPTION_FREE_ATTEMPTS, lastFailureAgeMs: 0 })).toBe(0);
    expect(
      redemptionWaitMs({ failures: SHOP_REDEMPTION_FREE_ATTEMPTS + 1, lastFailureAgeMs: 0 })
    ).toBeGreaterThan(0);
  });

  it("grows the wait with each further failure, and NEVER closes the door (048 R5)", () => {
    const one = redemptionWaitMs({ failures: SHOP_REDEMPTION_FREE_ATTEMPTS + 1, lastFailureAgeMs: 0 });
    const two = redemptionWaitMs({ failures: SHOP_REDEMPTION_FREE_ATTEMPTS + 2, lastFailureAgeMs: 0 });
    expect(two).toBeGreaterThan(one);

    // The property that matters, and the one 048 R5 spends a paragraph on: there
    // is no failure count from which a correct code is refused FOREVER. Waiting
    // long enough always returns 0 — a delay, not a lock, because a lock's
    // failure mode on this flow is an owner who cannot finish onboarding.
    expect(redemptionWaitMs({ failures: 10_000, lastFailureAgeMs: Number.POSITIVE_INFINITY })).toBe(0);
    expect(redemptionWaitMs({ failures: 10_000, lastFailureAgeMs: 60 * 60 * 1000 })).toBe(0);
  });

  it("caps the wait, so the worst a griefer buys a shop is a bounded pause", () => {
    const huge = redemptionWaitMs({ failures: 1_000, lastFailureAgeMs: 0 });
    const bigger = redemptionWaitMs({ failures: 2_000, lastFailureAgeMs: 0 });
    expect(bigger).toBe(huge);
  });
});
