// L4: **the FIRST factor, the third session, and the two acts they un-pend** —
// against a real Postgres and a real server.
//
// Bead: longbox-e5b.3.21 (alias E03-D11). Docs: 000-docs/057; 048 §4.1, §7, §8,
// §9.1, §9.3, I11, I15; 054 §3–§5; 019 T24 (non-waivable).
//
// ============================================================================
// WHY THESE CASES NEED A DATABASE AND THE UNIT SUITE COULD NOT HAVE THEM
// ============================================================================
//
// `tests/first-factor.test.ts` proves which statement each function issues. It
// cannot prove that `FOR UPDATE` on `user_credential` serialises two sign-ins,
// that a shared budget really is one budget across three methods, that a wrong
// tenant answers byte-identically to an absent one, or that an operator session
// cannot reach a privileged route however privileged its holder is. Every one of
// those is a property of the running system, and 048 §11's own note is the
// reason they are written here rather than serially in the unit lane: *"a
// concurrency invariant asserted serially is an invariant that passes for the
// wrong reason."*
//
// **No shop's name and no person's name** (048 §7.1's fixture rule): every value
// is obviously synthetic.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { serviceDb, withTransaction } from "../../src/db.js";
import { API_PREFIX } from "../../src/contracts/v1/schemas.js";
import {
  PRIVILEGED_COOKIE,
  enrollAuthenticator,
  liveAuthenticator,
  mintTotpSecret,
  provisionPassword,
  replacePassword,
  stepAt,
  totpCode,
} from "../../src/services/auth/index.js";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { grant, insertUser, seedIdentity, writeHeaders, type SeededIdentity } from "./authHelpers.js";
import { TEST_PIN_PEPPER, testConfig } from "../testConfig.js";

const dbUp = await probeDb();
const UPLOADS_DIR = "tests/.tmp-privileged-uploads";
/** Obviously synthetic, and long enough for the floor. */
const PASSWORD = "not-a-real-password-0000";

describe.skipIf(!dbUp)("the privileged session (048 §4.1, §12.4 row 3a)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;
  let otherShopId: string;
  let identity: SeededIdentity;
  let ownerSecret: Buffer;
  let managerId: string;
  let managerSecret: Buffer;
  let secondLocationId: string;

  const shopQuery = (sql: string, values?: unknown[]): Promise<pg.QueryResult> =>
    asShop(pool, shopId).query(sql, values);

  /** Give one person a password and a live TOTP factor, and hand back the secret. */
  async function equip(appUserId: string): Promise<Buffer> {
    const secret = mintTotpSecret();
    await withTransaction(
      pool,
      async (tx) => {
        // ⚠ **PROVISION, THEN REPLACE — because E03-D24 split the upsert and the
        // ROW COUNT is now the enforcement** (063 §3.3, the data-model lens's
        // H4). This helper re-equips the SAME person several times to get an
        // unspent TOTP step (048 R19), and the old shared `setPassword` silently
        // overwrote. `provisionPassword` refuses `already_set` instead, which is
        // the point of the split — so the fixture does what a real person does:
        // set it the first time, replace it after.
        const provisioned = await provisionPassword(tx, {
          appUserId,
          password: PASSWORD,
          pepper: TEST_PIN_PEPPER,
        });
        if (!provisioned.ok && provisioned.refusal !== "already_set") {
          throw new Error(`password refused: ${provisioned.refusal}`);
        }
        if (!provisioned.ok) {
          const replaced = await replacePassword(tx, {
            appUserId,
            password: PASSWORD,
            pepper: TEST_PIN_PEPPER,
          });
          if (!replaced.ok) throw new Error(`password refused: ${replaced.refusal}`);
        }
        const enrolled = await enrollAuthenticator(tx, {
          appUserId,
          secret,
          confirmationCode: totpCode(secret, stepAt(new Date())),
          keyring: testConfig({ databaseUrl: "" }).authenticatorKeys!,
          pepper: TEST_PIN_PEPPER,
          now: new Date(),
        });
        if (!enrolled.ok) throw new Error(`enrollment refused: ${enrolled.refusal}`);
      },
      { tenant: { service: "second-factor" } }
    );
    return secret;
  }

  /**
   * A code the verification will accept, from a step the enrollment has not
   * already spent.
   *
   * ⚠ **THE OFFSET IS ALWAYS ONE, AND THAT IS NOT A CHOICE** (048 §4.3). A code
   * is valid for its own step and ONE step either side, and the enrollment
   * SPENDS the step it was confirmed at — so the only code that is both inside
   * the window and above `last_used_step` is the next one. A helper that walked
   * further to "find a fresh step" would be generating codes the verifier
   * correctly refuses, which is how a suite ends up asserting a refusal it
   * caused itself.
   */
  function freshCode(secret: Buffer): { code: string; at: Date } {
    const at = new Date(Date.now() + 30_000);
    return { code: totpCode(secret, stepAt(at)), at };
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

  /**
   * A live privileged cookie for the owner, CACHED across cases.
   *
   * Two things are going on and both are deliberate.
   *
   * **It RE-ENROLS a fresh authenticator when it does sign in**, and the reason
   * is 048 R19 rather than convenience: a step is consumed exactly once, so two
   * sign-ins inside one thirty-second window cannot both present a valid unspent
   * code, and the ±1 window means there is no "later" step to reach for. A fresh
   * factor is the same act an owner performs when they replace their phone, and
   * `enrollAuthenticator` supersedes the previous one by design.
   *
   * **And it CACHES, because that enrollment is expensive on purpose.** Each one
   * costs an argon2id for the password plus one per recovery code — 048 §8.1's
   * batch of eight — which is a deliberate cost of the design and not a slow
   * test. A privileged session lives half an hour and rotates every five minutes
   * (048 §4.1's freshness window), so reusing one across cases is what a real
   * owner does; a case that ENDS the chain invalidates the cache rather than
   * leaving the next case to fail on a revoked cookie.
   */
  let cachedOwnerCookie: string | undefined;

  async function ownerCookie(): Promise<string> {
    if (cachedOwnerCookie) return cachedOwnerCookie;
    ownerSecret = await equip(identity.ownerId);
    const out = await signIn({
      email: ownerEmail,
      password: PASSWORD,
      totp_code: freshCode(ownerSecret).code,
      shop_id: shopId,
    });
    if (!out.cookie) throw new Error(`sign-in refused: ${JSON.stringify(out.body)}`);
    cachedOwnerCookie = out.cookie;
    return out.cookie;
  }

  /** `ownerCookie`'s twin for the location-scoped manager, and for the same reason. */
  async function managerSignIn(
    extra: Record<string, unknown> = {}
  ): Promise<{ status: number; cookie?: string; body: Record<string, unknown> }> {
    managerSecret = await equip(managerId);
    return signIn({
      email: managerEmail,
      password: PASSWORD,
      totp_code: freshCode(managerSecret).code,
      shop_id: shopId,
      ...extra,
    });
  }

  let ownerEmail: string;
  let managerEmail: string;

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_privileged_session");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Privileged Shop", slug: `priv-${Date.now()}` });
    otherShopId = await seedShop(ownerPool, { name: "Other Shop", slug: `other-${Date.now()}` });
    await ownerPool.end();

    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    app = await buildApp(pool, testConfig({ databaseUrl: appUrl(migrateUrl), uploadsDir: UPLOADS_DIR }));

    identity = await seedIdentity(pool, shopId);
    const owner = await shopQuery(`SELECT email FROM app_user WHERE id = $1`, [identity.ownerId]);
    ownerEmail = (owner.rows[0] as { email: string }).email;
    ownerSecret = await equip(identity.ownerId);

    const second = await shopQuery(
      `INSERT INTO location (shop_id, kind, name) VALUES ($1,'store','Second counter') RETURNING id`,
      [shopId]
    );
    secondLocationId = (second.rows[0] as { id: string }).id;

    managerEmail = `manager-${Date.now()}@example.invalid`;
    managerId = await insertUser(pool, managerEmail, "Manager Three");
    // A LOCATION-scoped manager at the second counter: the case 057 §4.4 exists
    // for, and the one a privileged session standing nowhere cannot reach.
    await shopQuery(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, location_id, role)
       VALUES ($1,$2,'location',$3,'manager')`,
      [managerId, shopId, secondLocationId]
    );
    managerSecret = await equip(managerId);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  // =========================================================================
  // Signing in
  // =========================================================================

  it("issues a privileged session for a password and a TOTP code, and sets its OWN cookie", async () => {
    const out = await signIn({
      email: ownerEmail,
      password: PASSWORD,
      totp_code: freshCode(ownerSecret).code,
      shop_id: shopId,
    });
    expect(out.status).toBe(201);
    expect(out.cookie).toBeDefined();
    expect(out.body).toMatchObject({ must_reenroll: false });
    // No role, no permission list and no expiry on the wire (022 P3, 042 I7).
    expect(JSON.stringify(out.body)).not.toContain("owner");

    const row = await shopQuery(
      `SELECT kind, device_id, device_credential_id, location_id, app_user_id
         FROM app_session WHERE kind = 'privileged' AND app_user_id = $1`,
      [identity.ownerId]
    );
    expect(row.rows.length).toBeGreaterThan(0);
    const session = row.rows[0] as Record<string, unknown>;
    expect(session["device_id"]).toBeNull();
    expect(session["device_credential_id"]).toBeNull();
    expect(session["location_id"]).toBeNull();
  }, 120_000);

  it("REFUSES a wrong password, a wrong code, and an unknown address with ONE answer", async () => {
    const wrongPassword = await signIn({
      email: ownerEmail,
      password: `${PASSWORD}-wrong`,
      totp_code: freshCode(ownerSecret).code,
      shop_id: shopId,
    });
    const wrongCode = await signIn({
      email: ownerEmail,
      password: PASSWORD,
      totp_code: "000000",
      shop_id: shopId,
    });
    const unknown = await signIn({
      email: `nobody-${randomUUID()}@example.invalid`,
      password: PASSWORD,
      totp_code: "000000",
      shop_id: shopId,
    });
    // 048 §9.3: one code, no `details`, byte-identical. A helpful error at an
    // authentication boundary is a query interface over the user table.
    for (const out of [wrongPassword, wrongCode, unknown]) {
      expect(out.status).toBe(401);
      expect(out.cookie).toBeUndefined();
      expect((out.body as { error: { code: string } }).error.code).toBe("SESSION_REQUIRED");
      // `details` is the envelope's own empty object here, never a diagnosis:
      // 042 §4.1 always emits the key and 048 §9.3 requires it to carry nothing
      // that could tell the three refusals apart.
      expect((out.body as { error: { details?: unknown } }).error.details).toEqual({});
    }
    const [a, b, c] = [wrongPassword, wrongCode, unknown].map((o) =>
      JSON.stringify({ ...o.body, error: { ...(o.body as { error: object }).error, correlation_id: "x" } })
    );
    expect(a).toBe(b);
    expect(b).toBe(c);
  }, 120_000);

  it("REFUSES a shop the person holds no live membership at, with that same answer", async () => {
    // 019 T24 / 048 §6.5: a person standing at the wrong counter must not learn
    // that the right counter exists — and must not learn that THIS one does.
    const out = await signIn({
      email: ownerEmail,
      password: PASSWORD,
      totp_code: freshCode(ownerSecret).code,
      shop_id: otherShopId,
    });
    expect(out.status).toBe(401);
    expect(out.cookie).toBeUndefined();
    expect((out.body as { error: { code: string } }).error.code).toBe("SESSION_REQUIRED");
  }, 120_000);

  it("REFUSES a person whose only role is `operator` (048 §4.1's table)", async () => {
    const operatorEmail = (await shopQuery(`SELECT email FROM app_user WHERE id = $1`, [identity.operatorId]))
      .rows[0] as { email: string };
    await withTransaction(
      pool,
      (tx) =>
        provisionPassword(tx, {
          appUserId: identity.operatorId,
          password: PASSWORD,
          pepper: TEST_PIN_PEPPER,
        }),
      { tenant: { service: "second-factor" } }
    );
    const out = await signIn({
      email: operatorEmail.email,
      password: PASSWORD,
      totp_code: "000000",
      shop_id: shopId,
    });
    expect(out.status).toBe(401);
    expect(out.cookie).toBeUndefined();
  }, 120_000);

  it("REFUSES both factors together and neither alone (048 R20's shape)", async () => {
    // The schema refuses a body carrying both a TOTP code and a recovery code,
    // and a body carrying neither — "exactly one second factor" is a contract
    // rather than a branch in a service.
    const both = await signIn({
      email: ownerEmail,
      password: PASSWORD,
      totp_code: "000000",
      recovery_code: "ABCDEFGHJK",
      shop_id: shopId,
    });
    const neither = await signIn({ email: ownerEmail, password: PASSWORD, shop_id: shopId });
    for (const out of [both, neither]) {
      expect(out.status).toBe(400);
      expect((out.body as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("REFUSES a cross-site request before it reads a cookie or a body (048 §5.1)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/privileged-sessions`,
      headers: { "sec-fetch-site": "cross-site", "idempotency-key": "k" },
      payload: { email: ownerEmail, password: PASSWORD, totp_code: "000000", shop_id: shopId },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("SESSION_REQUIRED");
  });

  // =========================================================================
  // The budget, shared across three factors (057 §4.5)
  // =========================================================================

  it("shares ONE per-person budget between the password and the second factor", async () => {
    const email = `budget-${Date.now()}@example.invalid`;
    const person = await insertUser(pool, email, "Budget Person");
    await grant(pool, person, shopId, "owner");
    const secret = await equip(person);

    // Four wrong PASSWORDS…
    for (let i = 0; i < 4; i += 1) {
      await signIn({ email, password: "wrong-password-here", totp_code: "000000", shop_id: shopId });
    }
    // Read in the `second-factor` SCOPE and not under a tenant context, because
    // that is where these rows were written and what they are: a failed sign-in
    // by a person who may hold memberships at three shops carries a NULL
    // `shop_id`, and a NULL matches no tenant policy at all (`migrations/020`'s
    // own reasoning for the nullable column).
    const failures = await serviceDb(pool, "second-factor").query(
      `SELECT method, count(*)::int AS n FROM auth_attempt WHERE app_user_id = $1 GROUP BY method`,
      [person]
    );
    expect(failures.rows).toContainEqual({ method: "password", n: 4 });

    // …and now a CORRECT password with a correct code is refused, because the
    // delay those four bought is owed by the PERSON and not by the method. 048
    // §4.3's reason, one factor lower: two budgets is one budget an attacker
    // doubles by alternating.
    const out = await signIn({
      email,
      password: PASSWORD,
      totp_code: freshCode(secret).code,
      shop_id: shopId,
    });
    expect(out.status).toBe(401);
    expect(out.cookie).toBeUndefined();
  }, 120_000);

  // =========================================================================
  // I11 — a privileged surface is unreachable from an operator session
  // =========================================================================

  it("refuses the privileged routes to an OPERATOR session, even for an owner (048 I11)", async () => {
    const { cookieHeader, openDevice, openOperator } = await import("./authHelpers.js");
    const device = await openDevice(pool, identity);
    // The OWNER, on the counter phone, by PIN. 048 §4.1: "an `owner` who is also
    // working the counter holds an operator session by PIN like anybody else, and
    // that session cannot reach an owner surface."
    const operator = await openOperator(pool, device, identity.ownerId);
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invitations`,
      headers: {
        ...writeHeaders(),
        cookie: cookieHeader(device.token, operator.token),
      },
      payload: { email: `x-${randomUUID()}@example.invalid`, display_name: "X", role: "operator" },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("PRIVILEGED_SESSION_REQUIRED");
  });

  it("refuses the privileged routes to no session at all", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/device-enrollment-codes`,
      headers: writeHeaders(),
      payload: { location_id: identity.locationId, device_label: "counter", device_kind: "phone" },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("PRIVILEGED_SESSION_REQUIRED");
  });

  // =========================================================================
  // The two issuance routes
  // =========================================================================

  it("issues an invitation ONCE, records the decision, and never stores the code", async () => {
    const cookie = await ownerCookie();
    const email = `invited-${randomUUID()}@example.invalid`;
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invitations`,
      headers: { ...writeHeaders(), cookie },
      payload: { email, display_name: "Invited Person", role: "operator" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { invitation: { id: string; code?: string } };
    expect(body.invitation.code).toBeDefined();
    const code = body.invitation.code!;

    // Stored NOWHERE, in any form but its digest (048 §7.1).
    const stored = await shopQuery(`SELECT token_digest FROM invitation WHERE id = $1`, [body.invitation.id]);
    expect(stored.rows).toHaveLength(1);
    expect((stored.rows[0] as { token_digest: string }).token_digest).not.toBe(code);
    const anywhere = await shopQuery(
      `SELECT count(*)::int AS n FROM request_idempotency WHERE response_body::text LIKE $1`,
      [`%${code}%`]
    );
    // 057 §4.8 / 042 v1.4.4: the shown-once code travels OUTSIDE the stored
    // body, exactly as a `Set-Cookie` does. A replay must not be able to hand it
    // back and a dump must not contain it.
    expect((anywhere.rows[0] as { n: number }).n).toBe(0);

    // 054 §4.3: a PRIVILEGED permission records its ALLOWANCE whatever surface it
    // came from — and the route's row names the route, not a script.
    const decision = await shopQuery(
      `SELECT route_path, decision FROM authorization_decision
        WHERE permission = 'membership.invite' AND route_method = 'POST'
        ORDER BY decided_at DESC LIMIT 1`
    );
    expect(decision.rows[0]).toMatchObject({
      route_path: `${API_PREFIX}/invitations`,
      decision: "allowed",
    });
  }, 120_000);

  it("replays an invitation retry WITHOUT the code, and writes no second invitation", async () => {
    const cookie = await ownerCookie();
    const email = `replay-${randomUUID()}@example.invalid`;
    const headers = { ...writeHeaders(), cookie };
    const first = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invitations`,
      headers,
      payload: { email, display_name: "Replay Person", role: "operator" },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invitations`,
      headers,
      payload: { email, display_name: "Replay Person", role: "operator" },
    });
    expect(second.statusCode).toBe(201);
    const a = first.json() as { invitation: { id: string; code?: string } };
    const b = second.json() as { invitation: { id: string; code?: string } };
    expect(b.invitation.id).toBe(a.invitation.id);
    // The whole point: the replay is TRUTHFUL. It returns the stored body, which
    // has no code in it, rather than a byte-identical success that would have to
    // have stored a live credential to produce one.
    expect(b.invitation.code).toBeUndefined();
    const count = await shopQuery(`SELECT count(*)::int AS n FROM invitation WHERE app_user_id IS NOT NULL`);
    expect((count.rows[0] as { n: number }).n).toBeGreaterThan(0);
  }, 120_000);

  it("REFUSES an invitation for a role above the inviter's rank, and records the refusal", async () => {
    // The rank check the hook cannot make, because the target role is in the
    // BODY (054 §5). The manager here is location-scoped, so this also exercises
    // the scope half — either way the answer discloses nothing about the ladder.
    const cookie = await ownerCookie();
    const before = await shopQuery(
      `SELECT count(*)::int AS n FROM authorization_decision WHERE decision = 'refused'`
    );
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invitations`,
      headers: { ...writeHeaders(), cookie },
      payload: {
        email: `nope-${randomUUID()}@example.invalid`,
        display_name: "Nope",
        role: "support_break_glass",
      },
    });
    // `support_break_glass` is refused by the SCHEMA before it reaches a role
    // check — 034 §2.6's "never granted at ratification and never grants itself",
    // enforced in three places that fail differently.
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
    const after = await shopQuery(
      `SELECT count(*)::int AS n FROM authorization_decision WHERE decision = 'refused'`
    );
    // A schema refusal is not an authorization decision, and nothing pretends it is.
    expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n);
  }, 120_000);

  it("issues an enrollment code for a location this shop owns", async () => {
    const cookie = await ownerCookie();
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/device-enrollment-codes`,
      headers: { ...writeHeaders(), cookie },
      payload: { location_id: identity.locationId, device_label: "counter phone", device_kind: "phone" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { enrollment: { id: string; code?: string } };
    expect(body.enrollment.code).toBeDefined();
    // 128 bits, Crockford base32, because the device binding is unsatisfiable
    // for an enrollment (048 §7.1a as ruled by E03-D07).
    expect(body.enrollment.code!.replace(/-/g, "").length).toBeGreaterThanOrEqual(26);
  }, 120_000);

  it("REFUSES an enrollment code for another shop's location, as an unknown shop", async () => {
    const cookie = await ownerCookie();
    const other = await asShop(pool, otherShopId).query(
      `INSERT INTO location (shop_id, kind, name) VALUES ($1,'store','Elsewhere') RETURNING id`,
      [otherShopId]
    );
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/device-enrollment-codes`,
      headers: { ...writeHeaders(), cookie },
      payload: {
        location_id: (other.rows[0] as { id: string }).id,
        device_label: "somewhere else",
        device_kind: "phone",
      },
    });
    // ONE code for the ceiling and for an unknown location, so the route is not
    // an oracle over which location ids exist (019 T24).
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe("ENROLLMENT_CODE_REFUSED");
  }, 120_000);

  // =========================================================================
  // The location a privileged session may name (057 §4.4)
  // =========================================================================

  it("lets a LOCATION-scoped manager reach a location-scoped act only by naming the location", async () => {
    // Without the location, `authorize()` refuses: a grant that is valid
    // somewhere does not reach an act from nowhere. This is fail-closed and it is
    // the reason the sign-in accepts an optional `location_id` at all.
    const nowhere = await managerSignIn();
    expect(nowhere.status).toBe(201);
    const refused = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/device-enrollment-codes`,
      headers: { ...writeHeaders(), cookie: nowhere.cookie! },
      payload: { location_id: secondLocationId, device_label: "phone", device_kind: "phone" },
    });
    // A location-scope refusal answers as an ABSENT SHOP, byte-identical to a
    // caller with no membership at all (054 §3.3, 019 T24).
    expect(refused.statusCode).toBe(404);
    expect((refused.json() as { error: { code: string } }).error.code).toBe("SHOP_NOT_FOUND");

    const somewhere = await managerSignIn({ location_id: secondLocationId });
    expect(somewhere.status).toBe(201);
    const allowed = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/device-enrollment-codes`,
      headers: { ...writeHeaders(), cookie: somewhere.cookie! },
      payload: { location_id: secondLocationId, device_label: "phone", device_kind: "phone" },
    });
    expect(allowed.statusCode).toBe(201);
  }, 120_000);

  it("REFUSES a sign-in naming a location the person's grant does not reach", async () => {
    // The manager is granted at the SECOND counter; naming the FIRST is a scope
    // claim, and it answers with §9.3's one code like every other refusal here.
    const out = await managerSignIn({ location_id: identity.locationId });
    expect(out.status).toBe(401);
    expect(out.cookie).toBeUndefined();
  }, 120_000);

  // =========================================================================
  // Ending it
  // =========================================================================

  it("ends the chain by a FACT, and the next request is refused", async () => {
    const cookie = await ownerCookie();
    // This case REVOKES what the cache holds, so the cache is dropped here
    // rather than leaving the next case to fail on a cookie this one killed.
    cachedOwnerCookie = undefined;
    const ended = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/privileged-sessions/end`,
      headers: { ...writeHeaders(), cookie },
      payload: {},
    });
    expect(ended.statusCode).toBe(200);
    const after = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invitations`,
      headers: { ...writeHeaders(), cookie },
      payload: { email: `after-${randomUUID()}@example.invalid`, display_name: "After", role: "operator" },
    });
    expect(after.statusCode).toBe(401);
    expect((after.json() as { error: { code: string } }).error.code).toBe("PRIVILEGED_SESSION_REQUIRED");
    // A revocation, never an UPDATE: 048 §3.3's derived liveness applies to the
    // third kind unchanged.
    const revocations = await shopQuery(
      `SELECT reason FROM app_session_revocation WHERE reason = 'signed_out'`
    );
    expect(revocations.rows.length).toBeGreaterThan(0);
  }, 120_000);

  // =========================================================================
  // I15's first two cases, inherited by this bead (048 §12.4 row 3a)
  // =========================================================================

  it("REFUSES a recovery code without the password, and in place of it (048 R20)", async () => {
    const email = `recovery-${Date.now()}@example.invalid`;
    const person = await insertUser(pool, email, "Recovery Person");
    await grant(pool, person, shopId, "owner");
    const secret = mintTotpSecret();
    let codes: readonly string[] = [];
    await withTransaction(
      pool,
      async (tx) => {
        const set = await provisionPassword(tx, {
          appUserId: person,
          password: PASSWORD,
          pepper: TEST_PIN_PEPPER,
        });
        if (!set.ok) throw new Error("password refused");
        const enrolled = await enrollAuthenticator(tx, {
          appUserId: person,
          secret,
          confirmationCode: totpCode(secret, stepAt(new Date())),
          keyring: testConfig({ databaseUrl: "" }).authenticatorKeys!,
          pepper: TEST_PIN_PEPPER,
          now: new Date(),
        });
        if (!enrolled.ok) throw new Error("enrollment refused");
        codes = enrolled.enrolled.recoveryCodes;
      },
      { tenant: { service: "second-factor" } }
    );

    // (i) a recovery code WITHOUT the password: the schema requires a password,
    // so the request never reaches a credential test at all.
    const noPassword = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/privileged-sessions`,
      headers: writeHeaders(),
      payload: { email, recovery_code: codes[0], shop_id: shopId },
    });
    expect(noPassword.statusCode).toBe(400);

    // (ii) a recovery code IN PLACE OF the password: the same shape, refused for
    // the same reason — there is no field it could occupy.
    const asPassword = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/privileged-sessions`,
      headers: writeHeaders(),
      payload: { email, password: codes[0], totp_code: "000000", shop_id: shopId },
    });
    expect(asPassword.statusCode).toBe(401);
    expect(asPassword.headers["set-cookie"]).toBeUndefined();

    // …and the correct pair works, retires the factor, and says so on the wire.
    const out = await signIn({ email, password: PASSWORD, recovery_code: codes[1], shop_id: shopId });
    expect(out.status).toBe(201);
    expect(out.body).toMatchObject({ must_reenroll: true });
    expect(await liveAuthenticator(pool, person)).toBeUndefined();

    // 048 §8.1: the session it yields "can reach NOTHING else until it has"
    // re-enrolled — a predicate over facts, refused on every route but the
    // sign-out.
    const refused = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/invitations`,
      headers: { ...writeHeaders(), cookie: out.cookie! },
      payload: { email: `x-${randomUUID()}@example.invalid`, display_name: "X", role: "operator" },
    });
    expect(refused.statusCode).toBe(403);
    expect((refused.json() as { error: { code: string } }).error.code).toBe("MFA_REENROLLMENT_REQUIRED");
    const out2 = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/privileged-sessions/end`,
      headers: { ...writeHeaders(), cookie: out.cookie! },
      payload: {},
    });
    expect(out2.statusCode).toBe(200);
  }, 120_000);
});
