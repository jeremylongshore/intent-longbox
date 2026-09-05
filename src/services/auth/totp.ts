// RFC 6238 TOTP, and the base32 the enrolling app expects — pure functions, no
// database, no clock of their own.
//
// **Why this is written here rather than installed** (048 §4.2). The algorithm is
// an HMAC, a big-endian counter and a dynamic truncation: forty lines against
// `node:crypto`, with published test vectors that make it falsifiable. The cost of
// a dependency here is not the code, it is that a second factor's verifier becomes
// a supply-chain surface — and the one thing this file must never do is be
// replaced by a helpful version that also logs the secret it was handed. It is
// tested against RFC 6238's own SHA-1 vectors in `tests/totp.test.ts`, so
// "correct" is a fact rather than a claim about a package.
//
// **SHA-1 is the parameter, and it is not a defect.** RFC 6238's default and the
// only algorithm every authenticator app agrees on. HMAC-SHA1's security here does
// not rest on SHA-1's collision resistance — it rests on the 160-bit secret and on
// the six-digit output being valid for thirty seconds and once (048 R19). A
// stronger digest with an app that cannot enrol it is not a stronger factor.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 048 §4.2: six digits, thirty-second step. Both are CHECKed in the schema too. */
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;

/**
 * A code is valid for its own step and one step either side (048 §4.3).
 *
 * One, not three: the window exists for clock skew between a phone and a server,
 * and every step added multiplies the guessing surface by the same factor it
 * multiplies the tolerance. It is a PROVISIONAL floor (042 A3) and is never quoted
 * as a security property.
 */
export const TOTP_STEP_WINDOW = 1;

/** 160 bits, which is HMAC-SHA1's block-optimal secret size and what apps expect. */
export const TOTP_SECRET_BYTES = 20;

/** A fresh TOTP secret. It leaves this process ONCE, to be shown to one person. */
export function mintTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** The step a moment falls in — `floor(unix_seconds / period)`. */
export function stepAt(now: Date, period: number = TOTP_PERIOD_SECONDS): number {
  return Math.floor(now.getTime() / 1000 / period);
}

/** The code for one step, as the zero-padded decimal string a person types. */
export function totpCode(secret: Buffer, step: number, digits: number = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  // `writeBigUInt64BE` rather than two 32-bit writes: the counter is a 64-bit
  // big-endian integer by the RFC, and the year-2106 bug in the 32-bit form is the
  // kind of thing that is discovered by a customer.
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", secret).update(counter).digest();
  // Dynamic truncation, RFC 4226 §5.3: the low nibble of the last byte picks the
  // offset; the high bit of the selected word is masked off so the value is
  // positive in every language that has signed integers.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * The step a presented code is valid for, or `undefined`.
 *
 * **It returns the STEP and not a boolean**, and that is the whole reason this
 * function exists in this shape: 048 R19's replay guard is `last_used_step`, so the
 * caller needs to know WHICH step was presented in order to consume it. A verifier
 * that answers "yes" cannot be given a replay guard afterwards.
 *
 * The comparison is `timingSafeEqual` over equal-length digit strings. The leak it
 * closes is small — six digits, a thirty-second window — and closing it costs one
 * function call, which is the ratio at which a side channel is worth removing
 * rather than reasoning about.
 */
export function verifyTotpCode(args: {
  secret: Buffer;
  code: string;
  now: Date;
  digits?: number;
  period?: number;
  window?: number;
}): number | undefined {
  const digits = args.digits ?? TOTP_DIGITS;
  const period = args.period ?? TOTP_PERIOD_SECONDS;
  const window = args.window ?? TOTP_STEP_WINDOW;
  const presented = args.code.trim();
  if (!new RegExp(`^[0-9]{${String(digits)}}$`).test(presented)) return undefined;

  const centre = stepAt(args.now, period);
  let matched: number | undefined;
  // EVERY candidate step is evaluated, and the loop does not break on a match.
  // Returning early would make "matched at the first candidate" measurably faster
  // than "matched at the last", which is a clock the caller cannot see and an
  // attacker can — 048 §9.3's constant answer applied one layer down.
  for (let offset = -window; offset <= window; offset += 1) {
    const step = centre + offset;
    const expected = totpCode(args.secret, step, digits);
    const same = timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(presented, "utf8"));
    if (same) matched = step;
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Base32 (RFC 4648, no padding) and the `otpauth://` URI.
//
// The URI is shown ONCE, to one person, and is never stored: it contains the
// secret in plain text by construction. It is built here rather than in a script
// so that the one place that renders a secret for a human is the same module that
// knows what a secret is.
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, unpadded — the encoding every authenticator app reads. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * The provisioning URI, with every parameter spelled out rather than defaulted.
 *
 * Apps disagree about defaults; a URI that omits `algorithm`, `digits` or `period`
 * is a URI whose meaning depends on which app scans it, and the failure mode is an
 * authenticator that produces codes this server will never accept — discovered at
 * the moment somebody is locked out.
 *
 * ⚠ `label` MUST NOT be a real person's name in any fixture, screenshot or example
 * (048 §7.1's rule for the invitation flow, which reaches every artifact this
 * subsystem produces).
 */
export function otpauthUri(args: {
  secret: Buffer;
  label: string;
  issuer: string;
  digits?: number;
  period?: number;
}): string {
  const params = new URLSearchParams({
    secret: base32Encode(args.secret),
    issuer: args.issuer,
    algorithm: "SHA1",
    digits: String(args.digits ?? TOTP_DIGITS),
    period: String(args.period ?? TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(args.issuer)}:${encodeURIComponent(args.label)}?${params.toString()}`;
}
