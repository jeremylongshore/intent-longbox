// Minting and hashing, and the two different answers 048 gives to "how do I
// hash this?" depending on what the input is.
//
// **A session token gets SHA-256; a PIN gets argon2id plus a pepper.** 048 §3.2
// argues it and the reason is the entropy of the INPUT, not the sensitivity of
// the output: a password KDF exists to make a low-entropy, human-chosen,
// long-lived secret expensive to guess offline, while a session token is a
// 256-bit machine-generated short-lived secret with no dictionary — and a
// per-request KDF is a denial-of-service surface whose rate the attacker sets.
//
// THE DEPENDENCY CHOICE, STATED (E03-D09). argon2id arrives via **`hash-wasm`**,
// a pure-WebAssembly implementation, rather than via `argon2` (node-gyp, with a
// prebuild fallback that compiles on the machine) or `@node-rs/argon2` (prebuilt
// native binaries per platform/libc). The reason is that this is the FIRST
// dependency in the repository that could fail to install rather than fail to
// work: a native build is a compiler on the deploy host and a different artifact
// per platform, and a prebuilt binary is a platform matrix that has to include
// whatever the VPS and CI are running that month. A `.wasm` file runs the same
// bytes on the laptop, in CI and on the VPS, with no build step and nothing to
// approve in pnpm's `ignoredBuiltDependencies`. The cost is honest and it is
// speed: WASM argon2id is meaningfully slower than the native builds at equal
// parameters. That cost is paid on a PIN verification — one per operator switch,
// not one per request — and 048 §9.1's lockout is what bounds how often an
// attacker can make us pay it.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

/** 048 §3.2 — 256 bits from a CSPRNG, base64url so it is cookie-safe. */
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What the database stores for a token, and the only form it ever sees. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Not used on the session lookup — that is an indexed equality in Postgres — but
 * on the device-credential path, where the candidate is compared against a row
 * already fetched. 048 §9.3's constant-answer rule is about the RESPONSE; this
 * is the same discipline applied to the timing of the comparison itself.
 */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * argon2id parameters — **PROVISIONAL floors set at build time and recorded**
 * (048 §9.2, 042 A3), never quoted as a security property.
 *
 * 64 MiB, three passes, one lane. The derivation: this runs on a request thread
 * of a single Node process serving a shop's counter phone, at most once per
 * operator switch, and the number that matters is how expensive it makes an
 * OFFLINE sweep of a million-entry keyspace by somebody holding a `pg_dump` —
 * which is the attack §9.2's pepper exists for and this parameter set makes
 * merely expensive rather than impossible on its own. Raising them is free; the
 * pepper is what does the load-bearing work.
 */
const ARGON2_PARAMS = { parallelism: 1, iterations: 3, memorySize: 64 * 1024, hashLength: 32 } as const;

/**
 * The process-environment pepper (048 §9.2, R6).
 *
 * Mixed into the PIN before hashing: `argon2id(pin ‖ pepper)`. It is NEVER in
 * the database, in a migration, in a fixture or in a backup of this database —
 * the same custody posture §4.2 gives the authenticator key and 041 A5 gives the
 * purge-epoch key, so **a database compromise alone is not a credential
 * compromise**.
 *
 * The two-secret failure mode is stated rather than discovered: losing the
 * pepper invalidates every PIN in the system. That makes it a backup-and-custody
 * obligation on E03-B05 (048 §12.4 row 3), filed there rather than assumed to be
 * somebody's habit.
 */
export const PIN_PEPPER_ENV = "LONGBOX_PIN_PEPPER";

/** Thrown at boot when the pepper is absent or too weak to be one. */
export class PepperConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PepperConfigError";
  }
}

/**
 * A pepper shorter than this is a typo, not a secret. Stated as a floor rather
 * than as a format so an operator may use whatever their secret store emits.
 */
export const MIN_PEPPER_LENGTH = 32;

/**
 * **The server does not serve without a pepper.**
 *
 * Fail-closed, and unconditional rather than `NODE_ENV`-gated, for the reason
 * `assertGatewayConfigOrThrow` gives one file over: a check that only bites in
 * production is a check no developer ever sees fail. The alternative — hashing
 * with an empty pepper when the variable is unset — is the worst available
 * outcome, because every PIN written in that state is silently un-peppered and
 * nothing about the running system says so.
 */
export function requirePinPepper(env: NodeJS.ProcessEnv = process.env): string {
  const pepper = env[PIN_PEPPER_ENV] ?? "";
  if (pepper.length === 0) {
    throw new PepperConfigError(
      `${PIN_PEPPER_ENV} is not set. Every operator PIN is hashed with argon2id over ` +
        `(pin ‖ pepper), and the pepper is what puts a six-digit keyspace out of reach of a ` +
        `stolen database dump (048 §9.2). There is no empty-pepper mode: a PIN written without ` +
        `one would be un-peppered forever and nothing about the running system would say so. ` +
        `Generate one with \`openssl rand -base64 48\` and put it in SOPS.`
    );
  }
  if (pepper.length < MIN_PEPPER_LENGTH) {
    throw new PepperConfigError(
      `${PIN_PEPPER_ENV} is ${String(pepper.length)} characters; at least ${String(MIN_PEPPER_LENGTH)} ` +
        `are required. A short pepper is a typo wearing a secret's name.`
    );
  }
  return pepper;
}

/** `argon2id(pin ‖ pepper)`, encoded — salt, parameters and digest in one string. */
export async function hashPin(pin: string, pepper: string): Promise<string> {
  return argon2id({
    password: `${pin}${pepper}`,
    salt: randomBytes(16),
    outputType: "encoded",
    ...ARGON2_PARAMS,
  });
}

/**
 * Verify a PIN against a stored digest.
 *
 * Returns `false` rather than throwing on a malformed digest: a corrupted row is
 * a refusal, not a 500, and 048 §9.3 requires every failure at this boundary to
 * answer the same thing.
 */
export async function verifyPin(pin: string, pepper: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: `${pin}${pepper}`, hash });
  } catch {
    return false;
  }
}
