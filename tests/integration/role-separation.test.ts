// L4: the application role CANNOT turn the append-only guarantee off (E02-D06).
//
// 041 §9.2 item 2 calls role separation "the strongest available mitigation" and
// §1 E15 reproduces the three outcomes this file re-proves against the shipped
// migrations rather than against a scratch table: a non-owner, non-superuser role
// gets `permission denied to set parameter "session_replication_role"` and
// `must be owner of table …`, and its UPDATE is refused by the trigger.
//
// The error TEXTS are asserted, not just the fact of a rejection, because the
// three failures are only distinguishable by their message: a `permission denied`
// and a trigger's `is append-only` mean completely different things about which
// control is doing the work, and a test that accepts any throw would pass if the
// statement failed for an unrelated reason (a typo'd table name, a closed pool).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  appUrl,
  APP_ROLE,
  createFreshDb,
  MIGRATE_ROLE,
  probeDb,
  runMigrations,
  seedShop,
  superuserUrl,
} from "./helpers.js";
import { APPEND_ONLY_EXEMPTIONS, APPEND_ONLY_TABLE_NAMES } from "../../src/db/appendOnlyTables.js";
import { APP_LOCKABLE_TABLE_NAMES, NO_APP_GRANT_TABLE_NAMES } from "../../src/db/appRoleGrants.js";
import { createScanSession } from "../../src/services/scanSession.js";
import { checkRoleSeparation, assertRoleSeparationOrThrow } from "../../src/services/roleSeparation.js";

const dbUp = await probeDb();

/** Declared-exempt tables that exist in the schema AND the app may touch. */
const LIVE_EXEMPT = APPEND_ONLY_EXEMPTIONS.filter((e) => !e.pending && e.appGrant !== "none").map(
  (e) => e.table
);

describe.skipIf(!dbUp)("role separation: the app role owns nothing", () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let superuserPool: pg.Pool;
  let shopId: string;

  beforeAll(async () => {
    const migrateUrl = await createFreshDb("longbox_role_sep_e02d06");
    await runMigrations(migrateUrl);
    ownerPool = new pg.Pool({ connectionString: migrateUrl });
    appPool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    superuserPool = new pg.Pool({ connectionString: superuserUrl(migrateUrl) });
    shopId = await seedShop(ownerPool);
  });

  afterAll(async () => {
    await superuserPool?.end();
    await appPool?.end();
    await ownerPool?.end();
  });

  it("connects as the app role, which is neither superuser nor an owner", async () => {
    const result = await checkRoleSeparation(appPool);
    expect(result).toEqual({
      ok: true,
      role: APP_ROLE,
      isSuperuser: false,
      ownedAppendOnlyTables: [],
    });
  });

  it("the boot assertion passes on the app connection and fails on the owner connection", async () => {
    await expect(assertRoleSeparationOrThrow(appPool, silentLogger())).resolves.toBeUndefined();
    await expect(assertRoleSeparationOrThrow(ownerPool, silentLogger())).rejects.toThrow(
      /refusing to serve: this connection could disable the append-only triggers/
    );
  });

  // ── The NOINHERIT membership hole (invariant review of bc34075) ──

  it("rejects a NOINHERIT membership in the owning role, which pg_has_role 'USAGE' would miss", async () => {
    // THE UNIT FAKE CANNOT CATCH THIS. tests/role-separation.test.ts drives a
    // hand-written pool that returns whatever row list the case wants, so it
    // proves what the module DOES with an answer — never which answer Postgres
    // actually gives. The bug lives entirely in the privilege keyword inside the
    // SQL: `pg_has_role(current_user, relowner, 'USAGE')` asks "are that role's
    // privileges inherited right now?" and is FALSE under a non-inheriting grant,
    // while `SET ROLE` still succeeds — so the app connection could become the
    // owner and DISABLE TRIGGER while the boot check reported a clean bill. Only a
    // real cluster can tell 'USAGE' from 'MEMBER'.
    //
    // Granting membership requires the superuser here: longbox_migrate is
    // NOCREATEROLE and cannot hand out membership in itself.
    await superuserPool.query(`GRANT ${MIGRATE_ROLE} TO ${APP_ROLE} WITH INHERIT FALSE`);
    try {
      const result = await checkRoleSeparation(appPool);
      expect(result.ok).toBe(false);
      expect(result.ownedAppendOnlyTables).toEqual([...APPEND_ONLY_TABLE_NAMES].sort());
      await expect(assertRoleSeparationOrThrow(appPool, silentLogger())).rejects.toThrow(
        /refusing to serve: this connection could disable the append-only triggers/
      );

      // And the reachability the check now sees is real, not theoretical: on this
      // very connection SET ROLE succeeds and the owner-only DDL goes through.
      const client = await appPool.connect();
      try {
        await client.query(`SET ROLE ${MIGRATE_ROLE}`);
        await expect(
          client.query(`ALTER TABLE cost_log DISABLE TRIGGER cost_log_append_only`)
        ).resolves.toBeTruthy();
        await client.query(`ALTER TABLE cost_log ENABLE ALWAYS TRIGGER cost_log_append_only`);
      } finally {
        await client.query(`RESET ROLE`).catch(() => undefined);
        client.release();
      }
    } finally {
      await superuserPool.query(`REVOKE ${MIGRATE_ROLE} FROM ${APP_ROLE}`);
    }

    // Back to clean once the membership is gone — so the case proves the check
    // reacts to the grant rather than to some permanent property of the fixture.
    await expect(assertRoleSeparationOrThrow(appPool, silentLogger())).resolves.toBeUndefined();
  });

  // ── The three doors, each with its exact error text (041 §1 E15) ──

  it("cannot SET session_replication_role — permission denied to set parameter", async () => {
    await expect(appPool.query(`SET session_replication_role = 'replica'`)).rejects.toThrow(
      'permission denied to set parameter "session_replication_role"'
    );
  });

  it("cannot DISABLE TRIGGER — must be owner of table", async () => {
    await expect(appPool.query(`ALTER TABLE cost_log DISABLE TRIGGER cost_log_append_only`)).rejects.toThrow(
      /must be owner of (table )?cost_log/
    );
  });

  it("cannot run DDL at all — no CREATE on schema public", async () => {
    await expect(appPool.query(`CREATE TABLE app_role_ddl_probe (id int)`)).rejects.toThrow(
      /permission denied for schema public/
    );
    await expect(appPool.query(`DROP TABLE cost_log`)).rejects.toThrow(/must be owner of (table )?cost_log/);
  });

  // ── What it CAN do: append, read, and edit exactly the exempt tables ──

  it("INSERT is allowed on an append-only table; UPDATE and DELETE never reach the trigger", async () => {
    const inserted = await appPool.query(
      `INSERT INTO cost_log (shop_id, provider, model, tokens_in, tokens_out, estimated_usd)
       VALUES ($1, 'anthropic', 'claude-sonnet-5', 1, 1, 0) RETURNING id`,
      [shopId]
    );
    const id = (inserted.rows[0] as { id: string }).id;
    expect(id).toBeTruthy();

    // The refusal the app role gets is `permission denied`, NOT the trigger's
    // message — and that is the point of this bead rather than a weaker result.
    // Before role separation the ONLY thing standing between the server and an
    // edited witness row was a trigger the same connection could disable; now
    // the statement is refused by the grant, one layer earlier, and the trigger
    // is a second line it never reaches. The trigger's own refusal is proved on
    // the OWNER connection below, and against a superuser in append-only.test.ts.
    await expect(appPool.query(`UPDATE cost_log SET estimated_usd = 1 WHERE id = $1`, [id])).rejects.toThrow(
      "permission denied for table cost_log"
    );
    await expect(appPool.query(`DELETE FROM cost_log WHERE id = $1`, [id])).rejects.toThrow(
      "permission denied for table cost_log"
    );

    // Same row, owner connection: the trigger is what refuses here, which is
    // what keeps the two layers distinguishable instead of one masking the other.
    await expect(
      ownerPool.query(`UPDATE cost_log SET estimated_usd = 1 WHERE id = $1`, [id])
    ).rejects.toThrow(/table cost_log is append-only \(Hickey model\): UPDATE not allowed/);

    const still = await ownerPool.query(`SELECT count(*)::int AS n FROM cost_log WHERE id = $1`, [id]);
    expect((still.rows[0] as { n: number }).n).toBe(1);
  });

  it("UPDATE is allowed on a declared-exempt config table", async () => {
    const res = await appPool.query(`UPDATE shop SET name = $1 WHERE id = $2 RETURNING name`, [
      `renamed-${randomUUID().slice(0, 8)}`,
      shopId,
    ]);
    expect(res.rowCount).toBe(1);
  });

  it("SELECT is allowed on the read-model views", async () => {
    await expect(appPool.query(`SELECT count(*) FROM pricing_snapshot_current`)).resolves.toBeTruthy();
  });

  // ── The privilege set itself, asserted in both directions ──
  //
  // Reading role_table_grants both ways is what makes this more than a spot
  // check: a grant the plan does not intend (UPDATE on a witness table) fails,
  // AND a grant the plan does intend but never applied (a table added by a
  // future migration and never granted) fails too.

  it("every append-only table grants the app role exactly SELECT and INSERT", async () => {
    const grants = await privilegesByTable(ownerPool);
    for (const table of APPEND_ONLY_TABLE_NAMES) {
      if (APP_LOCKABLE_TABLE_NAMES.includes(table)) continue; // asserted separately below
      expect({ table, privileges: grants.get(table) }).toEqual({
        table,
        privileges: ["INSERT", "SELECT"],
      });
    }
  });

  // ⚠ THE ONE EXCEPTION, AND IT IS A DECLARED ROW RATHER THAN A LEAK (E02-D07).
  //
  // PostgreSQL puts `SELECT … FOR UPDATE` under the UPDATE privilege, so a table
  // on the uniform SELECT+INSERT grant cannot be row-locked by the application
  // at all — reproduced on postgres:16 in src/db/appendOnlyTables.ts's
  // `appLockable` comment. 043 §7.2 ratifies `FOR UPDATE … SKIP LOCKED` as the
  // outbox's claim mechanism and 043 §7.3 ratifies that the worker uses THIS
  // SAME non-owner role rather than a third privileged principal, so the two
  // decisions together require the privilege.
  //
  // The guarantee was never the grant. The next test proves the ENABLE ALWAYS
  // trigger still refuses an actual UPDATE *while the privilege is held*, which
  // is a stronger assertion than the loop above ever made.
  it("a DECLARED row-lockable append-only table also grants UPDATE, and nothing else", async () => {
    const grants = await privilegesByTable(ownerPool);
    expect(APP_LOCKABLE_TABLE_NAMES.length).toBeGreaterThan(0);
    for (const table of APP_LOCKABLE_TABLE_NAMES) {
      expect({ table, privileges: grants.get(table) }).toEqual({
        table,
        privileges: ["INSERT", "SELECT", "UPDATE"],
      });
    }
  });

  it("the app role can TAKE the row lock but the trigger still refuses the UPDATE", async () => {
    // Both halves in one test, because either alone is misleading: the privilege
    // without the trigger would be a hole, and the trigger without the privilege
    // would mean the outbox runtime cannot run as the least-privileged role.
    // 041 §9.2 item 1's ranking, made concrete: a trigger does not consult
    // privileges.
    const sessionId = (await createScanSession(ownerPool, shopId, "employee")).id;
    const outboxId = randomUUID();
    await ownerPool.query(
      `INSERT INTO outbox (id, shop_id, scan_session_id, event, ref_table, ref_id, authored_by)
       VALUES ($1,$2,$3,'longbox.commerce.draft_requested','outbox',$1,'human')`,
      [outboxId, shopId, sessionId]
    );
    await expect(
      appPool.query(`SELECT id FROM outbox WHERE id = $1 FOR UPDATE SKIP LOCKED`, [outboxId])
    ).resolves.toBeDefined();
    await expect(appPool.query(`UPDATE outbox SET event = 'x' WHERE id = $1`, [outboxId])).rejects.toThrow(
      /append-only/
    );
  });

  it("every declared-exempt table present in the schema grants full DML", async () => {
    const grants = await privilegesByTable(ownerPool);
    for (const table of LIVE_EXEMPT) {
      expect({ table, privileges: grants.get(table) }).toEqual({
        table,
        privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"],
      });
    }
  });

  it("grants no privilege on any table outside the two granted classes", async () => {
    const declared = new Set<string>([...APPEND_ONLY_TABLE_NAMES, ...LIVE_EXEMPT]);
    const grants = await privilegesByTable(ownerPool);
    const stray = [...grants.keys()].filter((t) => !declared.has(t));
    expect(stray).toEqual([]);
  });

  // ── The no-grant class, both directions ──

  it("holds ZERO privileges on every appGrant:'none' table", async () => {
    const grants = await privilegesByTable(ownerPool);
    for (const table of NO_APP_GRANT_TABLE_NAMES) {
      expect({ table, privileges: grants.get(table) }).toEqual({ table, privileges: undefined });
    }
  });

  it("the no-grant set names only tables that really exist", async () => {
    // The other direction: a no-grant row for a table nobody created would assert
    // nothing at all above, and would go stale without anyone noticing.
    const { rows } = await ownerPool.query(
      `SELECT c.relname AS name FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'`
    );
    const live = new Set((rows as Array<{ name: string }>).map((r) => r.name));
    const missing = NO_APP_GRANT_TABLE_NAMES.filter((t) => !live.has(t));
    expect(missing).toEqual([]);
  });

  it("cannot touch schema_migrations at all — deleting a row there would downgrade triggers to 'O'", async () => {
    await expect(appPool.query(`SELECT * FROM schema_migrations`)).rejects.toThrow(
      "permission denied for table schema_migrations"
    );
    await expect(appPool.query(`DELETE FROM schema_migrations`)).rejects.toThrow(
      "permission denied for table schema_migrations"
    );
  });

  /** Every base-table privilege `longbox_app` holds, table → sorted privilege list. */
  async function privilegesByTable(pool: pg.Pool): Promise<Map<string, string[]>> {
    const { rows } = await pool.query(
      `SELECT g.table_name, g.privilege_type
         FROM information_schema.role_table_grants g
         JOIN pg_class c ON c.relname = g.table_name
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE g.grantee = $1 AND g.table_schema = 'public' AND c.relkind = 'r'`,
      [APP_ROLE]
    );
    const byTable = new Map<string, string[]>();
    for (const row of rows as Array<{ table_name: string; privilege_type: string }>) {
      const list = byTable.get(row.table_name) ?? [];
      list.push(row.privilege_type);
      byTable.set(row.table_name, list);
    }
    for (const [table, list] of byTable) byTable.set(table, [...new Set(list)].sort());
    return byTable;
  }
});

function silentLogger(): { error(msg: string): void; info(msg: string): void } {
  return { error: () => undefined, info: () => undefined };
}
