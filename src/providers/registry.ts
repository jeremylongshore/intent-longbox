// Per-shop provider resolution (the BYOK seam).
//
// Order of precedence for the vision provider:
//   1. Global gateway override: LLM_BASE_URL + LLM_API_KEY (+ LLM_MODEL) — WINS,
//      and is scope-checked at BOOT against the registered-host allowlist
//      (`assertGatewayConfigOrThrow`, 046 §11 I5). Spend owner: `longbox`.
//   2. The shop's newest LIVE credential version (`shop_credential_version`
//      minus `shop_credential_retirement`), whose `key_ref` names an env var
//      INSIDE that shop's namespace — `resolveKeyRef` refuses anything else.
//      Spend owner: `shop`.
//   3. Global env default (ANTHROPIC_API_KEY / OPENAI_API_KEY) — **only for a
//      shop that has declared NOTHING at all.** Spend owner: `longbox`.
//
// E03-D01 (bead longbox-e5b.3.11) REMOVED THE SILENT GLOBAL FALLBACK FOR A SHOP
// THAT HAS A ROW. Before that change, a shop whose `key_ref` named an unset or
// out-of-namespace variable quietly resolved to the estate's global key instead:
// the shop believed it was on its own credential, the cost landed on somebody
// else's, and a misconfiguration that should have been an error was a working
// system. That is the shape 046 §5 A7 describes — key-ref confusion between
// shops — with the confusion resolved in the most flattering direction possible,
// which is why it never showed up as a failure.
//
// E03-B05 (bead longbox-e5b.3.5, 050 §4) EXTENDS THAT RULE FROM "HAS A ROW" TO
// "HAS A LIVE VERSION", and the extension is the half that makes a deletion
// real. **A shop with any credential version and zero live ones is REFUSED, and
// never falls through to the global environment.** Without it, retiring the last
// version would silently move the shop onto the estate's key — a "deletion" that
// makes the system spend somebody else's money instead of stopping.
//
// AND EVERY RESOLUTION NOW REPORTS WHO PAYS (050 §6). `resolveVisionProvider`
// returns the credential VERSION id alongside the provider; `appendCostLog`
// derives `spend_owner` from it and accepts no caller-supplied owner. `cost_log`
// gains a credential dimension and never an operator one (050 §6.6, 019 T35).
//
// Raw keys are never stored in the database and never logged.
import type { ProviderConfig, VisionProvider } from "./types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAICompatProvider } from "./openaiCompat.js";
import { isRegisteredProviderUrl, reportCredentialRefusal, resolveKeyRef } from "./credentialPolicy.js";
import { resolveCredentialVersion, type CredentialKind } from "./credentialVersions.js";
import type { Queryable } from "../db.js";

export interface CredentialRow {
  kind: CredentialKind;
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
export async function loadShopSlug(db: Queryable, shopId: string): Promise<string | undefined> {
  const res = await db.query(`SELECT slug FROM shop WHERE id = $1`, [shopId]);
  return (res.rows[0] as { slug: string } | undefined)?.slug;
}

/** The shop's slug, or a refusal: a credential row without a shop has no namespace. */
async function requireShopSlug(db: Queryable, shopId: string): Promise<string> {
  const slug = await loadShopSlug(db, shopId);
  if (slug === undefined) {
    throw new CredentialRefusedError(
      `shop ${shopId} has a credential row but no shop row — its key_ref namespace cannot be derived`
    );
  }
  return slug;
}

/** A slug fetched at most once per resolution, so a two-kind lookup is one query. */
function slugOnce(db: Queryable, shopId: string): () => Promise<string> {
  let pending: Promise<string> | undefined;
  return () => (pending ??= requireShopSlug(db, shopId));
}

/**
 * Resolve one credential's key_ref within its shop, refusing loudly.
 *
 * `undefined` means "declared but unset" — the stub-degradation path every
 * external client already has. A namespace or shape violation THROWS, because it
 * is not a missing value, it is a name pointing somewhere it may not point.
 */
function resolveNamedKey(keyRef: string, kind: string, slug: string, suffix = ""): string | undefined {
  const resolution = resolveKeyRef(`${keyRef}${suffix}`, slug);
  if (resolution.ok) return resolution.value;
  if (resolution.reason === "unset") return undefined;
  throw new CredentialRefusedError(
    `shop '${slug}' has a ${kind} credential naming '${keyRef}${suffix}', which is ` +
      `${resolution.reason === "malformed" ? "not a LONGBOX_<SLUG>_<PROVIDER>_KEY name" : "outside this shop's namespace"}. ` +
      `Re-register the shop's credentials; the global environment is not a substitute for a shop's key.`
  );
}

/** A `base_url`, refused unless it names a registered provider host. */
function checkedBaseUrl(baseUrl: string | null, kind: string, slug: string): string | undefined {
  if (baseUrl === null || baseUrl === "") return undefined;
  if (!isRegisteredProviderUrl(baseUrl)) {
    throw new CredentialRefusedError(
      `shop '${slug}' has a ${kind} credential whose base_url is not a registered provider host. ` +
        `A credential row may not choose where a key is sent.`
    );
  }
  return baseUrl;
}

/**
 * The `shop_credentials` row for a `(shop, kind)`.
 *
 * ⚠ DEPRECATED AS THE AUTHORITY FOR `key_ref` AND LIVENESS (050 §4, migration
 * `021`'s table comment). It is still read for ONE column — `base_url` — because
 * `shop_credential_version` has no host column and 050 §10 lists no migration
 * that would give it one; deciding where the host lives after the table's
 * contract step is left to whoever writes that step. It is also still read as a
 * DECLARATION for the fail-closed guard in `declaredCredential` below.
 */
export async function loadShopCredential(
  db: Queryable,
  shopId: string,
  kind: CredentialKind
): Promise<CredentialRow | undefined> {
  const res = await db.query(
    `SELECT kind, key_ref, base_url FROM shop_credentials
     WHERE shop_id = $1 AND kind = $2
     ORDER BY created_at DESC LIMIT 1`,
    [shopId, kind]
  );
  return res.rows[0] as CredentialRow | undefined;
}

/** One shop's live declaration of a credential kind: a NAME, a version and a host. */
export interface DeclaredCredential {
  readonly kind: CredentialKind;
  /** An environment variable NAME. Never a value. */
  readonly keyRef: string;
  readonly credentialVersionId: string;
  readonly baseUrl: string | null;
}

/**
 * What a shop has declared for one kind, or `undefined` when it has declared
 * nothing — with every not-live case a REFUSAL rather than a fall-through.
 *
 * The three outcomes 050 §4 rules on, plus one this code half had to decide:
 *
 *   * a live version → it is returned, newest `version_no` first;
 *   * versions exist and all are retired → `CredentialRefusedError`;
 *   * no versions at all, and no legacy `shop_credentials` row → `undefined`,
 *     which is the service-account path (050 §2 Q4(b));
 *   * **no versions but a legacy `shop_credentials` row does exist** →
 *     `CredentialRefusedError`. 050 does not rule on this case, because
 *     migration `021` backfills a version 1 row for every existing config row so
 *     it should not arise. It is refused rather than treated as "declares
 *     nothing" because the alternative silently REGRESSES 050 §1 E4: a shop that
 *     has declared a credential would start borrowing the estate's key again,
 *     which is the exact substitution E03-D01 removed. Fail closed.
 */
async function declaredCredential(
  db: Queryable,
  shopId: string,
  kind: CredentialKind,
  slug: () => Promise<string>
): Promise<DeclaredCredential | undefined> {
  const outcome = await resolveCredentialVersion(db, shopId, kind);
  const legacy = await loadShopCredential(db, shopId, kind);

  if (outcome.outcome === "live") {
    return {
      kind,
      keyRef: outcome.chosen.keyRef,
      credentialVersionId: outcome.chosen.id,
      baseUrl: legacy?.base_url ?? null,
    };
  }
  if (outcome.outcome === "all_retired") {
    const newest = outcome.retired[0];
    // The same structured event every other refusal emits (050 §9 I11). It
    // carries the shop, the NAME and the reason, and nothing else — a refusal is
    // interesting because it says whose configuration is wrong, which is the
    // fact an operator needs and the one a value-scan structurally cannot give.
    if (newest !== undefined) reportCredentialRefusal("retired", await slug(), newest.keyRef);
    throw new CredentialRefusedError(
      `shop '${await slug()}' has ${outcome.retired.length} ${kind} credential version(s) and every ` +
        `one of them is retired (newest: version ${newest?.versionNo}). Introduce a new version — ` +
        `a retired credential is never replaced by the global environment, because that would spend ` +
        `Longbox's key on a shop that believes it revoked its own.`
    );
  }
  if (legacy !== undefined) {
    throw new CredentialRefusedError(
      `shop '${await slug()}' has a ${kind} row in the deprecated shop_credentials table and NO ` +
        `shop_credential_version row. Migration 021 backfills one for every existing row, so this ` +
        `is a row written outside the supported path. Introduce a credential version; the global ` +
        `environment is not a substitute for a shop's own key.`
    );
  }
  return undefined;
}

function envOr(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

/** True when the operator's gateway override is configured (it outranks everything). */
function gatewayOverride(): { baseUrl: string; apiKey: string } | undefined {
  const baseUrl = envOr("LLM_BASE_URL");
  const apiKey = envOr("LLM_API_KEY");
  return baseUrl && apiKey ? { baseUrl, apiKey } : undefined;
}

/**
 * A vision provider and the credential VERSION that will pay for its calls.
 *
 * `credentialVersionId` is `null` when Longbox's own account pays — the gateway
 * override or the global environment. It is the ONLY thing `appendCostLog`
 * needs in order to derive `spend_owner`, and it is a reference rather than a
 * declaration for exactly that reason (050 §6.2).
 */
export interface ResolvedVisionProvider {
  readonly provider: VisionProvider;
  readonly credentialVersionId: string | null;
}

export async function resolveVisionProvider(db: Queryable, shopId: string): Promise<ResolvedVisionProvider> {
  // 1. Gateway override wins outright — and it is Longbox's spend, always. A
  //    shop cannot set it (it is an operator environment pair, never a row), so
  //    a shop cannot own the spend it produces (050 §6.3).
  const gw = gatewayOverride();
  if (gw) {
    const cfg: ProviderConfig = {
      apiKey: gw.apiKey,
      model: envOr("LLM_MODEL") ?? envOr("ANTHROPIC_MODEL") ?? "claude-sonnet-5",
      baseUrl: gw.baseUrl,
    };
    // Gateways speak the OpenAI-compatible dialect by convention.
    return { provider: createOpenAICompatProvider(cfg), credentialVersionId: null };
  }

  // 2. The shop's live credential versions: anthropic preferred (default
  //    provider), then openai_compat. A DECLARED credential that does not
  //    resolve is the end of the road for this shop — falling through to the
  //    global key would be the substitution E03-D01 removed and 050 §4 extends.
  const slug = slugOnce(db, shopId);
  const anth = await declaredCredential(db, shopId, "anthropic", slug);
  const oai = await declaredCredential(db, shopId, "openai_compat", slug);
  if (anth || oai) {
    const shopSlug = await slug();
    if (anth) {
      const key = resolveNamedKey(anth.keyRef, anth.kind, shopSlug);
      if (key !== undefined) {
        const cfg: ProviderConfig = { apiKey: key, model: envOr("ANTHROPIC_MODEL") ?? "claude-sonnet-5" };
        const base = checkedBaseUrl(anth.baseUrl, anth.kind, shopSlug);
        if (base) cfg.baseUrl = base;
        return { provider: createAnthropicProvider(cfg), credentialVersionId: anth.credentialVersionId };
      }
    }
    if (oai) {
      const key = resolveNamedKey(oai.keyRef, oai.kind, shopSlug);
      if (key !== undefined) {
        const cfg: ProviderConfig = { apiKey: key, model: envOr("OPENAI_MODEL") ?? "gpt-4o" };
        const base = checkedBaseUrl(oai.baseUrl, oai.kind, shopSlug);
        if (base) cfg.baseUrl = base;
        return { provider: createOpenAICompatProvider(cfg), credentialVersionId: oai.credentialVersionId };
      }
    }
    throw new CredentialRefusedError(
      `shop '${shopSlug}' declares a vision credential whose environment variable is unset ` +
        `(${[anth?.keyRef, oai?.keyRef].filter(Boolean).join(", ")}). Set it, or retire the ` +
        `credential version — the global ANTHROPIC_API_KEY/OPENAI_API_KEY is not a substitute for ` +
        `a shop's own key.`
    );
  }

  // 3. Global env default — Claude is the reference provider. Reached only by a
  //    shop that declares NOTHING at all (the single-tenant dev and
  //    pilot-bootstrap shape), never as a rescue for one that does. The spend is
  //    Longbox's and, from 023, the `cost_log` row SAYS SO (050 §1 E12 → §6).
  const anthKey = envOr("ANTHROPIC_API_KEY");
  if (anthKey) {
    return {
      provider: createAnthropicProvider({
        apiKey: anthKey,
        model: envOr("ANTHROPIC_MODEL") ?? "claude-sonnet-5",
      }),
      credentialVersionId: null,
    };
  }
  const oaiKey = envOr("OPENAI_API_KEY");
  if (oaiKey) {
    const cfg: ProviderConfig = { apiKey: oaiKey, model: envOr("OPENAI_MODEL") ?? "gpt-4o" };
    const base = envOr("OPENAI_BASE_URL");
    if (base) cfg.baseUrl = base;
    return { provider: createOpenAICompatProvider(cfg), credentialVersionId: null };
  }

  throw new Error(
    "no vision provider configured for shop (no gateway override, no live shop credential version, " +
      "no global ANTHROPIC_API_KEY/OPENAI_API_KEY)"
  );
}

/**
 * Whose money a paid call for this shop would be, WITHOUT resolving a provider
 * and WITHOUT refusing anything.
 *
 * ⚠ WHY THIS EXISTS AS A SEPARATE, NON-THROWING FUNCTION. 042 §8.4's ceiling is
 * per owner (050 §2 Q4(c)), and `src/services/sessionApi.ts` takes the metered
 * budget BEFORE it resolves a provider — deliberately, because a shop that has
 * spent its budget needs no credential and resolving one first would answer 503
 * to a call that was never going to reach a provider. Determining the OWNER is a
 * predicate; resolving the PROVIDER is the path that refuses. Keeping them apart
 * is what stops a shop at its ceiling with a broken credential getting a 503
 * where 050 §2 Q4(d) requires the manual path.
 *
 * A shop whose only declaration is broken counts as `shop`: it is not going to
 * spend Longbox's money, so charging its attempt against Longbox's lower floor
 * would be the wrong bucket.
 */
export async function spendOwnerFor(db: Queryable, shopId: string): Promise<"shop" | "longbox"> {
  if (gatewayOverride()) return "longbox";
  for (const kind of ["anthropic", "openai_compat"] as const) {
    const versions = await resolveCredentialVersion(db, shopId, kind);
    if (versions.outcome !== "no_versions") return "shop";
    if ((await loadShopCredential(db, shopId, kind)) !== undefined) return "shop";
  }
  return "longbox";
}

/**
 * Resolve eBay app credentials per shop (kind 'ebay').
 *
 * Convention: the live credential version's key_ref names the env var holding
 * the CLIENT ID; the client secret lives at `${key_ref}_SECRET` — a name that is
 * itself a NAMED MEMBER of the closed suffix set (`credentialPolicy.ts`), so the
 * derived name passes the same exact-equality test as the name it was appended
 * to. A shop that declares the credential and has not set the pair gets
 * `undefined` (the eBay client stubs, as it always has); a shop whose version
 * names a variable outside its namespace, or whose versions are all retired,
 * gets a `CredentialRefusedError`. The global `EBAY_CLIENT_ID` pair is the
 * default for a shop that declares NOTHING, never a fallback for one that does.
 */
export async function resolveEbayCredentials(
  db: Queryable,
  shopId: string
): Promise<{ clientId: string; clientSecret: string; baseUrl?: string } | undefined> {
  const slug = slugOnce(db, shopId);
  const declared = await declaredCredential(db, shopId, "ebay", slug);
  if (declared) {
    const shopSlug = await slug();
    const clientId = resolveNamedKey(declared.keyRef, "ebay", shopSlug);
    const clientSecret = resolveNamedKey(declared.keyRef, "ebay", shopSlug, "_SECRET");
    const baseUrl = checkedBaseUrl(declared.baseUrl, "ebay", shopSlug);
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
 * Same rule as the two above: a live declared version resolves within its own
 * namespace or the caller gets `undefined` (and stubs) — the global env var is
 * the default for a shop that declares nothing, not a rescue for a shop whose
 * declaration is unset, and not a rescue for one whose versions are retired.
 */
export async function resolveShopToken(
  db: Queryable,
  shopId: string,
  kind: "shopify" | "pricecharting",
  globalEnvName: string
): Promise<string | undefined> {
  const slug = slugOnce(db, shopId);
  const declared = await declaredCredential(db, shopId, kind, slug);
  if (declared) return resolveNamedKey(declared.keyRef, kind, await slug());
  return envOr(globalEnvName);
}
