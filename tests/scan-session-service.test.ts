// Unit tests over the scan-session service's SQL invocation logic, against a
// recorded fake pool (the Postgres integration lane covers the real database).
import { describe, expect, it } from "vitest";
import {
  addScanPhoto,
  createScanSession,
  getScanSession,
  getSessionEvents,
  listSessionPhotos,
  setSessionStatus,
} from "../src/services/scanSession.js";
import { fakePool } from "./fakes.js";

const sessionRow = {
  id: "s-1",
  shop_id: "shop-1",
  created_by: "employee",
  status: "in_progress",
  created_at: "2026-09-01T00:00:00Z",
};

describe("createScanSession", () => {
  it("inserts shop_id + created_by and returns the row", async () => {
    const { pool, calls } = fakePool((text) =>
      text.includes("INSERT INTO scan_session") ? { rows: [sessionRow] } : undefined
    );
    const row = await createScanSession(pool, "shop-1", "counter");
    expect(row).toEqual(sessionRow);
    expect(calls[0]?.values).toEqual(["shop-1", "counter"]);
  });
});

describe("getScanSession", () => {
  it("scopes the lookup by BOTH id and shop_id (R17)", async () => {
    const { pool, calls } = fakePool(() => ({ rows: [sessionRow] }));
    await getScanSession(pool, "shop-1", "s-1");
    expect(calls[0]?.text).toMatch(/WHERE id = \$1 AND shop_id = \$2/);
    expect(calls[0]?.values).toEqual(["s-1", "shop-1"]);
  });
  it("returns undefined on no match", async () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    expect(await getScanSession(pool, "shop-1", "nope")).toBeUndefined();
  });
});

describe("setSessionStatus", () => {
  it("updates only scan_session.status, shop-scoped", async () => {
    const { pool, calls } = fakePool();
    await setSessionStatus(pool, "shop-1", "s-1", "drafted");
    expect(calls[0]?.text).toMatch(/UPDATE scan_session SET status = \$3 WHERE id = \$1 AND shop_id = \$2/);
    expect(calls[0]?.values).toEqual(["s-1", "shop-1", "drafted"]);
  });
});

describe("addScanPhoto / listSessionPhotos", () => {
  it("appends a photo row and reads them back in taken_at order", async () => {
    const { pool, calls } = fakePool((text) => {
      if (text.includes("INSERT INTO scan_photo")) return { rows: [{ id: "p-1" }] };
      if (text.includes("FROM scan_photo"))
        return { rows: [{ id: "p-1", kind: "cover", storage_url: "uploads/a.jpg" }] };
      return undefined;
    });
    const photo = await addScanPhoto(pool, {
      sessionId: "s-1",
      shopId: "shop-1",
      kind: "cover",
      storageUrl: "uploads/a.jpg",
    });
    expect(photo.id).toBe("p-1");
    expect(calls[0]?.values).toEqual(["s-1", "shop-1", "cover", "uploads/a.jpg"]);

    const photos = await listSessionPhotos(pool, "shop-1", "s-1");
    expect(photos).toEqual([{ id: "p-1", kind: "cover", storage_url: "uploads/a.jpg" }]);
    expect(calls[1]?.text).toMatch(/ORDER BY taken_at/);
  });
});

describe("getSessionEvents", () => {
  it("reads all seven event tables, shop-scoped, in stable order", async () => {
    const { pool, calls } = fakePool(() => ({ rows: [{ id: "x" }] }));
    const events = await getSessionEvents(pool, "shop-1", "s-1");
    expect(Object.keys(events)).toEqual([
      "scan_photo",
      "candidate_set",
      "llm_rerank",
      "human_confirmation",
      "condition_assessment",
      "pricing_snapshot",
      "shopify_draft",
    ]);
    expect(calls).toHaveLength(7);
    for (const call of calls) {
      expect(call.text).toMatch(/scan_session_id = \$1 AND shop_id = \$2/);
      expect(call.values).toEqual(["s-1", "shop-1"]);
    }
  });
});
