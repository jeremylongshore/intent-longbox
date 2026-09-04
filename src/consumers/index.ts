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

import type pg from "pg";
import { resolveShopToken } from "../providers/registry.js";
import { createConsumerRegistry, type ConsumerRegistry } from "../services/outbox.js";
import { createShopifyClient, createStubShopifyClient, type ShopifyClient } from "../services/shopify.js";
import { DRAFT_REQUESTED } from "../events/catalogue.js";
import { createDraftRequestedConsumer, type ShopifyClientResolver } from "./draftRequested.js";

/**
 * Per-shop Shopify client, resolved the same way every other credential is:
 * `shop_credentials.key_ref` names an env var, with a global fallback, and a raw
 * key never touches the database (locked decision 2).
 *
 * Degrades to the stub when creds are absent — the pipeline never blocks on a
 * missing token — and the stub's GID is derived from the copy key rather than
 * the clock, so a retry against it behaves like the upsert it stands in for.
 */
export const resolveShopifyClientForShop: ShopifyClientResolver = async (pool: pg.Pool, shopId: string) => {
  const shopRes = await pool.query(`SELECT shopify_domain FROM shop WHERE id = $1`, [shopId]);
  const shopRow = shopRes.rows[0] as { shopify_domain: string | null } | undefined;
  const adminToken = await resolveShopToken(pool, shopId, "shopify", "SHOPIFY_ADMIN_TOKEN");
  const storeDomain = shopRow?.shopify_domain ?? process.env.SHOPIFY_STORE_DOMAIN;
  if (adminToken && storeDomain) {
    const client: ShopifyClient = createShopifyClient({
      storeDomain,
      adminToken,
      apiVersion: process.env.SHOPIFY_API_VERSION ?? "2025-07",
    });
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
  deps: { resolveClient?: ShopifyClientResolver } = {}
): ConsumerRegistry {
  const registry = createConsumerRegistry();
  registry.register(
    DRAFT_REQUESTED,
    createDraftRequestedConsumer({ resolveClient: deps.resolveClient ?? resolveShopifyClientForShop })
  );
  return registry;
}
