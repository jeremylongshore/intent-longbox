// Per-shop provider resolution (the BYOK seam).
// Order of precedence for the vision provider:
//   1. Global gateway override: LLM_BASE_URL + LLM_API_KEY (+ LLM_MODEL) — WINS.
//   2. Shop credential row (shop_credentials.key_ref names an env var).
//   3. Global env fallback (ANTHROPIC_API_KEY / OPENAI_API_KEY).
// Raw keys are never stored in the database and never logged.
import type pg from "pg";
import type { ProviderConfig, VisionProvider } from "./types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAICompatProvider } from "./openaiCompat.js";

export interface CredentialRow {
  kind: "anthropic" | "openai_compat" | "shopify" | "pricecharting" | "ebay";
  key_ref: string;
  base_url: string | null;
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

/** Resolve a key_ref (env var NAME) to its value; undefined when unset/empty. */
export function resolveKeyRef(keyRef: string): string | undefined {
  const v = process.env[keyRef];
  return v && v.length > 0 ? v : undefined;
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

  // 2. Per-shop credential rows: anthropic preferred (default provider), then openai_compat.
  const anth = await loadShopCredential(db, shopId, "anthropic");
  if (anth) {
    const key = resolveKeyRef(anth.key_ref);
    if (key) {
      const cfg: ProviderConfig = { apiKey: key, model: envOr("ANTHROPIC_MODEL") ?? "claude-sonnet-5" };
      if (anth.base_url) cfg.baseUrl = anth.base_url;
      return createAnthropicProvider(cfg);
    }
  }
  const oai = await loadShopCredential(db, shopId, "openai_compat");
  if (oai) {
    const key = resolveKeyRef(oai.key_ref);
    if (key) {
      const cfg: ProviderConfig = { apiKey: key, model: envOr("OPENAI_MODEL") ?? "gpt-4o" };
      if (oai.base_url) cfg.baseUrl = oai.base_url;
      return createOpenAICompatProvider(cfg);
    }
  }

  // 3. Global env fallback — Claude is the default and reference provider.
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
 * Resolve eBay app credentials per shop (kind 'ebay'), falling back to the
 * global env pair. Convention: the credential row's key_ref names the env var
 * holding the CLIENT ID; the client secret lives at `${key_ref}_SECRET`
 * (a key_ref is always a NAME, never a raw key — same rule as everywhere).
 */
export async function resolveEbayCredentials(
  db: pg.Pool,
  shopId: string
): Promise<{ clientId: string; clientSecret: string; baseUrl?: string } | undefined> {
  const cred = await loadShopCredential(db, shopId, "ebay");
  if (cred) {
    const clientId = resolveKeyRef(cred.key_ref);
    const clientSecret = resolveKeyRef(`${cred.key_ref}_SECRET`);
    if (clientId && clientSecret) {
      return { clientId, clientSecret, ...(cred.base_url ? { baseUrl: cred.base_url } : {}) };
    }
  }
  const clientId = envOr("EBAY_CLIENT_ID");
  const clientSecret = envOr("EBAY_CLIENT_SECRET");
  if (clientId && clientSecret) {
    const baseUrl = envOr("EBAY_BASE_URL");
    return { clientId, clientSecret, ...(baseUrl ? { baseUrl } : {}) };
  }
  return undefined;
}

/** Resolve a plain per-shop token (shopify / pricecharting), falling back to a global env var. */
export async function resolveShopToken(
  db: pg.Pool,
  shopId: string,
  kind: "shopify" | "pricecharting",
  globalEnvName: string
): Promise<string | undefined> {
  const cred = await loadShopCredential(db, shopId, kind);
  if (cred) {
    const v = resolveKeyRef(cred.key_ref);
    if (v) return v;
  }
  return envOr(globalEnvName);
}
