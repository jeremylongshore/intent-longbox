// L3: the application service behind E03-D11's four routes, against a fake pool.
//
// Bead: longbox-e5b.3.21 (alias E03-D11). Docs: 000-docs/057 §4.5, §4.8; 048
// §4.1, §9.3, R20; 042 §5.1, §5.3(b).
//
// The division is `session-api.test.ts`'s, verbatim. What a fake CAN decide, and
// what this file is therefore for: **the ORDER of the statements** — which is the
// whole of 042 §5.3(b)'s deadlock argument and of 048 §9.1's write-skew one —
// **which context each transaction declares**, the DTO each route returns, and
// the one property the integration lane cannot show at all: that the shown-once
// code is spliced onto the RESPONSE and never onto the body `request_idempotency`
// stores. What a fake cannot decide — that a unique constraint blocks a
// concurrent writer — is `tests/integration/privileged-session.test.ts`'s.
import { describe, expect, it } from "vitest";
import type pg from "pg";
import {
  createEnrollmentCode,
  createInvitation,
  endPrivilegedSession,
  openPrivilegedSession,
  type AuthDeps,
} from "../src/services/auth/api.js";
import { LongboxError } from "../src/contracts/v1/errors.js";
import { ShopRateLimiter } from "../src/services/rateLimit.js";
import { seal } from "../src/services/auth/aead.js";
import { mintTotpSecret, stepAt, totpCode } from "../src/services/auth/totp.js";
import { hashWithPepper } from "../src/services/auth/secrets.js";
import type { SessionRow } from "../src/services/auth/index.js";
import { fakeTxPool, type FakeTxPool } from "./fakes.js";
import { TEST_PIN_PEPPER, testConfig } from "./testConfig.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const AUTHENTICATOR = "33333333-3333-4333-8333-333333333333";
const LOCATION = "44444444-4444-4444-8444-444444444444";
const EMAIL = "somebody@example.invalid";
const PASSWORD = "not-a-real-password-0000";
const NOW = new Date();

const CONFIG = testConfig({ databaseUrl: "postgres://unused" });

function deps(pool: pg.Pool, limiter = new ShopRateLimiter()): AuthDeps {
  return { pool, config: CONFIG, limiter };
}

/** A live privileged session row, as the hook would have resolved it. */
function privilegedSession(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    chain_id: "chain-1",
    kind: "privileged",
    shop_id: SHOP,
    location_id: null,
    device_id: null,
    device_credential_id: null,
    app_user_id: PERSON,
    parent_session_id: null,
    parent_chain_id: null,
    issued_at: NOW,
    rotate_after: NOW,
    idle_expires_at: NOW,
    absolute_expires_at: NOW,
    ...over,
  };
}

const SECRET = mintTotpSecret();

/** A result carrying a `rowCount`, which `fakeTxPool`'s handler type does not name. */
function affected(rowCount: number): { rows: unknown[] } {
  return { rows: [], rowCount } as unknown as { rows: unknown[] };
}

/** The live authenticator row, sealed under the test ring with the row's own id as AAD. */
function authenticatorRow(): Record<string, unknown> {
  const sealed = seal(CONFIG.authenticatorKeys!, SECRET, AUTHENTICATOR);
  return {
    id: AUTHENTICATOR,
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
  };
}

/**
 * A pool that answers every read the sign-in makes, so the happy path runs.
 *
 * The password digest is computed with the REAL hasher under the test pepper,
 * because a fake digest would make the one assertion this file most needs —
 * that the correct password is accepted and a wrong one is not — a test of the
 * fake rather than of the service.
 */
async function signInPool(over: (text: string) => { rows: unknown[] } | undefined = () => undefined) {
  const digest = await hashWithPepper(PASSWORD, TEST_PIN_PEPPER);
  const sealed = seal(CONFIG.authenticatorKeys!, SECRET, AUTHENTICATOR);
  return fakeTxPool((text) => {
    const custom = over(text);
    if (custom) return custom;
    if (text.includes("FROM app_user u")) return { rows: [{ id: PERSON }] };
    if (text.includes("FROM user_credential c")) {
      return { rows: [{ id: "cred-1", app_user_id: PERSON, password_hash: digest, pepper_version: 1 }] };
    }
    if (text.includes("FROM auth_attempt")) return { rows: [{ failures: 0, age: null }] };
    if (text.includes("FROM user_authenticator a")) {
      return {
        rows: [
          {
            id: AUTHENTICATOR,
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
          },
        ],
      };
    }
    // 048 R19: the AFFECTED-ROW COUNT is the authorization, so a fake that could
    // not express "one row" could not exercise a successful verification at all.
    if (text.includes("UPDATE user_authenticator")) return affected(1);
    if (text.includes("FROM membership m")) {
      return { rows: [{ id: "grant-1", role: "owner", scope_kind: "shop", location_id: null }] };
    }
    if (text.includes("recovery_code_use")) return { rows: [] };
    if (text.includes("INSERT INTO app_session")) {
      return { rows: [privilegedSession({ id: "new-session", chain_id: "new-chain" })] };
    }
    if (text.includes("FROM app_user")) return { rows: [{ id: PERSON, display_name: "Somebody" }] };
    if (text.includes("FROM shop")) return { rows: [{ id: SHOP, name: "A Shop" }] };
    return undefined;
  });
}

/**
 * The accessor pair the ROUTE observes (E03-D17, the security lens's F3).
 *
 * `httpAccessor` refuses a pair no `DECLARED_ACCESSORS` row names, so these cases
 * pass the real registered template rather than a plausible string — which is the
 * point of the change: a wrong pair is now a refused request, not a plausible
 * audit row somebody finds later.
 */
const OBSERVED = { method: "POST", path: "/api/v1/privileged-sessions" };

describe("openPrivilegedSession (048 §4.1, 057 §4.5)", () => {
  it("takes the FIRST factor's anchor before the SECOND factor's (042 §5.3(b), five positions)", async () => {
    const pool = await signInPool();
    await openPrivilegedSession(
      deps(pool.pool),
      {
        email: EMAIL,
        password: PASSWORD,
        totpCode: totpCode(SECRET, stepAt(NOW)),
        shopId: SHOP,
      },
      OBSERVED
    );
    const credential = pool.calls.findIndex((c) => c.text.includes("FOR UPDATE OF c"));
    const authenticator = pool.calls.findIndex((c) => c.text.includes("FOR UPDATE OF a"));
    expect(credential).toBeGreaterThanOrEqual(0);
    expect(authenticator).toBeGreaterThan(credential);
    // BOTH anchors, in ONE transaction, is what makes 048 §4.3's shared budget
    // serialised FOR THIS ROUTE — two anchors over one count is the write-skew
    // §9.1 exists to close. ⚠ It is NOT true that no path takes just one of them:
    // `pnpm redeem-recovery-code` holds the authenticator's alone, which is a
    // DECLARED exception (057 §4.5, §9 R8) whose substitute is an access
    // requirement rather than a lock. This assertion is about the route, which is
    // the surface an attacker can reach.
    expect(pool.clients[0]!.calls.some((c) => c.text.includes("FOR UPDATE OF c"))).toBe(true);
    expect(pool.clients[0]!.calls.some((c) => c.text.includes("FOR UPDATE OF a"))).toBe(true);
  });

  it("declares the `second-factor` scope for the factors and the SHOP for the scope check", async () => {
    const pool = await signInPool();
    await openPrivilegedSession(
      deps(pool.pool),
      {
        email: EMAIL,
        password: PASSWORD,
        totpCode: totpCode(SECRET, stepAt(NOW)),
        shopId: SHOP,
      },
      OBSERVED
    );
    const begins = pool.calls.filter((c) => c.text.startsWith("BEGIN")).map((c) => c.text);
    // The factors are facts about a PERSON, who may hold memberships at several
    // shops; the membership read and the session issuance are about ONE shop.
    expect(begins[0]).toContain("second-factor");
    expect(begins.slice(1).join("\n")).toContain(SHOP);
  });

  it("REFUSES a wrong password with §9.3's one code, and issues no session", async () => {
    const pool = await signInPool();
    await expect(
      openPrivilegedSession(
        deps(pool.pool),
        {
          email: EMAIL,
          password: `${PASSWORD}-wrong`,
          totpCode: totpCode(SECRET, stepAt(NOW)),
          shopId: SHOP,
        },
        OBSERVED
      )
    ).rejects.toThrow(LongboxError);
    expect(pool.calls.some((c) => c.text.includes("INSERT INTO app_session"))).toBe(false);
    // …and the second factor was never tested, so a code presented without a
    // password cannot consume a step (048 R19).
    expect(pool.calls.some((c) => c.text.includes("UPDATE user_authenticator"))).toBe(false);
  });

  it("REFUSES a person with no live membership at the shop they named", async () => {
    const pool = await signInPool((text) => (text.includes("FROM membership m") ? { rows: [] } : undefined));
    await expect(
      openPrivilegedSession(
        deps(pool.pool),
        {
          email: EMAIL,
          password: PASSWORD,
          totpCode: totpCode(SECRET, stepAt(NOW)),
          shopId: SHOP,
        },
        OBSERVED
      )
    ).rejects.toThrow(LongboxError);
    const failure = pool.calls.find((c) => c.text.includes("INSERT INTO auth_attempt"));
    expect(failure?.values).toContain("no_live_membership");
  });

  it("REFUSES a role that is not one of 048 §4.1's three", async () => {
    const pool = await signInPool((text) =>
      text.includes("FROM membership m")
        ? { rows: [{ id: "grant-1", role: "operator", scope_kind: "shop", location_id: null }] }
        : undefined
    );
    await expect(
      openPrivilegedSession(
        deps(pool.pool),
        {
          email: EMAIL,
          password: PASSWORD,
          totpCode: totpCode(SECRET, stepAt(NOW)),
          shopId: SHOP,
        },
        OBSERVED
      )
    ).rejects.toThrow(LongboxError);
    const failure = pool.calls.find((c) => c.text.includes("INSERT INTO auth_attempt"));
    expect(failure?.values).toContain("role_not_privileged");
  });

  it("REVOKES the person's other privileged chains at this shop, before it issues", async () => {
    // ⚠ THE SECURITY LENS'S F1. A privileged session is deliberately not
    // device-bound, so a copied `__Host-lb_priv` cookie is an owner until it
    // expires — and until this landed, signing in again REVOKED NOTHING, which
    // left an owner who suspected a copy with no act available to them at all.
    const pool = await signInPool((text) =>
      text.includes("FROM app_session s") && text.includes("kind = 'privileged'")
        ? { rows: [{ chain_id: "stolen-chain" }] }
        : undefined
    );
    await openPrivilegedSession(
      deps(pool.pool),
      {
        email: EMAIL,
        password: PASSWORD,
        totpCode: totpCode(SECRET, stepAt(NOW)),
        shopId: SHOP,
      },
      OBSERVED
    );
    const revoke = pool.calls.find((c) => c.text.includes("INSERT INTO app_session_revocation"));
    expect(revoke?.values).toEqual([SHOP, "stolen-chain", "privileged_superseded", PERSON]);
    // BEFORE the new row exists, so it cannot revoke the chain it is making room
    // for — and in the SAME transaction, so a rollback leaves both the old
    // sessions and the absence of a new one.
    const revokeAt = pool.calls.findIndex((c) => c.text.includes("INSERT INTO app_session_revocation"));
    // ⚠ The issuance matcher must EXCLUDE the revocation, because
    // `INSERT INTO app_session` is a prefix of `INSERT INTO app_session_revocation`
    // — the first version of this assertion compared the revocation to itself and
    // passed for the wrong reason until the ordering it asserts was violated.
    const issueAt = pool.calls.findIndex(
      (c) => c.text.includes("INSERT INTO app_session\n") || c.text.includes("INSERT INTO app_session ")
    );
    expect(revokeAt).toBeGreaterThanOrEqual(0);
    expect(revokeAt).toBeLessThan(issueAt);
  });

  it("takes a bucket keyed on the submitted identifier's DIGEST, never the address", async () => {
    const pool = await signInPool();
    const limiter = new ShopRateLimiter();
    const taken: string[] = [];
    const spy = new Proxy(limiter, {
      get(target, prop, receiver) {
        if (prop === "takeSignIn") {
          return (key: string) => {
            taken.push(key);
            return target.takeSignIn(key);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    await openPrivilegedSession(
      deps(pool.pool, spy),
      {
        email: EMAIL,
        password: PASSWORD,
        totpCode: totpCode(SECRET, stepAt(NOW)),
        shopId: SHOP,
      },
      OBSERVED
    );
    expect(taken).toHaveLength(1);
    expect(taken[0]).toMatch(/^[0-9a-f]{64}$/);
    // A rate-limit key is held in a process and printed in a log line the day
    // somebody debugs it, and an address is a person.
    expect(taken[0]).not.toContain(EMAIL);
  });

  it("REFUSES before any read when the identifier's bucket is empty", async () => {
    const pool = await signInPool();
    const limiter = new ShopRateLimiter();
    const drain = new Proxy(limiter, {
      get(target, prop, receiver) {
        if (prop === "takeSignIn") return () => ({ allowed: false, retryAfterSeconds: 30 });
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    await expect(
      openPrivilegedSession(
        deps(pool.pool, drain),
        {
          email: EMAIL,
          password: PASSWORD,
          totpCode: totpCode(SECRET, stepAt(NOW)),
          shopId: SHOP,
        },
        OBSERVED
      )
    ).rejects.toThrow(LongboxError);
    expect(pool.calls).toHaveLength(0);
  });
});

describe("endPrivilegedSession", () => {
  it("writes ONE revocation fact and clears the cookie", async () => {
    const pool = fakeTxPool();
    const out = await endPrivilegedSession(deps(pool.pool), privilegedSession());
    expect(out.status).toBe(200);
    expect(out.cookies).toEqual([expect.stringContaining("__Host-lb_priv=;")]);
    const revocation = pool.calls.find((c) => c.text.includes("INSERT INTO app_session_revocation"));
    expect(revocation?.values).toEqual([SHOP, "chain-1", "signed_out", PERSON]);
  });
});

describe("createInvitation / createEnrollmentCode (057 §4.8)", () => {
  /** A pool that answers the idempotency plumbing plus one issuance. */
  function issuancePool(
    over: (text: string) => { rows: unknown[] } | undefined = () => undefined
  ): FakeTxPool {
    return fakeTxPool((text) => {
      const custom = over(text);
      if (custom) return custom;
      if (text.includes("FROM request_idempotency")) return { rows: [] };
      if (text.includes("INSERT INTO request_idempotency")) return { rows: [{ id: "idem-1" }] };
      if (text.includes("INSERT INTO app_user")) return { rows: [{ id: PERSON, display_name: "Somebody" }] };
      if (text.includes("FROM membership m")) {
        return { rows: [{ id: "grant-1", role: "owner", scope_kind: "shop", location_id: null }] };
      }
      if (text.includes("count(*)")) return { rows: [{ n: 0 }] };
      // 057 §4.4b: an OWNER invitation re-presents the second factor, so the
      // issuance pool has to be able to answer one. Everything else here is
      // untouched, and the two cases that DO NOT ask for a factor assert the
      // absence of these reads rather than their contents.
      if (text.includes("FROM auth_attempt")) return { rows: [{ failures: 0, age: null }] };
      if (text.includes("FROM user_authenticator a")) return { rows: [authenticatorRow()] };
      if (text.includes("UPDATE user_authenticator")) return affected(1);
      if (text.includes("FROM location")) return { rows: [{ id: LOCATION }] };
      if (text.includes("INSERT INTO invitation")) return { rows: [{ id: "invitation-1" }] };
      if (text.includes("INSERT INTO device_enrollment_code")) return { rows: [{ id: "code-1" }] };
      return undefined;
    });
  }

  it("returns the code ONCE and never puts it in the stored response body", async () => {
    const pool = issuancePool();
    const out = await createInvitation(deps(pool.pool), privilegedSession(), {
      email: EMAIL,
      displayName: "Somebody",
      role: "operator",
      idempotencyKey: "key-1",
    });
    expect(out.status).toBe(201);
    const body = out.body as { invitation: { code?: string } };
    expect(body.invitation.code).toBeDefined();

    // ⚠ THE PROPERTY THIS WHOLE SHAPE EXISTS FOR. The code is spliced onto the
    // RESPONSE; the statement that stores the response body must not contain it,
    // because `invitation` holds `sha256(code)` and nothing else and a live
    // credential in a jsonb column is the one thing 048 §7.1's custody story
    // forbids.
    const stored = pool.calls.filter((c) => c.text.includes("request_idempotency"));
    expect(stored.length).toBeGreaterThan(0);
    for (const call of stored) {
      expect(JSON.stringify(call.values ?? [])).not.toContain(body.invitation.code!);
    }
  });

  it("hashes the email into the request hash rather than carrying it", async () => {
    const pool = issuancePool();
    await createInvitation(deps(pool.pool), privilegedSession(), {
      email: EMAIL,
      displayName: "Somebody",
      role: "operator",
      idempotencyKey: "key-2",
    });
    // `request_idempotency.request_hash` is stored, and an address is a person.
    for (const call of pool.calls.filter((c) => c.text.includes("request_idempotency"))) {
      expect(JSON.stringify(call.values ?? [])).not.toContain(EMAIL);
    }
  });

  it("turns a RANK refusal into a role refusal and a ceiling into its own code", async () => {
    const ranked = issuancePool((text) =>
      text.includes("FROM membership m")
        ? { rows: [{ id: "grant-1", role: "manager", scope_kind: "shop", location_id: null }] }
        : undefined
    );
    // A manager may invite operators and nothing above (054 §5's `ROLE_GRANTABLE`).
    //
    // ⚠ **THE FRESH CODE IS SUPPLIED HERE, AND THE ORDER IT IMPLIES IS DELIBERATE.**
    // The freshness gate is keyed on the ACT REQUESTED and not on whether the
    // caller may perform it, so a manager asking to invite an owner is asked for
    // a code and only then refused. The other order would be cheaper for them and
    // worse for everyone: deciding "your role may not do this" BEFORE asking for
    // the factor turns the route into an oracle for which roles may name an owner
    // that costs nothing to probe. A manager who tries pays one code; that is the
    // right side to spend it on.
    await expect(
      createInvitation(deps(ranked.pool), privilegedSession(), {
        email: EMAIL,
        displayName: "Somebody",
        role: "owner",
        totpCode: totpCode(SECRET, stepAt(NOW)),
        idempotencyKey: "key-3",
      })
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    // ⚠ **AND THE REFUSAL LEAVES NOTHING BEHIND — E03-D21, the security lens's
    // F4.** `mayGrantRole` used to be reached inside `issueInvitation`, inside
    // the idempotent transaction, which is AFTER the invited person has been
    // committed under the `person-admission` scope: an AUTHORIZATION REFUSAL with
    // a side effect. It is not nothing, either — the first shop to type an
    // address owns that person's display name at every other shop (000-docs/062
    // §6). The gate is extracted (`mayIssueInvitation`) and the route calls it
    // FIRST, so a manager refused for naming an owner creates no row at all.
    expect(ranked.calls.filter((c) => c.text.includes("INSERT INTO app_user"))).toHaveLength(0);

    const full = issuancePool((text) => (text.includes("count(*)") ? { rows: [{ n: 99 }] } : undefined));
    await expect(
      createInvitation(deps(full.pool), privilegedSession(), {
        email: EMAIL,
        displayName: "Somebody",
        role: "operator",
        idempotencyKey: "key-4",
      })
    ).rejects.toMatchObject({ code: "INVITATION_REFUSED" });
  });

  it("issues an enrollment code and keeps it out of the stored body too", async () => {
    const pool = issuancePool();
    const out = await createEnrollmentCode(deps(pool.pool), privilegedSession(), {
      locationId: LOCATION,
      deviceLabel: "counter phone",
      deviceKind: "phone",
      idempotencyKey: "key-5",
    });
    expect(out.status).toBe(201);
    const body = out.body as { enrollment: { code?: string } };
    expect(body.enrollment.code).toBeDefined();
    for (const call of pool.calls.filter((c) => c.text.includes("request_idempotency"))) {
      expect(JSON.stringify(call.values ?? [])).not.toContain(body.enrollment.code!);
    }
  });

  it("answers a location this shop does not own as an ABSENT SHOP", async () => {
    const pool = issuancePool((text) => (text.includes("FROM location") ? { rows: [] } : undefined));
    await expect(
      createEnrollmentCode(deps(pool.pool), privilegedSession(), {
        locationId: LOCATION,
        deviceLabel: "counter phone",
        deviceKind: "phone",
        idempotencyKey: "key-6",
      })
    ).rejects.toMatchObject({ code: "ENROLLMENT_CODE_REFUSED" });
  });

  // =========================================================================
  // 057 §4.4b — the ONE act whose damage the session's expiry does not bound.
  // =========================================================================

  it("REFUSES an owner invitation with NO fresh code, before it writes anything", async () => {
    const pool = issuancePool();
    await expect(
      createInvitation(deps(pool.pool), privilegedSession(), {
        email: EMAIL,
        displayName: "Somebody",
        role: "owner",
        idempotencyKey: "key-owner-1",
      })
    ).rejects.toMatchObject({ code: "FRESH_SECOND_FACTOR_REQUIRED" });
    // Nothing was written: no person, no invitation, and no idempotency row that
    // a retry would then replay as a success.
    expect(pool.calls.some((c) => c.text.includes("INSERT INTO invitation"))).toBe(false);
    expect(pool.calls.some((c) => c.text.includes("INSERT INTO app_user"))).toBe(false);
  });

  it("REFUSES an owner invitation whose code does not verify, with the SAME code", async () => {
    // One refusal for an absent code and a wrong one: the caller already holds a
    // privileged session, so neither answer discloses what the other does not,
    // and both lead to the same next action.
    const pool = issuancePool((text) =>
      text.includes("FROM user_authenticator a") ? { rows: [] } : undefined
    );
    await expect(
      createInvitation(deps(pool.pool), privilegedSession(), {
        email: EMAIL,
        displayName: "Somebody",
        role: "owner",
        totpCode: "000000",
        idempotencyKey: "key-owner-2",
      })
    ).rejects.toMatchObject({ code: "FRESH_SECOND_FACTOR_REQUIRED" });
    expect(pool.calls.some((c) => c.text.includes("INSERT INTO invitation"))).toBe(false);
  });

  it("does NOT ask a manager or an operator invitation for a fresh code", async () => {
    // The gate is on the ONE irreversible act. An operator membership is revoked
    // by one row; an owner's carries the power to grant itself again, so a copied
    // cookie spent on it outlives every session in the system — and only that act
    // pays the ceremony (022 P2: an override must stay cheap).
    for (const role of ["manager", "operator"] as const) {
      const pool = issuancePool();
      const out = await createInvitation(deps(pool.pool), privilegedSession(), {
        email: EMAIL,
        displayName: "Somebody",
        role,
        idempotencyKey: `key-${role}`,
      });
      expect(out.status).toBe(201);
      expect(pool.calls.some((c) => c.text.includes("FROM user_authenticator a"))).toBe(false);
    }
  });

  it("verifies the fresh code in its OWN transaction, which commits before the idempotent one", async () => {
    // 048 §9.1: the `auth_attempt` row the verification appends is what the delay
    // is derived from, so its transaction must COMMIT whatever the verdict —
    // throwing from inside `runIdempotent` would roll the failure back and hand
    // an attacker an unbounded budget through the mechanism built to bound it.
    const pool = issuancePool();
    await createInvitation(deps(pool.pool), privilegedSession(), {
      email: EMAIL,
      displayName: "Somebody",
      role: "owner",
      totpCode: totpCode(SECRET, stepAt(NOW)),
      idempotencyKey: "key-owner-3",
    });
    const factorClient = pool.clients.findIndex((c) =>
      c.calls.some((q) => q.text.includes("FOR UPDATE OF a"))
    );
    const idemClient = pool.clients.findIndex((c) =>
      c.calls.some((q) => q.text.includes("INSERT INTO request_idempotency"))
    );
    expect(factorClient).toBeGreaterThanOrEqual(0);
    expect(idemClient).toBeGreaterThanOrEqual(0);
    // DIFFERENT held connections, so the two never hold locks together and no
    // deadlock is constructible between them — which is why 042 §5.3(b)'s order
    // does not govern the pair.
    expect(factorClient).not.toBe(idemClient);
    expect(factorClient).toBeLessThan(idemClient);
  });

  it("records NO second decision for an act the hook already allowed (054 §4.3)", async () => {
    const pool = issuancePool();
    await createInvitation(deps(pool.pool), privilegedSession(), {
      email: EMAIL,
      displayName: "Somebody",
      role: "operator",
      idempotencyKey: "key-7",
    });
    // The hook wrote the ALLOWANCE for `membership.invite` on this request,
    // because 054 §4.3 records every allowance of a PRIVILEGED permission. A
    // second row here would make one authorized act two decision rows.
    const decisions = pool.calls.filter((c) => c.text.includes("INSERT INTO authorization_decision"));
    expect(decisions).toHaveLength(0);
  });
});
