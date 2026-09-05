// L4: 048 I15 — "a recovery code is a second factor and never a first."
//
// Bead: longbox-e5b.3.17 (alias E03-D06). Docs: 048 §8.1 (R20), §8.2, §9.1, §11
// I15; 041 §9.2 item 4.
//
// ⚠ WHAT THIS SUITE CAN PROVE AND WHAT IT CANNOT, STATED RATHER THAN LEFT TO A
// READER TO NOTICE. I15's first two cases are *"a correct recovery code WITHOUT
// the password is refused"* and *"a recovery code presented IN PLACE of the
// password is refused"*. Both are properties of a sign-in path built on
// `user_credential`, which is 048 §10.1's M3 remainder and is not in this tree —
// so they are asserted where they can be: the redemption function takes an
// already-identified person and its header says the caller must have verified the
// first factor, there is NO route that reaches it, and the CLI that does runs as
// the schema owner on the host. The bead that lands the first factor inherits
// those two cases as acceptance lines; the RTM row says so rather than claiming
// coverage this file does not have.
//
// Everything else in I15 is here: single use by constraint, the forced
// re-enrollment, the superseded set, and the refusals that all answer the same.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { type Queryable, type Tx, serviceDb, withTransaction } from "../../src/db.js";
import {
  LOCKOUT_WINDOW_MS,
  RECOVERY_CODE_COUNT,
  RecoveryCodeAlreadyUsed,
  SECOND_FACTOR_FREE_ATTEMPTS,
  enrollAuthenticator,
  liveAuthenticator,
  liveRecoveryCodeCount,
  mfaState,
  redeemRecoveryCode,
  verifyTotp,
} from "../../src/services/auth/index.js";
import { mintTotpSecret, stepAt, totpCode } from "../../src/services/auth/totp.js";
import { hashRecoveryCode, verifyRecoveryCode } from "../../src/services/auth/secrets.js";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { grant, insertUser } from "./authHelpers.js";
import { TEST_PIN_PEPPER, testKeyring } from "../testConfig.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("recovery codes (048 §8, I15)", () => {
  let pool: pg.Pool;
  let shopId: string;
  const keyring = testKeyring();

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
   * THE SECOND FACTOR IS A PERSON'S ACT, NOT A SHOP'S (E03-B04, 048 §4/§8).
   *
   * `user_authenticator`, `recovery_code` and `app_user` carry no `shop_id` at
   * all — they are declared exemptions in `src/db/rowLevelSecurity.ts` — and the
   * `auth_attempt` row a failed factor appends carries a NULL one, which matches
   * no tenant policy by construction. So these calls declare the `second-factor`
   * service scope, exactly as the three CLIs that reach them in production do.
   */
  const mfaTx = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
    withTransaction(pool, fn, { tenant: { service: "second-factor" } });

  const mfaDb = (): Queryable => serviceDb(pool, "second-factor");

  const shopQuery = (sql: string, values?: unknown[]): Promise<pg.QueryResult> =>
    asShop(pool, shopId).query(sql, values);

  const shopTx = <T>(fn: (tx: Tx) => Promise<T>, shop: string = shopId): Promise<T> =>
    withTransaction(pool, fn, { tenant: { shopId: shop } });

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_recovery");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Recovery Shop", slug: `rec-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  /** An owner with a live second factor and a fresh set of codes. */
  async function enrolled(
    now = new Date()
  ): Promise<{ id: string; secret: Buffer; codes: readonly string[] }> {
    const id = await insertUser(pool, `rec-${randomUUID()}@example.invalid`, "Owner Person");
    await grant(pool, id, shopId, "owner");
    const secret = mintTotpSecret();
    const out = await mfaTx((tx) =>
      enrollAuthenticator(tx, {
        appUserId: id,
        secret,
        confirmationCode: totpCode(secret, stepAt(now)),
        keyring,
        pepper: TEST_PIN_PEPPER,
        now,
      })
    );
    if (!out.ok) throw new Error(`enrollment refused: ${out.refusal}`);
    return { id, secret, codes: out.enrolled.recoveryCodes };
  }

  const redeem = async (id: string, code: string) =>
    mfaTx((tx) => redeemRecoveryCode(tx, { appUserId: id, code, pepper: TEST_PIN_PEPPER, now: new Date() }));

  it("issues a set at ENROLLMENT and stores digests that are not the codes", async () => {
    const { id, codes } = await enrolled();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);

    const stored = await shopQuery(`SELECT code_hash FROM recovery_code WHERE app_user_id = $1`, [id]);
    const hashes = (stored.rows as Array<{ code_hash: string }>).map((r) => r.code_hash);
    expect(hashes).toHaveLength(RECOVERY_CODE_COUNT);
    for (const hash of hashes) {
      expect(hash.startsWith("$argon2id$")).toBe(true);
      // 048 I9 / 019 T31, the two directions that matter: neither the code nor the
      // pepper is recoverable by reading the row.
      for (const code of codes) expect(hash).not.toContain(code);
      expect(hash).not.toContain(TEST_PIN_PEPPER);
    }

    // THE PEPPER DOING ITS JOB (048 §9.2 R6, I9), and the only assertion that
    // distinguishes peppered from un-peppered: a digest that verified against the
    // code ALONE would be one a stolen `pg_dump` is an offline verifier for.
    const digest = await hashRecoveryCode("test-recovery-canary-key", TEST_PIN_PEPPER);
    expect(await verifyRecoveryCode("test-recovery-canary-key", TEST_PIN_PEPPER, digest)).toBe(true);
    expect(await verifyRecoveryCode("test-recovery-canary-key", "", digest)).toBe(false);
  });

  it("accepts one code ONCE, and the second presentation is refused", async () => {
    const { id, codes } = await enrolled();
    const first = await redeem(id, codes[0]!);
    expect(first.ok).toBe(true);
    expect(await liveRecoveryCodeCount(pool, id)).toBe(RECOVERY_CODE_COUNT - 1);

    // The second time it is refused for the ordinary reason — it is not live —
    // and the answer is the same one a wrong code gets.
    const again = await redeem(id, codes[0]!);
    expect(again).toEqual({ ok: false, reason: "no_authenticator" });
  });

  it("UNIQUE (code_id) decides two CONCURRENT redemptions of one code", async () => {
    // 048 §8.1's "single use is a constraint or it is a race", run as a race. Both
    // transactions read the code as live; the database refuses the second use row.
    const { id, codes } = await enrolled();
    const settled = await Promise.allSettled([redeem(id, codes[0]!), redeem(id, codes[0]!)]);

    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");
    // One of two shapes, and both are correct: either the second transaction was
    // serialised behind the first's anchor lock and found the code spent (a plain
    // refusal), or it raced to the INSERT and was refused by the constraint.
    const successes = fulfilled.filter((s) => (s as PromiseFulfilledResult<{ ok: boolean }>).value.ok).length;
    expect(successes).toBe(1);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(RecoveryCodeAlreadyUsed);
    }

    const uses = await shopQuery(`SELECT code_id FROM recovery_code_use WHERE app_user_id = $1`, [id]);
    expect(uses.rowCount).toBe(1);
  });

  it("FORCES re-enrollment: the factor is retired in the same transaction as the use", async () => {
    const { id, secret, codes } = await enrolled();
    const before = (await liveAuthenticator(pool, id))!;

    const out = await redeem(id, codes[0]!);
    expect(out).toMatchObject({ ok: true, retiredAuthenticatorId: before.id });

    // The state is a PREDICATE over two facts, not a flag anybody set.
    expect(await mfaState(pool, id)).toBe("must_reenroll");
    expect(await liveAuthenticator(pool, id)).toBeUndefined();
    const ending = await shopQuery(
      `SELECT reason FROM user_authenticator_retirement WHERE authenticator_id = $1`,
      [before.id]
    );
    expect((ending.rows[0] as { reason: string }).reason).toBe("recovery_code_used");

    // And the lost factor really is dead: a code from the old secret no longer
    // verifies, which is what "forced" means when there is no screen to force.
    const later = new Date(Date.now() + 60_000);
    const totp = await mfaTx((tx) =>
      verifyTotp(tx, { appUserId: id, code: totpCode(secret, stepAt(later)), keyring, now: later })
    );
    expect(totp).toEqual({ ok: false, reason: "no_authenticator" });
  });

  // 90 s, against the suite's 30 s default. This case alone issues TWO full
  // recovery sets and redeems THREE codes, so it pays argon2id sixteen-plus times
  // in one chain — measured at 23.7 s of the 30 s ceiling under a loaded lane,
  // which is a flake waiting for a busy CI runner rather than a slow assertion.
  // Raised for THIS case and not for the file: everything else here hashes a
  // handful of times and should still fail fast if it hangs.
  it("RE-ENROLLMENT retires every remaining code in the old set", { timeout: 90_000 }, async () => {
    // 048 §8.1: "codes that survive a re-enrollment are codes that survive
    // whatever caused it." The mechanism is a superseding batch, so the old codes
    // are refused by a predicate rather than by a column somebody had to update.
    const { id, codes } = await enrolled();
    await redeem(id, codes[0]!);
    expect(await liveRecoveryCodeCount(pool, id)).toBe(RECOVERY_CODE_COUNT - 1);

    const now = new Date(Date.now() + 60_000);
    const secret = mintTotpSecret();
    const out = await mfaTx((tx) =>
      enrollAuthenticator(tx, {
        appUserId: id,
        secret,
        confirmationCode: totpCode(secret, stepAt(now)),
        keyring,
        pepper: TEST_PIN_PEPPER,
        now,
      })
    );
    expect(out.ok).toBe(true);
    expect(await mfaState(pool, id)).toBe("enrolled");
    expect(await liveRecoveryCodeCount(pool, id)).toBe(RECOVERY_CODE_COUNT);

    // A code from the superseded set is refused, and the NEW set works.
    expect(await redeem(id, codes[1]!)).toEqual({ ok: false, reason: "wrong_code" });
    const fresh = (out as { ok: true; enrolled: { recoveryCodes: readonly string[] } }).enrolled
      .recoveryCodes;
    expect((await redeem(id, fresh[0]!)).ok).toBe(true);
  });

  it("refuses a wrong code, and a person who has no factor to substitute for", async () => {
    const { id } = await enrolled();
    expect(await redeem(id, "0000000000")).toEqual({ ok: false, reason: "wrong_code" });

    const stranger = await insertUser(pool, `nobody-${randomUUID()}@example.invalid`, "No Factor");
    await grant(pool, stranger, shopId, "owner");
    expect(await redeem(stranger, "0000000000")).toEqual({ ok: false, reason: "no_authenticator" });

    // Both are recorded as their own class, under their own method — folding
    // recovery attempts into `totp` would have made the one table that exists to
    // tell failures apart unable to.
    const attempts = await mfaDb().query(
      `SELECT method, failure_class FROM auth_attempt WHERE app_user_id = ANY($1::uuid[])`,
      [[id, stranger]]
    );
    const rows = attempts.rows as Array<{ method: string; failure_class: string }>;
    expect(rows.every((r) => r.method === "recovery_code")).toBe(true);
    expect(new Set(rows.map((r) => r.failure_class))).toEqual(new Set(["wrong_code", "no_authenticator"]));
  });

  it("shares ONE budget with TOTP, so alternating does not buy more attempts", async () => {
    // 048 §9.1's key is the person; the two methods are two forms of one factor.
    // Alternating between them must not reset the delay.
    // The failures below are TOTP — cheap, an HMAC rather than eight argon2id
    // runs — and the attempt that gets refused is a RECOVERY redemption. That
    // crossing is the property: one budget, two methods.
    const { id } = await enrolled();
    const now = new Date();
    for (let i = 0; i < SECOND_FACTOR_FREE_ATTEMPTS + 1; i += 1) {
      const spent = await mfaTx((tx) => verifyTotp(tx, { appUserId: id, code: "123456", keyring, now }));
      expect(spent).toEqual({ ok: false, reason: "wrong_code" });
    }

    const blocked = await redeem(id, "0000000000");
    expect(blocked).toEqual({ ok: false, reason: "wait" });

    // The blocked attempt recorded NOTHING: the refusal happens before a
    // credential is tested, so there is no credential test to record — and
    // recording one would let a flooder ratchet their own delay (048 R5).
    const attempts = await mfaDb().query(
      `SELECT count(*)::int AS n FROM auth_attempt WHERE app_user_id = $1`,
      [id]
    );
    expect((attempts.rows[0] as { n: number }).n).toBe(SECOND_FACTOR_FREE_ATTEMPTS + 1);

    // AND IT NEVER CLOSES (048 R5). Past the window there is no residue: the same
    // person's correct code is accepted, so there is no state from which a correct
    // second factor is refused — only a state in which it is refused *until*.
    const past = new Date(now.getTime() + LOCKOUT_WINDOW_MS + 60_000);
    const secret = mintTotpSecret();
    const reenrolled = await mfaTx((tx) =>
      enrollAuthenticator(tx, {
        appUserId: id,
        secret,
        confirmationCode: totpCode(secret, stepAt(past)),
        keyring,
        pepper: TEST_PIN_PEPPER,
        now: past,
      })
    );
    expect(reenrolled.ok).toBe(true);
    const after = new Date(past.getTime() + 30_000);
    const accepted = await mfaTx((tx) =>
      verifyTotp(tx, { appUserId: id, code: totpCode(secret, stepAt(after)), keyring, now: after })
    );
    expect(accepted.ok).toBe(true);
  });

  it("records the shop's recovery NOMINATION, including a decline (048 §8.2)", async () => {
    // The three answers, appended. `declined` is a first-class answer: the
    // difference between "this owner has no second person" and "nobody asked" is
    // the difference between a known residual and a surprise during an outage.
    const { recordRecoveryNomination, currentRecoveryNomination } =
      await import("../../src/services/auth/index.js");
    await shopTx((tx) => recordRecoveryNomination(tx, { shopId, kind: "declined" }));
    // `shop_recovery_nomination` IS shop-scoped, unlike everything else in this
    // suite, so both the write and the read name the shop (E03-B04).
    expect((await currentRecoveryNomination(asShop(pool, shopId), shopId))?.kind).toBe("declined");

    await shopTx((tx) =>
      recordRecoveryNomination(tx, {
        shopId,
        kind: "named_contact",
        contactName: "A Named Person",
        contactNote: "reachable at the shop on weekday mornings",
      })
    );
    const current = await currentRecoveryNomination(asShop(pool, shopId), shopId);
    expect(current).toMatchObject({ kind: "named_contact", contact_name: "A Named Person" });

    // Appended, not edited: the decline is still there, which is the audit trail a
    // column would have destroyed.
    const all = await shopQuery(
      `SELECT kind FROM shop_recovery_nomination WHERE shop_id = $1 ORDER BY created_at`,
      [shopId]
    );
    expect((all.rows as Array<{ kind: string }>).map((r) => r.kind)).toEqual(["declined", "named_contact"]);

    // And the shape CHECK: a contact name on anything but `named_contact` is
    // unrepresentable, so "declined with a name" cannot exist.
    await expect(
      shopQuery(
        `INSERT INTO shop_recovery_nomination (shop_id, kind, contact_name) VALUES ($1,'declined','X')`,
        [shopId]
      )
    ).rejects.toThrow();
  });
});
