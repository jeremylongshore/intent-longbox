// Contract: multipart photo upload (R2 — phone-browser photo capture attaches
// to a scan session). HTTP-level via fastify inject against a real Postgres:
// a PNG attaches (201, row + file on disk), the kind field is honored,
// a missing file / bad kind is 400, non-multipart is 415, and a payload over
// the 25 MiB limit is 413. Integration lane only (INTEGRATION=1).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      // 042 §5.1: every mutating route REQUIRES the header, multipart included.
      // §5.5 is why it works here without buffering — the hash covers the
      // non-file fields plus the SHA-256 of the bytes already being streamed to
      // disk. A fresh key per call, because each of these is a different ACT.
      "idempotency-key": randomUUID(),
    },
  };
}

describe.skipIf(!dbUp)("HTTP: POST /api/v1/shops/:shopId/scan-sessions/:id/photos (multipart)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;
  let base: string;

  async function newSession(): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: base,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    expect(res.statusCode).toBe(201);
    return res.json().session.id as string;
  }

  beforeAll(async () => {
    const url = await createFreshDb("longbox_photos_test");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    shopId = await seedShop(pool, { name: "Gotham City Limit", slug: "gotham-photos" });
    base = `/api/v1/shops/${shopId}/scan-sessions`;
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
    // 042 §3.5: `storage_url` is an INTERNAL reference and is never a response
    // field — a photo is addressed by a shop-scoped, time-bounded signed URL
    // issued by the owning module (E03-B07). The path is still asserted, from
    // the row rather than from the wire.
    const photo = res.json().photo as { id: string; kind: string };
    expect(photo).toEqual({ id: photo.id, kind: "cover" });
    const [row] = await listSessionPhotos(pool, shopId, sessionId);
    expect(row!.storage_url).toMatch(new RegExp(`^${UPLOADS_DIR}/${sessionId}/\\d{13}-cover\\.png$`));
    expect(existsSync(row!.storage_url)).toBe(true);
    expect(readFileSync(row!.storage_url)).toEqual(PNG_BYTES);
    expect(await listSessionPhotos(pool, shopId, sessionId)).toEqual([
      { id: photo.id, kind: "cover", storage_url: row!.storage_url },
    ]);
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
    expect(res.json().photo).not.toHaveProperty("storage_url");
    const [row] = await listSessionPhotos(pool, shopId, sessionId);
    expect(row!.storage_url).toMatch(/-barcode\.jpg$/);
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
    // One envelope, everywhere (042 §4.1). The prose that used to be the whole
    // body is now a developer `message` nobody renders, and the branchable part
    // is `code`.
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
    expect(await listSessionPhotos(pool, shopId, sessionId)).toEqual([]);
  });

  it("rejects a multipart body with no file part with 400", async () => {
    const sessionId = await newSession();
    const req = multipart([{ name: "kind", value: "cover" }]);
    const res = await app.inject({ method: "POST", url: `${base}/${sessionId}/photos`, ...req });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("PHOTO_FIELD_REQUIRED");
  });

  it("rejects a non-multipart JSON body with 415 UNSUPPORTED_MEDIA_TYPE", async () => {
    const sessionId = await newSession();
    const res = await app.inject({
      method: "POST",
      url: `${base}/${sessionId}/photos`,
      payload: { kind: "cover", file: PNG_BYTES.toString("base64") },
    });
    expect(res.statusCode).toBe(415);
    // A framework error joins the envelope through the one handler (042 §4.5),
    // and it keeps a MEANING rather than leaking a framework identifier a client
    // would branch on. Fastify answered this 406; the registry states 415, which
    // is what the condition actually is — the request's media type is not one
    // this route accepts.
    expect(res.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  // Regression for E03-B07-D1: @fastify/multipart enforces `limits.fileSize`
  // by truncating the busboy stream rather than erroring, so a route that pipes
  // `file.file` straight to disk used to write a clipped 26,214,400-byte file,
  // insert a scan_photo row and answer 201. The route now checks
  // `file.file.truncated` and writes via a `.part` temp path.
  it("rejects a file over the 25 MiB limit with 413 and stores no row", async () => {
    const sessionId = await newSession();
    const oversize = Buffer.concat([PNG_BYTES, Buffer.alloc(25 * 1024 * 1024 - PNG_BYTES.length + 1, 0x7f)]);
    const req = multipart([
      { name: "kind", value: "cover" },
      { name: "file", value: oversize, filename: "huge.png", contentType: "image/png" },
    ]);
    const res = await app.inject({ method: "POST", url: `${base}/${sessionId}/photos`, ...req });
    expect(res.statusCode).toBe(413);
    // 042 §4.5, named in the record rather than discovered here: this was the
    // ONE machine-readable code in the API and no handler composed it — it was
    // Fastify's serializer shape, because the handler threw. It now arrives
    // through the same envelope as everything else.
    expect(res.json().error.code).toBe("PHOTO_TOO_LARGE");
    expect(await listSessionPhotos(pool, shopId, sessionId)).toEqual([]);
    // No partial bytes survive the rejection: the session's upload dir is
    // either absent or empty (no `.part` leftovers either).
    const sessionDir = `${UPLOADS_DIR}/${sessionId}`;
    expect(existsSync(sessionDir) ? readdirSync(sessionDir) : []).toEqual([]);
  });

  // Boundary beside the case above: exactly at the limit is not over it.
  it("accepts a file exactly at the 25 MiB limit with 201", async () => {
    const sessionId = await newSession();
    const atLimit = Buffer.concat([PNG_BYTES, Buffer.alloc(25 * 1024 * 1024 - PNG_BYTES.length, 0x7f)]);
    expect(atLimit.length).toBe(25 * 1024 * 1024);
    const req = multipart([
      { name: "kind", value: "cover" },
      { name: "file", value: atLimit, filename: "exact.png", contentType: "image/png" },
    ]);
    const res = await app.inject({ method: "POST", url: `${base}/${sessionId}/photos`, ...req });
    expect(res.statusCode).toBe(201);
    const photo = res.json().photo as { id: string };
    const rows = await listSessionPhotos(pool, shopId, sessionId);
    expect(rows).toEqual([{ id: photo.id, kind: "cover", storage_url: rows[0]!.storage_url }]);
    expect(statSync(rows[0]!.storage_url).size).toBe(atLimit.length);
  });

  it("404s for a session that belongs to a different shop", async () => {
    const sessionId = await newSession();
    const otherShop = await seedShop(pool, { name: "Other Shop", slug: "other-photos" });
    const req = multipart([{ name: "file", value: PNG_BYTES, filename: "c.png", contentType: "image/png" }]);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/shops/${otherShop}/scan-sessions/${sessionId}/photos`,
      ...req,
    });
    expect(res.statusCode).toBe(404);
    // One envelope (042 §4.1), and a code a client can branch on — where the
    // whole body used to be an untyped `error` key holding sometimes a string
    // and sometimes a validation object (042 E9).
    expect(res.json().error.code).toBe("SESSION_NOT_FOUND");
  });
});
