// L4: the tenant-scoped photo route, and the public mount that is gone
// (E03-D05, 046 §3.3 B5 + §6 Q5).
//
// B5 was the largest information-disclosure cell in 046 §4: `uploads/` was
// mounted statically with no auth, no signature and no expiry, so every shop's
// photographs were readable by anyone who had or guessed a URL. The ruling was
// DELETE rather than replace — the mount's only surviving consumer was the phone
// preview, because Shopify is handed root-relative paths it cannot fetch (E28).
//
// What this file proves, at HTTP:
//   1. the owning shop and session get the BYTES back, with the private
//      cache posture;
//   2. another shop is 404, another session is 404 — never 403 (019 T24: a 403
//      would confirm the id exists somewhere else);
//   3. traversal cannot be spelled: `..`, an encoded separator and an absolute
//      path all fail before any filesystem call;
//   4. the old `/uploads/...` URL — the exact string that used to serve the
//      bytes — is now 404.
import { randomUUID } from "node:crypto";
import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { listSessionPhotos } from "../../src/services/scanSession.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { png } from "../fixtures/media/index.js";

const dbUp = await probeDb();

const UPLOADS_DIR = "tests/.tmp-photofetch-uploads";
const BOUNDARY = "----LongboxPhotoFetch3d5e";
const MISSING = "00000000-0000-4000-8000-000000000000";

// A REAL png (E03-B07): the upload guard walks the container, so a signature
// with no IDAT behind it is now refused as MALFORMED_IMAGE rather than stored.
const PNG_BYTES = png();

function multipartPng(): { payload: Buffer; headers: Record<string, string> } {
  const head = [
    `--${BOUNDARY}`,
    'Content-Disposition: form-data; name="kind"',
    "",
    "cover",
    `--${BOUNDARY}`,
    'Content-Disposition: form-data; name="file"; filename="cover.png"',
    "Content-Type: image/png",
    "",
    "",
  ].join("\r\n");
  return {
    payload: Buffer.concat([Buffer.from(head), PNG_BYTES, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]),
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      "idempotency-key": randomUUID(),
    },
  };
}

describe.skipIf(!dbUp)("HTTP: GET /api/v1/shops/:shopId/scan-sessions/:id/photos/:photoId", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;
  let otherShopId: string;
  let sessionId: string;
  let otherSessionId: string;
  let photoId: string;
  let storageUrl: string;
  let migrateUrl: string;

  async function newSession(shop: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/shops/${shop}/scan-sessions`,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { session: { id: string } }).session.id;
  }

  beforeAll(async () => {
    migrateUrl = await createFreshDb("longbox_photofetch_test");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Gotham City Limit", slug: `gothamfetch${Date.now()}` });
    otherShopId = await seedShop(ownerPool, { name: "Other Shop", slug: `otherfetch${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    app = await buildApp(pool, {
      port: 0,
      databaseUrl: appUrl(migrateUrl),
      uploadsDir: UPLOADS_DIR,
      bands: { high: 0.85, medium: 0.5 },
    });

    sessionId = await newSession(shopId);
    otherSessionId = await newSession(shopId);
    const upload = await app.inject({
      method: "POST",
      url: `/api/v1/shops/${shopId}/scan-sessions/${sessionId}/photos`,
      ...multipartPng(),
    });
    expect(upload.statusCode).toBe(201);
    photoId = (upload.json() as { photo: { id: string } }).photo.id;
    storageUrl = (await listSessionPhotos(pool, shopId, sessionId))[0]!.storage_url;
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    rmSync(UPLOADS_DIR, { recursive: true, force: true });
  });

  function url(shop: string, session: string, photo: string): string {
    return `/api/v1/shops/${shop}/scan-sessions/${session}/photos/${photo}`;
  }

  it("returns the bytes to the shop and session that own the photo", async () => {
    const res = await app.inject({ method: "GET", url: url(shopId, sessionId, photoId) });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload).toEqual(PNG_BYTES);
    // The content type is derived from the extension THIS SERVER wrote at
    // upload from the detected type — never from a client-supplied name.
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["content-length"]).toBe(String(PNG_BYTES.length));
  });

  it("serves it private and unstored: a shop's photograph does not sit in a cache", async () => {
    const res = await app.inject({ method: "GET", url: url(shopId, sessionId, photoId) });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("404s the SAME photo id under another shop — never 403 (019 T24)", async () => {
    const res = await app.inject({ method: "GET", url: url(otherShopId, sessionId, photoId) });
    expect(res.statusCode).toBe(404);
    // The session lookup refuses first, and that is the honest code: from
    // outside, this shop has no such session. What matters is that neither
    // answer is a 403 and neither differs by whether the photo exists.
    expect(res.json().error.code).toBe("SESSION_NOT_FOUND");
  });

  it("404s the SAME photo id under another session of the SAME shop", async () => {
    const res = await app.inject({ method: "GET", url: url(shopId, otherSessionId, photoId) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PHOTO_NOT_FOUND");
  });

  it("404s a photo id that exists nowhere, with the same body as one that does", async () => {
    const res = await app.inject({ method: "GET", url: url(shopId, sessionId, MISSING) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PHOTO_NOT_FOUND");
  });

  // Traversal is impossible BY CONSTRUCTION: the served path is built from the
  // stored key and no request field reaches the filesystem at all. These assert
  // the outer half — that none of the classic spellings even routes to a read.
  it.each([
    ["..", ".."],
    ["dot-segments", "../../../../etc/passwd"],
    ["encoded separators", "..%2f..%2fetc%2fpasswd"],
    ["double-encoded", "..%252f..%252fetc%252fpasswd"],
    ["a null byte", "cover.png%00.jpg"],
    ["an absolute path", "%2Fetc%2Fpasswd"],
    ["a storage key", encodeURIComponent(`${UPLOADS_DIR}/session/1-cover.png`)],
  ])("refuses %s in :photoId without reading anything", async (_name, attempt) => {
    const res = await app.inject({ method: "GET", url: url(shopId, sessionId, attempt) });
    // 400 when it routes and fails UUID validation, 404 when it does not route.
    // Both are refusals; neither is a file.
    expect([400, 404]).toContain(res.statusCode);
    expect(["VALIDATION_FAILED", "ROUTE_NOT_FOUND", "PHOTO_NOT_FOUND"]).toContain(res.json().error.code);
    expect(res.rawPayload.includes(Buffer.from("root:"))).toBe(false);
  });

  // Regression for the invariant review of 3acb685. The first version compared
  // `resolve(storage_url)` against `resolve(uploadsDir)` — a LEXICAL compare —
  // so a symlink INSIDE `uploads/<session>/` pointing at a file outside the root
  // normalised to a path that started with the root, passed the check, and was
  // then read through the link. `realpath` resolves the links the read itself
  // would follow, so the path compared is the path opened.
  it("refuses a symlink inside the uploads tree that points outside it", async () => {
    const decoy = join(tmpdir(), `longbox-decoy-${randomUUID()}.png`);
    writeFileSync(decoy, Buffer.from("NOT-A-SHOP-PHOTO"));
    const session = await newSession(shopId);
    const upload = await app.inject({
      method: "POST",
      url: `/api/v1/shops/${shopId}/scan-sessions/${session}/photos`,
      ...multipartPng(),
    });
    expect(upload.statusCode).toBe(201);
    const escapee = (upload.json() as { photo: { id: string } }).photo.id;
    const key = (await listSessionPhotos(pool, shopId, session))[0]!.storage_url;

    // Replace the real photo with a link to the decoy, at the SAME storage key:
    // the row is untouched, so this is exactly the shape a compromised writer or
    // a careless restore would produce.
    rmSync(key);
    symlinkSync(decoy, key);

    const res = await app.inject({ method: "GET", url: url(shopId, session, escapee) });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("PHOTO_NOT_FOUND");
    expect(res.rawPayload.includes(Buffer.from("NOT-A-SHOP-PHOTO"))).toBe(false);
    rmSync(decoy, { force: true });
  });

  it("still serves a photo when the uploads ROOT itself is reached through a symlink", async () => {
    // The other half of the same change, and the reason both sides are
    // realpath'd: a deployment pointing `uploads/` at a mounted volume is
    // ordinary, and comparing a resolved file against an unresolved root would
    // reject every legitimate photo on such a host.
    const linkedRoot = `${UPLOADS_DIR}-link`;
    rmSync(linkedRoot, { force: true });
    symlinkSync(basename(UPLOADS_DIR), linkedRoot);
    const linked = await buildApp(pool, {
      port: 0,
      databaseUrl: appUrl(migrateUrl),
      uploadsDir: linkedRoot,
      bands: { high: 0.85, medium: 0.5 },
    });
    try {
      const res = await linked.inject({ method: "GET", url: url(shopId, sessionId, photoId) });
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload).toEqual(PNG_BYTES);
    } finally {
      await linked.close();
      rmSync(linkedRoot, { force: true });
    }
  });

  it("404s the URL that used to serve the bytes: the public mount is GONE", async () => {
    // `storageUrl` is the exact on-disk key, and `/${storageUrl}` is the exact
    // string the deleted `@fastify/static` mount answered 200 to (046 §3.3 B5).
    const res = await app.inject({ method: "GET", url: `/${storageUrl}` });
    expect(res.statusCode).toBe(404);
    expect(res.rawPayload).not.toEqual(PNG_BYTES);
  });

  it("404s a directory under the old mount: there is no listing to walk", async () => {
    for (const path of [`/${UPLOADS_DIR}/`, `/${UPLOADS_DIR}/${sessionId}/`, `/${UPLOADS_DIR}`]) {
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode, `${path} still answers`).toBe(404);
    }
  });
});
