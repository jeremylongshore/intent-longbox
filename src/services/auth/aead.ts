// The authenticator key: where it comes from, what it refuses at boot, and the
// AES-256-GCM envelope every encrypted authenticator column is sealed in.
//
// ============================================================================
// THE ONE PLACE LOCKED DECISION 2 IS APPROACHED, AND IT SAYS SO (048 §4.2)
// ============================================================================
//
// Locked decision 2 is "raw keys never in the database", and it is a rule about
// PROVIDER credentials, every one of which is named by a `key_ref` that resolves
// to an environment variable. A TOTP secret cannot be satisfied by that
// indirection: the server has to be able to READ it to verify a code, and there is
// no environment variable per person. So 048 §4.2 rules the split explicitly —
// **the secret is stored encrypted at rest with a key that lives in the process
// environment and never in the database**, and the RULE half (never in the clear,
// never in a log, never in a fixture) lands here while the CUSTODY half is
// E03-B05's vault addressing (050 §3: SOPS is the source, a mode-0600 tmpfs
// `EnvironmentFile` is the form, and the rendered file is never a backup).
//
// ============================================================================
// ROTATION, BORROWED FROM 050 §4 RATHER THAN INVENTED (the `key_version` column)
// ============================================================================
//
// 050 ruled that a credential rotation is two append-only facts and that liveness
// is a predicate over them, with "the newest live version wins". The same shape,
// one layer down, with the environment standing in for the introduction table:
//
//   * **Every key present in the environment can DECRYPT.** A row is opened with
//     the key its own `key_version` names — never with "the current key", which is
//     the guess a schema without a version column is forced to make per row.
//   * **The HIGHEST version present ENCRYPTS.** Introducing `..._V2` is therefore
//     a rotation an operator performs by adding a variable and restarting; no
//     existing row is touched and no deploy has to re-encrypt anything.
//   * **Removing the old variable is the RETIREMENT**, and it is refused in
//     practice by the rows themselves: an authenticator still at `key_version = 1`
//     stops opening the moment `..._V1` leaves the environment. Re-encrypting
//     those rows is a later job that produces facts (a retirement and a fresh
//     enrollment per person, never an in-place rewrite of a secret column) — filed
//     as its own bead rather than smuggled into this one.
//
// **The failure mode is stated rather than discovered**: a key removed before the
// rows that need it are re-encrypted takes every affected person's second factor
// with it, and their way back in is 048 §8's recovery codes — which is exactly the
// path those codes exist for, and exactly why they are issued at enrollment rather
// than on request.
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/** `LONGBOX_AUTHENTICATOR_KEY_V<n>` — the name of the key at version `n`. */
export function authenticatorKeyEnv(version: number): string {
  return `LONGBOX_AUTHENTICATOR_KEY_V${String(version)}`;
}

const KEY_ENV_PATTERN = /^LONGBOX_AUTHENTICATOR_KEY_V([1-9][0-9]?)$/;

/** AES-256: thirty-two bytes, and nothing else is a key. */
export const AUTHENTICATOR_KEY_BYTES = 32;
/** GCM's standard nonce size. Twelve bytes, fresh per row, never reused. */
export const AEAD_NONCE_BYTES = 12;
/** GCM's tag, appended to the ciphertext in the same column. */
export const AEAD_TAG_BYTES = 16;

/** Thrown at boot when the key is absent, malformed, or the wrong length. */
export class AuthenticatorKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticatorKeyError";
  }
}

/** Thrown when a ciphertext does not authenticate, or names a key we do not hold. */
export class AeadOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AeadOpenError";
  }
}

/**
 * Every key version this process holds, and the one it writes new rows under.
 *
 * A ring rather than a key, from day one, for 048 R18's reason: "adding it costs
 * two bytes now; adding it during an incident costs a migration on a table the
 * incident is about".
 */
export interface AuthenticatorKeyring {
  readonly keys: ReadonlyMap<number, Buffer>;
  /** The highest version present — what `seal` uses. */
  readonly current: number;
}

/**
 * **The server does not serve without an authenticator key.**
 *
 * Fail-closed and unconditional rather than `NODE_ENV`-gated, exactly as
 * `requirePinPepper` is one file over and for the same reason: a check that only
 * bites in production is a check no developer ever sees fail. There is no
 * plaintext-secret mode and no "generate one if missing" mode — a key generated at
 * boot would encrypt every enrollment made in that process and open none of them
 * after a restart, which is a subsystem that appears to work and silently locks
 * every owner out of their own shop.
 *
 * The value is base64 and decodes to exactly thirty-two bytes. Both are checked,
 * and the error names the VARIABLE and the defect — never the value.
 */
export function requireAuthenticatorKey(env: NodeJS.ProcessEnv = process.env): AuthenticatorKeyring {
  const keys = new Map<number, Buffer>();
  for (const [name, raw] of Object.entries(env)) {
    const match = KEY_ENV_PATTERN.exec(name);
    if (!match || raw === undefined || raw.length === 0) continue;
    const version = Number(match[1]);
    const key = Buffer.from(raw.trim(), "base64");
    if (key.length !== AUTHENTICATOR_KEY_BYTES) {
      throw new AuthenticatorKeyError(
        `${name} decodes to ${String(key.length)} bytes; AES-256-GCM needs exactly ` +
          `${String(AUTHENTICATOR_KEY_BYTES)}. Generate one with \`openssl rand -base64 32\` and put ` +
          `it in SOPS. (The value is never printed by this process, here or anywhere else.)`
      );
    }
    keys.set(version, key);
  }

  if (keys.size === 0) {
    throw new AuthenticatorKeyError(
      `${authenticatorKeyEnv(1)} is not set. Every TOTP secret is stored as AES-256-GCM ` +
        `ciphertext with a per-row nonce and the row's id as additional authenticated data ` +
        `(048 §4.2, R18), and the key lives in the process environment and never in the ` +
        `database. There is no plaintext mode and no generate-on-boot mode: a key minted at ` +
        `startup would open nothing after a restart and would lock every owner out of their ` +
        `own shop. Generate one with \`openssl rand -base64 32\` and put it in SOPS.`
    );
  }

  return { keys, current: Math.max(...keys.keys()) };
}

/** A sealed secret: what the three columns of `user_authenticator` hold. */
export interface SealedSecret {
  /** Ciphertext with the 16-byte GCM tag appended. */
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly keyVersion: number;
}

/**
 * Seal a secret under the ring's current key, bound to `aad`.
 *
 * `aad` is the ROW'S ID (048 R18). The binding is what makes a ciphertext lifted
 * from one row and pasted into another fail to authenticate rather than decrypt to
 * a working secret — "an encryption that does not bind the ciphertext to the row
 * binds it to nothing". It is a caller's argument rather than a default here so
 * that the call site has to name what it is binding to.
 */
export function seal(ring: AuthenticatorKeyring, plaintext: Buffer, aad: string): SealedSecret {
  const key = ring.keys.get(ring.current);
  if (!key) throw new AuthenticatorKeyError(`no key at version ${String(ring.current)}`);
  const nonce = randomBytes(AEAD_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), nonce, keyVersion: ring.current };
}

/**
 * Open a sealed secret, or throw.
 *
 * It throws rather than returning `undefined` because there is no legitimate state
 * in which a row this process wrote fails to open: a failure is either a key that
 * was removed before its rows were re-encrypted, or a ciphertext that has been
 * moved or edited — and both are incidents, not verdicts. The CALLER converts it
 * into 048 §9.3's constant refusal so the wire never learns which.
 */
export function open(ring: AuthenticatorKeyring, sealed: SealedSecret & { readonly aad: string }): Buffer {
  const key = ring.keys.get(sealed.keyVersion);
  if (!key) {
    throw new AeadOpenError(
      `no key at version ${String(sealed.keyVersion)}: this row was sealed under ` +
        `${authenticatorKeyEnv(sealed.keyVersion)}, which is not in the environment. Restore the ` +
        `variable, or re-enrol the affected authenticators. A key removed before its rows are ` +
        `re-encrypted takes those second factors with it (048 §8's recovery codes are the way back).`
    );
  }
  if (sealed.ciphertext.length < AEAD_TAG_BYTES) throw new AeadOpenError("ciphertext is truncated");
  const body = sealed.ciphertext.subarray(0, sealed.ciphertext.length - AEAD_TAG_BYTES);
  const tag = sealed.ciphertext.subarray(sealed.ciphertext.length - AEAD_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.nonce);
  decipher.setAAD(Buffer.from(sealed.aad, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // GCM's own failure, and the ONLY thing it means: the ciphertext, the nonce,
    // the key or the AAD is not the one this was sealed with. Deliberately not
    // forwarded verbatim — `decipher.final()`'s message is the same for a swapped
    // row and a corrupted byte, and pretending to distinguish them would be worse
    // than saying so.
    throw new AeadOpenError(
      "the ciphertext did not authenticate: it was sealed under a different key, a different " +
        "nonce or a different row id (048 R18's AAD binding), or it has been altered"
    );
  }
}

/**
 * A DECOY sealed secret, so an unenrolled person costs what an enrolled one does.
 *
 * 048 §9.3: "the same work is done in each case so the timing does not distinguish
 * them". Without it, a TOTP verification for somebody with no authenticator returns
 * before any decryption happens, and the difference is a query interface over who
 * has a second factor — answered with a stopwatch, against exactly the population
 * (owners) worth enumerating.
 *
 * It is sealed under the ring's real current key at first use and cached, because
 * a decoy that is cheaper than the real path is not a decoy.
 */
let decoy: (SealedSecret & { aad: string }) | undefined;
export function decoySecret(ring: AuthenticatorKeyring): SealedSecret & { aad: string } {
  if (!decoy) {
    const aad = "00000000-0000-4000-8000-000000000000";
    decoy = { ...seal(ring, Buffer.alloc(20, 0), aad), aad };
  }
  return decoy;
}

/** Constant-time equality for two buffers of any length. Used on nothing but secrets. */
export function bytesMatch(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
