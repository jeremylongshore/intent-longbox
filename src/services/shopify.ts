// Shopify (R14): Admin GraphQL productSet builder (pure) + client behind an
// interface, DRAFT status only. Stub until store creds exist. Per-shop config
// objects, never module-level singletons.

export interface DraftProductInput {
  title: string;
  descriptionHtml: string;
  priceCents: number;
  imageUrls: string[];
}

export const PRODUCT_SET_MUTATION = `mutation productSet($input: ProductSetInput!) {
  productSet(input: $input) {
    product { id status }
    userErrors { field message }
  }
}`;

/**
 * Build the productSet variables. Status is hardcoded DRAFT — nothing publishes
 * without a human (locked decision #3).
 */
export function buildProductSetInput(input: DraftProductInput): Record<string, unknown> {
  return {
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
      if (userErrors.length > 0) return { ok: false, status: res.status, error: userErrors };
      const gid = body.data?.productSet?.product?.id;
      if (!gid) return { ok: false, status: res.status, error: body.errors ?? "no product GID returned" };
      return { ok: true, status: res.status, productGid: gid };
    },
  };
}

/** Stub client used until store creds exist: succeeds with a fake GID, clearly marked. */
export function createStubShopifyClient(): ShopifyClient {
  return {
    async createDraft(_input: DraftProductInput): Promise<ShopifyDraftResult> {
      return { ok: true, status: 200, productGid: `gid://shopify/Product/stub-${Date.now()}` };
    },
  };
}
