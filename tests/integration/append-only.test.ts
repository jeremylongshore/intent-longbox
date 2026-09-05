// L4: the Hickey model is enforced IN THE DATABASE (R1) — UPDATE and DELETE on
// event tables must be rejected by trigger, while the one permitted mutation
// (scan_session.status) still works.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createScanSession } from "../../src/services/scanSession.js";
import { createFreshDb, probeDb, runMigrations, seedShop, superuserUrl } from "./helpers.js";
import { APPEND_ONLY_TABLES } from "../../src/db/appendOnlyTables.js";
import { mintLcidString } from "../../src/catalog/index.js";

const dbUp = await probeDb();

/**
 * The key column an `UPDATE … WHERE <key> = $1` probe uses.
 *
 * Almost every append-only table has a surrogate `id`. Two do NOT, and both
 * absences are deliberate rather than oversights:
 *   * `lcid_registry`'s primary key IS the LCID (047 §4.2) — a surrogate id beside
 *     it would be a second name for a name;
 *   * `lcid_split_outcome` is a join child with the composite PK
 *     `(split_id, product_lcid)` (047 §7.1).
 * So the probe reads the key off this map instead of assuming `id`, which keeps
 * the loop derived from the DECLARED LIST rather than from the tables that happen
 * to be shaped like the others.
 */
const KEY_COLUMN: Record<string, string> = {
  lcid_registry: "lcid",
  lcid_split_outcome: "product_lcid",
  vertical_pack: "vertical",
};

const keyOf = (table: string): string => KEY_COLUMN[table] ?? "id";

interface CatalogSeed {
  vertical: string;
  code: string;
  packVersionId: string;
  corpusVersionId: string;
  dataSourceId: string;
}

describe.skipIf(!dbUp)("append-only triggers", () => {
  let pool: pg.Pool;
  let superuserPool: pg.Pool;
  let shopId: string;
  let sessionId: string;
  let catalog: CatalogSeed;
  /** The identity fixtures the 019/020 recipes hang off (048 §10.1). */
  let locationId: string;
  let deviceId: string;
  let credentialId: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_append_only_e02d05");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    superuserPool = new pg.Pool({ connectionString: superuserUrl(url) });
    shopId = await seedShop(pool);
    sessionId = (await createScanSession(pool, shopId)).id;

    // The identity substrate. `device.location_id` is NOT NULL (034 I7): a
    // device belongs to exactly one location, and an enrollment that cannot
    // name one fails rather than guessing — so the location comes first.
    const location = await pool.query(
      `INSERT INTO location (shop_id, kind, name) VALUES ($1,'store','Counter') RETURNING id`,
      [shopId]
    );
    locationId = (location.rows[0] as { id: string }).id;
    const device = await pool.query(
      `INSERT INTO device (shop_id, location_id, label, kind)
       VALUES ($1,$2,'counter phone','phone') RETURNING id`,
      [shopId, locationId]
    );
    deviceId = (device.rows[0] as { id: string }).id;
    const credential = await pool.query(
      `INSERT INTO device_credential (shop_id, device_id, token_hash) VALUES ($1,$2,$3) RETURNING id`,
      [shopId, deviceId, `sha256:${randomUUID()}`]
    );
    credentialId = (credential.rows[0] as { id: string }).id;

    // E04-D01: the catalog cluster's recipes all need a registered vertical, a
    // pack version, a corpus version and a rights row before they can insert
    // anything — every one of those is a NOT NULL FK, which is 030's "point at
    // the LCID, never at the row" and 019 T25 doing their jobs at the schema.
    const vertical = "comic";
    const code = "cmc";
    await pool.query(`INSERT INTO vertical_pack (vertical, vertical_code) VALUES ($1,$2)`, [vertical, code]);
    const pack = await pool.query(
      `INSERT INTO vertical_pack_version (vertical, pack_version, manifest, signature_fn_ref)
       VALUES ($1, 1, '{}', 'src/catalog/editionSignature.ts') RETURNING id`,
      [vertical]
    );
    const corpus = await pool.query(
      `INSERT INTO corpus_version (notes) VALUES ('catalog seed') RETURNING id`
    );
    const source = await pool.query(
      `INSERT INTO data_source (name, namespace_class) VALUES ('upc','registrar') RETURNING id`
    );
    // `vertical_pack_version` is one of the tables under test, and its recipe
    // inserts a second row for the same vertical — so the versions come from a
    // sequence rather than a literal, and the UNIQUE (vertical, pack_version)
    // stays a real constraint rather than something the test works around.
    await pool.query(`CREATE SEQUENCE IF NOT EXISTS append_only_pack_version_seq START 2`);
    catalog = {
      vertical,
      code,
      packVersionId: (pack.rows[0] as { id: string }).id,
      corpusVersionId: (corpus.rows[0] as { id: string }).id,
      dataSourceId: (source.rows[0] as { id: string }).id,
    };
  });

  /**
   * A fresh `app_user` per recipe that needs one.
   *
   * `membership` has no uniqueness constraint that forces this, but reusing one
   * person across recipes would make the two `membership` cases interfere: the
   * revocation recipe's `UNIQUE (membership_id)` is per grant, and a shared
   * subject makes a reader wonder whether it is per person.
   */
  async function freshUser(): Promise<string> {
    const r = await pool.query(
      `INSERT INTO app_user (email, display_name) VALUES ($1,'Recipe Person') RETURNING id`,
      [`recipe-${randomUUID()}@example.invalid`]
    );
    return (r.rows[0] as { id: string }).id;
  }

  /**
   * A fresh authenticator row, for the retirement recipe (E03-D06).
   *
   * The sealed columns hold obviously-synthetic bytes rather than a real AEAD
   * envelope: this suite tests the TRIGGER, not the cryptography, and 048 I9's
   * fixture rule is that nothing here may carry anything a real secret could be
   * confused with. `id` is supplied because the column has no default — it is the
   * AAD, so the application mints it (`migrations/025`).
   */
  async function freshAuthenticator(): Promise<string> {
    const r = await pool.query(
      `INSERT INTO user_authenticator
         (id, app_user_id, kind, secret_ciphertext, secret_nonce, key_version)
       VALUES (gen_random_uuid(), $1, 'totp', '\\x00', '\\x00', 1) RETURNING id`,
      [await freshUser()]
    );
    return (r.rows[0] as { id: string }).id;
  }

  /** A fresh phone, for the recipes whose row hangs off one. */
  async function freshDevice(): Promise<string> {
    const r = await pool.query(
      `INSERT INTO device (shop_id, location_id, label, kind) VALUES ($1,$2,'recipe phone','phone')
       RETURNING id`,
      [shopId, locationId]
    );
    return (r.rows[0] as { id: string }).id;
  }

  /**
   * A fresh `version_no` per credential recipe (E03-B05).
   *
   * `UNIQUE (shop_id, kind, version_no)` is a real constraint and the two
   * credential recipes both insert an introduction for the same shop and kind —
   * so the counter keeps them from colliding without the test working around the
   * constraint it is here to leave intact.
   */
  let credentialVersionCounter = 0;

  /**
   * The connector recipes (E03-B06, `migrations/026`).
   *
   * Same rule as `freshAuthenticator` one helper up: the sealed columns hold
   * obviously-synthetic bytes rather than a real AEAD envelope, because this
   * suite tests the TRIGGER and not the cryptography — and 019 T31's fixture
   * rule is that nothing here may carry anything a real credential could be
   * confused with. `id` is supplied because the column has no default: it is the
   * AAD, so the application mints it.
   */
  let connectorVersionCounter = 0;
  let connectorWebhookCounter = 0;

  async function freshInstallState(): Promise<{ id: string }> {
    const r = await pool.query(
      `INSERT INTO connector_install_state
         (shop_id, connector, shop_domain, state_digest, requested_scopes, expires_at)
       VALUES ($1,'shopify','recipe.myshopify.com',$2,ARRAY['write_products'],now() + interval '15 minutes')
       RETURNING id`,
      [shopId, randomUUID().replace(/-/g, "").repeat(2)]
    );
    return { id: (r.rows[0] as { id: string }).id };
  }

  async function freshTokenVersion(): Promise<{ id: string }> {
    connectorVersionCounter += 1;
    const r = await pool.query(
      `INSERT INTO connector_token_version
         (id, shop_id, connector, shop_domain, granted_scopes, token_ciphertext, token_nonce,
          key_version, version_no)
       VALUES (gen_random_uuid(), $1, 'shopify', 'recipe.myshopify.com', ARRAY['write_products'],
               '\\x00', '\\x00', 1, $2)
       RETURNING id`,
      [shopId, connectorVersionCounter]
    );
    return { id: (r.rows[0] as { id: string }).id };
  }

  async function freshWebhookReceipt(): Promise<{ id: string }> {
    connectorWebhookCounter += 1;
    const r = await pool.query(
      `INSERT INTO connector_webhook_receipt
         (shop_id, connector, topic, webhook_id, shop_domain, payload_digest, payload_bytes)
       VALUES ($1,'shopify','shop/redact',$2,'recipe.myshopify.com',$3,0) RETURNING id`,
      [shopId, `recipe-${String(connectorWebhookCounter)}-${randomUUID()}`, "0".repeat(64)]
    );
    return { id: (r.rows[0] as { id: string }).id };
  }

  /** A fresh three-letter vertical code, for the `vertical_pack` recipe. */
  let verticalCodeCounter = 0;
  function freshVerticalCode(): string {
    verticalCodeCounter += 1;
    const n = verticalCodeCounter;
    const letters = "abcdefghijklmnopqrstuvwxyz";
    return letters[Math.floor(n / 676) % 26]! + letters[Math.floor(n / 26) % 26]! + letters[n % 26]!;
  }

  /** Mint one registry row and return the LCID. The INSERT *is* the mint (047 §4.1). */
  async function mintLcid(kind: "definition" | "edition"): Promise<string> {
    const lcid = mintLcidString(kind, catalog.code);
    await pool.query(
      `INSERT INTO lcid_registry (lcid, kind, vertical_code, minted_in_corpus_version_id, minted_by)
       VALUES ($1,$2,$3,$4,'human_review')`,
      [lcid, kind, catalog.code, catalog.corpusVersionId]
    );
    return lcid;
  }

  const mintEditionLcid = (): Promise<string> => mintLcid("edition");

  afterAll(async () => {
    await superuserPool?.end();
    await pool?.end();
  });

  async function insertRow(table: string): Promise<string> {
    switch (table) {
      case "scan_photo": {
        const r = await pool.query(
          `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url) VALUES ($1,$2,'cover','x.jpg') RETURNING id`,
          [sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "candidate_set": {
        const r = await pool.query(
          `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates) VALUES ($1,$2,'barcode','[]') RETURNING id`,
          [sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "human_confirmation": {
        const r = await pool.query(
          `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source) VALUES ($1,$2,'{}','one_tap') RETURNING id`,
          [sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "condition_assessment": {
        const r = await pool.query(
          `INSERT INTO condition_assessment (scan_session_id, shop_id, grade_range_low, grade_range_high) VALUES ($1,$2,'FN','VF') RETURNING id`,
          [sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "pricing_snapshot": {
        const r = await pool.query(
          `INSERT INTO pricing_snapshot (scan_session_id, shop_id, query, suggested_cents) VALUES ($1,$2,'q',100) RETURNING id`,
          [sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "shopify_draft": {
        const r = await pool.query(
          `INSERT INTO shopify_draft (scan_session_id, shop_id, status) VALUES ($1,$2,'draft') RETURNING id`,
          [sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "cost_log": {
        // E03-B05: `spend_owner` is NOT NULL for every row written after `023`
        // (050 §6.1), enforced by a `NOT VALID` CHECK so that rows predating
        // attribution are left alone rather than backfilled with an invented
        // owner. A fixture INSERT has to name one like any other writer.
        const r = await pool.query(
          `INSERT INTO cost_log (shop_id, scan_session_id, provider, model, spend_owner)
           VALUES ($1,$2,'anthropic','claude-sonnet-5','longbox') RETURNING id`,
          [shopId, sessionId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      // E03-B05 (050 §4): rotation is two append-only facts.
      case "shop_credential_version": {
        const r = await pool.query(
          `INSERT INTO shop_credential_version (shop_id, kind, key_ref, version_no)
           VALUES ($1,'anthropic',$2,$3) RETURNING id`,
          [shopId, "LONGBOX_APPENDONLY_ANTHROPIC_KEY", ++credentialVersionCounter]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "shop_credential_retirement": {
        const version = await pool.query(
          `INSERT INTO shop_credential_version (shop_id, kind, key_ref, version_no)
           VALUES ($1,'anthropic',$2,$3) RETURNING id`,
          [shopId, "LONGBOX_APPENDONLY_ANTHROPIC_KEY", ++credentialVersionCounter]
        );
        const r = await pool.query(
          `INSERT INTO shop_credential_retirement (shop_id, credential_version_id, reason_code)
           VALUES ($1,$2,'rotation') RETURNING id`,
          [shopId, (version.rows[0] as { id: string }).id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      // 003 (E02-D01): the 022 P7 lifecycle tables are event tables too.
      case "media_deletion": {
        // The tombstone names the SAME storage key as the photo it deletes —
        // a deletion pointing at some other key would tombstone nothing.
        const key = `key/${randomUUID()}`;
        const photo = await pool.query(
          `INSERT INTO scan_photo (scan_session_id, shop_id, kind, storage_url, storage_key, content_hash)
           VALUES ($1,$2,'cover','x.jpg',$3,'sha256:deadbeef') RETURNING id`,
          [sessionId, shopId, key]
        );
        const photoRow = photo.rows[0] as { id: string };
        const r = await pool.query(
          `INSERT INTO media_deletion (shop_id, scan_photo_id, storage_key, reason_code)
           VALUES ($1,$2,$3,'retention_sweep') RETURNING id`,
          [shopId, photoRow.id, key]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "retention_policy": {
        const r = await pool.query(
          `INSERT INTO retention_policy (shop_id, artifact_class, anchor, window_days, ceiling_days)
           VALUES ($1,'originals','draft_created',30,90) RETURNING id`,
          [shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "retention_hold": {
        const r = await pool.query(
          `INSERT INTO retention_hold (shop_id, target_table, target_id, reason, review_date)
           VALUES ($1,'scan_session',$2,'open return','2027-01-01') RETURNING id`,
          [shopId, sessionId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "retention_hold_release": {
        const hold = await pool.query(
          `INSERT INTO retention_hold (shop_id, target_table, target_id, reason, review_date)
           VALUES ($1,'scan_session',$2,'dispute closed','2027-01-01') RETURNING id`,
          [shopId, sessionId]
        );
        const r = await pool.query(
          `INSERT INTO retention_hold_release (hold_id, released_by) VALUES ($1,'tester') RETURNING id`,
          [(hold.rows[0] as { id: string }).id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      // E02-D05: 041 §1 E11 found this recipe set short of the declared trigger
      // list by exactly these three. A behavioural test that skips a table is a
      // table whose immutability nothing exercises, so they are covered now and
      // `eventTables` is derived from the declared list rather than hand-kept.
      case "corpus_version": {
        const r = await pool.query(
          `INSERT INTO corpus_version (source_set, notes) VALUES ('{}','test') RETURNING id`
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "llm_rerank": {
        const cs = await pool.query(
          `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates) VALUES ($1,$2,'barcode','[]') RETURNING id`,
          [sessionId, shopId]
        );
        const r = await pool.query(
          `INSERT INTO llm_rerank (candidate_set_id, scan_session_id, shop_id, provider, model, prompt_hash, response, confidence, band)
           VALUES ($1,$2,$3,'anthropic','claude-sonnet-5','sha256:abc','{}',0.9,'high') RETURNING id`,
          [(cs.rows[0] as { id: string }).id, sessionId, shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "listing_status_observation": {
        const draft = await pool.query(
          `INSERT INTO shopify_draft (scan_session_id, shop_id, status) VALUES ($1,$2,'draft') RETURNING id`,
          [sessionId, shopId]
        );
        const r = await pool.query(
          `INSERT INTO listing_status_observation (shop_id, shopify_draft_id, observed_status, source)
           VALUES ($1,$2,'draft','watcher') RETURNING id`,
          [shopId, (draft.rows[0] as { id: string }).id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      // E02-B10: 040 §3.3's transition table. The declared list is what forced this
      // recipe to be written in the same PR as the migration — which is the guard
      // 041 §1 E11 asked for, working for the first time on a NEW table rather than
      // catching three that had slipped through.
      case "scan_session_transition": {
        const r = await pool.query(
          // `session_seq` is NOT NULL on this table (041 §5.3: strict on tables
          // created after the record), so the recipe supplies it the way the real
          // writer will — max+1 for the session. Safe inline here because these
          // inserts are sequential; the concurrent case is proved in
          // observation-envelope.test.ts under the anchor lock.
          `INSERT INTO scan_session_transition
             (shop_id, scan_session_id, kind, observed_state, reason, actor_role, session_seq)
           VALUES ($1,$2,'parked','confirmed','second look','operator',
                   (SELECT coalesce(max(session_seq),0)+1 FROM scan_session_transition
                     WHERE scan_session_id = $2))
           RETURNING id`,
          [shopId, sessionId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "outbox": {
        // The one command-shaped event self-references (043 §3.4), so the id is
        // minted here rather than by the column default — an append-only table
        // has no UPDATE with which to point a row at itself after the fact.
        const id = randomUUID();
        const r = await pool.query(
          `INSERT INTO outbox
             (id, shop_id, scan_session_id, session_seq, event, ref_table, ref_id, authored_by)
           VALUES ($1,$2,$3,
                   (SELECT coalesce(max(session_seq),0)+1 FROM outbox WHERE scan_session_id = $3),
                   'longbox.commerce.draft_requested','outbox',$1,'human') RETURNING id`,
          [id, shopId, sessionId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "outbox_attempt": {
        const id = randomUUID();
        await pool.query(
          `INSERT INTO outbox
             (id, shop_id, scan_session_id, session_seq, event, ref_table, ref_id, authored_by)
           VALUES ($1,$2,$3,
                   (SELECT coalesce(max(session_seq),0)+1 FROM outbox WHERE scan_session_id = $3),
                   'longbox.commerce.draft_requested','outbox',$1,'human')`,
          [id, shopId, sessionId]
        );
        const r = await pool.query(
          `INSERT INTO outbox_attempt (shop_id, outbox_id, attempt_no, kind, authored_by)
           VALUES ($1,$2,1,'started','system') RETURNING id`,
          [shopId, id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      // 014 / 015 (E04-D01): the catalog cluster. 030 §7's tables and 047's LCID
      // namespace, lifecycle facts and crosswalk. Every one of them is a FACT
      // about the shared catalog, so every one is immutable — and the recipes had
      // to be written in the same PR as the migration, which is the declared
      // list doing its job for the second time on new tables.
      case "vertical_pack": {
        const code = freshVerticalCode();
        const r = await pool.query(
          `INSERT INTO vertical_pack (vertical, vertical_code) VALUES ($1,$2) RETURNING vertical`,
          [`vertical-${code}`, code]
        );
        return (r.rows[0] as { vertical: string }).vertical;
      }
      case "vertical_pack_version": {
        const r = await pool.query(
          `INSERT INTO vertical_pack_version (vertical, pack_version, manifest, signature_fn_ref)
           VALUES ($1, nextval('append_only_pack_version_seq'), '{}', 'src/catalog/editionSignature.ts')
           RETURNING id`,
          [catalog.vertical]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "data_source": {
        const r = await pool.query(
          `INSERT INTO data_source (name, namespace_class) VALUES ($1,'registrar') RETURNING id`,
          [`source-${randomUUID()}`]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "lcid_registry": {
        return mintEditionLcid();
      }
      case "collectible_definition": {
        const lcid = await mintLcid("definition");
        const r = await pool.query(
          `INSERT INTO collectible_definition
             (definition_lcid, vertical, vertical_pack_version_id, corpus_version_id, attributes, signature)
           VALUES ($1,$2,$3,$4,'{}','sig') RETURNING id`,
          [lcid, catalog.vertical, catalog.packVersionId, catalog.corpusVersionId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "edition": {
        const r = await pool.query(
          `INSERT INTO edition
             (edition_lcid, definition_lcid, vertical, vertical_pack_version_id, corpus_version_id,
              attributes, signature)
           VALUES ($1,$2,$3,$4,$5,'{}','sig') RETURNING id`,
          [
            await mintLcid("edition"),
            await mintLcid("definition"),
            catalog.vertical,
            catalog.packVersionId,
            catalog.corpusVersionId,
          ]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "edition_signature": {
        const r = await pool.query(
          `INSERT INTO edition_signature
             (vertical, signature, normalization_version, edition_lcid, corpus_version_id)
           VALUES ($1,'sig',1,$2,$3) RETURNING id`,
          [catalog.vertical, await mintLcid("edition"), catalog.corpusVersionId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "edition_external_id": {
        const r = await pool.query(
          `INSERT INTO edition_external_id
             (edition_lcid, provider, external_id, vertical, corpus_version_id, match_method, data_source_id)
           VALUES ($1,'upc','012345678905',$2,$3,'exact',$4) RETURNING id`,
          [await mintLcid("edition"), catalog.vertical, catalog.corpusVersionId, catalog.dataSourceId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "lcid_merge": {
        const r = await pool.query(
          `INSERT INTO lcid_merge
             (losing_lcid, surviving_lcid, corpus_version_id, method, evidence, decided_by)
           VALUES ($1,$2,$3,'human_review','{}','tester') RETURNING id`,
          [await mintLcid("edition"), await mintLcid("edition"), catalog.corpusVersionId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "lcid_split": {
        const r = await pool.query(
          `INSERT INTO lcid_split (source_lcid, corpus_version_id, method, evidence, decided_by)
           VALUES ($1,$2,'human_review','{}','tester') RETURNING id`,
          [await mintLcid("edition"), catalog.corpusVersionId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "lcid_split_outcome": {
        const parent = await pool.query(
          `INSERT INTO lcid_split (source_lcid, corpus_version_id, method, evidence, decided_by)
           VALUES ($1,$2,'human_review','{}','tester') RETURNING id`,
          [await mintLcid("edition"), catalog.corpusVersionId]
        );
        const product = await mintLcid("edition");
        await pool.query(`INSERT INTO lcid_split_outcome (split_id, product_lcid) VALUES ($1,$2)`, [
          (parent.rows[0] as { id: string }).id,
          product,
        ]);
        return product;
      }
      case "lcid_retirement": {
        const r = await pool.query(
          `INSERT INTO lcid_retirement (lcid, corpus_version_id, reason, method, evidence, decided_by)
           VALUES ($1,$2,'phantom edition','human_review','{}','tester') RETURNING id`,
          [await mintLcid("edition"), catalog.corpusVersionId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "identity_resolution": {
        const confirmation = await pool.query(
          `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source)
           VALUES ($1,$2,'{}','one_tap') RETURNING id`,
          [sessionId, shopId]
        );
        const r = await pool.query(
          `INSERT INTO identity_resolution
             (shop_id, human_confirmation_id, edition_lcid, corpus_version_id, method, resolved_by)
           VALUES ($1,$2,$3,$4,'barcode','tester') RETURNING id`,
          [
            shopId,
            (confirmation.rows[0] as { id: string }).id,
            await mintLcid("edition"),
            catalog.corpusVersionId,
          ]
        );
        return (r.rows[0] as { id: string }).id;
      }
      // 019 / 020 (E03-D09): the identity cluster. 048 §10.1's split — a grant, a
      // revocation, a minted credential, a session issuance and a failed attempt
      // are things that HAPPENED; an organization, a location, a person, a phone
      // and a PIN are statements about the present and are declared exemptions.
      // The recipes had to be written in the same PR as the migration, which is
      // the declared list doing its job for the third time on new tables.
      case "membership": {
        const r = await pool.query(
          `INSERT INTO membership (app_user_id, shop_id, scope_kind, role)
           VALUES ($1,$2,'shop','operator') RETURNING id`,
          [await freshUser(), shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "membership_revocation": {
        const grant = await pool.query(
          `INSERT INTO membership (app_user_id, shop_id, scope_kind, role)
           VALUES ($1,$2,'shop','operator') RETURNING id`,
          [await freshUser(), shopId]
        );
        const r = await pool.query(
          `INSERT INTO membership_revocation (shop_id, membership_id, reason)
           VALUES ($1,$2,'left the shop') RETURNING id`,
          [shopId, (grant.rows[0] as { id: string }).id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "device_credential": {
        const r = await pool.query(
          `INSERT INTO device_credential (shop_id, device_id, token_hash) VALUES ($1,$2,$3) RETURNING id`,
          [shopId, await freshDevice(), `sha256:${randomUUID()}`]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "device_credential_revocation": {
        const credential = await pool.query(
          `INSERT INTO device_credential (shop_id, device_id, token_hash) VALUES ($1,$2,$3) RETURNING id`,
          [shopId, await freshDevice(), `sha256:${randomUUID()}`]
        );
        const r = await pool.query(
          `INSERT INTO device_credential_revocation (shop_id, credential_id, reason)
           VALUES ($1,$2,'phone lost') RETURNING id`,
          [shopId, (credential.rows[0] as { id: string }).id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "app_session": {
        const r = await pool.query(
          `INSERT INTO app_session
             (chain_id, kind, shop_id, location_id, device_id, device_credential_id, token_hash,
              rotate_after, idle_expires_at, absolute_expires_at)
           VALUES (gen_random_uuid(),'device',$1,$2,$3,$4,$5,
                   now() + interval '1 day', now() + interval '2 days', now() + interval '30 days')
           RETURNING id`,
          [shopId, locationId, deviceId, credentialId, `sha256:${randomUUID()}`]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "app_session_revocation": {
        const r = await pool.query(
          `INSERT INTO app_session_revocation (shop_id, chain_id, reason)
           VALUES ($1, gen_random_uuid(), 'signed_out') RETURNING id`,
          [shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "auth_attempt": {
        const r = await pool.query(
          `INSERT INTO auth_attempt (shop_id, device_id, app_user_id, method, failure_class)
           VALUES ($1,$2,$3,'operator_pin','wrong_pin') RETURNING id`,
          [shopId, deviceId, await freshUser()]
        );
        return (r.rows[0] as { id: string }).id;
      }
      // 024 (E03-D07): invitations, device enrollment and the PIN retirement.
      // 048 §7's whole shape is that single use is a CONSTRAINT rather than a
      // status column, so all five are things that HAPPENED and none is exempt.
      case "invitation": {
        const r = await pool.query(
          `INSERT INTO invitation
             (shop_id, app_user_id, role, scope_kind, token_digest, expires_at, invited_by)
           VALUES ($1,$2,'operator','shop',$3, now() + interval '1 day', $4) RETURNING id`,
          // A digest of a value that is not a code, and never a code: this suite
          // exercises the trigger, and a realistic-looking token in a fixture is
          // the shape 048 §7.1's header refuses.
          [shopId, await freshUser(), `sha256:${randomUUID()}`, await freshUser()]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "invitation_use": {
        const person = await freshUser();
        const invitation = await pool.query(
          `INSERT INTO invitation
             (shop_id, app_user_id, role, scope_kind, token_digest, expires_at, invited_by)
           VALUES ($1,$2,'operator','shop',$3, now() + interval '1 day', $4) RETURNING id`,
          [shopId, person, `sha256:${randomUUID()}`, await freshUser()]
        );
        const membership = await pool.query(
          `INSERT INTO membership (app_user_id, shop_id, scope_kind, role)
           VALUES ($1,$2,'shop','operator') RETURNING id`,
          [person, shopId]
        );
        const session = await pool.query(
          `INSERT INTO app_session
             (chain_id, kind, shop_id, location_id, device_id, device_credential_id, token_hash,
              rotate_after, idle_expires_at, absolute_expires_at)
           VALUES (gen_random_uuid(),'device',$1,$2,$3,$4,$5,
                   now() + interval '1 day', now() + interval '2 days', now() + interval '30 days')
           RETURNING id`,
          [shopId, locationId, deviceId, credentialId, `sha256:${randomUUID()}`]
        );
        const r = await pool.query(
          `INSERT INTO invitation_use
             (shop_id, invitation_id, membership_id, redeemed_on_device_id, redeemed_on_session_id)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [
            shopId,
            (invitation.rows[0] as { id: string }).id,
            (membership.rows[0] as { id: string }).id,
            deviceId,
            (session.rows[0] as { id: string }).id,
          ]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "device_enrollment_code": {
        const r = await pool.query(
          `INSERT INTO device_enrollment_code
             (shop_id, location_id, device_label, device_kind, code_digest, expires_at, issued_by)
           VALUES ($1,$2,'counter phone','phone',$3, now() + interval '15 minutes', $4) RETURNING id`,
          [shopId, locationId, `sha256:${randomUUID()}`, await freshUser()]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "device_enrollment_code_use": {
        const code = await pool.query(
          `INSERT INTO device_enrollment_code
             (shop_id, location_id, device_label, device_kind, code_digest, expires_at, issued_by)
           VALUES ($1,$2,'counter phone','phone',$3, now() + interval '15 minutes', $4) RETURNING id`,
          [shopId, locationId, `sha256:${randomUUID()}`, await freshUser()]
        );
        const enrolled = await freshDevice();
        const credential = await pool.query(
          `INSERT INTO device_credential (shop_id, device_id, token_hash) VALUES ($1,$2,$3) RETURNING id`,
          [shopId, enrolled, `sha256:${randomUUID()}`]
        );
        const r = await pool.query(
          `INSERT INTO device_enrollment_code_use (shop_id, code_id, device_id, device_credential_id)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [shopId, (code.rows[0] as { id: string }).id, enrolled, (credential.rows[0] as { id: string }).id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "operator_pin_retirement": {
        // The PIN row is written with a digest that is not a hash of any PIN —
        // this suite tests the trigger, not the credential, and 048 I9's canary
        // rule is that no fixture carries anything a real hash could be confused
        // with.
        const pin = await pool.query(
          `INSERT INTO operator_pin (shop_id, device_id, app_user_id, pin_hash)
           VALUES ($1,$2,$3,'not-a-hash') RETURNING id, updated_at`,
          [shopId, await freshDevice(), await freshUser()]
        );
        const row = pin.rows[0] as { id: string; updated_at: Date };
        const r = await pool.query(
          `INSERT INTO operator_pin_retirement
             (shop_id, operator_pin_id, retired_pin_updated_at, reason)
           SELECT $1, p.id, p.updated_at, 'membership revoked'
             FROM operator_pin p WHERE p.id = $2
           RETURNING id`,
          [shopId, row.id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      // E03-D06's four (`migrations/025`). The authenticator ROW is not here: it
      // is a declared exemption, because 048 R19's `last_used_step` is the one
      // column in this subsystem that has to move.
      case "user_authenticator_retirement": {
        const r = await pool.query(
          `INSERT INTO user_authenticator_retirement (app_user_id, authenticator_id, reason)
           VALUES ($1,$2,'lost_authenticator') RETURNING id`,
          [await freshUser(), await freshAuthenticator()]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "recovery_code": {
        const r = await pool.query(
          `INSERT INTO recovery_code (app_user_id, batch_id, code_hash)
           VALUES ($1, gen_random_uuid(), 'not-a-hash') RETURNING id`,
          [await freshUser()]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "recovery_code_use": {
        const person = await freshUser();
        const code = await pool.query(
          `INSERT INTO recovery_code (app_user_id, batch_id, code_hash)
           VALUES ($1, gen_random_uuid(), 'not-a-hash') RETURNING id`,
          [person]
        );
        const r = await pool.query(
          `INSERT INTO recovery_code_use (app_user_id, code_id) VALUES ($1,$2) RETURNING id`,
          [person, (code.rows[0] as { id: string }).id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "shop_recovery_nomination": {
        const r = await pool.query(
          `INSERT INTO shop_recovery_nomination (shop_id, kind) VALUES ($1,'declined') RETURNING id`,
          [shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }

      // 026 (E03-B06): the connector's authorization lifecycle. Five tables and
      // no exemption — every one is a thing that HAPPENED, and every guard in
      // the subsystem is a UNIQUE index rather than a mutable column.
      case "connector_install_state":
        return (await freshInstallState()).id;
      case "connector_token_version":
        return (await freshTokenVersion()).id;
      case "connector_install_state_use": {
        const state = await freshInstallState();
        const version = await freshTokenVersion();
        const r = await pool.query(
          `INSERT INTO connector_install_state_use (shop_id, state_id, connector_token_version_id)
           VALUES ($1,$2,$3) RETURNING id`,
          [shopId, state.id, version.id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      case "connector_webhook_receipt":
        return (await freshWebhookReceipt()).id;
      case "connector_token_retirement": {
        // `uninstall` is the reason that must cite its webhook (026's CHECK), so
        // the recipe uses `revocation` — the one a person may assert — and the
        // CHECK itself is asserted in `tests/integration/connector-oauth.test.ts`.
        const version = await freshTokenVersion();
        const r = await pool.query(
          `INSERT INTO connector_token_retirement (shop_id, connector_token_version_id, reason_code)
           VALUES ($1,$2,'revocation') RETURNING id`,
          [shopId, version.id]
        );
        return (r.rows[0] as { id: string }).id;
      }
      // E03-B03's actor audit (`migrations/028`). A REFUSAL, because a refusal
      // is the row shape that names no membership — the one this suite can write
      // without inventing a grant, and the one an attacker would most like to
      // edit away.
      case "authorization_decision": {
        const r = await pool.query(
          `INSERT INTO authorization_decision
             (shop_id, route_method, route_path, permission, matrix_version,
              role, session_chain_id, decision, refusal_reason)
           VALUES ($1,'POST','/api/v1/shops/:shopId/scan-sessions','scan.session.open','1.0.0',
                   'operator', gen_random_uuid(), 'refused', 'role')
           RETURNING id`,
          [shopId]
        );
        return (r.rows[0] as { id: string }).id;
      }
      default:
        throw new Error(`no insert recipe for ${table}`);
    }
  }

  // One declared list, three readers (041 §2.2 / §9.2 item 4): this suite is one of
  // them. Deriving the loop from APPEND_ONLY_TABLES means a new append-only table
  // cannot be added without either an insert recipe here or a red build.
  const eventTables = APPEND_ONLY_TABLES.map((t) => t.table);

  for (const table of eventTables) {
    it(`rejects UPDATE and DELETE on ${table}`, async () => {
      const id = await insertRow(table);
      const key = keyOf(table);
      await expect(pool.query(`UPDATE ${table} SET ${key} = ${key} WHERE ${key} = $1`, [id])).rejects.toThrow(
        /append-only/
      );
      await expect(pool.query(`DELETE FROM ${table} WHERE ${key} = $1`, [id])).rejects.toThrow(/append-only/);
      // The row is still there, untouched.
      const check = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${key} = $1`, [id]);
      expect((check.rows[0] as { n: number }).n).toBe(1);
    });
  }

  // E02-D05 / 041 §9.2 item 1. Before migration 006 every trigger sat at the
  // Postgres default tgenabled='O' — "fire in ORIGIN role" — so the role that owns
  // the tables (today the same role the server uses: one DATABASE_URL) could turn
  // the whole Hickey guarantee off for a session with `SET
  // session_replication_role='replica'` and then UPDATE freely. At 'A' the trigger
  // fires in every replication role. The mirror-image negative — the same sequence
  // SUCCEEDING against an 'O' trigger, so this is not a claim that replica role is
  // simply inert here — is in migrations.test.ts.
  for (const table of eventTables) {
    it(`refuses UPDATE and DELETE on ${table} even in session_replication_role='replica'`, async () => {
      const id = await insertRow(table);
      // E02-D06: the pool above now connects as the MIGRATE role, which is not a
      // superuser and therefore gets `permission denied to set parameter` here —
      // that refusal is itself asserted in role-separation.test.ts. To keep
      // proving the ENABLE ALWAYS property rather than silently proving the
      // permission check twice, this probe escalates to the superuser, the only
      // principal in the cluster who can reach replica role at all.
      const key = keyOf(table);
      const client = await superuserPool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await expect(
          client.query(`UPDATE ${table} SET ${key} = ${key} WHERE ${key} = $1`, [id])
        ).rejects.toThrow(/append-only \(Hickey model\): UPDATE not allowed/);
        await expect(client.query(`DELETE FROM ${table} WHERE ${key} = $1`, [id])).rejects.toThrow(
          /append-only \(Hickey model\): DELETE not allowed/
        );
      } finally {
        await client.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
        client.release();
      }
      const check = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${key} = $1`, [id]);
      expect((check.rows[0] as { n: number }).n).toBe(1);
    });
  }

  it("still allows the one permitted mutation: scan_session.status", async () => {
    await pool.query(`UPDATE scan_session SET status = 'confirmed' WHERE id = $1`, [sessionId]);
    const res = await pool.query(`SELECT status FROM scan_session WHERE id = $1`, [sessionId]);
    expect((res.rows[0] as { status: string }).status).toBe("confirmed");
  });
});
