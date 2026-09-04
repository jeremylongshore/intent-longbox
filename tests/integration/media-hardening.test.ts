// Hostile uploads, end to end (E03-B07; 046 E6, E7, G-5, §4 B4, §5 A3).
//
// The unit lane proves the guard's branches; this lane proves the ROUTE answers
// them with the registry's codes, writes nothing when it refuses, and — on the
// one honest upload — stores a file whose hash is in the row and whose metadata
// is gone. Integration lane only (INTEGRATION=1).
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { DEFAULT_MEDIA_POLICY } from "../../src/services/media.js";
import { listSessionPhotos } from "../../src/services/scanSession.js";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import {
  ELF_BINARY,
  HTML_DOCUMENT,
  PDF_DOCUMENT,
  SVG_DOCUMENT,
  jpeg,
  jpegExifSegment,
  png,
  pngExifChunk,
  pngTextChunk,
  webp,
  webpChunkFourccs,
  webpExifChunk,
  webpVp8Chunk,
  webpVp8xChunk,
} from "../fixtures/media/index.js";

const dbUp = await probeDb();

const UPLOADS_DIR = "tests/.tmp-media-hardening";
const BOUNDARY = "----LongboxMediaHardening51c4";

interface Part {
  name: string;
  value: Buffer | string;
  filename?: string;
  contentType?: string;
}

function multipart(parts: Part[]): { payload: Buffer; headers: Record<string, string> } {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const disposition =
      `Content-Disposition: form-data; name="${p.name}"` + (p.filename ? `; filename="${p.filename}"` : "");
    const head = [
      `--${BOUNDARY}`,
      disposition,
      ...(p.contentType ? [`Content-Type: ${p.contentType}`] : []),
      "",
      "",
    ];
    chunks.push(Buffer.from(head.join("\r\n")));
    chunks.push(Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      "idempotency-key": randomUUID(),
    },
  };
}

interface PhotoRow {
  storage_url: string;
  storage_key: string | null;
  content_hash: string | null;
  byte_size: string | null;
}

describe.skipIf(!dbUp)("media hardening: what the upload route accepts and refuses", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let tightApp: FastifyInstance;
  let byteApp: FastifyInstance;
  let shopId: string;
  let base: string;

  async function newSession(instance: FastifyInstance = app): Promise<string> {
    const res = await instance.inject({
      method: "POST",
      url: base,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    expect(res.statusCode).toBe(201);
    return res.json().session.id as string;
  }

  async function upload(
    sessionId: string,
    bytes: Buffer,
    declared: { contentType: string; filename: string },
    instance: FastifyInstance = app
  ) {
    const req = multipart([
      { name: "kind", value: "cover" },
      { name: "file", value: bytes, filename: declared.filename, contentType: declared.contentType },
    ]);
    return instance.inject({ method: "POST", url: `${base}/${sessionId}/photos`, ...req });
  }

  async function photoRows(sessionId: string): Promise<PhotoRow[]> {
    const res = await pool.query(
      `SELECT storage_url, storage_key, content_hash, byte_size FROM scan_photo
        WHERE scan_session_id = $1 AND shop_id = $2 ORDER BY taken_at`,
      [sessionId, shopId]
    );
    return res.rows as PhotoRow[];
  }

  /** Nothing was written: no row, and no file (not even a `.part`). */
  async function storedNothing(sessionId: string): Promise<void> {
    expect(await listSessionPhotos(pool, shopId, sessionId)).toEqual([]);
    const dir = `${UPLOADS_DIR}/${sessionId}`;
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  }

  beforeAll(async () => {
    const url = await createFreshDb("longbox_media_hardening_test");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    shopId = await seedShop(pool, { name: "Gotham City Limit", slug: "gotham-media" });
    base = `/api/v1/shops/${shopId}/scan-sessions`;
    mkdirSync(UPLOADS_DIR, { recursive: true });
    const config = { port: 0, databaseUrl: url, uploadsDir: UPLOADS_DIR, bands: { high: 0.85, medium: 0.5 } };
    app = await buildApp(pool, config);
    // A second app whose quota is one photo per session and 4 KiB per session:
    // the ceilings are PROVISIONAL and generous by design, so the only honest
    // way to exercise the refusal is to configure a small one.
    tightApp = await buildApp(pool, {
      ...config,
      media: { ...DEFAULT_MEDIA_POLICY, sessionPhotoLimit: 1, sessionByteLimit: 4096 },
    });
    byteApp = await buildApp(pool, {
      ...config,
      media: { ...DEFAULT_MEDIA_POLICY, sessionByteLimit: 4096 },
    });
  });

  afterAll(async () => {
    await app?.close();
    await tightApp?.close();
    await byteApp?.close();
    await pool?.end();
    rmSync(UPLOADS_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // The honest upload
  // -------------------------------------------------------------------------

  it("stores an honest JPEG with its content hash, its size, its key — and no EXIF", async () => {
    const sessionId = await newSession();
    const file = jpeg({ width: 4032, height: 3024, segments: [jpegExifSegment()] });
    expect(file.includes(Buffer.from("GPSLatitude"))).toBe(true);

    const res = await upload(sessionId, file, { contentType: "image/jpeg", filename: "IMG_4821.JPG" });
    expect(res.statusCode).toBe(201);

    const [row] = await photoRows(sessionId);
    const stored = readFileSync(row!.storage_url);
    // 041 A5's hash class, and 046 K-1's finding closed: the digest is written,
    // and it is the digest of the bytes that are actually on disk.
    expect(row!.content_hash).toBe(createHash("sha256").update(stored).digest("hex"));
    expect(row!.content_hash).not.toBe(createHash("sha256").update(file).digest("hex"));
    expect(Number(row!.byte_size)).toBe(statSync(row!.storage_url).size);
    expect(row!.storage_key).toBe(row!.storage_url.slice(`${UPLOADS_DIR}/`.length));
    // 022 P7 / 046 §5 A3: the phone's location is not on this disk.
    expect(stored.includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(stored.length).toBeLessThan(file.length);
  });

  it("strips PNG text and eXIf chunks and still serves the image back", async () => {
    const sessionId = await newSession();
    const file = png({
      width: 800,
      height: 1200,
      chunks: [pngTextChunk("Comment", HTML_DOCUMENT.toString("latin1")), pngExifChunk()],
    });
    const res = await upload(sessionId, file, { contentType: "image/png", filename: "cover.png" });
    expect(res.statusCode).toBe(201);
    const photoId = res.json().photo.id as string;

    const [row] = await photoRows(sessionId);
    const stored = readFileSync(row!.storage_url);
    expect(stored.includes(Buffer.from("<script>"))).toBe(false);
    expect(stored.includes(Buffer.from("GPSPAYLOAD"))).toBe(false);

    // And the tenant-scoped read route hands back exactly those bytes.
    const read = await app.inject({ method: "GET", url: `${base}/${sessionId}/photos/${photoId}` });
    expect(read.statusCode).toBe(200);
    expect(read.headers["content-type"]).toBe("image/png");
    expect(read.rawPayload.equals(stored)).toBe(true);
  });

  it("strips a WebP's EXIF chunk and leaves the RIFF length agreeing with the file", async () => {
    const sessionId = await newSession();
    const file = webp([webpVp8xChunk(600, 400, 0x08), webpExifChunk(), webpVp8Chunk(600, 400)]);
    const res = await upload(sessionId, file, { contentType: "image/webp", filename: "c.webp" });
    expect(res.statusCode).toBe(201);

    const [row] = await photoRows(sessionId);
    const stored = readFileSync(row!.storage_url);
    expect(webpChunkFourccs(stored)).toEqual(["VP8X", "VP8 "]);
    expect(stored.readUInt32LE(4)).toBe(stored.length - 8);
    // The re-hash after the RIFF patch is the hash of the finished file.
    expect(row!.content_hash).toBe(createHash("sha256").update(stored).digest("hex"));
  });

  // -------------------------------------------------------------------------
  // The type is the bytes
  // -------------------------------------------------------------------------

  it.each([
    ["an HTML document declared as image/png", HTML_DOCUMENT, "image/png", "cover.png"],
    ["an SVG declared as image/png", SVG_DOCUMENT, "image/png", "cover.png"],
    ["a PDF declared as image/jpeg", PDF_DOCUMENT, "image/jpeg", "scan.jpg"],
    ["an ELF binary declared as image/webp", ELF_BINARY, "image/webp", "c.webp"],
  ])(
    "refuses %s with 415 UNSUPPORTED_IMAGE_TYPE and stores nothing",
    async (_l, bytes, contentType, filename) => {
      const sessionId = await newSession();
      const res = await upload(sessionId, bytes as Buffer, { contentType, filename });
      expect(res.statusCode).toBe(415);
      expect(res.json().error.code).toBe("UNSUPPORTED_IMAGE_TYPE");
      await storedNothing(sessionId);
    }
  );

  it("takes the stored extension from the DETECTED type, not the declared one", async () => {
    // 046 E6's whole finding in one request: a real PNG announced as a JPEG.
    const sessionId = await newSession();
    const res = await upload(sessionId, png(), { contentType: "image/jpeg", filename: "definitely.jpg" });
    expect(res.statusCode).toBe(201);
    const [row] = await photoRows(sessionId);
    expect(row!.storage_url.endsWith(".png")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Polyglots, bombs and broken containers
  // -------------------------------------------------------------------------

  it.each([
    ["a PNG with an HTML document after IEND", png({ trailer: HTML_DOCUMENT })],
    ["a PNG with a PDF after IEND", png({ trailer: PDF_DOCUMENT })],
    ["a JPEG with an HTML document after EOI", jpeg({ trailer: HTML_DOCUMENT })],
    ["a WebP with an HTML document after the RIFF payload", webp([webpVp8Chunk(60, 40)], HTML_DOCUMENT)],
    ["a truncated JPEG", jpeg({ omitEoi: true })],
    ["a WebP with no bitstream chunk", webp([webpVp8xChunk(60, 40, 0)])],
  ])("refuses %s with 422 MALFORMED_IMAGE and stores nothing", async (_label, bytes) => {
    const sessionId = await newSession();
    const res = await upload(sessionId, bytes, { contentType: "image/png", filename: "c.png" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("MALFORMED_IMAGE");
    await storedNothing(sessionId);
  });

  it("refuses a decompression bomb with 422 IMAGE_DIMENSIONS_TOO_LARGE and stores nothing", async () => {
    const sessionId = await newSession();
    const bomb = png({ declaredWidth: 64_000, declaredHeight: 64_000 });
    expect(bomb.length).toBeLessThan(1024);
    const res = await upload(sessionId, bomb, { contentType: "image/png", filename: "bomb.png" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("IMAGE_DIMENSIONS_TOO_LARGE");
    await storedNothing(sessionId);
  });

  // -------------------------------------------------------------------------
  // Traversal on the WRITE side
  // -------------------------------------------------------------------------

  it("ignores the client filename entirely: no traversal, no extension, no name", async () => {
    const sessionId = await newSession();
    const res = await upload(sessionId, png(), {
      contentType: "image/png",
      filename: "../../../../etc/cron.d/evil.png",
    });
    expect(res.statusCode).toBe(201);
    const [row] = await photoRows(sessionId);
    expect(row!.storage_url.startsWith(`${UPLOADS_DIR}/${sessionId}/`)).toBe(true);
    expect(row!.storage_url).not.toContain("..");
    expect(row!.storage_url).not.toContain("evil");
    expect(readdirSync(`${UPLOADS_DIR}/${sessionId}`)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Quota
  // -------------------------------------------------------------------------

  it("refuses an upload once the session's photo ceiling is reached", async () => {
    const sessionId = await newSession(tightApp);
    const first = await upload(sessionId, png(), { contentType: "image/png", filename: "a.png" }, tightApp);
    expect(first.statusCode).toBe(201);

    const second = await upload(sessionId, png(), { contentType: "image/png", filename: "b.png" }, tightApp);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("PHOTO_QUOTA_EXCEEDED");
    expect(second.json().error.details).toEqual({ scope: "session", limit_kind: "count" });
    expect(second.json().error.retryable).toBe(false);
    // The refusal wrote nothing: the first upload's file is still the only one.
    expect(readdirSync(`${UPLOADS_DIR}/${sessionId}`)).toHaveLength(1);
    expect(await listSessionPhotos(pool, shopId, sessionId)).toHaveLength(1);
  });

  it("refuses an upload once the session's byte ceiling is reached", async () => {
    // A THIRD app, whose count ceiling is out of the way: the two ceilings are
    // checked in order, so a byte refusal is only observable where the count
    // one cannot fire first.
    const sessionId = await newSession(byteApp);
    const heavy = png({ padPixels: 8192 });
    expect(heavy.length).toBeGreaterThan(4096);
    const first = await upload(sessionId, heavy, { contentType: "image/png", filename: "a.png" }, byteApp);
    expect(first.statusCode).toBe(201);

    const second = await upload(sessionId, png(), { contentType: "image/png", filename: "b.png" }, byteApp);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("PHOTO_QUOTA_EXCEEDED");
    expect(second.json().error.details).toEqual({ scope: "session", limit_kind: "bytes" });
  });

  it("refuses an upload once the SHOP's photo ceiling is reached, and says so in `details`", async () => {
    // A shop of its own, so this ceiling cannot be reached by another test's
    // uploads — and a fourth app whose shop ceiling is one photo.
    const soloShop = await seedShop(pool, { name: "Solo Shop", slug: "solo-media" });
    const soloBase = `/api/v1/shops/${soloShop}/scan-sessions`;
    const shopApp = await buildApp(pool, {
      port: 0,
      databaseUrl: "",
      uploadsDir: UPLOADS_DIR,
      bands: { high: 0.85, medium: 0.5 },
      media: { ...DEFAULT_MEDIA_POLICY, shopPhotoLimit: 1 },
    });
    try {
      const session = async (): Promise<string> => {
        const res = await shopApp.inject({
          method: "POST",
          url: soloBase,
          payload: {},
          headers: { "idempotency-key": randomUUID() },
        });
        return res.json().session.id as string;
      };
      const post = async (id: string) => {
        const req = multipart([
          { name: "kind", value: "cover" },
          { name: "file", value: png(), filename: "a.png", contentType: "image/png" },
        ]);
        return shopApp.inject({ method: "POST", url: `${soloBase}/${id}/photos`, ...req });
      };
      expect((await post(await session())).statusCode).toBe(201);

      // A DIFFERENT session in the same shop: the session ceiling is nowhere
      // near, so only the shop ceiling can produce this refusal.
      const second = await post(await session());
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe("PHOTO_QUOTA_EXCEEDED");
      // 042 §4.1: `details` is structured and code-specific, and it is what a
      // client reads to say WHICH ceiling — the server writes no prose.
      expect(second.json().error.details).toEqual({ scope: "shop", limit_kind: "count" });
      expect(second.json().error.retryable).toBe(false);
      expect(typeof second.json().error.correlation_id).toBe("string");
    } finally {
      await shopApp.close();
    }
  });

  it("does not apply one session's usage to another", async () => {
    const filled = await newSession(tightApp);
    expect(
      (await upload(filled, png(), { contentType: "image/png", filename: "a.png" }, tightApp)).statusCode
    ).toBe(201);
    const fresh = await newSession(tightApp);
    expect(
      (await upload(fresh, png(), { contentType: "image/png", filename: "a.png" }, tightApp)).statusCode
    ).toBe(201);
  });
});
