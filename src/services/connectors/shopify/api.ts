// The three acts of the Shopify connector: START an install, COMPLETE one, and
// RECEIVE a signed message from the provider.
//
// Bead: longbox-e5b.3.6 (alias E03-B06). Docs: 000-docs/053 §5–§8; 042 §5.1
// (the exemption class the webhook sits in), §4 (the envelope and the code
// registry), §8.1/§8.2 (rate classes); 048 §7.3 (privileged sessions do not
// exist, so the START is a CLI), R14; 050 §4 (liveness as a predicate); 041 §8
// (an ending is an appended fact and its receipt); 019 T24; CLAUDE.md locked
// decision 3.
//
// ============================================================================
// WHO CAN DO WHAT, AND WHY THE FIRST ACT IS NOT A ROUTE
// ============================================================================
//
// Starting an install is an OWNER act. 048 §7.3 puts owner acts "in a privileged
// session", 048 §12.4 row 3a records that privileged sessions DO NOT EXIST —
// there is no row shape in this schema for a person on their own laptop — and
// E03-D06 and E03-D07 both hit the same wall and answered it the same way: the
// service is real, the role check is real, and it is reached from a CLI rather
// than from a route that called itself privileged while nothing enforced
// privilege. `mintInstallState` follows that precedent exactly, and the
// merchant-facing install ENTRY (Shopify's `app_url` landing for an unlisted
// public app) is DECLARED and NOT REGISTERED in the auth allowlist, with
// E10-B02 named.
//
// The other two acts have no Longbox principal at all and cannot: the caller is
// Shopify, or a merchant's browser mid-redirect. Their authentication is a
// SIGNATURE over their own bytes, which is why `policy.ts` verifies before this
// module touches a table.
import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { serviceDb, withTransaction, type Queryable, type Tx } from "../../../db.js";
import type { ShopRateLimiter } from "../../rateLimit.js";
import {
  introduceTokenVersion,
  nextTokenVersionNo,
  offboardTokenVersion,
  requireConnectorKey,
  type ConnectorKeyring,
  type ConnectorOffboardingReceipt,
  type ProviderRevocationObservation,
} from "./custody.js";
import {
  COMPLIANCE_TOPICS,
  KNOWN_TOPICS,
  SHOPIFY_REQUIRED_SCOPES,
  SHOPIFY_SCOPE_LIST_VERSION,
  TOPIC_APP_UNINSTALLED,
  isShopifyShopDomain,
  parseScopeList,
  scopeSatisfies,
  verifyQueryHmac,
  verifyWebhookHmac,
} from "./policy.js";

/** The connector this module speaks for. A closed set with one member today. */
export const CONNECTOR = "shopify" as const;

/**
 * How long an install state may be redeemed for.
 *
 * ⚠ PROVISIONAL, in 042 §8.4's class. It is not a measurement, is never quoted
 * as a security property at any class (021 B16), and 018 C3's red line applies:
 * it may be LOWERED freely; raising it after seeing a result it would change
 * needs a 006 row saying so. (The direction is inverted from a rate floor
 * deliberately — for a window, SHORTER is the safe move.)
 *
 * The derivation: an owner runs the CLI, walks to a browser, signs in to
 * Shopify, reads a consent screen and approves. Fifteen minutes covers that with
 * room for a password reset; an hour would cover a coffee break and a laptop
 * left unlocked, which is the thing the window exists to bound.
 */
export const PROVISIONAL_INSTALL_STATE_TTL_MS = 15 * 60 * 1000;

/** Bytes of CSPRNG behind the state. 128 bits, the entropy 048 §7.1a requires
 *  where no device binding is available — and here none is, by construction. */
const STATE_BYTES = 16;

export interface ConnectorDeps {
  readonly pool: pg.Pool;
  readonly limiter: ShopRateLimiter;
  /** The app's OAuth client id and secret, from the environment (053 §3.4). */
  readonly app: ShopifyAppCredentials;
  readonly keyring?: ConnectorKeyring;
}

/**
 * The APP's own credentials — one pair for the whole deployment, not per shop.
 *
 * These stay under 050 §3's rule unchanged, and the distinction is the whole of
 * 053 §3.4: the app secret is a value a PERSON obtains from a dashboard and
 * types into SOPS, so it satisfies neither predicate that moved the access token
 * into a column. It is an environment variable, it is never in the database, and
 * `resolveAppCredentials` returns `undefined` rather than a stub when it is
 * absent — because a connector with no secret cannot verify a signature, and a
 * verifier that "degrades" is a verifier that accepts anything.
 */
export interface ShopifyAppCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Where Shopify sends the merchant back. Absolute, https, this deployment's. */
  readonly redirectUri: string;
  readonly apiVersion: string;
}

export const SHOPIFY_APP_ENV = {
  clientId: "SHOPIFY_APP_CLIENT_ID",
  clientSecret: "SHOPIFY_APP_CLIENT_SECRET",
  redirectUri: "SHOPIFY_APP_REDIRECT_URI",
  apiVersion: "SHOPIFY_API_VERSION",
} as const;

/**
 * The app credentials, or `undefined` when this deployment has no connector app.
 *
 * `undefined` is the STUB posture the whole repository already has for an
 * external client with no credentials (`.env.example`, `consumers/index.ts`):
 * the pipeline never blocks on a missing token. What it must NEVER become is a
 * stub SIGNATURE VERIFIER — so every entry point below refuses outright when
 * this returns `undefined`, rather than proceeding with an empty secret. A
 * verifier with no key accepts nothing; it does not accept everything.
 */
export function resolveAppCredentials(
  env: NodeJS.ProcessEnv = process.env
): ShopifyAppCredentials | undefined {
  const clientId = env[SHOPIFY_APP_ENV.clientId];
  const clientSecret = env[SHOPIFY_APP_ENV.clientSecret];
  const redirectUri = env[SHOPIFY_APP_ENV.redirectUri];
  if (!clientId || !clientSecret || !redirectUri) return undefined;
  return {
    clientId,
    clientSecret,
    redirectUri,
    apiVersion: env[SHOPIFY_APP_ENV.apiVersion] ?? "2025-07",
  };
}

/**
 * Why an install act was refused.
 *
 * ⚠ **ONE code reaches the wire and these do not.** 048 §9.3's constant answer
 * applies with full force: a caller who can tell `unknown_state` from
 * `state_expired` from `domain_mismatch` has an oracle over which states exist,
 * and one who can tell `bad_signature` from `scope_excessive` learns whether the
 * forged signature was the thing that failed. The distinction is for the
 * SERVER's own reasoning and for this module's tests; the handler maps every
 * member but `rate_limited` to one registry code.
 */
export type CallbackRefusal =
  | "app_not_configured"
  | "bad_domain"
  | "bad_signature"
  | "unknown_state"
  | "state_expired"
  | "state_replayed"
  | "domain_mismatch"
  // E03-B04 (security lens F8): a store already carrying another shop's live
  // token. A separate member from `domain_mismatch`, which is about the state row
  // rather than about the estate — the handler maps both to one registry code, and
  // the distinction is for this server's own reasoning.
  //
  // **E03-D22 gives this member a SECOND raise site, and the second is the
  // guarantee.** The first is the fast-path `SELECT` above, which refuses before
  // the code is exchanged and can be raced; the second is a `23505` on
  // `shop_shopify_domain_is_one_store` inside the install's own transaction,
  // which cannot be. They are ONE member deliberately: a caller must not be able
  // to tell a store claimed a second ago from one claimed a month ago, and this
  // server's own reasoning about which fired is in its log, not on the wire.
  | "domain_claimed"
  // E03-D22 (the security lens's F4): the claim's `UPDATE` matched NO row.
  //
  // A SEPARATE member from `domain_claimed` even though both answer the same
  // wire code, because they mean opposite things about this server. A claim
  // conflict is the mechanism WORKING — somebody else holds the store. A claim
  // that matched nothing means the transaction's tenant context does not name a
  // shop that exists, which is a BROKEN SERVER and should page, not a merchant
  // who lost a race. Collapsing them would bury the second inside the first's
  // volume, which is exactly how an operational alarm becomes noise.
  | "claim_unreachable"
  | "scope_insufficient"
  | "scope_excessive"
  | "rate_limited"
  | "exchange_failed";

export class ConnectorCallbackError extends Error {
  readonly refusal: CallbackRefusal;
  constructor(refusal: CallbackRefusal, message: string) {
    super(message);
    this.name = "ConnectorCallbackError";
    this.refusal = refusal;
  }
}

/** `sha256(state)`, hex. The only form the state takes in this schema. */
export function stateDigest(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Act one — START an install. Reached from `scripts/connector-install.ts`.
// ---------------------------------------------------------------------------

export interface MintedInstall {
  /** Shown ONCE, to the operator running the CLI. It reaches no log and no row. */
  readonly authorizeUrl: string;
  readonly stateId: string;
  readonly expiresAt: Date;
  readonly requestedScopes: readonly string[];
  readonly scopeListVersion: number;
}

/**
 * Mint an install state and build the authorization URL.
 *
 * The URL carries the state in the clear because that is what a `state`
 * parameter IS — a value the client round-trips. What is never in the clear is
 * the row: `state_digest` holds `sha256(state)` and nothing else, so a database
 * reader cannot mint a callback that this server would accept.
 *
 * `offline` access mode is requested explicitly. An ONLINE token is bound to the
 * merchant user and expires with their session, which would make the outbox
 * worker's draft — an act that happens minutes or hours after anybody was
 * looking at a browser — fail whenever the merchant had signed out. 043's whole
 * job model assumes the authority outlives the request that created it.
 */
export async function mintInstallState(
  db: Queryable,
  args: { shopId: string; shopDomain: string; app: ShopifyAppCredentials; now?: Date }
): Promise<MintedInstall> {
  if (!isShopifyShopDomain(args.shopDomain)) {
    throw new ConnectorCallbackError(
      "bad_domain",
      `'${args.shopDomain}' is not a myshopify.com store domain. The domain is checked before it ` +
        `reaches a URL, a query or a column, because the next thing an install does with it is ` +
        `POST this app's client secret to it (000-docs/053 §8.1).`
    );
  }
  // ⚠ **REFUSE AT MINT TIME IF ANOTHER SHOP ALREADY HOLDS THIS STORE (E03-D22,
  // the security lens's F6). IT IS AN EARLY REFUSAL AND NOT A CONTROL.**
  //
  // The claim in `completeInstall` is the guarantee; this is a courtesy one act
  // earlier. Without it the owner is sent to Shopify, approves a consent screen,
  // and the callback refuses AFTER the authorization code has been exchanged —
  // so the merchant burns a single-use code to learn something this system
  // already knew when the CLI was run.
  //
  // **It runs on the caller's connection, which for this act is the SCHEMA
  // OWNER** (`pnpm connector-install` uses `resolveMigrateUrl`), so it can see
  // every shop's row — and for the schema owner the index was never an oracle
  // anyway, because the owner can read those rows directly (056 §6.3). That is
  // precisely why this check may live here and NOT in `completeInstall`, whose
  // transaction runs under a tenant context that would hide the rows and make
  // the guard FAIL OPEN (056 §6.1).
  //
  // **A caller with a tenant context sees nothing here and is refused nothing**,
  // which is correct: the refusal that matters is the claim, and this one is
  // allowed to be silently unhelpful rather than silently wrong.
  const heldElsewhere = await db.query(`SELECT 1 FROM shop WHERE shopify_domain = $1 AND id <> $2 LIMIT 1`, [
    args.shopDomain,
    args.shopId,
  ]);
  if (heldElsewhere.rows.length > 0) {
    throw new ConnectorCallbackError(
      "domain_claimed",
      "that store is already recorded against a different shop; nothing was written"
    );
  }

  const state = randomBytes(STATE_BYTES).toString("base64url");
  const expiresAt = new Date((args.now?.getTime() ?? Date.now()) + PROVISIONAL_INSTALL_STATE_TTL_MS);
  const res = await db.query(
    `INSERT INTO connector_install_state
       (shop_id, connector, shop_domain, state_digest, requested_scopes, expires_at, authored_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'human') RETURNING id`,
    [args.shopId, CONNECTOR, args.shopDomain, stateDigest(state), [...SHOPIFY_REQUIRED_SCOPES], expiresAt]
  );
  const stateId = (res.rows[0] as { id: string }).id;

  const url = new URL(`https://${args.shopDomain}/admin/oauth/authorize`);
  url.searchParams.set("client_id", args.app.clientId);
  url.searchParams.set("scope", SHOPIFY_REQUIRED_SCOPES.join(","));
  url.searchParams.set("redirect_uri", args.app.redirectUri);
  url.searchParams.set("state", state);
  // OFFLINE, which Shopify expresses as the ABSENCE of `grant_options[]=per-user`.
  // Written as a comment rather than as an empty parameter, because an empty
  // parameter is a thing somebody later tidies away without knowing what it
  // stood for — and what it stands for is the paragraph above.

  return {
    authorizeUrl: url.toString(),
    stateId,
    expiresAt,
    requestedScopes: SHOPIFY_REQUIRED_SCOPES,
    scopeListVersion: SHOPIFY_SCOPE_LIST_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Act two — COMPLETE an install. Reached from `GET …/connectors/shopify/callback`.
// ---------------------------------------------------------------------------

export interface CallbackResult {
  readonly connector: typeof CONNECTOR;
  readonly shop_domain: string;
  readonly granted_scopes: readonly string[];
}

/** The token exchange, injectable so the whole flow tests without a network. */
export type TokenExchange = (args: {
  shopDomain: string;
  code: string;
  app: ShopifyAppCredentials;
}) => Promise<{ accessToken: string; scope: string }>;

/**
 * The real exchange: POST the authorization code to the store's own token
 * endpoint and receive the offline access token.
 *
 * `shopDomain` has ALREADY been checked by `isShopifyShopDomain` before this
 * function is reachable, and is checked again here rather than trusted, because
 * this is the one line in the repository that sends the app's client secret
 * somewhere a request parameter chose (053 §8.1). A check that exists twice on
 * the path that carries the secret is not redundancy worth removing.
 */
export const exchangeCodeForToken: TokenExchange = async ({ shopDomain, code, app }) => {
  if (!isShopifyShopDomain(shopDomain)) {
    throw new ConnectorCallbackError("bad_domain", "refusing to send the client secret off-domain");
  }
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, code }),
  });
  if (!res.ok) {
    // The status and NOTHING ELSE. A provider's error body on this endpoint can
    // echo request fields, and the request field here is the client secret.
    throw new ConnectorCallbackError(
      "exchange_failed",
      `Shopify refused the authorization code exchange with status ${String(res.status)}`
    );
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; scope?: unknown };
  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new ConnectorCallbackError("exchange_failed", "Shopify returned no access token");
  }
  return {
    accessToken: body.access_token,
    scope: typeof body.scope === "string" ? body.scope : "",
  };
};

// ---------------------------------------------------------------------------
// 053 §7.3a (v1.0.1, the security lens's S2) — the provider-side revoke.
// ---------------------------------------------------------------------------

/**
 * Ask Shopify to end this app's own installation, using the token itself.
 *
 * ⚠ **THIS EXISTS BECAUSE A RECEIPT WAS SAYING SOMETHING THIS RECORD HAD NOT
 * CHECKED.** `RETIREMENT_MEANING.revocation` used to read *"only the merchant can
 * end it there, by uninstalling the app"* — 050's true sentence about a BYOK key,
 * transplanted onto a credential it does not describe. An app holding an offline
 * token can call Shopify's own app-uninstall endpoint WITH THAT TOKEN, so the
 * old sentence was a claim about somebody else's system stated in the one
 * artifact 041 §8.2 forbids untrue statements in.
 *
 * ⚠ **THE ENDPOINT'S EXISTENCE AT THE PINNED API VERSION IS AN ASSUMPTION SIGNED
 * OPEN, in 043 A11's idiom, and it is NOT presented as REPRODUCED.** No call to
 * Shopify's documentation or to a store was made while writing this: 018's rung
 * rules mean an unverified third-party interface is an assumption, not a fact.
 * **What is NOT contingent on it** is everything this function's absence would
 * otherwise have hidden: the two `connector_token_retirement` columns record what
 * was CALLED and what came BACK, the receipt renders the four outcomes including
 * "no attempt", and a 404 or a 405 is reported honestly as *"treat the token as
 * still usable at Shopify"*. So a wrong guess about the endpoint degrades to a
 * truthful receipt rather than to a false one.
 *
 * **Its closing evidence is the same as 043 A11's**: one call against the
 * ISOLATED DEV STORE named in `.env.example`, before this path serves a real
 * shop. `tests/integration/connector-oauth.test.ts` drives the seam with an
 * injected fake and asserts what is recorded; it cannot and does not assert what
 * Shopify does.
 *
 * **It returns an OBSERVATION and never throws for a status.** A revocation that
 * failed at the provider must still produce a retirement — this system stopping
 * is not contingent on the provider agreeing — so the caller records what
 * happened and ends the token either way.
 */
export type ProviderRevoke = (args: {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}) => Promise<ProviderRevocationObservation>;

export const revokeAtProvider: ProviderRevoke = async ({ shopDomain, accessToken, apiVersion }) => {
  const attemptedAt = new Date();
  if (!isShopifyShopDomain(shopDomain)) {
    // Checked here as well as at every other outbound site, and for the same
    // reason: this call carries a live access token to whatever host it names.
    return { attemptedAt, httpStatus: null };
  }
  try {
    const res = await fetch(`https://${shopDomain}/admin/api/${apiVersion}/api_permissions/current.json`, {
      method: "DELETE",
      headers: { "x-shopify-access-token": accessToken, accept: "application/json" },
    });
    // The STATUS and nothing else. The body of this endpoint is not read at all:
    // there is nothing in it this system may treat as a fact, and reading it is
    // one refactor away from quoting it in a receipt.
    return { attemptedAt, httpStatus: res.status };
  } catch {
    // A transport failure is NOT a status. `null` says "the call did not
    // complete", which is a different thing from an error the provider returned,
    // and the receipt renders the two differently.
    return { attemptedAt, httpStatus: null };
  }
};

interface StateRow {
  id: string;
  shop_id: string;
  shop_domain: string;
  requested_scopes: string[];
  expires_at: Date | string;
  spent: boolean;
}

/**
 * The partial unique index that makes ONE STORE belong to at most ONE SHOP.
 *
 * `UNIQUE (shopify_domain) WHERE shopify_domain IS NOT NULL`, from
 * `migrations/026`. It is named here because the refusal it raises has to be
 * recognised by name: a `23505` from any other constraint in this transaction
 * means something else entirely and must not be dressed up as a claim conflict.
 */
export const STORE_CLAIM_INDEX = "shop_shopify_domain_is_one_store";

/**
 * The UNIQUE that makes an install state single-use — 053 §5.2's "whole
 * mechanism". Named for {@link STORE_CLAIM_INDEX}'s reason: the refusal it
 * raises has to be recognised by name rather than by message.
 */
export const STATE_USE_INDEX = "connector_install_state_use_state_idx";

/** A `23505` raised by {@link STATE_USE_INDEX} and by nothing else. */
export function isStateUseConflict(err: unknown): boolean {
  const e = err as { code?: unknown; constraint?: unknown } | null;
  return e?.code === "23505" && e.constraint === STATE_USE_INDEX;
}

/** A `23505` raised by {@link STORE_CLAIM_INDEX} and by nothing else. */
export function isStoreClaimConflict(err: unknown): boolean {
  const e = err as { code?: unknown; constraint?: unknown } | null;
  return e?.code === "23505" && e.constraint === STORE_CLAIM_INDEX;
}

/**
 * CLAIM the store on the shop's own row — E03-D22, closing 056 §11 R10 and the
 * latent one-bit oracle §6.3 named.
 *
 * ============================================================================
 * WHY THE CLAIM IS THE GUARANTEE AND THE READ ABOVE IS NOT
 * ============================================================================
 *
 * 053 §7.3 makes an `app/uninstalled` retire EVERY live token granted for a
 * store, whichever Longbox shop holds it. So two shops holding live tokens for
 * one store is a state in which one merchant's uninstall ends ANOTHER shop's
 * authority. E03-B04 refused that with a `SELECT` (F8) — but that read runs
 * outside the transaction that introduces the token, and it cannot be moved
 * inside it, because inside it the tenant context hides the very rows it is
 * looking for and the guard would fail OPEN (056 §6.1).
 *
 * **A unique index is checked with row-level security OFF, against every row in
 * the table, including rows this caller cannot read.** That is exactly the
 * property 056 §6.3 recorded as a DEFECT — an oracle — and it is exactly the
 * property this needs. `shop.shopify_domain` already carries the index; nothing
 * wrote the column; so one `UPDATE` turns two concurrent callbacks into one
 * winner and one `23505` that the DATABASE decides, under no isolation
 * assumption at all (041 §4.2(i): a constraint is the cheapest correct answer).
 *
 * **The oracle §6.3 named is not created by this; it is BOUNDED by it, and the
 * bound is worth stating.** Before E03-D22 the column had no writer, so the
 * oracle was unreachable. After it there is exactly one writer, and reaching it
 * costs a completed OAuth grant: the caller must hold real merchant consent at
 * the store it is asking about, minted through an install state an owner asked
 * this system for. So the one bit a caller can learn is *"is MY store already a
 * Longbox customer"* — about a store they administer — and never a probe over
 * stores at large. The route cannot be turned into a scanner, because every
 * probe needs a fresh state row and a real grant at the store being probed.
 *
 * **The RLS geometry, stated rather than assumed.** `shop` is policied on its
 * own `id` (056 §4, `TENANT_COLUMNS`), so under this transaction's tenant
 * context the statement can only ever touch THIS shop's row: `USING` and
 * `WITH CHECK` are the same predicate and the row is the tenant. Nothing here
 * widens a policy, and in particular nothing adds a `service_write` on
 * `connector_token_version` — which is the widening 056 R10 rejected as the
 * alternative fix (the security lens's F1).
 *
 * **An `UPDATE` that matches no row SUCCEEDS (056 §6.2), so the row count IS
 * the authorization.** A shop id that names no visible row would silently write
 * nothing and let the install proceed unclaimed; the check below is that rule
 * applied, not defensive noise.
 *
 * **It overwrites a different store, deliberately.** A shop whose column names
 * store Y and whose owner has just completed a grant at store X is a shop that
 * asked for X: `mintInstallState` recorded the domain at issuance and the
 * callback proved the same domain against it twice. Refusing here would strand
 * a shop on a store it no longer sells into, recoverable only by a schema-owner
 * `UPDATE`.
 *
 * **The claim is NOT released by an uninstall, and that is a ruling** (000-docs/
 * 061 §4): the column says which store this shop sells into, which a third
 * party's act at Shopify does not stop being true.
 *
 * It is deliberately NOT exported, on `retireEveryLiveTokenForDomain`'s
 * precedent: it is correct only inside `completeInstall`'s transaction, under
 * the tenant context of the shop the install state named. Reached from anywhere
 * else it is an unguarded write to another tenant's configuration.
 */
async function claimStoreDomain(tx: Tx, shopId: string, shopDomain: string): Promise<void> {
  const res = await tx.query(`UPDATE shop SET shopify_domain = $1 WHERE id = $2`, [shopDomain, shopId]);
  if (res.rowCount !== 1) {
    // 056 §6.2 — the statement matched nothing and raised nothing. Under this
    // transaction's own tenant context that is unreachable; asserting it is what
    // keeps it unreachable when somebody changes the context this runs under.
    //
    // ⚠ **`claim_unreachable`, NOT `domain_claimed`** (the security lens's F4).
    // The merchant gets the same wire code either way, but this server must not
    // record a broken tenant context as a lost race: one is a shop that exists
    // and lost, the other is a shop id that resolves to no visible row, and the
    // second is an operational alarm hiding inside the first's volume.
    throw new ConnectorCallbackError(
      "claim_unreachable",
      "the install shop could not claim that store: the claim matched no row"
    );
  }
}

/**
 * Complete the install: verify, spend the state, introduce the token version.
 *
 * THE ORDER IS THE SECURITY PROPERTY, and it is the same argument the
 * authentication hook makes about its own five steps — the cheapest refusal
 * comes first, and nothing touches a table until the caller has proved it is
 * Shopify:
 *
 *   1. the app is configured at all (no secret, no verifier, no install);
 *   2. `shop` is a myshopify domain — BEFORE it is used for anything;
 *   3. the query HMAC verifies, timing-safe — **and this happens before any
 *      database read at all**, so an unsigned callback costs one HMAC and
 *      touches no row;
 *   4. the state resolves, is unspent and is unexpired;
 *   5. the state's store equals the callback's store;
 *   6. the code is exchanged (the one network call);
 *   7. the granted scopes are exactly what was asked for;
 *   8. **the store is CLAIMED on the shop's own row**, the token version is
 *      introduced and the state's use row is written — all in ONE transaction,
 *      with two unique indexes deciding two different concurrent races.
 *
 * Step 8 is where BOTH races are settled by the database rather than by a read:
 *
 *   * **two callbacks with the same STATE** — both pass step 4, and
 *     `UNIQUE (state_id)` lets only one insert the use row;
 *   * **two callbacks for the same STORE at two different shops** (E03-D22,
 *     056 §11 R10) — both pass the F8 fast path, and
 *     `shop_shopify_domain_is_one_store` lets only one claim the domain.
 *
 * The loser of either rolls back whole, so it introduces no token version
 * either — which is why all three writes are one transaction and not three, and
 * why the claim is the FIRST of them.
 */
export async function completeInstall(
  deps: ConnectorDeps,
  query: Readonly<Record<string, string | string[] | undefined>>,
  exchange: TokenExchange = exchangeCodeForToken,
  now: Date = new Date()
): Promise<CallbackResult> {
  const app = deps.app;
  if (!app.clientSecret) {
    throw new ConnectorCallbackError("app_not_configured", "no connector app is configured");
  }
  const shopDomain = typeof query["shop"] === "string" ? query["shop"] : "";
  if (!isShopifyShopDomain(shopDomain)) {
    throw new ConnectorCallbackError("bad_domain", "the shop parameter is not a myshopify domain");
  }
  if (!verifyQueryHmac(query, app.clientSecret)) {
    throw new ConnectorCallbackError("bad_signature", "the callback signature did not verify");
  }
  const state = typeof query["state"] === "string" ? query["state"] : "";
  const code = typeof query["code"] === "string" ? query["code"] : "";
  if (state.length === 0 || code.length === 0) {
    throw new ConnectorCallbackError("unknown_state", "the callback carried no state or no code");
  }

  // PRE-TENANT, AND DECLARED AS SUCH (E03-B04). The callback names its shop only
  // through `state_digest`, so the row this finds IS the tenant — the same shape
  // as a session cookie's lookup (048 §6.1) and the same answer: a declared
  // service scope, rather than a table left outside the boundary.
  const found = await serviceDb(deps.pool, "connector-inbound").query(
    `SELECT s.id, s.shop_id, s.shop_domain, s.requested_scopes, s.expires_at,
            (u.id IS NOT NULL) AS spent
       FROM connector_install_state s
       LEFT JOIN connector_install_state_use u ON u.state_id = s.id
      WHERE s.state_digest = $1 AND s.connector = $2`,
    [stateDigest(state), CONNECTOR]
  );
  const row = found.rows[0] as StateRow | undefined;
  if (!row) throw new ConnectorCallbackError("unknown_state", "no install state matches");
  if (row.spent) throw new ConnectorCallbackError("state_replayed", "that install state is spent");
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    throw new ConnectorCallbackError("state_expired", "that install state has expired");
  }
  if (row.shop_domain !== shopDomain) {
    // A state minted for one store, redeemed against another. The comparison is
    // the reason `shop_domain` is on the state row at all.
    throw new ConnectorCallbackError("domain_mismatch", "the install state names a different store");
  }

  // The rate bucket, keyed on the SHOP THE STATE NAMES (048 R14's shape for a
  // sessionless route). Taken here and not in the hook because the shop is
  // unknown until the state is resolved, and taken AFTER the signature check so
  // an unsigned flood is refused more cheaply than a signed one.
  const decision = deps.limiter.takeOrdinary(row.shop_id);
  if (!decision.allowed) {
    throw new ConnectorCallbackError("rate_limited", "too many install callbacks for this shop");
  }

  const exchanged = await exchange({ shopDomain, code, app });
  const granted = parseScopeList(exchanged.scope);
  const verdict = scopeSatisfies(granted, row.requested_scopes);
  if (!verdict.ok) {
    throw new ConnectorCallbackError(
      verdict.reason === "insufficient" ? "scope_insufficient" : "scope_excessive",
      verdict.reason === "insufficient"
        ? `the grant is missing ${verdict.missing.join(", ")}`
        : `the grant carries ${verdict.surplus.join(", ")}, which this app never asked for`
    );
  }

  // ⚠ **A STORE BELONGS TO AT MOST ONE SHOP, AND THIS IS WHERE THAT IS DECIDED**
  // (security lens F8). `shop_domain` carried no constraint across tenants, so a
  // second shop could install the same store — and then an `app/uninstalled` for
  // that store, which retires EVERY live token granted for it (053 §7.3), would
  // end the FIRST shop's authority as a side effect of the second's install. A
  // unique index cannot express it: a rotation legitimately leaves two live
  // versions for one shop (050 §2 Q2), so the constraint is "at most one SHOP",
  // not "at most one row". It is refused here rather than at the index, in the one
  // place a new authority is created, and the read runs in the same inbound scope
  // that found the state.
  //
  // ⚠ **THIS READ IS A FAST PATH SINCE E03-D22, AND IT IS NO LONGER THE
  // GUARANTEE** (056 §11 R10). It runs OUTSIDE the transaction that introduces
  // the token version, so two callbacks for one store can both pass it — the
  // window is small and no network call falls inside it, but it is a real
  // time-of-check-to-time-of-use gap, and the failure it admits is the one this
  // check exists to prevent. It cannot be moved INTO that transaction and stay
  // correct: the transaction runs under a TENANT context, under which another
  // shop's `connector_token_version` rows are invisible, so the query would
  // return zero rows every time and FAIL OPEN (056 §6.1's trap, one layer over).
  //
  // What closes the race is `claimStoreDomain` below — a serialisation point the
  // database already owns. This read is kept for two reasons that are worth the
  // round trip and are NOT the guarantee: it refuses BEFORE the authorization
  // code is exchanged, so the common case costs the merchant no spent code; and
  // it is the only place that can say WHY in this server's own log, since the
  // claim's refusal arrives as a `23505` on an index.
  const claimed = await serviceDb(deps.pool, "connector-inbound").query(
    `SELECT DISTINCT v.shop_id FROM connector_token_version v
      WHERE v.connector = $1 AND v.shop_domain = $2 AND v.shop_id <> $3
        AND NOT EXISTS (SELECT 1 FROM connector_token_retirement r
                         WHERE r.connector_token_version_id = v.id)`,
    [CONNECTOR, shopDomain, row.shop_id]
  );
  if (claimed.rows.length > 0) {
    throw new ConnectorCallbackError(
      "domain_claimed",
      "another shop already holds a live connector token for that store; uninstall it there first"
    );
  }

  const ring = deps.keyring ?? requireConnectorKey();
  // The tenant is KNOWN from here: the state row named it. So the token version
  // and the use row commit under an ordinary tenant context rather than under the
  // scope that found them.
  try {
    await withTransaction(
      deps.pool,
      async (tx: Tx) => {
        // THE CLAIM, FIRST — before the version, before the use row (E03-D22).
        // It is the transaction's serialisation point and it is also its
        // cheapest refusal: a loser rolls back having written no ciphertext.
        await claimStoreDomain(tx, row.shop_id, shopDomain);
        const versionNo = await nextTokenVersionNo(tx, row.shop_id, CONNECTOR);
        const versionId = await introduceTokenVersion(tx, ring, {
          shopId: row.shop_id,
          connector: CONNECTOR,
          shopDomain,
          installStateId: row.id,
          grantedScopes: granted,
          accessToken: exchanged.accessToken,
          versionNo,
        });
        // `UNIQUE (state_id)` decides the replay race here, inside the same
        // transaction as the version it names — so a loser writes neither.
        await tx.query(
          `INSERT INTO connector_install_state_use
             (shop_id, state_id, connector_token_version_id) VALUES ($1, $2, $3)`,
          [row.shop_id, row.id, versionId]
        );
      },
      { label: "connector-install", tenant: { shopId: row.shop_id } }
    );
  } catch (err) {
    // ⚠ **THE `23505` ON THIS INDEX IS THE RACE BEING SETTLED, AND IT IS THE
    // ONLY PLACE THE ONE-SHOP RULE IS ACTUALLY GUARANTEED** (E03-D22).
    //
    // It is mapped to the SAME refusal member the fast path raises, and both
    // reach the wire as the SAME registry code as every other callback refusal
    // (`CONNECTOR_CALLBACK_REFUSED`, `src/routes/connectors.ts`) — so a merchant
    // completing OAuth for a store another Longbox shop holds is answered
    // IDENTICALLY IN BYTES to one presenting an unknown state. Which shop holds
    // the store is never named, here or on the wire.
    //
    // ⚠ The word is "identical in bytes" and not "byte-identical to every other
    // refusal", because the pre-exchange refusals (bad signature, unknown state)
    // and the post-exchange ones (scope, claim) differ by ONE OUTBOUND CALL to
    // Shopify's token endpoint, which is observable to anyone watching this
    // server's egress. That distinction is UNREACHABLE WITHOUT A VALID HMAC — a
    // caller who cannot sign never passes step 3 — so it discloses nothing to the
    // population the constant answer exists to defend against (000-docs/061 §3.3).
    if (isStoreClaimConflict(err)) {
      throw new ConnectorCallbackError(
        "domain_claimed",
        "another shop already holds that store; nothing was written"
      );
    }
    // ⚠ **THE SIBLING UNIQUE, AND IT WAS ANSWERING 500** (the security lens's
    // F8). `UNIQUE (state_id)` on `connector_install_state_use` is what settles
    // the REPLAY race — 053 §5.2 calls it "the whole mechanism" — and it is
    // reached inside this transaction exactly when two callbacks present the
    // same state and only one may spend it. Before E03-D22 that raise had no
    // handler, so the one refusal the schema is proudest of arrived as an
    // unhandled `23505`: a 500 with a stack, where every other refusal on this
    // route is one 4xx code. It is the same fact step 4's read already names, so
    // it takes step 4's member.
    if (isStateUseConflict(err)) {
      throw new ConnectorCallbackError("state_replayed", "that install state is spent");
    }
    throw err;
  }

  return { connector: CONNECTOR, shop_domain: shopDomain, granted_scopes: granted };
}

// ---------------------------------------------------------------------------
// Act three — RECEIVE a signed message. Reached from
// `POST …/connectors/shopify/webhooks`.
// ---------------------------------------------------------------------------

export interface WebhookHeaders {
  readonly topic: string | undefined;
  readonly hmac: string | undefined;
  readonly shopDomain: string | undefined;
  readonly webhookId: string | undefined;
  readonly apiVersion: string | undefined;
}

export class WebhookRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookRefusedError";
  }
}

/**
 * A SEPARATE error from `WebhookRefusedError`, and the separation is on the
 * wire rather than only in this file.
 *
 * A refusal is 401 and a throttle is 429, and Shopify's delivery system treats
 * them completely differently: it retries a 429 with backoff and it does not
 * retry a 401. Collapsing the two would mean a shop that tripped a provisional
 * floor lost the message permanently — including, on the worst day, a
 * `customers/redact`.
 */
export class WebhookRateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookRateLimitedError";
  }
}

export interface WebhookOutcome {
  readonly acknowledged: true;
  /** True when this exact message had already been recorded (Shopify retries). */
  readonly duplicate: boolean;
  readonly receiptId: string;
  readonly topic: string;
  /** Receipts for every token this message ended. Empty for every other topic. */
  readonly retired: readonly ConnectorOffboardingReceipt[];
}

/**
 * Receive one webhook: authenticate, record, then act.
 *
 * **AUTHENTICATE BEFORE ANY DATABASE WRITE, ALWAYS.** The HMAC is computed over
 * the raw body with the app secret and compared in constant time, and it happens
 * before a single row is read or written — so a forged message costs one HMAC
 * and leaves no trace in any table. That ordering is the whole of 046 §5 A13's
 * mitigation, and it is asserted rather than described (`tests/integration/
 * connector-oauth.test.ts` counts rows after a bad-signature POST).
 *
 * **RECORD BEFORE ACTING, and dedupe on Shopify's own id.** Shopify's delivery
 * is at-least-once by design; a redelivered `app/uninstalled` must be a no-op
 * rather than a second retirement (which `UNIQUE (connector_token_version_id)`
 * would refuse anyway, but as a 500 rather than as a 200). So the receipt goes
 * in first, `UNIQUE (connector, webhook_id)` decides the duplicate, and the
 * effect runs only for the insert that won — all in ONE transaction, so a
 * crash between the receipt and the effect replays both.
 *
 * **AN UNKNOWN TOPIC IS RECORDED AND DOES NOTHING.** It is not an error: a
 * CHECK-constrained topic list would turn an authentic message this build has
 * not heard of into a 500 and a retry storm, which is how an app gets its
 * webhooks disabled by the provider.
 */
export async function receiveWebhook(
  deps: ConnectorDeps,
  headers: WebhookHeaders,
  rawBody: Buffer
): Promise<WebhookOutcome> {
  if (!deps.app.clientSecret) {
    throw new WebhookRefusedError("no connector app is configured, so no signature can be verified");
  }
  if (!verifyWebhookHmac(rawBody, headers.hmac, deps.app.clientSecret)) {
    throw new WebhookRefusedError("the webhook signature did not verify");
  }
  const topic = headers.topic ?? "";
  const shopDomain = headers.shopDomain ?? "";
  const webhookId = headers.webhookId ?? "";
  if (topic.length === 0 || webhookId.length === 0 || !isShopifyShopDomain(shopDomain)) {
    // Authentic but unusable. Refused rather than recorded under invented
    // values: a receipt whose `webhook_id` this server made up is a dedupe key
    // that dedupes nothing.
    throw new WebhookRefusedError("the webhook is signed but carries no usable topic, id or shop");
  }

  const digest = createHash("sha256").update(rawBody).digest("hex");

  // The tenant resolution, and then the bucket keyed on it (048 R14).
  //
  // ⚠ BOTH HAPPEN AFTER THE HMAC AND NEITHER COULD HAPPEN BEFORE IT. The store
  // is in `X-Shopify-Shop-Domain`, which the hook could read — and keying a
  // counter on an unverified header would let an unauthenticated caller choose
  // which shop's budget to exhaust. So the aggregate route bucket is the hook's
  // (it needs no tenant), and this one is taken here, on a domain a signature
  // has vouched for. A shop this system does not know gets no per-shop bucket
  // and is bounded by the route's, which is the honest answer: there is no
  // counter to key on.
  // ⚠ THE TENANT COMES FROM THE INSTALL'S OWN ROWS, NOT FROM `shop.shopify_domain`
  // — AND THE FIRST VERSION GOT THIS WRONG IN A WAY THAT MADE THE UNINSTALL PATH
  // DEAD CODE (the invariant review of `16f17ef`, findings 1 and 2).
  //
  // It read `SELECT id FROM shop WHERE shopify_domain = $1`. **Nothing sets that
  // column**: it is nullable, `register-shop` writes NULL, and
  // `connector-install` never compares its `--domain` to it. So on a shop
  // registered the ordinary way, a validly signed `app/uninstalled` resolved NO
  // shop, retired ZERO tokens and wrote a receipt with a null tenant — and the
  // `all_retired` refusal in `src/consumers/index.ts`, the half that makes an
  // ending mean something, was unreachable on that path. **A control that cannot
  // be reached is not a control**, and the only reason the suite passed was that
  // its own setup wrote the column.
  //
  // It was also a 019 T24 exposure on its own: `shop.shopify_domain` carries no
  // UNIQUE, and the query took `rows[0]` with no `ORDER BY`, so two shops sharing
  // a domain would have retired an ARBITRARY one's tokens. `026` now carries a
  // partial unique index so that shape is unrepresentable, and this path no
  // longer depends on it either way.
  //
  // **The right key is the one the install itself wrote.** A token version
  // records the `shop_domain` it was granted for, so the store in the signed
  // header is matched against THAT — the value this system obtained through an
  // authenticated grant, not a config field somebody may or may not have filled
  // in. The receipt's `shop_id` is set only when the matching versions belong to
  // exactly ONE shop; otherwise it stays NULL, which is what §5.5 made the column
  // nullable for. `shop.shopify_domain` survives for the LEGACY static path and
  // is read there by shop id, never as a lookup key.
  // PRE-TENANT for the scope's second reason: a webhook identifies its store by a
  // DOMAIN, and which shop that is — if any — is what this query answers.
  const installed = await serviceDb(deps.pool, "connector-inbound").query(
    `SELECT DISTINCT v.shop_id
       FROM connector_token_version v
      WHERE v.connector = $1 AND v.shop_domain = $2`,
    [CONNECTOR, shopDomain]
  );
  const shopIds = (installed.rows as Array<{ shop_id: string }>).map((r) => r.shop_id);
  // Exactly one, or none. Two shops holding tokens for one store is a state this
  // system should never be in, and naming an arbitrary one of them on the
  // receipt would be the T24 defect wearing a different query.
  const shopId = shopIds.length === 1 ? shopIds[0]! : null;
  if (shopId !== null && !deps.limiter.takeOrdinary(shopId).allowed) {
    throw new WebhookRateLimitedError("too many webhooks for this shop");
  }

  // STILL the inbound scope, and here it is load-bearing rather than tidy: a
  // webhook that matches no install writes a receipt with a NULL `shop_id`
  // (053 §5.5), and a NULL matches no tenant policy — so this transaction cannot
  // be a tenant one even when `shopId` happens to be known.
  return withTransaction(
    deps.pool,
    async (tx: Tx) => {
      // ON CONFLICT DO NOTHING, then read back: the insert IS the duplicate
      // check (041 §4.2(i)'s constraint-over-lock preference), and a returned
      // row means this delivery is the first.
      const inserted = await tx.query(
        `INSERT INTO connector_webhook_receipt
           (shop_id, connector, topic, webhook_id, shop_domain, api_version, payload_digest, payload_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (connector, webhook_id) DO NOTHING
         RETURNING id`,
        [shopId, CONNECTOR, topic, webhookId, shopDomain, headers.apiVersion ?? null, digest, rawBody.length]
      );
      const first = inserted.rows[0] as { id: string } | undefined;
      if (!first) {
        const existing = await tx.query(
          `SELECT id FROM connector_webhook_receipt WHERE connector = $1 AND webhook_id = $2`,
          [CONNECTOR, webhookId]
        );
        return {
          acknowledged: true as const,
          duplicate: true,
          receiptId: (existing.rows[0] as { id: string }).id,
          topic,
          retired: [],
        };
      }

      // Keyed on the SIGNED DOMAIN and not on the resolved shop: the uninstall
      // killed the token at Shopify for that STORE, so every live version
      // granted for it ends, whichever Longbox shop happens to hold it. That is
      // also why this still runs when `shopId` is null — an ambiguous or absent
      // tenant must not leave a live token behind.
      const retired =
        topic === TOPIC_APP_UNINSTALLED ? await retireEveryLiveTokenForDomain(tx, shopDomain, first.id) : [];

      return { acknowledged: true as const, duplicate: false, receiptId: first.id, topic, retired };
    },
    { label: "connector-webhook", tenant: { service: "connector-inbound" } }
  );
}

/**
 * 053 §7.3 — an uninstall ends EVERY live token GRANTED FOR THAT STORE, not just
 * the newest, and not only one shop's.
 *
 * **Every one**, because an overlap window is legal (050 §2 Q2 permits two live
 * versions while a rotation is proven) and an uninstall kills all of them at
 * Shopify simultaneously. Retiring only the newest would leave a version this
 * system believes is usable and Shopify has already invalidated, which is the
 * precise shape of the failure 050 §5(a) inverts the ordering to avoid.
 *
 * **Keyed on the DOMAIN and not on a resolved shop** (the invariant review of
 * `16f17ef`, finding 1). The signed header names a STORE, the grant that
 * produced each token named the same store, and those are the two facts that
 * must agree — a `shop.shopify_domain` config field nobody writes is not a third
 * one. Each row is retired under ITS OWN `shop_id`, read from the row, so a
 * mis-resolved tenant cannot attach one shop's ending to another's.
 *
 * It is deliberately NOT exported: it is correct only inside `receiveWebhook`'s
 * transaction, after the receipt exists, because `026`'s CHECK requires an
 * `uninstall` retirement to cite one.
 */
async function retireEveryLiveTokenForDomain(
  tx: Tx,
  shopDomain: string,
  webhookReceiptId: string
): Promise<ConnectorOffboardingReceipt[]> {
  const res = await tx.query(
    `SELECT v.id, v.shop_id, v.shop_domain, v.granted_scopes, v.version_no
       FROM connector_token_version v
       LEFT JOIN connector_token_retirement r ON r.connector_token_version_id = v.id
      WHERE v.connector = $1 AND v.shop_domain = $2 AND r.id IS NULL
      ORDER BY v.shop_id, v.version_no DESC`,
    [CONNECTOR, shopDomain]
  );
  const receipts: ConnectorOffboardingReceipt[] = [];
  for (const row of res.rows as Array<{
    id: string;
    shop_id: string;
    shop_domain: string;
    granted_scopes: string[];
    version_no: number | string;
  }>) {
    receipts.push(
      await offboardTokenVersion(tx, {
        shopId: row.shop_id,
        connectorTokenVersionId: row.id,
        reasonCode: "uninstall",
        webhookReceiptId,
        connector: CONNECTOR,
        versionNo: Number(row.version_no),
        shopDomain: row.shop_domain,
        grantedScopes: row.granted_scopes,
        authoredBy: "provider",
      })
    );
  }
  return receipts;
}

/** The compliance topics this build records and routes onward, for a reader. */
export const RECORDED_ONLY_TOPICS = COMPLIANCE_TOPICS;
/** Every topic with a declared meaning; anything else is recorded and inert. */
export const DECLARED_TOPICS = KNOWN_TOPICS;
