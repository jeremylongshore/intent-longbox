// Central env-derived config. Secrets stay in process.env; this module never
// logs or re-exports raw key values beyond handing them to transport code.
import "dotenv/config";

export interface BandThresholds {
  high: number;
  medium: number;
}

export interface AppConfig {
  port: number;
  databaseUrl: string;
  uploadsDir: string;
  bands: BandThresholds;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`env ${name} is not a number`);
  return n;
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
  };
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
