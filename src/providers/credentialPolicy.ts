// The credential-shape policy: what a `shop_credentials` row is allowed to say.
//
// Bead: longbox-e5b.3.11 (alias E03-D01). Docs: 046 §4 B7, §5 A7/A15, §7.2/§7.3,
// §9.3 row 1, §11 I4/I5; 034 §3; 019 T24/T31; CLAUDE.md locked decision 2.
//
// ONE SENTENCE. A credential row names an environment variable inside its own
// shop's namespace and a host on the registered list, or it is refused — and the
// refusal happens BEFORE `process.env` is read, so a name that would have
// resolved never does.
//
// WHY THE FUNCTION IS THE CONTROL AND THE CHECK CONSTRAINT IS THE BACKSTOP
// (the Kleppmann amendment on this bead). `migrations/014` enforces the SHAPE at
// the column and cannot be switched off, which is what makes the exfiltration
// primitive in 046 §5 A15 unrepresentable: no row satisfying the CHECK can name
// `ANTHROPIC_API_KEY`, `DATABASE_URL`, `LLM_API_KEY` or an operator's `AWS_*`.
// But a CHECK sees one row of one table and can never know which SHOP owns it,
// so the cross-tenant half of the rule — 046 §5 A7, "shop B's credential row
// names shop A's environment variable" — has to live in a function that is
// handed both. `resolveKeyRef` is that function, its `shopSlug` parameter is
// REQUIRED, and every caller funnels through it. A value that never came from
// the column (a fixture, a future admin API, a config file) is refused by the
// same code path as one that did.
import { z } from "zod";
import { REGISTERED_PROVIDER_HOSTS, hostOf } from "../config.js";

/** Re-exported so provider-side callers name the list from `src/providers`.
 *  The canonical copy is in `src/config.ts` — see the comment there: the
 *  architecture gate forbids `src/config.ts` importing `src/providers/**`. */
export { REGISTERED_PROVIDER_HOSTS } from "../config.js";

/**
 * The suffixes a `key_ref` may carry — a CLOSED SET, one per credential kind,
 * plus the eBay pair's second half as a NAMED MEMBER of its own.
 *
 * ⚠ THE INVARIANT-REVIEW FINDING THIS CLOSES (E03-D01, review of `610501e`).
 * The first version of this module checked `keyRef.startsWith(namespace)`, which
 * is an UNANCHORED PREFIX: shop `gotham` (namespace `LONGBOX_GOTHAM_`) accepted
 * `LONGBOX_GOTHAM_CITY_ANTHROPIC_KEY` — the sibling shop `gotham-city`'s own
 * variable — and the CHECK constraint accepted it too. That is 046 §5 A7's
 * cross-shop key-ref confusion surviving inside the control written to prevent
 * it, and it is the reason the rule is now EXACT EQUALITY against a closed set
 * rather than a prefix test: a namespace expressed as a string prefix is not a
 * namespace, because one shop's name can be another's prefix.
 *
 * `EBAY_KEY_SECRET` is a member rather than a `${key_ref}_SECRET` consequence
 * for the same reason. Deriving a second name by appending to a validated one is
 * how a prefix rule re-enters through the back door; naming it means the set of
 * legal values is finite, written down, and equal at both layers.
 */
export const CREDENTIAL_SUFFIXES = [
  "ANTHROPIC_KEY",
  "OPENAI_KEY",
  "SHOPIFY_KEY",
  "PRICECHARTING_KEY",
  "EBAY_KEY",
  "EBAY_KEY_SECRET",
] as const;

export type CredentialSuffix = (typeof CREDENTIAL_SUFFIXES)[number];

/** Credential kind → the one suffix that kind may name. */
export const KIND_SUFFIX = {
  anthropic: "ANTHROPIC_KEY",
  openai_compat: "OPENAI_KEY",
  shopify: "SHOPIFY_KEY",
  pricecharting: "PRICECHARTING_KEY",
  ebay: "EBAY_KEY",
} as const satisfies Record<string, CredentialSuffix>;

/**
 * The shape every `key_ref` must have — the same expression as
 * `migrations/014`'s `shop_credentials_key_ref_namespaced` CHECK.
 *
 * `LONGBOX_`, ONE slug segment with no underscore in it, then one of the closed
 * suffixes. The single-segment rule is what lets the DATABASE refuse the sibling
 * case above without knowing which shop owns the row: `LONGBOX_GOTHAM_CITY_…`
 * fails because `CITY` is not a legal suffix, and there is no second slug segment
 * for it to hide in.
 */
export const KEY_REF_PATTERN =
  /^LONGBOX_[A-Z0-9]+_(ANTHROPIC|OPENAI|SHOPIFY|PRICECHARTING|EBAY)_KEY(_SECRET)?$/;

/**
 * The env-name form of a shop slug: `gotham-city` → `GOTHAMCITY`.
 *
 * Separators are STRIPPED, not replaced with `_`. Replacing them was what made
 * `LONGBOX_GOTHAM_CITY_ANTHROPIC_KEY` a well-formed name at all; stripping them
 * keeps every env name to a single slug segment, which is the property the CHECK
 * constraint needs in order to refuse a sibling it cannot look up.
 *
 * ⚠ IT IS NOT INJECTIVE — `gotham-city` and `gothamcity` both fold to
 * `GOTHAMCITY`. That is not repaired here, because a fold that could not collide
 * would have to encode the separator, which is the multi-segment shape just
 * removed. It is repaired at the only place a collision can be created:
 * `scripts/register-shop.ts` refuses a slug whose fold an existing shop already
 * owns, and `migrations/014` constrains `shop.slug` to `^[a-z0-9-]+$` so the set
 * of possible folds is small and checkable.
 */
export function envSlug(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Every key_ref this shop may name begins with this AND ends with a closed suffix. */
export function keyRefNamespace(slug: string): string {
  return `LONGBOX_${envSlug(slug)}_`;
}

/**
 * The existing slug, if any, that already owns the namespace `slug` would fold to.
 *
 * The fold is deliberately non-injective (see `envSlug`), so the collision is
 * real and has to be refused SOMEWHERE. It is refused at the only place a second
 * colliding slug can be created — `scripts/register-shop.ts` — and the predicate
 * lives here, next to the fold, so the rule and the thing it constrains cannot
 * drift apart. Two shops sharing a namespace would each satisfy every check in
 * the system while reading each other's keys.
 */
export function findNamespaceClash(slug: string, existingSlugs: readonly string[]): string | undefined {
  const fold = envSlug(slug);
  return existingSlugs.find((existing) => existing !== slug && envSlug(existing) === fold);
}

/** Every legal key_ref for one shop — the finite set the resolver compares against. */
export function legalKeyRefs(slug: string): readonly string[] {
  return CREDENTIAL_SUFFIXES.map((suffix) => `${keyRefNamespace(slug)}${suffix}`);
}

/**
 * The canonical name for one shop's credential of one kind:
 * `LONGBOX_<SLUG>_<SUFFIX>`. `scripts/register-shop.ts` seeds exactly these, so
 * the rows it writes satisfy both the CHECK and the resolver.
 */
export function deriveKeyRef(slug: string, kind: keyof typeof KIND_SUFFIX): string {
  return `${keyRefNamespace(slug)}${KIND_SUFFIX[kind]}`;
}

/**
 * Why a key_ref did not produce a value. `unset` is ordinary; the rest refuse.
 *
 * `retired` joined the set at E03-B05 (050 §4, §9 I11) and is a DIFFERENT KIND
 * of refusal from the other two, which is why it is a third reason rather than
 * an out-of-namespace with a new message: `malformed` and `out_of_namespace` are
 * facts about a NAME, decided without touching the database, while `retired` is
 * a fact about the credential's LIFE — the name is perfectly legal and the
 * variable may well be set. What the operator has to do about it differs
 * accordingly (fix the row versus introduce a new version), and 042 §4.1's
 * argument for codes over prose applies inside this seam too.
 */
export type KeyRefRefusal = "malformed" | "out_of_namespace" | "retired";
export type KeyRefResolution =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: KeyRefRefusal | "unset" };

/**
 * The structured warning this seam emits when a row names a variable it may not.
 *
 * It carries the SHOP and the NAME and never a value — 046 §7's rule and the
 * builder's own standard: *no secret value ever appears in a diff, a log line, a
 * fixture, a bead note or a PR body*. A refusal is interesting precisely because
 * it names which shop's configuration is wrong, which is the fact an operator
 * needs and the one a secret scan (019 T31) structurally cannot produce — T31's
 * instrument is a scan for values, and this is a fact about names.
 */
export interface CredentialRefusalEvent {
  readonly event: "credential.key_ref_refused";
  readonly reason: KeyRefRefusal;
  readonly shop_slug: string;
  readonly key_ref: string;
  readonly expected_prefix: string;
}

/** Where refusals go. Replaceable so a test can observe them without a logger. */
let refusalSink: (e: CredentialRefusalEvent) => void = (e) => {
  console.warn(JSON.stringify(e));
};

/** Install a sink; returns the previous one so a test can restore it. */
export function setCredentialRefusalSink(
  sink: (e: CredentialRefusalEvent) => void
): (e: CredentialRefusalEvent) => void {
  const prev = refusalSink;
  refusalSink = sink;
  return prev;
}

/**
 * Emit a refusal without producing a resolution.
 *
 * Exported for the `retired` reason, which is decided in
 * `./credentialVersions.ts` from two TABLES rather than from a name — the check
 * cannot live inside `resolveKeyRef`, but the EVENT must be the same event, or
 * an operator watching for `credential.key_ref_refused` would see four of the
 * five refusal kinds and silently miss the one a rotation produces.
 */
export function reportCredentialRefusal(reason: KeyRefRefusal, slug: string, keyRef: string): void {
  refusalSink({
    event: "credential.key_ref_refused",
    reason,
    shop_slug: slug,
    key_ref: keyRef,
    expected_prefix: keyRefNamespace(slug),
  });
}

function refuse(reason: KeyRefRefusal, slug: string, keyRef: string): KeyRefResolution {
  reportCredentialRefusal(reason, slug, keyRef);
  return { ok: false, reason };
}

/**
 * Resolve a `key_ref` (an env var NAME) to its value, for ONE named shop.
 *
 * `shopSlug` is required and is the whole point: the namespace check runs BEFORE
 * `process.env` is consulted, so an out-of-namespace name that happens to be a
 * perfectly valid, set environment variable — `ANTHROPIC_API_KEY`, another
 * shop's `LONGBOX_OTHERSHOP_ANTHROPIC_KEY`, or the SIBLING-SLUG case
 * `LONGBOX_GOTHAM_CITY_ANTHROPIC_KEY` read by shop `gotham` — is refused and
 * never read. There is no fallback branch: a refusal returns a refusal.
 *
 * The membership test is EXACT EQUALITY against `legalKeyRefs(shopSlug)`, never
 * a prefix test. A prefix test is what let the sibling through.
 */
export function resolveKeyRef(keyRef: string, shopSlug: string): KeyRefResolution {
  if (!KEY_REF_PATTERN.test(keyRef)) return refuse("malformed", shopSlug, keyRef);
  if (!legalKeyRefs(shopSlug).includes(keyRef)) return refuse("out_of_namespace", shopSlug, keyRef);
  const value = process.env[keyRef];
  if (value === undefined || value.length === 0) return { ok: false, reason: "unset" };
  return { ok: true, value };
}

/** True when a credential row's `base_url` names a registered provider host over https. */
export function isRegisteredProviderUrl(baseUrl: string): boolean {
  if (!baseUrl.startsWith("https://")) return false;
  const host = hostOf(baseUrl);
  return host !== undefined && REGISTERED_PROVIDER_HOSTS.includes(host);
}

/**
 * The Zod half of the same rule, for any surface that ACCEPTS a credential row.
 *
 * No such surface exists over HTTP today, and 046 §5 A15 is explicit that this
 * is "an accident of scope, not a decision" — E03-B02/B03/B05 build the writer.
 * The contract is written now so that the writer inherits it instead of
 * re-deriving it: a schema that exists before its route is the cheapest moment
 * to state a rule, and it is exactly 042 §2.2's argument that "the version is
 * not for today's client".
 */
export const credentialRowShape = z
  .object({
    kind: z.enum(["anthropic", "openai_compat", "shopify", "pricecharting", "ebay"]),
    key_ref: z.string().max(200).regex(KEY_REF_PATTERN, "key_ref must be LONGBOX_<SLUG>_<PROVIDER>_KEY"),
    base_url: z
      .string()
      .max(400)
      .refine(isRegisteredProviderUrl, "base_url must be an https URL on a registered provider host")
      .nullable()
      .optional(),
  })
  .strict();

/** The same shape, bound to one shop — the namespace clause a bare schema cannot carry. */
export function credentialRowShapeForShop(slug: string): z.ZodType<z.infer<typeof credentialRowShape>> {
  // Exact membership, matching `resolveKeyRef`. A `startsWith` here would admit
  // the sibling-slug name the resolver refuses, which is two rules wearing one
  // name — the failure mode this whole module exists to avoid.
  return credentialRowShape.refine(
    (row) => legalKeyRefs(slug).includes(row.key_ref),
    `key_ref must be one of this shop's declared names: ${legalKeyRefs(slug).join(", ")}`
  ) as unknown as z.ZodType<z.infer<typeof credentialRowShape>>;
}
