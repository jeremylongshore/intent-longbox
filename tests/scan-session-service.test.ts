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
  readDraftFacts,
  setSessionStatus,
} from "../src/services/scanSession.js";
import { fakePool } from "./fakes.js";

/** The writing helpers take the held connection; the pool fake stands in for it. */
const asTx = (pool: unknown): Tx => pool as Tx;

// The PROJECTION, not the row: `status` and `created_by` are columns of
// `scan_session` and are not fields of `ScanSessionRow` any more (042 §3.3,
// 040 A8, 041 §8.4).
const sessionRow = {
  id: "s-1",
  shop_id: "shop-1",
  created_at: "2026-09-01T00:00:00Z",
};

describe("createScanSession", () => {
  it("inserts shop_id and the SESSION's operator — `created_by` has no writer (041 §8.4, 048 §6.3)", async () => {
    const { pool, calls } = fakePool((text) =>
      text.includes("INSERT INTO scan_session") ? { rows: [sessionRow] } : undefined
    );
    const row = await createScanSession(pool, "shop-1");
    expect(row).toEqual(sessionRow);
    // `operator_id` is NULL when the caller passes none; `actor_verified` is
    // derived from it in the same statement (048 §6.3). `created_by` still has
    // no writer and never gets one — a system that wrote both a verified id and
    // an unverified string would have two attributions and no rule for which is
    // true.
    expect(calls[0]?.values).toEqual(["shop-1", null]);
    expect(calls[0]?.text).not.toMatch(/created_by/);
    expect(calls[0]?.text).toMatch(/operator_id, actor_verified/);
    // The read model names its columns; a star projection here is what put the
    // retired `status` column into a response body (042 E15).
    expect(calls[0]?.text).toContain("RETURNING id, shop_id, created_at");
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
      storageKey: "a.jpg",
      contentHash: "a".repeat(64),
      byteSize: 11,
    });
    expect(photo.id).toBe("p-1");
    // E03-B07: the row names the bytes — the storage key, the SHA-256 of the
    // stored file and its size travel with the INSERT, so 003's reserved
    // columns stop being reserved and `media_deletion` has a key to address.
    expect(calls[0]?.values).toEqual([
      "s-1",
      "shop-1",
      "cover",
      "uploads/a.jpg",
      "a.jpg",
      "a".repeat(64),
      11,
    ]);

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
      outcome: "confirm",
      sessionSeq: 1,
    });
    expect(row.outcome).toBe("confirm");
    expect(calls[0]?.text).toMatch(/INSERT INTO human_confirmation/);
    // 041 §8.4 / 042 I1: no personal identifier is written into the log.
    expect(calls[0]?.text).not.toMatch(/confirmed_by/);
    expect(calls[0]?.values).toEqual([
      "s-1",
      "shop-1",
      JSON.stringify({ title: "Hulk", issue: "181" }),
      "one_tap",
      "confirm",
      // 041 §5.3: the per-session commit counter travels on the INSERT, assigned by
      // `assignSessionSeq` under the anchor lock the caller already holds.
      1,
      // 048 §6.3's `operator_id`, NULL when the caller passes none.
      null,
    ]);
  });
});

describe("readDraftFacts", () => {
  // The `draft_requested` job's read. Deliberately NOT getSessionEvents: that
  // helper returns every row of seven tables so a GET can render a trail, and a
  // job that pulled all of it to use three rows would make the read cost grow
  // with the session's history.
  it("reads the CURRENT confirmation, price and condition through the views (041 I8)", async () => {
    const { pool, calls } = fakePool((text) => {
      if (text.includes("FROM human_confirmation")) {
        return { rows: [{ confirmed_issue: { title: "Bone" } }] };
      }
      if (text.includes("FROM pricing_snapshot")) {
        return { rows: [{ suggested_cents: 1200, override_cents: null }] };
      }
      if (text.includes("FROM condition_assessment")) {
        return { rows: [{ grade_range_low: "FN", grade_range_high: "VF", defects: [] }] };
      }
      if (text.includes("FROM scan_photo")) return { rows: [{ storage_url: "uploads/a/cover.jpg" }] };
      return undefined;
    });
    const facts = await readDraftFacts(pool, "shop-1", "s-1");
    expect(facts.confirmedIssue).toEqual({ title: "Bone" });
    expect(facts.pricing).toEqual({ suggested_cents: 1200, override_cents: null });
    expect(facts.assessment?.grade_range_low).toBe("FN");
    // Prefixed with "/" so the URL is site-absolute, as the route did before the
    // block moved into the consumer.
    expect(facts.coverUrls).toEqual(["/uploads/a/cover.jpg"]);
    // Every read is shop-scoped (T24, non-waivable) and goes through `_current`
    // (041 §3.4: "every read that drives a decision goes through `_current`").
    // The newest INSERTED row and the CURRENT row are the same row only until
    // somebody corrects one — after a correction, a draft composed from the
    // newest insert publishes a record the operator was never shown.
    for (const call of calls) expect(call.values).toEqual(["s-1", "shop-1"]);
    expect(calls.filter((c) => c.text.includes("_current"))).toHaveLength(3);
    expect(calls.filter((c) => c.text.includes("ORDER BY created_at DESC"))).toHaveLength(0);
    // Only cover photos reach a listing.
    expect(calls.find((c) => c.text.includes("FROM scan_photo"))!.text).toContain("kind = 'cover'");
  });

  it("returns undefined facts on a bare session rather than inventing them", async () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    const facts = await readDraftFacts(pool, "shop-1", "s-1");
    expect(facts.confirmedIssue).toBeUndefined();
    expect(facts.pricing).toBeUndefined();
    expect(facts.assessment).toBeUndefined();
    expect(facts.coverUrls).toEqual([]);
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
      sessionSeq: 2,
    });
    // `row` is optional since E02-D07: `ON CONFLICT … DO NOTHING` returns
    // nothing when a concurrent delivery of the SAME job already recorded it
    // (043 §11 I5(b)). Here there is no conflict, so a row comes back.
    expect(row?.status).toBe("draft");
    // `session_seq` (2) is E02-B10's counter; the trailing null is `outbox_id` —
    // this row was written by a REQUEST, not a job (migration 012, 030 A1's
    // one-meaning rule).
    expect(calls[0]?.values).toEqual(["s-1", "shop-1", "gid://1", "draft", null, 2, null]);
  });

  it("carries the outbox_id when a JOB wrote the row — the constraint I5(b) leans on", async () => {
    // The partial UNIQUE (outbox_id) index is what makes the draft_requested
    // consumer idempotent under CONCURRENT duplicate delivery by a CONSTRAINT
    // rather than by a read-then-write check (043 §3.2, §11 I5(b)). It can only
    // do that if the writer actually passes the id.
    const { pool, calls } = fakePool(() => ({
      rows: [{ id: "d-3", product_gid: "gid://3", status: "draft", created_at: "t" }],
    }));
    await insertShopifyDraft(asTx(pool), {
      sessionId: "s-1",
      shopId: "shop-1",
      productGid: "gid://3",
      status: "draft",
      error: null,
      sessionSeq: 4,
      outboxId: "ob-9",
    });
    expect(calls[0]?.text).toMatch(/outbox_id/);
    expect(calls[0]?.text).toMatch(/ON CONFLICT \(outbox_id\)/);
    expect(calls[0]?.values?.[6]).toBe("ob-9");
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
      sessionSeq: 3,
    });
    expect(row?.status).toBe("failed");
    expect(calls[0]?.values).toEqual(["s-1", "shop-1", null, "failed", '"status 500"', 3, null]);
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
