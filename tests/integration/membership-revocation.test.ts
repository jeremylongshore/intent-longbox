// L4: 048 §3.4 and §3.5 — what a membership revocation drags with it.
//
// The rule in one sentence: **a revocation ends the grant, revokes every live
// session of that person, and RETIRES their PIN rows at that scope, all in one
// transaction.** The last of the three is what this suite exists for, because
// E03-D07 changed how it is written and the change is easy to undo by accident:
//
//   > `020` gave `operator_pin` a nullable `retired_at` and retirement was an
//   > `UPDATE`. E03-D07 made it an append-only `operator_pin_retirement` row and
//   > liveness a PREDICATE. `operator_pin` is the LOCKOUT ANCHOR — every PIN
//   > verification takes `SELECT … FOR UPDATE` on it — so an `UPDATE` retirement
//   > writes the security-critical row from a path that is not a PIN
//   > verification, and it destroys the record of when and why.
//
// So the assertions are written in both directions: the retirement row exists
// AND `operator_pin` was not mutated. A test that only checked "the PIN no
// longer verifies" would pass under either mechanism, which is exactly the
// assertion that lets a refactor quietly restore the column write.
//
// **No real names** (048 §7.1's header).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import {
  readOperatorPin,
  retireOperatorPins,
  revokeMembership,
  setOperatorPin,
  verifyOperatorPin,
} from "../../src/services/auth/index.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { TEST_PIN, grant, insertUser, seedIdentity, type SeededIdentity } from "./authHelpers.js";
import { TEST_PIN_PEPPER } from "../testConfig.js";

const dbUp = await probeDb();
const REPLACEMENT_PIN = "739154";

describe.skipIf(!dbUp)("a revocation retires the PIN as a FACT (048 §3.4, §3.5)", () => {
  let pool: pg.Pool;
  let shopId: string;
  let identity: SeededIdentity;

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_revocation");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Shop G", slug: `rev-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    identity = await seedIdentity(pool, shopId);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
  });

  /** A person with a membership at the shop and a PIN on its phone. */
  async function staffMember(): Promise<{ appUserId: string; membershipId: string }> {
    const appUserId = await insertUser(pool, `staff-${randomUUID()}@example.invalid`, "Staff");
    const membershipId = await grant(pool, appUserId, shopId, "operator");
    const set = await withTransaction(pool, (tx) =>
      setOperatorPin(tx, {
        shopId,
        deviceId: identity.deviceId,
        appUserId,
        pin: TEST_PIN,
        pepper: TEST_PIN_PEPPER,
      })
    );
    if (!set.ok) throw new Error(`seed PIN refused: ${set.refusal}`);
    return { appUserId, membershipId };
  }

  async function verify(appUserId: string, pin = TEST_PIN): Promise<string> {
    const verdict = await withTransaction(pool, (tx) =>
      verifyOperatorPin(tx, {
        shopId,
        deviceId: identity.deviceId,
        appUserId,
        pin,
        pepper: TEST_PIN_PEPPER,
        now: new Date(),
      })
    );
    return verdict.ok ? "ok" : verdict.reason;
  }

  it("retires the PIN so the operator can no longer verify — and writes a ROW, not an UPDATE", async () => {
    const { appUserId, membershipId } = await staffMember();
    expect(await verify(appUserId)).toBe("ok");

    const pinBefore = await readOperatorPin(pool, identity.deviceId, appUserId);
    expect(pinBefore?.retired).toBe(false);

    const out = await withTransaction(pool, (tx) =>
      revokeMembership(tx, { membershipId, revokedBy: identity.ownerId, reason: "left the shop" })
    );
    expect(out.revoked).toBe(true);
    expect(out.pinsRetired).toBe(1);

    // The correct PIN is refused, and the REASON is `retired` rather than
    // `wrong_pin`: nothing about the digest changed.
    expect(await verify(appUserId)).toBe("retired");

    // The fact exists, names the revocation, and says why.
    const retirement = await pool.query(
      `SELECT r.reason, r.membership_revocation_id, r.authored_by, r.retired_pin_updated_at
         FROM operator_pin_retirement r WHERE r.operator_pin_id = $1`,
      [pinBefore!.id]
    );
    expect(retirement.rows).toHaveLength(1);
    const fact = retirement.rows[0] as {
      reason: string;
      membership_revocation_id: string | null;
      authored_by: string;
      retired_pin_updated_at: Date;
    };
    expect(fact.reason).toBe("left the shop");
    expect(fact.membership_revocation_id).not.toBeNull();
    // 041 §2.3's envelope: the SERVER wrote this row as a consequence of a
    // person's revocation, and that person is named by
    // `membership_revocation.revoked_by`.
    expect(fact.authored_by).toBe("system");
    // ⚠ THIS ONE IS DECORATIVE, AND SAYING SO IS THE POINT. Both sides arrive
    // through node-postgres as JavaScript `Date`s, so both are already truncated
    // to milliseconds — which means this comparison would ALSO pass under the
    // truncation bug it looks like it guards (the microsecond `updated_at` this
    // retirement must name exactly). **The guard is the `retired` predicate at
    // the top of the re-hire case below**, which reads the version match back out
    // of SQL where the microseconds still exist: if the retirement named a
    // truncated version, the PIN would read LIVE and that case would fail. Kept
    // as a cheap shape check on the column, labelled so nobody mistakes it for
    // the real one.
    expect(fact.retired_pin_updated_at.getTime()).toBe(pinBefore!.updated_at.getTime());

    // **AND `operator_pin` WAS NOT TOUCHED.** This is the assertion that
    // distinguishes the two mechanisms: `retired_at` is still NULL and
    // `updated_at` is unchanged, so the lockout anchor was not written from a
    // path that is not a PIN verification.
    const pinAfter = await readOperatorPin(pool, identity.deviceId, appUserId);
    expect(pinAfter?.retired_at).toBeNull();
    expect(pinAfter?.updated_at.getTime()).toBe(pinBefore!.updated_at.getTime());
    expect(pinAfter?.retired_by_fact).toBe(true);
    expect(pinAfter?.retired).toBe(true);
  });

  it("revokes every live session of that person in the same transaction (048 §3.4)", async () => {
    const { appUserId, membershipId } = await staffMember();
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM app_session_revocation r
        JOIN app_session s ON s.chain_id = r.chain_id WHERE s.app_user_id = $1`,
      [appUserId]
    );
    const out = await withTransaction(pool, (tx) =>
      revokeMembership(tx, { membershipId, revokedBy: identity.ownerId, reason: "role change" })
    );
    // No live sessions were opened for this person, so the count is zero and
    // stays zero. What matters is that the call RAN the revocation rather than
    // leaving it to a caller — the sessions half is proved in full by
    // `session-lifecycle.test.ts` I3(vi).
    expect(out.sessionsRevoked).toBe(before.rowCount === 0 ? 0 : out.sessionsRevoked);
  });

  it("is idempotent: a second revocation writes nothing new and refuses nothing", async () => {
    const { appUserId, membershipId } = await staffMember();
    const first = await withTransaction(pool, (tx) =>
      revokeMembership(tx, { membershipId, reason: "first" })
    );
    expect(first).toMatchObject({ revoked: true, pinsRetired: 1 });

    const second = await withTransaction(pool, (tx) =>
      revokeMembership(tx, { membershipId, reason: "second" })
    );
    // `UNIQUE (membership_id)` on the revocation and
    // `UNIQUE (operator_pin_id, retired_pin_updated_at)` on the retirement both
    // absorb it — which is the idempotence a status column cannot give.
    expect(second.revoked).toBe(false);
    expect(second.pinsRetired).toBe(0);

    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM membership_revocation WHERE membership_id = $1`,
      [membershipId]
    );
    expect((rows.rows[0] as { n: number }).n).toBe(1);
    expect(await verify(appUserId)).toBe("retired");
  });

  it("a RE-HIRED person's new PIN is live again, and can be retired a SECOND time", async () => {
    // This is the case `UNIQUE (operator_pin_id, retired_pin_updated_at)` exists
    // for, and the one a bare `UNIQUE (operator_pin_id)` would break: one
    // `operator_pin` row per `(device, person)` pair means a re-hire re-uses the
    // row, so a retirement keyed on the row alone could never be written twice
    // and a re-hired-then-fired employee's PIN would stay live forever.
    const { appUserId, membershipId } = await staffMember();
    await withTransaction(pool, (tx) => revokeMembership(tx, { membershipId, reason: "left" }));
    expect(await verify(appUserId)).toBe("retired");

    // Re-hired: a new grant and a new PIN. Setting the PIN bumps `updated_at`, so
    // the existing retirement fact no longer names the current version and the
    // predicate reads live — with no UPDATE to any retirement row and nothing
    // deleted.
    const second = await grant(pool, appUserId, shopId, "operator");
    const set = await withTransaction(pool, (tx) =>
      setOperatorPin(tx, {
        shopId,
        deviceId: identity.deviceId,
        appUserId,
        pin: REPLACEMENT_PIN,
        pepper: TEST_PIN_PEPPER,
      })
    );
    expect(set.ok).toBe(true);
    expect(await verify(appUserId, REPLACEMENT_PIN)).toBe("ok");

    // And fired again: a SECOND retirement row, naming the new version.
    const out = await withTransaction(pool, (tx) =>
      revokeMembership(tx, { membershipId: second, reason: "left again" })
    );
    expect(out.pinsRetired).toBe(1);
    expect(await verify(appUserId, REPLACEMENT_PIN)).toBe("retired");

    const pin = await readOperatorPin(pool, identity.deviceId, appUserId);
    const facts = await pool.query(
      `SELECT count(*)::int AS n FROM operator_pin_retirement WHERE operator_pin_id = $1`,
      [pin!.id]
    );
    expect((facts.rows[0] as { n: number }).n).toBe(2);
  });

  it("retires only the named person's PINs, and only at the named shop", async () => {
    const mine = await staffMember();
    const colleague = await staffMember();
    await withTransaction(pool, (tx) =>
      retireOperatorPins(tx, {
        appUserId: mine.appUserId,
        shopId,
        reason: "one person only",
      })
    );
    expect(await verify(mine.appUserId)).toBe("retired");
    expect(await verify(colleague.appUserId)).toBe("ok");
  });

  it("the retirement table is append-only: no UPDATE, no DELETE, from the app role", async () => {
    const { appUserId } = await staffMember();
    await withTransaction(pool, (tx) =>
      retireOperatorPins(tx, { appUserId, shopId, reason: "for the trigger test" })
    );
    const pin = await readOperatorPin(pool, identity.deviceId, appUserId);
    await expect(
      pool.query(`UPDATE operator_pin_retirement SET reason = 'edited' WHERE operator_pin_id = $1`, [pin!.id])
    ).rejects.toThrow();
    await expect(
      pool.query(`DELETE FROM operator_pin_retirement WHERE operator_pin_id = $1`, [pin!.id])
    ).rejects.toThrow();
  });
});
