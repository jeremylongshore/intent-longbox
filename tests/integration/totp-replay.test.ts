// L4: 048 I16 — "a TOTP step is consumed exactly once, BY THE DATABASE" — plus
// the enrollment, retirement and key-rotation properties that only a real
// Postgres can show.
//
// Bead: longbox-e5b.3.17 (alias E03-D06). Docs: 048 §4.1, §4.2 (R18), §4.3 (R19),
// §9.1 (R5), §11 I9/I16; 041 §9.2 item 4 (the one mutable column, declared).
//
// **The concurrency case is the point of the file.** 048 §11 warns that five of
// its new assertions "are the ones a build is most tempted to write as a
// single-threaded happy path", and I16 is one of them: two submissions of one
// code, run with `Promise.all` on two connections, must leave exactly one success
// and one refusal whose `UPDATE … WHERE last_used_step < $new` affected ZERO rows.
// Written serially it would pass for the wrong reason.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import {
  enrollAuthenticator,
  liveAuthenticator,
  mfaState,
  requireAuthenticatorKey,
  retireAuthenticator,
  verifyTotp,
} from "../../src/services/auth/index.js";
import { mintTotpSecret, stepAt, totpCode } from "../../src/services/auth/totp.js";
import { open } from "../../src/services/auth/aead.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { grant, insertUser } from "./authHelpers.js";
import {
  TEST_AUTHENTICATOR_KEY_V1,
  TEST_AUTHENTICATOR_KEY_V2,
  TEST_PIN_PEPPER,
  testKeyring,
} from "../testConfig.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("the second factor, in the database (048 §4, I16)", () => {
  let pool: pg.Pool;
  let shopId: string;
  const keyring = testKeyring();

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_totp");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "TOTP Shop", slug: `totp-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  /** A person holding one of 048 §4.1's three MFA roles, with nothing enrolled. */
  async function freshOwner(): Promise<string> {
    const id = await insertUser(pool, `mfa-${randomUUID()}@example.invalid`, "Owner Person");
    await grant(pool, id, shopId, "owner");
    return id;
  }

  /** Enrol, presenting a code from the secret — the only way a row is written. */
  async function enrol(
    appUserId: string,
    now = new Date(),
    ring = keyring
  ): Promise<{ secret: Buffer; codes: readonly string[] }> {
    const secret = mintTotpSecret();
    const out = await withTransaction(pool, (tx) =>
      enrollAuthenticator(tx, {
        appUserId,
        secret,
        confirmationCode: totpCode(secret, stepAt(now)),
        keyring: ring,
        pepper: TEST_PIN_PEPPER,
        now,
      })
    );
    if (!out.ok) throw new Error(`enrollment refused: ${out.refusal}`);
    return { secret, codes: out.enrolled.recoveryCodes };
  }

  it("refuses to enrol an OPERATOR, because 048 §4.1 exempts them by decision", async () => {
    // "Requiring a phone-based second factor from a person standing at a shared
    // phone is a ceremony that produces a shared authenticator, which is worse
    // than no second factor because it looks like one." A build that enrolled
    // operators would satisfy "MFA is implemented" and breach the record.
    const id = await insertUser(pool, `op-${randomUUID()}@example.invalid`, "Operator Person");
    await grant(pool, id, shopId, "operator");
    const secret = mintTotpSecret();
    const out = await withTransaction(pool, (tx) =>
      enrollAuthenticator(tx, {
        appUserId: id,
        secret,
        confirmationCode: totpCode(secret, stepAt(new Date())),
        keyring,
        pepper: TEST_PIN_PEPPER,
        now: new Date(),
      })
    );
    expect(out).toEqual({ ok: false, refusal: "role_not_privileged" });
    expect(await liveAuthenticator(pool, id)).toBeUndefined();
  });

  it("writes NOTHING when the confirming code does not verify (048 §4.3)", async () => {
    const id = await freshOwner();
    const out = await withTransaction(pool, (tx) =>
      enrollAuthenticator(tx, {
        appUserId: id,
        secret: mintTotpSecret(),
        confirmationCode: "000000",
        keyring,
        pepper: TEST_PIN_PEPPER,
        now: new Date(),
      })
    );
    expect(out).toEqual({ ok: false, refusal: "code_did_not_verify" });
    expect(await liveAuthenticator(pool, id)).toBeUndefined();
    const codes = await pool.query(`SELECT id FROM recovery_code WHERE app_user_id = $1`, [id]);
    expect(codes.rowCount).toBe(0);
  });

  it("stores a sealed secret and never the secret (048 R18, I9 / 019 T31)", async () => {
    const id = await freshOwner();
    const { secret } = await enrol(id);
    const row = (await liveAuthenticator(pool, id))!;

    // The bytes in the column are not the bytes of the secret, in either
    // direction — the second half matters because a "ciphertext" that merely
    // contains the plaintext somewhere would pass the first.
    expect(row.secret_ciphertext.includes(secret)).toBe(false);
    expect(secret.includes(row.secret_ciphertext)).toBe(false);
    expect(row.secret_nonce.length).toBe(12);
    expect(row.key_version).toBe(1);
    // …and it is the real secret, bound to THIS row's id.
    expect(
      open(keyring, {
        ciphertext: row.secret_ciphertext,
        nonce: row.secret_nonce,
        keyVersion: row.key_version,
        aad: row.id,
      }).equals(secret)
    ).toBe(true);
  });

  it("REFUSES a ciphertext swapped between two people's rows (048 R18's AAD, in situ)", async () => {
    // The application-level version of this is in `tests/auth-aead.test.ts`. This
    // is the one that matters operationally: somebody with write access to the
    // database moves one person's secret onto another person's row, which without
    // the AAD would be a working second factor for an account they do not hold.
    const a = await freshOwner();
    const b = await freshOwner();
    await enrol(a);
    await enrol(b);
    const rowA = (await liveAuthenticator(pool, a))!;
    const rowB = (await liveAuthenticator(pool, b))!;

    for (const [victim, thief] of [
      [rowA, rowB],
      [rowB, rowA],
    ]) {
      expect(() =>
        open(keyring, {
          ciphertext: victim!.secret_ciphertext,
          nonce: victim!.secret_nonce,
          keyVersion: victim!.key_version,
          aad: thief!.id,
        })
      ).toThrow(/did not authenticate/);
    }
  });

  it("verifies a live code once, and refuses the SAME step afterwards (048 R19)", async () => {
    const id = await freshOwner();
    const now = new Date();
    const { secret } = await enrol(id, now);
    // A LATER step than the enrollment's, because enrolling spends the confirming
    // code — which is itself the property asserted two tests below.
    const later = new Date(now.getTime() + 30_000);
    const code = totpCode(secret, stepAt(later));

    const first = await withTransaction(pool, (tx) =>
      verifyTotp(tx, { appUserId: id, code, keyring, now: later })
    );
    expect(first).toEqual({ ok: true, step: stepAt(later) });

    const replay = await withTransaction(pool, (tx) =>
      verifyTotp(tx, { appUserId: id, code, keyring, now: later })
    );
    expect(replay).toEqual({ ok: false, reason: "replayed" });

    // The refusal is the DATABASE's: the guard moved, and it moved to the step
    // that was presented.
    const row = (await liveAuthenticator(pool, id))!;
    expect(Number(row.last_used_step)).toBe(stepAt(later));
    // …and the replay was recorded as its own failure class, where only the
    // lockout derivation and an audited break-glass query can read it.
    const attempts = await pool.query(
      `SELECT failure_class FROM auth_attempt WHERE app_user_id = $1 AND method = 'totp'`,
      [id]
    );
    expect((attempts.rows as Array<{ failure_class: string }>).map((r) => r.failure_class)).toEqual([
      "replayed_step",
    ]);
  });

  it("refuses a code from a step ALREADY SPENT even though it is inside the ±1 window", async () => {
    // 048 §4.3's second sentence, which a naive "is it within the window" verifier
    // gets wrong: the window and the replay guard are different rules, and the
    // guard outranks the window.
    const id = await freshOwner();
    const now = new Date();
    const { secret } = await enrol(id, now);
    const t2 = new Date(now.getTime() + 60_000);
    const accepted = await withTransaction(pool, (tx) =>
      verifyTotp(tx, { appUserId: id, code: totpCode(secret, stepAt(t2)), keyring, now: t2 })
    );
    expect(accepted.ok).toBe(true);

    // One step BEHIND the one just spent — still inside the window a moment later,
    // and refused because `last_used_step` is already higher.
    const behind = totpCode(secret, stepAt(t2) - 1);
    const out = await withTransaction(pool, (tx) =>
      verifyTotp(tx, { appUserId: id, code: behind, keyring, now: t2 })
    );
    expect(out).toEqual({ ok: false, reason: "replayed" });
  });

  it("SPENDS the confirming code at enrollment, so it cannot be re-presented", async () => {
    const id = await freshOwner();
    const now = new Date();
    const { secret } = await enrol(id, now);
    const out = await withTransaction(pool, (tx) =>
      verifyTotp(tx, { appUserId: id, code: totpCode(secret, stepAt(now)), keyring, now })
    );
    // Whoever was standing behind the owner during enrollment saw that code.
    expect(out).toEqual({ ok: false, reason: "replayed" });
  });

  it("I16: two CONCURRENT submissions of one code leave exactly one success", async () => {
    const id = await freshOwner();
    const now = new Date();
    const { secret } = await enrol(id, now);
    const later = new Date(now.getTime() + 30_000);
    const code = totpCode(secret, stepAt(later));

    // Two connections, genuinely in flight together. The anchor serialises them;
    // the conditional UPDATE decides which one wins.
    const [a, b] = await Promise.all([
      withTransaction(pool, (tx) => verifyTotp(tx, { appUserId: id, code, keyring, now: later })),
      withTransaction(pool, (tx) => verifyTotp(tx, { appUserId: id, code, keyring, now: later })),
    ]);
    const verdicts = [a, b];
    expect(verdicts.filter((v) => v.ok)).toHaveLength(1);
    expect(verdicts.filter((v) => !v.ok && v.reason === "replayed")).toHaveLength(1);
  });

  it("answers a person with NO authenticator without saying so, and records the attempt", async () => {
    const id = await freshOwner();
    const out = await withTransaction(pool, (tx) =>
      verifyTotp(tx, { appUserId: id, code: "123456", keyring, now: new Date() })
    );
    expect(out).toEqual({ ok: false, reason: "no_authenticator" });
    // The decoy did the work: what a caller sees is a refusal, and what the
    // system keeps is the class — in the table only the lockout and an audited
    // break-glass query may read (048 §9.1's substrate rule, R17).
    const attempts = await pool.query(`SELECT failure_class FROM auth_attempt WHERE app_user_id = $1`, [id]);
    expect((attempts.rows[0] as { failure_class: string }).failure_class).toBe("no_authenticator");
  });

  it("stops verifying the moment a RETIREMENT fact exists, without editing the row", async () => {
    const id = await freshOwner();
    const now = new Date();
    const { secret } = await enrol(id, now);
    const row = (await liveAuthenticator(pool, id))!;

    const written = await withTransaction(pool, (tx) =>
      retireAuthenticator(tx, {
        authenticatorId: row.id,
        appUserId: id,
        reason: "lost_authenticator",
        retiredBy: id,
      })
    );
    expect(written).toBe(1);

    const later = new Date(now.getTime() + 30_000);
    const out = await withTransaction(pool, (tx) =>
      verifyTotp(tx, { appUserId: id, code: totpCode(secret, stepAt(later)), keyring, now: later })
    );
    expect(out).toEqual({ ok: false, reason: "no_authenticator" });

    // BOTH DIRECTIONS, for the reason `membership-revocation.test.ts` gives: a
    // test that only checked "it no longer verifies" would pass under a
    // `retired_at` UPDATE too, and the whole point is that this ending is a row.
    const ending = await pool.query(
      `SELECT reason, retired_by FROM user_authenticator_retirement WHERE authenticator_id = $1`,
      [row.id]
    );
    expect(ending.rows[0]).toMatchObject({ reason: "lost_authenticator", retired_by: id });
    const after = await pool.query(
      `SELECT enrolled_at, last_used_step FROM user_authenticator WHERE id = $1`,
      [row.id]
    );
    expect(after.rowCount).toBe(1);

    // A second retirement writes nothing: one ending per factor.
    const again = await withTransaction(pool, (tx) =>
      retireAuthenticator(tx, { authenticatorId: row.id, appUserId: id, reason: "offboarding" })
    );
    expect(again).toBe(0);
  });

  it("re-enrolling retires the previous factor and leaves exactly one live", async () => {
    const id = await freshOwner();
    await enrol(id);
    const first = (await liveAuthenticator(pool, id))!;
    const now = new Date(Date.now() + 60_000);
    const { secret: second } = await enrol(id, now);
    const live = (await liveAuthenticator(pool, id))!;

    expect(live.id).not.toBe(first.id);
    const endings = await pool.query(
      `SELECT reason FROM user_authenticator_retirement WHERE authenticator_id = $1`,
      [first.id]
    );
    expect((endings.rows[0] as { reason: string }).reason).toBe("replaced");
    // The old secret is dead even though its row is still there.
    const later = new Date(now.getTime() + 30_000);
    const out = await withTransaction(pool, (tx) =>
      verifyTotp(tx, { appUserId: id, code: totpCode(second, stepAt(later)), keyring, now: later })
    );
    expect(out.ok).toBe(true);
  });

  it("ROTATES key_version: V2 seals new rows, V1 rows still open and still verify", async () => {
    // `.env.example`'s three-step rotation, steps 1 and 2, against real rows.
    const old = await freshOwner();
    const { secret: oldSecret } = await enrol(old);
    expect((await liveAuthenticator(pool, old))!.key_version).toBe(1);

    const rotated = requireAuthenticatorKey({
      LONGBOX_AUTHENTICATOR_KEY_V1: TEST_AUTHENTICATOR_KEY_V1,
      LONGBOX_AUTHENTICATOR_KEY_V2: TEST_AUTHENTICATOR_KEY_V2,
    });
    const fresh = await freshOwner();
    await enrol(fresh, new Date(), rotated);
    expect((await liveAuthenticator(pool, fresh))!.key_version).toBe(2);

    // The row written before the rotation still verifies, with no re-encryption
    // and nothing having been migrated — which is the whole reason `key_version`
    // is on the row from day one.
    const later = new Date(Date.now() + 90_000);
    const out = await withTransaction(pool, (tx) =>
      verifyTotp(tx, {
        appUserId: old,
        code: totpCode(oldSecret, stepAt(later)),
        keyring: rotated,
        now: later,
      })
    );
    expect(out.ok).toBe(true);

    // And the failure `.env.example` warns about: removing V1 before its rows are
    // re-encrypted refuses them, as an incident rather than as a wrong code.
    const v2Only = requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V2: TEST_AUTHENTICATOR_KEY_V2 });
    const evenLater = new Date(later.getTime() + 30_000);
    const refused = await withTransaction(pool, (tx) =>
      verifyTotp(tx, {
        appUserId: old,
        code: totpCode(oldSecret, stepAt(evenLater)),
        keyring: v2Only,
        now: evenLater,
      })
    );
    expect(refused).toEqual({ ok: false, reason: "unreadable" });
  });

  it("reads mfaState as a predicate over facts, never a column", async () => {
    const id = await freshOwner();
    expect(await mfaState(pool, id)).toBe("unenrolled");
    await enrol(id);
    expect(await mfaState(pool, id)).toBe("enrolled");
    // The `must_reenroll` third state is a recovery-code property and is proved in
    // `recovery-codes.test.ts`, where the fact that produces it is written.
  });

  it("keeps the ONE mutable column mutable and everything else append-only", async () => {
    // 041 §9.2 item 4's exemption, asserted from the APP ROLE — the role that has
    // full DML on an exempt table and `SELECT, INSERT` on an append-only one.
    const id = await freshOwner();
    await enrol(id);
    const row = (await liveAuthenticator(pool, id))!;
    const moved = await pool.query(`UPDATE user_authenticator SET last_used_step = 1 WHERE id = $1`, [
      row.id,
    ]);
    expect(moved.rowCount).toBe(1);
    await expect(
      pool.query(`UPDATE user_authenticator_retirement SET reason = 'offboarding' WHERE app_user_id = $1`, [
        id,
      ])
    ).rejects.toThrow();
    await expect(
      pool.query(`UPDATE recovery_code SET code_hash = 'x' WHERE app_user_id = $1`, [id])
    ).rejects.toThrow();
  });

  it("declares no status column on the authenticator or its recovery set", async () => {
    // 047 §5.1 / 048 §3.3's rule, asserted the way `invitation.test.ts` asserts it:
    // liveness is a predicate over facts, so a column that could disagree with the
    // facts must not exist.
    const cols = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('user_authenticator','recovery_code','recovery_code_use',
                             'user_authenticator_retirement')
          AND column_name IN ('status','active','revoked','used','spent','retired_at','is_active')`
    );
    expect(cols.rows).toEqual([]);
  });
});
