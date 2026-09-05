// L4: the actor audit, against a real database and a real server.
//
// Bead: longbox-e5b.3.3 (alias E03-B03). Docs: 054 §4, §6; 034 §2.7, I5; 041
// §9.2; 019 T24, T34, T35(c); 048 I14; 022 P3.
//
// Four things only a running system can show:
//
//   1. **which decisions land** — every refusal, and an allowance where the act
//      MUTATES or the permission is PRIVILEGED (054 §4.3, the 022 P3 line, as
//      widened by the cannon's S5′). Asserted by counting rows after a read and
//      after a write, because the rule is about what is NOT written and no
//      static test can see an absence;
//   2. **what a row says** — the template rather than the URL, the grant rather
//      than the person, and the matrix version that decided;
//   3. **that the row cannot be edited** — the append-only trigger, from the APP
//      role, which is the role a compromised server would be holding;
//   4. **break-glass** — the expiry and the "says why" enforced at the CHECK, at
//      the query and in the decision, and 019 T35(c)'s reconciliation returning
//      the unmatched session it is supposed to return.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { TENANT_PREFIX } from "../../src/contracts/v1/schemas.js";
import {
  PERMISSION_MATRIX_VERSION,
  decisionsByUnreconciledSessions,
  unreconciledBreakGlassSessions,
} from "../../src/services/auth/index.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import {
  cookieHeader,
  insertUser,
  openDevice,
  openOperator,
  seedIdentity,
  writeHeaders,
  type SeededIdentity,
} from "./authHelpers.js";
import { ShopRateLimiter } from "../../src/services/rateLimit.js";
import { testConfig } from "../testConfig.js";

const dbUp = await probeDb();
const UPLOADS_DIR = "tests/.tmp-authz-uploads";

interface DecisionRow {
  shop_id: string;
  route_method: string;
  route_path: string;
  permission: string;
  matrix_version: string;
  matrix_commit: string;
  membership_id: string | null;
  role: string | null;
  session_chain_id: string | null;
  decision: string;
  refusal_reason: string | null;
}

describe.skipIf(!dbUp)("the authorization decision record (054 §4)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;
  let identity: SeededIdentity;
  let device: Awaited<ReturnType<typeof openDevice>>;
  let operatorCookie: string;
  let breakGlassCookie: string;
  let breakGlassChain: string;
  let breakGlassSessionId: string;
  let operatorChain: string;
  let migrateUrl: string;
  let ownerPool: pg.Pool;

  beforeAll(async () => {
    migrateUrl = await createFreshDb("longbox_authz_decision");
    await runMigrations(migrateUrl);
    // KEPT OPEN for the whole suite: one case seeds a SECOND shop, and a `shop`
    // row is written by the schema owner rather than by the app role.
    ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Audit Shop", slug: `authz-${Date.now()}` });
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    app = await buildApp(pool, testConfig({ databaseUrl: appUrl(migrateUrl), uploadsDir: UPLOADS_DIR }));

    identity = await seedIdentity(pool, shopId);
    device = await openDevice(pool, identity);
    const operator = await openOperator(pool, device, identity.operatorId);
    operatorCookie = cookieHeader(device.token, operator.token);
    operatorChain = operator.row.chain_id;

    const support = await insertUser(pool, `support-${Date.now()}@example.invalid`, "Person Support");
    await pool.query(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_until, reason)
       VALUES ($1,$2,'shop','support_break_glass',$3,$4)`,
      [support, shopId, new Date(Date.now() + 3_600_000), "ticket 1 — audit suite"]
    );
    const bg = await openOperator(pool, device, support);
    breakGlassCookie = cookieHeader(device.token, bg.token);
    breakGlassChain = bg.row.chain_id;
    breakGlassSessionId = bg.row.id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await ownerPool?.end();
  });

  async function decisions(): Promise<DecisionRow[]> {
    const res = await pool.query(
      `SELECT shop_id, route_method, route_path, permission, matrix_version, matrix_commit,
              membership_id, role, session_chain_id, decision, refusal_reason
         FROM authorization_decision ORDER BY decided_at, id`
    );
    return res.rows as DecisionRow[];
  }

  /**
   * "Reset" by MARKING, never by deleting.
   *
   * The app role cannot DELETE from an append-only table — that is assertion 3 —
   * and a suite that reached for the owner's connection to tidy up between cases
   * would be quietly demonstrating the opposite of what it asserts. So each case
   * takes a high-water mark and reads only what came after it.
   */
  async function clear(): Promise<void> {
    marks.set("at", (await decisions()).length);
  }
  const marks = new Map<string, number>();
  const since = async (): Promise<DecisionRow[]> => (await decisions()).slice(marks.get("at") ?? 0);

  const get = (path: string, cookie: string) =>
    app.inject({ method: "GET", url: path, headers: { "sec-fetch-site": "same-origin", cookie } });
  const post = (path: string, cookie: string) =>
    app.inject({ method: "POST", url: path, headers: { ...writeHeaders(), cookie }, payload: {} });

  // -------------------------------------------------------------------------
  // 1. Which decisions land.
  // -------------------------------------------------------------------------

  it("records NOTHING for an allowed READ — a browsing history is what 022 P3 forbids", async () => {
    await clear();
    const res = await get(
      `${TENANT_PREFIX.replace(":shopId", shopId)}/scan-sessions/${randomUUID()}`,
      operatorCookie
    );
    // The route answers 404 for the invented id; the permission was granted, and
    // that grant is exactly what must leave no trace.
    expect(res.statusCode).toBe(404);
    expect(await since()).toEqual([]);
  });

  it("records an allowed WRITE, naming the grant, the role and the matrix version", async () => {
    await clear();
    const res = await post(`${TENANT_PREFIX.replace(":shopId", shopId)}/scan-sessions`, operatorCookie);
    expect(res.statusCode).toBe(201);
    const rows = await since();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      shop_id: shopId,
      route_method: "POST",
      permission: "scan.session.open",
      matrix_version: PERMISSION_MATRIX_VERSION,
      role: "operator",
      decision: "allowed",
      refusal_reason: null,
      session_chain_id: operatorChain,
    });
    expect(rows[0]!.membership_id).not.toBeNull();
  });

  it("records a REFUSED read as well as a refused write — a refusal is the security event", async () => {
    await clear();
    const path = `${TENANT_PREFIX.replace(":shopId", shopId)}/scan-sessions/${randomUUID()}`;
    expect((await get(path, breakGlassCookie)).statusCode).toBe(403);
    expect(
      (await post(`${TENANT_PREFIX.replace(":shopId", shopId)}/scan-sessions`, breakGlassCookie)).statusCode
    ).toBe(403);
    const rows = await since();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.decision).toBe("refused");
      expect(row.refusal_reason).toBe("role");
      expect(row.role).toBe("support_break_glass");
      // A role refusal names no grant: no membership of this person carries the
      // permission, so there is nothing to name and a null is honest.
      expect(row.membership_id).toBeNull();
      expect(row.session_chain_id).toBe(breakGlassChain);
    }
    expect(rows.map((r) => r.route_method)).toEqual(["GET", "POST"]);
  });

  it("stamps the deciding BUILD as well as the matrix version (K2)", async () => {
    await clear();
    await post(`${TENANT_PREFIX.replace(":shopId", shopId)}/scan-sessions`, operatorCookie);
    const [row] = await since();
    // `unknown` is the honest answer for a test process that carries no build
    // stamp, and it is a VALUE rather than a null — so a row written by a
    // deployment that sets nothing cannot be confused with a row written before
    // the column existed.
    expect(row!.matrix_commit).toBe("unknown");
    expect(row!.matrix_commit).not.toBe("");
  });

  it("writes a SECOND decision for a replayed Idempotency-Key — N:1, pinned not accidental (K1)", async () => {
    // The consistency lens's most-costly finding: "one request is one decision"
    // was quietly false under conditions the system is built to expect. A client
    // that retries with the SAME `Idempotency-Key` re-enters the hook — which
    // runs on `onRequest`, before `request_idempotency` dedupes anything — so the
    // authorization is genuinely taken again and genuinely recorded again.
    //
    // The ruling is to ACCEPT N:1 decisions-to-effects and DOCUMENT it (054
    // §4.5), so this case exists to pin the property rather than to fix it: if
    // somebody later keys the decision on the idempotency key (E03-D15), this
    // test is what tells them they changed a documented property.
    await clear();
    const url = `${TENANT_PREFIX.replace(":shopId", shopId)}/scan-sessions`;
    const key = `replay-${randomUUID()}`;
    const headers = { ...writeHeaders({ "idempotency-key": key }), cookie: operatorCookie };
    const first = await app.inject({ method: "POST", url, headers, payload: {} });
    const second = await app.inject({ method: "POST", url, headers, payload: {} });
    expect(first.statusCode).toBe(201);
    // The second is the REPLAYED response — one effect.
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    // …and TWO decisions.
    const rows = await since();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.decision === "allowed")).toBe(true);
    // One scan session, two decision rows: the ratio the record now states.
    const sessions = await pool.query(
      `SELECT count(*)::int AS n FROM request_idempotency WHERE idempotency_key = $1`,
      [key]
    );
    expect((sessions.rows[0] as { n: number }).n).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 2. What a row says.
  // -------------------------------------------------------------------------

  it("stores the route TEMPLATE and no identifier from the URL (054 §4.2)", async () => {
    await clear();
    const sessionId = randomUUID();
    await get(`${TENANT_PREFIX.replace(":shopId", shopId)}/scan-sessions/${sessionId}`, breakGlassCookie);
    const [row] = await since();
    expect(row!.route_path).toBe(`${TENANT_PREFIX}/scan-sessions/:id`);
    // The two identifiers a URL carries, neither of which may reach the row.
    expect(row!.route_path).not.toContain(sessionId);
    expect(row!.route_path).not.toContain(shopId);
  });

  it("records a SCOPE refusal with its own reason, while the caller sees an absent shop", async () => {
    await clear();
    const elsewhere = await pool.query(
      `INSERT INTO location (shop_id, kind, name) VALUES ($1,'store','Far counter') RETURNING id`,
      [shopId]
    );
    const farLocation = (elsewhere.rows[0] as { id: string }).id;
    const person = await insertUser(pool, `far-${Date.now()}@example.invalid`, "Person Far");
    await pool.query(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, location_id, role)
       VALUES ($1,$2,'location',$3,'operator')`,
      [person, shopId, farLocation]
    );
    const session = await openOperator(pool, device, person);
    const res = await post(
      `${TENANT_PREFIX.replace(":shopId", shopId)}/scan-sessions`,
      cookieHeader(device.token, session.token)
    );
    // The wire says "no such shop" (019 T24). The RECORD says why, because an
    // auditor needs the answer the caller must not get.
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe("SHOP_NOT_FOUND");
    const [row] = await since();
    expect(row).toMatchObject({ decision: "refused", refusal_reason: "scope", role: "operator" });
  });

  it("THROTTLES before it writes, so a live session cannot drive unbounded audit rows (F4)", async () => {
    // The security lens's finding: the audit INSERT runs in an `onRequest` hook
    // on the root instance, and the tenant plugin's rate bucket runs AFTER it —
    // so one enrolled phone could hold a live session, hammer a route it is
    // refused, and grow this table without ever reaching a limiter. A table
    // whose growth is bounded by "requests that reach a live grant" is only
    // bounded if something bounds those.
    //
    // The bucket now sits immediately after tenant resolution and BEFORE the
    // write. A burst therefore ends in 429s that record NOTHING — no decision
    // was taken — rather than in an unbounded run of refusal rows.
    const limiter = new ShopRateLimiter({ ordinaryPerMinute: 3 });
    const throttled = await buildApp(
      pool,
      testConfig({ databaseUrl: appUrl(migrateUrl), uploadsDir: UPLOADS_DIR }),
      { limiter }
    );
    try {
      await clear();
      const url = `${TENANT_PREFIX.replace(":shopId", shopId)}/scan-sessions`;
      const codes: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const res = await throttled.inject({
          method: "POST",
          url,
          headers: { ...writeHeaders(), cookie: breakGlassCookie },
          payload: {},
        });
        codes.push(res.statusCode);
      }
      expect(codes.filter((c) => c === 429).length, "the burst was never throttled").toBeGreaterThan(0);
      // Every request that got through recorded exactly one refusal; every
      // throttled one recorded none. The two counts must add up.
      const refused = codes.filter((c) => c === 403).length;
      expect((await since()).length).toBe(refused);
      expect(refused).toBeLessThan(codes.length);
    } finally {
      await throttled.close();
    }
  });

  // -------------------------------------------------------------------------
  // 3. The row cannot be edited, by the role the server actually holds.
  // -------------------------------------------------------------------------

  it("refuses UPDATE and DELETE from the APP role, by trigger and not by convention", async () => {
    const rows = await decisions();
    expect(rows.length).toBeGreaterThan(0);
    await expect(
      pool.query(`UPDATE authorization_decision SET decision = 'allowed' WHERE decision = 'refused'`)
    ).rejects.toThrow(/append-only|forbid_mutation|permission denied/i);
    await expect(pool.query(`DELETE FROM authorization_decision`)).rejects.toThrow(
      /append-only|forbid_mutation|permission denied/i
    );
    expect((await decisions()).length).toBe(rows.length);
  });

  // -------------------------------------------------------------------------
  // 4. Break-glass (034 I5, 048 I14, 019 T35(c)).
  // -------------------------------------------------------------------------

  describe("break-glass is bounded by the database as well as by the code", () => {
    it("REFUSES a grant with no expiry and one with no reason (034 §2.7's CHECK)", async () => {
      const person = await insertUser(pool, `bg1-${Date.now()}@example.invalid`, "Person BG1");
      await expect(
        pool.query(
          `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, reason)
           VALUES ($1,$2,'shop','support_break_glass','why')`,
          [person, shopId]
        )
      ).rejects.toThrow(/membership_break_glass_expires_and_says_why/);
      await expect(
        pool.query(
          `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_until)
           VALUES ($1,$2,'shop','support_break_glass',now() + interval '1 hour')`,
          [person, shopId]
        )
      ).rejects.toThrow(/membership_break_glass_expires_and_says_why/);
    });

    it("REFUSES a SELF-GRANTED break-glass membership — 034 I5's third clause, which had no mechanism", async () => {
      // The escalation the role would otherwise create: anybody who reached the
      // membership writer could give themselves the only read path to
      // per-operator data and choose their own expiry.
      const person = await insertUser(pool, `bg2-${Date.now()}@example.invalid`, "Person BG2");
      await expect(
        pool.query(
          `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_until, reason, granted_by)
           VALUES ($1,$2,'shop','support_break_glass',now() + interval '1 hour','why',$1)`,
          [person, shopId]
        )
      ).rejects.toThrow(/membership_break_glass_is_never_self_granted/);
    });

    it("stops honouring a break-glass grant the moment it expires", async () => {
      // The permission it holds today is none, so the observable is the ROLE the
      // decision records: a live grant decides as `support_break_glass`, an
      // expired one is not a grant at all and the refusal names no role.
      await clear();
      const person = await insertUser(pool, `bg3-${Date.now()}@example.invalid`, "Person BG3");
      await pool.query(
        `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_from, effective_until, reason)
         VALUES ($1,$2,'shop','support_break_glass', now() - interval '2 hours', now() - interval '1 hour','expired ticket')`,
        [person, shopId]
      );
      const session = await openOperator(pool, device, person);
      const res = await post(
        `${TENANT_PREFIX.replace(":shopId", shopId)}/scan-sessions`,
        cookieHeader(device.token, session.token)
      );
      // No LIVE membership at all → the tenancy answer, byte-identical to a
      // stranger's, and no authorization row: authorization is never reached.
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe("SHOP_NOT_FOUND");
      expect(await since()).toEqual([]);
    });

    it("treats a REVOCATION as an early expiry, so a session after it does NOT reconcile (F2)", async () => {
      // 034 §2.7 ends a grant with a ROW rather than by editing the grant, so a
      // covering window read off `effective_until` alone reports a session
      // issued AFTER the revocation as reconciled — which is precisely the
      // session an investigator is looking for. The grant below runs for a day;
      // it was revoked an hour ago; the session was opened after that.
      const person = await insertUser(pool, `bg5-${Date.now()}@example.invalid`, "Person BG5");
      const grant = await pool.query(
        `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_from, effective_until, reason)
         VALUES ($1,$2,'shop','support_break_glass', now() - interval '2 hours', now() + interval '22 hours','open ticket')
         RETURNING id`,
        [person, shopId]
      );
      const membershipId = (grant.rows[0] as { id: string }).id;
      await pool.query(
        `INSERT INTO membership_revocation (shop_id, membership_id, reason, created_at)
         VALUES ($1,$2,'ticket closed', now() - interval '1 hour')`,
        [shopId, membershipId]
      );
      const after = await openOperator(pool, device, person);
      const unmatched = await unreconciledBreakGlassSessions(pool);
      expect(
        unmatched.map((u) => u.sessionId),
        "a session opened after the revocation reconciled to the revoked grant"
      ).toContain(after.row.id);
    });

    it("does NOT let a grant at ANOTHER shop cover a session (invariant review, note 2)", async () => {
      // Both directions, because the predicate is one line and the failure it
      // prevents is the most interesting row this query can produce: a
      // break-glass holder acting at a shop their grant does not reach.
      const otherShop = await seedShop(ownerPool, {
        name: "Other Shop",
        slug: `authz-other-${Date.now()}`,
      });
      const person = await insertUser(pool, `bg7-${Date.now()}@example.invalid`, "Person BG7");
      // A live, well-formed grant — at the WRONG shop.
      await pool.query(
        `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_from, effective_until, reason)
         VALUES ($1,$2,'shop','support_break_glass', now() - interval '1 hour', now() + interval '1 hour','elsewhere')`,
        [person, otherShop]
      );
      const session = await openOperator(pool, device, person); // on THIS shop's phone
      expect(
        (await unreconciledBreakGlassSessions(pool)).map((u) => u.sessionId),
        "a grant at another shop covered this session"
      ).toContain(session.row.id);

      // The other direction: the same grant at THIS shop covers it.
      const covered = await insertUser(pool, `bg8-${Date.now()}@example.invalid`, "Person BG8");
      await pool.query(
        `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_from, effective_until, reason)
         VALUES ($1,$2,'shop','support_break_glass', now() - interval '1 hour', now() + interval '1 hour','here')`,
        [covered, shopId]
      );
      const ok = await openOperator(pool, device, covered);
      expect((await unreconciledBreakGlassSessions(pool)).map((u) => u.sessionId)).not.toContain(ok.row.id);
    });

    it("says which unreconciled sessions ACTED, without an index that makes the question cheap (K4)", async () => {
      // F1 removed the chain index because a fast "everything this person did on
      // this phone that day" is the covert timeclock 022 P3 forbids. The
      // question an investigator still needs — did the unreconciled session DO
      // anything — is answered by a scoped join over the chains the
      // reconciliation already flagged, which is cheap when something is already
      // wrong and expensive otherwise. That is the correct shape for this query.
      // The session must be UNRECONCILED and its holder must still reach the
      // authorization step — which is not the same person as the expired-grant
      // case above, and the difference is the boundary 054 §4.3 states: a caller
      // with NO live grant is refused by TENANCY before any permission is
      // evaluated, so that path records nothing at all. The realistic shape that
      // produces both is a session opened BEFORE the break-glass window began:
      // live now, uncovered at issuance.
      const person = await insertUser(pool, `bg6-${Date.now()}@example.invalid`, "Person BG6");
      const orphan = await openOperator(pool, device, person);
      await pool.query(
        `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_from, effective_until, reason)
         VALUES ($1,$2,'shop','support_break_glass', now(), now() + interval '1 hour','opened after the session')`,
        [person, shopId]
      );
      // Now it reaches authorization and is refused there (break-glass holds
      // nothing), and the refusal is recorded.
      await post(
        `${TENANT_PREFIX.replace(":shopId", shopId)}/scan-sessions`,
        cookieHeader(device.token, orphan.token)
      );
      expect(
        (await unreconciledBreakGlassSessions(pool)).map((u) => u.sessionId),
        "the session predates its own grant and should not reconcile"
      ).toContain(orphan.row.id);
      const rows = await decisionsByUnreconciledSessions(pool, [orphan.row.chain_id]);
      expect(rows).toEqual([
        {
          sessionChainId: orphan.row.chain_id,
          permission: "scan.session.open",
          decision: "refused",
          count: 1,
        },
      ]);
      // And it answers nothing at all for an empty list, rather than everything.
      expect(await decisionsByUnreconciledSessions(pool, [])).toEqual([]);
    });

    it("reconciles every Longbox-origin session to a covering grant (019 T35(c), 048 I14)", async () => {
      // The live grant issued in `beforeAll` covers its own session, so it must
      // NOT appear. A session issued for a person whose only break-glass grant
      // has already ended must.
      const unmatched = await unreconciledBreakGlassSessions(pool);
      // ⚠ This compared a list of SESSION IDS to a CHAIN id and could not fail
      // (invariant review, note 6) — two different columns, so `not.toContain`
      // was true whatever the query did. It compares the session's own id now.
      expect(unmatched.map((u) => u.sessionId)).not.toContain(breakGlassSessionId);

      const person = await insertUser(pool, `bg4-${Date.now()}@example.invalid`, "Person BG4");
      await pool.query(
        `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_from, effective_until, reason)
         VALUES ($1,$2,'shop','support_break_glass', now() - interval '3 hours', now() - interval '2 hours','ended')`,
        [person, shopId]
      );
      const orphan = await openOperator(pool, device, person);
      const after = await unreconciledBreakGlassSessions(pool);
      expect(after.map((u) => u.sessionId)).toContain(orphan.row.id);
      expect(after.every((u) => u.issuedAt instanceof Date)).toBe(true);
    });
  });
});
