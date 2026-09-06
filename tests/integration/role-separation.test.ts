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
import { READ_APPEND_TABLE_NAMES } from "../../src/db/appRoleGrants.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  APP_ROLE,
  MIGRATE_ROLE,
  appUrl,
  asShop,
  createFreshDb,
  probeDb,
  runMigrations,
  seedShop,
  superuserUrl,
} from "./helpers.js";
import { APPEND_ONLY_EXEMPTIONS, APPEND_ONLY_TABLE_NAMES } from "../../src/db/appendOnlyTables.js";
import {
  APP_LOCKABLE_TABLE_NAMES,
  INSERT_ONLY_TABLE_NAMES,
  NO_APP_GRANT_TABLE_NAMES,
} from "../../src/db/appRoleGrants.js";
import { createScanSession } from "../../src/services/scanSession.js";
import { checkRoleSeparation, assertRoleSeparationOrThrow } from "../../src/services/roleSeparation.js";

const dbUp = await probeDb();

/**
 * Declared exemptions whose UPDATE is scoped to named columns (E03-D06).
 *
 * Read from the declaration rather than spelled here, so a table that gains or
 * loses the class changes this suite's expectations without anybody editing it.
 */
const COLUMN_SCOPED = APPEND_ONLY_EXEMPTIONS.filter(
  (e) => !e.pending && e.appGrant !== "none" && e.updateColumns !== undefined
).map((e) => ({ table: e.table, columns: e.updateColumns! }));

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
    // THROUGH THE SHOP'S TENANT CONTEXT (E03-B04). `cost_log` carries a `shop_id`
    // and therefore a policy, so an INSERT with no context is refused by the
    // `WITH CHECK` before the GRANT this test is about is ever consulted — and the
    // assertion below would be about the wrong refusal.
    const inserted = await asShop(appPool, shopId).query(
      // `spend_owner` is NOT NULL for every row written after `023` (E03-B05,
      // 050 §6.1) — enforced by a `NOT VALID` CHECK, which still binds every
      // INSERT, so a fixture names an owner like any other writer.
      `INSERT INTO cost_log (shop_id, provider, model, tokens_in, tokens_out, estimated_usd, spend_owner)
       VALUES ($1, 'anthropic', 'claude-sonnet-5', 1, 1, 0, 'longbox') RETURNING id`,
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
    // THROUGH THE SHOP'S CONTEXT (E03-B04): `shop` is policied on its own `id`
    // since the invariant review's WARN 3, so an UPDATE with no context matches no
    // row and SUCCEEDS with zero changes — which would have made this assertion
    // about the privilege pass for the wrong reason (056 §6.2's rule).
    const res = await asShop(appPool, shopId).query(
      `UPDATE shop SET name = $1 WHERE id = $2 RETURNING name`,
      [`renamed-${randomUUID().slice(0, 8)}`, shopId]
    );
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
      if (NO_APP_GRANT_TABLE_NAMES.includes(table)) continue; // and so is this class, below
      if (INSERT_ONLY_TABLE_NAMES.includes(table)) continue; // and so is E03-D17's, below
      expect({ table, privileges: grants.get(table) }).toEqual({
        table,
        privileges: ["INSERT", "SELECT"],
      });
    }
  });

  // ⚠ THE THIRD EXCEPTION, AND IT IS THE MIRROR OF THE SECOND (E03-D17).
  //
  // `app_user_origin` withholds the INSERT because an appended row would change
  // what a control SEES. `identity_access` withholds the SELECT for the
  // symmetric reason: it is the audited accessor's own fact (019 T35(b), 034
  // §3.3), and a process that can read its own access log can shape what an
  // audit sees before the audit runs. Nothing in the running system has a
  // question to ask this table; reading it is `pnpm audit:identity-access`'s
  // job, as the schema owner.
  //
  // Asserted as an EXACT privilege set rather than as an absence, so a future
  // `GRANT SELECT` fails here — and the refusal is proved real, not merely
  // catalogued, because a policy filtering rows would return zero rather than
  // throw.
  it("a DECLARED insert-only append-only table grants the app role INSERT and nothing else", async () => {
    const grants = await privilegesByTable(ownerPool);
    expect(INSERT_ONLY_TABLE_NAMES).toEqual(["identity_access"]);
    for (const table of INSERT_ONLY_TABLE_NAMES) {
      expect({ table, privileges: grants.get(table) }).toEqual({ table, privileges: ["INSERT"] });
    }
    await expect(appPool.query(`SELECT count(*) FROM identity_access`)).rejects.toThrow(/permission denied/);
  });

  // ⚠ THE SECOND EXCEPTION, AND IT NARROWS RATHER THAN WIDENS (E03-D14).
  //
  // `app_user_origin` and its retirement decide WHO 019 T35(c)'s reconciliation
  // watches, so the process being watched holds nothing on them at all
  // (000-docs/058 §3(c)). The control that matters is the refusal of an INSERT:
  // a compromised server appending a RETIREMENT would take a staff account out
  // of the audited population from that moment on, and the append-only trigger
  // — which refuses UPDATE and DELETE and nothing else — could not have stopped
  // it. Asserted as an EMPTY privilege set rather than as an absence from the
  // loop above, so a future `GRANT` on either table fails here.
  it("a DECLARED no-grant append-only table grants the app role NOTHING", async () => {
    const grants = await privilegesByTable(ownerPool);
    for (const table of ["app_user_origin", "app_user_origin_retirement"]) {
      expect(NO_APP_GRANT_TABLE_NAMES, `${table} left the no-grant class`).toContain(table);
      expect({ table, privileges: grants.get(table) }).toEqual({ table, privileges: undefined });
    }
    // And the refusal is real, not merely catalogued.
    await expect(appPool.query(`SELECT count(*) FROM app_user_origin`)).rejects.toThrow(/permission denied/);
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
    const sessionId = (await createScanSession(ownerPool, shopId)).id;
    const outboxId = randomUUID();
    await ownerPool.query(
      `INSERT INTO outbox (id, shop_id, scan_session_id, event, ref_table, ref_id, authored_by)
       VALUES ($1,$2,$3,'longbox.commerce.draft_requested','outbox',$1,'human')`,
      [outboxId, shopId, sessionId]
    );
    // ⚠ BOTH STATEMENTS RUN IN THE SHOP'S CONTEXT, AND THE UPDATE IS WHY.
    // Row-level security filters the rows a statement can SEE, so an UPDATE with
    // no tenant context matches nothing and SUCCEEDS — zero rows changed, no
    // error, no trigger. The trigger's refusal is only reachable by a statement
    // that can see the row, which is exactly what makes this assertion about the
    // trigger rather than about the boundary above it (E03-B04).
    const appAsShop = asShop(appPool, shopId);
    await expect(
      appAsShop.query(`SELECT id FROM outbox WHERE id = $1 FOR UPDATE SKIP LOCKED`, [outboxId])
    ).resolves.toBeDefined();
    await expect(appAsShop.query(`UPDATE outbox SET event = 'x' WHERE id = $1`, [outboxId])).rejects.toThrow(
      /append-only/
    );
  });

  it("every declared-exempt table present in the schema grants full DML", async () => {
    const grants = await privilegesByTable(ownerPool);
    for (const table of LIVE_EXEMPT) {
      // A column-scoped exemption is a NARROWER class and is asserted below; a
      // table that fell out of it would show up here as a full-DML row, which is
      // the drift these two assertions bracket between them.
      if (COLUMN_SCOPED.some((c) => c.table === table)) continue;
      // ⚠ SO IS A READ-APPEND ONE (E03-D21), and the same bracketing applies: a
      // table that fell out of `read-append` would appear here as full DML.
      if (READ_APPEND_TABLE_NAMES.includes(table)) continue;
      expect({ table, privileges: grants.get(table) }).toEqual({
        table,
        privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"],
      });
    }
  });

  it("the READ-APPEND class grants SELECT and INSERT and withholds UPDATE and DELETE", async () => {
    // ⚠ **WHY THIS CLASS EXISTS, AS THE REPRODUCTION IT WAS** (E03-D21, the
    // security lens's F1 on 000-docs/062). `app_user` is exempt from the
    // append-only TRIGGER — a person changes their name — and that exemption was
    // silently also a table-level DML GRANT. Since `migrations/036` the table
    // carries a `tenant_isolation` policy that is `FOR ALL` over rows the shop
    // legitimately sees, so the POLICY cannot refuse an UPDATE of a co-worker's
    // row: one statement rewrote any of them, login identifier included, on a
    // person who may be shared with another shop. The exemption was for the
    // trigger and the grant was for the table — the same shape `updateColumns`
    // was added to close one class over.
    expect(READ_APPEND_TABLE_NAMES).toEqual(["app_user"]);
    const grants = await privilegesByTable(ownerPool);
    for (const table of READ_APPEND_TABLE_NAMES) {
      expect({ table, privileges: grants.get(table) }).toEqual({
        table,
        privileges: ["INSERT", "SELECT"],
      });
    }
  });

  it("REFUSES an UPDATE and a DELETE on a read-append table, as the app role", async () => {
    // The privilege above, as behaviour. There is no trigger on this table — that
    // is what "exempt" means — so the grant is the whole control, which is why
    // the boot assertion checks it too.
    const person = (
      await ownerPool.query(
        `INSERT INTO app_user (email, display_name) VALUES ($1,'Read Append') RETURNING id`,
        [`read-append-${randomUUID()}@example.invalid`]
      )
    ).rows[0] as { id: string };
    for (const statement of [
      `UPDATE app_user SET display_name = 'Renamed' WHERE id = $1`,
      `DELETE FROM app_user WHERE id = $1`,
    ]) {
      await expect(appPool.query(statement, [person.id]), statement).rejects.toThrow(/permission denied/i);
    }
  });

  // ============================================================================
  // THE COLUMN-SCOPED CLASS (E03-D06, from the invariant review of `faf105f`)
  // ============================================================================
  //
  // The finding, stated as the reproduction it was: `user_authenticator` is exempt
  // from the append-only trigger because ONE column has to move — 048 R19's
  // `last_used_step` — and its grant was for the whole table. As the app role, and
  // with every other control in this repository in place, it was possible to
  // rewrite `secret_ciphertext` / `secret_nonce` / `key_version`, to move
  // `last_used_step` BACKWARDS (which defeats the replay guard outright: the write
  // is the check, and a check that can be reset is not one), and to DELETE a live
  // authenticator leaving no `user_authenticator_retirement` fact behind.
  //
  // The privilege was never the guarantee (041 §9.2 item 1 ranks the trigger
  // first, and this table deliberately has none) — which is exactly why the grant
  // has to carry the weight here, and why each of the three is asserted as a
  // REFUSAL rather than as an absence in a plan.

  it("a COLUMN-SCOPED exemption grants SELECT+INSERT and UPDATE on the named columns only", async () => {
    expect(COLUMN_SCOPED.length).toBeGreaterThan(0);
    const grants = await privilegesByTable(ownerPool);
    const columns = await updatableColumns(ownerPool);
    for (const { table, columns: declared } of COLUMN_SCOPED) {
      // **NO table-level UPDATE at all**, which is the assertion that would fail
      // the day somebody "simplifies" this back to `appGrant: "full"` —
      // `role_table_grants` lists table-level privileges only, so a column grant
      // is invisible here and a table grant is not. Verified on postgres:16 while
      // writing this: the first draft expected `UPDATE` in this list and the
      // database disagreed, which is the difference being real rather than assumed.
      expect({ table, privileges: grants.get(table) }).toEqual({
        table,
        privileges: ["INSERT", "SELECT"],
      });
      // …and the UPDATE lives in `role_column_grants`, on exactly the declared
      // columns and no others.
      expect({ table, columns: columns.get(table) }).toEqual({
        table,
        columns: [...declared].sort(),
      });
    }
  });

  it("REFUSES the app role every write on `user_authenticator` except its declared columns", async () => {
    // A row written by the OWNER, so the refusals below are about privilege and
    // not about a row that was never there. The sealed columns hold obviously
    // synthetic bytes: this suite tests grants, not cryptography.
    const person = await ownerPool.query(
      `INSERT INTO app_user (email, display_name) VALUES ($1,'Grant Person') RETURNING id`,
      [`grant-${randomUUID()}@example.invalid`]
    );
    const id = randomUUID();
    await ownerPool.query(
      `INSERT INTO user_authenticator
         (id, app_user_id, kind, secret_ciphertext, secret_nonce, key_version, last_used_step)
       VALUES ($1,$2,'totp','\\x00','\\x00',1,5)`,
      [id, (person.rows[0] as { id: string }).id]
    );

    // 1. THE SECRET, ITS NONCE AND ITS KEY VERSION are written once at enrollment
    //    and never again. Each is refused by name, because a grant that covered
    //    one of the three would pass a test that only tried another.
    for (const column of ["secret_ciphertext", "secret_nonce", "key_version"]) {
      await expect(
        appPool.query(`UPDATE user_authenticator SET ${column} = $2 WHERE id = $1`, [
          id,
          column === "key_version" ? 2 : Buffer.from([0xff]),
        ])
      ).rejects.toThrow(/permission denied/);
    }

    // 2. THE REPLAY GUARD MAY MOVE — that is the whole reason this table is
    //    exempt — and 048 R19's monotonicity is the SERVICE's rule rather than the
    //    grant's, so what the grant has to allow is exactly this statement.
    const moved = await appPool.query(`UPDATE user_authenticator SET last_used_step = 6 WHERE id = $1`, [id]);
    // The affected-row count, not merely "it did not throw": 048 R19 makes that
    // count the authorization, so a statement that touched zero rows would be a
    // permitted UPDATE that changed nothing — which is not what the grant has to
    // allow.
    expect(moved.rowCount).toBe(1);

    // 3. DELETE IS REFUSED. An ending on this table is a
    //    `user_authenticator_retirement` row (048 §8.1's forced re-enrollment
    //    reads it as a predicate); a DELETE would remove the factor AND the fact
    //    that it ever existed, which no append-only sibling permits.
    await expect(appPool.query(`DELETE FROM user_authenticator WHERE id = $1`, [id])).rejects.toThrow(
      /permission denied/
    );

    // …and the row is still exactly what the owner wrote, apart from the one
    // column the class permits.
    const after = await ownerPool.query(
      `SELECT key_version, last_used_step, length(secret_ciphertext) AS len
         FROM user_authenticator WHERE id = $1`,
      [id]
    );
    expect(after.rows[0]).toMatchObject({ key_version: 1, last_used_step: "6", len: 1 });
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
  /**
   * The columns the app role may UPDATE, per table (E03-D06).
   *
   * `role_table_grants` carries TABLE-level privileges only, so a column-scoped
   * UPDATE does not appear there at all — which is what lets the assertion above
   * demand its ABSENCE from the table list, and this one demand its PRESENCE on
   * exactly the declared columns. Two views, two halves, and a widening back to a
   * table-level grant fails both.
   */
  async function updatableColumns(pool: pg.Pool): Promise<Map<string, string[]>> {
    const { rows } = await pool.query(
      `SELECT g.table_name, g.column_name
         FROM information_schema.role_column_grants g
        WHERE g.grantee = $1 AND g.table_schema = 'public' AND g.privilege_type = 'UPDATE'`,
      [APP_ROLE]
    );
    const byTable = new Map<string, string[]>();
    for (const row of rows as Array<{ table_name: string; column_name: string }>) {
      byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), row.column_name]);
    }
    for (const [table, list] of byTable) byTable.set(table, [...new Set(list)].sort());
    return byTable;
  }

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
