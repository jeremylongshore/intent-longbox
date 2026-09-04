// HTTP API — shop-scoped by path prefix: /api/shops/:shopId/scan-sessions/...
// Every route resolves the shop row first; nothing is hardcoded to one shop.
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { withTransaction } from "../db.js";
import {
  addScanPhoto,
  createScanSession,
  getScanSession,
  getSessionEvents,
  assignSessionSeq,
  insertHumanConfirmation,
  lockScanSession,
  readConfirmationBaseline,
  setSessionStatus,
} from "../services/scanSession.js";
import { DRAFT_REQUESTED } from "../events/catalogue.js";
import { enqueue } from "../services/outbox.js";
import { runIdentify } from "../services/identify.js";
import { GRADE_LABELS, validGradeRange } from "../services/condition.js";
import { decideOutcome, topCandidateOf } from "../services/confirmationOutcome.js";
import { resolveVisionProvider, resolveShopToken, resolveEbayCredentials } from "../providers/registry.js";
import {
  createPriceChartingProvider,
  type PricingPolicy,
  type PricingProvider,
  type PricingQuery,
} from "../services/pricing.js";
import { createEbayProvider, createStubEbayProvider } from "../services/ebay.js";
import { priceWithProviders } from "../services/pricingService.js";

/**
 * The error @fastify/multipart raises for an oversize file (its own
 * `RequestFileTooLargeError` is not exported). Constructed here so a
 * truncated stream produces the same 413 / FST_REQ_FILE_TOO_LARGE body a
 * caller gets from `toBuffer()`, instead of a silent success.
 */
function requestFileTooLarge(): Error & { statusCode: number; code: string } {
  const err = new Error("request file too large") as Error & { statusCode: number; code: string };
  err.statusCode = 413;
  err.code = "FST_REQ_FILE_TOO_LARGE";
  return err;
}

const shopParams = z.object({ shopId: z.string().uuid() });
const sessionParams = shopParams.extend({ id: z.string().uuid() });

const gradeEnum = z.enum(GRADE_LABELS);

async function requireShop(
  db: pg.Pool,
  shopId: string
): Promise<{ id: string; name: string; shopify_domain: string | null } | undefined> {
  const res = await db.query(`SELECT id, name, shopify_domain FROM shop WHERE id = $1`, [shopId]);
  return res.rows[0] as { id: string; name: string; shopify_domain: string | null } | undefined;
}

async function latestPolicy(
  db: pg.Pool,
  shopId: string
): Promise<{ id: string; policy: PricingPolicy } | undefined> {
  const res = await db.query(
    `SELECT id, comp_percent, floor_cents, rounding_rule FROM shop_pricing_policy
     WHERE shop_id = $1 ORDER BY effective_from DESC LIMIT 1`,
    [shopId]
  );
  const row = res.rows[0] as
    | { id: string; comp_percent: number; floor_cents: number; rounding_rule: PricingPolicy["roundingRule"] }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    policy: { compPercent: row.comp_percent, floorCents: row.floor_cents, roundingRule: row.rounding_rule },
  };
}

/**
 * 041 §4.4 wraps the routes in an order set by how many blocked invariants each
 * unblocks. **This bead (E02-D04) lands orders 0, 1 and 2 only** — the helper
 * plus the anchor read, `POST …/draft`, and `POST …/confirm`.
 *
 * Deliberately NOT wrapped here, and named so the omission is a decision rather
 * than an oversight — each is E02-B08's execution:
 *   - `POST …/identify` (order 3) — binds `candidate_set` to the `llm_rerank`
 *     the same request produced (029 §12 point 4), and owes 040 §4.6 an error
 *     record on its 502, which is E06's.
 *   - `POST …/condition` and `POST …/price` (order 4) — the supersession path
 *     for the other two corrected tables; `priceWithProviders` writes one row
 *     per source through its own provider fan-out and those must land together.
 *   - `POST …/photos` (order 5) — last by design: G-a's consent record does not
 *     exist until E01-B06 / E03-B09, so wrapping it earlier protects a guard
 *     with nothing to read, and its temp-file/rename compensation is a
 *     filesystem write the transaction does not replace.
 *
 * Also NOT here: `request_idempotency`, the `against_*` staleness check and the
 * `409` contract (042 §5, §6) — those are E02-B08's execution beads and E02-B10's
 * migrations. What this bead leaves them is the seam: one held connection per
 * request, the client as the first parameter of every writing function, and the
 * anchor lock as the first statement inside `fn` so the idempotency INSERT has
 * exactly one correct place to go — before it (042 §5.3(b)).
 *
 * And NOT here, deliberately: **the lock-order lint (042 A6 / I22)** that asserts
 * over handler bodies that the `request_idempotency` INSERT precedes the anchor
 * `FOR UPDATE`. It is **E02-B10's gate** and it is not merely unbuilt — it has
 * nothing to assert until the idempotency row exists, because today the anchor
 * lock is the only lock in the order. 042 §5.3(b) is explicit that the rule must
 * be enforced by a lint rather than by review, "because a handler written six
 * months from now by someone who has not read this section is exactly the case
 * the rule exists for" — so the ordering below is correct by construction today
 * and unguarded against a future handler until that gate lands.
 */
export function registerScanSessionRoutes(app: FastifyInstance, db: pg.Pool, config: AppConfig): void {
  const base = "/api/shops/:shopId/scan-sessions";

  // List shops (lets the UI pick a shop without hardcoding).
  app.get("/api/shops", async () => {
    const res = await db.query(`SELECT id, name, slug FROM shop ORDER BY created_at`);
    return { shops: res.rows };
  });

  app.post(base, async (req, reply) => {
    const params = shopParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() });
    const shop = await requireShop(db, params.data.shopId);
    if (!shop) return reply.code(404).send({ error: "shop not found" });
    const body = z
      .object({ created_by: z.string().min(1).max(200).default("employee") })
      .safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    const session = await createScanSession(db, shop.id, body.data.created_by);
    return reply.code(201).send({ session });
  });

  app.get(`${base}/:id`, async (req, reply) => {
    const params = sessionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() });
    const session = await getScanSession(db, params.data.shopId, params.data.id);
    if (!session) return reply.code(404).send({ error: "scan session not found" });
    const events = await getSessionEvents(db, params.data.shopId, params.data.id);
    return { session, events };
  });

  // Photo upload: multipart file + kind field. v0 stores to local uploads/ dir.
  app.post(`${base}/:id/photos`, async (req, reply) => {
    const params = sessionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() });
    const session = await getScanSession(db, params.data.shopId, params.data.id);
    if (!session) return reply.code(404).send({ error: "scan session not found" });

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "multipart file field required" });
    const kindRaw = (file.fields.kind as { value?: string } | undefined)?.value ?? "cover";
    const kind = z.enum(["cover", "barcode", "defect"]).safeParse(kindRaw);
    if (!kind.success) return reply.code(400).send({ error: "kind must be cover|barcode|defect" });

    const ext = file.mimetype === "image/png" ? "png" : file.mimetype === "image/webp" ? "webp" : "jpg";
    const dir = join(config.uploadsDir, session.id);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${Date.now()}-${kind.data}.${ext}`);
    // Write to a temp path and rename only on success, so a stream that fails
    // or gets truncated at the multipart fileSize limit never leaves a
    // half-written file at the storage_url a scan_photo row would point at.
    const tmpPath = `${path}.part`;
    try {
      await pipeline(file.file, createWriteStream(tmpPath));
      // @fastify/multipart enforces `limits.fileSize` by truncating the busboy
      // stream, not by erroring: without this check an oversize upload yields a
      // silently clipped file plus a 201.
      if (file.file.truncated) throw requestFileTooLarge();
      await rename(tmpPath, path);
    } catch (err) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      throw err;
    }

    let photo;
    try {
      photo = await addScanPhoto(db, {
        sessionId: session.id,
        shopId: session.shop_id,
        kind: kind.data,
        storageUrl: path,
      });
    } catch (err) {
      // No row means no owner for the bytes — do not leave them on disk.
      await rm(path, { force: true }).catch(() => undefined);
      throw err;
    }
    return reply.code(201).send({ photo: { id: photo.id, kind: kind.data, storage_url: path } });
  });

  app.post(`${base}/:id/identify`, async (req, reply) => {
    const params = sessionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() });
    const session = await getScanSession(db, params.data.shopId, params.data.id);
    if (!session) return reply.code(404).send({ error: "scan session not found" });
    const body = z
      .object({
        barcode_digits: z
          .string()
          .regex(/^[\d\s-]+$/)
          .optional(),
      })
      .safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    let provider;
    try {
      provider = await resolveVisionProvider(db, session.shop_id);
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message });
    }
    const outcome = await runIdentify(db, {
      shopId: session.shop_id,
      sessionId: session.id,
      provider,
      bands: config.bands,
      uploadsDir: config.uploadsDir,
      ...(body.data.barcode_digits !== undefined ? { barcodeDigits: body.data.barcode_digits } : {}),
    });
    if (outcome.error) return reply.code(502).send(outcome);
    return outcome;
  });

  app.post(`${base}/:id/confirm`, async (req, reply) => {
    const params = sessionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() });
    const session = await getScanSession(db, params.data.shopId, params.data.id);
    if (!session) return reply.code(404).send({ error: "scan session not found" });
    const body = z
      .object({
        issue: z.record(z.unknown()), // candidate payload or manual entry
        source: z.enum(["one_tap", "grid_pick", "manual_search", "owner_review"]),
        confirmed_by: z.string().min(1).max(200).default("employee"),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    // 041 §4.4 order 2 — the whole confirmation lands in ONE transaction on ONE
    // held connection: the anchor lock, the two baseline reads, the INSERT and
    // the status write commit together or not at all. Before this, the INSERT
    // and setSessionStatus were two unprotected steps, so a failure between them
    // left a confirmed book on an unconfirmed session (029 §12's half-written
    // chain). The `FOR UPDATE` also makes the baselines a decision about a
    // session nothing else can advance underneath — which is what the
    // supersession writer (041 §3.3) and the two-device check (040 §5.1) will
    // both need, and neither is wired here: that is E02-B08's execution.
    //
    // NOTE the lock order this handler sets, for every handler that follows it
    // (042 §5.3(b)): the `request_idempotency` INSERT goes BEFORE this anchor
    // lock. There is no idempotency row to insert yet — the table, the 409
    // contract and the `against` check are E02-B08's execution beads, NOT this
    // one — but the anchor lock is deliberately the FIRST statement inside `fn`
    // so that inserting identity ahead of it is the only place left to put it.
    const confirmation = await withTransaction(
      db,
      async (tx) => {
        const locked = await lockScanSession(tx, session.shop_id, session.id);
        if (!locked) return undefined;
        // 041 §5.3: the per-session commit counter, assigned under the anchor lock
        // taken one line above and at no additional cost. It is COMMIT order, never
        // act order — see `assignSessionSeq`.
        const sessionSeq = await assignSessionSeq(tx, session.shop_id, session.id);

        // outcome (019 §3.0, T3, T20): did the operator accept the identity that
        // was already there, or change it? Computed here because this is the only
        // place the baseline and the pick are both in hand, and written on the
        // INSERT because the row is immutable afterwards — an outcome not recorded
        // now can never be recovered (030 A1: no append-only row is backfilled).
        //
        // Two baselines, prior confirmation first (see decideOutcome): T20 measures
        // owner edits to the identity the owner INHERITED, so an owner_review that
        // agrees with an employee's correction is 'confirm' even though it disagrees
        // with the model, and one that reverts to the model's top candidate is
        // 'correct' even though it agrees with it.
        const baseline = await readConfirmationBaseline(tx, session.shop_id, session.id);
        const outcome = decideOutcome({
          source: body.data.source,
          confirmed: body.data.issue,
          topProposal: topCandidateOf(baseline.topProposalSource),
          priorConfirmation: baseline.priorConfirmation,
        });

        const row = await insertHumanConfirmation(tx, {
          sessionId: session.id,
          shopId: session.shop_id,
          confirmedIssue: body.data.issue,
          source: body.data.source,
          confirmedBy: body.data.confirmed_by,
          outcome,
          sessionSeq,
        });
        await setSessionStatus(tx, session.shop_id, session.id, "confirmed");
        return row;
      },
      { label: "confirm" }
    );
    if (!confirmation) return reply.code(404).send({ error: "scan session not found" });
    return reply.code(201).send({ confirmation });
  });

  app.post(`${base}/:id/condition`, async (req, reply) => {
    const params = sessionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() });
    const session = await getScanSession(db, params.data.shopId, params.data.id);
    if (!session) return reply.code(404).send({ error: "scan session not found" });
    const body = z
      .object({
        grade_range_low: gradeEnum,
        grade_range_high: gradeEnum,
        defects: z.array(z.string().max(100)).default([]),
        notes: z.string().max(2000).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    if (!validGradeRange(body.data.grade_range_low, body.data.grade_range_high)) {
      return reply.code(400).send({ error: "grade_range_low must not exceed grade_range_high" });
    }
    const res = await db.query(
      `INSERT INTO condition_assessment (scan_session_id, shop_id, grade_range_low, grade_range_high, defects, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [
        session.id,
        session.shop_id,
        body.data.grade_range_low,
        body.data.grade_range_high,
        body.data.defects,
        body.data.notes ?? null,
      ]
    );
    return reply.code(201).send({ assessment: res.rows[0] });
  });

  app.post(`${base}/:id/price`, async (req, reply) => {
    const params = sessionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() });
    const session = await getScanSession(db, params.data.shopId, params.data.id);
    if (!session) return reply.code(404).send({ error: "scan session not found" });
    // Structured query preferred; legacy `query` string still accepted (used
    // as the title). At least one of the two must be present.
    const body = z
      .object({
        title: z.string().min(1).max(300).optional(),
        issue: z.string().min(1).max(50).optional(),
        variant: z.string().min(1).max(200).optional(),
        grade: z.string().min(1).max(50).optional(),
        upc: z.string().min(1).max(50).optional(),
        query: z.string().min(1).max(500).optional(),
        override_cents: z.number().int().positive().optional(),
      })
      .refine((b) => b.title !== undefined || b.query !== undefined, {
        message: "title (or legacy query) is required",
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

    const found = await latestPolicy(db, session.shop_id);
    if (!found) return reply.code(409).send({ error: "shop has no pricing policy; run register-shop" });

    const query: PricingQuery = {
      title: body.data.title ?? body.data.query!,
      ...(body.data.issue !== undefined ? { issue: body.data.issue } : {}),
      ...(body.data.variant !== undefined ? { variant: body.data.variant } : {}),
      ...(body.data.grade !== undefined ? { grade: body.data.grade } : {}),
      ...(body.data.upc !== undefined ? { upc: body.data.upc } : {}),
    };

    // ALL configured pricing providers run; each falls back to a clearly
    // flagged stub when its creds are missing (per-shop key_ref override,
    // global env fallback — same resolution as every other credential).
    const pcToken = await resolveShopToken(db, session.shop_id, "pricecharting", "PRICECHARTING_TOKEN");
    const ebayCreds = await resolveEbayCredentials(db, session.shop_id);
    const providers: PricingProvider[] = [
      pcToken ? createPriceChartingProvider({ token: pcToken }) : createPriceChartingProvider({}),
      ebayCreds ? createEbayProvider(ebayCreds) : createStubEbayProvider(),
    ];

    const overrideCents = body.data.override_cents;
    const result = await priceWithProviders(db, {
      sessionId: session.id,
      shopId: session.shop_id,
      providers,
      policy: found.policy,
      policyId: found.id,
      query,
      ...(overrideCents !== undefined ? { overrideCents } : {}),
    });
    return reply.code(201).send({
      ...result,
      // Legacy convenience flags for callers that only care "was any of this real?"
      stub: result.sources.every((s) => s.status !== "ok" || s.stub),
    });
  });

  /**
   * `POST …/draft` NO LONGER CALLS SHOPIFY (043 §4.1, §9.1 rows 4 and 5).
   *
   * It runs its gates, appends `longbox.commerce.draft_requested` INSIDE the
   * request transaction, and returns `202 Accepted` carrying the outbox row's
   * id. A worker claims the row, calls `productSet` and records `shopify_draft`
   * in its own transaction (`src/consumers/draftRequested.ts`).
   *
   * WHAT THIS CLOSES. Until this change, `createDraft` ran from the handler,
   * outside and before the transaction that recorded it — so a success followed
   * by any failure (the session deleted between the read and the anchor lock, a
   * constraint, a dropped connection) left a real DRAFT product in a shop's
   * store with NO `shopify_draft` row naming it. The old comment here said so
   * and assigned the fix to this bead; that window is closed by the outbox, not
   * by rearranging this handler, because a Shopify mutation cannot join a
   * Postgres transaction and no arrangement of this code could have closed it.
   *
   * THE GATES DO NOT MOVE (043 §4.2). A missing confirmation or pricing snapshot
   * still gets a 409 IMMEDIATELY: both are reads of the session, and 040 F6's
   * condition gate and 040 G-c's retention hold will join them here rather than
   * in the worker. What the caller stops getting is the 201-with-a-product-id.
   *
   * WHY THAT IS THE RIGHT TRADE FOR THE PERSON HOLDING THE BOOK (022 P4). An
   * operator at a long box wants the next book, not a Shopify product id, and
   * 019 T10's ≤90 s median is capture-to-draft. A draft that is OWED and RECORDED
   * at the moment of the tap is a better answer than a request that blocks on a
   * third party's latency. The one thing that must not degrade is honesty of the
   * screen: the operator is told the listing is BEING CREATED, never that it
   * exists — carried to E05 for the registered copy (043 §9.3).
   *
   * ⚠ WHAT IS DELIBERATELY NOT HERE. The full 202 DTO and its error codes are
   * 042's contract and E02-B08's execution (043 §9.1 row 5); this route fixes
   * only that the effect is asynchronous. `request_idempotency` is likewise
   * E02-B08's — so a double tap enqueues a SECOND `draft_requested` (the command
   * event self-references and so has a fresh unique key each time, 043 §3.4),
   * and the second job is caught one layer later by the consumer's fail-closed
   * guard, which refuses it and dead-letters `no_observation_evidence`. Slow, and
   * correct (043 §12.2).
   */
  app.post(`${base}/:id/draft`, async (req, reply) => {
    const params = sessionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() });
    const session = await getScanSession(db, params.data.shopId, params.data.id);
    if (!session) return reply.code(404).send({ error: "scan session not found" });

    // The gates, as reads, before anything is owed. 042 registers both codes.
    const events = await getSessionEvents(db, session.shop_id, session.id);
    const confirmations = events.human_confirmation as
      Array<{ confirmed_issue: Record<string, unknown> }> | undefined;
    if (!confirmations?.length) {
      return reply.code(409).send({ error: "session has no human confirmation yet" });
    }
    const snapshots = events.pricing_snapshot as
      Array<{ suggested_cents: number; override_cents: number | null }> | undefined;
    if (!snapshots?.length) {
      return reply.code(409).send({ error: "session has no pricing snapshot yet" });
    }

    // 041 §4.4 order 1, now in its final shape: the anchor lock and the outbox
    // append are one commit, and there is NO side effect inside `fn` at all —
    // not merely none that could be retried. 041 §4.1's rule ("`fn` performs no
    // side effect outside the transaction. No provider call, no Shopify
    // mutation, no file write") stops being a constraint this handler works
    // around and becomes a description of what it does.
    const enqueued = await withTransaction(
      db,
      async (tx) => {
        const locked = await lockScanSession(tx, session.shop_id, session.id);
        if (!locked) return undefined;
        // 041 §5.3, the same seam E02-B10 wired into the confirm path, and the
        // outbox is the one place it does more than bookkeeping: 043 §3.2
        // promises that WITHIN ONE SESSION events are delivered in `session_seq`
        // order, and 043 §7.2's claim query sorts by it. Assigned here, under the
        // anchor lock this transaction already holds, because that lock is what
        // makes `max + 1` atomic — called without it, it is a race.
        const sessionSeq = await assignSessionSeq(tx, session.shop_id, session.id);
        return enqueue(tx, {
          shopId: session.shop_id,
          event: DRAFT_REQUESTED,
          scanSessionId: session.id,
          sessionSeq,
          // A person tapped the button, and nothing verified who: 041 §2.3's
          // `authored_by` says a human decided it and `actor_verified` (false by
          // default) says nobody checked. Recording it as a system act would be
          // the cheaper lie.
          authoredBy: "human",
        });
      },
      { label: "draft-enqueue" }
    );
    if (!enqueued) return reply.code(404).send({ error: "scan session not found" });

    return reply.code(202).send({
      status: "accepted",
      outbox_id: enqueued.id,
      already_requested: enqueued.alreadyEnqueued,
    });
  });
}
