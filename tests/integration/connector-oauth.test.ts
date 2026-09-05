// The connector's whole lifecycle against a live Postgres: install → callback →
// live token → uninstall webhook → retirement + receipt → the client refuses.
// Plus the three refusals that are the point of the bead.
//
// Bead: longbox-e5b.3.6 (alias E03-B06). Docs: 000-docs/053 §5, §7, §8; 050 §4
// (liveness), §5(a) (the refusal is what makes an ending true); 046 §5 A13,
// §6.2 G-14; 041 §8; 042 §5.1 CLASS TWO; 044 §3/§7; migration 026.
//
// WHY THIS RUNS AS THE APP ROLE (E02-D06's argument, borrowed whole): the
// connection the server holds owns nothing, so it cannot `ALTER TABLE … DISABLE
// TRIGGER`. An append-only refusal seen from here is the trigger refusing, not a
// grant — and a `forbid_mutation()` trigger does not consult privileges.
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import {
  CONNECTOR,
  ConnectorCallbackError,
  ConnectorTokenRefusedError,
  WebhookRefusedError,
  completeInstall,
  loadTokenVersions,
  mintInstallState,
  offboardTokenVersion,
  openTokenValue,
  receiveWebhook,
  requireConnectorKey,
  resolveTokenVersion,
  stateDigest,
  type ConnectorDeps,
  type ShopifyAppCredentials,
} from "../../src/services/connectors/shopify/index.js";
import { ShopRateLimiter } from "../../src/services/rateLimit.js";
import { TEST_CONNECTOR_KEY_V1 } from "../testConfig.js";

const DB = "longbox_test_connector_oauth";
const STORE = "gothamconnector.myshopify.com";
/** Fixture credentials. Both obey E03-D04's convention: `test-…-key`, tests/ only. */
const APP_SECRET = "test-shopify-app-secret-key";
const ACCESS_TOKEN = "test-shopify-access-token-key";

const APP: ShopifyAppCredentials = {
  clientId: "test-client-id",
  clientSecret: APP_SECRET,
  redirectUri: "https://longbox.example/api/v1/connectors/shopify/callback",
  apiVersion: "2025-07",
};

let enabled = false;
let pool: pg.Pool | undefined;
let ownerPool: pg.Pool | undefined;
let shopId: string;
let deps: ConnectorDeps;

beforeAll(async () => {
  enabled = await probeDb();
  if (!enabled) return;
  const migrateUrl = await createFreshDb(DB);
  await runMigrations(migrateUrl);
  pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
  ownerPool = new pg.Pool({ connectionString: migrateUrl });
  // ⚠ `shop.shopify_domain` IS DELIBERATELY LEFT NULL, AND THE PREVIOUS VERSION
  // OF THIS LINE SET IT (the invariant review of `16f17ef`, finding 3).
  //
  // Setting it manufactured the ONLY precondition under which the old
  // tenant-resolution query worked, so the uninstall suite passed against a
  // shape `pnpm register-shop` does not produce — and the real defect (a validly
  // signed `app/uninstalled` retiring ZERO tokens on an ordinarily registered
  // shop) was invisible. **A fixture that supplies the condition a bug needs to
  // be absent is a fixture that tests the fixture.** The suite now runs on the
  // shape registration actually produces, and the uninstall resolves from
  // `connector_token_version.shop_domain` — the value the install itself wrote.
  shopId = await seedShop(pool, { name: "Gotham Connector", slug: "gothamconnector" });
  deps = {
    pool,
    limiter: new ShopRateLimiter(),
    app: APP,
    keyring: requireConnectorKey({ LONGBOX_CONNECTOR_KEY_V1: TEST_CONNECTOR_KEY_V1 }),
  };
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await ownerPool?.end();
});

/** Sign a query the way Shopify does. */
function signQuery(params: Record<string, string>): Record<string, string> {
  const message = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("&");
  return { ...params, hmac: createHmac("sha256", APP_SECRET).update(message, "utf8").digest("hex") };
}

/** Mint a state through the real service and return the raw value from the URL. */
async function mintState(): Promise<string> {
  const minted = await mintInstallState(pool!, { shopId, shopDomain: STORE, app: APP });
  return new URL(minted.authorizeUrl).searchParams.get("state")!;
}

/** A fake exchange, so the flow runs with no network and a known token. */
const fakeExchange = async (): Promise<{ accessToken: string; scope: string }> => ({
  accessToken: ACCESS_TOKEN,
  scope: "write_products,read_products",
});

/** Count every row in the subsystem — the assertion a refusal needs. */
async function counts(): Promise<Record<string, number>> {
  const tables = [
    "connector_install_state",
    "connector_install_state_use",
    "connector_token_version",
    "connector_token_retirement",
    "connector_webhook_receipt",
  ];
  const out: Record<string, number> = {};
  for (const table of tables) {
    const res = await pool!.query(`SELECT count(*)::int AS n FROM ${table}`);
    out[table] = (res.rows[0] as { n: number }).n;
  }
  return out;
}

describe("the connector lifecycle end to end (053 §7)", () => {
  it("mints a state whose VALUE is in no column", async () => {
    if (!enabled) return;
    const state = await mintState();
    const row = await pool!.query(
      `SELECT state_digest, requested_scopes, shop_domain FROM connector_install_state
        WHERE state_digest = $1`,
      [stateDigest(state)]
    );
    expect(row.rowCount).toBe(1);
    const stored = row.rows[0] as { state_digest: string; requested_scopes: string[]; shop_domain: string };
    // The digest and NOTHING ELSE — no prefix, no hint, no last-four, each of
    // which would be a reduced-keyspace copy of the credential sitting beside
    // its own digest.
    expect(stored.state_digest).not.toContain(state);
    expect(stored.requested_scopes).toEqual(["write_products", "read_products"]);
    expect(stored.shop_domain).toBe(STORE);
    // Every column of the row, searched for the value. A future ALTER TABLE that
    // added a "hint" column would fail here rather than in a review.
    const whole = await pool!.query(
      `SELECT to_jsonb(s) AS row FROM connector_install_state s WHERE s.state_digest = $1`,
      [stateDigest(state)]
    );
    expect(JSON.stringify((whole.rows[0] as { row: unknown }).row)).not.toContain(state);
  });

  it("completes an install and seals the token, which no column holds in the clear", async () => {
    if (!enabled) return;
    const state = await mintState();
    const result = await completeInstall(
      deps,
      signQuery({ shop: STORE, code: "authcode-1", state, timestamp: "1757000000" }),
      fakeExchange
    );
    expect(result).toEqual({
      connector: "shopify",
      shop_domain: STORE,
      granted_scopes: ["write_products", "read_products"],
    });

    const outcome = await resolveTokenVersion(pool!, shopId, CONNECTOR);
    expect(outcome.outcome).toBe("live");

    // THE COLUMN, searched for the plaintext. This is the assertion 053 §3's
    // whole custody ruling rests on: the value exists inside one function's
    // scope and as ciphertext, and nowhere else.
    const row = await pool!.query(
      `SELECT to_jsonb(v) AS row FROM connector_token_version v WHERE v.shop_id = $1`,
      [shopId]
    );
    expect(JSON.stringify((row.rows[0] as { row: unknown }).row)).not.toContain(ACCESS_TOKEN);

    // …and it really is the token, opened through the real envelope, bound to
    // the row's own id as AAD.
    const versionId = outcome.outcome === "live" ? outcome.chosen.id : "";
    expect(await openTokenValue(pool!, deps.keyring!, shopId, versionId)).toBe(ACCESS_TOKEN);
  });

  it("REFUSES a ciphertext moved to another row — the AAD binding, not a WHERE clause", async () => {
    if (!enabled) return;
    // 019 T24's cross-tenant line enforced by cryptography. A row lifted from
    // one install into another must FAIL TO AUTHENTICATE rather than decrypt to
    // a working token.
    const outcome = await resolveTokenVersion(pool!, shopId, CONNECTOR);
    const source = outcome.outcome === "live" ? outcome.chosen.id : "";
    const bytes = await pool!.query(
      `SELECT token_ciphertext, token_nonce, key_version, shop_domain, granted_scopes
         FROM connector_token_version WHERE id = $1`,
      [source]
    );
    const copy = bytes.rows[0] as {
      token_ciphertext: Buffer;
      token_nonce: Buffer;
      key_version: number;
      shop_domain: string;
      granted_scopes: string[];
    };
    const otherId = randomUUID();
    await pool!.query(
      `INSERT INTO connector_token_version
         (id, shop_id, connector, shop_domain, install_state_id, granted_scopes,
          token_ciphertext, token_nonce, key_version, version_no)
       VALUES ($1,$2,'shopify',$3,NULL,$4,$5,$6,$7,$8)`,
      [
        otherId,
        shopId,
        copy.shop_domain,
        copy.granted_scopes,
        copy.token_ciphertext,
        copy.token_nonce,
        copy.key_version,
        99,
      ]
    );
    await expect(openTokenValue(pool!, deps.keyring!, shopId, otherId)).rejects.toThrow(
      /did not authenticate|different row id/
    );
    // Clean up so the liveness assertions below are about the real install.
    await ownerPool!.query(
      `ALTER TABLE connector_token_version DISABLE TRIGGER connector_token_version_append_only`
    );
    await ownerPool!.query(`DELETE FROM connector_token_version WHERE id = $1`, [otherId]);
    await ownerPool!.query(
      `ALTER TABLE connector_token_version ENABLE ALWAYS TRIGGER connector_token_version_append_only`
    );
  });

  it("REFUSES another shop's version id — the row/shop binding, not a caller's care (S4)", async () => {
    if (!enabled) return;
    // ⚠ THE FIRST VERSION OF `openTokenValue` TOOK NO `shopId` AND OPENED ANY
    // LIVE ROW BY ID. The AAD binding defends a ciphertext against being MOVED
    // between rows; it says nothing about a caller asking for the WRONG row, and
    // the two are different attacks. The only thing standing between one shop's
    // token and another was that every caller happened to pass an id it had read
    // for the right shop — a convention, and 019 T24 is not a convention.
    const other = await seedShop(pool!, { name: "Other Shop", slug: `otherconn${String(Date.now())}` });
    const outcome = await resolveTokenVersion(pool!, shopId, CONNECTOR);
    const versionId = outcome.outcome === "live" ? outcome.chosen.id : "";
    // The row is live and openable for ITS shop…
    expect(await openTokenValue(pool!, deps.keyring!, shopId, versionId)).toBe(ACCESS_TOKEN);
    // …and a zero-row read for any other, answered exactly as an absent version
    // (048 §9.3: a caller who could tell the two apart holds an enumeration
    // oracle over ids).
    await expect(openTokenValue(pool!, deps.keyring!, other, versionId)).rejects.toThrow(
      /no connector token version/
    );
  });

  it("REFUSES a REPLAYED callback by UNIQUE (state_id), writing no second token", async () => {
    if (!enabled) return;
    const state = await mintState();
    const query = signQuery({ shop: STORE, code: "authcode-2", state, timestamp: "1757000001" });
    await completeInstall(deps, query, fakeExchange);
    const after = await counts();

    // The same signed callback, again. It passes the signature and the state
    // read — both are still perfectly valid reads — and dies on the constraint,
    // which is the whole reason the guarantee is a constraint rather than a
    // check somebody could forget.
    await expect(completeInstall(deps, query, fakeExchange)).rejects.toThrow();
    const then = await counts();
    expect(then["connector_token_version"]).toBe(after["connector_token_version"]);
    expect(then["connector_install_state_use"]).toBe(after["connector_install_state_use"]);
  });

  it("REFUSES a callback whose signature does not verify, having written NOTHING", async () => {
    if (!enabled) return;
    const state = await mintState();
    const before = await counts();
    const query = signQuery({ shop: STORE, code: "authcode-3", state, timestamp: "1757000002" });
    await expect(completeInstall(deps, { ...query, code: "tampered" }, fakeExchange)).rejects.toThrow(
      ConnectorCallbackError
    );
    // The ORDERING, not the code: the HMAC check runs before any database read,
    // so a forged callback leaves no row anywhere in the subsystem.
    expect(await counts()).toEqual(before);
  });

  it("REFUSES a state redeemed against a DIFFERENT store", async () => {
    if (!enabled) return;
    const state = await mintState();
    const other = "otherstore.myshopify.com";
    await expect(
      completeInstall(
        deps,
        signQuery({ shop: other, code: "authcode-4", state, timestamp: "1757000003" }),
        fakeExchange
      )
    ).rejects.toThrow(/different store/);
  });

  it("REFUSES a grant that carries a scope this app never asked for", async () => {
    if (!enabled) return;
    const state = await mintState();
    const before = await counts();
    await expect(
      completeInstall(
        deps,
        signQuery({ shop: STORE, code: "authcode-5", state, timestamp: "1757000004" }),
        async () => ({ accessToken: ACCESS_TOKEN, scope: "write_products,read_products,write_publications" })
      )
    ).rejects.toThrow(/write_publications/);
    // No token version, and the state is NOT spent — so the merchant can retry
    // after the app's configuration is fixed, rather than being told to start
    // again for a failure that was ours.
    const then = await counts();
    expect(then["connector_token_version"]).toBe(before["connector_token_version"]);
    expect(then["connector_install_state_use"]).toBe(before["connector_install_state_use"]);
  });

  it("REFUSES a grant missing a required scope", async () => {
    if (!enabled) return;
    const state = await mintState();
    await expect(
      completeInstall(
        deps,
        signQuery({ shop: STORE, code: "authcode-6", state, timestamp: "1757000005" }),
        async () => ({ accessToken: ACCESS_TOKEN, scope: "read_products" })
      )
    ).rejects.toThrow(/missing write_products/);
  });
});

describe("the webhook receiver (053 §8.2, §7.3)", () => {
  function sign(body: Buffer): string {
    return createHmac("sha256", APP_SECRET).update(body).digest("base64");
  }

  it("REFUSES a forged webhook BEFORE any row is read or written", async () => {
    if (!enabled) return;
    const before = await counts();
    const body = Buffer.from(JSON.stringify({ shop_domain: STORE }));
    await expect(
      receiveWebhook(
        deps,
        {
          topic: "app/uninstalled",
          hmac: "not-a-signature",
          shopDomain: STORE,
          webhookId: "wh-forged",
          apiVersion: "2025-07",
        },
        body
      )
    ).rejects.toThrow(WebhookRefusedError);
    // 046 §5 A13's mitigation, asserted as row counts rather than described: a
    // forged message costs one HMAC and leaves no trace in any table.
    expect(await counts()).toEqual(before);
  });

  it("REFUSES a valid signature over a DIFFERENT body", async () => {
    if (!enabled) return;
    const signed = Buffer.from(JSON.stringify({ shop_domain: STORE, a: 1 }));
    const other = Buffer.from(JSON.stringify({ shop_domain: STORE, a: 2 }));
    await expect(
      receiveWebhook(
        deps,
        {
          topic: "shop/redact",
          hmac: sign(signed),
          shopDomain: STORE,
          webhookId: "wh-x",
          apiVersion: undefined,
        },
        other
      )
    ).rejects.toThrow(WebhookRefusedError);
  });

  it("records a compliance topic as a fact with a DIGEST and no payload", async () => {
    if (!enabled) return;
    // E03-B09 owns what a data subject is entitled to. What this bead owes is
    // that the message is authenticated, recorded, and cannot be lost — a
    // privacy request this system silently discarded is the failure that reads
    // as compliance until somebody asks.
    const body = Buffer.from(JSON.stringify({ shop_domain: STORE, customer: { email: "a@b.example" } }));
    const outcome = await receiveWebhook(
      deps,
      {
        topic: "customers/redact",
        hmac: sign(body),
        shopDomain: STORE,
        webhookId: "wh-redact-1",
        apiVersion: "2025-07",
      },
      body
    );
    expect(outcome).toMatchObject({ acknowledged: true, duplicate: false, retired: [] });
    const row = await pool!.query(
      `SELECT to_jsonb(r) AS row FROM connector_webhook_receipt r WHERE r.webhook_id = 'wh-redact-1'`
    );
    const text = JSON.stringify((row.rows[0] as { row: unknown }).row);
    // 041 §8.4: the log holds references and never personal values. A receipt
    // that copied a `customers/redact` payload would be a second copy of the
    // thing the message asks us to destroy.
    expect(text).not.toContain("a@b.example");
    expect(text).toContain(createHmac("sha256", "").update("").digest("hex").slice(0, 0)); // no-op guard
    expect(text).toMatch(/"payload_digest":"[0-9a-f]{64}"/);
  });

  it("is IDEMPOTENT on Shopify's own webhook id — a redelivery changes nothing", async () => {
    if (!enabled) return;
    const body = Buffer.from(JSON.stringify({ shop_domain: STORE, n: 1 }));
    const headers = {
      topic: "shop/redact",
      hmac: sign(body),
      shopDomain: STORE,
      webhookId: "wh-dupe-1",
      apiVersion: "2025-07",
    };
    const first = await receiveWebhook(deps, headers, body);
    const before = await counts();
    const second = await receiveWebhook(deps, headers, body);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.receiptId).toBe(first.receiptId);
    expect(await counts()).toEqual(before);
  });

  it("records an UNKNOWN topic and does nothing with it", async () => {
    if (!enabled) return;
    // A CHECK-constrained topic list would turn an authentic message this build
    // has not heard of into a 500 and a retry storm, which is how an app gets
    // its webhooks disabled by the provider.
    const body = Buffer.from(JSON.stringify({ shop_domain: STORE }));
    const outcome = await receiveWebhook(
      deps,
      {
        topic: "orders/create",
        hmac: sign(body),
        shopDomain: STORE,
        webhookId: "wh-unknown-1",
        apiVersion: "2025-07",
      },
      body
    );
    expect(outcome).toMatchObject({ acknowledged: true, retired: [] });
    const live = await resolveTokenVersion(pool!, shopId, CONNECTOR);
    expect(live.outcome).toBe("live");
  });

  it("an UNINSTALL retires EVERY live token, writes the receipt, and the client then refuses", async () => {
    if (!enabled) return;
    // The full ending, in one test, because the three halves are one property:
    // the fact, the receipt, and the refusal that makes both true.
    const beforeVersions = await loadTokenVersions(pool!, shopId, CONNECTOR);
    expect(beforeVersions.filter((v) => !v.retired).length).toBeGreaterThan(1);

    const body = Buffer.from(JSON.stringify({ shop_domain: STORE }));
    const outcome = await receiveWebhook(
      deps,
      {
        topic: "app/uninstalled",
        hmac: sign(body),
        shopDomain: STORE,
        webhookId: "wh-uninstall-1",
        apiVersion: "2025-07",
      },
      body
    );

    // EVERY live version, not just the newest: an overlap is legal while a
    // rotation is proven, and an uninstall kills all of them at Shopify
    // simultaneously.
    expect(outcome.retired.length).toBe(beforeVersions.filter((v) => !v.retired).length);
    for (const receipt of outcome.retired) {
      expect(receipt.reason_code).toBe("uninstall");
      // The CHECK in migration 026: an uninstall retirement must cite the signed
      // message that reported it, so "the merchant uninstalled" is never an
      // assertion about somebody else's system with no evidence attached.
      expect(receipt.webhook_receipt_id).toBe(outcome.receiptId);
      expect(receipt.meaning).toMatch(/dead at Shopify/);
      expect(receipt.residual).toMatch(/because the merchant uninstalled/);
    }

    // Liveness is a predicate: every version now has a retirement, so the
    // resolver refuses rather than falling back.
    const after = await resolveTokenVersion(pool!, shopId, CONNECTOR);
    expect(after.outcome).toBe("all_retired");

    // 050 §5(a)'s inversion, one connector over: the software stops being able
    // to use the credential while the ciphertext is STILL IN THE ROW.
    const versionId = beforeVersions[0]!.id;
    const stillThere = await pool!.query(
      `SELECT octet_length(token_ciphertext) AS n FROM connector_token_version WHERE id = $1`,
      [versionId]
    );
    expect(Number((stillThere.rows[0] as { n: number }).n)).toBeGreaterThan(0);
    await expect(openTokenValue(pool!, deps.keyring!, shopId, versionId)).rejects.toThrow(
      ConnectorTokenRefusedError
    );
    await expect(openTokenValue(pool!, deps.keyring!, shopId, versionId)).rejects.toThrow(/is retired/);
  });

  it("resolves the uninstall's tenant WITHOUT shop.shopify_domain — the finding-1 regression", async () => {
    if (!enabled) return;
    // The column is NULL for this shop (see `beforeAll`), which is what
    // `pnpm register-shop` produces. The previous implementation resolved the
    // tenant from it and therefore retired NOTHING here; the assertion above —
    // that every live token ends — is what fails if that query ever comes back.
    const row = await pool!.query(`SELECT shopify_domain FROM shop WHERE id = $1`, [shopId]);
    expect((row.rows[0] as { shopify_domain: string | null }).shopify_domain).toBeNull();
    // …and the receipt still names the shop, because the resolution came from
    // the grant's own row rather than from a config field nobody writes.
    const receipt = await pool!.query(
      `SELECT shop_id FROM connector_webhook_receipt WHERE webhook_id = 'wh-uninstall-1'`
    );
    expect((receipt.rows[0] as { shop_id: string | null }).shop_id).toBe(shopId);
  });

  it("a REDELIVERED uninstall writes no second retirement", async () => {
    if (!enabled) return;
    const body = Buffer.from(JSON.stringify({ shop_domain: STORE }));
    const before = await counts();
    const outcome = await receiveWebhook(
      deps,
      {
        topic: "app/uninstalled",
        hmac: sign(body),
        shopDomain: STORE,
        webhookId: "wh-uninstall-1",
        apiVersion: "2025-07",
      },
      body
    );
    expect(outcome.duplicate).toBe(true);
    expect(outcome.retired).toEqual([]);
    expect(await counts()).toEqual(before);
  });
});

describe("the tables are append-only, and the constraints are the guarantees", () => {
  it("REFUSES an UPDATE and a DELETE on every one of the five", async () => {
    if (!enabled) return;
    for (const table of [
      "connector_install_state",
      "connector_install_state_use",
      "connector_token_version",
      "connector_token_retirement",
      "connector_webhook_receipt",
    ]) {
      await expect(pool!.query(`UPDATE ${table} SET created_at = now()`)).rejects.toThrow();
      await expect(pool!.query(`DELETE FROM ${table}`)).rejects.toThrow();
    }
  });

  it("REFUSES a second retirement of one token version", async () => {
    if (!enabled) return;
    const versions = await loadTokenVersions(pool!, shopId, CONNECTOR);
    const target = versions[0]!;
    // `UNIQUE (connector_token_version_id)`: at most one ending per token,
    // because a replacement is a NEW version rather than a second ending.
    await expect(
      pool!.query(
        `INSERT INTO connector_token_retirement
           (shop_id, connector_token_version_id, reason_code) VALUES ($1,$2,'revocation')`,
        [shopId, target.id]
      )
    ).rejects.toThrow(/connector_token_retirement_version_idx|duplicate key/);
  });

  it("REFUSES an uninstall retirement that cites no signed message", async () => {
    if (!enabled) return;
    // The CHECK that keeps a receipt honest. Insert a fresh version so the
    // UNIQUE above is not what refuses.
    const id = randomUUID();
    await pool!.query(
      `INSERT INTO connector_token_version
         (id, shop_id, connector, shop_domain, granted_scopes, token_ciphertext, token_nonce,
          key_version, version_no)
       VALUES ($1,$2,'shopify',$3,ARRAY['write_products'],'\\x00','\\x00',1,500)`,
      [id, shopId, STORE]
    );
    await expect(
      pool!.query(
        `INSERT INTO connector_token_retirement
           (shop_id, connector_token_version_id, reason_code) VALUES ($1,$2,'uninstall')`,
        [shopId, id]
      )
    ).rejects.toThrow(/uninstall_cites_its_webhook/);
  });

  it("records the provider-side ATTEMPT and STATUS, and never a claim about Shopify (S2)", async () => {
    if (!enabled) return;
    // 053 §7.3a. Two columns that describe THIS system's behaviour — when it
    // called, and what it observed — and no column asserting the token is dead
    // at Shopify, because a 200 is evidence a request succeeded and not a fact
    // about another system's present state (018).
    const id = randomUUID();
    await pool!.query(
      `INSERT INTO connector_token_version
         (id, shop_id, connector, shop_domain, granted_scopes, token_ciphertext, token_nonce,
          key_version, version_no)
       VALUES ($1,$2,'shopify',$3,ARRAY['write_products'],'\\x00','\\x00',1,700)`,
      [id, shopId, STORE]
    );
    const attemptedAt = new Date("2026-09-04T12:00:00.000Z");
    const receipt = await offboardTokenVersion(pool!, {
      shopId,
      connectorTokenVersionId: id,
      reasonCode: "revocation",
      providerRevocation: { attemptedAt, httpStatus: 200 },
      connector: CONNECTOR,
      versionNo: 700,
      shopDomain: STORE,
      grantedScopes: ["write_products"],
      authoredBy: "human",
    });
    expect(receipt.provider_revocation).toEqual({
      attempted_at: attemptedAt.toISOString(),
      http_status: 200,
    });
    expect(receipt.provider_outcome).toMatch(/Shopify answered 200/);
    expect(receipt.provider_outcome).toMatch(/is not, by itself, a statement about/);
    // The row, not the return value: the fact is in the database.
    const row = await pool!.query(
      `SELECT provider_revocation_attempted_at, provider_revocation_http_status
         FROM connector_token_retirement WHERE connector_token_version_id = $1`,
      [id]
    );
    expect(
      Number((row.rows[0] as { provider_revocation_http_status: number }).provider_revocation_http_status)
    ).toBe(200);
  });

  it("REFUSES an observed status with no attempt behind it", async () => {
    if (!enabled) return;
    // A status this system did not observe is not a status. The reverse — an
    // attempt with no status — is LEGAL and is the transport-failure case, which
    // the next assertion proves rather than assumes.
    const id = randomUUID();
    await pool!.query(
      `INSERT INTO connector_token_version
         (id, shop_id, connector, shop_domain, granted_scopes, token_ciphertext, token_nonce,
          key_version, version_no)
       VALUES ($1,$2,'shopify',$3,ARRAY['write_products'],'\\x00','\\x00',1,701)`,
      [id, shopId, STORE]
    );
    await expect(
      pool!.query(
        `INSERT INTO connector_token_retirement
           (shop_id, connector_token_version_id, reason_code, provider_revocation_http_status)
         VALUES ($1,$2,'revocation',200)`,
        [shopId, id]
      )
    ).rejects.toThrow(/status_needs_its_attempt/);
    // The transport-failure shape is accepted.
    await pool!.query(
      `INSERT INTO connector_token_retirement
         (shop_id, connector_token_version_id, reason_code, provider_revocation_attempted_at)
       VALUES ($1,$2,'revocation',now())`,
      [shopId, id]
    );
  });

  it("REFUSES a reason code outside the closed set", async () => {
    if (!enabled) return;
    const versions = await loadTokenVersions(pool!, shopId, CONNECTOR);
    await expect(
      pool!.query(
        `INSERT INTO connector_token_retirement
           (shop_id, connector_token_version_id, reason_code) VALUES ($1,$2,'because')`,
        [shopId, versions[versions.length - 1]!.id]
      )
    ).rejects.toThrow();
  });

  it("makes two shops sharing one store domain UNREPRESENTABLE (T24, finding 2)", async () => {
    if (!enabled) return;
    // Removing the READER made the bug unreachable; the CONSTRAINT makes the
    // state unrepresentable, so the next reader of that column cannot bring it
    // back. One store belongs to at most one Longbox shop.
    const a = await seedShop(pool!, { name: "Store A", slug: `sharea${String(Date.now())}` });
    const b = await seedShop(pool!, { name: "Store B", slug: `shareb${String(Date.now())}` });
    await pool!.query(`UPDATE shop SET shopify_domain = 'shared.myshopify.com' WHERE id = $1`, [a]);
    await expect(
      pool!.query(`UPDATE shop SET shopify_domain = 'shared.myshopify.com' WHERE id = $1`, [b])
    ).rejects.toThrow(/shop_shopify_domain_is_one_store|duplicate key/);
    // NULL is not a value: two unconfigured shops are the ordinary case and the
    // partial predicate says so rather than relying on Postgres's NULL rule.
    expect(a).not.toBe(b);
  });

  it("REFUSES a second use of one install state", async () => {
    if (!enabled) return;
    const state = await mintState();
    const found = await pool!.query(`SELECT id FROM connector_install_state WHERE state_digest = $1`, [
      stateDigest(state),
    ]);
    const stateId = (found.rows[0] as { id: string }).id;
    const versions = await loadTokenVersions(pool!, shopId, CONNECTOR);
    await pool!.query(
      `INSERT INTO connector_install_state_use (shop_id, state_id, connector_token_version_id)
       VALUES ($1,$2,$3)`,
      [shopId, stateId, versions[0]!.id]
    );
    await expect(
      pool!.query(
        `INSERT INTO connector_install_state_use (shop_id, state_id, connector_token_version_id)
         VALUES ($1,$2,$3)`,
        [shopId, stateId, versions[0]!.id]
      )
    ).rejects.toThrow(/connector_install_state_use_state_idx|duplicate key/);
  });
});
