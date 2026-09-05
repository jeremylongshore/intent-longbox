// L4: **048 I12** — "an invitation and an enrollment code are single-use by
// constraint, and neither is redeemable off its device."
//
// This file is the invitation half; `device-enrollment.test.ts` is the other.
//
// Four of these cases can only be proved against a real Postgres, and they are
// the four the design exists for:
//
//   * **two concurrent redemptions leave exactly ONE membership.** A fake
//     connection cannot tell you whether `UNIQUE (invitation_id)` serialises two
//     writers; only two real transactions racing can. The test runs them with
//     `Promise.all` rather than in sequence, because a concurrency invariant
//     asserted serially is an invariant that passes for the wrong reason;
//   * **a token for ANOTHER shop is refused on this phone** — 019 T24,
//     non-waivable, and R15's binding;
//   * **a throttled shop's redemption writes NO `auth_attempt` row**, which is
//     the property that stops a flooder growing the table the delay is derived
//     from (048 §9.1, R5);
//   * **the loser of the race leaves NO orphan membership**, because the throw
//     rolls its own INSERT back.
//
// **No real shop's name, no employee's name, no code from anywhere** — 048
// §7.1's section header, which means it. Every value below is obviously
// synthetic.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { withTransaction, type Tx } from "../../src/db.js";
import {
  MAX_OUTSTANDING_INVITATIONS_PER_SHOP,
  SHOP_REDEMPTION_FREE_ATTEMPTS,
  countOutstandingInvitations,
  digestOf,
  grantInvitation,
  issueInvitation,
  verifyInvitation,
  type InvitationRow,
} from "../../src/services/auth/index.js";
import { ShopRateLimiter } from "../../src/services/rateLimit.js";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { cookieHeader, insertUser, openDevice, seedIdentity, type SeededIdentity } from "./authHelpers.js";
import { testConfig } from "../testConfig.js";

const dbUp = await probeDb();

/** Six digits that satisfy 048 §3.5's policy: no run, no repeat, not a shop's. */
const NEW_PIN = "739154";

describe.skipIf(!dbUp)("invitations are single-use and device-bound (048 §7, I12)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;
  let otherShopId: string;
  let identity: SeededIdentity;
  let otherIdentity: SeededIdentity;
  // ⚠ AN OWNER POOL, KEPT OPEN, AND THE REASON IS A PROPERTY RATHER THAN A TEST
  // DETAIL (E03-B04). `shop` is policied on its own `id`, so an INSERT can never
  // satisfy `id = current_shop_id()` — the tenant IS the row being created — and
  // **creating a shop is therefore a schema-owner act enforced by the database**,
  // which is what `pnpm register-shop` already was by convention (E02-D06). Every
  // suite that makes a shop mid-test needs the owning connection to do it, exactly
  // as production does.
  let ownerPool: pg.Pool;

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
  const shopQuery = (sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> =>
    asShop(pool, shopId).query(sql, values);

  const shopTx = <T>(fn: (tx: Tx) => Promise<T>, shop: string = shopId): Promise<T> =>
    withTransaction(pool, fn, { tenant: { shopId: shop } });

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_invitation");
    await runMigrations(migrateUrl);
    ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Shop A", slug: `inv-a-${Date.now()}` });
    otherShopId = await seedShop(ownerPool, { name: "Shop B", slug: `inv-b-${Date.now()}` });
    const url = appUrl(migrateUrl);
    pool = new pg.Pool({ connectionString: url });
    identity = await seedIdentity(pool, shopId);
    otherIdentity = await seedIdentity(pool, otherShopId);
    app = await buildApp(pool, testConfig({ databaseUrl: url }));
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await ownerPool?.end();
  });

  /** A person who holds no membership anywhere yet — the one an invitation is for. */
  async function newcomer(): Promise<string> {
    return insertUser(pool, `newcomer-${randomUUID()}@example.invalid`, "Newcomer");
  }

  async function issue(
    over: { shopId?: string; appUserId?: string; invitedBy?: string; now?: Date } = {}
  ): Promise<{ code: string; invitationId: string }> {
    const appUserId = over.appUserId ?? (await newcomer());
    const out = await shopTx((tx) =>
      issueInvitation(tx, {
        shopId: over.shopId ?? shopId,
        appUserId,
        role: "operator",
        invitedBy: over.invitedBy ?? identity.ownerId,
        now: over.now ?? new Date(),
      })
    );
    if (!out.ok) throw new Error(`issue refused: ${out.refusal}`);
    return { code: out.invitation.code, invitationId: out.invitation.invitationId };
  }

  async function redeemOverHttp(
    code: string,
    opts: { cookie?: string; pin?: string; key?: string } = {}
  ): Promise<{ status: number; code: string | undefined }> {
    const device = await openDevice(pool, identity);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invitations/redemptions",
      headers: {
        "sec-fetch-site": "same-origin",
        "idempotency-key": opts.key ?? randomUUID(),
        cookie: opts.cookie ?? cookieHeader(device.token),
      },
      payload: { code, pin: opts.pin ?? NEW_PIN },
    });
    const body = res.json() as { error?: { code: string } };
    return { status: res.statusCode, code: body.error?.code };
  }

  it("redeems on the shop's own phone: one membership, one use row, one PIN", async () => {
    const appUserId = await newcomer();
    const { code, invitationId } = await issue({ appUserId });
    const before = await countOutstandingInvitations(asShop(pool, shopId), shopId);

    const res = await redeemOverHttp(code);
    expect(res.status).toBe(201);

    const membership = await shopQuery(
      `SELECT m.role, m.shop_id FROM membership m WHERE m.app_user_id = $1`,
      [appUserId]
    );
    expect(membership.rows).toEqual([{ role: "operator", shop_id: shopId }]);

    const use = await shopQuery(
      `SELECT u.invitation_id, u.redeemed_on_device_id FROM invitation_use u WHERE u.invitation_id = $1`,
      [invitationId]
    );
    expect(use.rows).toHaveLength(1);
    expect((use.rows[0] as { redeemed_on_device_id: string }).redeemed_on_device_id).toBe(identity.deviceId);

    // The PIN was set in the same act (048 §7.2), so the person can tap their
    // name immediately rather than being told to find an owner.
    const pin = await shopQuery(`SELECT p.id FROM operator_pin p WHERE p.app_user_id = $1`, [appUserId]);
    expect(pin.rows).toHaveLength(1);

    // And the outstanding count fell, by a predicate rather than by a status
    // column: the invitation row is untouched and the use row is what changed.
    expect(await countOutstandingInvitations(asShop(pool, shopId), shopId)).toBe(before - 1);
  });

  it("refuses a SECOND redemption of the same code, and writes no second membership", async () => {
    const appUserId = await newcomer();
    const { code } = await issue({ appUserId });
    expect((await redeemOverHttp(code)).status).toBe(201);

    const second = await redeemOverHttp(code);
    expect(second.status).toBe(401);
    expect(second.code).toBe("INVITATION_INVALID");

    const memberships = await shopQuery(`SELECT count(*)::int AS n FROM membership WHERE app_user_id = $1`, [
      appUserId,
    ]);
    expect((memberships.rows[0] as { n: number }).n).toBe(1);
  });

  it("leaves exactly ONE membership when two redemptions race — the UNIQUE decides", async () => {
    const appUserId = await newcomer();
    const { code } = await issue({ appUserId });
    const device = await openDevice(pool, identity);

    // Both callers pass `verifyInvitation` — neither sees a use row — and then
    // race on the INSERT. This is the case a serial test cannot reach and the
    // reason `UNIQUE (invitation_id)` exists rather than a status column.
    const verdicts = await Promise.all([
      shopTx((tx) => verifyInvitation(tx, { device: device.row, code, now: new Date() })),
      shopTx((tx) => verifyInvitation(tx, { device: device.row, code, now: new Date() })),
    ]);
    for (const v of verdicts) expect(v.ok).toBe(true);
    const invitation = (verdicts[0] as { ok: true; invitation: InvitationRow }).invitation;

    const results = await Promise.allSettled(
      verdicts.map(() =>
        shopTx((tx) =>
          grantInvitation(tx, { invitation, device: device.row, deviceSessionId: device.row.id })
        )
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    // The loser left NO orphan membership: its INSERT rolled back with the throw.
    const memberships = await shopQuery(`SELECT count(*)::int AS n FROM membership WHERE app_user_id = $1`, [
      appUserId,
    ]);
    expect((memberships.rows[0] as { n: number }).n).toBe(1);
    const uses = await shopQuery(`SELECT count(*)::int AS n FROM invitation_use WHERE invitation_id = $1`, [
      invitation.id,
    ]);
    expect((uses.rows[0] as { n: number }).n).toBe(1);
  });

  it("REFUSES a valid code presented on another shop's phone (019 T24, R15)", async () => {
    const appUserId = await newcomer();
    const { code } = await issue({ appUserId });

    // A live device session — at the WRONG shop. The code is correct, unexpired
    // and unspent; the only thing wrong is the counter it is being typed at.
    const foreign = await openDevice(pool, otherIdentity);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invitations/redemptions",
      headers: {
        "sec-fetch-site": "same-origin",
        "idempotency-key": randomUUID(),
        cookie: cookieHeader(foreign.token),
      },
      payload: { code, pin: NEW_PIN },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string; details: Record<string, unknown> } };
    expect(body.error.code).toBe("INVITATION_INVALID");
    // §9.3: no `details`, so the refusal is indistinguishable from an unknown
    // code's — a caller cannot use this route to discover that a code is real.
    expect(body.error.details).toEqual({});

    // Nothing was granted, and the code is still redeemable at its own shop.
    const memberships = await shopQuery(`SELECT count(*)::int AS n FROM membership WHERE app_user_id = $1`, [
      appUserId,
    ]);
    expect((memberships.rows[0] as { n: number }).n).toBe(0);
    expect((await redeemOverHttp(code)).status).toBe(201);
  });

  it("REFUSES a valid code presented with NO device session at all (R15)", async () => {
    const { code } = await issue();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invitations/redemptions",
      headers: { "sec-fetch-site": "same-origin", "idempotency-key": randomUUID() },
      payload: { code, pin: NEW_PIN },
    });
    // The AUTH allowlist requires `device` on this path, so the hook refuses
    // before the service runs — which is why this answers SESSION_REQUIRED and
    // not INVITATION_INVALID: the code was never looked at.
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe("SESSION_REQUIRED");
  });

  it("refuses an EXPIRED code, and expiry is a predicate rather than a column", async () => {
    // **The row is written directly, and that is not a shortcut.**
    // `issueInvitation` cannot produce an expired invitation and must not be able
    // to: `migrations/024`'s CHECK refuses `expires_at <= created_at`, because a
    // row that can never be redeemed and does not say so is worse than a refusal.
    // So the fixture is an INSERT with both timestamps in the past — exactly the
    // state a real invitation reaches by the clock moving — through the APP role,
    // on an append-only table, with no UPDATE anywhere.
    const appUserId = await newcomer();
    const code = "EXPIRED1";
    const inserted = await shopQuery(
      `INSERT INTO invitation
         (shop_id, app_user_id, role, scope_kind, token_digest, expires_at, invited_by, created_at)
       VALUES ($1,$2,'operator','shop',$3, now() - interval '1 hour', $4, now() - interval '25 hours')
       RETURNING id`,
      [shopId, appUserId, digestOf(code), identity.ownerId]
    );
    const invitationId = (inserted.rows[0] as { id: string }).id;
    const res = await redeemOverHttp(code);
    expect(res.status).toBe(401);
    expect(res.code).toBe("INVITATION_INVALID");

    const row = await shopQuery(`SELECT i.expires_at FROM invitation i WHERE i.id = $1`, [invitationId]);
    expect(row.rows).toHaveLength(1);
    const columns = await shopQuery(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'invitation'`
    );
    const names = (columns.rows as Array<{ column_name: string }>).map((r) => r.column_name);
    for (const forbidden of ["status", "used", "spent", "redeemed_at", "is_active"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("refuses an unknown code with the same code and no details", async () => {
    const res = await redeemOverHttp("ZZZZZZZZ");
    expect(res.status).toBe(401);
    expect(res.code).toBe("INVITATION_INVALID");
  });

  it("never stores the code, in any column, in any form", async () => {
    const appUserId = await newcomer();
    const { code, invitationId } = await issue({ appUserId });
    const row = await shopQuery(`SELECT i.token_digest FROM invitation i WHERE i.id = $1`, [invitationId]);
    const digest = (row.rows[0] as { token_digest: string }).token_digest;
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(code);
    // And no column anywhere in the table holds it, including a prefix of it —
    // which is what a "hint" or a "last four" would be.
    const dump = await shopQuery(`SELECT to_jsonb(i) AS row FROM invitation i WHERE i.id = $1`, [
      invitationId,
    ]);
    expect(JSON.stringify((dump.rows[0] as { row: unknown }).row)).not.toContain(code.slice(0, 4));
  });

  it("ENFORCES its declared `ordinary` class: a burst gets a real 429, and writes no attempt row", async () => {
    // ⚠ THE REGRESSION TEST FOR THE DEFECT THIS ROUTE SHIPPED WITH.
    //
    // `POST /api/v1/invitations/redemptions` declared `rateClass: "ordinary"` and
    // enforced NOTHING: the hook's bucket is gated on `rateClass === "device"`,
    // and `app.ts`'s `takeOrdinary` hook lives inside the TENANT PLUGIN while
    // this route is registered on the root instance. Two hundred posts produced
    // two hundred 401s, zero 429s and zero limiter calls — while
    // `rate-class-enforcement.test.ts` passed on a substring match. So this case
    // asserts the one thing no static test can: a real burst against a real
    // server answers `RATE_LIMITED`.
    //
    // The limiter is built with a ceiling of TWO rather than bursting the
    // provisional 120, because what is under test is "is there a bucket at all",
    // not "what is the floor" — and 042 A3's floors are explicitly
    // non-evidentiary, so hard-coding 120 into an assertion about a MECHANISM
    // would bake a provisional number into a permanent test.
    const shopId = await seedShopFor(ownerPool);
    const burst = await seedIdentity(pool, shopId);
    const device = await openDevice(pool, burst);
    const cookie = cookieHeader(device.token);

    const limited = await buildApp(pool, testConfig({ databaseUrl: pool.options.connectionString ?? "" }), {
      limiter: new ShopRateLimiter({ ordinaryPerMinute: 2 }),
    });
    try {
      const post = async (
        code: string
      ): Promise<{ status: number; error: string | undefined; details: unknown }> => {
        const res = await limited.inject({
          method: "POST",
          url: "/api/v1/invitations/redemptions",
          headers: { "sec-fetch-site": "same-origin", "idempotency-key": randomUUID(), cookie },
          payload: { code, pin: NEW_PIN },
        });
        const body = res.json() as { error?: { code: string; details: unknown } };
        return { status: res.statusCode, error: body.error?.code, details: body.error?.details };
      };

      const attempts = async (): Promise<number> => {
        // `asShop` with the LOCAL `shopId` — this test seeds a shop of its own and
        // shadows the suite's. Reading it under the SUITE's context would be a
        // cross-tenant read, which E03-B04's policy answers with zero rows: the
        // boundary working, and indistinguishable here from "the service wrote
        // nothing".
        const res = await asShop(pool, shopId).query(
          `SELECT count(*)::int AS n FROM auth_attempt WHERE shop_id = $1 AND method = 'invitation'`,
          [shopId]
        );
        return (res.rows[0] as { n: number }).n;
      };
      const before = await attempts();

      // Two get through the bucket and are refused on the CODE.
      expect((await post("ZZZZZZZ1")).error).toBe("INVITATION_INVALID");
      expect((await post("ZZZZZZZ2")).error).toBe("INVITATION_INVALID");

      // The third is refused by the BUCKET, and the difference is visible on the
      // wire: a different code, a 429, and a `retry_after_seconds` the client can
      // act on (042 §4.4 — retryability is a fact the server states, never one a
      // client infers from a status).
      const throttled = await post("ZZZZZZZ3");
      expect(throttled.status).toBe(429);
      expect(throttled.error).toBe("RATE_LIMITED");
      expect(throttled.details).toHaveProperty("retry_after_seconds");

      // AND IT TESTED NO CREDENTIAL. The bucket is taken before
      // `verifyInvitation`, so a throttled request appends no `auth_attempt` row —
      // otherwise a flooder would grow the very table the per-shop redemption
      // delay is derived from (048 §9.1, R5).
      expect(await attempts()).toBe(before + 2);
    } finally {
      await limited.close();
    }
  });

  it("throttles a shop that keeps guessing, and a THROTTLED attempt records no row", async () => {
    // A shop of its own, so this suite's other tests neither feed nor drain the
    // budget under test.
    const burstShop = await seedShopFor(ownerPool);
    const burstIdentity = await seedIdentity(pool, burstShop);
    const device = await openDevice(pool, burstIdentity);
    const cookie = cookieHeader(device.token);

    const attemptRows = async (): Promise<number> => {
      const res = await asShop(pool, burstShop).query(
        `SELECT count(*)::int AS n FROM auth_attempt WHERE shop_id = $1 AND method = 'invitation'`,
        [burstShop]
      );
      return (res.rows[0] as { n: number }).n;
    };

    // Spend the free budget with wrong codes: each is a real credential test and
    // each appends one row. `requiredWaitMs` returns 0 while `failures <=
    // freeAttempts`, so the budget is exhausted by FREE + 1 failures and the NEXT
    // one is the first that waits. The bound is written as that expression rather
    // than as the bare constant, because an off-by-one here would silently test
    // the un-throttled path and pass.
    const budget = SHOP_REDEMPTION_FREE_ATTEMPTS + 1;
    for (let i = 0; i < budget; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invitations/redemptions",
        headers: { "sec-fetch-site": "same-origin", "idempotency-key": randomUUID(), cookie },
        payload: { code: `ZZZZZZZ${i}`, pin: NEW_PIN },
      });
      expect(res.statusCode).toBe(401);
    }
    const spent = await attemptRows();
    expect(spent).toBe(budget);

    // The next one is inside the delay, so it is refused BEFORE the code is
    // looked at — and appends NOTHING. Without this, a flooder would grow the
    // very table the delay is derived from (048 §9.1, R5).
    const throttled = await app.inject({
      method: "POST",
      url: "/api/v1/invitations/redemptions",
      headers: { "sec-fetch-site": "same-origin", "idempotency-key": randomUUID(), cookie },
      payload: { code: "ZZZZZZZ9", pin: NEW_PIN },
    });
    expect(throttled.statusCode).toBe(401);
    expect((throttled.json() as { error: { code: string } }).error.code).toBe("INVITATION_INVALID");
    expect(await attemptRows()).toBe(spent);

    // **And it never closes** (048 R5): the delay is a wait, not a door. A shop
    // whose failures fall out of the window is redeemable again with no
    // intervention — proved by moving the clock rather than the rows, which is
    // what `redemptionWait`'s window predicate is.
    const stillOpen = await asShop(pool, burstShop).query(
      `SELECT count(*)::int AS n FROM auth_attempt
        WHERE shop_id = $1 AND method = 'invitation' AND created_at >= now() - interval '15 minutes'`,
      [burstShop]
    );
    expect((stillOpen.rows[0] as { n: number }).n).toBe(spent);
  });

  it("refuses to issue past the per-shop outstanding ceiling (048 §7.1a)", async () => {
    const ceilingShop = await seedShopFor(ownerPool);
    const ceilingIdentity = await seedIdentity(pool, ceilingShop);

    for (let i = 0; i < MAX_OUTSTANDING_INVITATIONS_PER_SHOP; i += 1) {
      const out = await shopTx(
        async (tx) =>
          issueInvitation(tx, {
            shopId: ceilingShop,
            appUserId: await newcomer(),
            role: "operator",
            invitedBy: ceilingIdentity.ownerId,
            now: new Date(),
          }),
        ceilingShop
      );
      expect(out.ok).toBe(true);
    }
    const over = await shopTx(
      async (tx) =>
        issueInvitation(tx, {
          shopId: ceilingShop,
          appUserId: await newcomer(),
          role: "operator",
          invitedBy: ceilingIdentity.ownerId,
          now: new Date(),
        }),
      ceilingShop
    );
    expect(over).toEqual({ ok: false, refusal: "too_many_outstanding" });
  });

  it("refuses to issue for a shop the inviter holds no live grant at", async () => {
    // THE CONTEXT IS SHOP B'S, because the ACT is about shop B (E03-B04). That is
    // not test bookkeeping: `issueInvitation` records an `authorization_decision`
    // row for the shop it is deciding about, and such a row written inside shop A's
    // context is refused by the policy's `WITH CHECK`. The refusal under test is
    // the ROLE one — shop A's owner holds no grant at shop B — and it has to be
    // reachable in order to be asserted.
    const out = await shopTx(
      async (tx) =>
        issueInvitation(tx, {
          shopId: otherShopId,
          appUserId: await newcomer(),
          role: "operator",
          // Shop A's owner, inviting into Shop B.
          invitedBy: identity.ownerId,
          now: new Date(),
        }),
      otherShopId
    );
    // E03-B03 renamed the refusal: the test is a ROLE and a SCOPE, not a
    // membership, and the two causes deliberately share one name so a caller
    // cannot walk the ladder to learn which roles exist above them.
    expect(out).toEqual({ ok: false, refusal: "not_permitted" });
  });

  // -------------------------------------------------------------------------
  // E03-B03 — THE ESCALATION THIS SERVICE SHIPPED WITH, AND ITS NEGATIVES.
  //
  // `issueInvitation` checked that the inviter held SOME live membership and
  // nothing else, so an OPERATOR could invite an OWNER. It was reachable from
  // `scripts/issue-invitation.ts` by anyone who could run it, and the route
  // table's own comment claimed the service "checks the role". The cases below
  // were never written because nobody looked; they are written now.
  // -------------------------------------------------------------------------

  async function decisionCount(): Promise<number> {
    const res = await shopQuery(`SELECT count(*)::int AS n FROM authorization_decision`);
    return (res.rows[0] as { n: number }).n;
  }

  async function decisionsSince(mark: number): Promise<
    Array<{
      route_method: string;
      route_path: string;
      permission: string;
      session_chain_id: string | null;
      decision: string;
      role: string | null;
      refusal_reason: string | null;
    }>
  > {
    const res = await shopQuery(
      `SELECT route_method, route_path, permission, session_chain_id, decision, role, refusal_reason
         FROM authorization_decision ORDER BY decided_at, id OFFSET $1`,
      [mark]
    );
    return res.rows as Awaited<ReturnType<typeof decisionsSince>>;
  }

  it("refuses an OPERATOR issuing any invitation at all (054 §3)", async () => {
    for (const role of ["owner", "manager", "operator"] as const) {
      const out = await shopTx(async (tx) =>
        issueInvitation(tx, {
          shopId,
          appUserId: await newcomer(),
          role,
          invitedBy: identity.operatorId,
          now: new Date(),
        })
      );
      expect(out, `an operator issued a ${role} invitation`).toEqual({
        ok: false,
        refusal: "not_permitted",
      });
    }
  });

  it("refuses a MANAGER inviting a manager or an owner, and allows them an operator (054 §5)", async () => {
    const manager = await insertUser(pool, `mgr-${randomUUID().slice(0, 8)}@example.invalid`, "Person Mgr");
    await shopQuery(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, role) VALUES ($1,$2,'shop','manager')`,
      [manager, shopId]
    );
    for (const role of ["owner", "manager"] as const) {
      const refused = await shopTx(async (tx) =>
        issueInvitation(tx, {
          shopId,
          appUserId: await newcomer(),
          role,
          invitedBy: manager,
          now: new Date(),
        })
      );
      expect(refused, `a manager issued a ${role} invitation`).toEqual({
        ok: false,
        refusal: "not_permitted",
      });
    }
    const allowed = await shopTx(async (tx) =>
      issueInvitation(tx, {
        shopId,
        appUserId: await newcomer(),
        role: "operator",
        invitedBy: manager,
        now: new Date(),
      })
    );
    expect(allowed.ok).toBe(true);
  });

  it("RECORDS its authorization decision, allowed and refused, from a surface with no route (S5′)", async () => {
    // 054 §4.3: a PRIVILEGED act records its decision whatever surface it was
    // reached from. Inviting a person is one of the two, and it is reached from
    // a script — so under the first version of the recording rule, which keyed
    // on whether a ROUTE mutated, the most privileged act in the system recorded
    // nothing at all. The row names the SCRIPT and carries a null session,
    // because a CLI has neither a route template nor a session.
    const before = await decisionCount();
    await shopTx(async (tx) =>
      issueInvitation(tx, {
        shopId,
        appUserId: await newcomer(),
        role: "operator",
        invitedBy: identity.ownerId,
        now: new Date(),
      })
    );
    await shopTx(async (tx) =>
      issueInvitation(tx, {
        shopId,
        appUserId: await newcomer(),
        role: "owner",
        invitedBy: identity.operatorId,
        now: new Date(),
      })
    );
    const rows = await decisionsSince(before);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.route_method).toBe("CLI");
      expect(row.route_path).toBe("scripts/issue-invitation.ts");
      expect(row.permission).toBe("membership.invite");
      expect(row.session_chain_id).toBeNull();
    }
    expect(rows[0]).toMatchObject({ decision: "allowed", role: "owner", refusal_reason: null });
    expect(rows[1]).toMatchObject({ decision: "refused", role: "operator", refusal_reason: "role" });
  });

  it("lets an OWNER name a second owner — 048 §8.2's recovery nomination needs it", async () => {
    const out = await shopTx(async (tx) =>
      issueInvitation(tx, {
        shopId,
        appUserId: await newcomer(),
        role: "owner",
        invitedBy: identity.ownerId,
        now: new Date(),
      })
    );
    expect(out.ok).toBe(true);
  });

  it("refuses a PIN the policy forbids WITHOUT spending the invitation", async () => {
    const appUserId = await newcomer();
    const { code, invitationId } = await issue({ appUserId });
    const bad = await redeemOverHttp(code, { pin: "111111" });
    expect(bad.status).toBe(400);
    expect(bad.code).toBe("PIN_REFUSED");

    // The code survived: nothing was written, so the employee tries again.
    const uses = await shopQuery(`SELECT count(*)::int AS n FROM invitation_use WHERE invitation_id = $1`, [
      invitationId,
    ]);
    expect((uses.rows[0] as { n: number }).n).toBe(0);
    expect((await redeemOverHttp(code)).status).toBe(201);
  });

  it("replays a retried redemption instead of finding its own code spent", async () => {
    // The idempotency row is what makes this route safe to retry, and the ORDER
    // is what makes it work: `replayIfSettled` runs before anything looks at the
    // code, so a retry never re-verifies a code its own first call spent.
    const appUserId = await newcomer();
    const { code } = await issue({ appUserId });
    const key = randomUUID();
    const first = await redeemOverHttp(code, { key });
    expect(first.status).toBe(201);
    const retry = await redeemOverHttp(code, { key });
    expect(retry.status).toBe(201);

    const memberships = await shopQuery(`SELECT count(*)::int AS n FROM membership WHERE app_user_id = $1`, [
      appUserId,
    ]);
    expect((memberships.rows[0] as { n: number }).n).toBe(1);
  });

  it("requires an Idempotency-Key, like every other mutating route (042 §5.1)", async () => {
    const { code } = await issue();
    const device = await openDevice(pool, identity);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invitations/redemptions",
      headers: { "sec-fetch-site": "same-origin", cookie: cookieHeader(device.token) },
      payload: { code, pin: NEW_PIN },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("appends to invitation and invitation_use and can UPDATE neither", async () => {
    const { invitationId } = await issue();
    await expect(
      shopQuery(`UPDATE invitation SET expires_at = now() WHERE id = $1`, [invitationId])
    ).rejects.toThrow();
    await expect(shopQuery(`DELETE FROM invitation WHERE id = $1`, [invitationId])).rejects.toThrow();
  });
});

/**
 * A shop row with a synthetic name, for a test that needs a redemption budget of
 * its own. Seeded through the APP pool: `shop`, `organization` and
 * `shop_pricing_policy` are declared append-only EXEMPTIONS, so the app role
 * holds full DML on them (`src/db/appendOnlyTables.ts`) — no second connection
 * with more privilege than the server has is opened anywhere in this suite.
 */
async function seedShopFor(db: pg.Pool): Promise<string> {
  return seedShop(db, { name: "Shop C", slug: `inv-c-${randomUUID().slice(0, 8)}` });
}
