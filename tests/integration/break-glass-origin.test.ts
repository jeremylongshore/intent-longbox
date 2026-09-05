// L4: **019 T35(c), against a real database** — every Longbox-origin session
// reconciles to a break-glass grant, or it is a finding (E03-D14).
//
// Bead: longbox-e5b.3.24 (alias E03-D14). Docs: 000-docs/058 in full; 054 §6;
// 019 T35(c) (non-waivable; an unmatched session is K1 — 019 §3.4, 034 §3.4);
// 048 §3; 034 §2.7; 022 P3, P7; 041 §9.2.
//
// **THE HOLE THIS SUITE PROVES CLOSED.** 054 §6 recorded that a Longbox employee
// who was never granted break-glass was invisible to the reconciliation — not
// missed, but unfindable, because the population was defined by the grant the
// query was checking for. Case (b) below is that exact session, and before
// `migrations/032` no arrangement of the old query could have returned it.
//
// Six properties only a running database can show, in the order the bead asks
// for them:
//
//   (a) a staff session UNDER a live grant reconciles — 0 findings;
//   (b) a staff session with NO grant anywhere is a finding — the closed hole;
//   (c) a staff session after the grant's EXPIRY is a finding;
//   (d) an ordinary operator's session is not in the population at all;
//   (e) a RETIRED designation takes later sessions out of the population, and
//       leaves earlier ones in — the asymmetry that is the control (058 §3(b));
//   (f) the CLI REFUSES on the application role, which additionally holds no
//       privilege on either table.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { unreconciledBreakGlassSessions } from "../../src/services/auth/index.js";
import { runBreakGlassAudit, summariseUnreconciled } from "../../scripts/breakGlassAudit.js";
import { designateStaff, retireStaffDesignation } from "../../scripts/staffDesignation.js";
import { APP_ROLE, appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import {
  assertTenantIsolationOrThrow,
  checkTenantIsolation,
  describeTenantIsolationFailure,
} from "../../src/services/roleSeparation.js";
import { insertUser, openDevice, openOperator, seedIdentity, type SeededIdentity } from "./authHelpers.js";

const dbUp = await probeDb();

/** A logger that says nothing: the boot assertion is EXPECTED to fail in one case. */
const silent = (): { info: (m: string) => void; error: (m: string) => void } => ({
  info: () => undefined,
  error: () => undefined,
});

describe.skipIf(!dbUp)("the Longbox-origin predicate and T35(c)'s reconciliation (058)", () => {
  let pool: pg.Pool;
  let ownerPool: pg.Pool;
  let shopId: string;
  let otherShopId: string;
  let identity: SeededIdentity;
  let device: Awaited<ReturnType<typeof openDevice>>;
  /**
   * The person taking the designation decision — `--by`, which is REQUIRED on
   * both CLIs since the cannon's F3.
   *
   * It is the shop's owner here only because the suite needs SOME `app_user`;
   * nothing verifies the claim, which is the point 058 R1 makes about it and the
   * reason F3 asked for the flag rather than for a check.
   */
  let actorId: string;

  const shopQuery = (sql: string, values?: unknown[]): Promise<pg.QueryResult> =>
    asShop(pool, shopId).query(sql, values);

  /** A person nobody has heard of, with a session on this shop's phone. */
  async function personWithSession(tag: string): Promise<{ userId: string; sessionId: string }> {
    const userId = await insertUser(pool, `${tag}-${randomUUID()}@example.invalid`, `Person ${tag}`);
    const session = await openOperator(pool, device, userId);
    return { userId, sessionId: session.row.id };
  }

  /** Only the sessions this suite created, so a sibling case cannot colour a count. */
  const findingsFor = async (sessionIds: readonly string[]): Promise<string[]> =>
    (await unreconciledBreakGlassSessions(ownerPool))
      .map((u) => u.sessionId)
      .filter((id) => sessionIds.includes(id));

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_origin_predicate");
    await runMigrations(migrateUrl);
    ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Origin Shop", slug: `origin-${Date.now()}` });
    otherShopId = await seedShop(ownerPool, { name: "Other Shop", slug: `origin-o-${Date.now()}` });
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    identity = await seedIdentity(pool, shopId);
    device = await openDevice(pool, identity);
    actorId = identity.ownerId;
  }, 180_000);

  afterAll(async () => {
    await Promise.all([pool?.end(), ownerPool?.end()]);
  });

  // -------------------------------------------------------------------------
  // (a)–(d): the population, and what covers it
  // -------------------------------------------------------------------------

  it("(a) a staff session UNDER a live break-glass grant reconciles", async () => {
    const { userId, sessionId } = await personWithSession("bga");
    await designateStaff(ownerPool, { appUserId: userId, designatedBy: actorId, reason: "support engineer" });
    // The grant has to cover the session's ISSUANCE, so it starts before it.
    await shopQuery(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_from, effective_until, reason)
       VALUES ($1,$2,'shop','support_break_glass', now() - interval '1 hour', now() + interval '1 hour','ticket 41')`,
      [userId, shopId]
    );
    expect(await findingsFor([sessionId])).toEqual([]);
  });

  it("(b) a staff session with NO grant anywhere is a finding — the hole 054 §6 recorded", async () => {
    // ⚠ THE CASE THAT COULD NOT BE EXPRESSED BEFORE `migrations/032`. This person
    // holds no `support_break_glass` row at any shop and never has, so the old
    // population — "every session of a person who holds the role at some time" —
    // excluded them by construction. 054 §6: *"a Longbox employee who was never
    // granted break-glass is invisible to it."*
    const { userId, sessionId } = await personWithSession("bgb");
    expect(await findingsFor([sessionId]), "not staff yet, so not in the population").toEqual([]);

    await designateStaff(ownerPool, {
      appUserId: userId,
      designatedBy: actorId,
      reason: "joined the support rota",
      // Back-dated so it covers the session opened a moment ago (058 §3(b)):
      // widening the population is the direction a designation may reach.
      effectiveFrom: new Date(Date.now() - 60_000),
    });
    expect(await findingsFor([sessionId])).toEqual([sessionId]);
  });

  it("(b′) a staff session at a shop whose grant is at ANOTHER shop is still a finding", async () => {
    // The most interesting row this query can produce, and the reason origin
    // carries no `shop_id`: a Longbox person acting somewhere their grant does
    // not reach. The grant is written in the OTHER shop's tenant context, which
    // is what E03-B04's `WITH CHECK` requires.
    const { userId, sessionId } = await personWithSession("bgb2");
    await designateStaff(ownerPool, {
      appUserId: userId,
      designatedBy: actorId,
      reason: "support rota",
      effectiveFrom: new Date(Date.now() - 60_000),
    });
    await asShop(pool, otherShopId).query(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_from, effective_until, reason)
       VALUES ($1,$2,'shop','support_break_glass', now() - interval '1 hour', now() + interval '1 hour','elsewhere')`,
      [userId, otherShopId]
    );
    expect(await findingsFor([sessionId])).toEqual([sessionId]);
  });

  it("(c) a staff session issued AFTER the grant expired is a finding", async () => {
    const userId = await insertUser(pool, `bgc-${randomUUID()}@example.invalid`, "Person BGC");
    await designateStaff(ownerPool, { appUserId: userId, designatedBy: actorId, reason: "support engineer" });
    await shopQuery(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, role, effective_from, effective_until, reason)
       VALUES ($1,$2,'shop','support_break_glass', now() - interval '3 hours', now() - interval '2 hours','closed ticket')`,
      [userId, shopId]
    );
    const session = await openOperator(pool, device, userId);
    expect(await findingsFor([session.row.id])).toEqual([session.row.id]);
  });

  it("(d) an ordinary operator's session is not in the population at all", async () => {
    // The shop's own person, with an ordinary grant and no designation. Nothing
    // about them is any of this detector's business — which is 022 P3's whole
    // point, and the reason the population is a union of two narrow predicates
    // rather than "every session".
    const { userId, sessionId } = await personWithSession("bgd");
    await shopQuery(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, role) VALUES ($1,$2,'shop','operator')`,
      [userId, shopId]
    );
    expect(await findingsFor([sessionId])).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // (e): the retirement, and the asymmetry that is the control
  // -------------------------------------------------------------------------

  it("(e) a RETIRED designation takes LATER sessions out, and leaves EARLIER ones in", async () => {
    const userId = await insertUser(pool, `bge-${randomUUID()}@example.invalid`, "Person BGE");
    await designateStaff(ownerPool, {
      appUserId: userId,
      designatedBy: actorId,
      reason: "contractor, six weeks",
      effectiveFrom: new Date(Date.now() - 3_600_000),
    });
    const during = await openOperator(pool, device, userId);
    expect(await findingsFor([during.row.id]), "staff, no grant → a finding").toEqual([during.row.id]);

    const out = await retireStaffDesignation(ownerPool, {
      appUserId: userId,
      reason: "left",
      retiredBy: actorId,
    });
    expect(out.retired).toBe(1);
    expect(out.remaining.every((d) => d.retiredAt !== null)).toBe(true);

    const after = await openOperator(pool, device, userId);
    // 058 §3(b), both halves in one assertion. The session opened AFTER the
    // retirement is out of the population — a retirement really does end the
    // designation. The session opened BEFORE it is still a finding, because the
    // predicate is evaluated AS OF the session's own issuance and the retirement
    // has no timestamp its writer could choose. Narrowing the population
    // retroactively is the one motion this design does not make expressible.
    expect(await findingsFor([after.row.id])).toEqual([]);
    expect(await findingsFor([during.row.id])).toEqual([during.row.id]);
  });

  it("(e′) re-designating is a NEW row, not an un-retirement, and it works", async () => {
    const userId = await insertUser(pool, `bge2-${randomUUID()}@example.invalid`, "Person BGE2");
    await designateStaff(ownerPool, { appUserId: userId, designatedBy: actorId, reason: "first stint" });
    await retireStaffDesignation(ownerPool, { appUserId: userId, reason: "left", retiredBy: actorId });
    const held = await designateStaff(ownerPool, {
      appUserId: userId,
      designatedBy: actorId,
      reason: "rehired",
    });
    expect(held).toHaveLength(2);
    expect(held.filter((d) => d.retiredAt === null)).toHaveLength(1);
    const session = await openOperator(pool, device, userId);
    expect(await findingsFor([session.row.id])).toEqual([session.row.id]);
  });

  // -------------------------------------------------------------------------
  // (f): who may write it at all
  // -------------------------------------------------------------------------

  it("(f) the CLI REFUSES on the application role, before writing anything", async () => {
    const userId = await insertUser(pool, `bgf-${randomUUID()}@example.invalid`, "Person BGF");
    await expect(designateStaff(pool, { appUserId: userId, reason: "should not land" })).rejects.toThrow(
      /APPLICATION role, not the schema owner/
    );
    await expect(
      retireStaffDesignation(pool, { appUserId: userId, reason: "should not land" })
    ).rejects.toThrow(/APPLICATION role, not the schema owner/);
    const rows = await ownerPool.query(
      `SELECT count(*)::int AS n FROM app_user_origin WHERE app_user_id = $1`,
      [userId]
    );
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("(f′) and the application role has NO privilege on either table, so even a raw INSERT fails", async () => {
    // The second half of 058 §3(c), and the one that matters: the guard above is
    // a check in a script, this is the database refusing. A compromised server
    // appending a RETIREMENT would take a staff account out of the audited
    // population — so the process being watched holds nothing on the table that
    // records who is watched.
    const userId = await insertUser(pool, `bgf2-${randomUUID()}@example.invalid`, "Person BGF2");
    await expect(
      pool.query(
        `INSERT INTO app_user_origin (app_user_id, origin, reason) VALUES ($1,'longbox_staff','x')`,
        [userId]
      )
    ).rejects.toThrow(/permission denied/);
    await expect(pool.query(`SELECT count(*) FROM app_user_origin_retirement`)).rejects.toThrow(
      /permission denied/
    );
  });

  it("(f″) F2: the BOOT ASSERTION catches a stray grant on a no-grant table", async () => {
    // ⚠ **THE LENS'S F2, AS THE PROBE THAT FOUND IT.** With both tables RLS-exempt
    // (they carry no tenant — 058 §3(d)), no policy stands behind the grant, so
    // the grant WAS the whole mechanism and nothing checked it at runtime: after
    // a stray `GRANT INSERT`, the application role could append a back-dated
    // retirement while `checkRoleSeparation` and `checkTenantIsolation` both
    // reported green. The check is now part of the boot assertion, and this case
    // is the reproduction that proves it can fail.
    const before = await checkTenantIsolation(pool);
    expect(before.forbiddenGrants).toEqual([]);
    expect(before.ok).toBe(true);

    await ownerPool.query(`GRANT INSERT ON app_user_origin_retirement TO ${APP_ROLE}`);
    try {
      const during = await checkTenantIsolation(pool);
      expect(during.forbiddenGrants).toEqual(["app_user_origin_retirement"]);
      expect(during.ok, "a stray grant left the boot assertion green").toBe(false);
      expect(describeTenantIsolationFailure(during)).toContain("app_user_origin_retirement");
      await expect(assertTenantIsolationOrThrow(pool, silent())).rejects.toThrow(
        /refusing to serve|appGrant/
      );
    } finally {
      await ownerPool.query(`REVOKE INSERT ON app_user_origin_retirement FROM ${APP_ROLE}`);
    }

    // Back to clean once the grant is gone, so the case proves the check reacts
    // to the privilege rather than to some permanent property of the fixture.
    const after = await checkTenantIsolation(pool);
    expect(after.forbiddenGrants).toEqual([]);
    expect(after.ok).toBe(true);
  });

  it("(F1) REFUSES a back-dated retirement — the retroactive narrowing, attempted", async () => {
    // ⚠ **THE ATTACK 058 v1.0.0 CALLED "NOT EXPRESSIBLE" AND DID NOT ENFORCE.**
    // `created_at`'s `DEFAULT now()` applies only when the writer OMITS the
    // column; supplying it was one INSERT, and the contract test asserting the
    // absence of `retired_at` could not see it. `migrations/033` forces the
    // value. This is the schema OWNER — the strongest principal short of a
    // superuser, and the only one that can write these tables at all.
    const userId = await insertUser(pool, `bgf1-${randomUUID()}@example.invalid`, "Person BGF1");
    const [held] = await designateStaff(ownerPool, {
      appUserId: userId,
      reason: "support rota",
      designatedBy: actorId,
      effectiveFrom: new Date(Date.now() - 3_600_000),
    });
    const during = await openOperator(pool, device, userId);
    expect(await findingsFor([during.row.id])).toEqual([during.row.id]);

    // The back-date is ACCEPTED as a statement and then IGNORED: the trigger
    // overwrites it rather than refusing, so an honest caller that names the
    // column keeps working and the value it named buys nothing.
    await ownerPool.query(
      `INSERT INTO app_user_origin_retirement (origin_id, reason, created_at)
       VALUES ($1,'back-dated', now() - interval '2 hours')`,
      [held!.id]
    );
    const stored = await ownerPool.query(
      `SELECT created_at FROM app_user_origin_retirement WHERE origin_id = $1`,
      [held!.id]
    );
    const at = new Date((stored.rows[0] as { created_at: Date | string }).created_at);
    expect(at.getTime(), "the writer's timestamp survived").toBeGreaterThan(Date.now() - 60_000);
    // …so the session that was already a finding is STILL a finding. That is the
    // whole property: an ending cannot reach backwards.
    expect(await findingsFor([during.row.id])).toEqual([during.row.id]);
  });

  it("(F1) REFUSES a designation that starts in the FUTURE, at the database", async () => {
    // The same retroactive narrowing from the other side, and it lived in
    // TypeScript alone at `635aabe` — a check the database did not have.
    const userId = await insertUser(pool, `bgf3-${randomUUID()}@example.invalid`, "Person BGF3");
    await expect(
      ownerPool.query(
        `INSERT INTO app_user_origin (app_user_id, origin, reason, effective_from)
         VALUES ($1,'longbox_staff','starts tomorrow', now() + interval '1 day')`,
        [userId]
      )
    ).rejects.toThrow(/effective_from is in the future/);
  });

  it("(F1) REFUSES a retirement that PREDATES its designation — the third check", async () => {
    // Implied by the forcing trigger and present anyway, because the failure it
    // guards against is that trigger being dropped by a future migration, which
    // no default and no application check can notice (034 §3.2, and 054 §6's
    // argument for the third break-glass bound, one table over). Exercised by
    // calling the check directly, since the forcing trigger makes the ordinary
    // path unable to produce the value.
    const userId = await insertUser(pool, `bgf4-${randomUUID()}@example.invalid`, "Person BGF4");
    const [held] = await designateStaff(ownerPool, {
      appUserId: userId,
      reason: "support rota",
      designatedBy: actorId,
    });
    // Only the FORCING trigger is switched off, by name — which is exactly the
    // world 058 v1.0.0 shipped, and the world a future migration could restore
    // by dropping it. The comparison trigger is untouched and still ALWAYS.
    await ownerPool.query(
      `ALTER TABLE app_user_origin_retirement DISABLE TRIGGER a_app_user_origin_retirement_forces_now`
    );
    try {
      await expect(
        ownerPool.query(
          `INSERT INTO app_user_origin_retirement (origin_id, reason, created_at)
           VALUES ($1,'predates', now() - interval '1 day')`,
          [held!.id]
        )
      ).rejects.toThrow(/predates its designation/);
    } finally {
      await ownerPool.query(
        `ALTER TABLE app_user_origin_retirement ENABLE ALWAYS TRIGGER a_app_user_origin_retirement_forces_now`
      );
    }
    // And the forcing trigger is back at 'A' — not merely enabled, which is the
    // bypassable default `CREATE TRIGGER` produces (041 §9.2 item 1).
    const state = await ownerPool.query(
      `SELECT tgenabled FROM pg_trigger WHERE tgname = 'a_app_user_origin_retirement_forces_now'`
    );
    expect((state.rows[0] as { tgenabled: string }).tgenabled).toBe("A");
  });

  it("refuses a blank reason and a FUTURE start, before any row exists", async () => {
    const userId = await insertUser(pool, `bgg-${randomUUID()}@example.invalid`, "Person BGG");
    await expect(
      designateStaff(ownerPool, { appUserId: userId, designatedBy: actorId, reason: "   " })
    ).rejects.toThrow(/must say why/);
    await expect(
      designateStaff(ownerPool, {
        appUserId: userId,
        designatedBy: actorId,
        reason: "starts tomorrow",
        effectiveFrom: new Date(Date.now() + 86_400_000),
      })
    ).rejects.toThrow(/starts in the future/);
    const rows = await ownerPool.query(
      `SELECT count(*)::int AS n FROM app_user_origin WHERE app_user_id = $1`,
      [userId]
    );
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  it("is append-only: even the SCHEMA OWNER cannot edit a designation or delete a retirement", async () => {
    const userId = await insertUser(pool, `bgh-${randomUUID()}@example.invalid`, "Person BGH");
    const [held] = await designateStaff(ownerPool, {
      appUserId: userId,
      designatedBy: actorId,
      reason: "support",
    });
    await expect(
      ownerPool.query(`UPDATE app_user_origin SET reason = 'edited' WHERE id = $1`, [held!.id])
    ).rejects.toThrow(/append-only/);
    await expect(ownerPool.query(`DELETE FROM app_user_origin WHERE id = $1`, [held!.id])).rejects.toThrow(
      /append-only/
    );
    await retireStaffDesignation(ownerPool, { appUserId: userId, reason: "left", retiredBy: actorId });
    // And a designation is retired at most once, by the UNIQUE rather than by a
    // convention — a second retirement of the same row is refused by the database.
    await expect(
      ownerPool.query(`INSERT INTO app_user_origin_retirement (origin_id, reason) VALUES ($1,'again')`, [
        held!.id,
      ])
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  // -------------------------------------------------------------------------
  // The audit's own shape
  // -------------------------------------------------------------------------

  it("`pnpm audit:break-glass` reports COUNTS per shop, names no person, and sees the window", async () => {
    const userId = await insertUser(pool, `bgi-${randomUUID()}@example.invalid`, "Person BGI");
    await designateStaff(ownerPool, {
      appUserId: userId,
      designatedBy: actorId,
      reason: "support rota",
      effectiveFrom: new Date(Date.now() - 60_000),
    });
    const session = await openOperator(pool, device, userId);

    const windowed = await runBreakGlassAudit(ownerPool, { windowHours: 24 });
    expect(windowed.clean).toBe(false);
    expect(windowed.designations).toBeGreaterThan(0);
    const here = windowed.findings.find((f) => f.shopId === shopId);
    expect(here, "the finding names the tenant an operator must act on").toBeDefined();
    expect(here!.longboxOrigin).toBeGreaterThan(0);
    // Nothing in the reported shape is a person or a session.
    expect(JSON.stringify(windowed.findings)).not.toContain(userId);
    expect(JSON.stringify(windowed.findings)).not.toContain(session.row.id);

    // A window whose START is after this session was issued sees nothing of it.
    // The bound is one-sided on purpose — "the last N hours" from the moment the
    // audit runs — so the exit code is for the CADENCE and the unbounded
    // question is `--all`. Simulated by moving `now` forward rather than by
    // shortening the window, because a fraction-of-a-second window would be a
    // race dressed as an assertion.
    const later = await runBreakGlassAudit(ownerPool, {
      windowHours: 24,
      now: new Date(Date.now() + 100 * 24 * 3_600_000),
    });
    expect(later.unreconciled).toBe(0);
    expect(later.clean).toBe(true);

    // `--all` asks the investigation's question and finds at least as much.
    const all = await runBreakGlassAudit(ownerPool, { windowHours: null });
    expect(all.windowHours).toBeNull();
    expect(all.unreconciled).toBeGreaterThanOrEqual(windowed.unreconciled);
    expect(summariseUnreconciled(await unreconciledBreakGlassSessions(ownerPool))).toEqual(all.findings);
  });

  it("does not put a DEVICE session in the population — a phone is not a person", async () => {
    // The device chain carries no `app_user_id`, so it is excluded by that
    // column and NOT by a `kind` literal — which is what lets E03-D11's
    // privileged chain join this population without an edit
    // (`tests/contract/origin-designation-surface.test.ts` pins the absence).
    const rows = await unreconciledBreakGlassSessions(ownerPool);
    expect(rows.map((r) => r.sessionId)).not.toContain(device.row.id);
    const kinds = await ownerPool.query(`SELECT DISTINCT kind FROM app_session WHERE id = ANY($1::uuid[])`, [
      rows.map((r) => r.sessionId),
    ]);
    expect((kinds.rows as Array<{ kind: string }>).map((k) => k.kind)).toEqual(["operator"]);
  });
});
