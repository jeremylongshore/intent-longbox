import { describe, expect, it } from "vitest";
import {
  buildProductSetIdentifier,
  buildProductSetInput,
  COPY_KEY_KEY,
  COPY_KEY_NAMESPACE,
  PRODUCT_SET_MUTATION,
} from "../src/services/shopify.js";

const COPY_KEY = "9b1c2d3e-0000-4000-8000-00000000abcd";

describe("buildProductSetInput", () => {
  const input = buildProductSetInput({
    title: "The Amazing Spider-Man #300",
    descriptionHtml: "<p>Marvel, 1988</p><p>Condition: VG-FN</p>",
    priceCents: 24999,
    imageUrls: ["https://example.com/cover.jpg"],
    copyKey: COPY_KEY,
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

  it("mutation targets productSet and declares BOTH variables", () => {
    expect(PRODUCT_SET_MUTATION).toContain("productSet(identifier: $identifier, input: $input)");
    expect(PRODUCT_SET_MUTATION).toContain("$identifier: ProductSetIdentifiers");
    expect(PRODUCT_SET_MUTATION).toContain("$input: ProductSetInput!");
  });
});

// 043 §11 I7 — "productSet always carries the identifier and always carries
// status: DRAFT". Before E02-D07 the mutation declared ONE variable and sent no
// identifier at all, which is exactly why every retry created a new product
// (043 §1 E7): with no identifier, productSet CREATES.
describe("the productSet upsert identifier (043 §4.3, I7)", () => {
  it("carries a customId in the longbox namespace whose value is the copy key", () => {
    expect(buildProductSetIdentifier(COPY_KEY)).toEqual({
      customId: { namespace: COPY_KEY_NAMESPACE, key: COPY_KEY_KEY, value: COPY_KEY },
    });
    expect(COPY_KEY_NAMESPACE).toBe("longbox");
    expect(COPY_KEY_KEY).toBe("copy");
  });

  it("is present on the variables the builder emits, beside the input", () => {
    const vars = buildProductSetInput({
      title: "Bone #1",
      descriptionHtml: "<p></p>",
      priceCents: 500,
      imageUrls: [],
      copyKey: COPY_KEY,
    });
    expect(Object.keys(vars).sort()).toEqual(["identifier", "input"]);
    expect(vars.identifier).toEqual({
      customId: { namespace: "longbox", key: "copy", value: COPY_KEY },
    });
  });

  it("refuses an empty copy key rather than emitting an identifier that matches nothing", () => {
    // An identifier whose value is "" is not a weaker key — it is a key every
    // copy in the store shares, so the second draft would upsert over the first.
    expect(() => buildProductSetIdentifier("")).toThrow(/copyKey must be non-empty/);
    expect(() => buildProductSetIdentifier("   ")).toThrow(/copyKey must be non-empty/);
  });

  it("still hardcodes status DRAFT with an identifier present (locked decision 3, T19)", () => {
    // The identifier makes productSet an UPDATE when the key already resolves,
    // so this assertion is doing more work than it was before E02-D07: it is
    // now the line that says an upsert can never publish.
    const vars = buildProductSetInput({
      title: "x",
      descriptionHtml: "",
      priceCents: 1,
      imageUrls: [],
      copyKey: COPY_KEY,
    });
    expect((vars.input as Record<string, unknown>).status).toBe("DRAFT");
  });
});
