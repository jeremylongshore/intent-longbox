// The two redemption codes — minting them, normalising what a person typed, and
// digesting the result — and the one place 048 §7.1a's entropy question is
// answered rather than assumed.
//
// ============================================================================
// THE RULING §7.1a LEFT TO THE BUILD (E03-D07)
// ============================================================================
//
// 048 §7.1a offers a genuine choice and forbids making it silently:
//
//   > "Either **128 bits from a CSPRNG, base32-encoded, pasted or scanned** —
//   > the code is never typed, so its length costs nothing; **or** a short
//   > human-readable code (the six-to-eight characters the counter flow
//   > actually wants), permitted **only** with the device binding above **and**
//   > a per-shop ceiling on outstanding codes and on redemption attempts.
//   > **A short code without both is refused.**"
//
// **The two codes get different answers, and the reason is that the binding is
// available to one of them and structurally unavailable to the other.**
//
// **An INVITATION is short (`INVITATION_CODE_LENGTH` characters, ~40 bits).**
// It is permitted because both of §7.1a's conditions hold and are enforced in
// code that a test can fail: the redemption route's auth-allowlist row requires
// a live DEVICE session (R15, and the redemption additionally refuses a device
// enrolled at a different shop — 019 T24), and `invitations.ts` enforces both
// per-shop ceilings below. It is TAKEN rather than merely permitted because
// 048 §7.2 puts this code in an employee's hand at a counter, to be typed on a
// phone: a 26-character token typed on a phone keyboard is a token that gets
// photographed and messaged instead, and a control that is worked around is
// worse than the shorter one people follow. Forty bits behind a possession-bound
// channel, a per-shop attempt ceiling and a fifteen-minute failure window is not
// a keyspace anybody walks.
//
// **An ENROLLMENT CODE is 128 bits (`ENROLLMENT_CODE_LENGTH` characters).**
// It is redeemed by the phone BEING ENROLLED, which by construction holds no
// session at all — so §7.1a's device binding cannot hold, "a short code without
// both is refused" applies, and there is no choice left to make. The cost is
// nothing: §7.3's flow already shows this code on an owner's privileged screen
// to a phone standing next to it, so it is scanned or pasted, which is exactly
// the case §7.1a says length costs nothing for.
//
// **What this file does NOT do is enforce that difference at the database.** A
// digest is 64 hex characters whatever went into it (`migrations/024`'s header
// says so too). The lengths are here, the ceilings are in `policy.ts`, and the
// integration suites assert the redemption paths refuse without them.
//
// ============================================================================
// THE ALPHABET, AND WHY IT IS NOT BASE64
// ============================================================================
//
// Crockford's base32 — the digits and the uppercase letters minus `I`, `L`, `O`
// and `U`. The first three are excluded because they are the characters a person
// reading a code off a screen confuses with `1` and `0`, and `U` because it is
// the one that turns a random string into a word somebody has to read aloud
// across a counter. `normaliseCode` maps `I`/`L` to `1` and `O` to `0` on the
// way in, so a person who types what they saw is not punished for the ambiguity
// the alphabet already removed.
//
// It is not base64: a code that can contain `+`, `/` and case distinctions is a
// code that survives neither a phone keyboard nor a person saying it out loud.
//
// ============================================================================
// NO CODE VALUE LEAVES THIS MODULE EXCEPT TO ITS ONE CALLER
// ============================================================================
//
// A minted code is returned once, to the issuing service, which returns it once
// in a response body and never writes it anywhere. It is never logged, never put
// in an error envelope (048 §9.3 gives every redemption failure ONE code with no
// `details`), never stored in any column (`migrations/024`), and never appears in
// a fixture. `digestOf` is the only thing the database sees.
import { randomInt } from "node:crypto";
import { tokenHash } from "./secrets.js";

/**
 * Crockford base32, in its canonical order. 32 symbols, so each character
 * carries exactly 5 bits and the arithmetic in the two lengths below is a
 * multiplication rather than an estimate.
 */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 8 × 5 = 40 bits. Short by §7.1a's permission, never by default. */
export const INVITATION_CODE_LENGTH = 8;

/** 26 × 5 = 130 bits, which is the smallest whole number of characters ≥ 128. */
export const ENROLLMENT_CODE_LENGTH = 26;

/**
 * Mint `length` characters of CSPRNG output over the alphabet.
 *
 * `randomInt(32)` rather than `randomBytes(1) % 32`: 256 is a multiple of 32, so
 * the modulo would in fact be unbiased here — and writing it that way would be a
 * correctness argument that depends on the alphabet's length staying a power of
 * two, which is not a property anybody would remember to preserve. `randomInt`
 * is rejection-sampled by Node and is unbiased for any bound.
 */
function mint(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** A short invitation code. Returned ONCE, to the issuing service, and never stored. */
export function mintInvitationCode(): string {
  return mint(INVITATION_CODE_LENGTH);
}

/** A 128-bit enrollment code. Returned ONCE, to the issuing service, and never stored. */
export function mintEnrollmentCode(): string {
  return mint(ENROLLMENT_CODE_LENGTH);
}

/**
 * What a person typed, reduced to what was minted.
 *
 * Uppercases, drops every character outside the alphabet (so a hyphen, a space
 * or a stray newline from a paste costs nothing), and applies Crockford's three
 * confusion mappings: `I` and `L` become `1`, `O` becomes `0`.
 *
 * **Normalisation is the caller's, not the database's.** The digest is taken
 * over the normalised form, so two spellings of one code produce one digest and
 * the lookup is a single indexed equality — no `lower()`, no `trim()`, no
 * expression index, and in particular no `LIKE`.
 */
export function normaliseCode(raw: string): string {
  let out = "";
  for (const ch of raw.toUpperCase()) {
    const mapped = ch === "I" || ch === "L" ? "1" : ch === "O" ? "0" : ch;
    if (CODE_ALPHABET.includes(mapped)) out += mapped;
  }
  return out;
}

/**
 * `sha256(normalised code)`, hex — the only form of a code the database sees.
 *
 * SHA-256 and not argon2id, and the reason is 048 §3.2's, which is about the
 * ENTROPY OF THE INPUT rather than the sensitivity of the output: a password KDF
 * exists to make a low-entropy, human-chosen, long-lived secret expensive to
 * guess offline. These codes are machine-minted, live for minutes to a day, and
 * — unlike a PIN — are not re-derivable from a person. What bounds guessing them
 * is not the hash: it is the possession-bound channel, the per-shop attempt
 * ceiling and the expiry, all of which apply ONLINE, where a KDF would only hand
 * an attacker a way to make the server spend CPU at a rate they choose (048 §9.3
 * refuses exactly that trade for the lockout).
 */
export function digestOf(raw: string): string {
  return tokenHash(normaliseCode(raw));
}
