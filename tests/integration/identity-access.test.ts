// L4: **019 T35(b), against a real database** — every read that turns a key into
// a person leaves exactly one fact, and nothing can edit, delete or read it back
// from inside the running system (E03-D17).
//
// Bead: longbox-e5b.3.27 (alias E03-D17). Docs: 000-docs/060 in full; 019 T35(b)
// (NON-WAIVABLE); 034 §3.3; 048 §3.5, §7.1, §12.4 row 6; 054 §8; 022 P3;
// 041 §9.2; 056 §7.
//
// Seven properties only a running database can show:
//
//   (a) each migrated caller writes exactly ONE fact, with the right purpose,
//       the right key KIND and the right count;
//   (b) the roster's fact is ONE row for N people, not N rows;
//   (c) the fact table refuses UPDATE and DELETE — as the SCHEMA OWNER, which
//       is the only role that could have done it (the trigger is ENABLE ALWAYS);
//   (d) the application role cannot SELECT it at all (`appGrant: "insert-only"`),
//       and CAN insert;
//   (e) the application role cannot write an UNSCOPED fact: the tenant policy's
//       WITH CHECK refuses a NULL `shop_id`, which is what makes every fact the
//       server writes name the tenant it happened in;
//   (f) no row anywhere in the table holds a subject — the columns do not exist;
//   (g) `pnpm audit:identity-access` reconciles what is there against the
//       declared inventory, and FINDS an undeclared accessor.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  resolvePersonByKey,
  resolvePersonForAuthenticatorEnrollment,
  resolveShopRoster,
} from "../../src/identity/index.js";
import { runIdentityAccessAudit, livePurposes } from "../../scripts/identityAccessAudit.js";
import { tenantDb } from "../../src/db.js";
import { APP_ROLE, appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { insertUser, seedIdentity, type SeededIdentity } from "./authHelpers.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("the identity accessor's fact (019 T35(b), 000-docs/060)", () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;
  let shopId: string;
  let identity: SeededIdentity;

  beforeAll(async () => {
    const url = await createFreshDb("identity_access");
    await runMigrations(url);
    ownerPool = new pg.Pool({ connectionString: url });
    appPool = new pg.Pool({ connectionString: appUrl(url) });
    shopId = await seedShop(ownerPool, { slug: `identity-access-${Date.now()}` });
    identity = await seedIdentity(ownerPool, shopId);
  }, 120_000);

  afterAll(async () => {
    await ownerPool?.end();
    await appPool?.end();
  });

  async function facts(): Promise<
    Array<{
      shop_id: string | null;
      purpose: string;
      accessor_method: string;
      accessor_path: string;
      key_kind: string;
      resolved_count: number;
    }>
  > {
    // ⚠ NO ORDER BY `created_at`, AND THAT IS A PROPERTY RATHER THAN AN
    // OVERSIGHT. Since the security lens's F5 the column defaults to
    // `date_trunc('hour', now())`, so rows written in the same hour are
    // UNORDERED — which is most of what makes a per-day first-sign-in series
    // stop being a shift record. A suite that read the newest row by position
    // would be asserting an ordering the schema deliberately does not provide,
    // so every case below matches on the row's own values instead.
    const res = await ownerPool.query(
      `SELECT shop_id, purpose, accessor_method, accessor_path, key_kind, resolved_count
         FROM identity_access`
    );
    return res.rows as Array<{
      shop_id: string | null;
      purpose: string;
      accessor_method: string;
      accessor_path: string;
      key_kind: string;
      resolved_count: number;
    }>;
  }

  it("(a) a session display-name resolution leaves exactly one scoped fact", async () => {
    const before = (await facts()).length;
    const person = await resolvePersonByKey(
      tenantDb(appPool, shopId),
      {
        method: "POST",
        path: "/api/v1/operator-sessions",
        purpose: "session_display_name",
        shopId,
      },
      identity.operatorId
    );
    expect(person?.display_name).toBe("Operator Two");
    const rows = await facts();
    expect(rows).toHaveLength(before + 1);
    expect(rows).toContainEqual({
      shop_id: shopId,
      purpose: "session_display_name",
      accessor_method: "POST",
      accessor_path: "/api/v1/operator-sessions",
      key_kind: "app_user_id",
      resolved_count: 1,
    });
  });

  it("(a) an unresolved key still leaves a fact, with a count of zero", async () => {
    // A rule that only recorded successes would leave a PROBING accessor
    // invisible — which is the access an audit most wants to see.
    const before = (await facts()).length;
    const missing = await resolvePersonByKey(
      tenantDb(appPool, shopId),
      {
        method: "POST",
        path: "/api/v1/invitations/redemptions",
        purpose: "invitation_addressee",
        shopId,
      },
      randomUUID()
    );
    expect(missing).toBeUndefined();
    const rows = await facts();
    expect(rows).toHaveLength(before + 1);
    expect(rows.filter((r) => r.purpose === "invitation_addressee")).toContainEqual(
      expect.objectContaining({ resolved_count: 0, key_kind: "app_user_id" })
    );
  });

  it("(b) the roster leaves ONE fact for N people, keyed shop_roster", async () => {
    const before = (await facts()).length;
    const roster = await resolveShopRoster(
      tenantDb(appPool, shopId),
      { method: "GET", path: "/api/v1/operators", purpose: "operator_picker_roster", shopId },
      shopId
    );
    // The seed grants an owner and an operator; break-glass is excluded by the
    // query and there is none here anyway.
    expect(roster.length).toBe(2);
    const rows = await facts();
    expect(rows).toHaveLength(before + 1);
    expect(rows.filter((r) => r.key_kind === "shop_roster")).toContainEqual(
      expect.objectContaining({ resolved_count: 2, purpose: "operator_picker_roster" })
    );
  });

  it("(c) the fact table refuses UPDATE and DELETE, as the SCHEMA OWNER", async () => {
    // The role that OWNS the table and bypasses every policy. `ENABLE ALWAYS`
    // means the trigger does not consult privileges, so this is the strongest
    // form of the assertion available: the one principal that could edit it
    // cannot (041 §9.2 item 1).
    const id = (await ownerPool.query(`SELECT id FROM identity_access LIMIT 1`)).rows[0] as { id: string };
    await expect(
      ownerPool.query(`UPDATE identity_access SET resolved_count = 99 WHERE id = $1`, [id.id])
    ).rejects.toThrow(/append-only|immutable|forbid/i);
    await expect(ownerPool.query(`DELETE FROM identity_access WHERE id = $1`, [id.id])).rejects.toThrow(
      /append-only|immutable|forbid/i
    );
  });

  it("(d) the application role may INSERT and may NOT SELECT", async () => {
    // `appGrant: "insert-only"` — the mirror of `appGrant: "none"`. A process
    // that could read its own access log could shape what an audit sees before
    // the audit runs.
    await expect(asShop(appPool, shopId).query(`SELECT id FROM identity_access`)).rejects.toThrow(
      /permission denied/i
    );
    // …and the privilege is asserted directly too, so the failure above cannot
    // pass for the wrong reason (a policy filtering rows would return zero, not
    // throw).
    const privs = await ownerPool.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'identity_access' AND grantee = $1 ORDER BY privilege_type`,
      [APP_ROLE]
    );
    expect((privs.rows as Array<{ privilege_type: string }>).map((r) => r.privilege_type)).toEqual([
      "INSERT",
    ]);
  });

  it("(e) the application role cannot write an UNSCOPED fact", async () => {
    // The tenant policy's WITH CHECK is `shop_id = current_shop_id()`, which a
    // NULL can never satisfy. So every fact the running server writes names the
    // tenant it happened in, and the unscoped rows are the schema-owner CLI's —
    // by construction rather than by convention.
    await expect(
      asShop(appPool, shopId).query(
        `INSERT INTO identity_access
           (shop_id, purpose, accessor_method, accessor_path, key_kind, resolved_count)
         VALUES (NULL,'session_display_name','CLI','scripts/x.ts','app_user_id',1)`
      )
    ).rejects.toThrow(/permission denied|row-level security|violates/i);
  });

  it("(e) the schema owner CAN write one, and the CHECK ties the null to a CLI", async () => {
    const person = await insertUser(ownerPool, `mfa-${Date.now()}@example.invalid`, "MFA Person");
    const row = await resolvePersonForAuthenticatorEnrollment(
      ownerPool,
      {
        method: "CLI",
        path: "scripts/enroll-authenticator.ts",
        purpose: "authenticator_enrollment",
        shopId: null,
      },
      person
    );
    expect(row?.email).toContain("@example.invalid");
    const rows = await facts();
    expect(rows.filter((r) => r.accessor_method === "CLI")).toContainEqual(
      expect.objectContaining({
        shop_id: null,
        purpose: "authenticator_enrollment",
        resolved_count: 1,
      })
    );

    // …and an unscoped row that does NOT claim to be a CLI is refused by the
    // CHECK, so the null has exactly one meaning.
    await expect(
      ownerPool.query(
        `INSERT INTO identity_access
           (shop_id, purpose, accessor_method, accessor_path, key_kind, resolved_count)
         VALUES (NULL,'session_display_name','POST','/api/v1/operator-sessions','app_user_id',1)`
      )
    ).rejects.toThrow(/identity_access_unscoped_is_a_cli/);
  });

  it("(f) created_at is truncated to the HOUR, so a within-hour ordering does not exist", async () => {
    // The security lens's F5, as a schema property rather than a promise. §5.2
    // already said "no subject is stored" is a claim about the SCHEMA and never
    // "nobody can be identified"; the lens applied that caveat where it bites — a
    // per-day FIRST-SIGN-IN series over (shop_id, purpose, created_at) is a shift
    // record at a three-person shop and a timeclock at a one-owner shop.
    //
    // ⚠ It NARROWS the class and does not remove it, and no artifact may say
    // otherwise: an hourly series at a one-owner shop still says which hours that
    // owner worked. The expensive halves are retention (E03-B09) and the 022 P3
    // notice describing THIS table (E01-B06).
    const rows = await ownerPool.query(
      `SELECT count(*)::int AS n FROM identity_access WHERE created_at <> date_trunc('hour', created_at)`
    );
    expect((rows.rows[0] as { n: number }).n).toBe(0);
    // …and the audit still works over it: its window start is truncated too, so
    // the window is strictly WIDER than a wall-clock instant and never narrower.
    const windowed = await runIdentityAccessAudit(ownerPool, { windowHours: 24 });
    expect(windowed.buckets.length).toBeGreaterThan(0);
  });

  it("(f) the table holds NO subject — the columns do not exist (022 P3)", async () => {
    const cols = await ownerPool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'identity_access' ORDER BY column_name`
    );
    const names = (cols.rows as Array<{ column_name: string }>).map((r) => r.column_name);
    // This is the whole design in one assertion. A table keyed on the person
    // looked up would be a per-person timeline built by the control that exists
    // to prevent per-person timelines — and it would grow on the hot path.
    for (const forbidden of ["app_user_id", "operator_id", "email", "display_name", "subject_id"]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
    expect(names).toContain("key_kind");
    expect(names).toContain("purpose");
  });

  it("(g) the audit reconciles the live rows against the declared inventory", async () => {
    const result = await runIdentityAccessAudit(ownerPool, { windowHours: null });
    expect(result.clean).toBe(true);
    expect(result.undeclared).toEqual([]);
    expect(result.purposeDrift).toEqual([]);
    expect(result.buckets.length).toBeGreaterThan(0);
    // Every bucket is declared, and the counts are accesses rather than acts.
    for (const bucket of result.buckets) expect(bucket.declared, bucket.path).toBe(true);
  });

  it("(g) an UNDECLARED accessor is a finding — the T35(b) gate failure", async () => {
    // The schema owner can write a row citing a surface nobody declared; the
    // `purpose` CHECK cannot catch it, because an accessor list grows every time
    // somebody adds a screen and therefore cannot be a constraint. This is what
    // the audit is FOR.
    await ownerPool.query(
      `INSERT INTO identity_access
         (shop_id, purpose, accessor_method, accessor_path, key_kind, resolved_count)
       VALUES ($1,'session_display_name','GET','/api/v1/leaderboard','operator_id',7)`,
      [shopId]
    );
    const result = await runIdentityAccessAudit(ownerPool, { windowHours: null });
    expect(result.clean).toBe(false);
    expect(result.undeclared).toHaveLength(1);
    expect(result.undeclared[0]).toMatchObject({ path: "/api/v1/leaderboard", accesses: 1, resolved: 7 });
  });

  it("(g) the database's purpose CHECK and the code's closed union agree", async () => {
    // A migration that widened the CHECK without widening the code — or the
    // reverse — means the closed vocabulary has two definitions, and 019 T35(b)
    // would then be enforced by whichever one the reader happened to read.
    expect(await livePurposes(ownerPool)).toEqual([
      "authenticator_enrollment",
      "invitation_addressee",
      "operator_picker_roster",
      "session_display_name",
    ]);
  });

  it("refuses a purpose the CHECK does not know, even from the schema owner", async () => {
    await expect(
      ownerPool.query(
        `INSERT INTO identity_access
           (shop_id, purpose, accessor_method, accessor_path, key_kind, resolved_count)
         VALUES ($1,'performance_review','GET','/api/v1/operators','app_user_id',1)`,
        [shopId]
      )
    ).rejects.toThrow(/purpose/);
  });
});
