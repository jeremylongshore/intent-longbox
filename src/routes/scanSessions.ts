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
import {
  addScanPhoto,
  createScanSession,
  getScanSession,
  getSessionEvents,
  listSessionPhotos,
  setSessionStatus,
} from "../services/scanSession.js";
import { runIdentify } from "../services/identify.js";
import { GRADE_LABELS, validGradeRange } from "../services/condition.js";
import { resolveVisionProvider, resolveShopToken, resolveEbayCredentials } from "../providers/registry.js";
import {
  createPriceChartingProvider,
  type PricingPolicy,
  type PricingProvider,
  type PricingQuery,
} from "../services/pricing.js";
import { createEbayProvider, createStubEbayProvider } from "../services/ebay.js";
import { priceWithProviders } from "../services/pricingService.js";
import {
  buildProductSetInput,
  createShopifyClient,
  createStubShopifyClient,
  type ShopifyClient,
} from "../services/shopify.js";

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
    const res = await db.query(
      `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source, confirmed_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [session.id, session.shop_id, JSON.stringify(body.data.issue), body.data.source, body.data.confirmed_by]
    );
    await setSessionStatus(db, session.shop_id, session.id, "confirmed");
    return reply.code(201).send({ confirmation: res.rows[0] });
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

  app.post(`${base}/:id/draft`, async (req, reply) => {
    const params = sessionParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: params.error.flatten() });
    const session = await getScanSession(db, params.data.shopId, params.data.id);
    if (!session) return reply.code(404).send({ error: "scan session not found" });

    // Read the session's latest facts to compose the draft.
    const events = await getSessionEvents(db, session.shop_id, session.id);
    const confirmations = events.human_confirmation as
      Array<{ confirmed_issue: Record<string, unknown> }> | undefined;
    const confirmation = confirmations?.[confirmations.length - 1];
    if (!confirmation) return reply.code(409).send({ error: "session has no human confirmation yet" });
    const snapshots = events.pricing_snapshot as
      Array<{ suggested_cents: number; override_cents: number | null }> | undefined;
    const snapshot = snapshots?.[snapshots.length - 1];
    if (!snapshot) return reply.code(409).send({ error: "session has no pricing snapshot yet" });
    const assessments = events.condition_assessment as
      Array<{ grade_range_low: string; grade_range_high: string; defects: string[] }> | undefined;
    const assessment = assessments?.[assessments.length - 1];

    const issue = confirmation.confirmed_issue;
    const title = [issue.title, issue.issue ? `#${issue.issue}` : null, issue.variant ?? null]
      .filter(Boolean)
      .join(" ");
    const gradeCopy = assessment
      ? `Condition: ${assessment.grade_range_low === assessment.grade_range_high ? assessment.grade_range_low : `${assessment.grade_range_low}-${assessment.grade_range_high}`}${assessment.defects.length ? `. Noted: ${assessment.defects.join(", ").replace(/_/g, " ")}` : ""}`
      : "";
    const priceCents = snapshot.override_cents ?? snapshot.suggested_cents;

    const photos = await listSessionPhotos(db, session.shop_id, session.id);
    const imageUrls = photos.filter((p) => p.kind === "cover").map((p) => `/${p.storage_url}`);

    // Per-shop Shopify config object; stub until store creds exist.
    const shopRow = await requireShop(db, session.shop_id);
    const adminToken = await resolveShopToken(db, session.shop_id, "shopify", "SHOPIFY_ADMIN_TOKEN");
    const storeDomain = shopRow?.shopify_domain ?? process.env.SHOPIFY_STORE_DOMAIN;
    const client: ShopifyClient =
      adminToken && storeDomain
        ? createShopifyClient({
            storeDomain,
            adminToken,
            apiVersion: process.env.SHOPIFY_API_VERSION ?? "2025-07",
          })
        : createStubShopifyClient();

    const draftInput = {
      title: title || "Unidentified comic",
      descriptionHtml: `<p>${[issue.publisher, issue.year].filter(Boolean).join(", ")}</p><p>${gradeCopy}</p>`,
      priceCents,
      imageUrls,
    };
    const result = await client.createDraft(draftInput);
    const res = await db.query(
      `INSERT INTO shopify_draft (scan_session_id, shop_id, product_gid, status, error)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, product_gid, status, created_at`,
      [
        session.id,
        session.shop_id,
        result.productGid ?? null,
        result.ok ? "draft" : "failed",
        result.ok ? null : JSON.stringify(result.error ?? `status ${result.status}`),
      ]
    );
    if (result.ok) await setSessionStatus(db, session.shop_id, session.id, "drafted");
    return reply.code(result.ok ? 201 : 502).send({
      draft: res.rows[0],
      stub: !(adminToken && storeDomain),
      product_set_input: buildProductSetInput(draftInput),
    });
  });
}
