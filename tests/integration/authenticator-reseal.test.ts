// L4: **key rotation's second step** — re-sealing a second factor under a new
// key version without touching the secret it protects.
//
// Bead: longbox-e5b.3.21 (alias E03-D11). Docs: 000-docs/057 §4.6; 048 §4.2
// (R18), §4.3 (R19), §8.1; 050 §4's rotation model.
//
// ============================================================================
// WHAT THIS SUITE IS ACTUALLY PROVING, AND WHY A UNIT TEST COULD NOT
// ============================================================================
//
// 048 §4.2's rotation is additive: a `..._V2` is added, new enrollments seal
// under it, every V1 row still opens under V1, and **removing V1 takes every
// second factor still sealed under it**. The step that makes the removal safe is
// this job — and there are exactly three ways it can be silently wrong, all of
// which need a real database:
//
//   1. the successor could be sealed under V2 and NOT OPEN, because the AAD is
//      the row's id and the id changed. Proved by verifying a real code against
//      the successor under a ring that holds only V2's key;
//   2. the predecessor could still be LIVE, because the retirement fact was not
//      written in the same transaction. Proved by reading `mfaState` and the
//      liveness predicate rather than by trusting the function's return;
//   3. **`last_used_step` could be lost**, which is the one a reviewer will not
//      see: a successor with a NULL replay guard makes the code the owner used
//      thirty seconds ago valid again — 048 R19's replay, reintroduced by a
//      maintenance job. Proved by presenting exactly that code.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import {
  authenticatorsBelowVersion,
  enrollAuthenticator,
  liveAuthenticator,
  mfaState,
  mintTotpSecret,
  requireAuthenticatorKey,
  resealAuthenticator,
  stepAt,
  totpCode,
  verifyTotp,
} from "../../src/services/auth/index.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { grant, insertUser } from "./authHelpers.js";
import { TEST_AUTHENTICATOR_KEY_V1, TEST_AUTHENTICATOR_KEY_V2, TEST_PIN_PEPPER } from "../testConfig.js";

const dbUp = await probeDb();

/** The ring while only V1 exists, and the ring after V2 is added. */
const RING_V1 = requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V1: TEST_AUTHENTICATOR_KEY_V1 });
const RING_V2 = requireAuthenticatorKey({
  LONGBOX_AUTHENTICATOR_KEY_V1: TEST_AUTHENTICATOR_KEY_V1,
  LONGBOX_AUTHENTICATOR_KEY_V2: TEST_AUTHENTICATOR_KEY_V2,
});
/** V2 ALONE — the state after the operator removes V1, which step 3 permits. */
const RING_ONLY_V2 = requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V2: TEST_AUTHENTICATOR_KEY_V2 });

describe.skipIf(!dbUp)("re-sealing a second factor (048 §4.2, 057 §4.6)", () => {
  let pool: pg.Pool;
  let shopId: string;

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_authenticator_reseal");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Reseal Shop", slug: `reseal-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
  });

  /** One privileged person with a live factor sealed under V1. */
  async function enrolledOwner(): Promise<{ appUserId: string; secret: Buffer }> {
    const appUserId = await insertUser(
      pool,
      `reseal-${Math.random().toString(36).slice(2)}@example.invalid`,
      "Reseal Person"
    );
    await grant(pool, appUserId, shopId, "owner");
    const secret = mintTotpSecret();
    await withTransaction(
      pool,
      async (tx) => {
        const out = await enrollAuthenticator(tx, {
          appUserId,
          secret,
          confirmationCode: totpCode(secret, stepAt(new Date())),
          keyring: RING_V1,
          pepper: TEST_PIN_PEPPER,
          now: new Date(),
        });
        if (!out.ok) throw new Error(`enrollment refused: ${out.refusal}`);
      },
      { tenant: { service: "second-factor" } }
    );
    return { appUserId, secret };
  }

  const reseal = (appUserId: string, keyring = RING_V2) =>
    withTransaction(pool, (tx) => resealAuthenticator(tx, { appUserId, keyring, now: new Date() }), {
      tenant: { service: "second-factor" },
    });

  it("lists exactly the people whose factor is below the current version", async () => {
    const { appUserId } = await enrolledOwner();
    const before = await authenticatorsBelowVersion(pool, RING_V2.current);
    expect(before.map((r) => r.appUserId)).toContain(appUserId);
    expect(before.find((r) => r.appUserId === appUserId)?.keyVersion).toBe(1);
    // The worklist is a PREDICATE over `key_version`, so `--dry-run` can report
    // it without performing it and a re-run picks up exactly the remainder.
    await reseal(appUserId);
    const after = await authenticatorsBelowVersion(pool, RING_V2.current);
    expect(after.map((r) => r.appUserId)).not.toContain(appUserId);
  });

  it("writes a NEW row under V2 and RETIRES the old one, in one transaction", async () => {
    const { appUserId } = await enrolledOwner();
    const before = (await liveAuthenticator(pool, appUserId))!;
    const out = await reseal(appUserId);
    expect(out).toMatchObject({ resealed: true, from: 1, to: 2 });

    const after = (await liveAuthenticator(pool, appUserId))!;
    expect(after.id).not.toBe(before.id);
    expect(after.key_version).toBe(2);
    // The sealed column was never edited — `migrations/031`'s trigger would have
    // refused it, and the design does not need it to be.
    expect(after.secret_ciphertext.equals(before.secret_ciphertext)).toBe(false);

    const retired = await pool.query(
      `SELECT reason FROM user_authenticator_retirement WHERE authenticator_id = $1`,
      [before.id]
    );
    expect(retired.rows).toEqual([{ reason: "replaced" }]);
    // There is never a moment with two live factors: `mfaState` says `enrolled`
    // and not `must_reenroll`, because a REPLACEMENT is not a recovery.
    expect(await mfaState(pool, appUserId)).toBe("enrolled");
  });

  it("keeps the SECRET, so the person's authenticator app is undisturbed", async () => {
    const { appUserId, secret } = await enrolledOwner();
    await reseal(appUserId);
    // The same secret, verified against the SUCCESSOR row, under a ring that
    // holds ONLY V2 — which is the state after step 3 removes V1, and the only
    // state in which "the rotation is finished" means anything.
    const at = new Date(Date.now() + 30_000);
    const verdict = await withTransaction(
      pool,
      (tx) =>
        verifyTotp(tx, {
          appUserId,
          code: totpCode(secret, stepAt(at)),
          keyring: RING_ONLY_V2,
          now: at,
        }),
      { tenant: { service: "second-factor" } }
    );
    expect(verdict).toMatchObject({ ok: true });
  });

  it("CARRIES THE REPLAY GUARD FORWARD — the code just used stays refused", async () => {
    // The failure a reviewer does not see. `last_used_step` is a fact about the
    // SECRET, so a successor with a NULL guard makes the code the owner used
    // thirty seconds ago valid again.
    const { appUserId, secret } = await enrolledOwner();
    const before = (await liveAuthenticator(pool, appUserId))!;
    const spentStep = Number(before.last_used_step);
    expect(spentStep).toBeGreaterThan(0);

    await reseal(appUserId);
    const after = (await liveAuthenticator(pool, appUserId))!;
    expect(Number(after.last_used_step)).toBe(spentStep);

    // …and presenting that exact code is refused as the replay it is.
    const at = new Date(spentStep * 30_000);
    const verdict = await withTransaction(
      pool,
      (tx) => verifyTotp(tx, { appUserId, code: totpCode(secret, spentStep), keyring: RING_V2, now: at }),
      { tenant: { service: "second-factor" } }
    );
    expect(verdict).toMatchObject({ ok: false });
  });

  it("is a no-op on a factor already at the current version, and on a person with none", async () => {
    const { appUserId } = await enrolledOwner();
    await reseal(appUserId);
    expect(await reseal(appUserId)).toEqual({ resealed: false, reason: "already_current" });

    const nobody = await insertUser(
      pool,
      `nofactor-${Math.random().toString(36).slice(2)}@example.invalid`,
      "No Factor"
    );
    expect(await reseal(nobody)).toEqual({ resealed: false, reason: "no_authenticator" });
  });

  it("REFUSES to rotate what it cannot read, loudly", async () => {
    // A ring that has already lost V1 cannot open a V1 row, and the correct
    // outcome is a thrown `AeadOpenError` rather than a row sealed under V2 whose
    // plaintext is garbage. The job stops with the finished ones committed.
    const { appUserId } = await enrolledOwner();
    await expect(reseal(appUserId, RING_ONLY_V2)).rejects.toThrow();
    // …and the factor is untouched, so the operator can put the key back.
    const row = (await liveAuthenticator(pool, appUserId))!;
    expect(row.key_version).toBe(1);
  });
});
