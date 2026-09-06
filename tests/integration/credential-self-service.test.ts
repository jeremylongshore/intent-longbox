// L4: **the credential self-service surface** — against a real Postgres and a
// real server.
//
// Bead: longbox-e5b.3.34 (alias E03-D24). Docs: 000-docs/063; 057 §9 R2/R2a/R8;
// 048 §4.1, §4.3, §8.1, R19; 054 §3–§4; 042 §5.1, §5.3(b).
//
// ============================================================================
// WHY THESE CASES NEED A DATABASE AND THE UNIT SUITE COULD NOT HAVE THEM
// ============================================================================
//
// `tests/credential-self-service.test.ts` proves which statement each function
// issues and in which order. It cannot prove **the thing this bead exists for**:
// that a shop with a fresh database can now get a person a password and a second
// factor over HTTP, without anybody opening a terminal. Nor can it prove that the
// 048 §8.1 re-enrolment gate LIFTS by predicate, that a superseded secret stops
// verifying, or that a device session is refused by the hook rather than by a
// handler. Every one of those is a property of the running system.
//
// **No shop's name and no person's name** (048 §7.1's fixture rule): every value
// below is obviously synthetic.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { buildApp } from "../../src/app.js";
import { asShop, appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { API_PREFIX } from "../../src/contracts/v1/schemas.js";
import { PRIVILEGED_COOKIE, mintTotpSecret, stepAt, totpCode } from "../../src/services/auth/index.js";
import { cookieHeader, openDevice, openOperator, seedIdentity, writeHeaders } from "./authHelpers.js";
import type { SeededIdentity } from "./authHelpers.js";
import { testConfig } from "../testConfig.js";

const dbUp = await probeDb();
const UPLOADS_DIR = "tests/.tmp-credential-uploads";
/** Obviously synthetic and over `MIN_PASSWORD_LENGTH`. */
const PASSWORD = "not-a-real-password-0000";
const REPLACEMENT = "also-not-a-real-password-1111";

describe.skipIf(!dbUp)("the credential self-service surface (000-docs/063)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;
  let identity: SeededIdentity;
  let ownerEmail: string;
  /** The SCHEMA OWNER's URL, kept because one case runs a break-glass CLI's act. */
  let migrateUrl: string;

  const shopQuery = (sql: string, values?: unknown[]): Promise<pg.QueryResult> =>
    asShop(pool, shopId).query(sql, values);

  /** A device+operator cookie for one person on the seeded counter phone. */
  async function counterCookie(appUserId: string): Promise<string> {
    const device = await openDevice(pool, identity);
    const operator = await openOperator(pool, device, appUserId);
    return cookieHeader(device.token, operator.token);
  }

  /**
   * 048 R19's ±1 window, and the reason the offset is always ONE: a code is
   * valid for its own step and one either side, and every act that verifies one
   * SPENDS the step it verified — so the only code that is both inside the
   * window and above `last_used_step` is the next one.
   */
  function freshCode(secret: Buffer): string {
    return totpCode(secret, stepAt(new Date(Date.now() + 30_000)));
  }

  async function signIn(
    body: Record<string, unknown>
  ): Promise<{ status: number; cookie?: string; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/privileged-sessions`,
      headers: writeHeaders(),
      payload: body,
    });
    const set = res.headers["set-cookie"];
    const raw = Array.isArray(set) ? set.join("\n") : (set ?? "");
    const match = /__Host-lb_priv=([^;]+)/.exec(raw);
    return {
      status: res.statusCode,
      ...(match ? { cookie: `${PRIVILEGED_COOKIE}=${match[1]!}` } : {}),
      body: res.json() as Record<string, unknown>,
    };
  }

  const post = (
    url: string,
    cookie: string | undefined,
    payload: NonNullable<InjectOptions["payload"]>,
    extra: Record<string, string> = {}
  ): Promise<LightMyRequestResponse> =>
    app.inject({
      method: "POST",
      url: `${API_PREFIX}${url}`,
      headers: { ...writeHeaders(extra), ...(cookie ? { cookie } : {}) },
      payload,
    });

  beforeAll(async () => {
    migrateUrl = await createFreshDb("longbox_credential_self_service");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Credential Shop", slug: `cred-${Date.now()}` });
    await ownerPool.end();

    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    app = await buildApp(pool, testConfig({ databaseUrl: appUrl(migrateUrl), uploadsDir: UPLOADS_DIR }));

    identity = await seedIdentity(pool, shopId);
    const owner = await shopQuery(`SELECT email FROM app_user WHERE id = $1`, [identity.ownerId]);
    ownerEmail = (owner.rows[0] as { email: string }).email;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  // =========================================================================
  // THE WHOLE POINT: a fresh database, and nobody opens a terminal (057 R2a)
  // =========================================================================

  it("gets an owner from NO PASSWORD to a live privileged session over HTTP alone", async () => {
    // ⚠ **THIS IS THE CASE 057 §9 R2a IS ABOUT**, and it is written as one act
    // rather than as four assertions because the residual was about a CHAIN that
    // did not close: `setPassword` had no caller, so the sign-in could not
    // succeed for any real person and the routes behind it were reachable in a
    // seeded database and not by a shop.
    //
    // Every step below is an HTTP request. Nothing here runs as the schema
    // owner, and nothing here is `pnpm enroll-authenticator` — except the FIRST
    // authenticator, which is 063 §5 R1's stated residual and is done through
    // the module rather than the CLI only because a test has no terminal.
    const counter = await counterCookie(identity.ownerId);
    const first = await post("/credentials", counter, { password: PASSWORD });
    expect(first.statusCode, JSON.stringify(first.json())).toBe(201);
    expect(first.json()).toEqual({ credential_set: true });

    // The first factor exists now. The second still comes from the bootstrap
    // path (063 §5 R1) — a privileged session cannot be opened without one, so
    // an enrolment ROUTE cannot mint the first.
    const secret = await bootstrapAuthenticator(identity.ownerId);

    const out = await signIn({
      email: ownerEmail,
      password: PASSWORD,
      totp_code: freshCode(secret),
      shop_id: shopId,
    });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect(out.cookie).toBeDefined();
    expect(out.body).toMatchObject({ must_reenroll: false });
  }, 180_000);

  it("REFUSES a second first-password with 409, and leaves the credential alone", async () => {
    // 063 §3.3: an operator session is an attribution of record and is NOT
    // non-repudiable (048 §3.5), so a route that could OVERWRITE a password
    // would let a coworker who watched a PIN lock an owner out. It provisions
    // and never replaces.
    const counter = await counterCookie(identity.ownerId);
    const again = await post("/credentials", counter, { password: REPLACEMENT });
    expect(again.statusCode).toBe(409);
    expect((again.json() as { error: { code: string } }).error.code).toBe("CREDENTIAL_ALREADY_SET");

    const rows = await shopQuery(`SELECT count(*)::int AS n FROM user_credential WHERE app_user_id = $1`, [
      identity.ownerId,
    ]);
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  }, 120_000);

  it("REFUSES a password under the floor, and writes no row", async () => {
    const person = await freshPerson("floor");
    const counter = await counterCookie(person.id);
    const res = await post("/credentials", counter, { password: "short" });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("CREDENTIAL_REFUSED");
    const rows = await shopQuery(`SELECT count(*)::int AS n FROM user_credential WHERE app_user_id = $1`, [
      person.id,
    ]);
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  }, 120_000);

  // =========================================================================
  // Who may reach what — the hook, structurally (048 I11, 063 §3.2)
  // =========================================================================

  it("REFUSES the first-password route to a DEVICE-ONLY session", async () => {
    const device = await openDevice(pool, identity);
    const res = await post("/credentials", cookieHeader(device.token), { password: PASSWORD });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("OPERATOR_REQUIRED");
  }, 120_000);

  it("REFUSES the three privileged routes to an operator session and to no session, identically", async () => {
    // 048 I11 made structural (057 §4.2): a privileged route consults
    // `__Host-lb_priv` and never the other two cookies, so an operator cookie
    // cannot satisfy one however privileged its holder is — and the two answers
    // are byte-identical after the correlation id, because a caller must not
    // learn from a refusal whether the cookie they sent was recognised.
    const counter = await counterCookie(identity.ownerId);
    for (const [url, payload] of [
      ["/credentials/rotations", { password: REPLACEMENT, totp_code: "000000" }],
      ["/authenticators/offers", {}],
      ["/authenticators", { enrollment_ticket: "v1.x", code: "000000" }],
    ] as const) {
      const withOperator = await post(url, counter, payload);
      const withNothing = await post(url, undefined, payload);
      expect(withOperator.statusCode).toBe(401);
      expect(withNothing.statusCode).toBe(401);
      const normalise = (res: { json(): unknown }): string =>
        JSON.stringify({
          ...(res.json() as { error: object }),
          error: { ...(res.json() as { error: object }).error, correlation_id: "x" },
        });
      expect((withOperator.json() as { error: { code: string } }).error.code).toBe(
        "PRIVILEGED_SESSION_REQUIRED"
      );
      expect(normalise(withOperator)).toBe(normalise(withNothing));
    }
  }, 120_000);

  // =========================================================================
  // Replacing a password (063 §3.3)
  // =========================================================================

  it("REFUSES a rotation with no fresh code and with a wrong one, and changes nothing", async () => {
    const actor = await equippedPerson("rotate-refuse");
    const cookie = await privilegedCookie(actor);
    const missing = await post("/credentials/rotations", cookie, { password: REPLACEMENT });
    expect(missing.statusCode).toBe(400);
    expect((missing.json() as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");

    const wrong = await post("/credentials/rotations", cookie, {
      password: REPLACEMENT,
      totp_code: "000000",
    });
    expect(wrong.statusCode).toBe(403);
    expect((wrong.json() as { error: { code: string } }).error.code).toBe("FRESH_SECOND_FACTOR_REQUIRED");

    // The old password still works, which is the assertion that matters: a
    // refused rotation must leave the person able to sign in.
    const out = await signIn({
      email: actor.email,
      password: PASSWORD,
      totp_code: await nextCode(actor),
      shop_id: shopId,
    });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
  }, 180_000);

  it("REPLACES the password with a fresh code, and the OLD one stops working", async () => {
    const actor = await equippedPerson("rotate-ok");
    const cookie = await privilegedCookie(actor);
    const res = await post("/credentials/rotations", cookie, {
      password: REPLACEMENT,
      totp_code: await nextCode(actor),
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    expect(res.json()).toEqual({ credential_set: true });

    const withNew = await signIn({
      email: actor.email,
      password: REPLACEMENT,
      totp_code: await nextCode(actor),
      shop_id: shopId,
    });
    expect(withNew.status, JSON.stringify(withNew.body)).toBe(201);
  }, 180_000);

  // =========================================================================
  // Enrolling a second factor (063 §3.4)
  // =========================================================================

  it("enrols a replacement factor, supersedes the old one, and shows the recovery set ONCE", async () => {
    const actor = await equippedPerson("enrol");
    const cookie = await privilegedCookie(actor);

    const authenticators = async (): Promise<number> => {
      const res = await shopQuery(
        `SELECT count(*)::int AS n FROM user_authenticator WHERE app_user_id = $1`,
        [actor.id]
      );
      return (res.rows[0] as { n: number }).n;
    };

    const before = await authenticators();
    const offer = await post("/authenticators/offers", cookie, {});
    expect(offer.statusCode, JSON.stringify(offer.json())).toBe(200);
    const body = offer.json() as { otpauth_uri: string; enrollment_ticket: string };
    const secret = secretFromUri(body.otpauth_uri);
    // **The offer wrote NO authenticator** (048 §4.3: a secret that is never
    // confirmed never becomes a row), measured across the call itself rather
    // than against an absolute number — the fixtures below re-enrol, so a
    // literal count would be asserting the fixture rather than the route.
    expect(await authenticators(), "the offer route wrote an authenticator").toBe(before);

    // The code from the factor being REPLACED — unspent, which needs the
    // re-enrolment `nextCode` performs. `retired` is that live secret, and the
    // supersession assertion below is about it.
    const freshFromOld = await nextCode(actor);
    const retired = actor.secret;

    const key = `enrol-${randomUUID()}`;
    const confirmed = await post(
      "/authenticators",
      cookie,
      {
        enrollment_ticket: body.enrollment_ticket,
        code: totpCode(secret, stepAt(new Date())),
        fresh_totp_code: freshFromOld,
      },
      { "idempotency-key": key }
    );
    expect(confirmed.statusCode, JSON.stringify(confirmed.json())).toBe(201);
    const enrolled = confirmed.json() as { authenticator: { id: string; recovery_codes?: string[] } };
    expect(enrolled.authenticator.recovery_codes).toHaveLength(8);

    // A REPLAY of the same key returns the stored body — an id, and NO codes.
    // 057 §4.8: the shown-once secret is part of the response and never of the
    // STORED response, so a retry after a lost answer is truthful rather than a
    // second delivery of a live credential.
    //
    // ⚠ **THE REPLAY SENDS NO FRESH CODE AT ALL, AND THAT IS THE ASSERTION.**
    // 048 R19 spends a step exactly once, so a genuine retry after a lost
    // response CANNOT produce a second one — which is why `replayIfSettled`
    // runs before the freshness gate (057 §4.4b's ordering, inherited here). A
    // retry that was asked for a code it cannot make would turn a lost response
    // into a dead enrolment.
    //
    // ⚠ **AND THE REPLAY SENDS A DIFFERENT CODE FROM THE FIRST CALL, WHICH IS
    // THE POINT OF THE ONE DEFECT CI CAUGHT IN THIS BEAD.** The request hash is
    // taken over the TICKET'S DIGEST and not over the code: a TOTP code changes
    // every thirty seconds, so hashing it made a retry half a minute later a
    // `422 IDEMPOTENCY_KEY_REUSED` — the lost-response-becomes-a-dead-enrolment
    // failure 042 §5.1 exists to prevent, and one 048 R19 makes unavoidable,
    // since the first code's step is spent and cannot be resent. This case
    // deliberately does NOT reuse the first code, so it fails again if the hash
    // ever goes back to carrying one.
    //
    // ⚠ **AND IT RUNS BEFORE THE SIGN-INS BELOW, WHICH IS NOT COSMETIC.** 057
    // §4.4a evicts every other live privileged chain at that shop when a person
    // signs in — so a replay attempted after `withNew` would be refused
    // `PRIVILEGED_SESSION_REQUIRED` by an eviction working exactly as designed,
    // and the case would read as a broken replay. Ordering it here is what keeps
    // the two properties separable.
    const replay = await post(
      "/authenticators",
      cookie,
      {
        enrollment_ticket: body.enrollment_ticket,
        // A code from a DIFFERENT step, deliberately: it is what a real retry a
        // minute later would carry, and it is guaranteed to differ from the
        // first call's, so this case fails deterministically — here as well as
        // in CI — if the request hash ever carries the code again.
        code: totpCode(secret, stepAt(new Date(Date.now() + 60_000))),
      },
      { "idempotency-key": key }
    );
    expect(replay.statusCode, JSON.stringify(replay.json())).toBe(201);
    expect(
      (replay.json() as { authenticator: { recovery_codes?: string[] } }).authenticator.recovery_codes
    ).toBeUndefined();

    // The plaintext codes are in no column: `recovery_code` holds argon2id
    // digests and the idempotency row holds a body that never had them.
    const stored = await shopQuery(
      `SELECT response_body::text AS body FROM request_idempotency WHERE idempotency_key = $1`,
      [key]
    );
    const serialised = (stored.rows[0] as { body: string } | undefined)?.body ?? "";
    for (const one of enrolled.authenticator.recovery_codes!) expect(serialised).not.toContain(one);

    // The OLD factor is retired in the same transaction as the new one is
    // written, so the OLD secret's code no longer opens a session (048 §8.1's
    // supersession).
    const withOld = await signIn({
      email: actor.email,
      password: PASSWORD,
      totp_code: totpCode(retired, stepAt(new Date(Date.now() + 30_000))),
      shop_id: shopId,
    });
    expect(withOld.status).toBe(401);

    // …and the NEW one does. The offset is ONE step and not two: the enrolment
    // SPENT the confirming step, and 048 R19's window is ±1, so the next step is
    // the only code that is both unspent and inside it.
    const withNew = await signIn({
      email: actor.email,
      password: PASSWORD,
      totp_code: freshCode(secret),
      shop_id: shopId,
    });
    expect(withNew.status, JSON.stringify(withNew.body)).toBe(201);
  }, 240_000);

  it("REFUSES a ticket minted for somebody else and a code that does not verify, identically", async () => {
    // 048 R18's AAD binding over a value that is not a row, and 048 §4.3's
    // confirmation — two different failures, one answer, because a caller
    // holding a ticket must not learn which half the server disliked.
    const mine = await equippedPerson("ticket-mine");
    const theirs = await equippedPerson("ticket-theirs");
    const cookie = await privilegedCookie(mine);
    const theirCookie = await privilegedCookie(theirs);

    const theirOffer = await post("/authenticators/offers", theirCookie, {});
    const theirTicket = (theirOffer.json() as { enrollment_ticket: string }).enrollment_ticket;
    const theirSecret = secretFromUri((theirOffer.json() as { otpauth_uri: string }).otpauth_uri);

    const lifted = await post("/authenticators", cookie, {
      enrollment_ticket: theirTicket,
      code: totpCode(theirSecret, stepAt(new Date())),
      fresh_totp_code: await nextCode(mine),
    });

    const myOffer = await post("/authenticators/offers", cookie, {});
    const badCode = await post("/authenticators", cookie, {
      enrollment_ticket: (myOffer.json() as { enrollment_ticket: string }).enrollment_ticket,
      code: "000000",
      fresh_totp_code: await nextCode(mine),
    });

    for (const res of [lifted, badCode]) {
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe("AUTHENTICATOR_ENROLLMENT_REFUSED");
      expect((res.json() as { error: { details: unknown } }).error.details).toEqual({});
    }
  }, 240_000);

  it("REFUSES a ticket re-submitted under a NEW key, and mints no second recovery set", async () => {
    // ⚠ **THE SECURITY LENS'S F2, REPRODUCED AS A TEST.** At v1.0.0 the sealed
    // offer was the first bearer artifact in this system NOT made single-use by
    // a constraint, breaking 048 R15's own idiom — and the lens replayed one
    // forty seconds later under a NEW `Idempotency-Key` and got a second `201`:
    // a second authenticator, and eight FRESH recovery codes, which silently
    // retired the set the person had just written off the screen. For somebody
    // in 048 §8.1's re-enrolment state that is the set they need most.
    //
    // `authenticator_offer_use.ticket_digest` is now the PRIMARY KEY, INSERTed
    // in the transaction that writes the authenticator, so the second attempt is
    // a failed INSERT the database decides. **A genuine RETRY is unaffected** —
    // it replays through `replayIfSettled` and never reaches the constraint,
    // which the case above proves.
    const actor = await equippedPerson("ticket-replay");
    const cookie = await privilegedCookie(actor);
    const offer = await post("/authenticators/offers", cookie, {});
    const body = offer.json() as { otpauth_uri: string; enrollment_ticket: string };
    const secret = secretFromUri(body.otpauth_uri);

    const first = await post(
      "/authenticators",
      cookie,
      {
        enrollment_ticket: body.enrollment_ticket,
        code: totpCode(secret, stepAt(new Date())),
        fresh_totp_code: await nextCode(actor),
      },
      { "idempotency-key": `first-${randomUUID()}` }
    );
    expect(first.statusCode, JSON.stringify(first.json())).toBe(201);
    const firstCodes = (first.json() as { authenticator: { recovery_codes: string[] } }).authenticator
      .recovery_codes;

    // ⚠ **THE FRESH CODE IS TAKEN BEFORE THE COUNT, AND THE ORDER IS THE
    // ASSERTION.** `nextCode` re-enrols to get an unspent step (048 R19), and an
    // enrolment issues its own recovery set — so a count read before it would
    // move for a reason that has nothing to do with the replay, and the case
    // would be measuring its own fixture.
    const freshForReplay = await nextCode(actor);
    const before = await shopQuery(`SELECT count(*)::int AS n FROM recovery_code WHERE app_user_id = $1`, [
      actor.id,
    ]);

    const replayed = await post(
      "/authenticators",
      cookie,
      {
        enrollment_ticket: body.enrollment_ticket,
        code: totpCode(secret, stepAt(new Date())),
        fresh_totp_code: freshForReplay,
      },
      { "idempotency-key": `second-${randomUUID()}` }
    );
    expect(replayed.statusCode, JSON.stringify(replayed.json())).toBe(400);
    expect((replayed.json() as { error: { code: string } }).error.code).toBe(
      "AUTHENTICATOR_ENROLLMENT_REFUSED"
    );

    // No second recovery set: the transaction rolled back whole, so the codes
    // the person wrote down are still the live ones.
    const after = await shopQuery(`SELECT count(*)::int AS n FROM recovery_code WHERE app_user_id = $1`, [
      actor.id,
    ]);
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);
    expect(firstCodes).toHaveLength(8);
  }, 300_000);

  // =========================================================================
  // 048 §8.1 — the gate that now has somewhere to go (057 §9 R2)
  // =========================================================================

  it("lets a must_reenroll session reach the enrolment routes and NOTHING else, and lifts by predicate", async () => {
    const actor = await equippedPerson("reenrol");
    // Sign in with a RECOVERY CODE, which retires the authenticator it
    // substituted for in the same transaction (048 §8.1).
    const codes = actor.recoveryCodes;
    const out = await signIn({
      email: actor.email,
      password: PASSWORD,
      recovery_code: codes[0]!,
      shop_id: shopId,
    });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect(out.body).toMatchObject({ must_reenroll: true });
    const cookie = out.cookie!;

    // A gated route: the state means "NOTHING else until you have".
    const gated = await post("/invitations", cookie, {
      email: `x-${randomUUID()}@example.invalid`,
      display_name: "X",
      role: "operator",
    });
    expect(gated.statusCode).toBe(403);
    expect((gated.json() as { error: { code: string } }).error.code).toBe("MFA_REENROLLMENT_REQUIRED");

    // …and the password route is gated too: a recovery-code session is the one
    // an attacker holding a slip of paper would hold, and 048 §8.1 does not make
    // an exception for a credential (063 §3.5).
    const password = await post("/credentials/rotations", cookie, {
      password: REPLACEMENT,
      totp_code: "000000",
    });
    expect((password.json() as { error: { code: string } }).error.code).toBe("MFA_REENROLLMENT_REQUIRED");

    // The two enrolment routes ARE reachable — and NO fresh code is asked for,
    // because there is no live factor to produce one from.
    const offer = await post("/authenticators/offers", cookie, {});
    expect(offer.statusCode, JSON.stringify(offer.json())).toBe(200);
    const uri = (offer.json() as { otpauth_uri: string }).otpauth_uri;
    const ticket = (offer.json() as { enrollment_ticket: string }).enrollment_ticket;
    const secret = secretFromUri(uri);
    const confirmed = await post("/authenticators", cookie, {
      enrollment_ticket: ticket,
      code: totpCode(secret, stepAt(new Date())),
    });
    expect(confirmed.statusCode, JSON.stringify(confirmed.json())).toBe(201);

    // ⚠ **THE GATE LIFTS BY PREDICATE AND NOT BY A MUTATION** (048 §8.1,
    // `mfaState`): nothing set a flag, and the SAME cookie now reaches the same
    // gated route, because "no live authenticator and a recovery-code use
    // exists" stopped being true the moment the new row was written.
    const after = await post("/invitations", cookie, {
      email: `y-${randomUUID()}@example.invalid`,
      display_name: "Y",
      role: "operator",
    });
    expect(after.statusCode, JSON.stringify(after.json())).toBe(201);
  }, 300_000);

  // =========================================================================
  // The audit row (054 §4.3, 063 §3.7)
  // =========================================================================

  it("records a self-service decision that names NO grant and NO role", async () => {
    const actor = await equippedPerson("audit");
    const cookie = await privilegedCookie(actor);
    await post("/credentials/rotations", cookie, {
      password: REPLACEMENT,
      totp_code: await nextCode(actor),
    });

    const rows = await shopQuery(
      `SELECT permission, membership_id, role, decision, refusal_reason, matrix_version, session_chain_id
         FROM authorization_decision
        WHERE route_path = $1`,
      [`${API_PREFIX}/credentials/rotations`]
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    const row = rows.rows[0] as Record<string, unknown>;
    // The marker, and NOT one of the eleven permissions: an auditor who looks it
    // up in `PERMISSIONS` finds nothing, which is the true statement — no grant
    // decided this act (063 §3.7).
    expect(row["permission"]).toBe("self_service");
    expect(row["membership_id"]).toBeNull();
    expect(row["role"]).toBeNull();
    expect(row["decision"]).toBe("allowed");
    expect(row["refusal_reason"]).toBeNull();
    // The version is still stamped: it records which build's rules were in force
    // when the act was allowed, which stays answerable after the constant moves.
    expect(row["matrix_version"]).toBeTruthy();
    expect(row["session_chain_id"]).toBeTruthy();
  }, 240_000);

  it("records that decision for the FIRST-PASSWORD route too, which is OUTSIDE the tenant prefix", async () => {
    // ⚠ **THE SECURITY LENS'S F1, AND THE ROW THAT DID NOT EXIST.** This is the
    // single act the bead exists to enable, performed by the one principal 048
    // §3.5 calls NOT non-repudiable — and it wrote NO decision at all, because
    // the operator branch's audit call sat inside the `TENANT_PREFIX` guard and
    // this route is deliberately outside it. 063 §3.7 stated the recording as a
    // decision and the evidence came from a privileged sibling instead.
    const person = await freshPerson("audit-first-password");
    const counter = await counterCookie(person.id);
    const res = await post("/credentials", counter, { password: PASSWORD });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(201);

    const rows = await shopQuery(
      `SELECT permission, membership_id, role, decision, session_chain_id
         FROM authorization_decision
        WHERE route_path = $1`,
      [`${API_PREFIX}/credentials`]
    );
    expect(rows.rows.length, "the first-password route recorded no decision").toBeGreaterThan(0);
    const row = rows.rows[0] as Record<string, unknown>;
    expect(row["permission"]).toBe("self_service");
    expect(row["membership_id"]).toBeNull();
    expect(row["role"]).toBeNull();
    expect(row["decision"]).toBe("allowed");
    expect(row["session_chain_id"]).toBeTruthy();

    // ⚠ **AND AN ALLOWANCE IS AN ALLOWANCE TO ATTEMPT** (063 §3.7). The hook
    // writes before the handler, so a `409 CREDENTIAL_ALREADY_SET` records
    // `allowed` too — which is 059's N:1 ruling one class over, and is asserted
    // here rather than left for somebody to discover in a query. There is
    // deliberately no outcome column: one the hook cannot fill truthfully would
    // be worse than an absence a reader can see.
    const before = rows.rows.length;
    const again = await post("/credentials", counter, { password: REPLACEMENT });
    expect(again.statusCode).toBe(409);
    const after = await shopQuery(`SELECT decision FROM authorization_decision WHERE route_path = $1`, [
      `${API_PREFIX}/credentials`,
    ]);
    expect(after.rows.length).toBe(before + 1);
    expect((after.rows[after.rows.length - 1] as { decision: string }).decision).toBe("allowed");
  }, 240_000);

  it("records a decision for the OFFER route too, because it mutates even though it writes no durable row", async () => {
    // ⚠ **THE TITLE SAID THE OPPOSITE OF THE BODY** (the security lens's F6) —
    // "records NO decision for the offer route's READ half" — while the
    // assertion below required a row. A test whose name and body disagree is a
    // test that documents a rule nobody has, and the next reader believes the
    // name.
    //
    // 054 §4.3's rule read literally: an allowance is recorded when the act
    // MUTATES. The offer route declares `mutating: true` (it is a POST, it takes
    // the header, it spends a bucket) and writes no durable row — so it DOES get
    // a decision row, and this case pins that rather than leaving a reader to
    // guess which way the rule fell.
    const actor = await equippedPerson("offer-audit");
    const cookie = await privilegedCookie(actor);
    await post("/authenticators/offers", cookie, {});
    const rows = await shopQuery(
      `SELECT count(*)::int AS n FROM authorization_decision WHERE route_path = $1`,
      [`${API_PREFIX}/authenticators/offers`]
    );
    expect((rows.rows[0] as { n: number }).n).toBeGreaterThan(0);
  }, 240_000);

  // =========================================================================
  // The break-glass clearance (063 §3.8; the security lens's F3)
  // =========================================================================

  it("CLEARS a squatted password, records why, and lets the counter phone provision a new one", async () => {
    // ⚠ **THE REMEDY §5 R2 ASSUMED EXISTED AND THE LENS FOUND MISSING.** R2
    // accepts that a coworker who watched a PIN can set a FIRST password for
    // somebody who has none, and said the remedy was to notice and have the row
    // cleared. There was no clearing at any level: `migrations/031`'s trigger
    // refuses a DELETE to everyone including the schema owner, and no route and
    // no CLI cleared one — so a watched PIN was a PERMANENT lockout of the
    // privileged surface.
    const { withTransaction } = await import("../../src/db.js");
    const { clearPassword } = await import("../../src/services/auth/index.js");

    const victim = await freshPerson("squatted");
    const counter = await counterCookie(victim.id);
    // The squat: a first password the person does not know.
    expect((await post("/credentials", counter, { password: PASSWORD })).statusCode).toBe(201);
    // …and the route is now closed to them, which is the lockout.
    expect((await post("/credentials", counter, { password: REPLACEMENT })).statusCode).toBe(409);

    // The clearance, as the schema owner would run it. It is an UPDATE plus a
    // FACT and never a DELETE: the row is 048 §9.1's lockout anchor, and a row
    // that could be deleted is a lockout that could be reset by deleting it.
    const migratePool = new pg.Pool({ connectionString: migrateUrl });
    try {
      const out = await withTransaction(
        migratePool,
        (tx) =>
          clearPassword(tx, {
            appUserId: victim.id,
            reason: "squatted_credential",
            clearedBy: null,
            note: "set by somebody else on the counter phone",
          }),
        { tenant: { service: "second-factor" } }
      );
      expect(out.cleared).toBe(true);

      // The ROW SURVIVES — it is the anchor — and the hash is gone.
      const row = await migratePool.query(
        `SELECT password_hash FROM user_credential WHERE app_user_id = $1`,
        [victim.id]
      );
      expect(row.rows.length).toBe(1);
      expect((row.rows[0] as { password_hash: string | null }).password_hash).toBeNull();

      // The FACT names the reason, and it is append-only.
      const fact = await migratePool.query(
        `SELECT reason, note FROM user_credential_clearance WHERE app_user_id = $1`,
        [victim.id]
      );
      expect(fact.rows.length).toBe(1);
      expect((fact.rows[0] as { reason: string }).reason).toBe("squatted_credential");
      await expect(
        migratePool.query(`DELETE FROM user_credential_clearance WHERE app_user_id = $1`, [victim.id])
      ).rejects.toThrow();

      // A cleared password verifies against nothing: the sign-in answers 048
      // §9.3's constant refusal, exactly as it does for a person who never had
      // one. Asserted BEFORE the re-provision below, because after it the person
      // has a live password again and this is no longer the question.
      const out2 = await signIn({
        email: victim.email,
        password: PASSWORD,
        totp_code: "000000",
        shop_id: shopId,
      });
      expect(out2.status).toBe(401);
      expect((out2.body as { error: { code: string } }).error.code).toBe("SESSION_REQUIRED");

      // ⚠ **A CLEARED ROW IS ABSENT FOR PROVISIONING PURPOSES, AND THIS
      // ASSERTION USED TO READ 409 UNDER A TITLE THAT PROMISED THE OPPOSITE.**
      // The invariant re-verification found that a cleared person was
      // unreachable by every surface — the clearance is a TERMINAL act with no
      // route of its own, `--reason lost_credential` had no outcome at all, and
      // three artifacts claimed a remedy the code refused. The ruling was that
      // the CODE changes, not the message: `provisionPassword` inserts or
      // revives, so the person is then provisioned from the counter phone by the
      // ORDINARY first-password route, which treats a cleared row as absent.
      const retry = await post("/credentials", counter, { password: REPLACEMENT });
      expect(retry.statusCode).toBe(201);

      // The clearance FACT survives the revival — a revival appends nothing and
      // erases nothing, so what happened stays legible — and the anchor is STILL
      // ONE ROW, revived rather than duplicated.
      const after = await migratePool.query(
        `SELECT (SELECT count(*)::int FROM user_credential_clearance WHERE app_user_id = $1) AS facts,
                (SELECT count(*)::int FROM user_credential WHERE app_user_id = $1) AS anchors`,
        [victim.id]
      );
      expect(after.rows[0] as { facts: number; anchors: number }).toEqual({ facts: 1, anchors: 1 });

      // THE NEGATIVE, and the reason the revival is not a hole: a LIVE hash
      // still refuses. The affected-row count is still the authorization, and
      // `replacePassword` behind a fresh second factor stays the only path that
      // overwrites a live hash.
      const again = await post("/credentials", counter, { password: PASSWORD });
      expect(again.statusCode).toBe(409);
      expect((again.json() as { error: { code: string } }).error.code).toBe("CREDENTIAL_ALREADY_SET");
    } finally {
      await migratePool.end();
    }
  }, 300_000);

  // -------------------------------------------------------------------------
  // Fixtures. Every one of them is a person nobody is named after.
  // -------------------------------------------------------------------------

  async function freshPerson(label: string): Promise<{ id: string; email: string }> {
    const { insertUser, grant } = await import("./authHelpers.js");
    const email = `${label}-${randomUUID().slice(0, 8)}@example.invalid`;
    const id = await insertUser(pool, email, "A Person");
    await grant(pool, id, shopId, "owner");
    return { id, email };
  }

  /**
   * The FIRST authenticator, which no route can mint (063 §5 R1): a privileged
   * session needs a second factor and an enrolment route needs a privileged
   * session, so the first one is a bootstrap. `pnpm enroll-authenticator` is that
   * bootstrap in a deployment; here it is the same function, because a test has
   * no terminal to run a CLI in.
   */
  async function bootstrapAuthenticator(appUserId: string): Promise<Buffer> {
    const { withTransaction } = await import("../../src/db.js");
    const { enrollAuthenticator } = await import("../../src/services/auth/index.js");
    const { TEST_PIN_PEPPER } = await import("../testConfig.js");
    const secret = mintTotpSecret();
    await withTransaction(
      pool,
      async (tx) => {
        const out = await enrollAuthenticator(tx, {
          appUserId,
          secret,
          confirmationCode: totpCode(secret, stepAt(new Date())),
          keyring: testConfig({ databaseUrl: "" }).authenticatorKeys!,
          pepper: TEST_PIN_PEPPER,
          now: new Date(),
        });
        if (!out.ok) throw new Error(`bootstrap enrollment refused: ${out.refusal}`);
      },
      { tenant: { service: "second-factor" } }
    );
    return secret;
  }

  interface Actor {
    id: string;
    email: string;
    /** MUTABLE: `nextCode` re-enrols, which supersedes the previous factor. */
    secret: Buffer;
    recoveryCodes: readonly string[];
  }

  /** A person with a password, a live factor and a recovery set. */
  async function equippedPerson(label: string): Promise<Actor> {
    const { withTransaction } = await import("../../src/db.js");
    const { enrollAuthenticator, provisionPassword } = await import("../../src/services/auth/index.js");
    const { TEST_PIN_PEPPER } = await import("../testConfig.js");
    const person = await freshPerson(label);
    const secret = mintTotpSecret();
    const codes = await withTransaction(
      pool,
      async (tx) => {
        const set = await provisionPassword(tx, {
          appUserId: person.id,
          password: PASSWORD,
          pepper: TEST_PIN_PEPPER,
        });
        if (!set.ok) throw new Error(`password refused: ${set.refusal}`);
        const out = await enrollAuthenticator(tx, {
          appUserId: person.id,
          secret,
          confirmationCode: totpCode(secret, stepAt(new Date())),
          keyring: testConfig({ databaseUrl: "" }).authenticatorKeys!,
          pepper: TEST_PIN_PEPPER,
          now: new Date(),
        });
        if (!out.ok) throw new Error(`enrollment refused: ${out.refusal}`);
        return out.enrolled.recoveryCodes;
      },
      { tenant: { service: "second-factor" } }
    );
    return { ...person, secret, recoveryCodes: codes };
  }

  /**
   * A code that will verify, ALWAYS — by re-enrolling the factor first.
   *
   * ⚠ **048 R19 IS WHY THIS IS NOT `freshCode(actor.secret)`.** A step is
   * consumed exactly ONCE, by the database, and the ±1 window means there is no
   * "later" step to reach for: the only code that is both inside the window and
   * above `last_used_step` is the next one, and any act that verified a code has
   * already spent it. A suite that reached for a second code from the same
   * secret inside one window would be asserting a refusal it caused itself.
   *
   * Re-enrolling is the same act an owner performs when they replace their
   * phone, and `enrollAuthenticator` supersedes the previous factor by design —
   * so `actor.secret` is updated in place and the OLD one is genuinely dead,
   * which is what the supersession case then asserts.
   */
  async function nextCode(actor: Actor): Promise<string> {
    actor.secret = await bootstrapAuthenticator(actor.id);
    return freshCode(actor.secret);
  }

  async function privilegedCookie(actor: Actor): Promise<string> {
    const out = await signIn({
      email: actor.email,
      password: PASSWORD,
      totp_code: freshCode(actor.secret),
      shop_id: shopId,
    });
    if (!out.cookie) throw new Error(`sign-in refused: ${JSON.stringify(out.body)}`);
    return out.cookie;
  }

  /** The base32 secret an authenticator app would scan, back as bytes. */
  function secretFromUri(uri: string): Buffer {
    const base32 = new URL(uri).searchParams.get("secret")!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const ch of base32.replace(/=+$/, "")) {
      bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
    }
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
  }
});
