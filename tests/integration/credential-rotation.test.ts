// Rotation is two append-only facts, and a retirement is unreachable-by-refusal
// — 050 §9 I2 and I7, against a live Postgres.
//
// Bead: longbox-e5b.3.5 (alias E03-B05), the code half. Docs: 050 §2 Q2/Q3, §4,
// §5(a), §9 I2/I7, §10; 041 §8; 044 §3/§7; migrations 021/022.
//
// WHY THIS RUNS AS THE APP ROLE. E02-D06's argument is that the connection the
// server holds owns nothing, so it cannot `ALTER TABLE … DISABLE TRIGGER`. The
// append-only guarantee is worth asserting from the principal that would be
// attacking it, and a `forbid_mutation()` trigger does not consult privileges —
// so a refusal seen from here is the trigger refusing, not a grant.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations } from "./helpers.js";
import {
  introduceCredentialVersion,
  loadCredentialVersions,
  nextVersionNo,
  pickLiveVersion,
  resolveCredentialVersion,
  retireCredentialVersion,
} from "../../src/providers/credentialVersions.js";
import { resolveVisionProvider } from "../../src/providers/registry.js";
import { setCredentialRefusalSink } from "../../src/providers/credentialPolicy.js";

const DB = "longbox_test_credential_rotation";
const SLUG = "rotshop";
const KEY_REF = "LONGBOX_ROTSHOP_ANTHROPIC_KEY";
/** Obeys the fixture-credential convention (E03-D04): `test-…-key`, tests/ only. */
const CANARY = "test-rotation-canary-key";

let enabled = false;
let pool: pg.Pool | undefined;
/** The SCHEMA OWNER's connection — the only one the grant layer does not stop. */
let ownerPool: pg.Pool | undefined;
let shopId: string;
let restoreRefusals: () => void;

/**
 * THE STATEMENTS THIS SUITE ISSUES ITSELF, INSIDE ITS OWN SHOP'S TENANT CONTEXT.
 *
 * E03-B04 put row-level security on every table carrying a `shop_id`, and this
 * suite holds an APP-ROLE pool — the least-privileged role, which is subject to
 * every policy. So a fixture INSERT with no tenant context is refused by
 * `WITH CHECK` and a fixture SELECT returns nothing, exactly as a cross-tenant
 * statement would be. These two helpers name the tenant the way the running
 * system does (`src/db.ts`'s `tenantDb`), and nothing here is sticky: the
 * context is set inside the statement's own transaction and reverts with it.
 *
 * A statement about ANOTHER shop passes that shop explicitly, so a deliberately
 * cross-tenant fixture stays visible rather than reading like the ordinary case.
 */
const shopQuery = (sql: string, values?: unknown[]): Promise<pg.QueryResult> =>
  asShop(pool!, shopId).query(sql, values);

beforeAll(async () => {
  enabled = await probeDb();
  if (!enabled) return;
  const migrateUrl = await createFreshDb(DB);
  await runMigrations(migrateUrl);
  pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
  ownerPool = new pg.Pool({ connectionString: migrateUrl });
  // THE OWNING CONNECTION (E03-B04). `organization` carries no tenant and `shop`
  // is policied on its own `id`, so an INSERT can never satisfy the policy — the
  // tenant IS the row being created. Creating a shop is a schema-owner act.
  const org = await ownerPool.query(`INSERT INTO organization (name) VALUES ('Rotation Org') RETURNING id`);
  const res = await ownerPool.query(
    `INSERT INTO shop (name, slug, organization_id) VALUES ($1,$2,$3) RETURNING id`,
    ["Rotation Test Shop", SLUG, (org.rows[0] as { id: string }).id]
  );
  shopId = (res.rows[0] as { id: string }).id;
  restoreRefusals = setCredentialRefusalSink(() => undefined) as never;
}, 120_000);

afterAll(async () => {
  if (restoreRefusals) setCredentialRefusalSink(restoreRefusals as never);
  await pool?.end();
  await ownerPool?.end();
});

/**
 * A DELETE attempted as the APP role — expected to FAIL.
 *
 * There is no reset helper in this suite on purpose: nothing here can clear an
 * append-only table, so the cases use fresh version numbers instead. This exists
 * only to prove the table really is unclearable by the process that serves.
 */
async function appRoleDelete(): Promise<void> {
  await shopQuery(`DELETE FROM shop_credential_retirement`);
}

describe("I2 — an introduction is an INSERT and a retirement is a SECOND ROW", () => {
  it("appends a version and reads it back live", async () => {
    if (!enabled) return;
    const versionNo = await nextVersionNo(asShop(pool!, shopId), shopId, "anthropic");
    expect(versionNo).toBe(1);
    const id = await introduceCredentialVersion(asShop(pool!, shopId), {
      shopId,
      kind: "anthropic",
      keyRef: KEY_REF,
      versionNo,
    });
    const rows = await loadCredentialVersions(asShop(pool!, shopId), shopId, "anthropic");
    expect(rows.map((r) => r.id)).toContain(id);
    expect(pickLiveVersion(rows).outcome).toBe("live");
  });

  // THE TWO LAYERS, ASSERTED SEPARATELY, because they refuse for different
  // reasons and a test that accepted either would not notice one going away.
  //
  //   * From the APP role, an UPDATE is `permission denied` — refused by the
  //     GRANT, one layer before the trigger (E02-D06). That is the stronger
  //     outcome and the one the server actually meets.
  //   * From the OWNER, the grant does not apply, so the refusal is the
  //     `ENABLE ALWAYS` `forbid_mutation()` trigger itself — the layer that
  //     still holds when the connection is privileged.
  it("REFUSES an UPDATE of a version row: the grant from the app role, the trigger from the owner", async () => {
    if (!enabled) return;
    const rows = await loadCredentialVersions(asShop(pool!, shopId), shopId, "anthropic");
    await expect(
      shopQuery(`UPDATE shop_credential_version SET key_ref = $1 WHERE id = $2`, [KEY_REF, rows[0]!.id])
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ownerPool!.query(`UPDATE shop_credential_version SET key_ref = $1 WHERE id = $2`, [
        KEY_REF,
        rows[0]!.id,
      ])
    ).rejects.toThrow(/append-only|immutable|forbid/i);
  });

  it("REFUSES a DELETE of a version row, at both layers", async () => {
    if (!enabled) return;
    const rows = await loadCredentialVersions(asShop(pool!, shopId), shopId, "anthropic");
    await expect(
      shopQuery(`DELETE FROM shop_credential_version WHERE id = $1`, [rows[0]!.id])
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ownerPool!.query(`DELETE FROM shop_credential_version WHERE id = $1`, [rows[0]!.id])
    ).rejects.toThrow(/append-only|immutable|forbid/i);
  });

  it("retires by appending a second row, and refuses to retire the same version twice", async () => {
    if (!enabled) return;
    const rows = await loadCredentialVersions(asShop(pool!, shopId), shopId, "anthropic");
    const target = rows[0]!;
    await retireCredentialVersion(asShop(pool!, shopId), {
      shopId,
      credentialVersionId: target.id,
      reasonCode: "rotation",
    });
    // `UNIQUE (credential_version_id)` — `003:149`'s move applied to a
    // credential. Retiring twice is either a bug or two people acting on stale
    // information, and both deserve an error rather than a second row that makes
    // "when was this retired" ambiguous.
    await expect(
      retireCredentialVersion(asShop(pool!, shopId), {
        shopId,
        credentialVersionId: target.id,
        reasonCode: "compromise_suspected",
      })
    ).rejects.toThrow(/unique|duplicate key/i);
  });

  it("REFUSES an UPDATE of a retirement row too, at both layers", async () => {
    if (!enabled) return;
    const res = await shopQuery(`SELECT id FROM shop_credential_retirement LIMIT 1`);
    const id = (res.rows[0] as { id: string }).id;
    await expect(
      shopQuery(`UPDATE shop_credential_retirement SET reason_code = 'x' WHERE id = $1`, [id])
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ownerPool!.query(`UPDATE shop_credential_retirement SET reason_code = 'x' WHERE id = $1`, [id])
    ).rejects.toThrow(/append-only|immutable|forbid/i);
    // …and the app role cannot clear the table either, which is what makes the
    // "unreachable" property in I7 below hold against the process that serves.
    await expect(appRoleDelete()).rejects.toThrow();
  });

  it("`reason_code` is OPEN-WORLD: a reason nobody predicted is not blocked by a CHECK", async () => {
    if (!enabled) return;
    // `003:134-143`'s rule, applied to a credential: a schema constraint must
    // never stop somebody retiring a key at the moment they need to.
    const versionNo = await nextVersionNo(asShop(pool!, shopId), shopId, "shopify");
    const id = await introduceCredentialVersion(asShop(pool!, shopId), {
      shopId,
      kind: "shopify",
      keyRef: "LONGBOX_ROTSHOP_SHOPIFY_KEY",
      versionNo,
    });
    await expect(
      retireCredentialVersion(asShop(pool!, shopId), {
        shopId,
        credentialVersionId: id,
        reasonCode: "a_reason_nobody_wrote_down",
      })
    ).resolves.toBeTruthy();
  });
});

describe("I7 — a retirement makes the key unreachable while the VARIABLE IS STILL SET", () => {
  it("resolves the newest live version across a rotation, then refuses when the last one retires", async () => {
    if (!enabled) return;
    // The environment variable is set throughout. That is the point: 050 §5(a)
    // inverts the usual order deliberately, so the software stops being able to
    // use the key BEFORE the operations half removes it. An offboarding whose
    // SOPS edit slips a day is then a shop that cannot make calls — visible,
    // loud, fixable — rather than a shop whose key is quietly still live.
    process.env[KEY_REF] = CANARY;
    try {
      const v2 = await nextVersionNo(asShop(pool!, shopId), shopId, "anthropic");
      const newId = await introduceCredentialVersion(asShop(pool!, shopId), {
        shopId,
        kind: "anthropic",
        keyRef: KEY_REF,
        versionNo: v2,
      });
      const resolved = await resolveVisionProvider(asShop(pool!, shopId), shopId);
      expect(resolved.credentialVersionId).toBe(newId);

      await retireCredentialVersion(asShop(pool!, shopId), {
        shopId,
        credentialVersionId: newId,
        reasonCode: "offboarding",
      });
      expect((await resolveCredentialVersion(asShop(pool!, shopId), shopId, "anthropic")).outcome).toBe(
        "all_retired"
      );

      // The refusal names the RETIREMENT and not the environment — an operator
      // reading it must not go looking for an unset variable that is in fact set.
      const err = await resolveVisionProvider(asShop(pool!, shopId), shopId).catch(
        (e: unknown) => e as Error
      );
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/retired/);
      expect((err as Error).message).not.toMatch(/unset/);
      // And no refusal ever repeats the value it refused to hand over.
      expect((err as Error).message).not.toContain(CANARY);
    } finally {
      delete process.env[KEY_REF];
    }
  });

  it("does not fall through to the global environment when every version is retired", async () => {
    if (!enabled) return;
    // Both variables set. A fall-through would resolve happily and the shop
    // would silently spend the estate's key — the substitution E03-D01 removed
    // and 050 §4 extends from "has a row" to "has a live version".
    process.env[KEY_REF] = CANARY;
    process.env["ANTHROPIC_API_KEY"] = "test-estate-global-key";
    try {
      await expect(resolveVisionProvider(asShop(pool!, shopId), shopId)).rejects.toThrow(/retired/);
    } finally {
      delete process.env[KEY_REF];
      delete process.env["ANTHROPIC_API_KEY"];
    }
  });
});
