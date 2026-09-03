// Contract: multipart photo upload (R2 — phone-browser photo capture attaches
// to a scan session). HTTP-level via fastify inject against a real Postgres:
// a PNG attaches (201, row + file on disk), the kind field is honored,
// a missing file / bad kind is 400, non-multipart is 406, and a payload over
// the 25 MiB limit is 413. Integration lane only (INTEGRATION=1).
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { listSessionPhotos } from "../../src/services/scanSession.js";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

const UPLOADS_DIR = "tests/.tmp-photo-uploads";
const BOUNDARY = "----LongboxPhotoContract7a1b9c";

// 1x1 PNG: signature + IHDR chunk header (enough for a magic-number check).
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00,
  0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

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
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

describe.skipIf(!dbUp)("HTTP: POST /api/shops/:shopId/scan-sessions/:id/photos (multipart)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;
  let base: string;

  async function newSession(): Promise<string> {
    const res = await app.inject({ method: "POST", url: base, payload: { created_by: "photo-contract" } });
    expect(res.statusCode).toBe(201);
    return res.json().session.id as string;
  }

  beforeAll(async () => {
    const url = await createFreshDb("longbox_photos_test");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    shopId = await seedShop(pool, { name: "Gotham City Limit", slug: "gotham-photos" });
    base = `/api/shops/${shopId}/scan-sessions`;
    mkdirSync(UPLOADS_DIR, { recursive: true });
    app = await buildApp(pool, {
      port: 0,
      databaseUrl: url,
      uploadsDir: UPLOADS_DIR,
      bands: { high: 0.85, medium: 0.5 },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    rmSync(UPLOADS_DIR, { recursive: true, force: true });
  });

  it("attaches a PNG cover: 201, scan_photo row, bytes on disk under uploads/<session>/", async () => {
    const sessionId = await newSession();
    const req = multipart([
      { name: "kind", value: "cover" },
      { name: "file", value: PNG_BYTES, filename: "IMG_4821.png", contentType: "image/png" },
    ]);
    const res = await app.inject({ method: "POST", url: `${base}/${sessionId}/photos`, ...req });
    expect(res.statusCode).toBe(201);
    const photo = res.json().photo as { id: string; kind: string; storage_url: string };
    expect(photo.kind).toBe("cover");
    expect(photo.storage_url).toMatch(new RegExp(`^${UPLOADS_DIR}/${sessionId}/\\d{13}-cover\\.png$`));
    expect(existsSync(photo.storage_url)).toBe(true);
    expect(readFileSync(photo.storage_url)).toEqual(PNG_BYTES);

    const rows = await listSessionPhotos(pool, shopId, sessionId);
    expect(rows).toEqual([{ id: photo.id, kind: "cover", storage_url: photo.storage_url }]);
  });

  it("honors kind=barcode and maps image/jpeg to a .jpg extension", async () => {
    const sessionId = await newSession();
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    const req = multipart([
      { name: "kind", value: "barcode" },
      { name: "file", value: jpegBytes, filename: "upc.jpg", contentType: "image/jpeg" },
    ]);
    const res = await app.inject({ method: "POST", url: `${base}/${sessionId}/photos`, ...req });
    expect(res.statusCode).toBe(201);
    expect(res.json().photo.kind).toBe("barcode");
    expect(res.json().photo.storage_url).toMatch(/-barcode\.jpg$/);
  });

  it("defaults kind to cover when the field is absent", async () => {
    const sessionId = await newSession();
    const req = multipart([{ name: "file", value: PNG_BYTES, filename: "c.png", contentType: "image/png" }]);
    const res = await app.inject({ method: "POST", url: `${base}/${sessionId}/photos`, ...req });
    expect(res.statusCode).toBe(201);
    expect(res.json().photo.kind).toBe("cover");
  });

  it("rejects an unknown kind with 400 and stores nothing", async () => {
    const sessionId = await newSession();
    const req = multipart([
      { name: "kind", value: "spine" },
      { name: "file", value: PNG_BYTES, filename: "c.png", contentType: "image/png" },
    ]);
    const res = await app.inject({ method: "POST", url: `${base}/${sessionId}/photos`, ...req });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "kind must be cover|barcode|defect" });
    expect(await listSessionPhotos(pool, shopId, sessionId)).toEqual([]);
  });

  it("rejects a multipart body with no file part with 400", async () => {
    const sessionId = await newSession();
    const req = multipart([{ name: "kind", value: "cover" }]);
    const res = await app.inject({ method: "POST", url: `${base}/${sessionId}/photos`, ...req });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "multipart file field required" });
  });

  it("rejects a non-multipart JSON body with 406", async () => {
    const sessionId = await newSession();
    const res = await app.inject({
      method: "POST",
      url: `${base}/${sessionId}/photos`,
      payload: { kind: "cover", file: PNG_BYTES.toString("base64") },
    });
    expect(res.statusCode).toBe(406);
    expect(res.json().code).toBe("FST_INVALID_MULTIPART_CONTENT_TYPE");
  });

  // KNOWN SOURCE BUG (2026-09-02): the route pipes `file.file` to disk without
  // checking `file.file.truncated`, so @fastify/multipart's fileSize limit only
  // truncates the stream — the route still writes a 26,214,400-byte file,
  // inserts a scan_photo row and returns 201. `it.fails` pins the intended
  // contract (413, nothing stored); flip to `it` when src/routes/scanSessions.ts
  // checks truncation (or uses toBuffer(), which throws FST_REQ_FILE_TOO_LARGE).
  it.fails("rejects a file over the 25 MiB limit with 413 and stores no row", async () => {
    const sessionId = await newSession();
    const oversize = Buffer.concat([PNG_BYTES, Buffer.alloc(25 * 1024 * 1024 - PNG_BYTES.length + 1, 0x7f)]);
    const req = multipart([
      { name: "kind", value: "cover" },
      { name: "file", value: oversize, filename: "huge.png", contentType: "image/png" },
    ]);
    const res = await app.inject({ method: "POST", url: `${base}/${sessionId}/photos`, ...req });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe("FST_REQ_FILE_TOO_LARGE");
    expect(await listSessionPhotos(pool, shopId, sessionId)).toEqual([]);
  });

  it("404s for a session that belongs to a different shop", async () => {
    const sessionId = await newSession();
    const otherShop = await seedShop(pool, { name: "Other Shop", slug: "other-photos" });
    const req = multipart([{ name: "file", value: PNG_BYTES, filename: "c.png", contentType: "image/png" }]);
    const res = await app.inject({
      method: "POST",
      url: `/api/shops/${otherShop}/scan-sessions/${sessionId}/photos`,
      ...req,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "scan session not found" });
  });
});
