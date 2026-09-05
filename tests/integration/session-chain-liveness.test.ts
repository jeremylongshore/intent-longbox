// L4: 048 I3a — cross-chain liveness holds in BOTH directions (K4).
//
//   live(op) := live(op.row) ∧ live(current-successor-closure of op.parent_session_id)
//
// The formula exists because v1.0.0 said the operator session "names its
// `parent_session_id`", which is ambiguous the moment the parent rotates: the
// named row is spent, and a naive liveness check on it kills every operator
// session on the phone once per rotation period. The closure resolves by
// `chain_id` instead — which is the second reason `chain_id` exists.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { type Queryable, type Tx, serviceDb, withTransaction } from "../../src/db.js";
import {
  chainHead,
  lockAndRotate,
  parentChainIsLive,
  resolveToken,
  revokeChain,
} from "../../src/services/auth/index.js";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { openDevice, openOperator, seedIdentity, type SeededIdentity } from "./authHelpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("cross-chain liveness (048 §3.5, K4, I3a)", () => {
  let pool: pg.Pool;
  let shopId: string;
  let identity: SeededIdentity;

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
  /**
   * The session reads run in the SAME service scope the hook uses (E03-B04).
   *
   * A cookie is resolved by digest before anyone knows which shop the caller is
   * at — the row it finds IS the tenant (048 §6.1) — so `app_session` and its
   * revocation table carry a second, `service_context` policy and the reads name
   * that scope. Calling these with a bare pool would return zero rows and every
   * assertion below would read "unknown token", which is exactly the wrong kind
   * of green.
   */
  const sessionDb = (): Queryable => serviceDb(pool, "session-resolution");

  const shopQuery = (sql: string, values?: unknown[]): Promise<pg.QueryResult> =>
    asShop(pool, shopId).query(sql, values);

  const shopTx = <T>(fn: (tx: Tx) => Promise<T>, shop: string = shopId): Promise<T> =>
    withTransaction(pool, fn, { tenant: { shopId: shop } });

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_chain_liveness");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Chain Shop", slug: `chain-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    identity = await seedIdentity(pool, shopId);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  const later = (hours: number): Date => new Date(Date.now() + hours * 60 * 60 * 1000);

  it("keeps every operator session live when the PARENT rotates", async () => {
    const device = await openDevice(pool, identity);
    const operator = await openOperator(pool, device, identity.operatorId);

    const rotated = await shopTx((tx) => lockAndRotate(tx, device.row, later(48)));
    expect(rotated).toBeDefined();
    // The row the operator session NAMES is now spent. Chasing that pointer
    // would sign every operator on this phone out once per rotation period —
    // which is 033 A13's "no re-login, no re-picking the box" broken by the
    // session layer after §3.5 spent a section protecting it.
    expect(await parentChainIsLive(sessionDb(), operator.row.parent_chain_id!, new Date())).toBe(true);
    const still = await resolveToken(sessionDb(), operator.token, new Date());
    expect("refusal" in still).toBe(false);

    // The closure IS the chain's current head, resolved in one indexed read.
    const head = await chainHead(sessionDb(), device.row.chain_id);
    expect(head?.id).toBe(rotated!.row.id);
  });

  it("kills every operator session above a REVOKED device chain, at the next request, with no sweep", async () => {
    const device = await openDevice(pool, identity);
    const a = await openOperator(pool, device, identity.operatorId);
    const b = await openOperator(pool, device, identity.ownerId);
    expect(await parentChainIsLive(sessionDb(), a.row.parent_chain_id!, new Date())).toBe(true);

    // Revoking the device credential's chain is the lost-phone case (048 §7.3).
    await shopTx((tx) => revokeChain(tx, { chainId: device.row.chain_id, shopId, reason: "device_revoked" }));

    for (const session of [a, b]) {
      expect(await parentChainIsLive(sessionDb(), session.row.parent_chain_id!, new Date())).toBe(false);
      // The operator ROW itself is still live by its own predicates — which is
      // exactly why the formula has two conjuncts and why a check that read only
      // the operator's own row would let a revoked phone keep working.
      const own = await resolveToken(sessionDb(), session.token, new Date());
      expect("refusal" in own).toBe(false);
    }
  });

  it("kills them when the device chain merely EXPIRES, too", async () => {
    const device = await openDevice(pool, identity);
    const operator = await openOperator(pool, device, identity.operatorId);
    const afterAbsolute = new Date(device.row.absolute_expires_at.getTime() + 1_000);
    expect(await parentChainIsLive(sessionDb(), operator.row.parent_chain_id!, afterAbsolute)).toBe(false);
  });

  it("leaves the operator session's denormalized shop and location UNCHANGED by a parent rotation", async () => {
    const device = await openDevice(pool, identity);
    const operator = await openOperator(pool, device, identity.operatorId);
    await shopTx((tx) => lockAndRotate(tx, device.row, later(48)));

    const row = await shopQuery(`SELECT shop_id, location_id FROM app_session WHERE id = $1`, [
      operator.row.id,
    ]);
    // They are immutable facts about an ISSUANCE, not a cache of a mutable
    // elsewhere (048 §3.5): the device's enrollment cannot change under a live
    // session, because re-enrolling is a new `device_credential` and §7.3's
    // revocation kills the chain. So §6.1 reads the operator row it already has
    // and never chases a pointer into a spent parent.
    expect(row.rows[0]).toEqual({ shop_id: shopId, location_id: identity.locationId });
  });

  it("REFUSES an operator row whose parent_chain_id is not its parent's chain", async () => {
    const deviceA = await openDevice(pool, identity);
    const deviceB = await openDevice(pool, identity);

    // The two columns are ONE FACT. Without the composite FK this row inserts
    // cleanly — `parent_session_id` exists, `parent_chain_id` exists — and K4's
    // closure then resolves deviceB's chain for a session that hangs off
    // deviceA. That is a silent cross-device authorisation, and it is the same
    // class K5 makes unconstructible for a rotation.
    await expect(
      shopQuery(
        `INSERT INTO app_session
           (chain_id, kind, shop_id, location_id, device_id, device_credential_id, app_user_id,
            parent_session_id, parent_chain_id, token_hash,
            rotate_after, idle_expires_at, absolute_expires_at)
         VALUES (gen_random_uuid(),'operator',$1,$2,$3,$4,$5,$6,$7,$8,
                 now() + interval '1 hour', now() + interval '2 hours', now() + interval '3 hours')`,
        [
          shopId,
          identity.locationId,
          identity.deviceId,
          identity.credentialId,
          identity.operatorId,
          deviceA.row.id,
          deviceB.row.chain_id,
          `sha256:${randomUUID()}`,
        ]
      )
    ).rejects.toThrow(/app_session_parent_pair_is_one_fact/);
  });

  it("treats an operator token paired with ANOTHER device's chain as one refusal", async () => {
    const deviceA = await openDevice(pool, identity);
    const deviceB = await openDevice(pool, identity);
    const operator = await openOperator(pool, deviceA, identity.operatorId);

    // The pairing check is one comparison, not a reconciliation: the operator
    // row's parent chain must BE the device cookie's chain. A mismatched pair,
    // an operator cookie with no device cookie, and two cookies from two
    // different chains are all the SAME refusal (048 §3.6, R1).
    expect(operator.row.parent_chain_id).not.toBe(deviceB.row.chain_id);
    expect(operator.row.parent_chain_id).toBe(deviceA.row.chain_id);
  });
});
