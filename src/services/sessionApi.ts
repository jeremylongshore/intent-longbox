// The application service behind the HTTP edge — one function per route, each
// returning the wire status and a DTO-shaped body, each throwing `LongboxError`
// with a registry code (042 §4).
//
// WHY THIS FILE EXISTS (029 §5 move 6, defect N2; 042 I20). The route file
// reached the database directly: three `db.query` calls, a `pg` import and a
// provider import, on a layer 029 §3.1 says is thin — "a route validates and
// calls one function". Import-graph analysis cannot see most of that, because
// the damage was `db.query` on a Pool passed as a PARAMETER. Moving the
// statements is what closes it; the gate's exact-count inventory is what keeps
// it closed, and `ROUTE_DB_ROWS` is now empty rather than a declared defect.
//
// THE SHAPE OF EVERY MUTATING FUNCTION IS THE SAME, and it is the shape 042 §5
// and §6 require rather than a style:
//
//   1. do the non-transactional work first — a provider call, a file write —
//      because 041 §4.1 forbids a side effect inside the transaction body and
//      that rule is what makes the retry sound;
//   2. `runIdempotent`, which opens ONE transaction on ONE held connection and
//      INSERTs `request_idempotency` as its FIRST statement (042 I22's fixed
//      lock order: identity before subject);
//   3. `lockScanSession` — the anchor (041 §4.2);
//   4. `assertWorldViewIsCurrent` — the causal check, under that lock, which is
//      what makes the refusal deterministic rather than racy (042 §6);
//   5. the appends;
//   6. the response, stored on the idempotency row in the same commit.
import type pg from "pg";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { extname, join, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { mediaPolicy, type AppConfig } from "../config.js";
import type { Queryable, Tx } from "../db.js";
import { LongboxError } from "../contracts/v1/errors.js";
import {
  EVENT_PROJECTIONS,
  EVENT_TABLES,
  type Against,
  type conditionRequest,
  type confirmRequest,
  type draftRequest,
  type EventTable,
  type identifyRequest,
  type priceRequest,
  type SessionDetail,
} from "../contracts/v1/schemas.js";
import type { z } from "zod";
import { DRAFT_REQUESTED } from "../events/catalogue.js";
import { resolveEbayCredentials, resolveShopToken, resolveVisionProvider } from "../providers/registry.js";
import type { VisionProvider } from "../providers/types.js";
import { createImageSanitizer, MediaRejected, quotaBreach, type MediaVerdict } from "./media.js";
import { enqueue } from "./outbox.js";
import { replayIfSettled, runIdempotent, type IdempotentOutcome } from "./idempotency.js";
import { createEbayProvider, createStubEbayProvider } from "./ebay.js";
import {
  createPriceChartingProvider,
  type PricingPolicy,
  type PricingProvider,
  type PricingQuery,
} from "./pricing.js";
import { fetchPricing, recordPricing } from "./pricingService.js";
import { planIdentify, readLatestRerank, recordIdentify, toOutcome } from "./identify.js";
import { insertConditionAssessment, readCurrentConditionAssessment, validGradeRange } from "./condition.js";
import { decideOutcome, topCandidateOf } from "./confirmationOutcome.js";
import { COMIC_VERTICAL, resolveConfirmationIdentity } from "./identityResolution.js";
import { supersede } from "./supersession.js";
import {
  addScanPhoto,
  assignSessionSeq,
  createScanSession,
  findSessionPhoto,
  getScanSession,
  getSessionEvents,
  insertHumanConfirmation,
  lockScanSession,
  photoUsage,
  readConfirmationBaseline,
  setSessionStatus,
} from "./scanSession.js";
import type { ShopRateLimiter } from "./rateLimit.js";
import { assertWorldViewIsCurrent, deriveState, readTransitions, readWitnessFlags } from "./worldView.js";

export interface ApiDeps {
  pool: pg.Pool;
  config: AppConfig;
  limiter: ShopRateLimiter;
}

/** What every route hands the service beyond its validated body. */
export interface CallContext {
  shopId: string;
  sessionId?: string;
  idempotencyKey: string;
  /** The route TEMPLATE (042 §5.2), never the resolved path. */
  route: string;
  method: string;
  /**
   * 048 §6.3 — the operator, FROM THE SESSION AND FROM NOWHERE ELSE.
   *
   * Every write records it and sets `actor_verified = true`; neither is ever
   * accepted from a request body (I8, and the `.strict()` schemas make a body
   * that tries a `VALIDATION_FAILED`). It is optional in the TYPE only because a
   * route on the auth allowlist has no operator; every shop-scoped route runs
   * behind a `device+operator` requirement, so on those it is always present.
   *
   * `created_by` and `confirmed_by` stay unwritten (041 §8.4) and are never
   * resurrected as a fallback: a system that writes both a verified id and an
   * unverified string has two attributions and no rule for which is true.
   */
  operatorId?: string;
  /** 048 K1's session lock, run by `runIdempotent` at its declared position. */
  sessionLock?: (tx: Tx) => Promise<void>;
}

interface ShopRow {
  id: string;
  name: string;
  shopify_domain: string | null;
}

async function requireShop(db: Queryable, shopId: string): Promise<ShopRow> {
  const res = await db.query(`SELECT id, name, shopify_domain FROM shop WHERE id = $1`, [shopId]);
  const shop = res.rows[0] as ShopRow | undefined;
  if (!shop) throw new LongboxError("SHOP_NOT_FOUND");
  return shop;
}

async function requireSession(db: Queryable, shopId: string, sessionId: string): Promise<{ id: string }> {
  const session = await getScanSession(db, shopId, sessionId);
  if (!session) throw new LongboxError("SESSION_NOT_FOUND");
  return session;
}

/** The anchor lock, refusing in the contract's vocabulary. */
async function lockOrRefuse(tx: Tx, shopId: string, sessionId: string): Promise<void> {
  const locked = await lockScanSession(tx, shopId, sessionId);
  if (!locked) throw new LongboxError("SESSION_NOT_FOUND");
}

function idempotentRequest(ctx: CallContext, body: unknown) {
  return {
    shopId: ctx.shopId,
    idempotencyKey: ctx.idempotencyKey,
    route: ctx.route,
    method: ctx.method,
    params: ctx.sessionId ? { shopId: ctx.shopId, id: ctx.sessionId } : { shopId: ctx.shopId },
    body,
    ...(ctx.sessionLock ? { sessionLock: ctx.sessionLock } : {}),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listShops(db: Queryable): Promise<{ shops: unknown[] }> {
  const res = await db.query(`SELECT id, name, slug FROM shop ORDER BY created_at`);
  return { shops: res.rows };
}

/** Keep only the keys the DTO declares (042 §3.3). */
function project<T extends Record<string, unknown>>(
  row: T,
  keys: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = row[key] ?? null;
  return out;
}

export async function getSessionDetail(
  db: Queryable,
  shopId: string,
  sessionId: string
): Promise<SessionDetail> {
  const session = await getScanSession(db, shopId, sessionId);
  if (!session) throw new LongboxError("SESSION_NOT_FOUND");
  const [raw, transitions, flags] = await Promise.all([
    getSessionEvents(db, shopId, sessionId),
    readTransitions(db, shopId, sessionId),
    readWitnessFlags(db, shopId, sessionId),
  ]);

  // The trail READ stays complete (041 I9) and the PROJECTION is declared. E16
  // is why the two are different properties: without this, every column a future
  // migration adds to a witness table lands in a response body on the day that
  // migration applies, with no route, test or reviewer involved.
  const events = Object.fromEntries(
    EVENT_TABLES.map((table: EventTable) => [
      table,
      (raw[table] ?? []).map((row) => project(row as Record<string, unknown>, EVENT_PROJECTIONS[table])),
    ])
  );

  return {
    session: { id: session.id, shop_id: session.shop_id, created_at: session.created_at },
    state: deriveState(flags, transitions),
    transitions: transitions.map((t) => ({
      id: t.id,
      kind: t.kind,
      reopened_to_rung: t.reopened_to_rung,
      created_at: t.created_at,
    })),
    events,
  } as SessionDetail;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createSession(deps: ApiDeps, ctx: CallContext): Promise<IdempotentOutcome> {
  const shop = await requireShop(deps.pool, ctx.shopId);
  return runIdempotent(deps.pool, idempotentRequest(ctx, {}), async (tx) => {
    // 041 §8.4 / 042 I1: `created_by` is NOT passed. A personal identifier is not
    // a value in the log, and a comment saying a column is deprecated with
    // nothing asserting it stopped being written is a note rather than a
    // deprecation (041 A8).
    const session = await createScanSession(tx, shop.id, ctx.operatorId);
    return {
      status: 201,
      body: { session: { id: session.id, shop_id: session.shop_id, created_at: session.created_at } },
    };
  });
}

export interface PhotoUpload {
  stream: NodeJS.ReadableStream & { truncated?: boolean };
  mimetype: string;
  kind: "cover" | "barcode" | "defect";
}

/**
 * 042 §5.5 — the multipart case.
 *
 * `request_hash` covers the non-file fields plus the SHA-256 of the file bytes,
 * **computed on the stream that is already being written to disk**: no second
 * read, no buffering, and the digest is the same one `scan_photo.content_hash`
 * will want (003 §35-36), so it is computed once and used twice.
 *
 * The ordering already in the tree is preserved and is load-bearing: write to a
 * `.part` path, rename on success, remove the bytes if the row insert fails. The
 * filesystem write stays OUTSIDE the transaction and the idempotency row stays
 * inside it (041 §8.2's rule for an operation spanning a transactional store and
 * a non-transactional one), which means a replayed photo POST can re-write bytes
 * it then discards — cheap and correct — and can never double-append a row.
 */
export async function uploadPhoto(
  deps: ApiDeps,
  ctx: CallContext & { sessionId: string },
  upload: PhotoUpload,
  against: Against | undefined
): Promise<IdempotentOutcome> {
  const session = await requireSession(deps.pool, ctx.shopId, ctx.sessionId);
  const policy = mediaPolicy(deps.config);

  // THE QUOTA IS THE CHEAPEST REJECTION AND SO IT IS THE FIRST (046 §4 B4).
  // A session or a shop that is already at its ceiling is refused before a byte
  // reaches the disk the ceiling exists to protect.
  const breach = quotaBreach(await photoUsage(deps.pool, ctx.shopId, session.id), policy);
  if (breach) throw new LongboxError("PHOTO_QUOTA_EXCEEDED", { ...breach });

  const dir = join(deps.config.uploadsDir, session.id);
  await mkdir(dir, { recursive: true });

  // THE STORAGE KEY IS MINTED HERE AND NOWHERE ELSE (046 §4 B4's Information
  // Disclosure cell: "path is server-composed"). `upload.filename` is not a
  // parameter of this function, so there is no client string to sanitise — the
  // traversal question is answered by construction on the write side exactly as
  // `readPhoto` answers it on the read side.
  //
  // The random suffix closes the collision the E03-B07-D1 invariant review
  // found: `Date.now()-kind.ext` gives two same-kind uploads inside one
  // millisecond the SAME path, and the second rename silently overwrote the
  // first — orphaning the first row's bytes under a row that still names them.
  // The temp file is randomly named for the same reason.
  //
  // The extension comes from the DETECTED type below, never from the declared
  // mimetype, which is what makes `readPhoto`'s `SERVABLE_TYPES` map and
  // `identify`'s extension-derived `media_type` (046 E6's second half) tell a
  // third party the truth about the bytes.
  const tmpPath = join(dir, `${randomUUID()}.part`);

  const digest = createHash("sha256");
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      digest.update(chunk as Buffer);
      cb(null, chunk);
    },
  });
  // The guard runs BEFORE the digest tap, so `content_hash` is the hash of the
  // bytes as STORED — after metadata is dropped — rather than of what arrived.
  const guard = createImageSanitizer(policy);

  let verdict: MediaVerdict;
  let path: string;
  try {
    await pipeline(upload.stream, guard.stream, tap, createWriteStream(tmpPath));
    // @fastify/multipart enforces `limits.fileSize` by TRUNCATING the busboy
    // stream, not by erroring: without this check an oversize upload yields a
    // silently clipped file plus a 201.
    if (upload.stream.truncated === true) throw fileTooLarge();
    verdict = guard.finish();
    path = join(dir, `${Date.now()}-${upload.kind}-${randomUUID().slice(0, 8)}${verdict.extension}`);
    await rename(tmpPath, path);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    // A truncated stream is 413 whatever the guard made of the clipped bytes:
    // the caller's file was too large, and telling them it was malformed would
    // send them to fix the wrong thing.
    if (upload.stream.truncated === true) throw fileTooLarge();
    throw err instanceof MediaRejected ? new LongboxError(err.code) : err;
  }

  let contentHash = digest.digest("hex");
  if (verdict.riffSizePatch !== undefined) {
    // A RIFF header states the file's own length and dropping an `EXIF`/`XMP `
    // chunk changes it, so those four bytes are corrected in place — and the
    // digest is then taken again over the finished file, because a hash of the
    // pre-patch bytes would name a file that is not the one on disk.
    contentHash = await patchRiffSizeAndRehash(path, verdict.riffSizePatch);
  }

  try {
    const outcome = await runIdempotent(
      deps.pool,
      idempotentRequest(ctx, { kind: upload.kind, content_sha256: contentHash, against }),
      async (tx) => {
        await lockOrRefuse(tx, ctx.shopId, session.id);
        await assertWorldViewIsCurrent(tx, ctx.shopId, session.id, against);
        const photo = await addScanPhoto(tx, {
          sessionId: session.id,
          shopId: ctx.shopId,
          kind: upload.kind,
          storageUrl: path,
          storageKey: relative(deps.config.uploadsDir, path),
          contentHash,
          byteSize: verdict.bytesOut,
        });
        // `storage_url` is DELIBERATELY not in the body (042 §3.5): a photo is
        // addressed by a shop-scoped, time-bounded signed URL issued by the
        // owning module, and `scan_photo.storage_key` is an internal reference.
        return { status: 201, body: { photo: { id: photo.id, kind: upload.kind } } };
      }
    );
    if (outcome.replayed) await rm(path, { force: true }).catch(() => undefined);
    return outcome;
  } catch (err) {
    // No row means no owner for the bytes — do not leave them on disk.
    await rm(path, { force: true }).catch(() => undefined);
    throw err;
  }
}

/**
 * The extensions this server itself writes, and the only ones it will serve
 * (E03-D05). The extension is not the client's: `uploadPhoto` derives it from
 * the detected type and writes it into the storage key, so this map turns a
 * value THIS PROCESS chose back into a content type. Anything else on disk — a
 * hand-placed file, a future format nobody wired — is unservable rather than
 * guessed, because guessing is how a stored `.html` becomes a same-origin script.
 */
const SERVABLE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

export interface PhotoBytes {
  stream: NodeJS.ReadableStream;
  contentType: string;
  contentLength: number;
}

/**
 * Serve ONE photo's bytes to the shop that owns it (E03-D05, 046 §6 Q5).
 *
 * This is the whole replacement for the deleted public `uploads/` mount, and
 * three properties are the point:
 *
 *  1. **The path is built from the STORED key and from nothing else.** No
 *     request field reaches the filesystem — not the photo id (a UUID by the
 *     time it arrives), not a name, not a segment. Traversal is impossible by
 *     construction rather than by sanitising: there is no request-derived string
 *     to sanitise. The `realpath`-and-compare below is defence in depth against
 *     a future writer of `storage_url`, not the control — and it is `realpath`
 *     rather than `resolve` because a lexical compare passes a symlink that
 *     points out of the tree.
 *  2. **Every miss is the same 404.** Another shop's photo, another session's
 *     photo, a row whose bytes are gone, an extension we do not serve — one
 *     answer, `PHOTO_NOT_FOUND`. A 403 anywhere here would be an oracle for
 *     "this id exists somewhere else", which is the 019 T24 line stated as a
 *     status code.
 *  3. **It is a stream, not a buffer.** A 25 MiB photograph never becomes 25 MiB
 *     of heap per concurrent reader.
 */
export async function readPhoto(
  deps: ApiDeps,
  shopId: string,
  sessionId: string,
  photoId: string
): Promise<PhotoBytes> {
  await requireSession(deps.pool, shopId, sessionId);
  const photo = await findSessionPhoto(deps.pool, shopId, sessionId, photoId);
  if (!photo) throw new LongboxError("PHOTO_NOT_FOUND");

  const contentType = SERVABLE_TYPES[extname(photo.storage_url).toLowerCase()];
  if (!contentType) throw new LongboxError("PHOTO_NOT_FOUND");

  // CONTAINMENT IS RESOLVED ON DISK, NOT LEXICALLY (invariant review of
  // 3acb685). `resolve()` only normalises the STRING: a symlink at
  // `uploads/<session>/cover.png` pointing at `/etc/shadow` normalises to a path
  // that starts with the root and passes a textual compare, and the read then
  // follows the link out of the tree. `realpath` walks the links the read itself
  // would walk, so the thing compared is the thing opened. Both sides are
  // realpath'd — the uploads root can be a symlink too (a deployment pointing
  // `uploads/` at a mounted volume is ordinary), and comparing a resolved file
  // against an unresolved root would then reject every legitimate photo.
  //
  // ENOENT is `PHOTO_NOT_FOUND` like every other miss: a row whose bytes are
  // gone and a row whose bytes were never there are the same answer from
  // outside.
  const root = await realpath(resolve(deps.config.uploadsDir)).catch(() => undefined);
  const path = await realpath(resolve(photo.storage_url)).catch(() => undefined);
  if (!root || !path) throw new LongboxError("PHOTO_NOT_FOUND");
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new LongboxError("PHOTO_NOT_FOUND");

  // `stat` and not `lstat`: the link question is already settled above, and what
  // is needed here is the size of the file that will be streamed.
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile()) throw new LongboxError("PHOTO_NOT_FOUND");

  return { stream: createReadStream(path), contentType, contentLength: info.size };
}

/**
 * Rewrite a WebP file's RIFF length and return the digest of the finished file.
 *
 * Four bytes at offset 4, then one streaming pass to re-hash. The pass is the
 * price of streaming a format that states its own total length, and it is paid
 * for WebP only — PNG and JPEG carry no such field and are never re-read.
 */
async function patchRiffSizeAndRehash(path: string, riffSize: number): Promise<string> {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(riffSize, 0);
  const handle = await open(path, "r+");
  try {
    await handle.write(size, 0, 4, 4);
  } finally {
    await handle.close();
  }
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

function fileTooLarge(): Error & { code: string; statusCode: number } {
  const err = new Error("request file too large") as Error & { code: string; statusCode: number };
  err.code = "FST_REQ_FILE_TOO_LARGE";
  err.statusCode = 413;
  return err;
}

/**
 * The stand-in used when the metered budget is spent (§8.3).
 *
 * It exists so the manual path needs no credential at all. `identify` never
 * calls it — the plan is short-circuited — and it throws rather than returning
 * an empty answer, because a silent "no candidates" from a provider nobody
 * configured would be indistinguishable from a model that abstained.
 */
const MANUAL_PATH_PROVIDER = {
  id: "manual",
  model: "none",
  identify: (): never => {
    throw new Error("the manual path calls no provider");
  },
} as unknown as VisionProvider;

export async function identify(
  deps: ApiDeps,
  ctx: CallContext & { sessionId: string },
  body: z.infer<typeof identifyRequest>
): Promise<IdempotentOutcome> {
  const session = await requireSession(deps.pool, ctx.shopId, ctx.sessionId);
  const idem = idempotentRequest(ctx, {
    barcode_digits: body.barcode_digits ?? null,
    against: body.against,
  });

  // THE REPLAY IS RECOGNISED BEFORE ANYTHING IS SPENT, and this is the one route
  // where that ordering is not a nicety. `runIdempotent` pre-reads too, but it
  // only gets the chance AFTER the caller's non-transactional work — and here
  // that work is a PAID model call and a decrement of the metered budget. A
  // retried identify over the counter's bad Wi-Fi would otherwise cost the shop
  // a second call to answer with the first call's stored response. 042 §5.3's
  // "the cheapest possible rejection path" applied where it costs money.
  const replay = await replayIfSettled(deps.pool, idem);
  if (replay) return replay;

  // 042 §8.3 — THE METERED CLASS FAILS CLOSED TO THE MANUAL PATH, NEVER TO AN
  // ERROR. 019 K4 is "the pipeline never blocks on a provider", and a throttle we
  // impose on ourselves is a provider outage we caused; handling it worse than
  // one we did not would be incoherent. So an exhausted budget takes the same
  // route a model that errors or abstains already takes — "not a failure; a
  // different route to the same rung" (040 §4.6) — and the operator keeps
  // working on manual entry. The ORDINARY bucket still covers this route at the
  // edge, so a runaway loop is still refused with a 429.
  //
  // The budget is taken BEFORE the provider is resolved, deliberately: a shop
  // that has spent its budget needs no credential, and resolving one first would
  // answer 503 to a call that was never going to reach a provider.
  const budget = deps.limiter.takeMetered(ctx.shopId);

  let provider = MANUAL_PATH_PROVIDER;
  if (budget.allowed) {
    try {
      provider = await resolveVisionProvider(deps.pool, ctx.shopId);
    } catch {
      // The adapter's exception message STOPS being the body (042 E10): a
      // provider library's throw is not a sentence a caller may branch on, and
      // it is one 503 away from an operator's screen.
      throw new LongboxError("IDENTIFY_PROVIDER_UNAVAILABLE");
    }
  }

  const args = {
    shopId: ctx.shopId,
    sessionId: session.id,
    provider,
    bands: deps.config.bands,
    uploadsDir: deps.config.uploadsDir,
    ...(body.barcode_digits !== undefined ? { barcodeDigits: body.barcode_digits } : {}),
  };

  const plan = budget.allowed
    ? await planIdentify(deps.pool, args)
    : { band: "low" as const, contradiction: false, contradictionReasons: [], error: "metered budget spent" };

  return runIdempotent(deps.pool, idem, async (tx) => {
    await lockOrRefuse(tx, ctx.shopId, session.id);
    await assertWorldViewIsCurrent(tx, ctx.shopId, session.id, body.against);
    const written = await recordIdentify(tx, args, plan);
    const outcome = toOutcome(args, plan, written);
    if (budget.allowed && outcome.error) {
      // A provider that answered badly is a 502 with a code, not a success body
      // with an `error` string inside it beside `confidence`, `provider`,
      // `model` and `costUsd` (042 E10). The rows the call DID write are rolled
      // back with it; the retry is a fresh act under a fresh key.
      throw new LongboxError("IDENTIFY_FAILED");
    }
    return {
      status: 200,
      body: {
        candidate_set_ids: outcome.candidateSetIds,
        llm_rerank_id: outcome.llmRerankId,
        candidates: outcome.candidates,
        band: outcome.band,
        contradiction: outcome.contradiction,
        contradiction_reasons: outcome.contradictionReasons,
        ...(outcome.barcode !== undefined ? { barcode: outcome.barcode } : {}),
        manual_path: !budget.allowed,
      },
    };
  });
}

export async function confirm(
  deps: ApiDeps,
  ctx: CallContext & { sessionId: string },
  body: z.infer<typeof confirmRequest>
): Promise<IdempotentOutcome> {
  const session = await requireSession(deps.pool, ctx.shopId, ctx.sessionId);

  return runIdempotent(deps.pool, idempotentRequest(ctx, body), async (tx) => {
    await lockOrRefuse(tx, ctx.shopId, session.id);
    await assertWorldViewIsCurrent(tx, ctx.shopId, session.id, body.against);

    // 040 F3 / locked decision 7, as a CODE and not a sentence (042 §4.6). A
    // rejection whose only content is English prose is a UI convention with
    // extra steps: the client has to parse it, and a second client will parse it
    // differently. `reasons` are evidence strings about the BOOK, not prose
    // about the person, and they are already in `llm_rerank.response`.
    //
    // E06-D01, AND 040 v1.3.0 F3 — WHICH NOW KEYS THE REFUSAL ON THE BAND.
    // This guard used to key on `rerank.contradiction`, which was sound while the
    // contradiction verdict was the only thing that could take a band off `high`.
    // It no longer is: the band is derived from five ceilings, so the payload in
    // 046 finding R-3 — no evidence at all, no contradiction — derives `low` and
    // a contradiction-only check would have waved its `one_tap` through. A client
    // that skips the downgrade cannot produce the row (040 F3's "schema-level
    // rule, not a UI convention"), so the guard must refuse for EVERY non-high
    // cause, not for one of five. No re-rank at all is also not `high`.
    if (body.source === "one_tap") {
      const rerank = await readLatestRerank(tx, ctx.shopId, session.id);
      if (rerank?.band !== "high") {
        // Two codes, because the operator sentences differ: 021 C3 is
        // specifically "something on the cover disagrees", which is the wrong
        // thing to say when the truth is "we could not read enough to be sure".
        throw rerank?.contradiction
          ? new LongboxError("CONTRADICTION_BLOCKS_ONE_TAP", {
              band: rerank.band,
              reasons: rerank.contradiction_reasons,
            })
          : new LongboxError("ONE_TAP_NOT_CORROBORATED", { band: rerank?.band ?? null });
      }
    }

    const baseline = await readConfirmationBaseline(tx, ctx.shopId, session.id);
    const outcome = decideOutcome({
      source: body.source,
      confirmed: body.issue,
      topProposal: topCandidateOf(baseline.topProposalSource),
      priorConfirmation: baseline.priorConfirmation,
    });

    const row = baseline.priorConfirmationId
      ? await supersede(tx, {
          shopId: ctx.shopId,
          sessionId: session.id,
          priorId: baseline.priorConfirmationId,
          operatorId: ctx.operatorId ?? null,
          row: {
            table: "human_confirmation",
            values: { confirmedIssue: body.issue, source: body.source, outcome },
          },
        })
      : await insertHumanConfirmation(tx, {
          sessionId: session.id,
          shopId: ctx.shopId,
          confirmedIssue: body.issue,
          source: body.source,
          outcome,
          operatorId: ctx.operatorId ?? null,
          sessionSeq: await assignSessionSeq(tx, ctx.shopId, session.id),
        });
    await setSessionStatus(tx, ctx.shopId, session.id, "confirmed");

    // THE SECOND FACT (047 §9.1, E04-B02). The confirmation above is the
    // PERSON'S act and is complete without this line — which is why this call
    // comes after it, in the same transaction, and why its outcome does not
    // reach the response body. What the catalog says the person picked is a
    // separate, revisable statement: it may be absent (no corpus has been built
    // yet), it may decline (the signature is a dedupe candidate, and 030 §3.3
    // makes that a human-queue item rather than a merge), and a later corpus may
    // answer differently by appending a second row. None of those is an error at
    // the counter, so none of them changes what the operator sees.
    //
    // 041 §4.1 is satisfied because this is only reads and one INSERT: there is
    // no provider call and no side effect inside the transaction body, so the
    // retry stays sound.
    await resolveConfirmationIdentity(tx, {
      shopId: ctx.shopId,
      humanConfirmationId: row.id,
      confirmedIssue: body.issue,
      vertical: COMIC_VERTICAL,
      resolvedBy: "sessionApi.confirm",
    });

    return {
      status: 201,
      body: { confirmation: { id: row.id, created_at: row.created_at, outcome } },
    };
  });
}

export async function assessCondition(
  deps: ApiDeps,
  ctx: CallContext & { sessionId: string },
  body: z.infer<typeof conditionRequest>
): Promise<IdempotentOutcome> {
  const session = await requireSession(deps.pool, ctx.shopId, ctx.sessionId);
  if (!validGradeRange(body.grade_range_low, body.grade_range_high)) {
    throw new LongboxError("VALIDATION_FAILED", {
      fieldErrors: { grade_range_low: ["must not exceed grade_range_high"] },
    });
  }

  return runIdempotent(deps.pool, idempotentRequest(ctx, body), async (tx) => {
    await lockOrRefuse(tx, ctx.shopId, session.id);
    await assertWorldViewIsCurrent(tx, ctx.shopId, session.id, body.against);
    const prior = await readCurrentConditionAssessment(tx, ctx.shopId, session.id);
    const values = {
      gradeRangeLow: body.grade_range_low,
      gradeRangeHigh: body.grade_range_high,
      defects: body.defects,
      notes: body.notes ?? null,
    };
    const row = prior
      ? await supersede(tx, {
          shopId: ctx.shopId,
          sessionId: session.id,
          priorId: prior.id,
          operatorId: ctx.operatorId ?? null,
          row: { table: "condition_assessment", values },
        })
      : await insertConditionAssessment(tx, {
          sessionId: session.id,
          shopId: ctx.shopId,
          ...values,
          operatorId: ctx.operatorId ?? null,
          sessionSeq: await assignSessionSeq(tx, ctx.shopId, session.id),
        });
    return { status: 201, body: { assessment: { id: row.id, created_at: row.created_at } } };
  });
}

interface PolicyRow {
  id: string;
  comp_percent: number;
  floor_cents: number;
  rounding_rule: PricingPolicy["roundingRule"];
}

async function latestPolicy(db: Queryable, shopId: string): Promise<{ id: string; policy: PricingPolicy }> {
  const res = await db.query(
    `SELECT id, comp_percent, floor_cents, rounding_rule FROM shop_pricing_policy
      WHERE shop_id = $1 ORDER BY effective_from DESC LIMIT 1`,
    [shopId]
  );
  const row = res.rows[0] as PolicyRow | undefined;
  if (!row) {
    throw new LongboxError("SHOP_HAS_NO_PRICING_POLICY");
  }
  return {
    id: row.id,
    policy: { compPercent: row.comp_percent, floorCents: row.floor_cents, roundingRule: row.rounding_rule },
  };
}

export async function price(
  deps: ApiDeps,
  ctx: CallContext & { sessionId: string },
  body: z.infer<typeof priceRequest>
): Promise<IdempotentOutcome> {
  const session = await requireSession(deps.pool, ctx.shopId, ctx.sessionId);
  // Same reasoning as `identify`, one layer cheaper: this route calls eBay and
  // PriceCharting before its transaction, and a replay should not re-ask
  // somebody else's server for an answer it already stored.
  const idem = idempotentRequest(ctx, body);
  const replay = await replayIfSettled(deps.pool, idem);
  if (replay) return replay;
  const found = await latestPolicy(deps.pool, ctx.shopId);

  const query: PricingQuery = {
    title: body.title ?? body.query!,
    ...(body.issue !== undefined ? { issue: body.issue } : {}),
    ...(body.variant !== undefined ? { variant: body.variant } : {}),
    ...(body.grade !== undefined ? { grade: body.grade } : {}),
    ...(body.upc !== undefined ? { upc: body.upc } : {}),
  };

  // ALL configured pricing providers run; each falls back to a clearly flagged
  // stub when its creds are missing (per-shop `key_ref` override, global env
  // fallback — the same resolution as every other credential).
  const pcToken = await resolveShopToken(deps.pool, ctx.shopId, "pricecharting", "PRICECHARTING_TOKEN");
  const ebayCreds = await resolveEbayCredentials(deps.pool, ctx.shopId);
  const providers: PricingProvider[] = [
    pcToken ? createPriceChartingProvider({ token: pcToken }) : createPriceChartingProvider({}),
    ebayCreds ? createEbayProvider(ebayCreds) : createStubEbayProvider(),
  ];

  const args = {
    sessionId: session.id,
    shopId: ctx.shopId,
    providers,
    policy: found.policy,
    policyId: found.id,
    query,
    operatorId: ctx.operatorId ?? null,
    ...(body.override_cents !== undefined ? { overrideCents: body.override_cents } : {}),
  };
  // Outside the transaction, for 041 §4.1's reason: a retried attempt must not
  // re-fetch from eBay, and a held connection must not wait on somebody else's
  // server.
  const plan = await fetchPricing(args);

  return runIdempotent(deps.pool, idem, async (tx) => {
    await lockOrRefuse(tx, ctx.shopId, session.id);
    await assertWorldViewIsCurrent(tx, ctx.shopId, session.id, body.against);
    const result = await recordPricing(tx, args, plan);
    return {
      status: 201,
      body: {
        ...result,
        // 033 D5: part of the DTO, not a convenience key.
        stub: result.sources.every((s) => s.status !== "ok" || s.stub),
      },
    };
  });
}

/**
 * `POST …/draft` OWES the effect (043 §4.1): it runs its gates, appends
 * `longbox.commerce.draft_requested` inside the request transaction, and answers
 * 202 with the outbox row's id. A worker claims the row and calls Shopify in its
 * own transaction.
 *
 * THE GATES READ `_current`, NOT THE LAST ROW (041 §3.4, I8). Reading the newest
 * inserted row makes "the current answer" and "the newest row" the same row only
 * by coincidence: after one correction they are different rows, and a draft
 * would be gated on a record the operator was never shown.
 */
export async function requestDraft(
  deps: ApiDeps,
  ctx: CallContext & { sessionId: string },
  body: z.infer<typeof draftRequest>
): Promise<IdempotentOutcome> {
  const session = await requireSession(deps.pool, ctx.shopId, ctx.sessionId);
  const flags = await readWitnessFlags(deps.pool, ctx.shopId, session.id);
  if (!flags.confirmed) {
    throw new LongboxError("SESSION_HAS_NO_CONFIRMATION");
  }
  if (!flags.priced) {
    throw new LongboxError("SESSION_HAS_NO_PRICING");
  }

  return runIdempotent(deps.pool, idempotentRequest(ctx, body), async (tx) => {
    await lockOrRefuse(tx, ctx.shopId, session.id);
    await assertWorldViewIsCurrent(tx, ctx.shopId, session.id, body.against);
    const sessionSeq = await assignSessionSeq(tx, ctx.shopId, session.id);
    const enqueued = await enqueue(tx, {
      shopId: ctx.shopId,
      event: DRAFT_REQUESTED,
      scanSessionId: session.id,
      sessionSeq,
      // A person tapped the button, and nothing verified who: 041 §2.3's
      // `authored_by` says a human decided it and `actor_verified` (false by
      // default) says nobody checked. Recording it as a system act would be the
      // cheaper lie.
      authoredBy: "human",
    });
    return {
      status: 202,
      body: { status: "accepted", outbox_id: enqueued.id, already_requested: enqueued.alreadyEnqueued },
    };
  });
}
