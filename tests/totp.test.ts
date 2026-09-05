// L1: RFC 6238, against the RFC's OWN test vectors.
//
// Bead: longbox-e5b.3.17 (alias E03-D06). Docs: 048 §4.2, §4.3 (R19), §11 I16.
//
// This file exists because `totp.ts` is forty lines of hand-written cryptography
// standing in for a dependency, and the argument for writing it rather than
// installing it — that a second factor's verifier should not be a supply-chain
// surface — is only honest if "correct" is a fact rather than a claim. RFC 6238
// Appendix B publishes eight vectors for a known secret at known times; six of
// them are SHA-1, which is the algorithm 048 §4.2 fixes, and they are asserted
// here verbatim.
import { describe, expect, it } from "vitest";
import {
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  base32Encode,
  mintTotpSecret,
  otpauthUri,
  stepAt,
  totpCode,
  verifyTotpCode,
} from "../src/services/auth/totp.js";

/** RFC 6238 Appendix B's SHA-1 secret: the ASCII digits, twenty bytes. */
const RFC_SECRET = Buffer.from("12345678901234567890", "utf8");

/**
 * The RFC's table, truncated to six digits — the RFC prints eight, and a
 * six-digit TOTP is the eight-digit value's low six, because the truncation is a
 * modulo. Asserting the truncation as well as the value is what proves this
 * implementation's `digits` parameter is doing what the RFC says rather than
 * something that agrees at one width.
 */
const VECTORS: ReadonlyArray<{ seconds: number; eight: string }> = [
  { seconds: 59, eight: "94287082" },
  { seconds: 1111111109, eight: "07081804" },
  { seconds: 1111111111, eight: "14050471" },
  { seconds: 1234567890, eight: "89005924" },
  { seconds: 2000000000, eight: "69279037" },
  { seconds: 20000000000, eight: "65353130" },
];

describe("RFC 6238 (048 §4.2)", () => {
  it("reproduces every published SHA-1 vector, at eight digits and at six", () => {
    for (const v of VECTORS) {
      const step = stepAt(new Date(v.seconds * 1000));
      expect(totpCode(RFC_SECRET, step, 8), `T=${String(v.seconds)}`).toBe(v.eight);
      expect(totpCode(RFC_SECRET, step, 6), `T=${String(v.seconds)} at six digits`).toBe(v.eight.slice(-6));
    }
  });

  it("steps every thirty seconds and not on any other boundary", () => {
    expect(stepAt(new Date(0))).toBe(0);
    expect(stepAt(new Date(29_999))).toBe(0);
    expect(stepAt(new Date(30_000))).toBe(1);
    expect(TOTP_PERIOD_SECONDS).toBe(30);
    expect(TOTP_DIGITS).toBe(6);
  });
});

describe("verification returns the STEP, because the replay guard needs it (048 R19)", () => {
  const now = new Date(1_700_000_000_000);
  const step = stepAt(now);

  it("accepts the current step and returns it", () => {
    expect(verifyTotpCode({ secret: RFC_SECRET, code: totpCode(RFC_SECRET, step), now })).toBe(step);
  });

  it("accepts one step either side, and returns THAT step rather than the current one", () => {
    // The distinction matters: `last_used_step` records what was PRESENTED. A
    // verifier that returned the centre step for a skewed code would let the same
    // code be replayed under its own number.
    expect(verifyTotpCode({ secret: RFC_SECRET, code: totpCode(RFC_SECRET, step - 1), now })).toBe(step - 1);
    expect(verifyTotpCode({ secret: RFC_SECRET, code: totpCode(RFC_SECRET, step + 1), now })).toBe(step + 1);
  });

  it("refuses two steps away, so the window is one and not 'about a minute'", () => {
    expect(verifyTotpCode({ secret: RFC_SECRET, code: totpCode(RFC_SECRET, step - 2), now })).toBeUndefined();
    expect(verifyTotpCode({ secret: RFC_SECRET, code: totpCode(RFC_SECRET, step + 2), now })).toBeUndefined();
  });

  it("refuses a code from a different secret", () => {
    const other = mintTotpSecret();
    expect(verifyTotpCode({ secret: other, code: totpCode(RFC_SECRET, step), now })).toBeUndefined();
  });

  it("refuses anything that is not six digits, before it hashes anything", () => {
    for (const code of ["", "12345", "1234567", "12345a", " 12345 ", "abcdef"]) {
      expect(verifyTotpCode({ secret: RFC_SECRET, code, now }), code).toBeUndefined();
    }
    // …but a paste with surrounding whitespace is a person's typing, not an
    // attack, and is accepted.
    expect(verifyTotpCode({ secret: RFC_SECRET, code: ` ${totpCode(RFC_SECRET, step)} `, now })).toBe(step);
  });
});

describe("base32 and the provisioning URI", () => {
  it("encodes RFC 4648's own vectors, unpadded", () => {
    expect(base32Encode(Buffer.from("", "utf8"))).toBe("");
    expect(base32Encode(Buffer.from("f", "utf8"))).toBe("MY");
    expect(base32Encode(Buffer.from("fo", "utf8"))).toBe("MZXQ");
    expect(base32Encode(Buffer.from("foo", "utf8"))).toBe("MZXW6");
    expect(base32Encode(Buffer.from("foob", "utf8"))).toBe("MZXW6YQ");
    expect(base32Encode(Buffer.from("fooba", "utf8"))).toBe("MZXW6YTB");
    expect(base32Encode(Buffer.from("foobar", "utf8"))).toBe("MZXW6YTBOI");
  });

  it("spells every parameter out rather than leaving an app to guess", () => {
    // A URI that omits `algorithm`, `digits` or `period` means whatever the app
    // that scanned it assumes, and the failure lands on somebody who is locked
    // out at the moment they need in.
    const uri = otpauthUri({ secret: RFC_SECRET, label: "someone@example.invalid", issuer: "Longbox" });
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
    expect(uri).toContain("issuer=Longbox");
    expect(uri).toContain(`secret=${base32Encode(RFC_SECRET)}`);
    expect(uri.startsWith("otpauth://totp/Longbox:")).toBe(true);
  });

  it("mints twenty bytes, and two mints differ", () => {
    const a = mintTotpSecret();
    const b = mintTotpSecret();
    expect(a.length).toBe(20);
    expect(a.equals(b)).toBe(false);
  });
});
