import { describe, expect, it } from "vitest";
import { buildProductSetInput, PRODUCT_SET_MUTATION } from "../src/services/shopify.js";

describe("buildProductSetInput", () => {
  const input = buildProductSetInput({
    title: "The Amazing Spider-Man #300",
    descriptionHtml: "<p>Marvel, 1988</p><p>Condition: VG-FN</p>",
    priceCents: 24999,
    imageUrls: ["https://example.com/cover.jpg"],
  });
  const inner = input.input as Record<string, unknown>;

  it("always DRAFT status — nothing publishes without a human", () => {
    expect(inner.status).toBe("DRAFT");
  });

  it("formats price as dollars string", () => {
    const variants = inner.variants as Array<{ price: string }>;
    expect(variants[0]?.price).toBe("249.99");
  });

  it("attaches media by public URL", () => {
    const files = inner.files as Array<{ originalSource: string; contentType: string }>;
    expect(files).toEqual([{ originalSource: "https://example.com/cover.jpg", contentType: "IMAGE" }]);
  });

  it("carries the title through", () => {
    expect(inner.title).toBe("The Amazing Spider-Man #300");
  });

  it("mutation targets productSet", () => {
    expect(PRODUCT_SET_MUTATION).toContain("productSet(input: $input)");
  });
});
