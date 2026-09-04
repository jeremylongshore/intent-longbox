// scan_session identity + append helpers. Event tables get INSERTs only —
// the one permitted UPDATE in the whole codebase is scan_session.status
// (the identity's current state; events stay immutable).
//
// Every function that WRITES on a transactional path takes a `Tx` (the held
// connection) as its FIRST parameter, per 041 §4.1. Read helpers take a
// `Queryable` so they work on the pool outside a request transaction and on the
// held connection inside one.
import type { Queryable, Tx } from "../db.js";
import { SESSION_SEQ_TABLE_NAMES } from "../db/appendOnlyTables.js";
import { assertSafeIdentifier } from "../db/appRoleGrants.js";

/**
 * THE PROJECTION, NOT THE ROW (042 §3.3, 040 A8).
 *
 * `status` and `created_by` are columns of `scan_session` and are NOT columns of
 * this type. `status` is the column 040 retires — state is DERIVED from the log
 * (`src/services/worldView.ts`), and an unbounded star projection here is what
 * put it in a response body in the first place (042 E15). `created_by` is a
 * personal identifier 041 §8.4 stopped writing.
 *
 * A named column list is the whole of the fix, and it generalises: a star
 * projection in a read model is a standing commitment to publish every future
 * column, and nobody would write that commitment down.
 */
export interface ScanSessionRow {
  id: string;
  shop_id: string;
  created_at: string;
}

const SCAN_SESSION_COLUMNS = "id, shop_id, created_at";

/**
 * 041 §8.4 / 042 I1: `created_by` IS NOT WRITTEN. The column keeps its DEFAULT
 * so existing rows and the deploy are undisturbed; what stops is a writer
 * putting a person's identifier into a row nothing can correct.
 *
 * `operator_id` IS written, from the SESSION and from nowhere else (048 §6.3,
 * E03-D09), with `actor_verified` derived from its presence in the same
 * statement so the two can never disagree. This is the moment 046 E23 named:
 * the column that five migrations reserved acquires a writer, and the audited
 * accessor (034 §3.3) finally has something to gate. **No pre-G2 row is
 * backfilled and no `actor_verified` is ever flipped to true** — the column is
 * the machine-readable line between the two eras (`003:44-51`).
 */
export async function createScanSession(
  db: Queryable,
  shopId: string,
  operatorId?: string | null
): Promise<ScanSessionRow> {
  const res = await db.query(
    `INSERT INTO scan_session (shop_id, operator_id, actor_verified)
     VALUES ($1, $2::uuid, $2::uuid IS NOT NULL) RETURNING ${SCAN_SESSION_COLUMNS}`,
    [shopId, operatorId ?? null]
  );
  return res.rows[0] as ScanSessionRow;
}

export async function getScanSession(
  db: Queryable,
  shopId: string,
  id: string
): Promise<ScanSessionRow | undefined> {
  const res = await db.query(
    `SELECT ${SCAN_SESSION_COLUMNS} FROM scan_session WHERE id = $1 AND shop_id = $2`,
    [id, shopId]
  );
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
 * SEAM, NOW WIRED (E02-B10): 041 §5.3's `session_seq` is assigned under THIS lock
 * by `assignSessionSeq` below — a `coalesce(max(session_seq),0)+1` per session,
 * ridden on the lock at no extra cost. It is a separate exported function rather
 * than an extra return value here because not every caller of the lock writes a
 * row, and a counter that advanced on a read would stop being commit order.
 */
export async function lockScanSession(
  tx: Tx,
  shopId: string,
  sessionId: string
): Promise<ScanSessionRow | undefined> {
  const res = await tx.query(
    `SELECT ${SCAN_SESSION_COLUMNS} FROM scan_session WHERE id = $1 AND shop_id = $2 FOR UPDATE`,
    [sessionId, shopId]
  );
  return res.rows[0] as ScanSessionRow | undefined;
}

/**
 * The SQL that reads the session's current high-water mark across every
 * session-scoped witness table. Built once from the declared list rather than
 * spelled per call: a table that gains `session_seq` and is missed here would
 * silently reuse a number, and the declared list is the thing the migration and
 * the gate-test already agree on.
 *
 * The identifiers are interpolated, so they are validated first — the same
 * `assertSafeIdentifier` the grant plan uses. They come from a checked-in const,
 * not from user input, and the assertion is what keeps that true if the list ever
 * starts being built from something else.
 */
const SESSION_SEQ_MAX_SQL = `SELECT coalesce(max(m), 0)::bigint AS m FROM (\n${SESSION_SEQ_TABLE_NAMES.map(
  (t) =>
    `  SELECT max(session_seq) AS m FROM ${assertSafeIdentifier(t, "session_seq table")} ` +
    `WHERE scan_session_id = $1 AND shop_id = $2`
).join("\n  UNION ALL\n")}\n) AS s`;

/**
 * Assign the next `session_seq` for a session (041 §5.3, decision (c)).
 *
 * **Must be called inside the request transaction, after `lockScanSession`.** The
 * read-modify-write is only atomic because the anchor row is already held `FOR
 * UPDATE`: two concurrent writers to one session are serialised by that lock, so
 * `max + 1` cannot be computed twice from the same snapshot. Called without the
 * lock it is a race, and the per-table `UNIQUE (scan_session_id, session_seq)`
 * index is what turns that race into a loud failure rather than a duplicate.
 *
 * The maximum is taken ACROSS the declared session-scoped tables, not within one:
 * the counter orders two rows about one session whichever tables they sit in
 * (041 §5.3 — "the canonical order of two rows about one session is `session_seq`").
 *
 * ⚠ **The number is COMMIT order, not act order** (041 §5.3, A4). For E05-B08's
 * offline queue, a park recorded at the counter at 10:02 and replayed at 10:47
 * receives the sequence of 10:47, because that is when the database learned it.
 * Nothing may present it to anyone as when the operator acted, and a dispute
 * between two replayed writes is resolved by `against_table`/`against_id`, never by
 * this number alone.
 */
export async function assignSessionSeq(tx: Tx, shopId: string, sessionId: string): Promise<number> {
  const res = await tx.query(SESSION_SEQ_MAX_SQL, [sessionId, shopId]);
  // `max()` of a bigint comes back as a string from node-postgres; the values are
  // small counters, so Number() is exact well past any plausible session length.
  return Number((res.rows[0] as { m: string | number }).m) + 1;
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

/**
 * THE ROW BINDS TO THE BYTES (E03-B07; 046 §4 B4's K-1 amendment).
 *
 * `content_hash` is the SHA-256 of the bytes as STORED — computed on the stream
 * that is already being written, after the guard has dropped metadata, so the
 * digest is of the file on disk and not of what the client sent. 041 A5 pins the
 * class: SHA-256 of exact bytes, and no perceptual hash under this or any other
 * column without its own decision record.
 *
 * `storage_key` is the same server-minted key `storage_url` holds, written so
 * the deletion path (E03-B09, `media_deletion.storage_key`) and the restore
 * validation (046 I11) address an object by the column 003 reserved for it
 * rather than by parsing a path. `byte_size` is what makes the quota answerable
 * without a filesystem walk.
 */
export async function addScanPhoto(
  db: Queryable,
  args: {
    sessionId: string;
    shopId: string;
    kind: "cover" | "barcode" | "defect";
    storageUrl: string;
    storageKey: string;
    contentHash: string;
    byteSize: number;
  }
): Promise<{ id: string }> {
  const res = await db.query(
    `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url, storage_key, content_hash, byte_size)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      args.sessionId,
      args.shopId,
      args.kind,
      args.storageUrl,
      args.storageKey,
      args.contentHash,
      args.byteSize,
    ]
  );
  return res.rows[0] as { id: string };
}

/**
 * What this session and this shop are already holding (E03-B07's quota).
 *
 * ONE round trip for four numbers, and both halves are shop-scoped: the session
 * half carries `shop_id` in its predicate even though `scan_session_id` alone
 * would identify the rows, because a count that could be computed across a
 * tenant boundary is a count that will be one day (019 T24).
 *
 * `coalesce(byte_size, 0)` is why the sum is honest about legacy rows: a row
 * written before migration 018 has no size and contributes nothing, which
 * under-counts rather than inventing a number for it.
 */
export async function photoUsage(
  db: Queryable,
  shopId: string,
  sessionId: string
): Promise<{ sessionPhotos: number; sessionBytes: number; shopPhotos: number; shopBytes: number }> {
  const res = await db.query(
    `SELECT
       count(*) FILTER (WHERE scan_session_id = $2)::bigint            AS session_photos,
       coalesce(sum(byte_size) FILTER (WHERE scan_session_id = $2), 0)::bigint AS session_bytes,
       count(*)::bigint                                                 AS shop_photos,
       coalesce(sum(byte_size), 0)::bigint                              AS shop_bytes
     FROM scan_photo WHERE shop_id = $1`,
    [shopId, sessionId]
  );
  const row = res.rows[0] as {
    session_photos: string;
    session_bytes: string;
    shop_photos: string;
    shop_bytes: string;
  };
  return {
    sessionPhotos: Number(row.session_photos),
    sessionBytes: Number(row.session_bytes),
    shopPhotos: Number(row.shop_photos),
    shopBytes: Number(row.shop_bytes),
  };
}

/**
 * ONE photo, keyed on ALL THREE ids at once (E03-D05).
 *
 * `id AND scan_session_id AND shop_id` in one WHERE is the tenancy control, and
 * it is written as one predicate rather than as a fetch-then-compare on purpose:
 * a comparison in TypeScript is a step an author can forget, while a row that
 * does not match every id simply is not returned. A photo belonging to another
 * shop and a photo belonging to another session are therefore indistinguishable
 * from a photo that does not exist — which is exactly what 019 T24 wants the
 * outside to see.
 */
export async function findSessionPhoto(
  db: Queryable,
  shopId: string,
  sessionId: string,
  photoId: string
): Promise<{ id: string; kind: string; storage_url: string } | undefined> {
  const res = await db.query(
    `SELECT id, kind, storage_url FROM scan_photo
      WHERE id = $1 AND scan_session_id = $2 AND shop_id = $3`,
    [photoId, sessionId, shopId]
  );
  return res.rows[0] as { id: string; kind: string; storage_url: string } | undefined;
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
): Promise<{
  priorConfirmationId: string | undefined;
  priorConfirmation: unknown;
  topProposalSource: unknown;
}> {
  // 041 §3.4: "every read that drives a decision goes through `_current`". This
  // one drives two — the outcome baseline, and WHICH row a correction supersedes
  // — and 041 §3.3 point 2 rules that when a write supersedes, "the outcome
  // baseline IS the superseded row". Reading the raw table by insertion order
  // (what this did until E02-D09) makes those two rows the same only by
  // coincidence: after one correction the newest inserted row and the current row
  // are different rows, and the outcome would be scored against a record the
  // operator was never shown. `id` comes back too, because the caller needs the
  // predecessor's identity and re-reading for it would be a second snapshot.
  const prior = await tx.query(
    `SELECT id, confirmed_issue FROM human_confirmation_current
     WHERE scan_session_id = $1 AND shop_id = $2`,
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
  const priorRow = prior.rows[0] as { id: string; confirmed_issue: unknown } | undefined;
  return {
    priorConfirmationId: priorRow?.id,
    priorConfirmation: priorRow?.confirmed_issue,
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
    outcome: string;
    /** 041 §5.3 — from `assignSessionSeq`, under the anchor lock this `tx` holds. */
    sessionSeq: number;
    /** 048 §6.3 — from the session. Never from the body; `confirmed_by` stays unwritten. */
    operatorId?: string | null;
  }
): Promise<HumanConfirmationRow> {
  const res = await tx.query(
    `INSERT INTO human_confirmation
       (scan_session_id, shop_id, confirmed_issue, source, outcome, session_seq,
        operator_id, actor_verified)
     VALUES ($1,$2,$3,$4,$5,$6,$7::uuid,$7::uuid IS NOT NULL) RETURNING id, created_at, outcome, session_seq`,
    [
      args.sessionId,
      args.shopId,
      JSON.stringify(args.confirmedIssue),
      args.source,
      args.outcome,
      args.sessionSeq,
      args.operatorId ?? null,
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

/**
 * `outboxId` is the job that wrote this row, or null when a request did
 * (043 §8.1's one-meaning rule applied to a second column; migration 011 §4).
 *
 * `sessionSeq` comes from `assignSessionSeq` under the anchor lock. Since
 * E02-D07 the only caller is the `draft_requested` JOB, which therefore takes
 * that lock in its own recording transaction — see the note there on why one
 * lock in one transaction does not contend with 043 §7.2's outbox-first rule.
 *
 * IDEMPOTENT BY CONSTRAINT, NOT BY A READ-THEN-WRITE CHECK (043 §3.2, §11
 * I5(b)). The partial `UNIQUE (outbox_id) WHERE outbox_id IS NOT NULL` index is
 * what makes the `draft_requested` consumer correct under CONCURRENT duplicate
 * delivery, and `ON CONFLICT … DO NOTHING` is how this statement uses it: two
 * workers delivering one event at the same instant produce ONE row, and the
 * loser gets `undefined` rather than an exception to interpret.
 *
 * **`undefined` therefore means "another delivery of this same job already
 * recorded it", and it means nothing else** — the conflict target is the job id,
 * so nothing but a duplicate delivery can reach it. A caller that treats it as a
 * failure is wrong: the effect it owed has happened, and 043 §4.3's `customId`
 * upsert already guaranteed both calls resolved to ONE Shopify product.
 *
 * A `SELECT … then INSERT` here would be correct one-after-the-other and broken
 * at the same instant — the interleaving at-least-once delivery plus
 * `SKIP LOCKED` plus the visibility window makes reachable, and the one a test
 * that delivers twice in sequence would never catch.
 */
export async function insertShopifyDraft(
  tx: Tx,
  args: {
    sessionId: string;
    shopId: string;
    productGid: string | null;
    status: "draft" | "failed";
    error: string | null;
    /** 041 §5.3 — from `assignSessionSeq`, under the anchor lock this `tx` holds. */
    sessionSeq: number;
    /**
     * The outbox job that wrote this row, or null/omitted when a request did
     * (043 §8.1's one-meaning rule applied to a second column; migration 011).
     */
    outboxId?: string | null;
  }
): Promise<ShopifyDraftRow | undefined> {
  const res = await tx.query(
    `INSERT INTO shopify_draft (scan_session_id, shop_id, product_gid, status, error, session_seq, outbox_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (outbox_id) WHERE outbox_id IS NOT NULL DO NOTHING
     RETURNING id, product_gid, status, created_at, session_seq`,
    [
      args.sessionId,
      args.shopId,
      args.productGid,
      args.status,
      args.error,
      args.sessionSeq,
      args.outboxId ?? null,
    ]
  );
  return res.rows[0] as ShopifyDraftRow | undefined;
}

/**
 * The facts the `draft_requested` job needs, read on the pool at job time.
 *
 * Deliberately NOT read from `getSessionEvents`: that helper returns every row
 * of seven tables so a GET can render a trail, and a job that pulled all of it
 * to use three rows would make the read cost grow with the session's history.
 */
export async function readDraftFacts(
  db: Queryable,
  shopId: string,
  sessionId: string
): Promise<{
  confirmedIssue: Record<string, unknown> | undefined;
  pricing: { suggested_cents: number; override_cents: number | null } | undefined;
  assessment: { grade_range_low: string; grade_range_high: string; defects: string[] } | undefined;
  coverUrls: string[];
}> {
  const [confirmation, pricing, assessment, photos] = await Promise.all([
    // 041 §3.4, I8: EVERY READ THAT DRIVES A DECISION GOES THROUGH `_current`.
    // These three drive what a listing SAYS — the identity, the price and the
    // condition — and the newest inserted row is the current row only until
    // somebody corrects one. After one correction they are different rows, and a
    // draft composed from the newest INSERT would publish a record the operator
    // was never shown. The views also carry 041 §5's canonical order
    // (`session_seq` first), which `ORDER BY created_at DESC` does not.
    db.query(
      `SELECT confirmed_issue FROM human_confirmation_current
        WHERE scan_session_id = $1 AND shop_id = $2`,
      [sessionId, shopId]
    ),
    db.query(
      `SELECT suggested_cents, override_cents FROM pricing_snapshot_current
        WHERE scan_session_id = $1 AND shop_id = $2`,
      [sessionId, shopId]
    ),
    db.query(
      `SELECT grade_range_low, grade_range_high, defects FROM condition_assessment_current
        WHERE scan_session_id = $1 AND shop_id = $2`,
      [sessionId, shopId]
    ),
    db.query(
      `SELECT storage_url FROM scan_photo
        WHERE scan_session_id = $1 AND shop_id = $2 AND kind = 'cover' ORDER BY taken_at`,
      [sessionId, shopId]
    ),
  ]);
  return {
    confirmedIssue: (confirmation.rows[0] as { confirmed_issue: Record<string, unknown> } | undefined)
      ?.confirmed_issue,
    pricing: pricing.rows[0] as { suggested_cents: number; override_cents: number | null } | undefined,
    assessment: assessment.rows[0] as
      { grade_range_low: string; grade_range_high: string; defects: string[] } | undefined,
    // ⚠ THESE ARE ROOT-RELATIVE PATHS, AND SHOPIFY HAS NEVER BEEN ABLE TO FETCH
    // THEM (046 E28). `productSet` receives `/uploads/<session>/<file>` as an
    // `originalSource`, which is not a URL Shopify's fetcher can resolve — it
    // has no origin — so the draft's media has been silently empty the whole
    // time. E03-D05 did NOT make that worse and did not fix it: deleting the
    // public mount removed a reader that was never this one, because a path with
    // no scheme and no host was unfetchable while the mount was up.
    //
    // Left as it stands ON PURPOSE. Making it fetchable is a media decision — an
    // absolute public URL, a Shopify staged upload, or a signed URL from
    // E03-B07 — and it belongs to **E10-B04** with the rest of the draft's media,
    // not to a security bead deleting a mount. Serving it through the new
    // tenant-scoped route would not help either: Shopify is not an authenticated
    // caller of this API.
    coverUrls: (photos.rows as Array<{ storage_url: string }>).map((p) => `/${p.storage_url}`),
  };
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
