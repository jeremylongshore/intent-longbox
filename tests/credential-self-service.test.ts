// L3: **the credential self-service surface**, against a fake pool — and the
// sealed enrolment offer, which is pure and needs no pool at all.
//
// Bead: longbox-e5b.3.34 (alias E03-D24). Docs: 000-docs/063 §3.1–§3.6; 057 §4.5,
// §4.8, §9 R2/R2a/R8; 048 §4.1, §4.3, §8.1, R18, R19; 042 §5.1, §5.3(b).
//
// The division is `privileged-api.test.ts`'s, verbatim. What a fake CAN decide,
// and what this file is therefore for: **the ORDER of the statements** (which is
// the whole of 042 §5.3(b)'s deadlock argument), **which anchor each transaction
// takes**, the refusal each branch produces, and the two properties the
// integration lane cannot show at all — that a shown-once recovery set is
// spliced onto the RESPONSE and never onto the stored body, and that the offer
// route writes no durable row. What a fake cannot decide — that a UNIQUE blocks
// a concurrent writer, that the re-enrolment gate lifts by predicate, that the
// superseded secret stops verifying — is
// `tests/integration/credential-self-service.test.ts`'s.
import { describe, expect, it } from "vitest";
import type pg from "pg";
import {
  enrolOwnAuthenticator,
  offerAuthenticator,
  rotateOwnPassword,
  setOwnPassword,
  type AuthDeps,
} from "../src/services/auth/api.js";
import { LongboxError } from "../src/contracts/v1/errors.js";
import { ShopRateLimiter } from "../src/services/rateLimit.js";
import {
  PROVISIONAL_OFFER_TTL_MS,
  mintEnrollmentOffer,
  openEnrollmentOffer,
} from "../src/services/auth/enrollmentOffer.js";
import { MIN_PASSWORD_LENGTH } from "../src/services/auth/credentials.js";
import { seal } from "../src/services/auth/aead.js";
import { mintTotpSecret, stepAt, totpCode } from "../src/services/auth/totp.js";
import type { SessionRow } from "../src/services/auth/index.js";
import { requestHash } from "../src/services/idempotency.js";
import { fakeTxPool, type FakeTxPool } from "./fakes.js";
import { testConfig } from "./testConfig.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const STRANGER = "55555555-5555-4555-8555-555555555555";
const AUTHENTICATOR = "33333333-3333-4333-8333-333333333333";
const NOW = new Date();
/** Obviously synthetic and over the floor (048 §7.1's fixture rule). */
const PASSWORD = "not-a-real-password-0000";

const CONFIG = testConfig({ databaseUrl: "postgres://unused" });
const RING = CONFIG.authenticatorKeys!;

function deps(pool: pg.Pool, limiter = new ShopRateLimiter()): AuthDeps {
  return { pool, config: CONFIG, limiter };
}

function session(kind: "privileged" | "operator", over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    chain_id: "chain-1",
    kind,
    shop_id: SHOP,
    location_id: null,
    device_id: kind === "operator" ? "device-1" : null,
    device_credential_id: kind === "operator" ? "credential-1" : null,
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

/** A result carrying a `rowCount`, which `fakeTxPool`'s handler type does not name. */
function affected(rowCount: number): { rows: unknown[] } {
  return { rows: [], rowCount } as unknown as { rows: unknown[] };
}

const SECRET = mintTotpSecret();

function authenticatorRow(): Record<string, unknown> {
  const sealed = seal(RING, SECRET, AUTHENTICATOR);
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
 * A pool that answers the reads these routes make.
 *
 * `credential` decides whether the person already has a password — which is the
 * difference between `POST /api/v1/credentials` succeeding and refusing — and
 * `authenticator` decides `mfaState`, which is the difference between an
 * enrolment that must present a fresh code and one that must not.
 */
function pool(opts: {
  credential?: boolean;
  authenticator?: boolean;
  recoveryUse?: boolean;
  /** A ticket already confirmed: `authenticator_offer_use` refuses the second. */
  offerSpent?: boolean;
  /**
   * A row that EXISTS with a NULL hash — `pnpm clear-credential` has run (063
   * §3.8). It is the one state where the two provisioning statements disagree:
   * the INSERT still conflicts on the row and returns nothing, and the REVIVAL
   * (`… AND password_hash IS NULL`) matches. Expressing it in the fake is the
   * point — a fake that could not tell a cleared row from a live one would make
   * the `already_set` refusal untestable in the direction that matters.
   */
  cleared?: boolean;
  over?: (text: string) => { rows: unknown[] } | undefined;
}): FakeTxPool {
  return fakeTxPool((text) => {
    const custom = opts.over?.(text);
    if (custom) return custom;
    if (text.includes("FROM user_credential c")) {
      return opts.credential === true
        ? { rows: [{ id: "cred-1", app_user_id: PERSON, password_hash: "x", pepper_version: 1 }] }
        : { rows: [] };
    }
    if (text.includes("FROM user_authenticator a")) {
      return opts.authenticator === true ? { rows: [authenticatorRow()] } : { rows: [] };
    }
    if (text.includes("UPDATE user_authenticator")) return affected(1);
    if (text.includes("recovery_code_use")) return opts.recoveryUse === true ? { rows: [{}] } : { rows: [] };
    // `provisionPassword` is `ON CONFLICT DO NOTHING RETURNING id`, so the ROW
    // COUNT is the refusal (H4) — a person who already has a credential gets no
    // row back, and the fake has to be able to express that or it would be
    // testing a shape the database does not have.
    if (text.includes("INSERT INTO user_credential")) {
      return opts.credential === true || opts.cleared === true
        ? { rows: [] }
        : { rows: [{ id: "cred-new" }] };
    }
    // ⚠ **TWO STATEMENTS SPELL `UPDATE user_credential`, AND THE PREDICATE IS
    // WHAT TELLS THEM APART.** `provisionPassword`'s REVIVAL carries `AND
    // password_hash IS NULL` and matches ONLY a cleared row; `replacePassword`
    // carries no such predicate and is the only path over a live hash. A fake
    // that answered them both the same way would have let the revival overwrite
    // a live password and reported a pass.
    if (text.includes("UPDATE user_credential")) {
      if (text.includes("password_hash IS NULL")) {
        return opts.cleared === true ? { rows: [{ id: "cred-1" }] } : { rows: [] };
      }
      // `replacePassword` is an `UPDATE … RETURNING id`, whose row count is the
      // other half of the same enforcement: it can never create one.
      return opts.credential === false ? { rows: [] } : { rows: [{ id: "cred-1" }] };
    }
    if (text.includes("INSERT INTO authenticator_offer_use")) {
      return opts.offerSpent === true ? { rows: [] } : { rows: [{ ticket_digest: "d" }] };
    }
    // `beginIdempotency` reads the id back; a fake that answered no row would
    // fail every one of these cases inside the plumbing rather than in the code
    // under test.
    if (text.includes("INSERT INTO request_idempotency")) return { rows: [{ id: "idem-1" }] };
    if (text.includes("INSERT INTO user_authenticator")) return { rows: [{ id: "auth-new" }] };
    if (text.includes("FROM app_user")) {
      return { rows: [{ id: PERSON, email: "somebody@example.invalid", display_name: "Somebody" }] };
    }
    if (text.includes("FROM auth_attempt")) return { rows: [{ failures: 0, age: null }] };
    if (text.includes("FROM membership m")) {
      return { rows: [{ id: "grant-1", role: "owner", scope_kind: "shop", location_id: null }] };
    }
    return undefined;
  });
}

const KEY = { idempotencyKey: "key-1" };

// ===========================================================================
// The sealed offer (063 §3.4) — pure, and the AAD binding is the whole of it.
// ===========================================================================

describe("the enrolment offer is sealed to ONE person and ONE expiry (048 R18)", () => {
  it("round-trips for the person it was minted for", () => {
    const offer = mintEnrollmentOffer({ keyring: RING, appUserId: PERSON, now: NOW });
    const opened = openEnrollmentOffer({ keyring: RING, appUserId: PERSON, ticket: offer.ticket, now: NOW });
    expect(opened.ok).toBe(true);
    expect(opened.ok && opened.secret.equals(offer.secret)).toBe(true);
  });

  it("REFUSES a ticket presented by a DIFFERENT person", () => {
    // 048 R18's property, applied to a value that is not a row: the confirming
    // call names no person at all — it takes one from the session — so a lifted
    // ticket fails because the session's person is not the one inside the seal.
    const offer = mintEnrollmentOffer({ keyring: RING, appUserId: PERSON, now: NOW });
    const opened = openEnrollmentOffer({
      keyring: RING,
      appUserId: STRANGER,
      ticket: offer.ticket,
      now: NOW,
    });
    expect(opened).toEqual({ ok: false, refusal: "did_not_authenticate" });
  });

  it("REFUSES an EDITED expiry, because the expiry is inside the authenticated bytes", () => {
    const offer = mintEnrollmentOffer({ keyring: RING, appUserId: PERSON, now: NOW });
    const parts = offer.ticket.split(".");
    // A client that pushes the expiry a year out changes nothing: the value the
    // server must reconstruct to open the ciphertext is the one it sealed.
    parts[2] = String(NOW.getTime() + 365 * 24 * 60 * 60 * 1000);
    const opened = openEnrollmentOffer({
      keyring: RING,
      appUserId: PERSON,
      ticket: parts.join("."),
      now: NOW,
    });
    expect(opened).toEqual({ ok: false, refusal: "did_not_authenticate" });
  });

  it("REFUSES an expired ticket BEFORE any decryption", () => {
    const offer = mintEnrollmentOffer({ keyring: RING, appUserId: PERSON, now: NOW, ttlMs: 1000 });
    const opened = openEnrollmentOffer({
      keyring: RING,
      appUserId: PERSON,
      ticket: offer.ticket,
      now: new Date(NOW.getTime() + PROVISIONAL_OFFER_TTL_MS),
    });
    expect(opened).toEqual({ ok: false, refusal: "expired" });
  });

  it("REFUSES a malformed ticket rather than throwing", () => {
    for (const ticket of ["", "v1.nonsense", "v2.1.2.3.4", "v1.x.y.z.w"]) {
      const opened = openEnrollmentOffer({ keyring: RING, appUserId: PERSON, ticket, now: NOW });
      expect(opened.ok).toBe(false);
    }
  });

  it("carries the secret in NO field a caller can read without the ring", () => {
    // The ticket is base64url of a nonce and a ciphertext; the secret's bytes
    // must not appear in it in the clear. Asserted because "sealed" is a claim
    // about bytes and this is the only place it is cheap to check.
    const offer = mintEnrollmentOffer({ keyring: RING, appUserId: PERSON, now: NOW });
    expect(offer.ticket).not.toContain(offer.secret.toString("base64url"));
    expect(offer.ticket).not.toContain(offer.secret.toString("hex"));
  });
});

// ===========================================================================
// Setting a FIRST password (063 §3.3) — the route 057 §9 R2a is about.
// ===========================================================================

describe("setOwnPassword (063 §3.3)", () => {
  it("takes the idempotency row, then the credential anchor, then writes", async () => {
    const p = pool({});
    const result = await setOwnPassword(deps(p.pool), session("operator"), {
      password: PASSWORD,
      ...KEY,
    });
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ credential_set: true });
    const idempotency = p.calls.findIndex((c) => c.text.includes("INSERT INTO request_idempotency"));
    const anchor = p.calls.findIndex((c) => c.text.includes("FOR UPDATE OF c"));
    const write = p.calls.findIndex((c) => c.text.includes("INSERT INTO user_credential"));
    expect(idempotency).toBeGreaterThanOrEqual(0);
    expect(anchor).toBeGreaterThan(idempotency);
    expect(write).toBeGreaterThan(anchor);
  });

  it("REFUSES a person who already has one, under the anchor, and writes nothing", async () => {
    // The anchor is what makes this a real check rather than a race: two
    // concurrent first-password requests cannot both read "no credential".
    const p = pool({ credential: true });
    await expect(
      setOwnPassword(deps(p.pool), session("operator"), { password: PASSWORD, ...KEY })
    ).rejects.toThrow(LongboxError);
    // ⚠ **THE ASSERTION CHANGED SHAPE WITH THE H4 SPLIT, AND THE NEW ONE IS
    // STRONGER.** It used to be "no INSERT was issued", which was a statement
    // about an `if` in the service. Now the INSERT IS issued and the database
    // refuses it — `ON CONFLICT (app_user_id) DO NOTHING` returns no row — so
    // what is asserted is that the statement carries the clause that makes the
    // refusal the database's.
    const insert = p.calls.find((c) => c.text.includes("INSERT INTO user_credential"));
    expect(insert?.text).toContain("ON CONFLICT (app_user_id) DO NOTHING");
    // ⚠ **AND THE SHAPE CHANGED AGAIN AT v1.1.1, WHICH IS WHY THIS IS NOT
    // "no UPDATE was issued" ANY MORE.** A cleared row has to be reachable
    // (063 §3.8 property 2), so an `UPDATE` IS reached for — exactly one, and
    // carrying `password_hash IS NULL`, which is the predicate that makes it a
    // revival rather than an overwrite. A live hash matches neither statement,
    // which is what leaves `replacePassword` the only path over one.
    const updates = p.calls.filter((c) => c.text.includes("UPDATE user_credential"));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.text).toContain("password_hash IS NULL");
  });

  it("REVIVES a CLEARED row, because a clearance must not be a better lockout than the squat", async () => {
    // ⚠ **THE INVARIANT RE-VERIFICATION'S BLOCK.** `pnpm clear-credential` NULLs
    // the hash and keeps the row — the row is 048 §9.1's lockout anchor and
    // `migrations/031` refuses a DELETE to everyone including the schema owner —
    // and `ON CONFLICT DO NOTHING` keyed on the ROW, so the cleared person was
    // refused here, could not reach the rotation route (it needs a privileged
    // session, which needs the password that was just cleared), and had no CLI
    // either. The ruling was that the code changes, not the message.
    const p = pool({ cleared: true });
    const out = await setOwnPassword(deps(p.pool), session("operator"), { password: PASSWORD, ...KEY });
    expect(out.status).toBe(201);
    expect(out.body).toMatchObject({ credential_set: true });
    // The INSERT is still attempted first and still conflicts: the revival is a
    // FALLBACK, so the ordinary path stays one statement.
    const order = p.calls.map((c) => c.text);
    const insertAt = order.findIndex((t) => t.includes("INSERT INTO user_credential"));
    const reviveAt = order.findIndex((t) => t.includes("password_hash IS NULL"));
    expect(insertAt).toBeGreaterThanOrEqual(0);
    expect(reviveAt).toBeGreaterThan(insertAt);
  });

  it("answers CREDENTIAL_ALREADY_SET, which is not CREDENTIAL_REFUSED", async () => {
    // 042 §4.3: the client chooses the recovery from the CODE, so the two
    // refusals must differ — "choose a longer one" and "change it from your own
    // sign-in" are different next actions.
    const p = pool({ credential: true });
    await expect(
      setOwnPassword(deps(p.pool), session("operator"), { password: PASSWORD, ...KEY })
    ).rejects.toMatchObject({ code: "CREDENTIAL_ALREADY_SET" });
  });

  it("REFUSES a password under the floor with its own code, and writes nothing", async () => {
    const p = pool({});
    await expect(
      setOwnPassword(deps(p.pool), session("operator"), {
        password: "x".repeat(MIN_PASSWORD_LENGTH - 1),
        ...KEY,
      })
    ).rejects.toMatchObject({ code: "CREDENTIAL_REFUSED" });
    expect(p.calls.some((c) => c.text.includes("INSERT INTO user_credential"))).toBe(false);
  });

  it("spends the per-chain budget BEFORE any hashing, and refuses when it is gone", async () => {
    // 063 §3.6: a throttled request must spend no argon2id, which is the same
    // rule 048 §9.1 applies to a blocked verification.
    const limiter = new ShopRateLimiter({ credentialWritePerMinute: 1 });
    const p = pool({});
    await setOwnPassword(deps(p.pool, limiter), session("operator"), { password: PASSWORD, ...KEY });
    const before = p.calls.length;
    await expect(
      setOwnPassword(deps(p.pool, limiter), session("operator"), {
        password: PASSWORD,
        idempotencyKey: "key-2",
      })
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // ⚠ **THE CLAIM IS ABOUT THE SERVICE AND NOT ABOUT THE REQUEST** (the
    // invariant review's delta 4). By the time a service function runs, the HOOK
    // has already written its `authorization_decision` row and — on the
    // privileged routes — read the person's memberships. What the bucket
    // guarantees is that the SERVICE issues no statement and spends no argon2id,
    // which is the expensive half and the one an attacker paces.
    expect(p.calls.length, "a throttled request made the SERVICE issue a statement").toBe(before);
  });

  it("keys the bucket on the CHAIN and not on the person (048 R14, 019 T35)", async () => {
    const limiter = new ShopRateLimiter({ credentialWritePerMinute: 1 });
    const p = pool({});
    await setOwnPassword(deps(p.pool, limiter), session("operator"), { password: PASSWORD, ...KEY });
    // The SAME person on a DIFFERENT chain is not throttled: the budget bounds a
    // held session, and there is no counter about a named person anywhere.
    const other = await setOwnPassword(deps(p.pool, limiter), session("operator", { chain_id: "chain-2" }), {
      password: PASSWORD,
      idempotencyKey: "key-3",
    });
    expect(other.status).toBe(201);
  });

  it("hashes NEITHER the password NOR anything that inverts to it into the stored request", async () => {
    // 042 §5.4's body hash is STORED. A stored SHA-256 of a password is an
    // offline verifier for anybody holding a dump, which is what 048 §9.2 spends
    // a section keeping out of reach — so the body says only that one was sent.
    const p = pool({});
    await setOwnPassword(deps(p.pool), session("operator"), { password: PASSWORD, ...KEY });
    const insert = p.calls.find((c) => c.text.includes("INSERT INTO request_idempotency"));
    expect(JSON.stringify(insert?.values ?? [])).not.toContain(PASSWORD);
  });
});

// ===========================================================================
// Replacing a password (063 §3.3) — the freshness gate.
// ===========================================================================

describe("rotateOwnPassword (063 §3.3, 057 §4.4b generalised)", () => {
  it("REFUSES without a fresh code that verifies, and writes no credential", async () => {
    const p = pool({ authenticator: true, credential: true });
    await expect(
      rotateOwnPassword(deps(p.pool), session("privileged"), {
        password: PASSWORD,
        totpCode: "000000",
        ...KEY,
      })
    ).rejects.toMatchObject({ code: "FRESH_SECOND_FACTOR_REQUIRED" });
    expect(p.calls.some((c) => c.text.includes("INSERT INTO user_credential"))).toBe(false);
  });

  it("verifies the fresh code in its OWN transaction, which COMMITS the failure", async () => {
    // 057 §4.4b's mechanical point: the `auth_attempt` row is what 048 §9.1's
    // delay is derived from, so throwing from inside the idempotent transaction
    // would roll the failure back and hand an attacker an unbounded budget.
    const p = pool({ authenticator: true });
    await expect(
      rotateOwnPassword(deps(p.pool), session("privileged"), {
        password: PASSWORD,
        totpCode: "000000",
        ...KEY,
      })
    ).rejects.toThrow(LongboxError);
    expect(p.calls.some((c) => c.text.includes("INSERT INTO auth_attempt"))).toBe(true);
    expect(p.calls.filter((c) => c.text.startsWith("COMMIT")).length).toBeGreaterThan(0);
    expect(p.calls.some((c) => c.text.startsWith("ROLLBACK"))).toBe(false);
  });

  it("replays a settled request BEFORE asking for a code (048 R19)", async () => {
    // A genuine retry must not be asked for a second fresh code it cannot
    // produce: a step is spent exactly once, and the ±1 window means there is no
    // later one to reach for.
    // The stored row must carry the SAME request hash the retry computes, or
    // `replayIfSettled` correctly refuses it as a reused key — so the fixture
    // asks the real hasher for the value rather than inventing one.
    const request = {
      shopId: SHOP,
      idempotencyKey: KEY.idempotencyKey,
      route: "/api/v1/credentials/rotations",
      method: "POST",
      params: {},
      body: { password_supplied: true },
    };
    const p = pool({
      authenticator: true,
      over: (text) =>
        text.includes("FROM request_idempotency")
          ? {
              rows: [
                {
                  id: "idem-1",
                  status: "settled",
                  response_status: 200,
                  response_body: { credential_set: true },
                  request_hash: requestHash(request),
                },
              ],
            }
          : undefined,
    });
    const out = await rotateOwnPassword(deps(p.pool), session("privileged"), {
      password: PASSWORD,
      totpCode: "000000",
      ...KEY,
    });
    expect(out.status).toBe(200);
    expect(p.calls.some((c) => c.text.includes("UPDATE user_authenticator"))).toBe(false);
  });

  it("takes the credential anchor even though it verifies no password", async () => {
    // A rotation and a concurrent sign-in for the same person must serialise, or
    // the sign-in can verify a digest the rotation is halfway through replacing
    // (057 §4.5's reason for `lockCredential` existing at all).
    const p = pool({ authenticator: true, credential: true });
    const out = await rotateOwnPassword(deps(p.pool), session("privileged"), {
      password: PASSWORD,
      totpCode: totpCode(SECRET, stepAt(NOW)),
      ...KEY,
    });
    expect(out.status).toBe(200);
    const anchor = p.calls.findIndex((c) => c.text.includes("FOR UPDATE OF c"));
    // An UPDATE and never an INSERT (H4): this route can rotate a password and
    // can never create one, and the row count is what says so.
    const write = p.calls.findIndex((c) => c.text.includes("UPDATE user_credential"));
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(write).toBeGreaterThan(anchor);
    expect(p.calls.some((c) => c.text.includes("INSERT INTO user_credential"))).toBe(false);
  });
});

// ===========================================================================
// The offer and the enrolment (063 §3.4).
// ===========================================================================

describe("offerAuthenticator (063 §3.4)", () => {
  const OBSERVED = { method: "POST", path: "/api/v1/authenticators/offers" };

  it("returns a URI and a ticket and writes NO durable row", async () => {
    const p = pool({ authenticator: true });
    const out = await offerAuthenticator(deps(p.pool), session("privileged"), OBSERVED);
    expect(out.status).toBe(200);
    const body = out.body as Record<string, string>;
    expect(body["otpauth_uri"]).toMatch(/^otpauth:\/\/totp\//);
    expect(body["enrollment_ticket"]).toMatch(/^v1\./);
    // 048 §4.3: a secret that is never confirmed never becomes a row — and this
    // route is where it would have, had the design put it in a table.
    for (const table of ["user_authenticator", "recovery_code", "request_idempotency"]) {
      expect(
        p.calls.some((c) => c.text.includes(`INSERT INTO ${table}`)),
        `the offer route wrote ${table}`
      ).toBe(false);
    }
  });

  it("writes the identity-access fact, because a person's name was resolved", async () => {
    const p = pool({ authenticator: true });
    await offerAuthenticator(deps(p.pool), session("privileged"), OBSERVED);
    expect(p.calls.some((c) => c.text.includes("INSERT INTO identity_access"))).toBe(true);
  });

  it("REFUSES an accessor pair nobody declared (019 T35(b), 060 §4.4)", async () => {
    const p = pool({ authenticator: true });
    await expect(
      offerAuthenticator(deps(p.pool), session("privileged"), {
        method: "POST",
        path: "/api/v1/somewhere-else",
      })
    ).rejects.toThrow();
  });
});

describe("enrolOwnAuthenticator (063 §3.4)", () => {
  /**
   * ⚠ **THE CLOCK IS READ AT CALL TIME AND NOT AT MODULE LOAD, AND THAT IS A
   * FIX RATHER THAN A STYLE.** These three cases pass a ticket to the REAL
   * service, which opens it against `new Date()` and verifies the confirming
   * code against the current TOTP step. A fixture built from a `NOW` captured
   * when the module was imported passes on its own and fails in a full run,
   * where minutes have gone by: the ticket has expired and the code is outside
   * 048 R19's ±1 window. A test that only passes when it runs first is a test
   * whose failures are attributed to whatever ran before it.
   */
  function ticketFor(appUserId = PERSON): { ticket: string; code: string } {
    const at = new Date();
    const offer = mintEnrollmentOffer({ keyring: RING, appUserId, now: at });
    return { ticket: offer.ticket, code: totpCode(offer.secret, stepAt(at)) };
  }

  it("takes the CREDENTIAL anchor before the AUTHENTICATOR anchor, in one transaction", async () => {
    // 042 §5.3(b) positions three and four, and 057 §9 R8's residual: the shared
    // per-person budget has two anchors, and this is the routed path that holds
    // BOTH — which the recovery CLI does not.
    const p = pool({ recoveryUse: true });
    const { ticket, code } = ticketFor();
    const out = await enrolOwnAuthenticator(deps(p.pool), session("privileged"), {
      ticket,
      code,
      ...KEY,
    });
    expect(out.status).toBe(201);
    const client = p.clients.find((c) => c.calls.some((q) => q.text.includes("FOR UPDATE OF c")));
    expect(client, "no transaction took the credential anchor").toBeDefined();
    const credential = client!.calls.findIndex((c) => c.text.includes("FOR UPDATE OF c"));
    const authenticator = client!.calls.findIndex((c) => c.text.includes("FOR UPDATE OF a"));
    expect(credential).toBeGreaterThanOrEqual(0);
    expect(authenticator).toBeGreaterThan(credential);
    // 30s, on `authenticator-service.test.ts`'s idiom: a successful enrolment
    // hashes EIGHT recovery codes with argon2id (048 §8.1), which is a deliberate
    // cost of the design rather than a slow test, and the default 5s timeout is
    // reached under a loaded full run while passing on its own.
  }, 30_000);

  it("SPLICES the recovery set onto the response and never onto the stored body", async () => {
    // 057 §4.8, verbatim one credential up: `recovery_code` holds argon2id
    // digests, so storing the plaintext in `request_idempotency`'s jsonb would
    // put a live credential in a table on the one route whose custody story is
    // "shown once, stored nowhere".
    const p = pool({ recoveryUse: true });
    const { ticket, code } = ticketFor();
    const out = await enrolOwnAuthenticator(deps(p.pool), session("privileged"), {
      ticket,
      code,
      ...KEY,
    });
    const codes = (out.body as { authenticator: { recovery_codes?: string[] } }).authenticator.recovery_codes;
    expect(codes).toHaveLength(8);
    const stored = p.calls.filter((c) => c.text.includes("request_idempotency"));
    const serialised = JSON.stringify(stored.map((c) => c.values));
    for (const one of codes!) expect(serialised).not.toContain(one);
  }, 30_000);

  it("hashes the TICKET'S DIGEST into the stored request and never the rotating code", async () => {
    // ⚠ **THE ONE DEFECT CI CAUGHT IN THIS BEAD.** 042 §5.4 hashes the body so a
    // reused key with different content is a 422, which means the hashed value
    // must identify the ACT. A TOTP code does not: it changes every thirty
    // seconds for one logical enrolment, so a retry after a lost response was
    // refused `IDEMPOTENCY_KEY_REUSED` — the dead-enrolment failure 042 §5.1
    // exists to prevent, and one 048 R19 makes unavoidable because the first
    // code's step is spent and cannot be resent. The ticket identifies the act,
    // and its DIGEST is what is stored, because `request_hash` IS stored and a
    // ticket carries a sealed secret.
    const p = pool({ recoveryUse: true });
    const { ticket, code } = ticketFor();
    await enrolOwnAuthenticator(deps(p.pool), session("privileged"), { ticket, code, ...KEY });
    const insert = p.calls.find((c) => c.text.includes("INSERT INTO request_idempotency"));
    const stored = JSON.stringify(insert?.values ?? []);
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(ticket);
  }, 30_000);

  it("REFUSES a ticket sealed for somebody else, and writes no authenticator", async () => {
    const p = pool({ recoveryUse: true });
    const { ticket, code } = ticketFor(STRANGER);
    await expect(
      enrolOwnAuthenticator(deps(p.pool), session("privileged"), { ticket, code, ...KEY })
    ).rejects.toMatchObject({ code: "AUTHENTICATOR_ENROLLMENT_REFUSED" });
    expect(p.calls.some((c) => c.text.includes("INSERT INTO user_authenticator"))).toBe(false);
  });

  it("REFUSES a code that does not verify against the secret in the ticket", async () => {
    const p = pool({ recoveryUse: true });
    const { ticket } = ticketFor();
    await expect(
      enrolOwnAuthenticator(deps(p.pool), session("privileged"), { ticket, code: "000000", ...KEY })
    ).rejects.toMatchObject({ code: "AUTHENTICATOR_ENROLLMENT_REFUSED" });
    expect(p.calls.some((c) => c.text.includes("INSERT INTO user_authenticator"))).toBe(false);
  });

  it("asks a person who STILL HOLDS a factor for a fresh code from it", async () => {
    // 063 §3.4: the branch is on the person's STATE and never on a field the
    // caller supplies, so a caller cannot choose which rule applies to them by
    // omitting one.
    const p = pool({ authenticator: true });
    const { ticket, code } = ticketFor();
    await expect(
      enrolOwnAuthenticator(deps(p.pool), session("privileged"), { ticket, code, ...KEY })
    ).rejects.toMatchObject({ code: "FRESH_SECOND_FACTOR_REQUIRED" });
    expect(p.calls.some((c) => c.text.includes("INSERT INTO user_authenticator"))).toBe(false);
  });

  it("does NOT ask a person in the re-enrolment state, who has none to give", async () => {
    // 048 §8.1: the recovery code they signed in with WAS that presentation, and
    // the authenticator it substituted for was retired in the same transaction.
    const p = pool({ recoveryUse: true });
    const { ticket, code } = ticketFor();
    const out = await enrolOwnAuthenticator(deps(p.pool), session("privileged"), {
      ticket,
      code,
      ...KEY,
    });
    expect(out.status).toBe(201);
  }, 30_000);
});
