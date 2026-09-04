// Unit tests over the scan-session service's SQL invocation logic, against a
// recorded fake pool (the Postgres integration lane covers the real database).
import { describe, expect, it } from "vitest";
import type { Tx } from "../src/db.js";
import {
  addScanPhoto,
  createScanSession,
  getScanSession,
  getSessionEvents,
  insertHumanConfirmation,
  insertShopifyDraft,
  listSessionPhotos,
  lockScanSession,
  readConfirmationBaseline,
  setSessionStatus,
} from "../src/services/scanSession.js";
import { fakePool } from "./fakes.js";

/** The writing helpers take the held connection; the pool fake stands in for it. */
const asTx = (pool: unknown): Tx => pool as Tx;

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
    // Typed `Tx`, not `Queryable`: a status write that is not part of the same
    // commit as the record it describes is 029 §12's half-written chain.
    await setSessionStatus(asTx(pool), "shop-1", "s-1", "drafted");
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

describe("lockScanSession", () => {
  it("takes FOR UPDATE on the anchor row, scoped by BOTH id and shop_id (041 §4.2, T24)", async () => {
    const { pool, calls } = fakePool(() => ({ rows: [sessionRow] }));
    const row = await lockScanSession(asTx(pool), "shop-1", "s-1");
    expect(row).toEqual(sessionRow);
    expect(calls[0]?.text).toMatch(/WHERE id = \$1 AND shop_id = \$2 FOR UPDATE/);
    expect(calls[0]?.values).toEqual(["s-1", "shop-1"]);
  });

  it("returns undefined when the session is not this shop's — it locked nothing", async () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    expect(await lockScanSession(asTx(pool), "other-shop", "s-1")).toBeUndefined();
  });
});

describe("readConfirmationBaseline", () => {
  it("reads the prior confirmation and the latest NON-barcode candidate set", async () => {
    const { pool, calls } = fakePool((text) => {
      if (text.includes("FROM human_confirmation")) return { rows: [{ confirmed_issue: { title: "Hulk" } }] };
      if (text.includes("FROM candidate_set")) return { rows: [{ candidates: [{ title: "Thor" }] }] };
      return undefined;
    });
    const baseline = await readConfirmationBaseline(asTx(pool), "shop-1", "s-1");
    expect(baseline.priorConfirmation).toEqual({ title: "Hulk" });
    expect(baseline.topProposalSource).toEqual([{ title: "Thor" }]);
    // Load-bearing filter: without it a failed identify's barcode parse becomes
    // the baseline and every later confirmation scores 'correct' (inflating T3).
    expect(calls[1]?.text).toMatch(/method <> 'barcode'/);
    for (const call of calls) expect(call.values).toEqual(["s-1", "shop-1"]);
  });

  it("returns undefined baselines on a session with no history", async () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    const baseline = await readConfirmationBaseline(asTx(pool), "shop-1", "s-1");
    expect(baseline).toEqual({ priorConfirmation: undefined, topProposalSource: undefined });
  });
});

describe("insertHumanConfirmation", () => {
  it("appends the row with its outcome, serializing the issue payload", async () => {
    const { pool, calls } = fakePool(() => ({ rows: [{ id: "c-1", created_at: "t", outcome: "confirm" }] }));
    const row = await insertHumanConfirmation(asTx(pool), {
      sessionId: "s-1",
      shopId: "shop-1",
      confirmedIssue: { title: "Hulk", issue: "181" },
      source: "one_tap",
      confirmedBy: "employee",
      outcome: "confirm",
    });
    expect(row.outcome).toBe("confirm");
    expect(calls[0]?.text).toMatch(/INSERT INTO human_confirmation/);
    expect(calls[0]?.values).toEqual([
      "s-1",
      "shop-1",
      JSON.stringify({ title: "Hulk", issue: "181" }),
      "one_tap",
      "employee",
      "confirm",
    ]);
  });
});

describe("insertShopifyDraft", () => {
  it("appends a successful draft row", async () => {
    const { pool, calls } = fakePool(() => ({
      rows: [{ id: "d-1", product_gid: "gid://1", status: "draft", created_at: "t" }],
    }));
    const row = await insertShopifyDraft(asTx(pool), {
      sessionId: "s-1",
      shopId: "shop-1",
      productGid: "gid://1",
      status: "draft",
      error: null,
    });
    expect(row.status).toBe("draft");
    expect(calls[0]?.values).toEqual(["s-1", "shop-1", "gid://1", "draft", null]);
  });

  it("records a failed draft as a row rather than losing it (040 A4)", async () => {
    const { pool, calls } = fakePool(() => ({
      rows: [{ id: "d-2", product_gid: null, status: "failed", created_at: "t" }],
    }));
    const row = await insertShopifyDraft(asTx(pool), {
      sessionId: "s-1",
      shopId: "shop-1",
      productGid: null,
      status: "failed",
      error: '"status 500"',
    });
    expect(row.status).toBe("failed");
    expect(calls[0]?.values).toEqual(["s-1", "shop-1", null, "failed", '"status 500"']);
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
