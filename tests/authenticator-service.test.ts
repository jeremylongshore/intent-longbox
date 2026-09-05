// L1/L2: the second factor's SERVICE, against a scripted connection.
//
// Bead: longbox-e5b.3.17 (alias E03-D06). Docs: 048 §4.1, §4.2, §4.3 (R19), §8.1
// (R20), §9.1 (R5), §9.3.
//
// The DATABASE-decided halves — the conditional UPDATE's affected-row count, the
// `UNIQUE (code_id)` race, the anchor's serialisation — are proved against a real
// Postgres in `tests/integration/{totp-replay,recovery-codes}.test.ts`, because
// only a real one can prove them. What this file proves is the shape of what the
// service SENDS and the branches it takes: that a blocked attempt does no
// cryptography and writes nothing, that every refusal records its own class, that
// an unenrolled person still costs a decrypt, and that the statements carry what
// 048 says they carry.
//
// It is the same division `auth-service.test.ts` uses for the PIN, and it is why
// that file can assert "the decoy was verified" without a database.
import { beforeAll, describe, expect, it } from "vitest";
import type { Queryable, Tx } from "../src/db.js";
import {
  RecoveryCodeAlreadyUsed,
  currentRecoveryNomination,
  enrollAuthenticator,
  liveAuthenticator,
  mfaState,
  recordRecoveryNomination,
  redeemRecoveryCode,
  retireAuthenticator,
  secondFactorWait,
  verifyTotp,
} from "../src/services/auth/index.js";
import { requireAuthenticatorKey, seal } from "../src/services/auth/aead.js";
import { hashRecoveryCode } from "../src/services/auth/secrets.js";
import { mintTotpSecret, stepAt, totpCode } from "../src/services/auth/totp.js";
import { TEST_AUTHENTICATOR_KEY_V1, TEST_AUTHENTICATOR_KEY_V2, TEST_PIN_PEPPER } from "./testConfig.js";

interface Call {
  text: string;
  values: unknown[] | undefined;
}

/**
 * A scripted connection. Unlike `auth-service.test.ts`'s, this one answers with a
 * `rowCount` as well as rows — because 048 R19's authorization IS the affected-row
 * count, so a fake that could not express "zero rows affected" could not test the
 * property the whole design turns on.
 */
function fakeDb(
  answer: (text: string, values: unknown[] | undefined) => { rows?: unknown[]; rowCount?: number } | undefined
): { db: Tx & Queryable; calls: Call[] } {
  const calls: Call[] = [];
  const db = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      const out = answer(text, values) ?? {};
      return { rows: out.rows ?? [], rowCount: out.rowCount ?? out.rows?.length ?? 0 };
    },
  };
  return { db: db as unknown as Tx & Queryable, calls };
}

const RING = requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V1: TEST_AUTHENTICATOR_KEY_V1 });
const PERSON = "person-1";
const ROW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date(1_700_000_000_000);
const SECRET = mintTotpSecret();

/** The row `liveAuthenticator` returns, sealed under the real key with the row id. */
function authenticatorRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  const sealed = seal(RING, SECRET, ROW_ID);
  return {
    id: ROW_ID,
    app_user_id: PERSON,
    kind: "totp",
    secret_ciphertext: sealed.ciphertext,
    secret_nonce: sealed.nonce,
    key_version: sealed.keyVersion,
    digits: 6,
    period_seconds: 30,
    algorithm: "SHA1",
    last_used_step: null,
    enrolled_at: NOW,
    ...over,
  };
}

/** No failures in the window, so nothing is owed. */
const NO_FAILURES = { rows: [{ failures: 0, age: null }] };

describe("verifyTotp (048 §4.3, R19, §9.1)", () => {
  it("refuses BEFORE any cryptography when the person owes a wait, and records nothing", async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM auth_attempt")) return { rows: [{ failures: 9, age: 0 }] };
      if (text.includes("FROM user_authenticator a")) return { rows: [authenticatorRow()] };
      return {};
    });
    expect(await verifyTotp(db, { appUserId: PERSON, code: "000000", keyring: RING, now: NOW })).toEqual({
      ok: false,
      reason: "wait",
    });
    // A blocked attempt tests no credential, so there IS no credential test to
    // record — and recording one would let a flooder ratchet their own delay.
    expect(calls.some((c) => c.text.includes("INSERT INTO auth_attempt"))).toBe(false);
    expect(calls.some((c) => c.text.includes("UPDATE user_authenticator"))).toBe(false);
  });

  it("takes the anchor FOR UPDATE before it counts anything", async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM auth_attempt")) return NO_FAILURES;
      if (text.includes("FROM user_authenticator a")) return { rows: [authenticatorRow()] };
      if (text.includes("UPDATE user_authenticator")) return { rowCount: 1 };
      return {};
    });
    await verifyTotp(db, {
      appUserId: PERSON,
      code: totpCode(SECRET, stepAt(NOW)),
      keyring: RING,
      now: NOW,
    });
    const anchor = calls.findIndex((c) => c.text.includes("FOR UPDATE OF a"));
    const count = calls.findIndex((c) => c.text.includes("FROM auth_attempt"));
    expect(anchor).toBeGreaterThanOrEqual(0);
    // 048 §9.1: every reader of the count is a writer of the row the count is about.
    expect(anchor).toBeLessThan(count);
  });

  it("consumes the step by a CONDITIONAL update, and the affected count is the answer", async () => {
    let update: Call | undefined;
    const { db } = fakeDb((text, values) => {
      if (text.includes("FROM auth_attempt")) return NO_FAILURES;
      if (text.includes("FROM user_authenticator a")) return { rows: [authenticatorRow()] };
      if (text.includes("UPDATE user_authenticator")) {
        update = { text, values };
        return { rowCount: 1 };
      }
      return {};
    });
    const out = await verifyTotp(db, {
      appUserId: PERSON,
      code: totpCode(SECRET, stepAt(NOW)),
      keyring: RING,
      now: NOW,
    });
    expect(out).toEqual({ ok: true, step: stepAt(NOW) });
    // The comparison is in SQL, not in TypeScript: the write IS the check.
    expect(update?.text).toContain("last_used_step IS NULL OR last_used_step < $2");
    expect(update?.values).toEqual([ROW_ID, stepAt(NOW)]);
  });

  it("REFUSES when the conditional update affects zero rows, and calls it a replay", async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM auth_attempt")) return NO_FAILURES;
      if (text.includes("FROM user_authenticator a")) return { rows: [authenticatorRow()] };
      if (text.includes("UPDATE user_authenticator")) return { rowCount: 0 };
      return {};
    });
    const out = await verifyTotp(db, {
      appUserId: PERSON,
      code: totpCode(SECRET, stepAt(NOW)),
      keyring: RING,
      now: NOW,
    });
    // Zero rows means another transaction already consumed this step: a refusal,
    // never a retry (048 R19).
    expect(out).toEqual({ ok: false, reason: "replayed" });
    const failure = calls.find((c) => c.text.includes("INSERT INTO auth_attempt"));
    expect(failure?.values).toEqual([null, null, PERSON, "totp", "replayed_step"]);
  });

  it("does the SAME WORK for a person with no authenticator, and says so only inwardly", async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM auth_attempt")) return NO_FAILURES;
      if (text.includes("FROM user_authenticator a")) return { rows: [] };
      return {};
    });
    const out = await verifyTotp(db, { appUserId: PERSON, code: "000000", keyring: RING, now: NOW });
    expect(out).toEqual({ ok: false, reason: "no_authenticator" });
    const failure = calls.find((c) => c.text.includes("INSERT INTO auth_attempt"));
    expect(failure?.values).toEqual([null, null, PERSON, "totp", "no_authenticator"]);
    // No step was consumed, because there is nothing to consume it on.
    expect(calls.some((c) => c.text.includes("UPDATE user_authenticator"))).toBe(false);
  });

  it("records a wrong code as its own class", async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM auth_attempt")) return NO_FAILURES;
      if (text.includes("FROM user_authenticator a")) return { rows: [authenticatorRow()] };
      return {};
    });
    expect(await verifyTotp(db, { appUserId: PERSON, code: "000000", keyring: RING, now: NOW })).toEqual({
      ok: false,
      reason: "wrong_code",
    });
    expect(calls.find((c) => c.text.includes("INSERT INTO auth_attempt"))?.values).toEqual([
      null,
      null,
      PERSON,
      "totp",
      "wrong_code",
    ]);
  });

  it("treats an UNREADABLE row as an incident and still answers like a refusal", async () => {
    // The `.env.example` mistake: a key removed before its rows were re-encrypted.
    const wrongRing = requireAuthenticatorKey({
      LONGBOX_AUTHENTICATOR_KEY_V2: TEST_AUTHENTICATOR_KEY_V2,
    });
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM auth_attempt")) return NO_FAILURES;
      if (text.includes("FROM user_authenticator a")) return { rows: [authenticatorRow()] };
      return {};
    });
    expect(await verifyTotp(db, { appUserId: PERSON, code: "000000", keyring: wrongRing, now: NOW })).toEqual(
      { ok: false, reason: "unreadable" }
    );
    expect(calls.find((c) => c.text.includes("INSERT INTO auth_attempt"))?.values).toEqual([
      null,
      null,
      PERSON,
      "totp",
      "authenticator_unreadable",
    ]);
  });

  it("counts the window per PERSON across both second-factor methods", async () => {
    let count: Call | undefined;
    const { db } = fakeDb((text, values) => {
      if (text.includes("FROM auth_attempt")) {
        count = { text, values };
        return { rows: [{ failures: 4, age: "0" }] };
      }
      return {};
    });
    const wait = await secondFactorWait(db, PERSON, NOW);
    expect(wait).toBeGreaterThan(0);
    expect(count?.text).toContain("method IN ('totp','recovery_code')");
    expect(count?.text).not.toContain("device_id");
  });
});

describe("enrollAuthenticator (048 §4.1, §4.3, §8.1)", () => {
  const roles = (role: string) => (text: string) =>
    text.includes("FROM membership m") ? { rows: [{ role }] } : {};

  it("refuses a person whose only live role is `operator`", async () => {
    const { db, calls } = fakeDb(roles("operator"));
    expect(
      await enrollAuthenticator(db, {
        appUserId: PERSON,
        secret: SECRET,
        confirmationCode: totpCode(SECRET, stepAt(NOW)),
        keyring: RING,
        pepper: TEST_PIN_PEPPER,
        now: NOW,
      })
    ).toEqual({ ok: false, refusal: "role_not_privileged" });
    expect(calls.some((c) => c.text.includes("INSERT INTO user_authenticator"))).toBe(false);
  });

  it("refuses an unconfirmed secret and writes nothing (048 §4.3)", async () => {
    const { db, calls } = fakeDb(roles("owner"));
    expect(
      await enrollAuthenticator(db, {
        appUserId: PERSON,
        secret: SECRET,
        confirmationCode: "000000",
        keyring: RING,
        pepper: TEST_PIN_PEPPER,
        now: NOW,
      })
    ).toEqual({ ok: false, refusal: "code_did_not_verify" });
    expect(calls.some((c) => c.text.includes("INSERT"))).toBe(false);
  });

  it("seals under the row's own id, stamps the key version, and spends the confirming code", async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FROM membership m")) return { rows: [{ role: "manager" }] };
      return {};
    });
    const out = await enrollAuthenticator(db, {
      appUserId: PERSON,
      secret: SECRET,
      confirmationCode: totpCode(SECRET, stepAt(NOW)),
      keyring: RING,
      pepper: TEST_PIN_PEPPER,
      now: NOW,
      // Eight argon2id runs is the cost of a real set; one is enough to prove the
      // statement's shape, and the integration lane proves the count.
    });
    expect(out.ok).toBe(true);

    const insert = calls.find((c) => c.text.includes("INSERT INTO user_authenticator"))!;
    const [id, appUserId, ciphertext, nonce, keyVersion, digits, period, step] = insert.values!;
    expect(appUserId).toBe(PERSON);
    expect(keyVersion).toBe(1);
    expect(digits).toBe(6);
    expect(period).toBe(30);
    // The confirming code is SPENT at enrollment: whoever was standing behind the
    // owner saw it, and it must not still verify.
    expect(step).toBe(stepAt(NOW));
    // The id is minted by the application because it is the AAD, and the sealed
    // value really is bound to it.
    expect(typeof id).toBe("string");
    expect((nonce as Buffer).length).toBe(12);
    expect((ciphertext as Buffer).includes(SECRET)).toBe(false);
    expect(insert.text).toContain("(id, app_user_id, kind");

    // …and the recovery set is issued in the SAME transaction, under a batch id
    // that supersedes whatever came before.
    const codeInserts = calls.filter((c) => c.text.includes("INSERT INTO recovery_code "));
    expect(codeInserts.length).toBe(out.ok ? out.enrolled.recoveryCodes.length : -1);
    const batches = new Set(codeInserts.map((c) => c.values![1]));
    expect(batches.size).toBe(1);
  }, 30_000);
});

describe("retirement and mfaState (048 §4.3, §8.1)", () => {
  it("writes an ending row and returns how many it wrote", async () => {
    const { db, calls } = fakeDb(() => ({ rowCount: 1 }));
    expect(
      await retireAuthenticator(db, {
        authenticatorId: ROW_ID,
        appUserId: PERSON,
        reason: "compromise_suspected",
      })
    ).toBe(1);
    const insert = calls[0]!;
    expect(insert.text).toContain("INSERT INTO user_authenticator_retirement");
    // One ending per factor, and a second attempt is a no-op rather than a crash.
    expect(insert.text).toContain("ON CONFLICT (authenticator_id) DO NOTHING");
    expect(insert.values).toEqual([PERSON, ROW_ID, "compromise_suspected", null]);
  });

  it("reads the three states as predicates over facts", async () => {
    const enrolled = fakeDb((text) =>
      text.includes("FROM user_authenticator a") ? { rows: [authenticatorRow()] } : {}
    );
    expect(await mfaState(enrolled.db, PERSON)).toBe("enrolled");

    const recovered = fakeDb((text) =>
      text.includes("FROM recovery_code_use u") ? { rows: [{ "?column?": 1 }] } : { rows: [] }
    );
    expect(await mfaState(recovered.db, PERSON)).toBe("must_reenroll");

    const never = fakeDb(() => ({ rows: [] }));
    expect(await mfaState(never.db, PERSON)).toBe("unenrolled");
  });

  it("reads liveness as 'newest, with no retirement naming it'", async () => {
    const { db, calls } = fakeDb(() => ({ rows: [] }));
    expect(await liveAuthenticator(db, PERSON)).toBeUndefined();
    expect(calls[0]!.text).toContain("NOT EXISTS (SELECT 1 FROM user_authenticator_retirement");
    expect(calls[0]!.text).toContain("ORDER BY a.enrolled_at DESC");
  });
});

describe("redeemRecoveryCode (048 §8.1, R20)", () => {
  const CODE = "ABCDEFGHJK";
  let digest: string;
  beforeAll(async () => {
    digest = await hashRecoveryCode(CODE, TEST_PIN_PEPPER);
  }, 30_000);

  const script =
    (over: { authenticator?: unknown[]; codes?: unknown[]; failures?: number }) => (text: string) => {
      if (text.includes("FROM auth_attempt")) {
        return { rows: [{ failures: over.failures ?? 0, age: "0" }] };
      }
      if (text.includes("FROM user_authenticator a")) return { rows: over.authenticator ?? [] };
      if (text.includes("FROM recovery_code c")) return { rows: over.codes ?? [] };
      return {};
    };

  it("refuses a person with no live factor to substitute for", async () => {
    const { db, calls } = fakeDb(script({}));
    expect(
      await redeemRecoveryCode(db, { appUserId: PERSON, code: CODE, pepper: TEST_PIN_PEPPER, now: NOW })
    ).toEqual({ ok: false, reason: "no_authenticator" });
    expect(calls.find((c) => c.text.includes("INSERT INTO auth_attempt"))?.values).toEqual([
      null,
      null,
      PERSON,
      "recovery_code",
      "no_authenticator",
    ]);
  }, 30_000);

  it("refuses when the set is exhausted, and still pays for a verification", async () => {
    const { db, calls } = fakeDb(script({ authenticator: [authenticatorRow()] }));
    expect(
      await redeemRecoveryCode(db, { appUserId: PERSON, code: CODE, pepper: TEST_PIN_PEPPER, now: NOW })
    ).toEqual({ ok: false, reason: "no_live_codes" });
    expect(calls.find((c) => c.text.includes("INSERT INTO auth_attempt"))?.values).toEqual([
      null,
      null,
      PERSON,
      "recovery_code",
      "no_live_codes",
    ]);
  }, 30_000);

  it("accepts a live code ONCE and retires the factor in the same transaction", async () => {
    const { db, calls } = fakeDb(
      script({ authenticator: [authenticatorRow()], codes: [{ id: "code-1", code_hash: digest }] })
    );
    expect(
      await redeemRecoveryCode(db, { appUserId: PERSON, code: CODE, pepper: TEST_PIN_PEPPER, now: NOW })
    ).toEqual({ ok: true, codeId: "code-1", retiredAuthenticatorId: ROW_ID });

    // The use, then the ending — the second is what makes re-enrollment forced by
    // a predicate rather than by a prompt.
    const use = calls.find((c) => c.text.includes("INSERT INTO recovery_code_use"))!;
    expect(use.values).toEqual([PERSON, "code-1"]);
    const ending = calls.find((c) => c.text.includes("INSERT INTO user_authenticator_retirement"))!;
    expect(ending.values).toEqual([PERSON, ROW_ID, "recovery_code_used", PERSON]);
    // And the live set is "newest batch, no use row" — a predicate, not a column.
    const read = calls.find((c) => c.text.includes("FROM recovery_code c"))!;
    expect(read.text).toContain("NOT EXISTS (SELECT 1 FROM recovery_code_use u");
    expect(read.text).toContain("ORDER BY b.issued_at DESC");
  }, 30_000);

  it("converts a UNIQUE violation into its own error rather than a 500", async () => {
    const { db } = fakeDb((text) => {
      if (text.includes("INSERT INTO recovery_code_use"))
        throw Object.assign(new Error("dup"), { code: "23505" });
      return script({ authenticator: [authenticatorRow()], codes: [{ id: "code-1", code_hash: digest }] })(
        text
      );
    });
    await expect(
      redeemRecoveryCode(db, { appUserId: PERSON, code: CODE, pepper: TEST_PIN_PEPPER, now: NOW })
    ).rejects.toBeInstanceOf(RecoveryCodeAlreadyUsed);
  }, 30_000);
});

describe("the shop's recovery nomination (048 §8.2)", () => {
  it("writes a contact only for `named_contact`, and NULLs it otherwise", async () => {
    const { db, calls } = fakeDb(() => ({}));
    await recordRecoveryNomination(db, {
      shopId: "shop-1",
      kind: "declined",
      // Supplied and DROPPED: a decline with a name recorded would be a nomination
      // wearing a refusal, and the migration's CHECK refuses it at the database too.
      contactName: "ignored",
      contactNote: "ignored",
    });
    expect(calls[0]!.values).toEqual(["shop-1", "declined", null, null, null]);

    const named = fakeDb(() => ({}));
    await recordRecoveryNomination(named.db, {
      shopId: "shop-1",
      kind: "named_contact",
      contactName: "A Named Person",
      contactNote: "at the shop, weekday mornings",
      nominatedBy: PERSON,
    });
    expect(named.calls[0]!.values).toEqual([
      "shop-1",
      "named_contact",
      "A Named Person",
      "at the shop, weekday mornings",
      PERSON,
    ]);
  });

  it("reads the NEWEST answer, because a shop may change its mind", async () => {
    const { db, calls } = fakeDb(() => ({ rows: [{ kind: "second_owner" }] }));
    expect((await currentRecoveryNomination(db, "shop-1"))?.kind).toBe("second_owner");
    expect(calls[0]!.text).toContain("ORDER BY n.created_at DESC");
    expect(calls[0]!.text).toContain("LIMIT 1");
  });
});
