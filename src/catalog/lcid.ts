// THE ONE PARSER AND THE ONE CONSTRUCTOR FOR AN LCID (047 §3, invariant I4).
//
// "Exactly one function in `catalog` parses or constructs one" (047 §3.1). No
// other file in `src/` may contain the `lb.` literal in a template or a
// concatenation — `tests/contract/catalog-surface.test.ts` asserts it by static
// scan, because a second parser is how a canonical form stops being canonical.
//
// THE GRAMMAR (047 §3.1):
//
//     lb.<kind><vertical_code>.<16 payload chars><1 check char>
//     e.g.  lb.e.cmc.7q2k9v4xr3tb0m8h5
//
// `kind` is one character (`d` definition, `e` edition); `vertical_code` is the
// three-character code assigned in the `vertical_pack` row (§3.3); the payload is
// 80 bits from a CSPRNG rendered in Crockford base32; the final character is
// Crockford's mod-37 check symbol. Canonical form is LOWERCASE and equality is
// byte equality on it.
//
// WHY THE PAYLOAD CARRIES NO MEANING (047 §3.2). Three constructions were
// available and two were rejected:
//
//   (a) Fully structured — `cmc-marvel-asm-0300-direct-1p`. Rejected: every
//       attribute it encodes is an attribute the catalog can be WRONG about, and
//       when GCD corrects a publisher attribution the LCID either becomes a lie a
//       reader trusts or forces a re-mint, which §4.3 forbids. The failure is
//       silent, because nobody re-reads an identifier to check whether it still
//       describes its referent — which is exactly why it must not describe
//       anything.
//   (b) A bare UUID. Rejected, and it is the honest alternative. This estate
//       already carries scan_session.id, physical_item_id, candidate_set.id,
//       llm_rerank.id, outbox.id and idempotency keys, all UUIDs; "which of these
//       is the catalog id" would become a question answered by remembering. This
//       project's entire evidence regime is CITATION, and a value that cannot be
//       recognised in a grep is a value nobody cites.
//   (c) Opaque payload behind a typed prefix. ADOPTED, under the rule that makes
//       (a)'s failure mode unreachable: AN LCID MAY ENCODE ONLY WHAT CAN NEVER BE
//       CORRECTED. `kind` and `vertical` qualify and are the only two facts in
//       the whole catalog that do.
//
// AND WHY IT IS NOT SORTABLE — no ULID, no Snowflake, no UUIDv7 (047 §3.2, A6).
// A sortable identifier leaks minting order into every comparison that touches
// it, and the first place it would be used is exactly where it must not be: a
// merge. "The older LCID survives" is a rule that looks reasonable, needs no
// evidence, and is WRONG (§6.3(a)) — and an identifier whose bytes advertise age
// makes that wrong rule the path of least resistance for every future engineer.
// An identifier should not answer a question the design forbids asking.
//
// NO COLLISION PROBABILITY IS QUOTED HERE, and the refusal is the point (047
// §0/§3.2, 018 §2 A3). Eighty bits is a DESIGN PARAMETER with its derivation
// stated — wider than the 64-bit space where accidental collision is a design
// consideration, narrower than a UUID whose extra sixteen characters buy nothing
// an operator notices. The registry's primary key turns a collision into a failed
// INSERT that retries, which is an engineering fact; a probability would be a
// manufactured one nobody has measured on this system's volumes.

import { randomBytes } from "node:crypto";

/** The two kinds an LCID may name, and nothing else (047 §2.1, closed). */
export type LcidKind = "definition" | "edition";

/** Crockford base32: 32 symbols, with I, L, O and U removed to survive dictation. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * Crockford's five extra CHECK symbols, for values 32–36. They appear only as the
 * final character and never in the payload.
 */
const CHECK_EXTRA = "*~$=u";

const CHECK_ALPHABET = ALPHABET + CHECK_EXTRA;

/** 16 Crockford characters = 80 bits, exactly (047 §3.2). */
export const PAYLOAD_LENGTH = 16;

/** The prefix literal. Declared once so the scan for a second one is meaningful. */
export const LCID_PREFIX = "lb";

const KIND_CHAR: Record<LcidKind, string> = { definition: "d", edition: "e" };
const CHAR_KIND: Record<string, LcidKind> = { d: "definition", e: "edition" };

/** The three-character vertical code's shape (047 §3.3). */
export const VERTICAL_CODE_RE = /^[a-z]{3}$/;

const GRAMMAR = new RegExp(
  `^${LCID_PREFIX}\\.([de])\\.([a-z]{3})\\.([${ALPHABET}]{${PAYLOAD_LENGTH}})([${ALPHABET}*~$=u])$`
);

/** What a well-formed LCID says about itself, and nothing more. */
export interface LcidParts {
  readonly lcid: string;
  readonly kind: LcidKind;
  readonly verticalCode: string;
  readonly payload: string;
}

/** Thrown by `parseLcid`. Never thrown on a read path — see `src/catalog/resolve.ts`. */
export class InvalidLcidError extends Error {
  constructor(value: string, why: string) {
    super(`invalid LCID ${JSON.stringify(value)}: ${why}`);
    this.name = "InvalidLcidError";
  }
}

function payloadToBigInt(payload: string): bigint {
  let n = 0n;
  for (const ch of payload) {
    const v = ALPHABET.indexOf(ch);
    /* c8 ignore next */
    if (v < 0) throw new InvalidLcidError(payload, `character ${JSON.stringify(ch)} is not Crockford base32`);
    n = n * 32n + BigInt(v);
  }
  return n;
}

/** Crockford's mod-37 check symbol for a payload. */
export function checkSymbol(payload: string): string {
  return CHECK_ALPHABET[Number(payloadToBigInt(payload) % 37n)]!;
}

/**
 * Parse an LCID, verifying the check character.
 *
 * A BAD CHECK CHARACTER IS REJECTED, NOT REPAIRED (047 §3.1). The symbol exists
 * because §8's world contains hand-typed and OCR'd identifiers, and 036 §4.3's
 * copy code is a check-digited sticker string for the same reason. Repairing a
 * transcription error would turn a refused lookup into a WRONG one, which is the
 * failure the check symbol exists to prevent.
 *
 * Uppercase input is accepted and canonicalised to lowercase, because Crockford's
 * alphabet is case-insensitive by design and a support conversation will produce
 * both. The canonical form — the only form that is ever stored or compared — is
 * lowercase.
 */
export function parseLcid(value: string): LcidParts {
  const canonical = value.trim().toLowerCase();
  const m = GRAMMAR.exec(canonical);
  if (!m) throw new InvalidLcidError(value, "does not match lb.<kind>.<vertical>.<payload><check>");
  const [, kindChar, verticalCode, payload, check] = m as unknown as [string, string, string, string, string];
  const expected = checkSymbol(payload);
  if (check !== expected) {
    throw new InvalidLcidError(value, `check character is ${check}, expected ${expected}`);
  }
  return { lcid: canonical, kind: CHAR_KIND[kindChar]!, verticalCode, payload };
}

/** `parseLcid` as a total function, for the read paths that must not throw. */
export function tryParseLcid(value: string): LcidParts | null {
  try {
    return parseLcid(value);
  } catch {
    return null;
  }
}

/**
 * Build one LCID string. THIS IS NOT THE MINT — the mint is the `lcid_registry`
 * INSERT (047 §4.1), and `src/catalog/mint.ts` is the only caller.
 *
 * `randomSource` is injectable so the collision-and-retry path can be exercised
 * by a test without waiting for an 80-bit accident.
 */
export function mintLcidString(
  kind: LcidKind,
  verticalCode: string,
  randomSource: (bytes: number) => Buffer = randomBytes
): string {
  if (!VERTICAL_CODE_RE.test(verticalCode)) {
    throw new InvalidLcidError(
      verticalCode,
      "vertical code must be exactly three lowercase letters (047 §3.3)"
    );
  }
  // 10 bytes = 80 bits = 16 Crockford characters with no padding and no waste.
  let n = 0n;
  for (const byte of randomSource(10)) n = n * 256n + BigInt(byte);

  let payload = "";
  for (let i = 0; i < PAYLOAD_LENGTH; i += 1) {
    payload = ALPHABET[Number(n % 32n)]! + payload;
    n /= 32n;
  }
  return `${LCID_PREFIX}.${KIND_CHAR[kind]}.${verticalCode}.${payload}${checkSymbol(payload)}`;
}
