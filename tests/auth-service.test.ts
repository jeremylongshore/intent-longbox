// L3 unit: the SQL the authentication service issues, and the shapes it refuses.
//
// The database-backed PROPERTIES — write skew, the rotation race, cross-chain
// liveness, the composite foreign keys — are proved against a real Postgres in
// `tests/integration/session-*.test.ts` and `operator-pin.test.ts`, because
// nothing else can prove them. What this suite proves is the other half, and it
// is not the same half: **which statement each function issues, in which order,
// with which parameters.**
//
// That distinction is why both exist. A fake connection cannot tell you whether
// `FOR NO KEY UPDATE` serialises two writers; it can tell you the clause is
// there, that the read is scoped, that a projection names its columns, and that
// the membership query is rooted at `membership` and not at `shop` — which is
// 048 R13's timing property expressed as a fact about the statement rather than
// as a stopwatch reading.
import { describe, expect, it } from "vitest";
import type { Queryable, Tx } from "../src/db.js";
import {
  PIN_PEPPER_ENV,
  PepperConfigError,
  chainHead,
  chainIsRevoked,
  issueDeviceSession,
  issueOperatorSession,
  liveMembershipShopIds,
  lockLiveSessionsOf,
  lockSession,
  membershipAt,
  mintDeviceCredential,
  mintToken,
  parentChainIsLive,
  readOperatorPin,
  readSessionById,
  recordFailure,
  requirePinPepper,
  resolveDeviceCredential,
  resolveToken,
  retireOperatorPins,
  revokeChain,
  revokeForReuse,
  revokeSessionsOf,
  setOperatorPin,
  shopRoster,
  tokenHash,
  verifyOperatorPin,
  type SessionRow,
} from "../src/services/auth/index.js";
import { TEST_PIN_PEPPER } from "./testConfig.js";

interface Call {
  text: string;
  values: unknown[] | undefined;
}

/** A connection whose answer to each statement is scripted by the test. */
function fakeDb(answer: (text: string, values: unknown[] | undefined) => unknown[] | undefined = () => []): {
  db: Tx & Queryable;
  calls: Call[];
} {
  const calls: Call[] = [];
  const db = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: answer(text, values) ?? [] };
    },
  };
  return { db: db as unknown as Tx & Queryable, calls };
}

const FUTURE = new Date(Date.now() + 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 60 * 1000);

function sessionRow(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    chain_id: "chain-1",
    kind: "operator",
    shop_id: "shop-1",
    location_id: "location-1",
    device_id: "device-1",
    device_credential_id: "credential-1",
    app_user_id: "person-1",
    parent_session_id: "device-session-1",
    parent_chain_id: "device-chain-1",
    issued_at: new Date(Date.now() - 60_000),
    rotate_after: FUTURE,
    idle_expires_at: FUTURE,
    absolute_expires_at: FUTURE,
    ...over,
  };
}

/** The liveness read's row shape: the session plus its three derived answers. */
function livenessRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...sessionRow(),
    chain_revoked: false,
    successor_id: null,
    successor_app_user_id: null,
    successor_device_id: null,
    successor_issued_at: null,
    ...over,
  };
}

describe("the liveness read (048 §3.3, R2)", () => {
  it("looks the session up by TOKEN HASH and never by the token", async () => {
    const { db, calls } = fakeDb(() => [livenessRow()]);
    const token = mintToken();
    await resolveToken(db, token, new Date());
    expect(calls[0]!.values).toEqual([tokenHash(token)]);
    // The token appears in no statement, ever: the database stores `sha256` of
    // it and the server never holds the value after the response that set it.
    expect(calls[0]!.text).not.toContain(token);
    expect(calls[0]!.values).not.toContain(token);
  });

  it("asks for the revocation and the successor in the SAME statement", async () => {
    const { db, calls } = fakeDb(() => [livenessRow()]);
    await resolveToken(db, "t", new Date());
    // ONE indexed read plus two indexed probes, in one round trip. Two
    // statements would be two round trips on the hot path of every request, and
    // a walk would be one per rotation the chain has ever done.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toContain("app_session_revocation");
    expect(calls[0]!.text).toContain("LEFT JOIN app_session n ON n.rotated_from = s.id");
    expect(calls[0]!.text).not.toMatch(/RECURSIVE/i);
  });

  it("names its columns rather than starring the one table that decides who the caller is", () => {
    const { db, calls } = fakeDb(() => [livenessRow()]);
    return resolveToken(db, "t", new Date()).then(() => {
      expect(calls[0]!.text).not.toMatch(/SELECT\s+\*/i);
      expect(calls[0]!.text).toContain("s.token_hash");
    });
  });

  it("refuses an unknown token, a revoked chain and both expiries by name", async () => {
    const unknown = await resolveToken(fakeDb(() => []).db, "t", new Date());
    expect(unknown).toEqual({ refusal: "unknown_token" });

    const revoked = await resolveToken(
      fakeDb(() => [livenessRow({ chain_revoked: true })]).db,
      "t",
      new Date()
    );
    expect("refusal" in revoked && revoked.refusal).toBe("chain_revoked");

    const idle = await resolveToken(
      fakeDb(() => [livenessRow({ idle_expires_at: PAST })]).db,
      "t",
      new Date()
    );
    expect("refusal" in idle && idle.refusal).toBe("idle_expired");

    const absolute = await resolveToken(
      fakeDb(() => [livenessRow({ absolute_expires_at: PAST })]).db,
      "t",
      new Date()
    );
    expect("refusal" in absolute && absolute.refusal).toBe("absolutely_expired");
  });

  it("adopts the winner's successor inside the grace window, and re-reads it to check ITS timing", async () => {
    const successor = sessionRow({ id: "successor-1" });
    // A second ago, not "now": the fake answers when the statement runs, which
    // is AFTER the caller sampled its clock, and a successor dated in the FUTURE
    // is reuse by design — see the last case in `auth-policy.test.ts`.
    const justNow = new Date(Date.now() - 1_000);
    const { db, calls } = fakeDb((text) =>
      text.includes("token_hash")
        ? [
            livenessRow({
              successor_id: "successor-1",
              successor_app_user_id: "person-1",
              successor_device_id: "device-1",
              successor_issued_at: justNow,
            }),
          ]
        : [successor]
    );
    const out = await resolveToken(db, "t", new Date());
    expect("refusal" in out).toBe(false);
    if (!("refusal" in out)) {
      expect(out.adoptedSuccessor).toBe(true);
      expect(out.row.id).toBe("successor-1");
    }
    // The successor is re-read rather than assembled from the join's columns:
    // its OWN expiries decide whether it is live, and inferring them would be a
    // second liveness rule.
    expect(calls[1]!.text).toContain("FROM app_session WHERE id = $1");
  });

  it("calls a binding mismatch REUSE however fresh the successor is", async () => {
    const { db } = fakeDb(() => [
      livenessRow({
        successor_id: "successor-1",
        successor_app_user_id: "somebody-else",
        successor_device_id: "device-1",
        successor_issued_at: new Date(Date.now() - 1_000),
      }),
    ]);
    const out = await resolveToken(db, "t", new Date());
    expect("refusal" in out && out.refusal).toBe("token_reuse");
  });

  it("calls a vanished successor reuse rather than trusting the join", async () => {
    const { db } = fakeDb((text) =>
      text.includes("token_hash")
        ? [
            livenessRow({
              successor_id: "successor-1",
              successor_app_user_id: "person-1",
              successor_device_id: "device-1",
              successor_issued_at: new Date(Date.now() - 1_000),
            }),
          ]
        : []
    );
    const out = await resolveToken(db, "t", new Date());
    expect("refusal" in out && out.refusal).toBe("token_reuse");
  });
});

describe("the session lock and its position (048 §3.3(a), K1)", () => {
  it("takes FOR NO KEY UPDATE and not FOR UPDATE", async () => {
    const { db, calls } = fakeDb(() => [sessionRow()]);
    await lockSession(db, "session-1");
    // The weakest lock that serialises writers while permitting readers that
    // take no conflicting lock — and `FOR UPDATE` would block the foreign-key
    // checks that `rotated_from` and `parent_session_id` make against this row.
    expect(calls[0]!.text).toContain("FOR NO KEY UPDATE");
    expect(calls[0]!.text).not.toMatch(/FOR UPDATE\b/);
  });

  it("reads one session by id with a named projection", async () => {
    const { db, calls } = fakeDb(() => [sessionRow()]);
    await readSessionById(db, "session-1");
    expect(calls[0]!.values).toEqual(["session-1"]);
    expect(calls[0]!.text).not.toMatch(/SELECT\s+\*/i);
  });
});

describe("issuance (048 §3.5)", () => {
  it("mints a 256-bit token, stores only its hash, and returns the value ONCE", async () => {
    const { db, calls } = fakeDb(() => [sessionRow({ kind: "device" })]);
    const issued = await issueDeviceSession(db, {
      shopId: "shop-1",
      locationId: "location-1",
      deviceId: "device-1",
      deviceCredentialId: "credential-1",
      now: new Date(),
    });
    const values = calls[0]!.values!;
    expect(values).toContain(tokenHash(issued.token));
    expect(values).not.toContain(issued.token);
    // A device session has no person and no parent: the shape CHECK in the
    // migration refuses the alternative, and this is the writer agreeing.
    expect(values[6]).toBeNull();
    expect(values[7]).toBeNull();
    expect(values[8]).toBeNull();
  });

  it("DENORMALIZES the parent's shop and location onto the operator session", async () => {
    const parent = sessionRow({ kind: "device", shop_id: "shop-9", location_id: "location-9" });
    const { db, calls } = fakeDb(() => [sessionRow()]);
    await issueOperatorSession(db, { parent, appUserId: "person-1", now: new Date() });
    const values = calls[0]!.values!;
    // Immutable facts about an ISSUANCE, not a cache of a mutable elsewhere
    // (048 §3.5): a parent rotation is then harmless to tenancy resolution.
    expect(values[2]).toBe("shop-9");
    expect(values[3]).toBe("location-9");
    expect(values[8]).toBe(parent.chain_id);
    expect(values[7]).toBe(parent.id);
  });
});

describe("revocation (048 §3.3, K2)", () => {
  it("ends a chain idempotently, by constraint rather than by a prior read", async () => {
    const { db, calls } = fakeDb(() => []);
    await revokeChain(db, { chainId: "chain-1", shopId: "shop-1", reason: "signed_out" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.text).toContain("ON CONFLICT (chain_id) DO NOTHING");
  });

  it("revokes the OPERATOR chain when an operator token is reused", async () => {
    const { db, calls } = fakeDb(() => []);
    await revokeForReuse(db, sessionRow({ kind: "operator" }));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.values).toEqual(["shop-1", "chain-1", "token_reuse", null]);
  });

  it("leaves the DEVICE chain alone and revokes the operator chains above it", async () => {
    const { db, calls } = fakeDb((text) =>
      text.includes("SELECT DISTINCT") ? [{ chain_id: "op-chain-1", shop_id: "shop-1" }] : []
    );
    await revokeForReuse(db, sessionRow({ kind: "device", chain_id: "device-chain-1" }));
    // A false positive that signs out an operator costs one PIN; one that signs
    // out a DEVICE costs an owner, an enrollment code and a walk to the back
    // room, during trading hours.
    const revoked = calls.filter((c) => c.text.includes("INSERT INTO app_session_revocation"));
    expect(revoked).toHaveLength(1);
    expect(revoked[0]!.values).toEqual(["shop-1", "op-chain-1", "token_reuse", null]);
    expect(calls[0]!.text).toContain("parent_chain_id = $1");
  });

  it("locks every live session of a person in chain_id order before touching membership (K3)", async () => {
    const { db, calls } = fakeDb(() => [sessionRow()]);
    await lockLiveSessionsOf(db, "person-1");
    expect(calls[0]!.text).toContain("ORDER BY s.chain_id");
    expect(calls[0]!.text).toContain("FOR NO KEY UPDATE");
    // A fixed order makes a deadlock between two concurrent membership writes
    // UNCONSTRUCTIBLE rather than merely rare.
    expect(calls[0]!.text.indexOf("ORDER BY")).toBeLessThan(calls[0]!.text.indexOf("FOR NO KEY UPDATE"));
  });

  it("revokes every live chain of a person and reports how many", async () => {
    const { db, calls } = fakeDb((text) => (text.includes("FOR NO KEY UPDATE") ? [sessionRow()] : []));
    expect(await revokeSessionsOf(db, "person-1")).toBe(1);
    expect(calls[1]!.values).toEqual(["shop-1", "chain-1", "membership_change", null]);
  });
});

describe("the cross-chain closure (048 §3.5, K4)", () => {
  it("resolves the chain's CURRENT head, not the row the operator session names", async () => {
    const { db, calls } = fakeDb(() => [sessionRow()]);
    await chainHead(db, "device-chain-1");
    expect(calls[0]!.text).toContain("s.chain_id = $1");
    expect(calls[0]!.text).toContain("NOT EXISTS (SELECT 1 FROM app_session n WHERE n.rotated_from = s.id)");
  });

  it("is dead when the parent chain is revoked, missing or expired", async () => {
    const revoked = fakeDb((text) => (text.includes("app_session_revocation") ? [{ "?column?": 1 }] : []));
    expect(await parentChainIsLive(revoked.db, "chain-1", new Date())).toBe(false);

    const missing = fakeDb(() => []);
    expect(await parentChainIsLive(missing.db, "chain-1", new Date())).toBe(false);

    const expired = fakeDb((text) =>
      text.includes("app_session_revocation") ? [] : [sessionRow({ absolute_expires_at: PAST })]
    );
    expect(await parentChainIsLive(expired.db, "chain-1", new Date())).toBe(false);

    const live = fakeDb((text) => (text.includes("app_session_revocation") ? [] : [sessionRow()]));
    expect(await parentChainIsLive(live.db, "chain-1", new Date())).toBe(true);
  });

  it("answers `chainIsRevoked` from one indexed probe", async () => {
    const { db, calls } = fakeDb(() => [{ "?column?": 1 }]);
    expect(await chainIsRevoked(db, "chain-1")).toBe(true);
    expect(calls[0]!.values).toEqual(["chain-1"]);
  });
});

describe("the device credential (034 §2.8, 048 §7.3)", () => {
  it("looks a secret up by DIGEST and excludes a revoked credential in the same statement", async () => {
    const secret = mintToken();
    const { db, calls } = fakeDb(() => [
      {
        credential_id: "credential-1",
        device_id: "device-1",
        shop_id: "shop-1",
        location_id: "location-1",
        token_hash: tokenHash(secret),
      },
    ]);
    const row = await resolveDeviceCredential(db, secret);
    expect(row?.device_id).toBe("device-1");
    expect(calls[0]!.values).toEqual([tokenHash(secret)]);
    expect(calls[0]!.text).toContain("device_credential_revocation");
  });

  it("returns nothing for an unknown secret", async () => {
    const { db } = fakeDb(() => []);
    expect(await resolveDeviceCredential(db, "nope")).toBeUndefined();
  });

  it("mints a secret, stores its hash, and hands the value back once", async () => {
    const { db, calls } = fakeDb(() => [{ id: "credential-1" }]);
    const minted = await mintDeviceCredential(db, { shopId: "shop-1", deviceId: "device-1" });
    expect(calls[0]!.values).toEqual(["shop-1", "device-1", tokenHash(minted.secret), null]);
    expect(minted.secret).not.toBe(tokenHash(minted.secret));
  });
});

describe("tenancy resolution is MEMBERSHIP-FIRST (048 §6.1, R13)", () => {
  it("roots the query at membership and JOINS shop, never the other way round", async () => {
    const { db, calls } = fakeDb(() => [{ role: "operator", shop_id: "shop-1", location_id: null }]);
    await membershipAt(db, "person-1", "shop-1");
    const sql = calls[0]!.text;
    expect(sql).toContain("FROM membership m");
    expect(sql).toContain("JOIN shop s ON s.id = m.shop_id");
    // A shop the caller holds no membership at is a shop whose row this request
    // never loads — so there is no timing difference between "exists but not
    // yours" and "does not exist".
    expect(sql.indexOf("FROM membership")).toBeLessThan(sql.indexOf("JOIN shop"));
    expect(sql).toContain("membership_revocation");
  });

  it("returns the HIGHEST role held at the scope, and grants nothing by returning it", async () => {
    const { db } = fakeDb(() => [
      { role: "operator", shop_id: "shop-1", location_id: null },
      { role: "owner", shop_id: "shop-1", location_id: null },
    ]);
    expect(await membershipAt(db, "person-1", "shop-1")).toEqual({
      shopId: "shop-1",
      role: "owner",
      locationId: null,
    });
  });

  it("ranks support_break_glass BELOW owner, so it never becomes a super-admin by sort order", async () => {
    const { db } = fakeDb(() => [
      { role: "support_break_glass", shop_id: "shop-1", location_id: null },
      { role: "owner", shop_id: "shop-1", location_id: null },
    ]);
    const scope = await membershipAt(db, "person-1", "shop-1");
    expect(scope?.role).toBe("owner");
  });

  it("returns nothing when no live membership covers the pair", async () => {
    const { db } = fakeDb(() => []);
    expect(await membershipAt(db, "person-1", "shop-1")).toBeUndefined();
  });

  it("lists the shops a person holds, which is what *my shops* will read (E03-D08)", async () => {
    const { db, calls } = fakeDb(() => [{ shop_id: "shop-1" }, { shop_id: "shop-2" }]);
    expect(await liveMembershipShopIds(db, "person-1")).toEqual(["shop-1", "shop-2"]);
    expect(calls[0]!.text).toContain("SELECT DISTINCT m.shop_id");
  });
});

describe("the operator picker's payload (048 §3.5, I7)", () => {
  it("projects TWO columns and orders by a stable, activity-independent key", async () => {
    const { db, calls } = fakeDb(() => [{ id: "person-1", display_name: "A" }]);
    await shopRoster(db, "shop-1");
    const sql = calls[0]!.text;
    expect(sql).toContain("SELECT DISTINCT u.id, u.display_name");
    expect(sql).toContain("ORDER BY u.display_name, u.id");
    // A roster is a list of who could be holding the phone; a leaderboard is a
    // list of what they did, and the difference is one sort order.
    expect(sql).not.toMatch(/count\(|created_at|last_|ORDER BY .*(count|created_at)/i);
    // Break-glass is not staff and is never offered as a name to tap.
    expect(sql).toContain("m.role <> 'support_break_glass'");
  });
});

describe("the PIN (048 §3.5, §9.1, §9.2)", () => {
  const pair = { shopId: "shop-1", deviceId: "device-1", appUserId: "person-1" };

  it("refuses a trivial PIN before hashing anything", async () => {
    const { db, calls } = fakeDb(() => []);
    const out = await setOperatorPin(db, { ...pair, pin: "123456", pepper: TEST_PIN_PEPPER });
    expect(out).toEqual({ ok: false, refusal: "trivial" });
    // Nothing was written and nothing was hashed: the denylist is a SET-time
    // rule and the refusal costs one regex.
    expect(calls).toHaveLength(0);
  });

  it("stores an argon2id digest and clears any retirement on a re-set", async () => {
    const { db, calls } = fakeDb(() => []);
    const out = await setOperatorPin(db, { ...pair, pin: "428713", pepper: TEST_PIN_PEPPER });
    expect(out).toEqual({ ok: true });
    expect(calls[0]!.text).toContain("ON CONFLICT (device_id, app_user_id)");
    expect(calls[0]!.text).toContain("retired_at = NULL");
    expect(String(calls[0]!.values![3])).toMatch(/^\$argon2id\$/);
  });

  it("takes the anchor lock BEFORE it counts, and holds it through the failure INSERT", async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FOR UPDATE")) return [{ id: "pin-1", pin_hash: "$argon2id$bad", retired_at: null }];
      if (text.includes("count(*)"))
        return [{ pair_failures: 0, pair_age: null, device_failures: 0, device_age: null }];
      return [];
    });
    const verdict = await verifyOperatorPin(db, {
      ...pair,
      pin: "428713",
      pepper: TEST_PIN_PEPPER,
      now: new Date(),
    });
    expect(verdict.ok).toBe(false);
    // The ORDER is the property (041 §4.2's anchor pattern): lock, then count,
    // then verify, then record. Every reader of the count is a writer of the row
    // the count is about, which is what closes the write skew.
    expect(calls[0]!.text).toContain("FROM operator_pin p WHERE p.device_id = $1 AND p.app_user_id = $2");
    expect(calls[0]!.text).toContain("FOR UPDATE OF p");
    expect(calls[1]!.text).toContain("FROM auth_attempt");
    expect(calls[2]!.text).toContain("INSERT INTO auth_attempt");
  });

  it("refuses without testing a credential while a wait is outstanding", async () => {
    const { db, calls } = fakeDb((text) => {
      if (text.includes("FOR UPDATE")) return [{ id: "pin-1", pin_hash: "$argon2id$x", retired_at: null }];
      if (text.includes("count(*)")) {
        return [{ pair_failures: 99, pair_age: 0, device_failures: 99, device_age: 0 }];
      }
      return [];
    });
    const verdict = await verifyOperatorPin(db, {
      ...pair,
      pin: "428713",
      pepper: TEST_PIN_PEPPER,
      now: new Date(),
    });
    expect(verdict).toEqual({ ok: false, reason: "wait" });
    // NO new failure row: the refusal happened before the PIN was looked at, so
    // there is no credential test to record — and recording one would let a
    // griefer ratchet the delay by hammering.
    expect(calls.some((c) => c.text.includes("INSERT INTO auth_attempt"))).toBe(false);
  });

  // ⚠ AN EXPLICIT TIMEOUT, BECAUSE VITEST'S 5s DEFAULT IS NOT A PERFORMANCE
  // ASSERTION AND WAS BEING READ AS ONE. This case computes real argon2id at
  // 64 MiB x 3 passes four times over (the decoy digest and the candidate, for
  // the unknown pair and the retired PIN), and 048 Section 9.2 picks those
  // parameters PRECISELY so the hash is expensive. Under `test:coverage`, v8
  // instrumentation over `hash-wasm` pushes it past five seconds on a loaded
  // box; it finishes in about 1.5s without. It failed intermittently in a
  // REQUIRED check, which is the worst kind of red — it says nothing about
  // correctness and trains people to re-run.
  //
  // The ceiling is raised rather than the work reduced: dropping the argon2id
  // parameters to suit a test runner would be tuning a security floor, and
  // 021 B16 forbids quoting any of these numbers as performance anyway. It is
  // set HERE and not in `vitest.config.ts`, which is a hash-pinned harness
  // artifact this bead must not edit.
  it("refuses an unknown pair and a retired PIN with their own reasons, both recorded", async () => {
    const noRow = fakeDb((text) =>
      text.includes("count(*)")
        ? [{ pair_failures: 0, pair_age: null, device_failures: 0, device_age: null }]
        : []
    );
    expect(
      await verifyOperatorPin(noRow.db, { ...pair, pin: "428713", pepper: TEST_PIN_PEPPER, now: new Date() })
    ).toEqual({ ok: false, reason: "no_pin" });
    expect(noRow.calls.some((c) => c.text.includes("INSERT INTO auth_attempt"))).toBe(true);

    const retired = fakeDb((text) => {
      if (text.includes("FOR UPDATE")) {
        return [{ id: "pin-1", pin_hash: "$argon2id$x", retired_at: new Date() }];
      }
      if (text.includes("count(*)")) {
        return [{ pair_failures: 0, pair_age: null, device_failures: 0, device_age: null }];
      }
      return [];
    });
    expect(
      await verifyOperatorPin(retired.db, {
        ...pair,
        pin: "428713",
        pepper: TEST_PIN_PEPPER,
        now: new Date(),
      })
    ).toEqual({ ok: false, reason: "retired" });
  }, 30000);

  it("reads a pin row scoped to exactly one (device, person) pair", async () => {
    const { db, calls } = fakeDb(() => [{ id: "pin-1" }]);
    await readOperatorPin(db, "device-1", "person-1");
    expect(calls[0]!.values).toEqual(["device-1", "person-1"]);
    expect(calls[0]!.text).toContain("p.device_id = $1 AND p.app_user_id = $2");
  });

  it("retires a person's PIN rows at one scope as an APPEND-ONLY FACT, never an UPDATE", async () => {
    // E03-D07 replaced `020`'s `UPDATE operator_pin SET retired_at = now()` with
    // an `operator_pin_retirement` row (048 §3.5, `migrations/024`). The
    // assertion is written as a REFUSAL of the old shape as well as a check on
    // the new one, because the failure mode being guarded is somebody restoring
    // the column write "because it is simpler" — which would silently write the
    // lockout anchor from a path that is not a PIN verification.
    const { db, calls } = fakeDb((text) =>
      text.includes("FOR UPDATE") ? [{ id: "pin-1", shop_id: "shop-1", updated_at: new Date(0) }] : []
    );
    await retireOperatorPins(db, {
      appUserId: "person-1",
      shopId: "shop-1",
      reason: "membership revoked",
    });
    expect(calls[0]!.text).toContain("FROM operator_pin p");
    expect(calls[0]!.text).toContain("FOR UPDATE");
    expect(calls[0]!.values).toEqual(["person-1", "shop-1"]);
    expect(calls[1]!.text).toContain("INSERT INTO operator_pin_retirement");
    expect(calls[1]!.text).toContain("ON CONFLICT (operator_pin_id, retired_pin_updated_at) DO NOTHING");
    expect(calls.some((c) => /UPDATE\s+operator_pin/i.test(c.text))).toBe(false);
  });

  it("records a failure with its class and NEVER a success", async () => {
    const { db, calls } = fakeDb(() => []);
    await recordFailure(db, { shopId: "shop-1", deviceId: "device-1", failureClass: "wrong_pin" });
    expect(calls[0]!.text).toContain("INSERT INTO auth_attempt");
    expect(calls[0]!.values).toEqual(["shop-1", "device-1", null, "operator_pin", "wrong_pin"]);
  });
});

describe("the pepper is required, at boot (048 §9.2, R6)", () => {
  it("refuses to start with none", () => {
    expect(() => requirePinPepper({})).toThrow(PepperConfigError);
    expect(() => requirePinPepper({ [PIN_PEPPER_ENV]: "" })).toThrow(/is not set/);
  });

  it("refuses a value too short to be a secret", () => {
    expect(() => requirePinPepper({ [PIN_PEPPER_ENV]: "short" })).toThrow(/characters/);
  });

  it("accepts one long enough and returns it unchanged", () => {
    expect(requirePinPepper({ [PIN_PEPPER_ENV]: TEST_PIN_PEPPER })).toBe(TEST_PIN_PEPPER);
  });
});
