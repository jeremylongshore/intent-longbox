// L3: `findSessionPhoto` and `readPhoto` against a fake pool and a real
// temporary directory (E03-D05).
//
// The integration file proves the ROUTE. This one proves the two branches a
// fake can decide and an HTTP test cannot reach cheaply:
//
//   1. the SQL asks for all three ids in ONE predicate — the tenancy control is
//      the statement, not a comparison a later author can forget to write;
//   2. every refusal inside `readPhoto` is `PHOTO_NOT_FOUND` — an unservable
//      extension, a path outside the uploads root, a symlink pointing out of it,
//      a missing file, a directory. One code, so nothing about the miss leaks
//      through the status (019 T24).
//
// The containment branch is the one the invariant review of `3acb685` caught:
// the first version compared normalised STRINGS, which a symlink walks straight
// past.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import * as api from "../src/services/sessionApi.js";
import { findSessionPhoto } from "../src/services/scanSession.js";
import { ShopRateLimiter } from "../src/services/rateLimit.js";
import { fakePool, fakeTxPool } from "./fakes.js";
import { testConfig } from "./testConfig.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const PHOTO = "33333333-3333-4333-8333-333333333333";
const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

let root: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "longbox-photoread-"));
  outside = mkdtempSync(join(tmpdir(), "longbox-outside-"));
  mkdirSync(join(root, SESSION), { recursive: true });
  writeFileSync(join(root, SESSION, "1-cover.png"), BYTES);
  writeFileSync(join(outside, "decoy.png"), Buffer.from("NOT-A-SHOP-PHOTO"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

/**
 * A pool that answers the session lookup, then the photo lookup.
 *
 * `fakeTxPool` rather than `fakePool` since E03-B04: `readPhoto` reads through a
 * TENANT-SCOPED handle, and a scoped read is a transaction (`BEGIN` +
 * `set_config` + the statement + `COMMIT`) because that is the only place a
 * transaction-local tenant context can live (034 §3.2). A query-only fake has no
 * `connect()` and the read would fail before it reached the assertion.
 */
function poolFor(storageUrl: string | null): { pool: pg.Pool; calls: { text: string }[] } {
  const { pool, calls } = fakeTxPool((text) => {
    if (text.includes("FROM scan_session")) return { rows: [{ id: SESSION, shop_id: SHOP }] };
    if (text.includes("FROM scan_photo")) {
      return storageUrl === null
        ? { rows: [] }
        : { rows: [{ id: PHOTO, kind: "cover", storage_url: storageUrl }] };
    }
    return undefined;
  });
  return { pool, calls };
}

function deps(pool: pg.Pool, uploadsDir = root): api.ApiDeps {
  return {
    pool,
    config: testConfig({ databaseUrl: "postgres://unused", uploadsDir }),
    limiter: new ShopRateLimiter(),
  };
}

async function refusalCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_REFUSAL";
  } catch (err) {
    return (err as { code?: string }).code ?? "NOT_A_LONGBOX_ERROR";
  }
}

describe("findSessionPhoto (the tenancy predicate)", () => {
  it("asks for photo id AND session id AND shop id in one statement", async () => {
    const { pool, calls } = fakePool(() => ({ rows: [] }));
    await findSessionPhoto(pool, SHOP, SESSION, PHOTO);
    const sql = calls[0]!.text.replace(/\s+/g, " ");
    // Not three separate reads and not a fetch-then-compare: a row that fails
    // any one of the three is simply not returned, so "another shop's photo"
    // and "no such photo" are the same event before any code branches.
    expect(sql).toContain("WHERE id = $1 AND scan_session_id = $2 AND shop_id = $3");
    expect(calls[0]!.values).toEqual([PHOTO, SESSION, SHOP]);
    // 042 I5: named columns, never `SELECT *`.
    expect(sql).not.toContain("SELECT *");
  });

  it("returns undefined rather than throwing when nothing matches", async () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    expect(await findSessionPhoto(pool, SHOP, SESSION, PHOTO)).toBeUndefined();
  });
});

describe("readPhoto (the read that replaced the public mount)", () => {
  it("streams the bytes with the type the extension names", async () => {
    const { pool } = poolFor(join(root, SESSION, "1-cover.png"));
    const photo = await api.readPhoto(deps(pool), SHOP, SESSION, PHOTO);
    expect(photo.contentType).toBe("image/png");
    expect(photo.contentLength).toBe(BYTES.length);
  });

  it("refuses a row with no matching photo", async () => {
    const { pool } = poolFor(null);
    expect(await refusalCode(api.readPhoto(deps(pool), SHOP, SESSION, PHOTO))).toBe("PHOTO_NOT_FOUND");
  });

  // SERVABLE_TYPES is a CLOSED map, and this is why: an extension we do not
  // recognise is unservable rather than guessed, because guessing a type for a
  // stored `.html` is how a photograph becomes a same-origin script.
  it.each([
    ["a stored .html", "evil.html"],
    ["a stored .svg", "evil.svg"],
    ["no extension at all", "cover"],
  ])("refuses %s as an unservable type", async (_name, name) => {
    writeFileSync(join(root, SESSION, name), BYTES);
    const { pool } = poolFor(join(root, SESSION, name));
    expect(await refusalCode(api.readPhoto(deps(pool), SHOP, SESSION, PHOTO))).toBe("PHOTO_NOT_FOUND");
  });

  it("refuses a stored key that resolves outside the uploads root", async () => {
    const { pool } = poolFor(join(outside, "decoy.png"));
    expect(await refusalCode(api.readPhoto(deps(pool), SHOP, SESSION, PHOTO))).toBe("PHOTO_NOT_FOUND");
  });

  it("refuses a key that only LOOKS inside the root (the sibling-prefix case)", async () => {
    // `<root>-evil/x.png` starts with `<root>` as a STRING and is not inside it
    // as a directory. This is why the compare is against `root + sep` and not a
    // bare `startsWith(root)`.
    const sibling = `${root}-evil`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, "x.png"), BYTES);
    try {
      const { pool } = poolFor(join(sibling, "x.png"));
      expect(await refusalCode(api.readPhoto(deps(pool), SHOP, SESSION, PHOTO))).toBe("PHOTO_NOT_FOUND");
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  // THE REGRESSION. A lexical compare passes this: `resolve()` normalises the
  // string and never touches the disk, so a link inside the tree pointing out of
  // it reads as contained and is then followed by the read.
  it("refuses a SYMLINK inside the root that points outside it", async () => {
    const link = join(root, SESSION, "escape.png");
    rmSync(link, { force: true });
    symlinkSync(join(outside, "decoy.png"), link);
    try {
      // The lexical test the old code did, shown passing, so this test states
      // what changed rather than merely asserting the new answer.
      expect(resolve(link).startsWith(resolve(root))).toBe(true);
      const { pool } = poolFor(link);
      expect(await refusalCode(api.readPhoto(deps(pool), SHOP, SESSION, PHOTO))).toBe("PHOTO_NOT_FOUND");
    } finally {
      rmSync(link, { force: true });
    }
  });

  it("still serves when the ROOT is reached through a symlink", async () => {
    // Both sides are realpath'd, so a deployment whose `uploads/` is a link to a
    // mounted volume keeps working. Resolving only one side would refuse every
    // legitimate photo on such a host.
    const linkedRoot = `${root}-link`;
    rmSync(linkedRoot, { force: true });
    symlinkSync(root, linkedRoot);
    try {
      const { pool } = poolFor(join(root, SESSION, "1-cover.png"));
      const photo = await api.readPhoto(deps(pool, linkedRoot), SHOP, SESSION, PHOTO);
      expect(photo.contentLength).toBe(BYTES.length);
    } finally {
      rmSync(linkedRoot, { force: true });
    }
  });

  it("refuses a row whose bytes are gone", async () => {
    const { pool } = poolFor(join(root, SESSION, "never-written.png"));
    expect(await refusalCode(api.readPhoto(deps(pool), SHOP, SESSION, PHOTO))).toBe("PHOTO_NOT_FOUND");
  });

  it("refuses a key that names a DIRECTORY rather than a file", async () => {
    const dir = join(root, SESSION, "notafile.png");
    mkdirSync(dir, { recursive: true });
    try {
      const { pool } = poolFor(dir);
      expect(await refusalCode(api.readPhoto(deps(pool), SHOP, SESSION, PHOTO))).toBe("PHOTO_NOT_FOUND");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses before the photo lookup when the session is not this shop's", async () => {
    const { pool } = fakeTxPool((text) => (text.includes("FROM scan_session") ? { rows: [] } : undefined));
    // SESSION_NOT_FOUND, not PHOTO_NOT_FOUND: the session rung refuses first, so
    // a cross-shop caller learns nothing about the session either. Both are 404.
    expect(await refusalCode(api.readPhoto(deps(pool), SHOP, SESSION, PHOTO))).toBe("SESSION_NOT_FOUND");
  });
});
