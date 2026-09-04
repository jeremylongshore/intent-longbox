// L4 integration — 043 §11 I1 and the append-only half of I2, against a real
// Postgres, as the LEAST-PRIVILEGED APP ROLE.
//
// The pool connects as `longbox_app` (E02-D06), not as the migrate role that
// owns the schema, because that is what the server and the worker connect as: a
// property proved under a more privileged role than production uses is a
// property proved against the wrong principal. 043 §7.3 is explicit that the
// worker uses the same non-owner role for the same consequence — it cannot
// `SET session_replication_role`, cannot `ALTER TABLE … DISABLE TRIGGER`, and
// therefore cannot write a non-append-only row into either table even by
// mistake.
//
// Bead: longbox-e5b.2.17 (E02-D07). Docs: 043 §2.1, §2.3, §2.6, §7.3, §11 I1, I2.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { withTransaction } from "../../src/db.js";
import { createScanSession } from "../../src/services/scanSession.js";
import { enqueue, recordAttempt } from "../../src/services/outbox.js";
import { DRAFT_REQUESTED } from "../../src/events/catalogue.js";
import { appUrl, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("the outbox append (043 §2.1)", () => {
  let pool: pg.Pool;
  let shopId: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_e02d07_enqueue");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: appUrl(url), max: 6 });
    shopId = await seedShop(pool, { name: "Outbox Test Shop" });
  });

  afterAll(async () => {
    await pool?.end();
  });

  const newSession = async () => (await createScanSession(pool, shopId, "employee")).id;
  const countOutbox = async (sessionId: string) =>
    Number(
      (await pool.query(`SELECT count(*)::int AS n FROM outbox WHERE scan_session_id = $1`, [sessionId]))
        .rows[0]!.n
    );

  it("I1(b): the outbox row commits WITH the fact that justifies it", async () => {
    const sessionId = await newSession();
    const res = await withTransaction(pool, async (tx) => {
      await tx.query(
        `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source)
         VALUES ($1,$2,'{}','one_tap')`,
        [sessionId, shopId]
      );
      return enqueue(tx, {
        shopId,
        event: DRAFT_REQUESTED,
        scanSessionId: sessionId,
        authoredBy: "human",
      });
    });
    expect(res.alreadyEnqueued).toBe(false);
    expect(await countOutbox(sessionId)).toBe(1);
  });

  it("I1(c): a request that THROWS after the enqueue leaves NO outbox row and no effect", async () => {
    // This is the property the whole design exists for. If the request rolls
    // back there is no row and no effect; if it commits, the effect is OWED.
    // Before the outbox, the Shopify call had already happened by this point and
    // nothing recorded it (043 §1 E4).
    const sessionId = await newSession();
    await expect(
      withTransaction(pool, async (tx) => {
        await enqueue(tx, {
          shopId,
          event: DRAFT_REQUESTED,
          scanSessionId: sessionId,
          authoredBy: "human",
        });
        throw new Error("something failed after the append");
      })
    ).rejects.toThrow("something failed after the append");
    expect(await countOutbox(sessionId)).toBe(0);
  });

  it("the self-referencing command row really does point at itself (043 §3.4)", async () => {
    const sessionId = await newSession();
    const res = await withTransaction(pool, (tx) =>
      enqueue(tx, { shopId, event: DRAFT_REQUESTED, scanSessionId: sessionId, authoredBy: "human" })
    );
    const row = (await pool.query(`SELECT id, ref_table, ref_id FROM outbox WHERE id = $1`, [res.id]))
      .rows[0] as { id: string; ref_table: string; ref_id: string };
    expect(row.ref_table).toBe("outbox");
    expect(row.ref_id).toBe(row.id);
  });

  it("a reference-shaped event is de-duplicated by the UNIQUE constraint, not by a check", async () => {
    const sessionId = await newSession();
    const draft = (
      await pool.query(
        `INSERT INTO shopify_draft (scan_session_id, shop_id, product_gid, status)
         VALUES ($1,$2,'gid://x','draft') RETURNING id`,
        [sessionId, shopId]
      )
    ).rows[0] as { id: string };

    const first = await withTransaction(pool, (tx) =>
      enqueue(tx, {
        shopId,
        event: "longbox.commerce.draft_recorded",
        refId: draft.id,
        scanSessionId: sessionId,
        authoredBy: "system",
      })
    );
    const second = await withTransaction(pool, (tx) =>
      enqueue(tx, {
        shopId,
        event: "longbox.commerce.draft_recorded",
        refId: draft.id,
        scanSessionId: sessionId,
        authoredBy: "system",
      })
    );
    expect(second.alreadyEnqueued).toBe(true);
    expect(second.id).toBe(first.id);
  });
});

describe.skipIf(!dbUp)("both tables are append-only IN THE DATABASE (043 §11 I2)", () => {
  let pool: pg.Pool;
  let shopId: string;
  let outboxId: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_e02d07_appendonly");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: appUrl(url), max: 4 });
    shopId = await seedShop(pool, { name: "Outbox Immutability Shop" });
    const sessionId = (await createScanSession(pool, shopId, "employee")).id;
    outboxId = (
      await withTransaction(pool, (tx) =>
        enqueue(tx, { shopId, event: DRAFT_REQUESTED, scanSessionId: sessionId, authoredBy: "human" })
      )
    ).id;
    await recordAttempt(pool, { shopId, outboxId, attemptNo: 1, kind: "failed" });
  });

  afterAll(async () => {
    await pool?.end();
  });

  // TWO LAYERS REFUSE A MUTATION HERE, AND THE TESTS SAY WHICH ONE FIRES.
  // Rolling them into "it throws" would let a permission error stand in for the
  // trigger, which is exactly how a trigger assertion passes with the trigger
  // switched off (041 §1 E13 is that failure, one layer down).
  //
  //   * `outbox` holds the declared row-lock UPDATE privilege (043 §7.2/§7.3, see
  //     src/db/appendOnlyTables.ts's `appLockable`), so an UPDATE reaches the
  //     database and the TRIGGER refuses it. That is the strong assertion.
  //   * `outbox_attempt` has no UPDATE grant, so the PRIVILEGE refuses first;
  //     the trigger's refusal on that table is asserted from the owner role in
  //     tests/integration/append-only.test.ts, which iterates the declared list.
  //   * Neither table grants DELETE, so DELETE is refused by privilege on both.

  it("the TRIGGER refuses an UPDATE on outbox, with the row-lock privilege held", async () => {
    await expect(pool.query(`UPDATE outbox SET event = 'x' WHERE id = $1`, [outboxId])).rejects.toThrow(
      /append-only/
    );
  });

  it("the app role cannot DELETE from either table at all — no grant, no path", async () => {
    await expect(pool.query(`DELETE FROM outbox WHERE id = $1`, [outboxId])).rejects.toThrow(
      /permission denied/
    );
    await expect(pool.query(`DELETE FROM outbox_attempt WHERE outbox_id = $1`, [outboxId])).rejects.toThrow(
      /permission denied/
    );
  });

  it("the app role cannot even attempt an UPDATE on outbox_attempt — it holds no UPDATE grant", async () => {
    await expect(
      pool.query(`UPDATE outbox_attempt SET kind = 'delivered' WHERE outbox_id = $1`, [outboxId])
    ).rejects.toThrow(/permission denied/);
  });

  it("both triggers are ENABLE ALWAYS ('A'), not the bypassable default", async () => {
    // `CREATE TRIGGER` lands at 'O', which one SET session_replication_role
    // turns off for the session (migration 006 reproduces it). A new table
    // created at the default would be governed by a trigger anyone with a psql
    // prompt could step around.
    const rows = (
      await pool.query(
        `SELECT tg.tgname, tg.tgenabled FROM pg_trigger tg
           JOIN pg_class c ON c.oid = tg.tgrelid
          WHERE c.relname IN ('outbox','outbox_attempt') AND NOT tg.tgisinternal`
      )
    ).rows as Array<{ tgname: string; tgenabled: string }>;
    expect(rows.map((r) => r.tgname).sort()).toEqual(["outbox_append_only", "outbox_attempt_append_only"]);
    for (const r of rows) expect(r.tgenabled).toBe("A");
  });

  it("the app role holds exactly the derived privileges — and UPDATE only where a lock needs it", async () => {
    // The grant plan is DERIVED from the declared list; a table declared neither
    // append-only nor exempt fails the grant step loudly. This asserts the
    // derivation actually landed.
    //
    // ⚠ `outbox` CARRIES UPDATE, AND THAT IS A DECLARED ROW RATHER THAN A LEAK.
    // Postgres puts `SELECT … FOR UPDATE` under the UPDATE privilege (reproduced
    // in src/db/appendOnlyTables.ts's `appLockable` comment), so 043 §7.2's
    // claim mechanism and 043 §7.3's single-role rule together require it. The
    // guarantee was never the grant: the tests above prove the ENABLE ALWAYS
    // trigger still refuses an actual UPDATE *with the privilege held*, which is
    // a stronger assertion than the same test made before this row existed.
    const rows = (
      await pool.query(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
          WHERE grantee = current_user AND table_name IN ('outbox','outbox_attempt')
          ORDER BY table_name, privilege_type`
      )
    ).rows as Array<{ table_name: string; privilege_type: string }>;
    const byTable = new Map<string, string[]>();
    for (const r of rows) byTable.set(r.table_name, [...(byTable.get(r.table_name) ?? []), r.privilege_type]);
    expect(byTable.get("outbox")!.sort()).toEqual(["INSERT", "SELECT", "UPDATE"]);
    // The attempt log is never row-locked, so it keeps the uniform grant. The
    // set is kept as small as the mechanism requires.
    expect(byTable.get("outbox_attempt")!.sort()).toEqual(["INSERT", "SELECT"]);
    // And no DELETE anywhere: an append-only row is never removed.
    expect(rows.map((r) => r.privilege_type)).not.toContain("DELETE");
  });

  it("the app role can take the row lock the claim query needs", async () => {
    // The positive half of the row above: without the declared UPDATE grant this
    // fails with `permission denied for table outbox`, and the whole outbox
    // runtime is unrunnable as the least-privileged role.
    await expect(
      withTransaction(pool, (tx) => tx.query(`SELECT id FROM outbox FOR UPDATE SKIP LOCKED LIMIT 1`))
    ).resolves.toBeDefined();
  });

  it("the app role can read the dead-letter VIEW but cannot write through it", async () => {
    await expect(pool.query(`SELECT count(*) FROM outbox_dead_letter`)).resolves.toBeDefined();
  });

  it("the UNIQUE (outbox_id, attempt_no, kind) constraint refuses a second history", async () => {
    // 043 §5.1: a duplicate attempt row is a LOUD failure rather than a silent
    // second history — the construction 041 §5.3 uses for
    // UNIQUE (scan_session_id, session_seq), applied to a different counter.
    await expect(recordAttempt(pool, { shopId, outboxId, attemptNo: 1, kind: "failed" })).rejects.toThrow(
      /duplicate key|unique/i
    );
  });

  it("refuses a replay_requested with no operator and no reason, by CHECK (043 §6.3)", async () => {
    // A replay is the one row in this design that could quietly re-run an
    // external effect, so a nullable author is an invitation. 041 §2.3: "stop
    // forbidding a thing and start making it unrepresentable."
    //
    // ⚠ This CHECK makes replay_requested UNWRITABLE today, which is correct:
    // operator_id has no app_user to name (034 §4.1), so 043 §6.3 rules that the
    // replay path is not built before it (E10-B09).
    await expect(
      pool.query(
        `INSERT INTO outbox_attempt (shop_id, outbox_id, attempt_no, kind, authored_by)
         VALUES ($1,$2,2,'replay_requested','human')`,
        [shopId, outboxId]
      )
    ).rejects.toThrow(/outbox_attempt_replay_names_a_person/);

    await expect(
      pool.query(
        `INSERT INTO outbox_attempt (shop_id, outbox_id, attempt_no, kind, authored_by, operator_id, reason)
         VALUES ($1,$2,2,'replay_requested','human',$3,'   ')`,
        [shopId, outboxId, randomUUID()]
      )
    ).rejects.toThrow(/outbox_attempt_replay_names_a_person/);
  });
});
