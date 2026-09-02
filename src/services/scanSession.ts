// scan_session identity + append helpers. Event tables get INSERTs only —
// the one permitted UPDATE in the whole codebase is scan_session.status
// (the identity's current state; events stay immutable).
import type pg from "pg";

export interface ScanSessionRow {
  id: string;
  shop_id: string;
  created_by: string;
  status: string;
  created_at: string;
}

export async function createScanSession(
  db: pg.Pool,
  shopId: string,
  createdBy: string
): Promise<ScanSessionRow> {
  const res = await db.query(`INSERT INTO scan_session (shop_id, created_by) VALUES ($1, $2) RETURNING *`, [
    shopId,
    createdBy,
  ]);
  return res.rows[0] as ScanSessionRow;
}

export async function getScanSession(
  db: pg.Pool,
  shopId: string,
  id: string
): Promise<ScanSessionRow | undefined> {
  const res = await db.query(`SELECT * FROM scan_session WHERE id = $1 AND shop_id = $2`, [id, shopId]);
  return res.rows[0] as ScanSessionRow | undefined;
}

export async function setSessionStatus(
  db: pg.Pool,
  shopId: string,
  id: string,
  status: "in_progress" | "confirmed" | "drafted" | "abandoned"
): Promise<void> {
  await db.query(`UPDATE scan_session SET status = $3 WHERE id = $1 AND shop_id = $2`, [id, shopId, status]);
}

export async function addScanPhoto(
  db: pg.Pool,
  args: { sessionId: string; shopId: string; kind: "cover" | "barcode" | "defect"; storageUrl: string }
): Promise<{ id: string }> {
  const res = await db.query(
    `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url) VALUES ($1, $2, $3, $4) RETURNING id`,
    [args.sessionId, args.shopId, args.kind, args.storageUrl]
  );
  return res.rows[0] as { id: string };
}

export async function listSessionPhotos(
  db: pg.Pool,
  shopId: string,
  sessionId: string
): Promise<Array<{ id: string; kind: string; storage_url: string }>> {
  const res = await db.query(
    `SELECT id, kind, storage_url FROM scan_photo WHERE scan_session_id = $1 AND shop_id = $2 ORDER BY taken_at`,
    [sessionId, shopId]
  );
  return res.rows as Array<{ id: string; kind: string; storage_url: string }>;
}

/** Fetch the full event trail for a session (read model for GET). */
export async function getSessionEvents(
  db: pg.Pool,
  shopId: string,
  sessionId: string
): Promise<Record<string, unknown[]>> {
  const tables: Array<[table: string, orderCol: string]> = [
    ["scan_photo", "taken_at"],
    ["candidate_set", "created_at"],
    ["llm_rerank", "created_at"],
    ["human_confirmation", "created_at"],
    ["condition_assessment", "created_at"],
    ["pricing_snapshot", "created_at"],
    ["shopify_draft", "created_at"],
  ];
  const out: Record<string, unknown[]> = {};
  for (const [t, orderCol] of tables) {
    const res = await db.query(
      `SELECT * FROM ${t} WHERE scan_session_id = $1 AND shop_id = $2 ORDER BY ${orderCol}`,
      [sessionId, shopId]
    );
    out[t] = res.rows;
  }
  return out;
}
