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
import { serviceDb, withTransaction } from "../../src/db.js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import {
  CONNECTOR,
  ConnectorCallbackError,
  ConnectorTokenRefusedError,
  WebhookRefusedError,
  completeInstall,
  loadTokenVersions,
  mintInstallState,
  nextTokenVersionNo,
  offboardTokenVersion,
  openTokenValue,
  receiveWebhook,
  requireConnectorKey,
  resolveTokenVersion,
  stateDigest,
  type ConnectorDeps,
  type ShopifyAppCredentials,
} from "../../src/services/connectors/shopify/index.js";
// ⚠ THE DEEP PATH, DELIBERATELY. `introduceTokenVersion` is no longer on the
// public barrel (E03-D22, the security lens's F1): it writes a token version and
// consults no claim, so a caller reaching it past `completeInstall` can put two
// shops on one store with no race at all. The barrier is against a casual caller
// in `src/`; a test that is deliberately building the no-install shape says so by
// naming the module it reaches into.
import { introduceTokenVersion } from "../../src/services/connectors/shopify/custody.js";
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

/**
 * The reads that are about the SUBSYSTEM rather than about one shop.
 *
 * A webhook receipt may carry a NULL `shop_id` by design (053 §5.5) and an
 * install state is found by `state_digest` before any tenant is known, so the
 * production code resolves both in the `connector-inbound` service scope
 * (`src/db/tenantContext.ts`). A test that counts the whole subsystem is asking
 * the same cross-tenant question and says so, rather than reading zero and
 * calling it "nothing was written".
 */
const inboundQuery = (sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> =>
  serviceDb(pool!, "connector-inbound").query(sql, values);

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
  shopId = await seedShop(ownerPool, { name: "Gotham Connector", slug: "gothamconnector" });
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
  // The install is minted by the OWNER of the shop it is for, so the write names
  // that shop (E03-B04). In production this call is `pnpm connector-install`,
  // which runs as the schema owner; here it runs as the app role, which is
  // subject to the policy — so the fixture has to name its tenant like a route
  // would.
  const minted = await mintInstallState(asShop(pool!, shopId), {
    shopId,
    shopDomain: STORE,
    app: APP,
  });
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
    const res = await inboundQuery(`SELECT count(*)::int AS n FROM ${table}`);
    out[table] = (res.rows[0] as { n: number }).n;
  }
  return out;
}

describe("the connector lifecycle end to end (053 §7)", () => {
  it("mints a state whose VALUE is in no column", async () => {
    if (!enabled) return;
    const state = await mintState();
    const row = await shopQuery(
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
    const whole = await shopQuery(
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

    const outcome = await resolveTokenVersion(asShop(pool!, shopId), shopId, CONNECTOR);
    expect(outcome.outcome).toBe("live");

    // THE COLUMN, searched for the plaintext. This is the assertion 053 §3's
    // whole custody ruling rests on: the value exists inside one function's
    // scope and as ciphertext, and nowhere else.
    const row = await shopQuery(
      `SELECT to_jsonb(v) AS row FROM connector_token_version v WHERE v.shop_id = $1`,
      [shopId]
    );
    expect(JSON.stringify((row.rows[0] as { row: unknown }).row)).not.toContain(ACCESS_TOKEN);

    // …and it really is the token, opened through the real envelope, bound to
    // the row's own id as AAD.
    const versionId = outcome.outcome === "live" ? outcome.chosen.id : "";
    expect(await openTokenValue(asShop(pool!, shopId), deps.keyring!, shopId, versionId)).toBe(ACCESS_TOKEN);

    // E03-D22: the same transaction CLAIMED the store on the shop's own row.
    // Until this bead the column had no writer at all, which is exactly why 056
    // §6.3 could call its oracle latent — and why the one-shop rule had nothing
    // serialising it (§11 R10).
    const claim = await shopQuery(`SELECT shopify_domain FROM shop WHERE id = $1`, [shopId]);
    expect((claim.rows[0] as { shopify_domain: string | null }).shopify_domain).toBe(STORE);
  });

  it("REFUSES a ciphertext moved to another row — the AAD binding, not a WHERE clause", async () => {
    if (!enabled) return;
    // 019 T24's cross-tenant line enforced by cryptography. A row lifted from
    // one install into another must FAIL TO AUTHENTICATE rather than decrypt to
    // a working token.
    const outcome = await resolveTokenVersion(asShop(pool!, shopId), shopId, CONNECTOR);
    const source = outcome.outcome === "live" ? outcome.chosen.id : "";
    const bytes = await shopQuery(
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
    await shopQuery(
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
    await expect(openTokenValue(asShop(pool!, shopId), deps.keyring!, shopId, otherId)).rejects.toThrow(
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
    const other = await seedShop(ownerPool!, { name: "Other Shop", slug: `otherconn${String(Date.now())}` });
    const outcome = await resolveTokenVersion(asShop(pool!, shopId), shopId, CONNECTOR);
    const versionId = outcome.outcome === "live" ? outcome.chosen.id : "";
    // The row is live and openable for ITS shop…
    expect(await openTokenValue(asShop(pool!, shopId), deps.keyring!, shopId, versionId)).toBe(ACCESS_TOKEN);
    // …and a zero-row read for any other, answered exactly as an absent version
    // (048 §9.3: a caller who could tell the two apart holds an enumeration
    // oracle over ids).
    await expect(openTokenValue(asShop(pool!, other), deps.keyring!, other, versionId)).rejects.toThrow(
      /no connector token version/
    );
  });

  it("REFUSES a REPLAYED callback by UNIQUE (state_id), writing no second token", async () => {
    if (!enabled) return;
    const state = await mintState();
    const query = signQuery({ shop: STORE, code: "authcode-2", state, timestamp: "1757000001" });
    await completeInstall(deps, query, fakeExchange);
    const after = await counts();

    // ⚠ **THIS COMMENT USED TO SAY THE REPLAY "dies on the constraint", AND IT
    // DOES NOT** (found while folding the E03-D22 security lens's F8). A
    // SEQUENTIAL replay is caught one step earlier, by the `LEFT JOIN
    // connector_install_state_use` in the state read: `row.spent` is true, so
    // the refusal is `state_replayed` and the transaction is never opened. The
    // CONSTRAINT is only reached when two callbacks race past that read, which
    // is the case below — and that is precisely why nothing had ever caught its
    // `23505`, and why it was answering 500 until this bead mapped it.
    //
    // The assertion is tightened with the comment: `.rejects.toThrow()` accepted
    // any error at all, including the 500 that used to be possible here.
    await expect(completeInstall(deps, query, fakeExchange)).rejects.toBeInstanceOf(ConnectorCallbackError);
    await expect(completeInstall(deps, query, fakeExchange)).rejects.toMatchObject({
      refusal: "state_replayed",
    });
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
    const row = await inboundQuery(
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
    const live = await resolveTokenVersion(asShop(pool!, shopId), shopId, CONNECTOR);
    expect(live.outcome).toBe("live");
  });

  it("an UNINSTALL retires EVERY live token, writes the receipt, and the client then refuses", async () => {
    if (!enabled) return;
    // The full ending, in one test, because the three halves are one property:
    // the fact, the receipt, and the refusal that makes both true.
    const beforeVersions = await loadTokenVersions(asShop(pool!, shopId), shopId, CONNECTOR);
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
    const after = await resolveTokenVersion(asShop(pool!, shopId), shopId, CONNECTOR);
    expect(after.outcome).toBe("all_retired");

    // 050 §5(a)'s inversion, one connector over: the software stops being able
    // to use the credential while the ciphertext is STILL IN THE ROW.
    const versionId = beforeVersions[0]!.id;
    const stillThere = await shopQuery(
      `SELECT octet_length(token_ciphertext) AS n FROM connector_token_version WHERE id = $1`,
      [versionId]
    );
    expect(Number((stillThere.rows[0] as { n: number }).n)).toBeGreaterThan(0);
    await expect(openTokenValue(asShop(pool!, shopId), deps.keyring!, shopId, versionId)).rejects.toThrow(
      ConnectorTokenRefusedError
    );
    await expect(openTokenValue(asShop(pool!, shopId), deps.keyring!, shopId, versionId)).rejects.toThrow(
      /is retired/
    );
  });

  it("resolves the uninstall's tenant WITHOUT shop.shopify_domain — the finding-1 regression", async () => {
    if (!enabled) return;
    // ⚠ **THIS TEST CHANGED SHAPE AT E03-D22 AND IT STILL GUARDS THE SAME
    // FINDING.** It used to assert the column was NULL, because nothing wrote
    // it. Something writes it now — the install CLAIMS the store (056 §11 R10) —
    // so asserting NULL would assert the absence of this bead rather than the
    // presence of finding 1's fix.
    //
    // What finding 1 is actually about is INDEPENDENCE: the uninstall must
    // resolve its tenant from the value an authenticated grant wrote
    // (`connector_token_version.shop_domain`) and never from a config column.
    // So the assertion is the independence, proved on a shop where the two
    // disagree — see the `resolves an uninstall for a shop whose claim is
    // ABSENT` case below, which introduces a token version with no install at
    // all (053 §5.3's Dev Dashboard shape) and leaves the column NULL.
    const row = await shopQuery(`SELECT shopify_domain FROM shop WHERE id = $1`, [shopId]);
    expect((row.rows[0] as { shopify_domain: string | null }).shopify_domain).toBe(STORE);
    // …and the receipt still names the shop, because the resolution came from
    // the grant's own row rather than from a config field.
    const receipt = await inboundQuery(
      `SELECT shop_id FROM connector_webhook_receipt WHERE webhook_id = 'wh-uninstall-1'`
    );
    expect((receipt.rows[0] as { shop_id: string | null }).shop_id).toBe(shopId);
  });

  it("resolves an uninstall for a shop whose claim is ABSENT — the independence finding 1 named", async () => {
    if (!enabled) return;
    // The 053 §5.3 shape: a token version with NO install state, which is what
    // the pilot's per-store Dev Dashboard token produces. No install ran, so
    // nothing claimed the store, so `shop.shopify_domain` is NULL — and the
    // uninstall must still find the tenant and retire the token. This is the
    // condition the old implementation needed to be absent, kept as a case
    // rather than as a fixture.
    const store = `devdash${String(Date.now())}.myshopify.com`;
    const shop = await seedShop(ownerPool!, { name: "Dev Dash", slug: `devdash${String(Date.now())}` });
    const tenant = asShop(pool!, shop);
    await introduceTokenVersion(tenant, deps.keyring!, {
      shopId: shop,
      connector: CONNECTOR,
      shopDomain: store,
      installStateId: null,
      grantedScopes: ["write_products", "read_products"],
      accessToken: ACCESS_TOKEN,
      versionNo: await nextTokenVersionNo(tenant, shop, CONNECTOR),
      authoredBy: "human",
    });
    const nullClaim = await tenant.query(`SELECT shopify_domain FROM shop WHERE id = $1`, [shop]);
    expect((nullClaim.rows[0] as { shopify_domain: string | null }).shopify_domain).toBeNull();

    const body = Buffer.from(JSON.stringify({ shop_domain: store }));
    const outcome = await receiveWebhook(
      deps,
      {
        topic: "app/uninstalled",
        hmac: sign(body),
        shopDomain: store,
        webhookId: `wh-devdash-${String(Date.now())}`,
        apiVersion: "2025-07",
      },
      body
    );
    expect(outcome.retired).toHaveLength(1);
    expect(await resolveTokenVersion(asShop(pool!, shop), shop, CONNECTOR)).toMatchObject({
      outcome: "all_retired",
    });
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
      await expect(shopQuery(`UPDATE ${table} SET created_at = now()`)).rejects.toThrow();
      await expect(shopQuery(`DELETE FROM ${table}`)).rejects.toThrow();
    }
  });

  it("REFUSES a second retirement of one token version", async () => {
    if (!enabled) return;
    const versions = await loadTokenVersions(asShop(pool!, shopId), shopId, CONNECTOR);
    const target = versions[0]!;
    // `UNIQUE (connector_token_version_id)`: at most one ending per token,
    // because a replacement is a NEW version rather than a second ending.
    await expect(
      shopQuery(
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
    await shopQuery(
      `INSERT INTO connector_token_version
         (id, shop_id, connector, shop_domain, granted_scopes, token_ciphertext, token_nonce,
          key_version, version_no)
       VALUES ($1,$2,'shopify',$3,ARRAY['write_products'],'\\x00','\\x00',1,500)`,
      [id, shopId, STORE]
    );
    await expect(
      shopQuery(
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
    await shopQuery(
      `INSERT INTO connector_token_version
         (id, shop_id, connector, shop_domain, granted_scopes, token_ciphertext, token_nonce,
          key_version, version_no)
       VALUES ($1,$2,'shopify',$3,ARRAY['write_products'],'\\x00','\\x00',1,700)`,
      [id, shopId, STORE]
    );
    const attemptedAt = new Date("2026-09-04T12:00:00.000Z");
    const receipt = await offboardTokenVersion(asShop(pool!, shopId), {
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
    const row = await shopQuery(
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
    await shopQuery(
      `INSERT INTO connector_token_version
         (id, shop_id, connector, shop_domain, granted_scopes, token_ciphertext, token_nonce,
          key_version, version_no)
       VALUES ($1,$2,'shopify',$3,ARRAY['write_products'],'\\x00','\\x00',1,701)`,
      [id, shopId, STORE]
    );
    await expect(
      shopQuery(
        `INSERT INTO connector_token_retirement
           (shop_id, connector_token_version_id, reason_code, provider_revocation_http_status)
         VALUES ($1,$2,'revocation',200)`,
        [shopId, id]
      )
    ).rejects.toThrow(/status_needs_its_attempt/);
    // The transport-failure shape is accepted.
    await shopQuery(
      `INSERT INTO connector_token_retirement
         (shop_id, connector_token_version_id, reason_code, provider_revocation_attempted_at)
       VALUES ($1,$2,'revocation',now())`,
      [shopId, id]
    );
  });

  it("REFUSES a reason code outside the closed set", async () => {
    if (!enabled) return;
    const versions = await loadTokenVersions(asShop(pool!, shopId), shopId, CONNECTOR);
    await expect(
      shopQuery(
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
    const a = await seedShop(ownerPool!, { name: "Store A", slug: `sharea${String(Date.now())}` });
    const b = await seedShop(ownerPool!, { name: "Store B", slug: `shareb${String(Date.now())}` });
    // EACH UPDATE RUNS IN ITS OWN SHOP'S CONTEXT (E03-B04). `shop` is policied on
    // its own `id`, and an UPDATE that matches no row SUCCEEDS — so under this
    // suite's default context neither statement would touch anything and the
    // second one would not reach the constraint this test is about (056 §6.2).
    await asShop(pool!, a).query(`UPDATE shop SET shopify_domain = 'shared.myshopify.com' WHERE id = $1`, [
      a,
    ]);
    await expect(
      asShop(pool!, b).query(`UPDATE shop SET shopify_domain = 'shared.myshopify.com' WHERE id = $1`, [b])
    ).rejects.toThrow(/shop_shopify_domain_is_one_store|duplicate key/);
    // NULL is not a value: two unconfigured shops are the ordinary case and the
    // partial predicate says so rather than relying on Postgres's NULL rule.
    expect(a).not.toBe(b);
  });

  it("REFUSES an install for a store ANOTHER shop already holds a live token for (F8)", async () => {
    if (!enabled) return;
    // The security lens's F8, and the gap it names is precise: `026` already makes
    // `shop.shopify_domain` unique (the test above), but that column is the LEGACY
    // static path's config — the AUTHORITY lives in `connector_token_version`,
    // whose `shop_domain` carried no constraint across tenants at all. A second
    // shop could install the same store, and then an `app/uninstalled` for it —
    // which retires EVERY live token granted for that store (053 §7.3) — would end
    // the FIRST shop's authority as a side effect of the second's install.
    //
    // A unique index cannot express it: a rotation legitimately leaves two live
    // versions for one shop (050 §2 Q2), so the rule is "at most one SHOP", not
    // "at most one row". It is refused where the authority is created.
    const other = await seedShop(ownerPool!, { name: "Rival", slug: `rival${String(Date.now())}` });
    const minted = await mintInstallState(asShop(pool!, other), {
      shopId: other,
      shopDomain: STORE,
      app: APP,
    });
    const state = new URL(minted.authorizeUrl).searchParams.get("state")!;
    const query = signQuery({ shop: STORE, code: "authcode-f8", state, timestamp: "1757000009" });
    await expect(completeInstall(deps, query, fakeExchange)).rejects.toThrow(/already holds a live/);
    // …and the first shop's token is untouched: the refusal happens before any
    // version is introduced.
    const live = await resolveTokenVersion(asShop(pool!, shopId), shopId, CONNECTOR);
    expect(live.outcome).toBe("live");
  });

  it("REFUSES a second use of one install state", async () => {
    if (!enabled) return;
    const state = await mintState();
    const found = await shopQuery(`SELECT id FROM connector_install_state WHERE state_digest = $1`, [
      stateDigest(state),
    ]);
    const stateId = (found.rows[0] as { id: string }).id;
    const versions = await loadTokenVersions(asShop(pool!, shopId), shopId, CONNECTOR);
    await shopQuery(
      `INSERT INTO connector_install_state_use (shop_id, state_id, connector_token_version_id)
       VALUES ($1,$2,$3)`,
      [shopId, stateId, versions[0]!.id]
    );
    await expect(
      shopQuery(
        `INSERT INTO connector_install_state_use (shop_id, state_id, connector_token_version_id)
         VALUES ($1,$2,$3)`,
        [shopId, stateId, versions[0]!.id]
      )
    ).rejects.toThrow(/connector_install_state_use_state_idx|duplicate key/);
  });
});

// ---------------------------------------------------------------------------
// E03-D22 — the store CLAIM, which is where the one-shop rule is guaranteed.
// 000-docs/061; 056 §11 R10 and §6.3; 053 §4, §7.
// ---------------------------------------------------------------------------
describe("the install CLAIMS the store, and the database settles the race (E03-D22)", () => {
  /** Mint a state for an arbitrary shop and store, and return the signed callback query. */
  async function callbackFor(shop: string, store: string, code: string): Promise<Record<string, string>> {
    const minted = await mintInstallState(asShop(pool!, shop), { shopId: shop, shopDomain: store, app: APP });
    const state = new URL(minted.authorizeUrl).searchParams.get("state")!;
    return signQuery({ shop: store, code, state, timestamp: "1757000100" });
  }

  /** A shop with a slug nothing else in this suite will collide with. */
  async function freshShop(tag: string): Promise<string> {
    return seedShop(ownerPool!, { name: `Claim ${tag}`, slug: `claim${tag}${String(Date.now())}` });
  }

  async function claimOf(shop: string): Promise<string | null> {
    const res = await asShop(pool!, shop).query(`SELECT shopify_domain FROM shop WHERE id = $1`, [shop]);
    return (res.rows[0] as { shopify_domain: string | null }).shopify_domain;
  }

  async function versionCount(shop: string): Promise<number> {
    const res = await asShop(pool!, shop).query(
      `SELECT count(*)::int AS n FROM connector_token_version WHERE shop_id = $1`,
      [shop]
    );
    return (res.rows[0] as { n: number }).n;
  }

  it("BLOCKS on an uncommitted claim and then refuses — the window R10 named, closed", async () => {
    if (!enabled) return;
    // ⚠ **THE DETERMINISTIC RACE, not a hopeful one.** 056 §11 R10 is a
    // time-of-check-to-time-of-use window: the F8 read runs outside the
    // transaction that introduces the token, so two installs of one store can
    // both pass it. A test that fired two callbacks and hoped they interleaved
    // would prove nothing on a fast machine, so this one HOLDS the first claim
    // open on its own connection and makes the second wait for it.
    //
    // The first shop holds NO live token — only the claim — so the F8 fast path
    // passes for the second shop and the refusal can only come from the index.
    const holderShop = await freshShop("hold");
    const racerShop = await freshShop("race");
    const store = `raced${String(Date.now())}.myshopify.com`;

    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The same rule as the racer below: this promise outlives several awaits, so
    // its failure is captured as a VALUE and re-raised where it can be read,
    // rather than left as a rejection nothing is listening to yet.
    const holder = withTransaction(
      pool!,
      async (tx) => {
        await tx.query(`UPDATE shop SET shopify_domain = $1 WHERE id = $2`, [store, holderShop]);
        await held;
      },
      { tenant: { shopId: holderShop }, label: "test-claim-holder" }
    ).then(
      () => undefined,
      (e: unknown) => e as Error
    );

    const query = await callbackFor(racerShop, store, "authcode-race");
    // ⚠ **THE HANDLER IS ATTACHED IN THE SAME EXPRESSION THAT STARTS THE CALL,
    // AND THAT IS NOT STYLE.** This promise is deliberately left pending across
    // two awaits — a timer and the holder's transaction — and Node reports an
    // UNHANDLED REJECTION for a promise that settles before anything is
    // listening. Keeping the rejection until a later `await expect(...).rejects`
    // passed on one machine and failed the CI lane on timing alone, which is the
    // worst kind of test: green where it was written, red where it is graded.
    // Turning the rejection into a VALUE here makes the outcome independent of
    // when it happens.
    const outcome = completeInstall(deps, query, fakeExchange).then(
      (): ConnectorCallbackError => {
        throw new Error("the racing install completed; the claim did not serialise it");
      },
      (e: unknown) => e as ConnectorCallbackError
    );
    // Long enough for the racer to reach its own UPDATE and block on the index.
    // If the claim were NOT taken, this install would have COMMITTED by now.
    await new Promise((r) => setTimeout(r, 300));
    expect(await versionCount(racerShop)).toBe(0);
    release!();
    const holderFailure = await holder;
    if (holderFailure) throw holderFailure;

    const raised = await outcome;
    expect(raised).toBeInstanceOf(ConnectorCallbackError);
    expect(raised.refusal).toBe("domain_claimed");
    // ⚠ THE REFUSAL NAMES NOBODY. It is the SAME member the F8 fast path
    // raises, so on the wire it is the same `CONNECTOR_CALLBACK_REFUSED` as an
    // unknown state (`src/routes/connectors.ts`, and the empty-details case in
    // `connector-http.test.ts`); and here, where the server does keep a
    // distinguishable message for its own log, that message carries neither the
    // holding shop's id nor anything else about it. A merchant learns that the
    // install did not complete; which Longbox shop holds their store — and
    // whether one does at all rather than the state being stale — is not in it.
    expect(raised.message).not.toContain(holderShop);
    expect(raised.message).not.toContain(racerShop);
    expect(JSON.stringify({ ...raised, message: raised.message })).not.toContain(holderShop);
    // The loser's transaction rolled back WHOLE: no claim, no token version,
    // and the state it presented is still unspent, so the merchant can be sent
    // back through (053 §5.2's H4).
    expect(await claimOf(racerShop)).toBeNull();
    expect(await versionCount(racerShop)).toBe(0);
    expect(await claimOf(holderShop)).toBe(store);
  });

  it("two concurrent callbacks for one store produce ONE winner", async () => {
    if (!enabled) return;
    // The same property without the barrier, which is what actually happens at a
    // counter: both callbacks pass the F8 fast path (neither shop holds a live
    // token yet) and exactly one may claim. **The interleaving is not pinned and
    // does not need to be** — whether the second blocks on an uncommitted index
    // entry or hits a committed one, the answer is the same refusal, which is
    // the point of moving the decision into the database.
    const a = await freshShop("cona");
    const b = await freshShop("conb");
    const store = `concurrent${String(Date.now())}.myshopify.com`;
    const [qa, qb] = await Promise.all([
      callbackFor(a, store, "authcode-con-a"),
      callbackFor(b, store, "authcode-con-b"),
    ]);

    const settled = await Promise.allSettled([
      completeInstall(deps, qa, fakeExchange),
      completeInstall(deps, qb, fakeExchange),
    ]);
    const won = settled.filter((s) => s.status === "fulfilled");
    const lost = settled.filter((s) => s.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConnectorCallbackError);
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ refusal: "domain_claimed" });

    // Exactly one shop holds the store, and exactly one holds a token for it.
    const claims = [await claimOf(a), await claimOf(b)].filter((c) => c === store);
    expect(claims).toHaveLength(1);
    expect((await versionCount(a)) + (await versionCount(b))).toBe(1);
  });

  it("REFUSES a second shop after every token for that store is RETIRED — the claim is not released", async () => {
    if (!enabled) return;
    // ⚠ **THIS IS THE RULING, ASSERTED** (000-docs/061 §4). An uninstall retires
    // the tokens and does NOT release the claim, so the F8 fast path — which
    // asks about LIVE tokens — passes here and the index is the only thing left
    // refusing. That is deliberate: the column says which store this shop sells
    // into, and a third party's act at Shopify must not be able to un-configure
    // a Longbox shop and open its store to being claimed by another one.
    //
    // The cost is stated rather than hidden: moving a store to a DIFFERENT
    // Longbox shop is an owner decision that needs a schema-owner act today, and
    // offboarding (E15) is where that release belongs.
    const first = await freshShop("keep");
    const second = await freshShop("next");
    const store = `retired${String(Date.now())}.myshopify.com`;
    await completeInstall(deps, await callbackFor(first, store, "authcode-keep"), fakeExchange);
    expect(await claimOf(first)).toBe(store);

    // Retire every version the ordinary way — the signed uninstall.
    const body = Buffer.from(JSON.stringify({ shop_domain: store }));
    const hmac = createHmac("sha256", APP_SECRET).update(body).digest("base64");
    await receiveWebhook(
      deps,
      {
        topic: "app/uninstalled",
        hmac,
        shopDomain: store,
        webhookId: `wh-retired-${String(Date.now())}`,
        apiVersion: "2025-07",
      },
      body
    );
    expect(await resolveTokenVersion(asShop(pool!, first), first, CONNECTOR)).toMatchObject({
      outcome: "all_retired",
    });
    // The claim SURVIVED the uninstall.
    expect(await claimOf(first)).toBe(store);

    await expect(
      completeInstall(deps, await callbackFor(second, store, "authcode-next"), fakeExchange)
    ).rejects.toMatchObject({ refusal: "domain_claimed" });
    expect(await claimOf(second)).toBeNull();
    expect(await versionCount(second)).toBe(0);

    // …and the ORIGINAL shop may re-install it, which is the case that has to
    // keep working: a merchant who removed the app and put it back.
    await completeInstall(deps, await callbackFor(first, store, "authcode-keep-2"), fakeExchange);
    expect(await resolveTokenVersion(asShop(pool!, first), first, CONNECTOR)).toMatchObject({
      outcome: "live",
    });
    expect(await claimOf(first)).toBe(store);
  });

  it("allows the SAME shop to install the same store twice — a rotation is not a conflict", async () => {
    if (!enabled) return;
    // The claim is `UPDATE`, not `INSERT`, and it names the shop's own row — so
    // re-claiming a store this shop already holds writes the same value and
    // conflicts with nothing. 050 §2 Q2 permits two live versions during a
    // rotation, and a claim that refused the second would have broken it.
    const shop = await freshShop("rot");
    const store = `rotation${String(Date.now())}.myshopify.com`;
    await completeInstall(deps, await callbackFor(shop, store, "authcode-rot-1"), fakeExchange);
    await completeInstall(deps, await callbackFor(shop, store, "authcode-rot-2"), fakeExchange);
    expect(await versionCount(shop)).toBe(2);
    expect(await claimOf(shop)).toBe(store);
    const outcome = await resolveTokenVersion(asShop(pool!, shop), shop, CONNECTOR);
    expect(outcome.outcome).toBe("live");
    expect(outcome.outcome === "live" ? outcome.live.length : 0).toBe(2);
  });

  it("REFUSES AT MINT TIME, so the merchant never burns an authorization code (F6)", async () => {
    if (!enabled) return;
    // The security lens's F6. The claim is the guarantee; this is a courtesy one
    // act earlier. Without it an owner is sent to Shopify, approves a consent
    // screen, and the callback refuses AFTER the code has been exchanged — a
    // single-use code spent to learn something the CLI already knew.
    //
    // It runs on the SCHEMA OWNER's connection (`pnpm connector-install` uses
    // `resolveMigrateUrl`), for whom the index was never an oracle anyway (056
    // §6.3), which is exactly why it may live here and not in `completeInstall`.
    const holder = await freshShop("mintheld");
    const asker = await freshShop("mintask");
    const store = `minted${String(Date.now())}.myshopify.com`;
    await completeInstall(deps, await callbackFor(holder, store, "authcode-mint"), fakeExchange);

    await expect(
      mintInstallState(ownerPool!, { shopId: asker, shopDomain: store, app: APP })
    ).rejects.toMatchObject({ refusal: "domain_claimed" });
    // …and it wrote NO state row, so a refused mint costs the estate nothing.
    const states = await inboundQuery(
      `SELECT count(*)::int AS n FROM connector_install_state WHERE shop_id = $1`,
      [asker]
    );
    expect((states.rows[0] as { n: number }).n).toBe(0);

    // THE SHOP'S OWN STORE STILL MINTS — the refusal is `id <> $2`, not "this
    // domain is taken anywhere", and a re-install by the holder must keep working.
    const again = await mintInstallState(ownerPool!, { shopId: holder, shopDomain: store, app: APP });
    expect(again.stateId).toBeTruthy();
  });

  it("two callbacks racing ONE state reach the CONSTRAINT, and it is a refusal and not a 500 (F8)", async () => {
    if (!enabled) return;
    // ⚠ **THE PATH NO TEST HAD EVER REACHED, WHICH IS WHY IT WAS ANSWERING 500**
    // (the security lens's F8). 053 §5.2 calls `UNIQUE (state_id)` "the whole
    // mechanism", and it is raised INSIDE `completeInstall`'s transaction — but
    // a SEQUENTIAL replay never gets there, because the state read's `LEFT JOIN`
    // sets `spent` and refuses one step earlier. Only a RACE passes that read
    // twice, and until E03-D22 the resulting `23505` had no handler: a 500 with
    // a stack, on the route where every other refusal is one 4xx code.
    //
    // Both callbacks also claim the SAME store for the SAME shop, so the claim
    // is a no-op conflict-wise (its own row, same value) and the use row's UNIQUE
    // is what decides — which is the interleaving this case exists to produce.
    const shop = await freshShop("racestate");
    const store = `racedstate${String(Date.now())}.myshopify.com`;
    const minted = await mintInstallState(asShop(pool!, shop), {
      shopId: shop,
      shopDomain: store,
      app: APP,
    });
    const state = new URL(minted.authorizeUrl).searchParams.get("state")!;
    const query = signQuery({ shop: store, code: "authcode-racestate", state, timestamp: "1757000200" });

    const settled = await Promise.allSettled([
      completeInstall(deps, query, fakeExchange),
      completeInstall(deps, query, fakeExchange),
    ]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = settled.find((r) => r.status === "rejected") as PromiseRejectedResult;
    // A ConnectorCallbackError and not a raw pg error is exactly the difference
    // between one 4xx and a 500 — `src/routes/connectors.ts` maps the first and
    // lets the second become an unhandled error.
    expect(lost.reason).toBeInstanceOf(ConnectorCallbackError);
    expect(lost.reason).toMatchObject({ refusal: "state_replayed" });
    // ONE token version, because the loser's transaction rolled back whole.
    expect(await versionCount(shop)).toBe(1);
  });

  it("an uncommitted claim blocks neither a READ nor a scan_session INSERT at that shop (F9)", async () => {
    if (!enabled) return;
    // ⚠ **THE POSITIVE PROBE, recorded because a lock nobody measured is a
    // latency claim nobody can defend** (the security lens's F9). The claim takes
    // a row lock on `shop`, and every foreign key INTO `shop` takes `FOR KEY
    // SHARE` on that row — so the obvious worry is that an install in flight
    // stalls the counter. It does not: `UPDATE … SET shopify_domain` touches no
    // key column, so PostgreSQL takes `FOR NO KEY UPDATE`, which does not
    // conflict with `FOR KEY SHARE`.
    const shop = await freshShop("probe");
    const store = `probe${String(Date.now())}.myshopify.com`;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = withTransaction(
      pool!,
      async (tx) => {
        await tx.query(`UPDATE shop SET shopify_domain = $1 WHERE id = $2`, [store, shop]);
        await held;
      },
      { tenant: { shopId: shop }, label: "test-claim-probe" }
    ).then(
      () => undefined,
      (e: unknown) => e as Error
    );
    await new Promise((r) => setTimeout(r, 100));

    // A READ of that shop, while the claim is uncommitted.
    const read = await Promise.race([
      asShop(pool!, shop)
        .query(`SELECT id FROM shop WHERE id = $1`, [shop])
        .then(() => "read" as const),
      new Promise<"blocked">((r) => setTimeout(() => r("blocked"), 2_000)),
    ]);
    expect(read).toBe("read");

    // A CHILD INSERT at that shop, which takes FOR KEY SHARE on the same row.
    const inserted = await Promise.race([
      asShop(pool!, shop)
        .query(`INSERT INTO scan_session (shop_id) VALUES ($1) RETURNING id`, [shop])
        .then(() => "inserted" as const),
      new Promise<"blocked">((r) => setTimeout(() => r("blocked"), 2_000)),
    ]);
    expect(inserted).toBe("inserted");

    release!();
    const failure = await holder;
    if (failure) throw failure;
  });

  it("re-points a shop that MOVED store, and the fast path still refuses another shop's live store", async () => {
    if (!enabled) return;
    // Two properties in one case because they are the same statement's two
    // sides. (1) A shop whose column names store Y and whose owner completes a
    // grant at store X is re-pointed: the owner asked for X at mint time and the
    // callback proved X twice. Refusing would strand a shop on a store it no
    // longer sells into. (2) The F8 fast path is UNCHANGED and still fires first
    // — it is now an optimisation rather than the guarantee, and the assertion
    // pins that it still runs, because a refusal before the code is exchanged is
    // worth keeping.
    const mover = await freshShop("move");
    const rival = await freshShop("rival");
    const storeY = `movefrom${String(Date.now())}.myshopify.com`;
    const storeX = `moveto${String(Date.now())}.myshopify.com`;
    await completeInstall(deps, await callbackFor(mover, storeY, "authcode-move-1"), fakeExchange);
    expect(await claimOf(mover)).toBe(storeY);
    await completeInstall(deps, await callbackFor(mover, storeX, "authcode-move-2"), fakeExchange);
    expect(await claimOf(mover)).toBe(storeX);

    // The fast path: `mover` holds a LIVE token for storeX, so the rival is
    // refused by the F8 read BEFORE any exchange happens — its message is the
    // one that names a live token, and the wire code is the same either way.
    await expect(
      completeInstall(deps, await callbackFor(rival, storeX, "authcode-move-3"), fakeExchange)
    ).rejects.toThrow(/already holds a live/);
  });
});
