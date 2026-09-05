// The database half of 046 §11 I4, proved as the role that would actually be
// holding the connection when a write surface exists: `longbox_app`.
//
// Bead: longbox-e5b.3.11 (alias E03-D01). Docs: 046 §5 A7/A15, §11 I4;
// migrations/014; 000-docs/044 §3 (a migration applies clean and its constraints
// are asserted against a live schema, not read off the file).
//
// WHY AS THE APP ROLE AND NOT AS THE MIGRATE ROLE. E02-D06's whole argument is
// that the connection the server holds owns nothing. A CHECK constraint is one
// of the very few controls that binds the OWNER too, and asserting it from the
// least-privileged role is the assertion that matches the threat: 046 §5 A15's
// attacker is whoever reaches a future config write path, and that path runs on
// this connection.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations } from "./helpers.js";

const DB = "longbox_test_credential_namespace";

let enabled = false;
let pool: pg.Pool | undefined;
let ownerPool: pg.Pool | undefined;
let shopId: string | undefined;
let orgId: string;

beforeAll(async () => {
  enabled = await probeDb();
  if (!enabled) return;
  const migrateUrl = await createFreshDb(DB);
  await runMigrations(migrateUrl);
  // A SHOP IS CREATED BY THE OWNING CONNECTION (E03-B04). `shop` is policied on
  // its own `id`, so an INSERT can never satisfy `id = current_shop_id()` — the
  // tenant IS the row being created — which makes onboarding a schema-owner act
  // enforced by the database rather than by convention. Everything the suite
  // EXERCISES still runs on the least-privileged pool.
  ownerPool = new pg.Pool({ connectionString: migrateUrl });
  pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
  // `migrations/019` gives `shop` a validated CHECK that it names a legal party
  // (034 §4.3 A4), so every shop this suite writes carries an organization —
  // including the ones it expects to be REFUSED, or they would be refused for
  // the wrong reason and the slug charset would stop being what is under test.
  const org = await ownerPool.query(`INSERT INTO organization (name) VALUES ('Namespace Org') RETURNING id`);
  orgId = (org.rows[0] as { id: string }).id;
  const res = await ownerPool.query(
    `INSERT INTO shop (name, slug, organization_id) VALUES ($1, $2, $3) RETURNING id`,
    ["Namespace Test Shop", "nstest", orgId]
  );
  shopId = (res.rows[0] as { id: string }).id;
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await ownerPool?.end();
});

async function insertCredential(keyRef: string, baseUrl: string | null): Promise<void> {
  // `shop_credentials` carries a `shop_id` and therefore a tenant policy
  // (E03-B04), and this suite holds the APP-role pool — so the fixture names the
  // shop it is writing for, exactly as the running system does. Without it the
  // `WITH CHECK` refuses first and every CHECK-constraint assertion below would be
  // asserting the wrong refusal.
  await asShop(pool!, shopId!).query(
    `INSERT INTO shop_credentials (shop_id, kind, key_ref, base_url) VALUES ($1,$2,$3,$4)`,
    [shopId, "anthropic", keyRef, baseUrl]
  );
}

describe("shop_credentials refuses a row that could exfiltrate a key (migrations/014)", () => {
  it("accepts the row register-shop writes", async () => {
    if (!enabled) return;
    await expect(insertCredential("LONGBOX_NSTEST_ANTHROPIC_KEY", null)).resolves.toBeUndefined();
    await expect(
      insertCredential("LONGBOX_NSTEST_OPENAI_KEY", "https://api.openai.com/v1")
    ).resolves.toBeUndefined();
  });

  it("refuses a key_ref naming a global secret — the exfiltration primitive's first half", async () => {
    if (!enabled) return;
    for (const hostile of ["ANTHROPIC_API_KEY", "DATABASE_URL", "LLM_API_KEY", "AWS_SECRET_ACCESS_KEY"]) {
      await expect(insertCredential(hostile, null)).rejects.toThrow(/shop_credentials_key_ref_namespaced/);
    }
  });

  it("refuses the old SHOP_<SLUG>_<KIND> convention, which named a variable outside the namespace", async () => {
    if (!enabled) return;
    await expect(insertCredential("SHOP_NSTEST_ANTHROPIC_API_KEY", null)).rejects.toThrow(
      /shop_credentials_key_ref_namespaced/
    );
  });

  it("refuses a base_url off the registered-host list — the second half", async () => {
    if (!enabled) return;
    for (const host of [
      "https://attacker.example",
      "https://api.anthropic.com.attacker.example",
      "http://api.anthropic.com",
    ]) {
      await expect(insertCredential("LONGBOX_NSTEST_ANTHROPIC_KEY", host)).rejects.toThrow(
        /shop_credentials_base_url_registered/
      );
    }
  });

  it("THE SIBLING-SLUG NAME is refused by the CHECK — the invariant review's finding", async () => {
    if (!enabled) return;
    // Shops `gotham` and `gotham-city` in one estate. Under the first version of
    // this constraint (`^LONGBOX_[A-Z0-9]+_[A-Z0-9_]+$`) the name below was
    // well-formed, and `gotham`'s resolver accepted it on a `startsWith` test —
    // so shop `gotham` could read shop `gotham-city`'s key. The closed suffix set
    // removes the second slug segment `CITY` was hiding in.
    await expect(insertCredential("LONGBOX_GOTHAM_CITY_ANTHROPIC_KEY", null)).rejects.toThrow(
      /shop_credentials_key_ref_namespaced/
    );
    // And the fold register-shop actually produces for `gotham-city` is legal.
    await expect(insertCredential("LONGBOX_GOTHAMCITY_ANTHROPIC_KEY", null)).resolves.toBeUndefined();
  });

  it("refuses a suffix outside the closed set, however plausible", async () => {
    if (!enabled) return;
    for (const bad of [
      "LONGBOX_NSTEST_STRIPE_KEY",
      "LONGBOX_NSTEST_ANTHROPIC_TOKEN",
      "LONGBOX_NSTEST_ANTHROPIC_KEY_BACKUP",
    ]) {
      await expect(insertCredential(bad, null)).rejects.toThrow(/shop_credentials_key_ref_namespaced/);
    }
  });

  it("shop.slug now has a charset, so an env fold cannot be re-segmented by a slug", async () => {
    if (!enabled) return;
    // `001:25` gave slug UNIQUE and no charset. A slug carrying `_` or `.` folds
    // into a name whose segmentation nobody intended — the same defect class,
    // entered from the other end.
    for (const bad of ["gotham_city", "gotham.city", "Gotham", "gotham city"]) {
      await expect(
        ownerPool!.query(`INSERT INTO shop (name, slug, organization_id) VALUES ($1, $2, $3)`, [
          "Bad Slug Shop",
          bad,
          orgId,
        ])
      ).rejects.toThrow(/shop_slug_charset/);
    }
    await expect(
      ownerPool!.query(`INSERT INTO shop (name, slug, organization_id) VALUES ($1, $2, $3)`, [
        "Sibling Shop",
        "gotham-city",
        orgId,
      ])
    ).resolves.toBeDefined();
  });

  it("THE HOSTILE ROW IS UNREPRESENTABLE: neither half of it may be written", async () => {
    if (!enabled) return;
    // (key_ref = 'ANTHROPIC_API_KEY', base_url = 'https://attacker.example') —
    // 046 §5 A15's row, refused by the first constraint it meets. Postgres
    // reports one violated constraint; the two cases above prove each half
    // independently, and this one proves the combination is refused as written.
    await expect(insertCredential("ANTHROPIC_API_KEY", "https://attacker.example")).rejects.toThrow(
      /shop_credentials_(key_ref_namespaced|base_url_registered)/
    );
  });

  it("the app role really is the least-privileged one (the refusal is the CHECK, not a grant)", async () => {
    if (!enabled) return;
    const who = await pool!.query(`SELECT current_user AS role`);
    expect((who.rows[0] as { role: string }).role).toBe("longbox_app");
    // Proof the role can write this table at all — otherwise every refusal above
    // would be a permission error wearing a constraint's name.
    const count = await asShop(pool!, shopId!).query(
      `SELECT count(*)::int AS n FROM shop_credentials WHERE shop_id = $1`,
      [shopId]
    );
    expect((count.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });
});
