// L3: the observed-listing-lifecycle shape and 019 T19's detector predicate.
// Pure logic only — the DB behaviour (append-only trigger, FK, latest-per-draft)
// is asserted in the integration lane.
//
// Bead: longbox-e5b.2.12 (alias E02-D02). Docs: 040 §4.4, 019 T19.
import { describe, expect, it } from "vitest";
import {
  APP_ACTOR,
  isAutoPublishIncident,
  listingStatusObservationInput,
  OBSERVATION_SOURCES,
  OBSERVED_STATUSES,
} from "../src/services/listingStatus.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const DRAFT = "22222222-2222-4222-8222-222222222222";

function base() {
  return {
    shopId: SHOP,
    shopifyDraftId: DRAFT,
    observedStatus: "published" as const,
    source: "watcher" as const,
  };
}

describe("listing_status_observation input shape", () => {
  it("carries 040 §4.4's five observed statuses, unnarrowed", () => {
    expect([...OBSERVED_STATUSES]).toEqual(["draft", "published", "delisted", "archived", "deleted"]);
  });

  it("carries exactly the two observation sources", () => {
    expect([...OBSERVATION_SOURCES]).toEqual(["watcher", "webhook"]);
  });

  it("accepts a minimal observation and leaves published_by absent", () => {
    const parsed = listingStatusObservationInput.parse(base());
    expect(parsed.publishedBy).toBeUndefined();
    expect(parsed.observedStatus).toBe("published");
  });

  it("accepts published_by verbatim, including a channel actor Longbox never writes", () => {
    const parsed = listingStatusObservationInput.parse({ ...base(), publishedBy: APP_ACTOR });
    expect(parsed.publishedBy).toBe("app");
  });

  it("accepts an explicit null published_by (the channel reported no actor)", () => {
    const parsed = listingStatusObservationInput.parse({ ...base(), publishedBy: null });
    expect(parsed.publishedBy).toBeNull();
  });

  it("accepts an explicit observed_at and a raw payload", () => {
    const when = new Date("2026-09-04T12:00:00.000Z");
    const parsed = listingStatusObservationInput.parse({
      ...base(),
      observedAt: when,
      raw: { id: "gid://shopify/Product/1", status: "ACTIVE" },
    });
    expect(parsed.observedAt).toEqual(when);
    expect(parsed.raw).toEqual({ id: "gid://shopify/Product/1", status: "ACTIVE" });
  });

  it("rejects a status outside 040 §4.4's set", () => {
    expect(() => listingStatusObservationInput.parse({ ...base(), observedStatus: "sold" })).toThrow();
  });

  it("rejects a source that is not a watcher or a webhook", () => {
    expect(() => listingStatusObservationInput.parse({ ...base(), source: "app" })).toThrow();
  });

  it("rejects a non-uuid shop or draft id", () => {
    expect(() => listingStatusObservationInput.parse({ ...base(), shopId: "gotham" })).toThrow();
    expect(() => listingStatusObservationInput.parse({ ...base(), shopifyDraftId: "draft-1" })).toThrow();
  });

  it("rejects an empty published_by rather than storing a meaningless actor", () => {
    expect(() => listingStatusObservationInput.parse({ ...base(), publishedBy: "" })).toThrow();
  });
});

describe("isAutoPublishIncident (019 T19)", () => {
  it("fires on a published observation the channel attributes to the app", () => {
    expect(isAutoPublishIncident({ observedStatus: "published", publishedBy: "app" })).toBe(true);
  });

  it("fires regardless of the channel's casing or padding of the actor string", () => {
    expect(isAutoPublishIncident({ observedStatus: "published", publishedBy: " App " })).toBe(true);
    expect(isAutoPublishIncident({ observedStatus: "published", publishedBy: "APP" })).toBe(true);
  });

  it("does not fire when a person published it", () => {
    expect(isAutoPublishIncident({ observedStatus: "published", publishedBy: "staff@example-shop" })).toBe(
      false
    );
  });

  it("does not fire on a null published_by — an absence is not evidence", () => {
    expect(isAutoPublishIncident({ observedStatus: "published", publishedBy: null })).toBe(false);
  });

  it("does not fire when published_by is absent entirely", () => {
    expect(isAutoPublishIncident({ observedStatus: "published" })).toBe(false);
  });

  it("does not fire on a non-published status, even one the app touched", () => {
    for (const status of ["draft", "delisted", "archived", "deleted"]) {
      expect(isAutoPublishIncident({ observedStatus: status, publishedBy: "app" })).toBe(false);
    }
  });

  it("does not treat an actor merely containing 'app' as the app", () => {
    expect(isAutoPublishIncident({ observedStatus: "published", publishedBy: "apparel-bot" })).toBe(false);
  });
});
