// Central env-derived config. Secrets stay in process.env; this module never
// logs or re-exports raw key values beyond handing them to transport code.
import "dotenv/config";
import { requirePinPepper } from "./services/auth/secrets.js";
import { DEFAULT_MEDIA_POLICY, type MediaPolicy } from "./services/media.js";
import {
  PROVISIONAL_SERVICE_ACCOUNT_METERED_BUDGET,
  PROVISIONAL_SHOP_METERED_BUDGET,
} from "./services/rateLimit.js";

export interface BandThresholds {
  high: number;
  medium: number;
}

export interface AppConfig {
  port: number;
  databaseUrl: string;
  uploadsDir: string;
  bands: BandThresholds;
  /**
   * The upload guard's ceilings (E03-B07). OPTIONAL in the type and always set
   * by `loadConfig`: a test that builds a config literal gets
   * `DEFAULT_MEDIA_POLICY` through `mediaPolicy()` below rather than a
   * `undefined` limit that would read as "no limit". The default is the SAFE
   * value, so an omission tightens rather than opens.
   */
  media?: MediaPolicy;
  /**
   * 048 §9.2 (R6) — the process-environment pepper mixed into every PIN hash.
   *
   * It is part of the CONFIG rather than read at the point of use so that the
   * server refuses to boot without it (`loadConfig` throws), instead of
   * discovering the absence at the first PIN a shop sets. Its VALUE never
   * appears in a log line, an error body, a fixture or a `pg_dump` — I9's canary
   * asserts that — and its custody, backup and rotation are E03-B05's
   * (048 §12.4 row 3).
   */
  pinPepper: string;
  /**
   * 048 §5.1 (R9) — the origin(s) this deployment answers on.
   *
   * The `Sec-Fetch-Site` check is the primary mechanism; this list is the
   * fallback for a request that carries no `Sec-Fetch-Site` at all (an older
   * browser, a non-browser client). An absent `Origin` on a non-safelisted
   * method is a refusal, so the list being empty makes the fallback closed
   * rather than open.
   */
  publicOrigins: readonly string[];
  /**
   * The two per-owner metered ceilings (E03-B05, 050 §2 Q4(c), §6.4).
   *
   * OPTIONAL in the type and always set by `loadConfig`, on
   * `AppConfig.media`'s reasoning: a test that builds a config literal gets the
   * PROVISIONAL defaults rather than an `undefined` that would read as "no
   * limit". The default is the safe value, so an omission tightens.
   */
  spendCeilings?: SpendCeilings;
}

/** Paid identify calls per shop per day, by whose money pays (050 §6.4). */
export interface SpendCeilings {
  /** `shop`-owned spend: the shop's own credential. PROVISIONAL 500. */
  shop: number;
  /** `longbox`-owned spend: the service account. PROVISIONAL 150. */
  longbox: number;
}

/** The env var naming the deployment's public origin(s), comma-separated. */
export const PUBLIC_ORIGIN_ENV = "LONGBOX_PUBLIC_ORIGIN";

export function publicOrigins(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  return (env[PUBLIC_ORIGIN_ENV] ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/** The policy in force for a request: the configured one, or the safe default. */
export function mediaPolicy(config: Pick<AppConfig, "media">): MediaPolicy {
  return config.media ?? DEFAULT_MEDIA_POLICY;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`env ${name} is not a number`);
  return n;
}

/** Thrown at boot when a media ceiling is set past the point where it protects. */
export class MediaPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaPolicyError";
  }
}

/**
 * How far above the default any single ceiling may be raised.
 *
 * **The check REFUSES; it does not clamp** (invariant review of `1c25749`,
 * item 5), and the choice is the same one `assertGatewayConfigOrThrow` makes
 * twenty lines below: a silent clamp leaves an operator believing a ceiling they
 * set is the one in force, which is the failure the gateway's
 * "a presence check is not a scope check" note is about. Refusing is loud, is
 * fixed in one edit, and cannot be missed in a log nobody reads.
 *
 * Four is not a measurement — it is the point past which a "ceiling" stops
 * describing a phone photograph: 4x `maxPixels` is 320 MP, six times the largest
 * sensor in 035 §9's cohort. `MEDIA_MAX_PIXELS=99999999999` used to disable the
 * decompression-bomb guard in silence, which is the specific bug this closes.
 * Ceilings may be lowered without limit: tightening is always allowed.
 */
export const MEDIA_CEILING_HEADROOM = 4;

export function assertMediaPolicyOrThrow(policy: MediaPolicy): MediaPolicy {
  for (const [key, value] of Object.entries(policy) as Array<[keyof MediaPolicy, number]>) {
    const ceiling = DEFAULT_MEDIA_POLICY[key] * MEDIA_CEILING_HEADROOM;
    if (!Number.isFinite(value) || value <= 0) {
      throw new MediaPolicyError(`media policy ${key} must be a positive number (got ${value})`);
    }
    if (value > ceiling) {
      throw new MediaPolicyError(
        `media policy ${key} is ${value}, which is more than ${MEDIA_CEILING_HEADROOM}x the default ` +
          `(${DEFAULT_MEDIA_POLICY[key]}). These ceilings are safety floors, not capacity settings: a value ` +
          `this far above the default disables the control rather than tuning it. Lower it, or change the ` +
          `default in src/services/media.ts with the derivation written down.`
      );
    }
  }
  return policy;
}

// ---------------------------------------------------------------------------
// The two per-owner spend ceilings, checked at boot (E03-B05, 050 §2 Q4(c))
// ---------------------------------------------------------------------------

/** The env vars that set each ceiling. Named per owner, never one shared number. */
export const SPEND_CEILING_ENV = {
  shop: "LONGBOX_METERED_BUDGET_SHOP",
  longbox: "LONGBOX_METERED_BUDGET_SERVICE_ACCOUNT",
} as const;

/** Thrown at boot when a spend ceiling is set past the point where it protects. */
export class SpendCeilingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendCeilingError";
  }
}

/**
 * How far above the PROVISIONAL default a ceiling may be raised.
 *
 * The same shape and the same argument as `MEDIA_CEILING_HEADROOM`: **the check
 * REFUSES; it does not clamp**, because a silent clamp leaves an operator
 * believing a ceiling they set is the one in force. Four is not a measurement —
 * it is the point past which "circuit breaker" stops describing the number.
 * Lowering is always allowed and always safe: it fails toward the manual path,
 * which is a route an operator already has (050 §2 Q4(d)).
 */
export const SPEND_CEILING_HEADROOM = 4;

/**
 * Refuse an unusable pair of ceilings at boot, on `assertMediaPolicyOrThrow`'s
 * pattern and for its reason: a check that only bites in production is a check
 * no developer ever sees fail.
 *
 * ⚠ ZERO IS LEGAL HERE AND IS NOT LEGAL FOR A MEDIA CEILING, and the difference
 * is which way each fails. A media ceiling of zero would refuse every upload —
 * it breaks the pilot. A metered budget of zero puts every identify call on the
 * MANUAL PATH, which is a supported route the low band already uses (042 §8.3,
 * 050 §2 Q4(d)), so it is a legitimate operator act: "this deployment spends no
 * model money today". `ShopRateLimiter.take` already refuses a limit below 1
 * including the first call of a window, so a zeroed budget really is zero rather
 * than one-per-window.
 */
export function assertSpendCeilingsOrThrow(ceilings: SpendCeilings, defaults: SpendCeilings): SpendCeilings {
  for (const owner of ["shop", "longbox"] as const) {
    const value = ceilings[owner];
    const ceiling = defaults[owner] * SPEND_CEILING_HEADROOM;
    if (!Number.isInteger(value) || value < 0) {
      throw new SpendCeilingError(
        `${SPEND_CEILING_ENV[owner]} must be a non-negative whole number of calls (got ${value}). ` +
          `Zero is legal and means every identify call takes the manual path.`
      );
    }
    if (value > ceiling) {
      throw new SpendCeilingError(
        `${SPEND_CEILING_ENV[owner]} is ${value}, which is more than ${SPEND_CEILING_HEADROOM}x the ` +
          `PROVISIONAL default (${defaults[owner]}). These are circuit-breaker floors, not capacity ` +
          `settings: a value this far above the default disables the control rather than tuning it. ` +
          `Lower it, or change the default in src/services/rateLimit.ts with the derivation written ` +
          `down and a 000-docs/006 row.`
      );
    }
  }
  return ceilings;
}

export function loadConfig(): AppConfig {
  return {
    port: num("PORT", 3000),
    databaseUrl: process.env.DATABASE_URL ?? "",
    uploadsDir: process.env.UPLOADS_DIR ?? "uploads",
    bands: {
      high: num("BAND_HIGH", 0.85),
      medium: num("BAND_MEDIUM", 0.5),
    },
    media: assertMediaPolicyOrThrow({
      maxPixels: num("MEDIA_MAX_PIXELS", DEFAULT_MEDIA_POLICY.maxPixels),
      maxDimension: num("MEDIA_MAX_DIMENSION", DEFAULT_MEDIA_POLICY.maxDimension),
      sessionPhotoLimit: num("MEDIA_SESSION_PHOTO_LIMIT", DEFAULT_MEDIA_POLICY.sessionPhotoLimit),
      sessionByteLimit: num("MEDIA_SESSION_BYTE_LIMIT", DEFAULT_MEDIA_POLICY.sessionByteLimit),
      shopPhotoLimit: num("MEDIA_SHOP_PHOTO_LIMIT", DEFAULT_MEDIA_POLICY.shopPhotoLimit),
      shopByteLimit: num("MEDIA_SHOP_BYTE_LIMIT", DEFAULT_MEDIA_POLICY.shopByteLimit),
    }),
    // Throws when unset or too short. Fail-closed and unconditional, for the
    // same reason `assertGatewayConfigOrThrow` and `assertMediaPolicyOrThrow`
    // are: a check that only bites in production is a check no developer ever
    // sees fail.
    pinPepper: requirePinPepper(),
    publicOrigins: publicOrigins(),
    spendCeilings: assertSpendCeilingsOrThrow(
      {
        shop: num(SPEND_CEILING_ENV.shop, PROVISIONAL_SHOP_METERED_BUDGET),
        longbox: num(SPEND_CEILING_ENV.longbox, PROVISIONAL_SERVICE_ACCOUNT_METERED_BUDGET),
      },
      DEFAULT_SPEND_CEILINGS
    ),
  };
}

/** The PROVISIONAL pair, as one object the checker and the limiter both read. */
export const DEFAULT_SPEND_CEILINGS: SpendCeilings = {
  shop: PROVISIONAL_SHOP_METERED_BUDGET,
  longbox: PROVISIONAL_SERVICE_ACCOUNT_METERED_BUDGET,
};

/** The ceilings in force for a deployment: the configured pair, or the safe default. */
export function spendCeilings(config: Pick<AppConfig, "spendCeilings">): SpendCeilings {
  return config.spendCeilings ?? DEFAULT_SPEND_CEILINGS;
}

// ---------------------------------------------------------------------------
// The registered-provider host allowlist, and the gateway's boot-time scope check
// (E03-D01, bead longbox-e5b.3.11; 046 §5 A15, §7.3, §11 I4/I5)
// ---------------------------------------------------------------------------

/**
 * Every host a provider credential may point at.
 *
 * WHY THE CONSTANT LIVES HERE AND NOT IN `src/providers/`. The bead asks for an
 * allowlist constant under `src/providers`, and `src/providers/credentialPolicy.ts`
 * re-exports it for provider-side callers — but the CANONICAL copy has to sit in
 * `src/config.ts`, because the architecture gate's `providers-are-contained` rule
 * (029 §4, `.dependency-cruiser.cjs`) forbids `src/config.ts` and `src/server.ts`
 * from importing `src/providers/**` at all, and the boot check below is exactly
 * a config concern reaching for this list. Providers importing config is
 * permitted and acyclic; the reverse edge is an architecture-gate failure. So
 * the direction of the dependency is chosen by a ratified boundary rather than
 * by where the name reads most naturally.
 *
 * The same four hosts are duplicated in
 * `migrations/014_credential_namespace_and_host_allowlist.sql`'s CHECK, and
 * `tests/contract/credential-namespace.test.ts` asserts the two agree — a
 * database rule and an application rule that can disagree silently are two
 * rules, not one.
 */
export const REGISTERED_PROVIDER_HOSTS: readonly string[] = [
  "api.anthropic.com",
  "api.openai.com",
  "api.ebay.com",
  "api.sandbox.ebay.com",
];

/** The env var that widens the GATEWAY allowlist (never the per-shop one). */
export const GATEWAY_HOST_ALLOWLIST_ENV = "LONGBOX_GATEWAY_HOST_ALLOWLIST";

/**
 * Hosts the `LLM_BASE_URL` gateway override may name.
 *
 * A self-hosted gateway is a legitimate deployment (locked decision 2), so the
 * list is widened by an OPERATOR-set variable — `LONGBOX_GATEWAY_HOST_ALLOWLIST`,
 * comma-separated hosts — rather than by disabling the check. The widening is an
 * explicit act recorded in the deployment's environment, which is the property
 * the silent per-shop fallback never had.
 */
export function gatewayHostAllowlist(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const extra = (env[GATEWAY_HOST_ALLOWLIST_ENV] ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
  return [...REGISTERED_PROVIDER_HOSTS, ...extra];
}

/** The host of a URL, lowercased; `undefined` when the string is not a URL. */
export function hostOf(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Thrown at boot when the gateway override is half-configured or out of scope. */
export class GatewayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayConfigError";
  }
}

/**
 * **The gateway override is validated at boot, or the server does not serve.**
 * (046 §11 I5, and the Kleppmann amendment on this bead: *a presence check is
 * not a scope check*.)
 *
 * `LLM_BASE_URL` + `LLM_API_KEY` outrank every per-shop credential — 046 §7.3
 * calls the pair "a single environment pair that redirects every shop's vision
 * traffic". Two failures are refused here rather than tolerated at request time:
 *
 * 1. **A half-configured pair.** Today one half without the other is silently
 *    ignored and the process quietly resolves per-shop credentials instead —
 *    which is an operator believing traffic goes to their gateway while it does
 *    not, the worst of both readings.
 * 2. **A host outside the allowlist.** This is the scope half. A typo'd or
 *    hostile `LLM_BASE_URL` is every shop's key sent to that host on the next
 *    identify call, and no per-row constraint can see it because the gateway is
 *    not a row.
 *
 * Unconditional, not `NODE_ENV`-gated: 046 §11 I5 states the assertion for
 * production, and a check that only bites in production is a check no developer
 * ever sees fail. Refusing everywhere keeps the deployment and the laptop honest
 * about the same rule.
 */
export function assertGatewayConfigOrThrow(env: NodeJS.ProcessEnv = process.env): void {
  const base = env.LLM_BASE_URL ?? "";
  const key = env.LLM_API_KEY ?? "";
  if (base === "" && key === "") return;
  if (base === "" || key === "") {
    throw new GatewayConfigError(
      "the LLM gateway override is half-configured: LLM_BASE_URL and LLM_API_KEY are set together " +
        `or not at all (LLM_BASE_URL is ${base === "" ? "unset" : "set"}, LLM_API_KEY is ` +
        `${key === "" ? "unset" : "set"}). Set both, or neither.`
    );
  }
  const host = hostOf(base);
  if (host === undefined) {
    throw new GatewayConfigError(`LLM_BASE_URL is not a URL (host could not be parsed)`);
  }
  const allowed = gatewayHostAllowlist(env);
  if (!allowed.includes(host)) {
    throw new GatewayConfigError(
      `LLM_BASE_URL points at ${host}, which is not a registered provider host ` +
        `[${allowed.join(", ")}]. The gateway override outranks every per-shop credential, so an ` +
        `unrecognised host would redirect every shop's vision traffic. Add the host to ` +
        `${GATEWAY_HOST_ALLOWLIST_ENV} if it is your own gateway.`
    );
  }
}

// Pinned per-MTok USD price table for cost estimation (R13). Tunable in code,
// deliberately not env-driven: a price change is a reviewed commit.
export const PRICE_TABLE_PER_MTOK: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 3, out: 15 },
  "gpt-4o": { in: 2.5, out: 10 },
};

export function estimateUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICE_TABLE_PER_MTOK[model];
  if (!p) return 0;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}
