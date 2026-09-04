// scan_session identity + append helpers. Event tables get INSERTs only —
// the one permitted UPDATE in the whole codebase is scan_session.status
// (the identity's current state; events stay immutable).
//
// Every function that WRITES on a transactional path takes a `Tx` (the held
// connection) as its FIRST parameter, per 041 §4.1. Read helpers take a
// `Queryable` so they work on the pool outside a request transaction and on the
// held connection inside one.
import type { Queryable, Tx } from "../db.js";

export interface ScanSessionRow {
  id: string;
  shop_id: string;
  created_by: string;
  status: string;
  created_at: string;
}

export async function createScanSession(
  db: Queryable,
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
  db: Queryable,
  shopId: string,
  id: string
): Promise<ScanSessionRow | undefined> {
  const res = await db.query(`SELECT * FROM scan_session WHERE id = $1 AND shop_id = $2`, [id, shopId]);
  return res.rows[0] as ScanSessionRow | undefined;
}

/**
 * The anchor lock (041 §4.2). `SELECT … FOR UPDATE` on the session row at the
 * top of every mutating session route, BEFORE any read that decides whether a
 * write is allowed.
 *
 * One line closes four guards, because all four are questions about a single
 * session: G-a (consent), G-c (an open retention_hold), F6 (a condition
 * assessment exists) and the confirmation-currency check. Each one's predicate
 * reads rows that hang off the locked session, so the lock's coverage and the
 * predicate's subject coincide and there is no write skew — see 041 §4.2's
 * per-guard table. G-c coincides only *by decision*: the hold-placement path
 * must take this same lock, and wiring that route is E02-B08 / E03's.
 *
 * Shop-scoped by `shop_id` in the predicate (T24, non-waivable): a lock taken by
 * id alone would let one tenant serialise another's session.
 *
 * Not-found is `undefined` — the same typed shape `getScanSession` returns, so a
 * caller cannot mistake "locked nothing" for "locked something".
 *
 * SEAM: 041 §5.3's `session_seq` is assigned HERE, inside the transaction and
 * under this lock — a `SELECT coalesce(max(session_seq),0)+1` per session,
 * ridden on the lock at no extra cost. The column does not exist yet; it lands
 * with the envelope expand (041 §10 row 2, bead E02-B10).
 */
export async function lockScanSession(
  tx: Tx,
  shopId: string,
  sessionId: string
): Promise<ScanSessionRow | undefined> {
  const res = await tx.query(`SELECT * FROM scan_session WHERE id = $1 AND shop_id = $2 FOR UPDATE`, [
    sessionId,
    shopId,
  ]);
  return res.rows[0] as ScanSessionRow | undefined;
}

/**
 * The one permitted UPDATE in the codebase, and it takes a `Tx`, not a
 * `Queryable`: a status write that is not part of the same commit as the record
 * it describes is precisely 029 §12's half-written chain. Typing it `Queryable`
 * would let a `pg.Pool` satisfy it and make the "a writer can never silently
 * fall back to the pool" rule in `src/db.ts` an overclaim.
 */
export async function setSessionStatus(
  tx: Tx,
  shopId: string,
  id: string,
  status: "in_progress" | "confirmed" | "drafted" | "abandoned"
): Promise<void> {
  await tx.query(`UPDATE scan_session SET status = $3 WHERE id = $1 AND shop_id = $2`, [id, shopId, status]);
}

export async function addScanPhoto(
  db: Queryable,
  args: { sessionId: string; shopId: string; kind: "cover" | "barcode" | "defect"; storageUrl: string }
): Promise<{ id: string }> {
  const res = await db.query(
    `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url) VALUES ($1, $2, $3, $4) RETURNING id`,
    [args.sessionId, args.shopId, args.kind, args.storageUrl]
  );
  return res.rows[0] as { id: string };
}

export async function listSessionPhotos(
  db: Queryable,
  shopId: string,
  sessionId: string
): Promise<Array<{ id: string; kind: string; storage_url: string }>> {
  const res = await db.query(
    `SELECT id, kind, storage_url FROM scan_photo WHERE scan_session_id = $1 AND shop_id = $2 ORDER BY taken_at`,
    [sessionId, shopId]
  );
  return res.rows as Array<{ id: string; kind: string; storage_url: string }>;
}

/**
 * The two baselines the confirmation outcome is computed against (019 §3.0, T3,
 * T20). Read on the held connection so the outcome is decided from the same
 * snapshot the INSERT below commits with — under the anchor lock, no confirmation
 * can land between the read and the write.
 */
export async function readConfirmationBaseline(
  tx: Tx,
  shopId: string,
  sessionId: string
): Promise<{ priorConfirmation: unknown; topProposalSource: unknown }> {
  const prior = await tx.query(
    `SELECT confirmed_issue FROM human_confirmation
     WHERE scan_session_id = $1 AND shop_id = $2
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [sessionId, shopId]
  );
  // `method <> 'barcode'` is load-bearing: identify.ts inserts the barcode set
  // BEFORE the vision call and returns early when that call fails, so on a
  // failed identify the barcode parse is the latest set. A BarcodeParse carries
  // no title or issue at top level, so without this filter every non-one_tap
  // confirmation on such a session would score 'correct' — an identification
  // failure would be logged as an operator correction and inflate T3.
  const latestSet = await tx.query(
    `SELECT candidates FROM candidate_set
     WHERE scan_session_id = $1 AND shop_id = $2 AND method <> 'barcode'
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [sessionId, shopId]
  );
  return {
    priorConfirmation: (prior.rows[0] as { confirmed_issue: unknown } | undefined)?.confirmed_issue,
    topProposalSource: (latestSet.rows[0] as { candidates: unknown } | undefined)?.candidates,
  };
}

export interface HumanConfirmationRow {
  id: string;
  created_at: string;
  outcome: string;
}

export async function insertHumanConfirmation(
  tx: Tx,
  args: {
    sessionId: string;
    shopId: string;
    confirmedIssue: unknown;
    source: string;
    confirmedBy: string;
    outcome: string;
  }
): Promise<HumanConfirmationRow> {
  const res = await tx.query(
    `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source, confirmed_by, outcome)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at, outcome`,
    [
      args.sessionId,
      args.shopId,
      JSON.stringify(args.confirmedIssue),
      args.source,
      args.confirmedBy,
      args.outcome,
    ]
  );
  return res.rows[0] as HumanConfirmationRow;
}

export interface ShopifyDraftRow {
  id: string;
  product_gid: string | null;
  status: string;
  created_at: string;
}

export async function insertShopifyDraft(
  tx: Tx,
  args: {
    sessionId: string;
    shopId: string;
    productGid: string | null;
    status: "draft" | "failed";
    error: string | null;
  }
): Promise<ShopifyDraftRow> {
  const res = await tx.query(
    `INSERT INTO shopify_draft (scan_session_id, shop_id, product_gid, status, error)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, product_gid, status, created_at`,
    [args.sessionId, args.shopId, args.productGid, args.status, args.error]
  );
  return res.rows[0] as ShopifyDraftRow;
}

/** Fetch the full event trail for a session (read model for GET). */
export async function getSessionEvents(
  db: Queryable,
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
