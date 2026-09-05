// The Shopify connector's POLICY: which scopes may be asked for, what a legal
// store domain is, and how a message from Shopify is authenticated.
//
// Bead: longbox-e5b.3.6 (alias E03-B06). Docs: 000-docs/053 §6 (the scope list,
// argued scope by scope), §8 (authenticity); 046 §5 A13 (a forged webhook),
// §6.2 G-14; 019 T19 (auto-publish = 0, NON-WAIVABLE) and T24; 042 §8.1;
// CLAUDE.md locked decision 3.
//
// EVERYTHING IN THIS FILE IS A PURE FUNCTION OF ITS INPUTS. No database handle,
// no clock, no environment — so every rule below is tested without a cluster and
// without a network, which is the same split `src/services/auth/policy.ts` makes
// and for the same reason.
import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// 053 §6 — the scopes, as a VERSIONED CONSTANT with an argument per member.
// ---------------------------------------------------------------------------

/**
 * The version of the scope list. **It is not the Shopify API version** — it is
 * this repository's count of how many times the authority it asks a merchant for
 * has changed.
 *
 * It exists because a scope change is a CONSENT change: a token minted under
 * list 1 was authorised against list 1, and a merchant who approved
 * `write_products` never approved anything else. `connector_token_version`
 * records `granted_scopes` per row, so a list bump is visible as a difference
 * between two live rows rather than as a silent widening — and the day the list
 * grows, every existing install is still bounded by what it actually granted.
 */
export const SHOPIFY_SCOPE_LIST_VERSION = 1;

/**
 * **The minimum authority the pipeline cannot run without.** Every member is
 * argued; the argument is the point, because "least scopes" asserted without one
 * is a sentence rather than a control.
 *
 * `write_products` — `productSet` is a product WRITE, and a DRAFT product is the
 *   single outward act this system performs (`src/services/shopify.ts`, 043
 *   §4.3). Without it there is no product. It is the only scope whose absence
 *   makes the system pointless rather than merely degraded.
 *
 * `read_products` — required by the FAIL-CLOSED GUARD, not by convenience. 043
 *   A3 makes `draftRequested` refuse a retry against an existing draft with ZERO
 *   `listing_status_observation` rows, because unknown means do not touch; those
 *   rows are populated by reading the product back from Shopify (E10-B05's
 *   watcher, 046 §3.3 B10). A connector with no read scope can therefore NEVER
 *   obtain the positive evidence the guard demands, so every retry dead-letters
 *   and the guard degrades from a safety property into an outage. Shopify's
 *   grant model treats `write_products` as subsuming the read (see
 *   `scopeSatisfies`), so asking for it explicitly widens nothing — it makes the
 *   dependency legible to the merchant on the consent screen and to the next
 *   reader of this file.
 */
export const SHOPIFY_REQUIRED_SCOPES = ["write_products", "read_products"] as const;

/**
 * The MOST this app will accept, which is the same set. A grant that exceeds it
 * is REFUSED (`scopeSatisfies`), and that refusal is a real control rather than
 * paranoia: a token carrying authority nobody argued for is a token whose blast
 * radius is undocumented, and the way that arrives is a merchant's app
 * configuration drifting rather than an attack. Widening it is a PR with an
 * argument, never a runtime accommodation.
 */
export const SHOPIFY_MAX_SCOPES = [...SHOPIFY_REQUIRED_SCOPES] as readonly string[];

/**
 * Scopes this connector must NEVER hold, each with the line it would breach.
 *
 * The list is not exhaustive of Shopify's catalogue and is not trying to be —
 * `SHOPIFY_MAX_SCOPES` is the closed set and this is the annotated subset a
 * reader would otherwise be tempted by. **The strongest entry is the publication
 * pair**, and it is worth reading twice: the ABSENCE of a scope is what enforces
 * a non-waivable threshold. 019 T19 signs auto-publish at ZERO and 033 B3 makes
 * publishing "a normal Shopify action, never the app's" — so an app that HELD
 * `write_publications` would be one call away from the one thing it is signed at
 * zero for, and no amount of hardcoding `status: "DRAFT"` is as strong as not
 * having the capability at all.
 */
export const SHOPIFY_FORBIDDEN_SCOPES: ReadonlyArray<{ scope: string; because: string }> = [
  {
    scope: "write_publications",
    because:
      "019 T19 (auto-publish = 0, NON-WAIVABLE) and 033 B3: publishing is the merchant's act in " +
      "their own admin. An app that could publish is an app whose compliance with T19 is a code " +
      "review rather than a capability boundary.",
  },
  {
    scope: "write_product_listings",
    because:
      "the same line as write_publications, spelled for the sales-channel surface. It is listed " +
      "separately rather than folded in, because a reader looking for 'the scope that would let " +
      "the app publish' will search for one of the two names and must find it either way.",
  },
  {
    scope: "read_orders",
    because:
      "Longbox never sees a sale. An order carries the buyer, and 019 T35 / 022 P3 forbid the " +
      "surface rather than the signal — the way personal data arrives is a scope nobody needed.",
  },
  {
    scope: "write_orders",
    because:
      "as read_orders, and worse: nothing in this system has any reason to CHANGE an order, so " +
      "the only thing this scope could ever add is the ability to damage a merchant's sales " +
      "record with a bug. A capability with no use case is a capability with only failure modes.",
  },
  {
    scope: "read_customers",
    because:
      "protected customer data. 041 §8.4's rule is that the append-only log holds references and " +
      "never personal values; the cheapest way to keep that true is never to be able to read one.",
  },
  {
    scope: "write_customers",
    because:
      "as read_customers, and it is the scope that would make the three mandatory privacy " +
      "webhooks something this app could act on directly — which it must not, because what a " +
      "person is entitled to and on what clock is E03-B09's and counsel's, not a code path's.",
  },
  {
    scope: "read_inventory",
    because:
      "a DRAFT product carries no inventory quantity (`buildProductSetInput`). 036 §2.1 makes " +
      "`physical_item` the inventory identity INSIDE Longbox, and it is not Shopify's copy.",
  },
  {
    scope: "write_inventory",
    because:
      "as read_inventory, and the sharper form: an app that could set inventory could take a " +
      "merchant's stock levels to zero through a defect in a pipeline whose only intended " +
      "outward act is creating a DRAFT nobody has published yet.",
  },
];

/**
 * Shopify's grant model treats a write scope as carrying its own read.
 *
 * Stated as a FUNCTION rather than as a comment because the callback's check
 * depends on it: if Shopify returns only `write_products` for a request that
 * asked for both, a naive set-equality check would refuse a perfectly good
 * install. The implication is applied in ONE direction only — a write implies
 * its read, never the reverse — so a grant of `read_products` alone still fails
 * to satisfy `write_products`, which is the case that matters.
 */
export function expandGrantedScopes(granted: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const scope of granted) {
    out.add(scope);
    if (scope.startsWith("write_")) out.add(`read_${scope.slice("write_".length)}`);
  }
  return out;
}

export type ScopeVerdict =
  | { readonly ok: true; readonly granted: readonly string[] }
  /** Something required is missing: the merchant approved less than the app needs. */
  | { readonly ok: false; readonly reason: "insufficient"; readonly missing: readonly string[] }
  /** Something unasked-for was granted: authority nobody argued for. */
  | { readonly ok: false; readonly reason: "excessive"; readonly surplus: readonly string[] };

/**
 * Is this grant exactly the authority this app asked for?
 *
 * TWO-SIDED, and the second side is the one a reviewer should look at. Refusing
 * an INSUFFICIENT grant is obvious. Refusing an EXCESSIVE one is the control:
 * it means the declared list in this file is the authority the running system
 * holds, checkable at install time, rather than a description of what somebody
 * intended to configure in a dashboard.
 */
export function scopeSatisfies(
  granted: readonly string[],
  required: readonly string[] = SHOPIFY_REQUIRED_SCOPES,
  maximum: readonly string[] = SHOPIFY_MAX_SCOPES
): ScopeVerdict {
  const effective = expandGrantedScopes(granted);
  const missing = required.filter((scope) => !effective.has(scope));
  if (missing.length > 0) return { ok: false, reason: "insufficient", missing };
  // The surplus test runs on the RAW grant, not the expanded one: expanding
  // adds reads this app did not ask for and would report them as surplus, which
  // would refuse every install Shopify grants correctly.
  const allowed = new Set(maximum);
  const surplus = granted.filter((scope) => !allowed.has(scope));
  if (surplus.length > 0) return { ok: false, reason: "excessive", surplus };
  return { ok: true, granted };
}

/** Shopify's `scope` parameter is comma-separated; empty members are dropped. */
export function parseScopeList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// 053 §8.1 — the store domain.
// ---------------------------------------------------------------------------

/**
 * Shopify's own shape for a store's myshopify domain, applied BEFORE the value
 * is used for anything.
 *
 * ⚠ THIS IS THE SSRF CONTROL AND IT IS NOT OPTIONAL. The `shop` parameter of an
 * OAuth callback is attacker-controlled, and the very next thing an install flow
 * does with it is build `https://<shop>/admin/oauth/access_token` and POST the
 * app's CLIENT SECRET to it. A `shop` of `evil.example` — or of
 * `attacker.example#.myshopify.com`, or of a value with a credential, a port or
 * a path in it — turns this server into a courier that delivers its own secret
 * to whoever asked. So the check is an ANCHORED whole-string match against a
 * conservative alphabet, and it runs before the domain reaches a URL, a query,
 * a column or a comparison.
 *
 * The alphabet is deliberately narrower than DNS: lowercase, digits and hyphens,
 * beginning with alphanumeric, with `.myshopify.com` as a literal suffix. A
 * store name Shopify permits and this refuses is a bug to fix with evidence; a
 * hostname this permits and Shopify does not is a hole.
 */
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]\.myshopify\.com$/;

export function isShopifyShopDomain(value: string): boolean {
  // The regex is anchored, but `.test` on a string containing a newline can
  // still be satisfied by a line of it under `m` — this pattern has no `m` flag,
  // and the explicit refusal below says so rather than relying on the reader
  // knowing that.
  if (value.includes("\n") || value.includes("\r")) return false;
  return SHOP_DOMAIN.test(value);
}

// ---------------------------------------------------------------------------
// 053 §8.2 — authenticity. Two shapes, one secret, both timing-safe.
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of two ASCII digests.
 *
 * Length is compared first and NOT in constant time, deliberately: the length of
 * an HMAC is public (it is fixed by the algorithm), and `timingSafeEqual` throws
 * on mismatched lengths, so the alternative is an exception where a refusal
 * belongs.
 */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify the HMAC Shopify puts on an OAuth callback's QUERY STRING.
 *
 * The construction, stated because every clause is load-bearing:
 *   * `hmac` is REMOVED from the message it signs (it cannot sign itself), and
 *     so is the legacy `signature` parameter;
 *   * the remaining parameters are sorted by key and joined `k=v&k=v` — the
 *     ordering is part of the signature, so a caller cannot reorder its way to a
 *     different message with the same digest;
 *   * the digest is hex, lowercase, and compared in constant time.
 *
 * **A parameter that appears more than once is a REFUSAL, not a choice.** Node's
 * `URLSearchParams` keeps duplicates and most code silently takes the first or
 * the last; an attacker who can add a second `shop=` to a signed query and have
 * the verifier sign one value while the application reads the other has a
 * parameter-smuggling primitive. Refusing the duplicate outright is the only
 * answer with no first/last convention to get wrong.
 */
export function verifyQueryHmac(
  query: Readonly<Record<string, string | string[] | undefined>>,
  secret: string
): boolean {
  if (secret.length === 0) return false;
  const provided = query["hmac"];
  if (typeof provided !== "string" || provided.length === 0) return false;

  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (key === "hmac" || key === "signature") continue;
    // The duplicate refusal. Fastify hands a repeated query parameter as an
    // array, which is precisely the shape being refused.
    if (Array.isArray(value)) return false;
    if (value === undefined) continue;
    parts.push(`${key}=${value}`);
  }
  parts.sort();
  const computed = createHmac("sha256", secret).update(parts.join("&"), "utf8").digest("hex");
  return digestsMatch(computed, provided.toLowerCase());
}

/**
 * Verify the HMAC Shopify puts on a WEBHOOK, over the RAW request body.
 *
 * `X-Shopify-Hmac-Sha256` is base64 of HMAC-SHA256 over the bytes exactly as
 * they arrived. **Over the bytes, and never over a re-serialisation of the
 * parsed JSON** — `JSON.parse` followed by `JSON.stringify` changes key order,
 * number formatting and whitespace, so a verifier built on the parsed object
 * fails for correct messages and, worse, can be made to succeed for wrong ones
 * by anyone who understands the re-serialisation. The raw buffer reaches this
 * function because the route registers its own content-type parser inside its
 * own encapsulated plugin (`src/routes/connectors.ts`).
 */
export function verifyWebhookHmac(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (secret.length === 0) return false;
  if (header === undefined || header.length === 0) return false;
  const computed = createHmac("sha256", secret).update(rawBody).digest("base64");
  return digestsMatch(computed, header);
}

// ---------------------------------------------------------------------------
// 053 §5.5 — the topics this connector understands.
// ---------------------------------------------------------------------------

/** The topic whose arrival RETIRES every live token for the store (053 §7.3). */
export const TOPIC_APP_UNINSTALLED = "app/uninstalled";

/**
 * The three mandatory compliance topics.
 *
 * **This bead ACKNOWLEDGES and RECORDS them and performs no data-subject work**,
 * and the split is deliberate rather than lazy: what a shop or a person is
 * entitled to, on what clock, and what they are told, is 041 §8.7(d)/(e)'s
 * NEEDS-COUNSEL material and E03-B09's bead. What this bead owes is that the
 * message is authenticated, is recorded as a fact with a digest and no payload,
 * and cannot be lost — because a privacy request this system silently discarded
 * is the failure that reads as compliance until somebody asks.
 */
export const COMPLIANCE_TOPICS = ["shop/redact", "customers/data_request", "customers/redact"] as const;

/** Every topic with a declared effect. An unknown topic is recorded and does nothing. */
export const KNOWN_TOPICS: readonly string[] = [TOPIC_APP_UNINSTALLED, ...COMPLIANCE_TOPICS];
