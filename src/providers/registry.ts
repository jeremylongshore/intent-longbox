// Per-shop provider resolution (the BYOK seam).
//
// Order of precedence for the vision provider:
//   1. Global gateway override: LLM_BASE_URL + LLM_API_KEY (+ LLM_MODEL) — WINS,
//      and is scope-checked at BOOT against the registered-host allowlist
//      (`assertGatewayConfigOrThrow`, 046 §11 I5).
//   2. Shop credential row (`shop_credentials.key_ref` names an env var INSIDE
//      that shop's namespace — `resolveKeyRef` refuses anything else).
//   3. Global env default (ANTHROPIC_API_KEY / OPENAI_API_KEY) — **only for a
//      shop that has NO credential row at all.**
//
// E03-D01 (bead longbox-e5b.3.11) REMOVED THE SILENT GLOBAL FALLBACK FOR A SHOP
// THAT HAS A ROW. Before this change, a shop whose `key_ref` named an unset or
// out-of-namespace variable quietly resolved to the estate's global key instead:
// the shop believed it was on its own credential, the cost landed on somebody
// else's, and a misconfiguration that should have been an error was a working
// system. That is the shape 046 §5 A7 describes — key-ref confusion between
// shops — with the confusion resolved in the most flattering direction possible,
// which is why it never showed up as a failure. A shop that has declared a
// credential now resolves it or fails loudly; the global vars remain the
// single-tenant default for a shop that has declared none, which is a different
// statement and an explicit one.
//
// Raw keys are never stored in the database and never logged.
import type pg from "pg";
import type { ProviderConfig, VisionProvider } from "./types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAICompatProvider } from "./openaiCompat.js";
import { isRegisteredProviderUrl, resolveKeyRef } from "./credentialPolicy.js";

export interface CredentialRow {
  kind: "anthropic" | "openai_compat" | "shopify" | "pricecharting" | "ebay";
  key_ref: string;
  base_url: string | null;
}

/**
 * Thrown when a shop's declared credential cannot be honoured.
 *
 * A typed refusal rather than `undefined`, because `undefined` is how this seam
 * says "not configured" and the two must not be the same answer: "you declared a
 * credential and it is wrong" is an operator's error to fix, while "you declared
 * none" is a supported deployment.
 */
export class CredentialRefusedError extends Error {
  readonly code = "CREDENTIAL_REFUSED";
  constructor(message: string) {
    super(message);
    this.name = "CredentialRefusedError";
  }
}

/**
 * The shop's slug — the namespace every one of its key_refs must carry.
 *
 * Read from the row rather than passed down from the caller on purpose: the
 * caller holds a `shopId` from a URL path (046 §4 B1's unauthenticated segment),
 * and a namespace derived from a caller-supplied string would be a namespace the
 * caller chooses.
 */
export async function loadShopSlug(db: pg.Pool, shopId: string): Promise<string | undefined> {
  const res = await db.query(`SELECT slug FROM shop WHERE id = $1`, [shopId]);
  return (res.rows[0] as { slug: string } | undefined)?.slug;
}

/** The shop's slug, or a refusal: a credential row without a shop has no namespace. */
async function requireShopSlug(db: pg.Pool, shopId: string): Promise<string> {
  const slug = await loadShopSlug(db, shopId);
  if (slug === undefined) {
    throw new CredentialRefusedError(
      `shop ${shopId} has a credential row but no shop row — its key_ref namespace cannot be derived`
    );
  }
  return slug;
}

/**
 * Resolve one credential row's key_ref within its shop, refusing loudly.
 *
 * `undefined` means "declared but unset" — the stub-degradation path every
 * external client already has. A namespace or shape violation THROWS, because it
 * is not a missing value, it is a row pointing somewhere it may not point.
 */
function resolveRowKey(cred: CredentialRow, slug: string, suffix = ""): string | undefined {
  const resolution = resolveKeyRef(`${cred.key_ref}${suffix}`, slug);
  if (resolution.ok) return resolution.value;
  if (resolution.reason === "unset") return undefined;
  throw new CredentialRefusedError(
    `shop '${slug}' has a ${cred.kind} credential naming '${cred.key_ref}${suffix}', which is ` +
      `${resolution.reason === "malformed" ? "not a LONGBOX_<SLUG>_<PROVIDER>_KEY name" : "outside this shop's namespace"}. ` +
      `Re-register the shop's credentials; the global environment is not a substitute for a shop's key.`
  );
}

/** A row's `base_url`, refused unless it names a registered provider host. */
function checkedBaseUrl(cred: CredentialRow, slug: string): string | undefined {
  if (cred.base_url === null || cred.base_url === "") return undefined;
  if (!isRegisteredProviderUrl(cred.base_url)) {
    throw new CredentialRefusedError(
      `shop '${slug}' has a ${cred.kind} credential whose base_url is not a registered provider host. ` +
        `A credential row may not choose where a key is sent.`
    );
  }
  return cred.base_url;
}

export async function loadShopCredential(
  db: pg.Pool,
  shopId: string,
  kind: CredentialRow["kind"]
): Promise<CredentialRow | undefined> {
  const res = await db.query(
    `SELECT kind, key_ref, base_url FROM shop_credentials
     WHERE shop_id = $1 AND kind = $2
     ORDER BY created_at DESC LIMIT 1`,
    [shopId, kind]
  );
  return res.rows[0] as CredentialRow | undefined;
}

function envOr(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export async function resolveVisionProvider(db: pg.Pool, shopId: string): Promise<VisionProvider> {
  // 1. Gateway override wins outright.
  const gwBase = envOr("LLM_BASE_URL");
  const gwKey = envOr("LLM_API_KEY");
  if (gwBase && gwKey) {
    const cfg: ProviderConfig = {
      apiKey: gwKey,
      model: envOr("LLM_MODEL") ?? envOr("ANTHROPIC_MODEL") ?? "claude-sonnet-5",
      baseUrl: gwBase,
    };
    // Gateways speak the OpenAI-compatible dialect by convention.
    return createOpenAICompatProvider(cfg);
  }

  // 2. Per-shop credential rows: anthropic preferred (default provider), then
  //    openai_compat. A row that is DECLARED and does not resolve is the end of
  //    the road for this shop — falling through to the global key would be the
  //    substitution E03-D01 removed.
  const anth = await loadShopCredential(db, shopId, "anthropic");
  const oai = await loadShopCredential(db, shopId, "openai_compat");
  if (anth || oai) {
    const slug = await requireShopSlug(db, shopId);
    if (anth) {
      const key = resolveRowKey(anth, slug);
      if (key !== undefined) {
        const cfg: ProviderConfig = { apiKey: key, model: envOr("ANTHROPIC_MODEL") ?? "claude-sonnet-5" };
        const base = checkedBaseUrl(anth, slug);
        if (base) cfg.baseUrl = base;
        return createAnthropicProvider(cfg);
      }
    }
    if (oai) {
      const key = resolveRowKey(oai, slug);
      if (key !== undefined) {
        const cfg: ProviderConfig = { apiKey: key, model: envOr("OPENAI_MODEL") ?? "gpt-4o" };
        const base = checkedBaseUrl(oai, slug);
        if (base) cfg.baseUrl = base;
        return createOpenAICompatProvider(cfg);
      }
    }
    throw new CredentialRefusedError(
      `shop '${slug}' declares a vision credential whose environment variable is unset ` +
        `(${[anth?.key_ref, oai?.key_ref].filter(Boolean).join(", ")}). Set it, or remove the row — ` +
        `the global ANTHROPIC_API_KEY/OPENAI_API_KEY is not a substitute for a shop's own key.`
    );
  }

  // 3. Global env default — Claude is the reference provider. Reached only by a
  //    shop that declares NO credential row at all (the single-tenant dev and
  //    pilot-bootstrap shape), never as a rescue for one that does.
  const anthKey = envOr("ANTHROPIC_API_KEY");
  if (anthKey) {
    return createAnthropicProvider({ apiKey: anthKey, model: envOr("ANTHROPIC_MODEL") ?? "claude-sonnet-5" });
  }
  const oaiKey = envOr("OPENAI_API_KEY");
  if (oaiKey) {
    const cfg: ProviderConfig = { apiKey: oaiKey, model: envOr("OPENAI_MODEL") ?? "gpt-4o" };
    const base = envOr("OPENAI_BASE_URL");
    if (base) cfg.baseUrl = base;
    return createOpenAICompatProvider(cfg);
  }

  throw new Error(
    "no vision provider configured for shop (no gateway override, no shop credential, no global ANTHROPIC_API_KEY/OPENAI_API_KEY)"
  );
}

/**
 * Resolve eBay app credentials per shop (kind 'ebay').
 *
 * Convention: the credential row's key_ref names the env var holding the CLIENT
 * ID; the client secret lives at `${key_ref}_SECRET` — which stays inside the
 * shop's namespace by construction, so the pair needs no second rule. A shop
 * that declares the row and has not set the pair gets `undefined` (the eBay
 * client stubs, as it always has); a shop whose row names a variable outside its
 * namespace gets a `CredentialRefusedError`. The global `EBAY_CLIENT_ID` pair is
 * the default for a shop with NO row, never a fallback for one with a row.
 */
export async function resolveEbayCredentials(
  db: pg.Pool,
  shopId: string
): Promise<{ clientId: string; clientSecret: string; baseUrl?: string } | undefined> {
  const cred = await loadShopCredential(db, shopId, "ebay");
  if (cred) {
    const slug = await requireShopSlug(db, shopId);
    const clientId = resolveRowKey(cred, slug);
    const clientSecret = resolveRowKey(cred, slug, "_SECRET");
    const baseUrl = checkedBaseUrl(cred, slug);
    if (clientId !== undefined && clientSecret !== undefined) {
      return { clientId, clientSecret, ...(baseUrl ? { baseUrl } : {}) };
    }
    return undefined;
  }
  const clientId = envOr("EBAY_CLIENT_ID");
  const clientSecret = envOr("EBAY_CLIENT_SECRET");
  if (clientId && clientSecret) {
    const baseUrl = envOr("EBAY_BASE_URL");
    return { clientId, clientSecret, ...(baseUrl ? { baseUrl } : {}) };
  }
  return undefined;
}

/**
 * Resolve a plain per-shop token (shopify / pricecharting).
 *
 * Same rule as the two above: a declared row resolves within its own namespace
 * or the caller gets `undefined` (and stubs) — the global env var is the default
 * for a shop that declares nothing, not a rescue for a shop whose row is unset.
 */
export async function resolveShopToken(
  db: pg.Pool,
  shopId: string,
  kind: "shopify" | "pricecharting",
  globalEnvName: string
): Promise<string | undefined> {
  const cred = await loadShopCredential(db, shopId, kind);
  if (cred) {
    const slug = await requireShopSlug(db, shopId);
    return resolveRowKey(cred, slug);
  }
  return envOr(globalEnvName);
}
