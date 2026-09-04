// L4: 048 I3 — "rotation, expiry and revocation are total, derived, and safe
// under concurrency." Eleven cases, five of which are concurrency cases.
//
// **Five of these are the ones a build is most tempted to write as a
// single-threaded happy path** (048 §11's closing note), and an invariant
// asserted serially is an invariant that passes for the wrong reason. Where a
// case is about two transactions racing, this suite runs two connections and
// makes them race.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import {
  ROTATION_GRACE_MS,
  lockAndRotate,
  lockLiveSessionsOf,
  resolveToken,
  revokeChain,
  revokeForReuse,
  revokeSessionsOf,
  tokenHash,
  type SessionRow,
} from "../../src/services/auth/index.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { openDevice, openOperator, seedIdentity, type SeededIdentity } from "./authHelpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("the session lifecycle (048 §3.3, I3)", () => {
  let pool: pg.Pool;
  let shopId: string;
  let identity: SeededIdentity;

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_session_lifecycle");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Lifecycle Shop", slug: `lifecycle-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    identity = await seedIdentity(pool, shopId);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  /** A fresh operator session on a fresh device chain, for a test that will break one. */
  async function freshPair(): Promise<{
    device: Awaited<ReturnType<typeof openDevice>>;
    operator: Awaited<ReturnType<typeof openOperator>>;
  }> {
    const device = await openDevice(pool, identity);
    const operator = await openOperator(pool, device, identity.operatorId);
    return { device, operator };
  }

  async function live(token: string): Promise<boolean> {
    const out = await resolveToken(pool, token, new Date());
    return !("refusal" in out);
  }

  // -------------------------------------------------------------------------
  // (i)–(vi): the six cases v1.0.0 of 048 named.
  // -------------------------------------------------------------------------

  it("(i) refuses a spent token outside the grace window, and revokes the OPERATOR chain", async () => {
    const { device, operator } = await freshPair();
    // Rotate by hand with a clock past the rotation period, which is what a
    // request arriving after that period does.
    const later = new Date(Date.now() + 60 * 60 * 1000);
    const successor = await withTransaction(pool, (tx) => lockAndRotate(tx, operator.row, later));
    expect(successor).toBeDefined();

    // The successor is live; the predecessor is spent. Presented outside the
    // grace window it is REUSE — evidence the cookie was copied, because the
    // legitimate client received the successor.
    const outside = new Date(successor!.row.issued_at.getTime() + ROTATION_GRACE_MS + 1_000);
    const verdict = await resolveToken(pool, operator.token, outside);
    expect("refusal" in verdict && verdict.refusal).toBe("token_reuse");

    // …and the response to that evidence is to revoke the OPERATOR chain, never
    // the device chain: a false positive that signs out an operator costs one
    // PIN; one that signs out a DEVICE costs an owner, an enrollment code and a
    // walk to the back room, during trading hours.
    await withTransaction(pool, (tx) => revokeForReuse(tx, operator.row));
    expect(await live(successor!.token)).toBe(false);
    expect(await live(device.token)).toBe(true);
  });

  it("(ii) refuses a revoked chain on the NEXT REQUEST, with no sweep anywhere", async () => {
    const { operator } = await freshPair();
    expect(await live(operator.token)).toBe(true);
    await withTransaction(pool, (tx) =>
      revokeChain(tx, { chainId: operator.row.chain_id, shopId, reason: "signed_out" })
    );
    // Nothing ran between the two lines but one INSERT. Liveness is DERIVED, so
    // there is no state to sweep and no job to have missed.
    expect(await live(operator.token)).toBe(false);
  });

  it("(iii) refuses a session past its ABSOLUTE expiry", async () => {
    const { operator } = await freshPair();
    const after = new Date(operator.row.absolute_expires_at.getTime() + 1_000);
    const verdict = await resolveToken(pool, operator.token, after);
    expect("refusal" in verdict && verdict.refusal).toBe("absolutely_expired");
  });

  it("(iv) refuses a session past its IDLE expiry — the control against a copied cookie", async () => {
    const { operator } = await freshPair();
    const after = new Date(operator.row.idle_expires_at.getTime() + 1_000);
    const verdict = await resolveToken(pool, operator.token, after);
    // 048 R4 struck the claim that reuse DETECTION is the defence: it fires only
    // when the legitimate client subsequently rotates. This is the control that
    // bounds a stolen cookie before the fact.
    expect("refusal" in verdict && verdict.refusal).toBe("idle_expired");
  });

  it("(v) ends every live session of a person when their membership changes, in ONE transaction", async () => {
    const person = await insertPerson();
    await grantShop(person);
    const device = await openDevice(pool, identity);
    const a = await openOperator(pool, device, person);
    const b = await openOperator(pool, device, person);
    expect(await live(a.token)).toBe(true);
    expect(await live(b.token)).toBe(true);

    await withTransaction(pool, async (tx) => {
      const ended = await revokeSessionsOf(tx, person);
      expect(ended).toBeGreaterThanOrEqual(2);
      await tx.query(
        `INSERT INTO membership_revocation (shop_id, membership_id, reason)
         SELECT $1, id, 'left the shop' FROM membership WHERE app_user_id = $2`,
        [shopId, person]
      );
    });

    // A revoked employee's phone stops working at the NEXT REQUEST rather than
    // at the next expiry (048 §3.4).
    expect(await live(a.token)).toBe(false);
    expect(await live(b.token)).toBe(false);
    // And the DEVICE chain is untouched: the phone still belongs to the shop.
    expect(await live(device.token)).toBe(true);
  });

  it("(vi) leaves no status column to disagree with the derivation (I4)", async () => {
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'app_session'
          AND column_name IN ('status','active','revoked','expired','last_seen_at')`
    );
    expect(cols.rows).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // (vii)–(xi): the five cases ratification added.
  // -------------------------------------------------------------------------

  it("(vii) leaves EXACTLY ONE successor under a concurrent rotation, and the loser accepts it", async () => {
    const { operator } = await freshPair();
    const later = new Date(Date.now() + 60 * 60 * 1000);

    // Two transactions, both reading the same live session, both rotating. This
    // is the double-tap: if the loser treated its own token as reused, the
    // control would manufacture the outage it exists to prevent.
    const [first, second] = await Promise.allSettled([
      withTransaction(pool, (tx) => lockAndRotate(tx, operator.row, later)),
      withTransaction(pool, (tx) => lockAndRotate(tx, operator.row, later)),
    ]);

    const successors = await pool.query(`SELECT id FROM app_session WHERE rotated_from = $1`, [
      operator.row.id,
    ]);
    // `UNIQUE (rotated_from)` — a session is superseded at most once, so the
    // chain is a chain and never a fork.
    expect(successors.rows).toHaveLength(1);
    // One of the two either won or found the winner and returned nothing; a
    // unique violation reaching the caller would be the failure this asserts is
    // absent.
    expect([first.status, second.status]).toEqual(["fulfilled", "fulfilled"]);

    // The LOSER — a request still holding the spent token — re-reads inside the
    // grace window and proceeds as the successor, setting no cookie (the winner's
    // response already carried it; the server never holds the token).
    const winner = await pool.query(`SELECT id, issued_at FROM app_session WHERE rotated_from = $1`, [
      operator.row.id,
    ]);
    const issuedAt = (winner.rows[0] as { issued_at: Date }).issued_at;
    const inside = new Date(issuedAt.getTime() + ROTATION_GRACE_MS / 2);
    const accepted = await resolveToken(pool, operator.token, inside);
    expect("refusal" in accepted).toBe(false);
    if (!("refusal" in accepted)) {
      expect(accepted.adoptedSuccessor).toBe(true);
      expect(accepted.row.id).toBe((winner.rows[0] as { id: string }).id);
    }
  });

  it("(viii) issues NO successor when the request rolls back, and the original token still works", async () => {
    const { operator } = await freshPair();
    const later = new Date(Date.now() + 60 * 60 * 1000);
    await expect(
      withTransaction(pool, async (tx) => {
        await lockAndRotate(tx, operator.row, later);
        // The handler throws AFTER the rotation, exactly as a refused write does.
        throw new Error("handler refused");
      })
    ).rejects.toThrow("handler refused");

    const successors = await pool.query(`SELECT id FROM app_session WHERE rotated_from = $1`, [
      operator.row.id,
    ]);
    expect(successors.rows).toEqual([]);
    // The rotation rolled back with the transaction, so the client's cookie —
    // which it never replaced, because no response carried a new one — is still
    // the live session.
    expect(await live(operator.token)).toBe(true);
  });

  it("(ix) makes a membership write and an in-flight request UNABLE to interleave (K3, Q6)", async () => {
    const person = await insertPerson();
    await grantShop(person);
    const device = await openDevice(pool, identity);
    const session = await openOperator(pool, device, person);

    // A request holds the session lock…
    const held = await pool.connect();
    const membershipDone = { value: false };
    try {
      await held.query("BEGIN");
      await held.query(`SELECT id FROM app_session WHERE id = $1 FOR NO KEY UPDATE`, [session.row.id]);

      // …while a membership write tries to take the same lock over every live
      // session of that person. "Same transaction" orders the membership write
      // against the rotation and NEITHER against the request; the lock is what
      // orders them, and this is the assertion that it does.
      const membership = withTransaction(pool, async (tx) => {
        await lockLiveSessionsOf(tx, person);
        membershipDone.value = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(membershipDone.value).toBe(false);

      await held.query("COMMIT");
      await membership;
      expect(membershipDone.value).toBe(true);
    } finally {
      held.release();
    }
  });

  it("(x) answers liveness at a CONSTANT cost whatever the chain depth (R2)", async () => {
    const shallow = await freshPair();
    const deepPair = await freshPair();

    // Rotate one chain forty times. Under the WALK 048 v1.0.0 described — "no
    // successor supersedes it", followed back up `rotated_from` — the cost of
    // every subsequent request on this chain would grow with this number, and a
    // phone worked all day is a chain hundreds of rows long.
    let currentRow: SessionRow = deepPair.operator.row;
    let currentToken = deepPair.operator.token;
    for (let i = 0; i < 40; i += 1) {
      const rotated = await withTransaction(pool, (tx) =>
        lockAndRotate(tx, currentRow, new Date(Date.now() + (i + 1) * 60 * 60 * 1000))
      );
      currentRow = rotated!.row;
      currentToken = rotated!.token;
    }
    const depth = await pool.query(`SELECT count(*)::int AS n FROM app_session WHERE chain_id = $1`, [
      deepPair.operator.row.chain_id,
    ]);
    expect((depth.rows[0] as { n: number }).n).toBe(41);

    const shallowPlan = await livenessPlan(shallow.operator.token);
    const deepPlan = await livenessPlan(currentToken);

    // Same node types, same nesting, same COUNT of index probes actually
    // executed. Not "fast enough" — identical, which is what "constant in
    // rotation depth" means and what a timing assertion could never say.
    expect(deepPlan.nodes).toEqual(shallowPlan.nodes);
    expect(deepPlan.loops).toBe(shallowPlan.loops);
    expect(deepPlan.rowsRead).toBe(shallowPlan.rowsRead);
    // And nothing recursive anywhere: a recursive CTE here would be the walk
    // wearing a different name.
    expect(deepPlan.nodes.join(" ")).not.toMatch(/Recursive/i);
  });

  it("(xi) REFUSES a successor whose principal or device differs from its predecessor (K5)", async () => {
    const { operator } = await freshPair();
    const stranger = await insertPerson();
    await grantShop(stranger);

    // A DIRECT INSERT, so this tests the constraint and not the application.
    // Without it, `rotated_from` is a bare pointer and a bug or a hostile write
    // that chains one person's session onto another's is a SILENT PRIVILEGE
    // TRANSFER that every liveness check in §3.3 would happily accept.
    await expect(
      pool.query(
        `INSERT INTO app_session
           (chain_id, kind, shop_id, location_id, device_id, device_credential_id, app_user_id,
            parent_session_id, parent_chain_id, token_hash, rotated_from,
            rotate_after, idle_expires_at, absolute_expires_at)
         VALUES ($1,'operator',$2,$3,$4,$5,$6,$7,$8,$9,$10,
                 now() + interval '1 hour', now() + interval '2 hours', now() + interval '3 hours')`,
        [
          operator.row.chain_id,
          shopId,
          identity.locationId,
          operator.row.device_id,
          identity.credentialId,
          stranger,
          operator.row.parent_session_id,
          operator.row.parent_chain_id,
          `sha256:${randomUUID()}`,
          operator.row.id,
        ]
      )
    ).rejects.toThrow(/app_session_rotation_keeps_its_principal/);
  });

  it("(xi-b) REFUSES a device-chain successor on another device, where the K5 FK cannot reach", async () => {
    const device = await openDevice(pool, identity);
    const otherDevice = await pool.query(
      `INSERT INTO device (shop_id, location_id, label, kind) VALUES ($1,$2,'other phone','phone')
       RETURNING id`,
      [shopId, identity.locationId]
    );
    // `app_user_id` is NULL on a device session, and a composite FK under MATCH
    // SIMPLE is NOT CHECKED when any referencing column is NULL — so K5's
    // constraint is inert on exactly the longer-lived chain. The second FK,
    // whose columns are never NULL, is what covers it.
    await expect(
      pool.query(
        `INSERT INTO app_session
           (chain_id, kind, shop_id, location_id, device_id, device_credential_id, token_hash,
            rotated_from, rotate_after, idle_expires_at, absolute_expires_at)
         VALUES ($1,'device',$2,$3,$4,$5,$6,$7,
                 now() + interval '1 hour', now() + interval '2 hours', now() + interval '3 hours')`,
        [
          device.row.chain_id,
          shopId,
          identity.locationId,
          (otherDevice.rows[0] as { id: string }).id,
          identity.credentialId,
          `sha256:${randomUUID()}`,
          device.row.id,
        ]
      )
    ).rejects.toThrow(/app_session_rotation_keeps_its_device/);
  });

  // -------------------------------------------------------------------------

  async function insertPerson(): Promise<string> {
    const res = await pool.query(
      `INSERT INTO app_user (email, display_name) VALUES ($1,'Person') RETURNING id`,
      [`person-${randomUUID()}@example.invalid`]
    );
    return (res.rows[0] as { id: string }).id;
  }

  async function grantShop(appUserId: string): Promise<void> {
    await pool.query(
      `INSERT INTO membership (app_user_id, shop_id, scope_kind, role) VALUES ($1,$2,'shop','operator')`,
      [appUserId, shopId]
    );
  }

  /**
   * The liveness statement's plan, EXECUTED, reduced to what "constant in depth"
   * actually claims: which nodes ran, how many times, and how many rows they
   * touched.
   */
  async function livenessPlan(token: string): Promise<{
    nodes: string[];
    loops: number;
    rowsRead: number;
  }> {
    const res = await pool.query(
      `EXPLAIN (ANALYZE, FORMAT JSON)
       SELECT s.id,
              EXISTS (SELECT 1 FROM app_session_revocation r WHERE r.chain_id = s.chain_id) AS chain_revoked,
              n.id AS successor_id
         FROM app_session s
         LEFT JOIN app_session n ON n.rotated_from = s.id
        WHERE s.token_hash = $1`,
      [tokenHash(token)]
    );
    const plan = (res.rows[0] as { "QUERY PLAN": Array<{ Plan: unknown }> })["QUERY PLAN"][0]!.Plan;
    const nodes: string[] = [];
    let loops = 0;
    let rowsRead = 0;
    const walk = (node: unknown): void => {
      const n = node as {
        "Node Type": string;
        "Actual Loops"?: number;
        "Actual Rows"?: number;
        Plans?: unknown[];
      };
      nodes.push(n["Node Type"]);
      loops += n["Actual Loops"] ?? 0;
      rowsRead += n["Actual Rows"] ?? 0;
      for (const child of n.Plans ?? []) walk(child);
    };
    walk(plan);
    return { nodes, loops, rowsRead };
  }
});
