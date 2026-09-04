// L4: full scan-session event flow through the service layer — writes land as
// immutable rows FK'd to the session and read back in order (R1, R9, R11).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  addScanPhoto,
  createScanSession,
  getScanSession,
  getSessionEvents,
  listSessionPhotos,
  setSessionStatus,
} from "../../src/services/scanSession.js";
import { appendCostLog } from "../../src/services/costLog.js";
import { withTransaction } from "../../src/db.js";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("scan-session event flow (service layer)", () => {
  let pool: pg.Pool;
  let shopId: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_flow_test");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    shopId = await seedShop(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("creates a session, appends events, and reads the full trail back", async () => {
    const session = await createScanSession(pool, shopId, "counter-employee");
    expect(session.shop_id).toBe(shopId);
    expect(session.status).toBe("in_progress");

    // Photos append in order.
    await addScanPhoto(pool, { sessionId: session.id, shopId, kind: "cover", storageUrl: "uploads/a.jpg" });
    await addScanPhoto(pool, { sessionId: session.id, shopId, kind: "barcode", storageUrl: "uploads/b.jpg" });
    const photos = await listSessionPhotos(pool, shopId, session.id);
    expect(photos.map((p) => p.kind)).toEqual(["cover", "barcode"]);

    // Confirmation + pricing + cost land as event rows.
    await pool.query(
      `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source)
       VALUES ($1,$2,$3,'grid_pick')`,
      [session.id, shopId, JSON.stringify({ title: "Amazing Spider-Man", issue: "300" })]
    );
    await pool.query(
      `INSERT INTO pricing_snapshot (scan_session_id, shop_id, query, comps, suggested_cents)
       VALUES ($1,$2,'asm 300','[]',12999)`,
      [session.id, shopId]
    );
    const usd = await appendCostLog(pool, {
      shopId,
      scanSessionId: session.id,
      provider: "anthropic",
      model: "claude-sonnet-5",
      tokensIn: 1000,
      tokensOut: 500,
    });
    expect(usd).toBeCloseTo((1000 * 3 + 500 * 15) / 1_000_000, 10);

    const events = await getSessionEvents(pool, shopId, session.id);
    expect(events.scan_photo).toHaveLength(2);
    expect(events.human_confirmation).toHaveLength(1);
    expect(events.pricing_snapshot).toHaveLength(1);
    expect(events.shopify_draft).toHaveLength(0);
    const confirmation = events.human_confirmation![0] as { confirmed_issue: { title: string } };
    expect(confirmation.confirmed_issue.title).toBe("Amazing Spider-Man");

    // Status transitions on the identity row; events untouched. The write takes
    // a held connection (E02-D04): a status change that is not part of the same
    // commit as the record it describes is 029 §12's half-written chain.
    await withTransaction(pool, (tx) => setSessionStatus(tx, shopId, session.id, "confirmed"), {
      label: "flow-status",
    });
    const reread = await getScanSession(pool, shopId, session.id);
    expect(reread?.status).toBe("confirmed");
  });

  it("scopes reads by shop_id (R17 multi-shop schema)", async () => {
    const session = await createScanSession(pool, shopId, "employee");
    const otherShop = await seedShop(pool, { slug: `other-shop-${Date.now()}` });
    expect(await getScanSession(pool, otherShop, session.id)).toBeUndefined();
    expect(await getScanSession(pool, shopId, session.id)).toBeDefined();
  });
});
