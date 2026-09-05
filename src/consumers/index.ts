// The consumer composition root.
//
// WHY THIS FILE IS SEPARATE FROM `src/services/outbox.ts`. Platform owns the
// queue and commerce owns what a job means (029 §2.7, §2.9); if the runtime
// imported the handler, platform would know what a `draft_requested` row is for.
// The registry is the seam, and this file is the ONE place the two are wired —
// so `depcruise` has a single edge to allow when E02-B10's architecture gate
// lands (043 §9.1, §11 I14).
//
// IT IS ALSO THE LIST THE PARAMETRIC IDEMPOTENCY TEST ITERATES (043 A2).
// `tests/integration/consumer-idempotency.test.ts` builds this registry and
// constructs the concurrent duplicate against EVERY entry, and
// `tests/contract/consumer-write-shape.test.ts` lints every file in this
// directory for the read-then-write shape. Registering a consumer therefore
// enrols it in both; there is no way to add one and not be tested, which is the
// property a per-instance test cannot have.

import type { Queryable } from "../db.js";
import { resolveShopToken } from "../providers/registry.js";
import { createConsumerRegistry, type ConsumerRegistry } from "../services/outbox.js";
import { createShopifyClient, createStubShopifyClient, type ShopifyClient } from "../services/shopify.js";
import {
  CONNECTOR,
  ConnectorTokenRefusedError,
  openTokenValue,
  requireConnectorKey,
  resolveTokenVersion,
  type ConnectorKeyring,
} from "../services/connectors/shopify/index.js";
import { DRAFT_REQUESTED } from "../events/catalogue.js";
import { createDraftRequestedConsumer, type ShopifyClientResolver } from "./draftRequested.js";

/**
 * Per-shop Shopify client, in THREE outcomes and a fixed precedence (E03-B06,
 * 000-docs/053 §7.4).
 *
 *   1. **A live connector token version wins outright.** Its `shop_domain` and
 *      its sealed token are one fact written by one install, so the store and
 *      the authority cannot come from two different places.
 *   2. **Versions exist and none is live → REFUSED.** Never a fall-through to
 *      the static admin token. This is 050 §4's rule for a BYOK credential
 *      applied to a connector, and the reason is the same one word for word: a
 *      shop whose app was uninstalled would otherwise silently resume drafting
 *      through a token nobody revoked, and the "deletion" would have made the
 *      system keep working. **The refusal is what makes the ending true**, and
 *      it lands one layer before the operations half — the ciphertext is still
 *      in the row when the client already refuses.
 *   3. **No versions at all** → the legacy static path
 *      (`shop_credentials.key_ref` → env var, global fallback), which is what
 *      the pilot's per-store Dev Dashboard app uses today and which still
 *      degrades to the STUB when the token is absent. 046 G-14's defect is
 *      closed by giving it a successor, not by breaking the pilot the week the
 *      successor lands (E16-B02 owns the cutover).
 *
 * A raw key still never touches `shop_credentials`; what changed is that a
 * connector token is sealed ciphertext in `connector_token_version` under a ring
 * that lives only in the process environment (053 §3).
 */
export function createShopifyClientResolver(
  deps: { keyring?: ConnectorKeyring } = {}
): ShopifyClientResolver {
  return async (db: Queryable, shopId: string) => resolveShopifyClient(db, shopId, deps.keyring);
}

/**
 * The default resolver, for a caller with no config in scope.
 *
 * ⚠ IT READS `process.env` PER JOB, AND THAT IS THE FALLBACK RATHER THAN THE
 * PATH (the invariant review of `16f17ef`, note 8). `src/server.ts` builds the
 * registry with `config.connectorKeys` — resolved ONCE at boot by `loadConfig`,
 * which is also where the fail-closed refusal lives — so the running system does
 * not re-scan the environment for every draft. This binding exists for the tests
 * and scripts that have no `AppConfig`, and it is kept rather than removed
 * because a resolver that could only be built from a config would push callers
 * into constructing one.
 */
export const resolveShopifyClientForShop: ShopifyClientResolver = async (db: Queryable, shopId: string) =>
  resolveShopifyClient(db, shopId, undefined);

/**
 * ⚠ `db` IS THE JOB'S TENANT-SCOPED HANDLE, NOT A POOL (E03-B04).
 *
 * Every table this function reads except `shop` carries a `shop_id` and therefore
 * a row-level-security policy: `connector_token_version`,
 * `connector_token_retirement`, `shop_credential_version`, `shop_credentials`. A
 * read with no tenant context finds NOTHING on all of them — and "nothing" is not
 * an error here, it is outcome 3: the static path, which degrades to the STUB.
 * So a missing context would not fail, it would quietly draft against a stub in
 * production. That is why the handle is a parameter typed as a `Queryable` the
 * caller must have scoped, rather than a pool this function could scope wrongly.
 */
const resolveShopifyClient: (
  db: Queryable,
  shopId: string,
  keyring: ConnectorKeyring | undefined
) => Promise<{ client: ShopifyClient; stub: boolean }> = async (db, shopId, keyring) => {
  const apiVersion = process.env["SHOPIFY_API_VERSION"] ?? "2025-07";
  const outcome = await resolveTokenVersion(db, shopId, CONNECTOR);
  if (outcome.outcome === "all_retired") {
    const newest = outcome.retired[0];
    throw new ConnectorTokenRefusedError(
      `shop ${shopId} has ${String(outcome.retired.length)} Shopify connector token version(s) ` +
        `and every one is retired (newest: version ${String(newest?.versionNo)}, reason ` +
        `${newest?.retiredReason ?? "unknown"}). Re-install the connector. A retired connector ` +
        `token is never replaced by the static admin token, because that would let an ` +
        `uninstalled shop keep drafting through a credential nobody revoked.`
    );
  }
  if (outcome.outcome === "live") {
    const token = await openTokenValue(db, keyring ?? requireConnectorKey(), shopId, outcome.chosen.id);
    return {
      client: createShopifyClient({
        storeDomain: outcome.chosen.shopDomain,
        adminToken: token,
        apiVersion,
      }),
      stub: false,
    };
  }

  const shopRes = await db.query(`SELECT shopify_domain FROM shop WHERE id = $1`, [shopId]);
  const shopRow = shopRes.rows[0] as { shopify_domain: string | null } | undefined;
  const adminToken = await resolveShopToken(db, shopId, "shopify", "SHOPIFY_ADMIN_TOKEN");
  const storeDomain = shopRow?.shopify_domain ?? process.env["SHOPIFY_STORE_DOMAIN"];
  if (adminToken && storeDomain) {
    const client: ShopifyClient = createShopifyClient({ storeDomain, adminToken, apiVersion });
    return { client, stub: false };
  }
  return { client: createStubShopifyClient(), stub: true };
};

/**
 * Build the registry this process drains with.
 *
 * `resolveClient` is a parameter so the integration lane can inject a fake
 * Shopify client and still exercise the REAL consumer, the real guard, the real
 * recording transaction and the real constraint.
 */
export function buildConsumerRegistry(
  deps: { resolveClient?: ShopifyClientResolver; keyring?: ConnectorKeyring } = {}
): ConsumerRegistry {
  const registry = createConsumerRegistry();
  registry.register(
    DRAFT_REQUESTED,
    createDraftRequestedConsumer({
      // The BOOT-resolved ring when the caller has one (`src/server.ts` passes
      // `config.connectorKeys`), and the environment-reading fallback otherwise.
      resolveClient:
        deps.resolveClient ??
        (deps.keyring ? createShopifyClientResolver({ keyring: deps.keyring }) : resolveShopifyClientForShop),
    })
  );
  return registry;
}
