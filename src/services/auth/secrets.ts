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
 * Mixed into every credential this system hashes before hashing it:
 * `argon2id(secret ‖ pepper)`. It is NEVER in the database, in a migration, in a
 * fixture or in a backup of this database — the same custody posture §4.2 gives
 * the authenticator key and 041 A5 gives the purge-epoch key, so **a database
 * compromise alone is not a credential compromise**.
 *
 * ⚠ **ONE PEPPER, FOR FOUR THINGS, AND THAT IS A DECISION** (057 §4.1, closing
 * 055 §9 item 11). It peppers the operator PIN, the recovery code, and — from
 * E03-D11 — the PASSWORD. 048 §9.2 rules one value for both factors it names
 * (*"PIN and password hashes are computed over `secret ‖ pepper`"*), and 055 §9
 * item 11 hands the confirmation to this bead. Two peppers were considered and
 * refused: they would be two custody obligations, two things to lose and two
 * rotations to run, in exchange for a separation that buys nothing — every path
 * back in after a pepper loss is authenticated by something under the lost value
 * (055 §2 E4/E6), so splitting the value splits the blast radius of nothing.
 *
 * ⚠ **THE NAME IS NOW NARROWER THAN THE JOB, AND IT IS KEPT ANYWAY** (057 §4.1).
 * `LONGBOX_PIN_PEPPER` reads as though rotating it would only affect PINs. It
 * would not: it would invalidate every PIN, every password and every recovery
 * code, at once, for every shop. Renaming a boot-required secret's variable is a
 * deploy-coordination step with a real outage window and no security gain, so
 * the correction lands where a reader actually looks — `.env.example`, this
 * comment, and `PepperConfigError`'s message — and the rename rides the ring
 * that 055 §9 item 5 asks for (057 §7 residual R3).
 *
 * **What losing it costs, stated in one sentence because 055 RULING 6 requires
 * that sentence to exist:** every staff sign-in and every owner sign-in stops
 * working simultaneously, in every shop, and the way back is not 048 §8's
 * recovery codes — those are hashed with this value too — but 055 §6.1's
 * runbook. That makes it a backup-and-custody obligation, discharged as a
 * DECISION by 055 (escrow, RULING 1) and as a POSTURE by 055 RULING 4's interim
 * (no escrow exists yet; Option B is the live posture). 048 §12.4 row 3's
 * orphaned half is re-homed to this bead and answered in 057 §5.
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
      `${PIN_PEPPER_ENV} is not set. Every operator PIN, every PASSWORD and every RECOVERY ` +
        `CODE is hashed with argon2id over (secret ‖ pepper) — one value for all three (048 ` +
        `§9.2; 055 §9 item 11) — and the pepper is what puts a six-digit keyspace out of reach ` +
        `of a stolen database dump. There is no empty-pepper mode: a credential written without ` +
        `one would be un-peppered forever and nothing about the running system would say so. ` +
        `Generate one with \`openssl rand -base64 48\` and put it in SOPS. Losing it stops every ` +
        `sign-in in every shop at once and the recovery codes do not survive it either (055 §2 ` +
        `E4); the way back is 055 §6.1's runbook.`
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

/** `argon2id(secret ‖ pepper)`, encoded — salt, parameters and digest in one string. */
export async function hashWithPepper(secret: string, pepper: string): Promise<string> {
  return argon2id({
    password: `${secret}${pepper}`,
    salt: randomBytes(16),
    outputType: "encoded",
    ...ARGON2_PARAMS,
  });
}

/** The PIN's name for it. Kept so a reader of `pin.ts` sees what is being hashed. */
export async function hashPin(pin: string, pepper: string): Promise<string> {
  return hashWithPepper(pin, pepper);
}

/**
 * A RECOVERY CODE's name for it (E03-D06, 048 §8.1).
 *
 * 048 §8.1 says recovery codes are "stored with argon2id", and this is the one
 * place in the system where that instruction runs against `codes.ts`'s argument
 * that a machine-minted code deserves SHA-256 because the ENTROPY OF THE INPUT is
 * what decides. **The record wins, and it is right for a reason `codes.ts` does not
 * cover: lifetime.** An invitation code lives a day and an enrollment code fifteen
 * minutes, so a dump that contains one contains something already dead. A recovery
 * code sits in a drawer for a year, so its digest sits in every backup for a year —
 * and the PEPPER, which only a KDF's shape gives us a natural place to mix in, is
 * what keeps a stolen `pg_dump` from being an offline verifier for a value the
 * owner still holds on paper.
 *
 * **The cost is stated rather than discovered**: verification tries the live codes
 * of the newest batch in turn, so a wrong code costs the batch size in argon2id
 * runs. That is bounded by `RECOVERY_CODE_COUNT`, by the per-person lockout (048
 * §9.1), and today by there being no route at all — the flow is a CLI an operator
 * runs. It is why the batch is eight and not forty.
 *
 * ⚠ **THE PEPPER HERE IS NOW A DECISION AND NOT AN INHERITANCE** (057 §4.7,
 * ruling on 055 F8/F9 and its §9 item 4a). The 055 cannon found that this
 * function's delegation made 048 §8's fallback depend on the pepper *by
 * accident*, and RECOMMENDED branch (a): 128-bit codes hashed WITHOUT the
 * pepper, so the fallback survives a pepper loss. **Branch (b) is taken — keep
 * the pepper, keep ten characters — and the ground is 048 R20, which the
 * recommendation predates in effect.** A recovery code substitutes for the
 * SECOND factor only: it is never accepted without the password, and the
 * password is peppered with this same value (048 §9.2, 055 §9 item 11). So a
 * pepper loss takes the FIRST factor whatever this function does, and branch (a)
 * would buy no pepper-loss survivability at all while trading away the
 * ergonomics 048 §8.1 ratified — *"a 26-character string on a slip in a drawer
 * is a string that gets photographed instead"*. **The consequence 055 requires
 * to be written in terms, and it is written in 048 §8, in `.env.example` and
 * here: recovery codes are a fallback for a LOST PHONE and never for a CUSTODY
 * LOSS.**
 */
export async function hashRecoveryCode(code: string, pepper: string): Promise<string> {
  return hashWithPepper(code, pepper);
}

/** Verify a recovery code against a stored digest. Same contract as `verifyPin`. */
export async function verifyRecoveryCode(code: string, pepper: string, hash: string): Promise<boolean> {
  return verifyPin(code, pepper, hash);
}

/**
 * **The general verify, and the name every new caller uses** (E03-D11).
 *
 * `verifyPin` is what this function is called when a PIN is what is being
 * verified, and it stays for the readers of `pin.ts`. The first factor is not a
 * PIN and calling `verifyPin(password, …)` would read as a bug in the one file
 * where a reader most needs to be sure it is not one.
 */
export async function verifyWithPepper(secret: string, pepper: string, hash: string): Promise<boolean> {
  return verifyPin(secret, pepper, hash);
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
