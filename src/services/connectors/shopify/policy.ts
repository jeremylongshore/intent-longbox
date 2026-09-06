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

// ===========================================================================
// E03-B08 (000-docs/064) — REPLAY AND ORDERING, AS PURE PREDICATES.
//
// Everything below is still a pure function of its inputs: the clock arrives as
// a parameter, the windows arrive as parameters, and the caller in `api.ts` is
// the only thing that reads the environment or a table. That is what lets the
// whole replay decision be tested with no cluster and no network.
// ===========================================================================

/**
 * ⚠ **THE HEADERS ARE NOT SIGNED, AND THAT IS THE FACT THIS WHOLE SECTION IS
 * SHAPED BY.** Shopify's webhook HMAC covers the RAW BODY and nothing else.
 * `X-Shopify-Webhook-Id`, `X-Shopify-Triggered-At` **and
 * `X-Shopify-Shop-Domain`** are all outside it.
 *
 * ⚠⚠ **THE THIRD ONE IS THE TARGET, AND v1.0.0 OF THIS FILE OMITTED IT — the
 * security lens's F1, and the reason that review was a REJECT.** The first draft
 * named the id and the timestamp as adversary-chosen and treated the store
 * domain as evidence. It is not evidence: it is the value that SELECTS which
 * shop's tokens are destroyed and which tenant an obligation is attributed to,
 * so one captured signed message from ANY store — including the isolated dev
 * store this bead names as its own closing evidence — retired an unrelated
 * shop's live token and wrote a forged privacy obligation under that shop's
 * tenant. Substituting the domain ALSO changed the body-key tuple, so the
 * replay detector was evaded by the same edit. `domainInSignedBody` is the
 * repair: the store comes from the BYTES the signature covers, and the header is
 * a value checked against it.
 *
 * So there are two adversaries and one mechanism cannot answer both:
 *
 *   * **The provider's at-least-once delivery** re-sends the SAME id with the
 *     SAME bytes. `UNIQUE (connector, webhook_id)` (053 §5.5) answers it exactly,
 *     and nothing here replaces or weakens that.
 *   * **A deliberate replay** — anyone holding one captured message — can choose
 *     any id and any timestamp, because those are headers. The only thing it
 *     cannot change without breaking the signature is the BODY. So the key that
 *     binds a deliberate replay is `sha256(body)`, which is a digest OF the
 *     signed bytes, and the window is what stops that key from collapsing two
 *     genuinely distinct messages that happen to be byte-identical years apart.
 *
 * Declared as a constant rather than left in the record, so the next person to
 * reach for a header-derived guard meets the sentence in the file they edit.
 */
export const WEBHOOK_HEADERS_ARE_NOT_SIGNED = true;

/**
 * **PROVISIONAL FLOOR.** How old a signed message may be and still be acted on.
 *
 * The derivation, so it can be argued with rather than inherited: Shopify retries
 * a failing webhook with backoff over roughly 48 hours before giving up. A
 * message older than that horizon is one the provider itself would no longer be
 * sending, so refusing it costs nothing a legitimate retry would have delivered,
 * and accepting it means acting on a fact about a world that has had two days to
 * change. 48 hours, plus nothing.
 *
 * It is a floor and not a measurement: no delivery-age distribution has been
 * observed, and its closing evidence is the first week of real webhook traffic.
 * Raise it with data, never to make a test pass.
 */
export const WEBHOOK_RECEIPT_WINDOW_SECONDS = 48 * 60 * 60;

/**
 * **PROVISIONAL FLOOR.** The guard band on the cross-clock comparison in
 * `retirementCutoff`.
 *
 * `triggered_at` is Shopify's clock; `connector_token_version.created_at` is this
 * database's. 043 §2.4 ratified exactly this kind of comparison for
 * `attempt_visibility` and named its condition — beyond a single host, NTP is a
 * requirement and not an operational nicety. Five minutes is far beyond plausible
 * skew between two NTP-synced hosts and far below the minutes-to-days a merchant
 * takes to re-install, which is what makes the band useful: it keeps the bound
 * from failing in the direction that leaves a token this system believes is live
 * after the merchant has already killed it at Shopify.
 */
export const WEBHOOK_CLOCK_SKEW_SECONDS = 5 * 60;

/**
 * **PROVISIONAL FLOOR.** How long after a privacy message arrives before an
 * unanswered one becomes a finding.
 *
 * ⚠ **IT IS NOT A LEGAL DEADLINE AND NO ARTIFACT MAY PRESENT IT AS ONE.** What a
 * person is entitled to, on what clock, and what they are told is 041
 * §8.7(d)/(e)'s NEEDS-COUNSEL material, E01-B06's engagement and E03-B09's bead.
 * This number exists so that *nobody answered* is detectable, and its only claim
 * is about this repository's own attention.
 */
export const PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS = 25;

/**
 * **PROVISIONAL FLOOR.** How many compliance obligations may be recorded for ONE
 * store domain that matches no install, before further ones are refused.
 *
 * ⚠ **IT EXISTS BECAUSE OF A PROBE, NOT A THEORY (F5).** The per-shop rate token
 * is only taken when the domain RESOLVES to a shop, so a caller replaying one
 * captured compliance body under twenty-five invented domains was bounded by the
 * route's aggregate alone and wrote twenty-five null-tenant obligations, each
 * with a `due_at` — which puts `pnpm audit:privacy-requests` permanently at exit
 * 1 and buries a real finding in noise. F1's signed-domain check closes most of
 * it (one captured body now pins one domain), and this is what remains.
 *
 * **The derivation.** A store that matches no install is a store this system
 * holds nothing for, so the only legitimate traffic on this path is a
 * `shop/redact` for a shop already offboarded — 053 §5.5's own example, and there
 * is exactly ONE such message per offboarded store per topic. Eight is that
 * number with room for the provider's retries and for a shop that offboards, is
 * re-onboarded and offboards again, and it is a floor rather than a measurement:
 * no null-tenant traffic has ever been observed. Raise it with data.
 */
export const PRIVACY_UNRESOLVED_DOMAIN_CEILING = 8;

/**
 * The scopes whose presence in a RECORDED grant would mean this system could have
 * reached a customer.
 *
 * Orders sit beside customers deliberately: an order carries the buyer, which is
 * the reason §6 gives for refusing `read_orders` in the first place.
 */
export const CUSTOMER_BEARING_SCOPES: readonly string[] = [
  "read_customers",
  "write_customers",
  "read_all_orders",
  "read_orders",
  "write_orders",
];

/** TRUE when a recorded grant carries any authority that could have reached a customer. */
export function grantCouldReachACustomer(grantedScopes: readonly string[]): boolean {
  return grantedScopes.some((s) => CUSTOMER_BEARING_SCOPES.includes(s.trim().toLowerCase()));
}

/**
 * Which field of a topic's SIGNED PAYLOAD carries the store it is about.
 *
 * ⚠ **ASSERTED, NOT VERIFIED — 064 §0 A4, signed OPEN in 043 A11's idiom.** No
 * call to Shopify's documentation or to a store was made while writing this, so
 * the field NAMES are an assumption about a third party's interface, and 018
 * makes that an assumption rather than a fact. Its closing evidence is the SAME
 * one A1 needs: one signed delivery against the isolated dev store named in
 * `.env.example`, before this path serves a real shop (E03-B10).
 *
 * **A wrong guess fails CLOSED and says so.** An unrecognised shape yields
 * `undefined`, and `api.ts` refuses the DESTRUCTIVE effect rather than the
 * message — the topic is still recorded, still acknowledged, and a token is
 * simply not retired on evidence this build could not read. That is the
 * direction 053 §5.5 chose for an unknown topic, one field deeper.
 */
export const TOPIC_DOMAIN_FIELD: Readonly<Record<string, readonly string[]>> = {
  // The `app/uninstalled` payload is the SHOP object, whose canonical field is
  // `myshopify_domain`. `shop_domain` is accepted as a SECOND candidate, and the
  // list is ordered rather than a single name for A4's sake: a wrong guess makes
  // this check answer `unknown`, which refuses the RETIREMENT — so the cost of
  // guessing narrowly is an uninstall that does not end anything. Accepting a
  // second name that Shopify also uses on neighbouring payloads reduces that risk
  // and weakens nothing: whichever candidate is found must still EQUAL the
  // header, and both are inside the bytes the signature covers.
  [TOPIC_APP_UNINSTALLED]: ["myshopify_domain", "shop_domain"],
  // The three compliance payloads name the store they concern.
  "shop/redact": ["shop_domain", "myshopify_domain"],
  "customers/data_request": ["shop_domain", "myshopify_domain"],
  "customers/redact": ["shop_domain", "myshopify_domain"],
};

/**
 * The store named INSIDE the signed bytes, or `undefined` when the body is not
 * an object, the topic declares no field, or the field is absent or not a string.
 *
 * **It parses the buffer rather than taking a parsed object**, and that is
 * deliberate: `receiveWebhook` verifies the HMAC over the raw bytes and this
 * reads the same bytes, so there is no window in which a re-serialisation could
 * disagree with what was signed. A body that is not JSON is not an error here —
 * it returns `undefined` and the caller decides, because a topic this build has
 * never seen may not be JSON at all.
 *
 * The value is LOWERCASED, because a domain is case-insensitive and an equality
 * check that said otherwise would refuse authentic messages.
 */
export function domainInSignedBody(rawBody: Buffer, topic: string): string | undefined {
  const fields = TOPIC_DOMAIN_FIELD[topic];
  if (fields === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const body = parsed as Record<string, unknown>;
  // FIRST PRESENT wins, in the declared order. A payload carrying both is
  // Shopify's own, and taking the canonical name first is the only ordering that
  // is not arbitrary.
  for (const field of fields) {
    const value = body[field];
    if (typeof value === "string" && value.length > 0) return value.toLowerCase();
  }
  return undefined;
}

/**
 * Whether the header's store may be acted on, given what the SIGNED BODY says.
 *
 * Three outcomes, and the middle one is the whole F1 repair:
 *
 *   * **`agrees`** — the body names a store and it is the header's. Everything
 *     proceeds; the domain is now a signed value.
 *   * **`mismatch`** — the body names a DIFFERENT store. This is the attack:
 *     one captured message re-addressed at another tenant. Refused before any
 *     row, at the same branch that refuses a signed message with no usable
 *     topic, so it costs one HMAC and one `JSON.parse` and leaves nothing.
 *   * **`unknown`** — this build cannot read a store out of this topic's
 *     payload. The message is RECORDED and acknowledged, and any DESTRUCTIVE
 *     effect is refused: an unknown shape must not be able to turn a
 *     `customers/redact` into a message nobody recorded, and must not be able to
 *     retire a token either.
 */
export type SignedDomainVerdict = "agrees" | "mismatch" | "unknown";

export function checkSignedDomain(rawBody: Buffer, topic: string, headerDomain: string): SignedDomainVerdict {
  const inBody = domainInSignedBody(rawBody, topic);
  if (inBody === undefined) return "unknown";
  return inBody === headerDomain.toLowerCase() ? "agrees" : "mismatch";
}

/**
 * How a topic's effect behaves when messages arrive out of order — which Shopify
 * does, and says it does, alongside at-least-once delivery.
 *
 *   * `commutative` — two deliveries in either order have the same effect. A
 *     constraint absorbs the second and no clock is consulted.
 *   * `event_time_bounded` — the effect applies only to state that EXISTED when
 *     the event happened, so a delayed delivery cannot reach past its own
 *     timestamp into facts created after it.
 *   * `sequenced` — the effect is order-dependent and must be drained in order
 *     through the outbox's `session_seq` idiom (043 §3.2). **Nothing is in this
 *     class today**, and the member exists so the topic that will need it
 *     (E10-B08's publish/sale/return/refund reconciliation) has a name to be
 *     assigned rather than a decision to re-derive.
 */
export type TopicOrdering = "commutative" | "event_time_bounded" | "sequenced";

/**
 * How far back the body key looks when deciding whether these bytes are a repeat
 * (the security lens's F3, and the invariant review's finding 1 — reproduced
 * independently, one of them by simply OMITTING `triggered_at`).
 *
 *   * **`window`** — a repeat inside `WEBHOOK_RECEIPT_WINDOW_SECONDS` is a
 *     replay; outside it, two byte-identical messages are two events. Correct
 *     for a REQUEST, which is what the three compliance topics carry: two
 *     redaction requests for one customer a year apart are two obligations, and
 *     collapsing them absolutely would make the second one disappear.
 *   * **`absolute`** — a repeat is a repeat FOREVER. Correct for
 *     `app/uninstalled`, and §5.1 is its own disambiguator: **two
 *     byte-identical uninstall payloads are the same uninstall.** The payload is
 *     the shop object, and a genuine second uninstall after a re-install differs
 *     in it. With `window`, the counter-example §5.1 exists to close came back
 *     the moment the attacker was PATIENT — capture, wait out forty-eight hours,
 *     replay under a fresh id, and the re-installed token dies.
 */
export type ReplayLookback = "window" | "absolute";

export interface TopicPolicy {
  readonly topic: string;
  readonly ordering: TopicOrdering;
  /** How far back the body key looks. See `ReplayLookback`. */
  readonly replayLookback: ReplayLookback;
  /** What arriving on this topic actually causes inside Longbox. */
  readonly effect: string;
  /** Why that ordering, and what makes a second or a late delivery harmless. */
  readonly because: string;
}

/**
 * **The per-topic ordering ruling (000-docs/064 §5), as a constant rather than as
 * prose in a record nothing executes.**
 *
 * Every entry in `KNOWN_TOPICS` has a row here and a contract test asserts the
 * two agree in both directions — so a topic cannot gain an effect without
 * somebody deciding what a late copy of it means.
 */
export const TOPIC_POLICY: readonly TopicPolicy[] = [
  {
    topic: TOPIC_APP_UNINSTALLED,
    ordering: "event_time_bounded",
    // ABSOLUTE, and §5.1 below is its own argument: two byte-identical uninstall
    // payloads are the same uninstall. A window here is a clock the attacker
    // only has to outwait (F3).
    replayLookback: "absolute",
    effect: "retires every live connector token version granted for the store (053 §7.3)",
    because:
      "It is NOT commutative, and the counter-example is a sequence rather than a hypothetical: " +
      "the merchant uninstalls at T1 while this endpoint is unreachable; they re-install at T2 " +
      "and a new token version is introduced; Shopify's retry finally lands at T3, still inside " +
      "its 48-hour horizon, and — as first shipped — retires the FRESH token. The receipt's " +
      "UNIQUE never fires, because that delivery is the first one carrying that id. So the bound " +
      "is on the EVENT's own time: an uninstall ends the tokens that existed when it happened, " +
      "and a version introduced after it is not covered by it.",
  },
  {
    topic: "customers/data_request",
    ordering: "commutative",
    // WINDOW: two redaction requests for one customer a year apart are two
    // obligations, and an absolute key would make the second disappear.
    replayLookback: "window",
    effect: "appends one `privacy_request` fact and enqueues its fulfilment job",
    because:
      "A request is not a state, so a later copy has nothing to overwrite. Two deliveries of one " +
      "message collapse on `UNIQUE (connector, webhook_id)` and on the body key; two genuinely " +
      "distinct requests are two obligations and both are owed. Nothing about the answer depends " +
      "on which arrived first.",
  },
  {
    topic: "customers/redact",
    ordering: "commutative",
    // WINDOW: two redaction requests for one customer a year apart are two
    // obligations, and an absolute key would make the second disappear.
    replayLookback: "window",
    effect: "appends one `privacy_request` fact and enqueues its fulfilment job",
    because:
      "As `customers/data_request`. What this system owes is bounded by what it holds, and it " +
      "holds no customer identifier at all — so there is no state whose order could matter, and " +
      "the answer to two copies is the answer to one.",
  },
  {
    topic: "shop/redact",
    ordering: "commutative",
    // WINDOW: two redaction requests for one customer a year apart are two
    // obligations, and an absolute key would make the second disappear.
    replayLookback: "window",
    effect:
      "appends one `privacy_request` fact and NO job — the deletion procedure is E03-B09's and " +
      "is deliberately not automated here",
    because:
      "It arrives after an uninstall, so it always follows the message that ended the authority, " +
      "and it asks for a deletion this bead does not perform. A late or duplicate copy therefore " +
      "changes nothing: the fact is recorded once by the same two keys, the clock starts once, " +
      "and a person answers it once.",
  },
];

const TOPIC_POLICY_BY_NAME: ReadonlyMap<string, TopicPolicy> = new Map(
  TOPIC_POLICY.map((row) => [row.topic, row])
);

/** The declared policy for a topic, or `undefined` for one nobody decided about. */
export function topicPolicy(topic: string): TopicPolicy | undefined {
  return TOPIC_POLICY_BY_NAME.get(topic);
}

/** TRUE for the three topics that produce a `privacy_request` fact. */
export function isComplianceTopic(topic: string): boolean {
  return (COMPLIANCE_TOPICS as readonly string[]).includes(topic);
}

/**
 * TRUE for the two compliance topics whose fulfilment this system can answer out
 * of its own scope policy.
 *
 * `shop/redact` is NOT one of them, and the difference is the whole reason the
 * split exists: it asks for the deletion of a SHOP's data, which this system
 * genuinely holds, on a policy nobody has ratified yet (E03-B09).
 */
export function isAutoFulfillableTopic(topic: string): boolean {
  return topic === "customers/data_request" || topic === "customers/redact";
}

/**
 * `X-Shopify-Triggered-At` as a Date, or `undefined` when it is absent or
 * unparseable.
 *
 * Unparseable is treated as ABSENT rather than as a refusal, on the same
 * reasoning that makes the column nullable: a header this system could not read
 * must never be able to turn a `customers/redact` into a message nobody recorded.
 */
export function parseTriggeredAt(header: string | undefined): Date | undefined {
  if (header === undefined || header.length === 0) return undefined;
  const ms = Date.parse(header);
  return Number.isFinite(ms) ? new Date(ms) : undefined;
}

/** What this system decided about one delivery. Mirrors `connector_webhook_receipt.disposition`. */
export type WebhookDisposition = "accepted" | "stale" | "replayed_body";

export interface DeliveryClassification {
  readonly disposition: WebhookDisposition;
  /** TRUE only for `accepted`: the one disposition whose effects run. */
  readonly runEffects: boolean;
}

/**
 * A stated event time this system is willing to reason from.
 *
 * ⚠ **F2 (security lens, HIGH). `triggered_at` was bounded only in the PAST.**
 * `now - triggeredAt > window` is never true for a FUTURE value, so a captured
 * message replayed with `X-Shopify-Triggered-At: 2030-…` was never stale — and
 * `retirementCutoff` then pushed the uninstall's reach arbitrarily forward,
 * disabling Decision B for exactly the adversary it was written against. The
 * probe (P1) retired everything and would have gone on doing so.
 *
 * A time in the future beyond the skew band is not a time this system can use,
 * so it is treated as **ABSENT** — the same answer an unreadable header gets,
 * for the same reason: an unusable value must never be able to turn a
 * `customers/redact` into a message nobody recorded, and must never be able to
 * widen an effect either.
 */
export function usableTriggeredAt(
  triggeredAt: Date | undefined,
  now: Date,
  skewSeconds: number = WEBHOOK_CLOCK_SKEW_SECONDS
): Date | undefined {
  if (triggeredAt === undefined) return undefined;
  return triggeredAt.getTime() > now.getTime() + skewSeconds * 1000 ? undefined : triggeredAt;
}

/**
 * Classify one delivery against the two rules, in a fixed order.
 *
 * **Staleness is decided BEFORE the body key**, and the order is not arbitrary: a
 * message that is both stale and a repeat is more usefully recorded as stale,
 * because that is the fact a human reading the receipt table needs (something is
 * delivering very late), whereas *we have seen these bytes* is a fact this system
 * already holds.
 *
 * `priorBodySeenAt` is the `received_at` of the newest earlier receipt with the
 * same connector, topic, store and body digest, or `undefined` when there is
 * none. The caller reads it inside the receiving transaction; the race that read
 * admits is stated narrowly in 064 §4.3 and bounded by an advisory lock (K2),
 * not papered over.
 *
 * ⚠ **`lookback` IS THE F3 REPAIR AND IT IS NOT OPTIONAL.** With `window`
 * everywhere, the counter-example §5.1 exists to close came back the moment the
 * attacker was patient: capture an uninstall, wait out forty-eight hours, replay
 * the same bytes under a fresh id with `triggered_at = now`, and the token a
 * re-install introduced dies. Two lenses reproduced it independently — one of
 * them by simply OMITTING `triggered_at`, which is cheaper still. For
 * `app/uninstalled` the lookback is **absolute**: two byte-identical uninstall
 * payloads are the same uninstall.
 */
export function classifyDelivery(input: {
  readonly now: Date;
  readonly triggeredAt: Date | undefined;
  readonly priorBodySeenAt: Date | undefined;
  readonly windowSeconds: number;
  /** Per-topic (`TOPIC_POLICY`). Defaults to the conservative `window` for an unknown topic. */
  readonly lookback?: ReplayLookback;
  /** The band that decides whether a FUTURE stated time is usable at all (F2). */
  readonly skewSeconds?: number;
}): DeliveryClassification {
  const windowMs = input.windowSeconds * 1000;
  const stated = usableTriggeredAt(input.triggeredAt, input.now, input.skewSeconds);
  if (stated !== undefined && input.now.getTime() - stated.getTime() > windowMs) {
    return { disposition: "stale", runEffects: false };
  }
  if (input.priorBodySeenAt !== undefined) {
    const withinWindow = input.now.getTime() - input.priorBodySeenAt.getTime() <= windowMs;
    if ((input.lookback ?? "window") === "absolute" || withinWindow) {
      return { disposition: "replayed_body", runEffects: false };
    }
  }
  return { disposition: "accepted", runEffects: true };
}

/**
 * The instant an `app/uninstalled` message's authority stops reaching forward:
 * token versions introduced after it are not covered by it.
 *
 * `undefined` when the provider stated no event time, and that answer means
 * **retire every live version**, which is the behaviour E03-B06 shipped. Under a
 * missing header the conservative direction is the one that leaves no live token
 * behind: a shop that must re-install is inconvenienced, while a token this
 * system believes is live after the merchant killed it is a credential nobody is
 * managing.
 *
 * ⚠ **THE CUTOFF IS CLAMPED AT `now` (F2).** A stated event time cannot push an
 * uninstall's reach into the FUTURE, because a future value is not evidence about
 * when anything happened — it is a header somebody chose. `usableTriggeredAt`
 * already treats a value beyond the band as absent, and this `min` is the second
 * half of the same rule: even inside the band, the guard band's job is to absorb
 * SKEW, never to extend an event's authority past the moment it is being acted
 * on. Without the clamp, `triggered_at` in 2030 retired every version this shop
 * would ever have.
 */
export function retirementCutoff(
  triggeredAt: Date | undefined,
  skewSeconds: number = WEBHOOK_CLOCK_SKEW_SECONDS,
  now: Date = new Date()
): Date | undefined {
  const stated = usableTriggeredAt(triggeredAt, now, skewSeconds);
  if (stated === undefined) return undefined;
  return new Date(Math.min(stated.getTime() + skewSeconds * 1000, now.getTime()));
}

/**
 * The floors this subsystem reads, resolved ONCE by the composition root.
 *
 * ⚠ **`fulfilmentWindowDays` JOINED THIS INTERFACE BECAUSE IT WAS DOCUMENTED AND
 * DEAD** (the invariant review's finding 2). `.env.example` described
 * `PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS` as an operator-settable floor beside
 * two that really were settable, and nothing read it — so an operator who set it
 * got the default and no error. A documented variable nothing reads is a false
 * statement in the file operators trust most.
 */
export interface WebhookWindowConfig {
  readonly windowSeconds: number;
  readonly clockSkewSeconds: number;
  readonly fulfilmentWindowDays: number;
  readonly unresolvedDomainCeiling: number;
}

/**
 * Read the four floors from the environment, falling back to the provisional
 * defaults — `loadOutboxParams`'s shape, one subsystem over, and the same 018 C3
 * rule: a ceiling may be RAISED freely because it binds less, and LOWERING one
 * after seeing a result it would change needs a 006 row.
 *
 * ⚠ IT IS A PURE FUNCTION OF THE MAP IT IS GIVEN, and `process.env` is the
 * default rather than the mechanism — so a test can construct a one-second window
 * without mutating global state.
 */
export function loadWebhookWindows(
  env: Record<string, string | undefined> = process.env
): WebhookWindowConfig {
  const positive = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new Error(`env ${name} must be a positive integer`);
    return n;
  };
  return {
    windowSeconds: positive("CONNECTOR_WEBHOOK_RECEIPT_WINDOW_SECONDS", WEBHOOK_RECEIPT_WINDOW_SECONDS),
    // A skew band of ZERO is legal and is what the integration lane uses, so this
    // one accepts 0 while the window does not: a zero-length receipt window would
    // refuse every message, and a zero-length guard band only removes an
    // allowance.
    clockSkewSeconds: (() => {
      const raw = env["CONNECTOR_WEBHOOK_CLOCK_SKEW_SECONDS"];
      if (raw === undefined || raw === "") return WEBHOOK_CLOCK_SKEW_SECONDS;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error("env CONNECTOR_WEBHOOK_CLOCK_SKEW_SECONDS must be a non-negative integer");
      }
      return n;
    })(),
    fulfilmentWindowDays: positive(
      "PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS",
      PRIVACY_REQUEST_FULFILMENT_WINDOW_DAYS
    ),
    unresolvedDomainCeiling: positive("PRIVACY_UNRESOLVED_DOMAIN_CEILING", PRIVACY_UNRESOLVED_DOMAIN_CEILING),
  };
}
