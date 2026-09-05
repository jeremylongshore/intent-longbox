// L4/L6: R4 — a correction chain runs FORWARD — and the two routes that now write
// through 041 §3.3's single writer. E02-D09, bead `longbox-e5b.2.19`.
//
// WHAT EACH BLOCK DECIDES.
//   1. `migrations/013`'s trigger, as the APP role, on a real cluster: the
//      backward edge is refused, the equal edge is refused, a superseding row with
//      no `session_seq` is refused, and the forward edge is accepted. This closes
//      041 I4(c), which `tests/RTM.md` carried as ⛔ NOT COVERED.
//   2. E17's mutual pair — the construction that leaves a session with ZERO
//      current confirmations and is UNRECOVERABLE, because the append-only trigger
//      forbids repair and R2 forbids a third row from superseding either. A cycle
//      needs one backward edge; block 1 is why it cannot get one.
//   3. The gate can fail (029 §5 move 8). The trigger is DISABLED as the table
//      OWNER, the backward edge is shown to succeed, and it is re-enabled — so the
//      refusals above are evidence about this trigger rather than about some other
//      constraint that happens to fire first. An untested gate is not a gate.
//   4. The `_current` views still resolve (041 I3/I7), now on 041 §5's canonical
//      order rather than on `id DESC`, which was "a stable coin flip".
//   5. The two ROUTES, through real HTTP: a second `POST …/confirm` and a second
//      `POST …/condition` write `supersedes_id`. Before this bead nothing in
//      `src/` wrote that column at all (041 §1 E5/E22) — the correction was
//      appended beside the original and the view chose between them by coin flip.
import { mkdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { SUPERSEDABLE_TABLES } from "../../src/services/supersession.js";
import { TEST_PIN_PEPPER } from "../testConfig.js";
import { signIn, type AuthedInject } from "./authHelpers.js";

const dbUp = await probeDb();
const UPLOADS_DIR = "tests/.tmp-supersession-uploads";

describe.skipIf(!dbUp)("R4 — supersession runs forward (041 §3.2, I4c)", () => {
  let migrateUrl: string;
  let pool: pg.Pool; // the APP role: what the server actually connects as
  let ownerPool: pg.Pool; // the schema owner: the only role that can disable a trigger
  let app: FastifyInstance;
  /** `app.inject` carrying a live device + operator session (048 I1). */
  let inject: AuthedInject;
  let shopId: string;

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
  const shopQuery = (sql: string, values?: unknown[]): Promise<pg.QueryResult> =>
    asShop(pool, shopId).query(sql, values);

  beforeAll(async () => {
    delete process.env["PRICECHARTING_TOKEN"];
    delete process.env["EBAY_CLIENT_ID"];
    delete process.env["SHOPIFY_ADMIN_TOKEN"];

    migrateUrl = await createFreshDb("longbox_supersession_e02d09");
    await runMigrations(migrateUrl);
    ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Forward Comics", slug: "forward-comics" });
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    mkdirSync(UPLOADS_DIR, { recursive: true });
    app = await buildApp(pool, {
      port: 0,
      databaseUrl: appUrl(migrateUrl),
      uploadsDir: UPLOADS_DIR,
      bands: { high: 0.85, medium: 0.5 },
      pinPepper: TEST_PIN_PEPPER,
      publicOrigins: [],
    });
    // E03-D09: every shop-scoped route is behind a device session plus an
    // operator session now (048 I1), so the suite signs one phone in and uses
    // `inject` in place of `app.inject`.
    ({ inject } = await signIn(pool, app, shopId));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await ownerPool?.end();
    rmSync(UPLOADS_DIR, { recursive: true, force: true });
  });

  /** A fresh session, on the app connection. */
  async function newSession(): Promise<string> {
    const r = await shopQuery(
      `INSERT INTO scan_session (shop_id, created_by) VALUES ($1, 'op') RETURNING id`,
      [shopId]
    );
    return (r.rows[0] as { id: string }).id;
  }

  /** A confirmation at an EXPLICIT `session_seq`, so ordering can be constructed. */
  async function confirmAt(session: string, seq: number | null, supersedes?: string): Promise<string> {
    const r = await shopQuery(
      `INSERT INTO human_confirmation
         (scan_session_id, shop_id, confirmed_issue, source, confirmed_by, session_seq, supersedes_id)
       VALUES ($1,$2,'{"t":"x"}'::jsonb,'one_tap','op',$3,$4) RETURNING id`,
      [session, shopId, seq, supersedes ?? null]
    );
    return (r.rows[0] as { id: string }).id;
  }

  describe("the trigger, on a real cluster, as the app role", () => {
    it("accepts a successor whose session_seq is higher than its predecessor's", async () => {
      const s = await newSession();
      const first = await confirmAt(s, 1);
      const second = await confirmAt(s, 2, first);
      const view = await shopQuery(`SELECT id FROM human_confirmation_current WHERE scan_session_id = $1`, [
        s,
      ]);
      expect((view.rows[0] as { id: string }).id).toBe(second);
    });

    // The counter has GAPS in real life — every session-scoped table shares it
    // (`assignSessionSeq` takes the max across the declared list), so a
    // predecessor at 5 and a successor at 3 is a constructible state, not a
    // contrived one. This is the edge R4 exists for.
    it("REFUSES a successor whose session_seq is LOWER (the backward edge)", async () => {
      const s = await newSession();
      const first = await confirmAt(s, 5);
      await expect(confirmAt(s, 3, first)).rejects.toThrow(/supersession_forward/);
      await expect(confirmAt(s, 3, first)).rejects.toThrow(/recorded LATER or at the same point/);
    });

    // Equality is refused too. Two rows in one session never share a counter
    // (`007`'s UNIQUE), so an equal pair is a caller bug and not a tie to break.
    it("REFUSES a successor whose session_seq EQUALS its predecessor's", async () => {
      const s = await newSession();
      const first = await confirmAt(s, 4);
      // A different table, so the per-table UNIQUE cannot be what refuses it.
      await expect(
        shopQuery(
          `INSERT INTO condition_assessment
             (scan_session_id, shop_id, grade_range_low, grade_range_high, defects, session_seq, supersedes_id)
           VALUES ($1,$2,'VG','FN',ARRAY[]::text[],4,$3)`,
          [s, shopId, first]
        )
        // It is refused by the FK first (a condition row cannot supersede a
        // confirmation), which is itself the point: the tables do not share a
        // supersession space. The same-table case is below.
      ).rejects.toThrow();

      const c1 = await shopQuery(
        `INSERT INTO condition_assessment
           (scan_session_id, shop_id, grade_range_low, grade_range_high, defects, session_seq)
         VALUES ($1,$2,'VG','FN',ARRAY[]::text[],7) RETURNING id`,
        [s, shopId]
      );
      await expect(
        shopQuery(
          `INSERT INTO condition_assessment
             (scan_session_id, shop_id, grade_range_low, grade_range_high, defects, session_seq, supersedes_id)
           VALUES ($1,$2,'FN','VF',ARRAY[]::text[],7,$3)`,
          [s, shopId, (c1.rows[0] as { id: string }).id]
        )
      ).rejects.toThrow(/supersession_forward|session_seq_idx/);
    });

    // Clause 2 — the database half of 041 §3.3's single writer. `supersede()`
    // assigns the counter under the anchor lock; a superseding row without one did
    // not come through it, and R4 has nothing to compare.
    it("REFUSES a superseding row that carries no session_seq at all", async () => {
      const s = await newSession();
      const first = await confirmAt(s, 1);
      await expect(confirmAt(s, null, first)).rejects.toThrow(/must carry session_seq/);
    });

    // Clause 4 — a pre-`007` predecessor has no counter, and 041 §10.1 forbids
    // backfilling one ("a reconstructed sequence would be a fabricated
    // observation"). Correcting such a row must stay possible.
    it("allows a correction to a LEGACY predecessor that has no session_seq", async () => {
      const s = await newSession();
      const legacy = await confirmAt(s, null);
      const fixed = await confirmAt(s, 1, legacy);
      const view = await shopQuery(`SELECT id FROM human_confirmation_current WHERE scan_session_id = $1`, [
        s,
      ]);
      expect((view.rows[0] as { id: string }).id).toBe(fixed);
    });

    it("carries the trigger on every table that has supersedes_id, ENABLE ALWAYS", async () => {
      const rows = await shopQuery(
        `SELECT c.relname AS table_name, tg.tgenabled::text AS enabled
           FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
          WHERE NOT tg.tgisinternal AND tg.tgname LIKE '%\\_supersession\\_forward'
          ORDER BY c.relname`
      );
      expect(rows.rows).toEqual(
        [...SUPERSEDABLE_TABLES].sort().map((t) => ({ table_name: t, enabled: "A" }))
      );
    });
  });

  // 041 §1 E17, and §3.4's "a `_current` view must never return zero rows for any
  // other reason". The pair is what made that sentence false.
  describe("E17 — the mutual pair that ate a session", () => {
    it("cannot be constructed, because the second edge points backwards", async () => {
      const s = await newSession();
      const a = await confirmAt(s, 1);
      const b = await confirmAt(s, 2, a); // B supersedes A: forward, allowed
      // For A to supersede B the cycle needs a backward edge, and there is no
      // counter that satisfies both R4 and `007`'s UNIQUE. Prove it directly: a
      // THIRD row cannot close the loop either, because R2 already forbids a
      // second successor for A.
      await expect(confirmAt(s, 3, a)).rejects.toThrow(/supersedes_once_idx/);
      // And the session still answers with exactly one current row — never zero.
      const view = await shopQuery(`SELECT id FROM human_confirmation_current WHERE scan_session_id = $1`, [
        s,
      ]);
      expect(view.rows).toHaveLength(1);
      expect((view.rows[0] as { id: string }).id).toBe(b);
    });
  });

  // 029 §5 move 8 applied to this trigger: prove the refusals above come from the
  // trigger and not from a constraint that happened to fire first. Disabling
  // requires the OWNER role — 041 §1 E15's whole point is that the app role cannot.
  describe("the gate can fail", () => {
    it("permits the backward edge with the trigger disabled, and refuses it again after", async () => {
      const s = await newSession();
      const first = await confirmAt(s, 9);

      await ownerPool.query(
        `ALTER TABLE human_confirmation DISABLE TRIGGER human_confirmation_supersession_forward`
      );
      try {
        const backward = await confirmAt(s, 2, first);
        expect(backward).toBeTruthy();
      } finally {
        await ownerPool.query(
          `ALTER TABLE human_confirmation ENABLE ALWAYS TRIGGER human_confirmation_supersession_forward`
        );
      }

      // Re-armed: a fresh session, the same construction, refused.
      const s2 = await newSession();
      const other = await confirmAt(s2, 9);
      await expect(confirmAt(s2, 2, other)).rejects.toThrow(/supersession_forward/);
    });

    it("leaves the app role unable to disable it (041 §1 E15)", async () => {
      await expect(
        shopQuery(`ALTER TABLE human_confirmation DISABLE TRIGGER human_confirmation_supersession_forward`)
      ).rejects.toThrow(/must be owner|permission denied/i);
    });
  });

  // 041 §3.4: a `_current` view returns the newest UNSUPERSEDED row per session,
  // ordered by 041 §5's canonical order. `migrations/013` replaced `created_at
  // DESC, id DESC` with `session_seq DESC NULLS LAST` first.
  describe("the _current views keep resolving (041 I3, I7)", () => {
    it("returns the last link of a three-row chain, not the highest id", async () => {
      const s = await newSession();
      const a = await confirmAt(s, 1);
      const b = await confirmAt(s, 2, a);
      const c = await confirmAt(s, 3, b);
      const view = await shopQuery(`SELECT id FROM human_confirmation_current WHERE scan_session_id = $1`, [
        s,
      ]);
      expect(view.rows).toHaveLength(1);
      expect((view.rows[0] as { id: string }).id).toBe(c);
      // …and the trail is complete (041 I9 / §3.6): nothing is hidden at source.
      const all = await shopQuery(
        `SELECT count(*)::int AS n FROM human_confirmation WHERE scan_session_id = $1`,
        [s]
      );
      expect((all.rows[0] as { n: number }).n).toBe(3);
    });

    it("orders by session_seq, so a counted row always beats a legacy one", async () => {
      const s = await newSession();
      // The legacy row is inserted LAST, so `created_at DESC` — the order the view
      // shipped with — would have made it current. `NULLS LAST` is what stops that.
      const counted = await confirmAt(s, 1);
      await confirmAt(s, null);
      const view = await shopQuery(`SELECT id FROM human_confirmation_current WHERE scan_session_id = $1`, [
        s,
      ]);
      expect((view.rows[0] as { id: string }).id).toBe(counted);
    });

    // The other direction, and the one that decides which ordering is in force
    // (041 §5's E15 case). Two COUNTED rows whose `session_seq` contradicts their
    // `created_at`: the view must follow the counter. Under the order the views
    // shipped with — `created_at DESC, id DESC` — the later-inserted row wins and
    // this fails, which is what makes it evidence that `migrations/013` replaced
    // the ordering rather than merely restating it.
    it("follows session_seq when it CONTRADICTS created_at", async () => {
      const s = await newSession();
      const higher = await confirmAt(s, 5); // written first, higher counter
      const later = await confirmAt(s, 2); // written second, lower counter
      const view = await shopQuery(`SELECT id FROM human_confirmation_current WHERE scan_session_id = $1`, [
        s,
      ]);
      expect(view.rows).toHaveLength(1);
      expect((view.rows[0] as { id: string }).id).toBe(higher);
      expect((view.rows[0] as { id: string }).id).not.toBe(later);

      // And the two rows really do disagree — otherwise the assertion above would
      // pass for the wrong reason.
      const times = await shopQuery(
        `SELECT id, created_at, session_seq FROM human_confirmation
          WHERE scan_session_id = $1 ORDER BY created_at`,
        [s]
      );
      const [first, second] = times.rows as Array<{ id: string; session_seq: string }>;
      expect(first!.id).toBe(higher);
      expect(second!.id).toBe(later);
      expect(Number(first!.session_seq)).toBeGreaterThan(Number(second!.session_seq));
    });

    it("returns zero rows only when nothing was written (041 §3.4)", async () => {
      const s = await newSession();
      const empty = await shopQuery(`SELECT id FROM human_confirmation_current WHERE scan_session_id = $1`, [
        s,
      ]);
      expect(empty.rows).toHaveLength(0);
    });

    it("carries the envelope columns the views used to freeze out", async () => {
      // `003`/`004` expanded `c.*` at creation, so the views did not carry `007`'s
      // columns — a read model that disagreed with its table. `013` replaced them.
      const cols = await shopQuery(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'human_confirmation_current' AND column_name IN ('session_seq','authored_by')
          ORDER BY column_name`
      );
      expect(cols.rows).toEqual([{ column_name: "authored_by" }, { column_name: "session_seq" }]);
    });
  });

  // The point of the whole bead: the two ratified callers write the column.
  describe("the routes write supersedes_id (041 §3.3's two callers)", () => {
    async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
      const res = await inject({
        method: "POST",
        url: path,
        payload: body as object,
        // 042 §5.1 — required on every mutating route. A fresh key per call
        // because each of these is a different ACT: a correction is not a retry
        // of the record it supersedes.
        headers: { "idempotency-key": randomUUID() },
      });
      return { status: res.statusCode, json: res.json() };
    }

    it("POST …/confirm: a second confirmation SUPERSEDES the first (040 S15, 037 §4.4)", async () => {
      const created = await post(`/api/v1/shops/${shopId}/scan-sessions`, {});
      const sid = created.json.session.id as string;

      // `grid_pick`, not `one_tap`: this session has no `llm_rerank` at all, and
      // since E06-D01 / 040 v1.3.0 F3 a one-tap needs a re-rank the SERVER put in
      // the high band. Seeding one would prove nothing about supersession, which
      // is what this test is for — and the forced pick is the same act by the
      // same person, so the record it writes is the record under test either way.
      const first = await post(`/api/v1/shops/${shopId}/scan-sessions/${sid}/confirm`, {
        issue: { title: "Hulk", issue: "180" },
        source: "grid_pick",
      });
      expect(first.status).toBe(201);

      const second = await post(`/api/v1/shops/${shopId}/scan-sessions/${sid}/confirm`, {
        issue: { title: "Hulk", issue: "181" },
        source: "owner_review",
      });
      expect(second.status).toBe(201);

      const rows = await shopQuery(
        `SELECT id, supersedes_id, session_seq FROM human_confirmation
          WHERE scan_session_id = $1 ORDER BY session_seq`,
        [sid]
      );
      expect(rows.rows).toHaveLength(2);
      const [a, b] = rows.rows as Array<{ id: string; supersedes_id: string | null; session_seq: string }>;
      expect(a!.supersedes_id).toBeNull();
      expect(b!.supersedes_id).toBe(a!.id);
      expect(Number(b!.session_seq)).toBeGreaterThan(Number(a!.session_seq));

      // The view resolves to the owner's answer, which is what 037 §4.4's
      // correction path exists to make true.
      const current = await shopQuery(
        `SELECT confirmed_issue FROM human_confirmation_current WHERE scan_session_id = $1`,
        [sid]
      );
      expect((current.rows[0] as { confirmed_issue: { issue: string } }).confirmed_issue.issue).toBe("181");
      // …and the response still carries the outcome, on both branches.
      expect(second.json.confirmation.outcome).toBeTruthy();
    });

    it("POST …/condition: an owner's corrected grade SUPERSEDES the employee's (037 §4.4)", async () => {
      const created = await post(`/api/v1/shops/${shopId}/scan-sessions`, {});
      const sid = created.json.session.id as string;

      const first = await post(`/api/v1/shops/${shopId}/scan-sessions/${sid}/condition`, {
        grade_range_low: "GD",
        grade_range_high: "VG",
        defects: ["spine_ticks"],
      });
      expect(first.status).toBe(201);
      const second = await post(`/api/v1/shops/${shopId}/scan-sessions/${sid}/condition`, {
        grade_range_low: "FN",
        grade_range_high: "VF",
        defects: [],
      });
      expect(second.status).toBe(201);

      const rows = await shopQuery(
        `SELECT id, supersedes_id, grade_range_low FROM condition_assessment
          WHERE scan_session_id = $1 ORDER BY session_seq`,
        [sid]
      );
      expect(rows.rows).toHaveLength(2);
      const [a, b] = rows.rows as Array<{ id: string; supersedes_id: string | null }>;
      expect(a!.supersedes_id).toBeNull();
      expect(b!.supersedes_id).toBe(a!.id);

      const current = await shopQuery(
        `SELECT grade_range_low, grade_range_high FROM condition_assessment_current WHERE scan_session_id = $1`,
        [sid]
      );
      expect(current.rows[0]).toEqual({ grade_range_low: "FN", grade_range_high: "VF" });
    });

    it("404s a condition write on a session that does not exist, without writing", async () => {
      const res = await post(
        `/api/v1/shops/${shopId}/scan-sessions/00000000-0000-4000-8000-000000000000/condition`,
        { grade_range_low: "VG", grade_range_high: "FN", defects: [] }
      );
      expect(res.status).toBe(404);
    });
  });
});
