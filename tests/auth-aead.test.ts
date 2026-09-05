// L1: the authenticator key ring and its AEAD envelope — the four clauses of
// 048 R18, each asserted by making it FAIL.
//
// Bead: longbox-e5b.3.17 (alias E03-D06). Docs: 048 §4.2 (R18), §11 I9 (019 T31,
// NON-WAIVABLE); 050 §2 Q2 / §4 (the rotation idiom `key_version` borrows).
//
// R18 is four clauses and every one of them is here because its absence is a
// specific known failure, so every one is asserted NEGATIVELY as well as
// positively: an AEAD that never refuses is indistinguishable from a cipher, and
// an AAD binding that is never violated in a test is a parameter nobody has
// proved is read.
import { describe, expect, it } from "vitest";
import {
  AUTHENTICATOR_KEY_BYTES,
  AeadOpenError,
  AuthenticatorKeyError,
  authenticatorKeyEnv,
  decoySecret,
  open,
  requireAuthenticatorKey,
  seal,
} from "../src/services/auth/aead.js";

const V1 = Buffer.alloc(32, 0x11).toString("base64");
const V2 = Buffer.alloc(32, 0x22).toString("base64");
const ROW_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET = Buffer.from("a-twenty-byte-secret", "utf8");

describe("the boot refusal (048 §4.2, and `requirePinPepper`'s posture)", () => {
  it("refuses an empty environment, and the message names the VARIABLE and never a value", () => {
    let thrown: unknown;
    try {
      requireAuthenticatorKey({});
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AuthenticatorKeyError);
    expect((thrown as Error).message).toContain("LONGBOX_AUTHENTICATOR_KEY_V1");
    // The two modes that would be worse than refusing, named in the message so a
    // reader who hits it learns why there is no escape hatch.
    expect((thrown as Error).message).toContain("no plaintext mode");
    expect((thrown as Error).message).toContain("generate-on-boot");
  });

  it("refuses a key that is not thirty-two bytes, without printing it", () => {
    const short = Buffer.alloc(16, 0x33).toString("base64");
    let thrown: unknown;
    try {
      requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V1: short });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AuthenticatorKeyError);
    expect((thrown as Error).message).toContain("16 bytes");
    expect((thrown as Error).message).not.toContain(short);
    expect(AUTHENTICATOR_KEY_BYTES).toBe(32);
  });

  it("ignores an empty value rather than treating it as a key", () => {
    // An operator who comments a value out and leaves the name behind should get
    // the "not set" refusal, not a zero-length key.
    expect(() => requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V1: "" })).toThrow(
      AuthenticatorKeyError
    );
  });

  it("names each version's variable the same way the rotation instructions do", () => {
    expect(authenticatorKeyEnv(1)).toBe("LONGBOX_AUTHENTICATOR_KEY_V1");
    expect(authenticatorKeyEnv(2)).toBe("LONGBOX_AUTHENTICATOR_KEY_V2");
  });
});

describe("the four clauses of R18", () => {
  const ring = requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V1: V1 });

  it("round-trips, and the ciphertext holds no plaintext (clause 1: an AEAD)", () => {
    const sealed = seal(ring, SECRET, ROW_A);
    expect(sealed.ciphertext.includes(SECRET)).toBe(false);
    expect(open(ring, { ...sealed, aad: ROW_A }).equals(SECRET)).toBe(true);
  });

  it("refuses a ciphertext whose tag has been altered (clause 1, negatively)", () => {
    // Without authentication this would decrypt to something — GCM is a stream
    // cipher underneath, so an unauthenticated flip is a silent change of the
    // secret rather than an error. THAT is the failure the AEAD exists to make loud.
    const sealed = seal(ring, SECRET, ROW_A);
    const tampered = Buffer.from(sealed.ciphertext);
    tampered.writeUInt8(tampered.readUInt8(0) ^ 0x01, 0);
    expect(() => open(ring, { ...sealed, ciphertext: tampered, aad: ROW_A })).toThrow(AeadOpenError);
  });

  it("uses a fresh nonce per row (clause 2)", () => {
    const a = seal(ring, SECRET, ROW_A);
    const b = seal(ring, SECRET, ROW_B);
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.nonce.length).toBe(12);
    // Same plaintext, same key, different nonce → different ciphertext. If this
    // ever failed, the nonce would not be reaching the cipher at all.
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("BINDS THE ROW ID, so a ciphertext swapped between rows fails to authenticate (clause 3)", () => {
    // 048 I9's own wording: "asserted by swapping two rows' ciphertexts and
    // observing that BOTH fail to authenticate rather than decrypting — which is
    // the only test that distinguishes AEAD-with-AAD from AEAD-without."
    const a = seal(ring, SECRET, ROW_A);
    const b = seal(ring, Buffer.from("a-different-secret!!", "utf8"), ROW_B);
    expect(() => open(ring, { ...a, aad: ROW_B })).toThrow(AeadOpenError);
    expect(() => open(ring, { ...b, aad: ROW_A })).toThrow(AeadOpenError);
    // …and each still opens against its own row, so the failure above is the
    // binding and not a broken envelope.
    expect(open(ring, { ...a, aad: ROW_A }).equals(SECRET)).toBe(true);
  });

  it("stamps a key_version, encrypts under the HIGHEST and decrypts by the ROW'S (clause 4)", () => {
    const v1Only = requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V1: V1 });
    const old = seal(v1Only, SECRET, ROW_A);
    expect(old.keyVersion).toBe(1);

    // THE ROTATION, exactly as `.env.example` describes it: add a variable, restart.
    const both = requireAuthenticatorKey({
      LONGBOX_AUTHENTICATOR_KEY_V1: V1,
      LONGBOX_AUTHENTICATOR_KEY_V2: V2,
    });
    expect(both.current).toBe(2);
    const fresh = seal(both, SECRET, ROW_B);
    expect(fresh.keyVersion).toBe(2);

    // Old rows still open — no re-encryption, no downtime, no guessing per row.
    expect(open(both, { ...old, aad: ROW_A }).equals(SECRET)).toBe(true);
    expect(open(both, { ...fresh, aad: ROW_B }).equals(SECRET)).toBe(true);
  });

  it("refuses a row whose key_version it does not hold, and says which variable is missing", () => {
    // The step-3-before-step-2 mistake `.env.example` warns about: V1 removed
    // before its rows were re-encrypted.
    const v1Only = requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V1: V1 });
    const old = seal(v1Only, SECRET, ROW_A);
    const v2Only = requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V2: V2 });
    expect(() => open(v2Only, { ...old, aad: ROW_A })).toThrow(/LONGBOX_AUTHENTICATOR_KEY_V1/);
  });

  it("refuses a ciphertext sealed under a different key of the same version", () => {
    const other = requireAuthenticatorKey({
      LONGBOX_AUTHENTICATOR_KEY_V1: Buffer.alloc(32, 0x44).toString("base64"),
    });
    const sealed = seal(ring, SECRET, ROW_A);
    expect(() => open(other, { ...sealed, aad: ROW_A })).toThrow(AeadOpenError);
  });

  it("refuses a truncated ciphertext instead of reading past the end of it", () => {
    const sealed = seal(ring, SECRET, ROW_A);
    expect(() => open(ring, { ...sealed, ciphertext: Buffer.alloc(4), aad: ROW_A })).toThrow(/truncated/);
  });
});

describe("the timing decoy (048 §9.3)", () => {
  const ring = requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V1: V1 });

  it("is a real sealed secret under the real key, so it costs what a real one costs", () => {
    const decoy = decoySecret(ring);
    expect(decoy.keyVersion).toBe(ring.current);
    // It opens — a decoy that threw would be cheaper than the path it stands in
    // for, and the difference would be the very clock it exists to flatten.
    expect(open(ring, decoy).length).toBe(20);
  });

  it("is stable across calls, so it is not a per-request seal", () => {
    expect(decoySecret(ring).ciphertext.equals(decoySecret(ring).ciphertext)).toBe(true);
  });
});
