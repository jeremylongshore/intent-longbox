// Shopify (R14): Admin GraphQL productSet builder (pure) + client behind an
// interface, DRAFT status only. Stub until store creds exist. Per-shop config
// objects, never module-level singletons.
//
// E02-D07 (043 §4.3) adds the one thing that made every retry a duplicate: the
// `identifier: { customId }` upsert key. Before it, `productSet` was called with
// no identifier at all, so each call created a NEW product and the operator's
// only recovery from a failure — pressing the button again — produced a second
// listing (043 §1 E7).
import { createHash } from "node:crypto";

export interface DraftProductInput {
  title: string;
  descriptionHtml: string;
  priceCents: number;
  imageUrls: string[];
  /**
   * The Longbox-owned upsert key for this physical copy (043 §4.3).
   *
   * REQUIRED, and required rather than optional on purpose: a call with no
   * identifier CREATES a product, so an optional key is a retry that silently
   * duplicates. Making it a required field means the type system asks the
   * question at every call site.
   *
   * TODAY IT IS THE `scan_session_id`, AND THAT IS A FORWARD-COMPATIBLE LIE THE
   * RECORD NAMES RATHER THAN HIDES. 036 §2.1 makes `physical_item` the inventory
   * identity and 036 §5.1 D1 forbids two active listings for one copy;
   * `physical_item` does not exist (043 §1 via 041 §1 E19 — 036 §7.1's migration
   * is unwritten). When it lands, the value becomes the `physical_item_id`, and
   * the transition is E10-B03's: **a backfill of the metafield on existing
   * products, never a key swap**, because a key change means an upsert stops
   * matching and creates a second product.
   */
  copyKey: string;
}

/** 043 §4.3: the namespace and key of the metafield Longbox upserts on. */
export const COPY_KEY_NAMESPACE = "longbox";
export const COPY_KEY_KEY = "copy";

export const PRODUCT_SET_MUTATION = `mutation productSet($identifier: ProductSetIdentifiers, $input: ProductSetInput!) {
  productSet(identifier: $identifier, input: $input) {
    product { id status }
    userErrors { field message }
  }
}`;

/**
 * The upsert identifier (043 §4.3).
 *
 * Shopify's Admin GraphQL API provides NO idempotency-key mechanism for
 * `productSet` — verified against the API reference on 2026-09-04: the mutation
 * accepts exactly `identifier`, `input` and `synchronous`, and there is no
 * idempotency argument and no idempotency header. What it offers instead is an
 * UPSERT ON A CALLER-CHOSEN KEY, and that is a stronger guarantee than a retry
 * token because it survives a RESTORE as well as a retry: 019 T22 signs a ≤24 h
 * RPO with no PITR (024 §2), so a restore can rewind Longbox by up to a day and
 * cannot rewind Shopify — and this key turns a day's worth of duplicate listings
 * into a day's worth of no-ops.
 *
 * ⚠ ONE THING HERE IS AN ASSUMPTION SIGNED **OPEN** (043 A11): that a `customId`
 * written by a `productSet` CREATE is immediately findable by a `productSet`
 * upsert issued moments later. A metafield-backed lookup that is eventually
 * consistent would make a fast retry create a SECOND product — the exact failure
 * the key exists to prevent — and **no citation can settle it, because the
 * question is about behaviour and not documentation**. It closes by measurement
 * against an isolated dev store, before the saga serves a real shop:
 * `tests/integration/shopify-customid-consistency.test.ts`, which SKIPS unless
 * the dev-store credentials are present. If it fails, the fallback is `handle`
 * (also an upsert identifier, and a first-class product field rather than a
 * metafield) or a pre-flight `productByIdentifier` read.
 */
export function buildProductSetIdentifier(copyKey: string): Record<string, unknown> {
  if (copyKey.trim() === "") throw new Error("buildProductSetIdentifier: copyKey must be non-empty");
  return { customId: { namespace: COPY_KEY_NAMESPACE, key: COPY_KEY_KEY, value: copyKey } };
}

/**
 * Build the productSet variables. Status is hardcoded DRAFT — nothing publishes
 * without a human (locked decision #3; 019 T19 = 0, non-waivable; 040 F1).
 *
 * ⚠ BECAUSE `productSet` UPDATES an existing product, and because this builder
 * hardcodes `status: "DRAFT"`, a re-run against a product a human has since
 * PUBLISHED would set it back to DRAFT. That is not a T19 auto-publish — nothing
 * publishes — but it is the mirror image: Longbox silently UN-publishing a
 * listing a person decided to publish, which breaks 022 P1's human authority and
 * 033 B3's "publish is a normal Shopify action, never the app's" from the other
 * side. The status stays hardcoded, and the protection is the FAIL-CLOSED guard
 * in `src/consumers/draftRequested.ts` (043 §4.3, A3), which refuses the call
 * rather than softening the field.
 */
export function buildProductSetInput(input: DraftProductInput): Record<string, unknown> {
  return {
    identifier: buildProductSetIdentifier(input.copyKey),
    input: {
      title: input.title,
      descriptionHtml: input.descriptionHtml,
      status: "DRAFT",
      productType: "Comic Book",
      variants: [
        {
          price: (input.priceCents / 100).toFixed(2),
          optionValues: [{ optionName: "Title", name: "Default" }],
        },
      ],
      productOptions: [{ name: "Title", values: [{ name: "Default" }] }],
      files: input.imageUrls.map((url) => ({ originalSource: url, contentType: "IMAGE" })),
    },
  };
}

export interface ShopifyDraftResult {
  ok: boolean;
  status: number;
  productGid?: string;
  error?: unknown;
  /**
   * TRUE when the failure will fail identically forever (043 §5.2) — 042 §4.4's
   * `retryable` distinction one layer down. A `userErrors` entry (an invalid
   * price, a missing required field) is permanent; a 429, a 502, a dropped
   * connection is not.
   *
   * The classification already existed in this file — the three branches below
   * separate transport, HTTP and `userErrors` — and only its CONSEQUENCE was
   * missing: a permanent failure dead-letters on the first attempt, with no
   * backoff and no retry.
   */
  permanent?: boolean;
}

export interface ShopifyClient {
  createDraft(input: DraftProductInput): Promise<ShopifyDraftResult>;
}

export interface ShopifyConfig {
  storeDomain: string; // e.g. gotham-city-limit.myshopify.com
  adminToken: string;
  apiVersion: string; // pinned; bump deliberately with a changelog entry
}

export function createShopifyClient(cfg: ShopifyConfig): ShopifyClient {
  return {
    async createDraft(input: DraftProductInput): Promise<ShopifyDraftResult> {
      let res: Response;
      try {
        res = await fetch(`https://${cfg.storeDomain}/admin/api/${cfg.apiVersion}/graphql.json`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-shopify-access-token": cfg.adminToken,
          },
          body: JSON.stringify({ query: PRODUCT_SET_MUTATION, variables: buildProductSetInput(input) }),
        });
      } catch (err) {
        return { ok: false, status: 0, error: `network error: ${(err as Error).message}` };
      }
      const body = (await res.json().catch(() => ({}))) as {
        data?: { productSet?: { product?: { id?: string }; userErrors?: Array<{ message: string }> } };
        errors?: unknown;
      };
      if (!res.ok) return { ok: false, status: res.status, error: body };
      const userErrors = body.data?.productSet?.userErrors ?? [];
      if (userErrors.length > 0) {
        return { ok: false, status: res.status, error: userErrors, permanent: true };
      }
      const gid = body.data?.productSet?.product?.id;
      if (!gid) return { ok: false, status: res.status, error: body.errors ?? "no product GID returned" };
      return { ok: true, status: res.status, productGid: gid };
    },
  };
}

/**
 * Stub client used until store creds exist: succeeds with a fake GID, clearly
 * marked.
 *
 * THE GID IS DERIVED FROM THE COPY KEY, NOT FROM THE CLOCK. The real client's
 * whole safety property is that a second `productSet` with the same `customId`
 * returns the SAME product (043 §4.3), and a stub whose id moved every call
 * would let a retry test pass against the stub while the equivalent real call
 * duplicated. A stub that lies about the one property under test is worse than
 * no stub. 043 §5.3's closing evidence makes the same point from the other side:
 * a stub client never fails, so a mixed sample would report a reliability that
 * belongs to the stub.
 */
export function createStubShopifyClient(): ShopifyClient {
  return {
    async createDraft(input: DraftProductInput): Promise<ShopifyDraftResult> {
      const digest = createHash("sha256").update(input.copyKey).digest("hex").slice(0, 16);
      return { ok: true, status: 200, productGid: `gid://shopify/Product/stub-${digest}` };
    },
  };
}
