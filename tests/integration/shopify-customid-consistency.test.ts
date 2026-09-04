// L4 — 043 A11's CLOSING EVIDENCE. **SKIPPED unless a dev store is configured.**
//
// THE ASSUMPTION, AND WHY NO CITATION CAN SETTLE IT. 043 §4.3 makes every
// `productSet` call carry `identifier: { customId: { namespace: "longbox", key:
// "copy", value: <copy key> } }`, so a retry UPSERTS instead of duplicating.
// That design leans on one behavioural fact that Shopify's documentation does
// not state:
//
//   > a `customId` written by a `productSet` CREATE is immediately findable by a
//   > `productSet` upsert issued moments later.
//
// A metafield-backed lookup that were eventually consistent would make a fast
// retry create a SECOND product — the exact failure the key exists to prevent.
// The cannon found this and signed it **OPEN** rather than glossing it:
//
//   "Neither lens re-fetched Shopify's reference, so the cannon reproduced this
//    record's READING of the documentation and not Shopify's BEHAVIOUR. …
//    answered by measurement, not by citation."
//
// It is the one place 043's evidence regime — citation — cannot reach, because
// the question is about behaviour. It closes HERE, on a dev store, BEFORE the
// saga serves a real shop.
//
// HOW TO RUN IT:
//   export SHOPIFY_DEV_STORE_DOMAIN=your-dev-store.myshopify.com
//   export SHOPIFY_DEV_ADMIN_TOKEN=shpat-...      # values live in SOPS
//   export SHOPIFY_DEV_API_VERSION=2025-07        # optional
//   pnpm test:integration
//
// ⚠ IT CREATES A REAL PRODUCT. Point it at an ISOLATED DEV STORE and never at a
// shop's store. It is deliberately NOT wired into CI: a CI job that needed a
// live third-party credential would fail for reasons that are not the code's,
// and 019 T17's denominator is not the place to discover Shopify's uptime.
//
// IF IT FAILS: the fallback is `handle` (also an upsert identifier, and a
// first-class product field rather than a metafield) or a pre-flight
// `productByIdentifier` read — "both are cheaper to adopt than to design around
// later, which is why the test comes before the shop and not after" (043 §4.3).
//
// Bead: longbox-e5b.2.17 (E02-D07). Docs: 043 §4.3, A11, §12.3.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createShopifyClient } from "../../src/services/shopify.js";

const domain = process.env.SHOPIFY_DEV_STORE_DOMAIN;
const token = process.env.SHOPIFY_DEV_ADMIN_TOKEN;
const configured = Boolean(domain && token);

if (!configured) {
  // Loud rather than silent: an OPEN assumption that nobody notices is an OPEN
  // assumption that quietly becomes a closed one in somebody's head.
  console.warn(
    "[integration] 043 A11 upsert-consistency check SKIPPED: set SHOPIFY_DEV_STORE_DOMAIN and " +
      "SHOPIFY_DEV_ADMIN_TOKEN against an ISOLATED DEV STORE to run it. The assumption stays OPEN " +
      "until it does, and 043 §4.3 requires it to close before the saga serves a real shop."
  );
}

describe.skipIf(!configured)("043 A11 — the customId upsert is immediately consistent", () => {
  const client = createShopifyClient({
    storeDomain: domain!,
    adminToken: token!,
    apiVersion: process.env.SHOPIFY_DEV_API_VERSION ?? "2025-07",
  });

  it("a productSet CREATE is matched by an IMMEDIATE productSet upsert on the same customId", async () => {
    const copyKey = `longbox-a11-${randomUUID()}`;
    const input = {
      title: `Longbox A11 upsert probe ${copyKey.slice(-8)}`,
      descriptionHtml: "<p>Automated check for 043 A11. Safe to delete.</p>",
      priceCents: 100,
      imageUrls: [],
      copyKey,
    };

    const created = await client.createDraft(input);
    expect(created.ok, `create failed: ${JSON.stringify(created.error)}`).toBe(true);
    expect(created.productGid).toBeTruthy();

    // IMMEDIATELY — no sleep. A sleep here would measure a different question
    // (is it eventually consistent?) and answer the one the design does not ask.
    const retried = await client.createDraft(input);
    expect(retried.ok, `retry failed: ${JSON.stringify(retried.error)}`).toBe(true);

    // THE ASSERTION THE WHOLE ASSUMPTION REDUCES TO: the same product id comes
    // back. If this fails, 043 §4.3's fallback applies and E02-D07's identifier
    // must move to `handle` or to a pre-flight read.
    expect(
      retried.productGid,
      "the customId upsert did NOT resolve the product created moments earlier — 043 A11's " +
        "assumption is FALSE. Switch the identifier to `handle` or add a pre-flight " +
        "productByIdentifier read, and file a 006 row: this is a decision change, not a bug fix."
    ).toBe(created.productGid);
  }, 60_000);
});
