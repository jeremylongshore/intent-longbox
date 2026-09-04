// L4: the schema items E02-B10 lands, asserted against a real database.
//
// 041 §2.3 (`authored_by` and the human-act CHECK, invariant I2), 041 §3.2 (R1's
// composite FK and R3's self-CHECK, invariants I3 and I4), 041 §5.3 (`session_seq`
// assigned under the anchor lock, invariant I6 a/b), 042 §5.2 (the idempotency
// table's shape and its DECLARED exemption) and 040 §3.3 (the transition table's
// four CHECKs).
//
// Three of these are written to reproduce a defect that EXISTS on the tree before
// this bead — 041 §1 E16 (self-supersession), E17 (a mutual pair that leaves the
// session with zero current rows and is unrecoverable) and E18 (a reproducible
// CROSS-TENANT write, which 019 T24 signs at 0, non-waivable, `any → K1`). Each is
// asserted as a REFUSAL, so the test is the evidence that the migration closed it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { assignSessionSeq } from "../../src/services/scanSession.js";
import { withTransaction } from "../../src/db.js";
import { APPEND_ONLY_EXEMPTIONS } from "../../src/db/appendOnlyTables.js";

const dbUp = await probeDb();

describe.skipIf(!dbUp)("the observation envelope and supersession integrity", () => {
  let pool: pg.Pool;
  let shopA: string;
  let shopB: string;
  let sessionA: string;
  let sessionA2: string;
  let sessionB: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_envelope_e02b10");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    shopA = await seedShop(pool, { name: "Shop A", slug: "shop-a" });
    shopB = await seedShop(pool, { name: "Shop B", slug: "shop-b" });
    const mk = async (shop: string): Promise<string> =>
      (
        (
          await pool.query(`INSERT INTO scan_session (shop_id, created_by) VALUES ($1, 'op') RETURNING id`, [
            shop,
          ])
        ).rows[0] as { id: string }
      ).id;
    sessionA = await mk(shopA);
    sessionA2 = await mk(shopA);
    sessionB = await mk(shopB);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  /** Insert a confirmation, optionally superseding another. Returns its id. */
  async function confirm(shop: string, session: string, supersedes?: string, id?: string): Promise<string> {
    const res = await pool.query(
      `INSERT INTO human_confirmation (id, scan_session_id, shop_id, confirmed_issue, source, confirmed_by, supersedes_id)
       VALUES (coalesce($1, gen_random_uuid()), $2, $3, '{"t":"x"}'::jsonb, 'one_tap', 'op', $4)
       RETURNING id`,
      [id ?? null, session, shop, supersedes ?? null]
    );
    return (res.rows[0] as { id: string }).id;
  }

  describe("041 §2.3 — authored_by", () => {
    it("defaults per table to 041 §10.1's derivation", async () => {
      const id = await confirm(shopA, sessionA);
      const row = await pool.query(`SELECT authored_by FROM human_confirmation WHERE id = $1`, [id]);
      expect(row.rows[0]).toEqual({ authored_by: "human" });
    });

    it("derives candidate_set's from `method`, and the column cannot be written directly", async () => {
      await pool.query(
        `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates)
         VALUES ($1,$2,'barcode','[]'::jsonb), ($1,$2,'llm_vision','[]'::jsonb)`,
        [sessionA, shopA]
      );
      const rows = await pool.query(
        `SELECT method, authored_by FROM candidate_set WHERE scan_session_id = $1 ORDER BY method`,
        [sessionA]
      );
      expect(rows.rows).toEqual([
        { method: "barcode", authored_by: "system" },
        { method: "llm_vision", authored_by: "provider" },
      ]);
      // GENERATED ALWAYS: the derivation cannot be contradicted by a writer, which
      // is the difference between a derivation and a copy of one.
      await expect(
        pool.query(
          `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates, authored_by)
           VALUES ($1,$2,'barcode','[]'::jsonb,'human')`,
          [sessionA, shopA]
        )
      ).rejects.toThrow(/cannot insert a non-DEFAULT value into column "authored_by"/);
    });

    // Invariant I2 (T7 non-waivable, locked decision 5, 037 §1.1, 022 P1). Before
    // this constraint the rule was enforced by the ABSENCE of a code path.
    it("makes a machine-authored condition or confirmation UNREPRESENTABLE (I2)", async () => {
      await expect(
        pool.query(
          `INSERT INTO condition_assessment (scan_session_id, shop_id, grade_range_low, grade_range_high, defects, authored_by)
           VALUES ($1,$2,'VG','FN',ARRAY[]::text[],'system')`,
          [sessionA, shopA]
        )
      ).rejects.toThrow(/condition_assessment_is_a_human_act/);
      await expect(
        pool.query(
          `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source, confirmed_by, authored_by)
           VALUES ($1,$2,'{}'::jsonb,'one_tap','op','provider')`,
          [sessionA, shopA]
        )
      ).rejects.toThrow(/human_confirmation_is_a_human_act/);
    });

    it("closes the domain to {human, system, provider} on every declared table", async () => {
      await expect(
        pool.query(
          `INSERT INTO pricing_snapshot (scan_session_id, shop_id, source, query, suggested_cents, authored_by)
           VALUES ($1,$2,'pricecharting','x',100,'robot')`,
          [sessionA, shopA]
        )
      ).rejects.toThrow(/pricing_snapshot_authored_by_check/);
    });
  });

  describe("041 §3.2 — supersession integrity", () => {
    // E16: today `WITH n AS (SELECT gen_random_uuid()) INSERT … SELECT nid, …, nid`
    // succeeds. R3 refuses it, and it is one line.
    it("refuses a row that supersedes itself (R3, I3)", async () => {
      const id = "88888888-8888-4888-8888-888888888881";
      await expect(confirm(shopA, sessionA, id, id)).rejects.toThrow(
        /human_confirmation_supersedes_not_self/
      );
    });

    // E18, and it is a T24 path: a shop-B confirmation superseding a shop-A row.
    it("refuses a supersession that crosses a SHOP (R1, I4a — T24 non-waivable)", async () => {
      const victim = await confirm(shopA, sessionA);
      await expect(confirm(shopB, sessionB, victim)).rejects.toThrow(
        /human_confirmation_supersedes_same_scope/
      );
    });

    it("refuses a supersession that crosses a SESSION inside one shop (R1, I4b)", async () => {
      const first = await confirm(shopA, sessionA);
      await expect(confirm(shopA, sessionA2, first)).rejects.toThrow(
        /human_confirmation_supersedes_same_scope/
      );
    });

    it("still allows the legitimate case: a correction in the same shop and session", async () => {
      const first = await confirm(shopA, sessionA);
      const second = await confirm(shopA, sessionA, first);
      const view = await pool.query(`SELECT id FROM human_confirmation_current WHERE scan_session_id = $1`, [
        sessionA,
      ]);
      expect((view.rows[0] as { id: string }).id).toBe(second);
    });

    it("keeps R2 — a row is superseded at most once, so the chain never forks", async () => {
      const first = await confirm(shopA, sessionA2);
      await confirm(shopA, sessionA2, first);
      await expect(confirm(shopA, sessionA2, first)).rejects.toThrow(/supersedes_once_idx/);
    });

    it("applies the same three rules to condition_assessment and pricing_snapshot", async () => {
      const cond = await pool.query(
        `INSERT INTO condition_assessment (scan_session_id, shop_id, grade_range_low, grade_range_high, defects)
         VALUES ($1,$2,'VG','FN',ARRAY[]::text[]) RETURNING id`,
        [sessionA, shopA]
      );
      const condId = (cond.rows[0] as { id: string }).id;
      await expect(
        pool.query(
          `INSERT INTO condition_assessment (scan_session_id, shop_id, grade_range_low, grade_range_high, defects, supersedes_id)
           VALUES ($1,$2,'FN','VF',ARRAY[]::text[],$3)`,
          [sessionB, shopB, condId]
        )
      ).rejects.toThrow(/condition_assessment_supersedes_same_scope/);

      const price = await pool.query(
        `INSERT INTO pricing_snapshot (scan_session_id, shop_id, source, query, suggested_cents)
         VALUES ($1,$2,'pricecharting','x',100) RETURNING id`,
        [sessionA, shopA]
      );
      await expect(
        pool.query(
          `INSERT INTO pricing_snapshot (scan_session_id, shop_id, source, query, suggested_cents, supersedes_id)
           VALUES ($1,$2,'ebay','x',200,$3)`,
          [sessionB, shopB, (price.rows[0] as { id: string }).id]
        )
      ).rejects.toThrow(/pricing_snapshot_supersedes_same_scope/);
    });
  });

  describe("041 §5.3 — session_seq", () => {
    /**
     * Eight concurrent writers on ONE session, all racing. `withLock` takes the
     * anchor `SELECT … FOR UPDATE` before assigning; `withoutLock` skips it and is
     * otherwise identical.
     *
     * This is the probe the whole of 041 §5.3 rests on, and a sequential loop is
     * not it: a loop passes whether or not the lock is doing anything, because
     * nothing ever contends. The property is "the read-modify-write is atomic
     * BECAUSE the anchor row is held", and the only way to observe it is to run it
     * concurrently and then run the same thing without the lock and watch it break.
     */
    async function race(
      withLock: boolean,
      session: string,
      shop: string
    ): Promise<PromiseSettledResult<number>[]> {
      const isolated = new pg.Pool({ connectionString: pool.options.connectionString!, max: 10 });
      try {
        return await Promise.all(
          Array.from({ length: 8 }, () =>
            withTransaction(
              isolated,
              async (tx) => {
                if (withLock) {
                  await tx.query(`SELECT id FROM scan_session WHERE id = $1 AND shop_id = $2 FOR UPDATE`, [
                    session,
                    shop,
                  ]);
                }
                const n = await assignSessionSeq(tx, shop, session);
                await tx.query(
                  `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source, confirmed_by, session_seq)
                 VALUES ($1,$2,'{}'::jsonb,'one_tap','op',$3)`,
                  [session, shop, n]
                );
                return n;
                // maxAttempts 1: a retry would paper over the very collision this
                // probe exists to observe.
              },
              { maxAttempts: 1 }
            ).then(
              (v) => ({ status: "fulfilled", value: v }) as PromiseSettledResult<number>,
              (e) => ({ status: "rejected", reason: e }) as PromiseSettledResult<number>
            )
          )
        );
      } finally {
        await isolated.end();
      }
    }

    it("gives eight concurrent writers eight distinct seqs WHEN the anchor lock is held (I6a)", async () => {
      const results = await race(true, sessionB, shopB);
      const values = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      expect(results.filter((r) => r.status === "rejected")).toEqual([]);
      expect(values).toHaveLength(8);
      expect(new Set(values).size).toBe(8);
      expect([...values].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    }, 60_000);

    // The negative half, and the reason the positive half means anything: without
    // the anchor lock the eight writers read the same `max()` and collide on
    // `human_confirmation_session_seq_idx`. The counter's correctness is a property
    // of the LOCK, not of the `max()` query — 041 §5.3 point 2 — and this is where
    // that stops being an assertion in a document.
    it("collides on the unique index WITHOUT the lock — the guard is the lock, not the query", async () => {
      const other = (
        await pool.query(`INSERT INTO scan_session (shop_id, created_by) VALUES ($1,'op') RETURNING id`, [
          shopB,
        ])
      ).rows[0] as { id: string };
      const results = await race(false, other.id, shopB);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected.length).toBeGreaterThan(0);
      for (const r of rejected) {
        expect(String((r as PromiseRejectedResult).reason)).toMatch(/human_confirmation_session_seq_idx/);
      }
      // The survivors are still internally consistent — nothing was silently
      // duplicated; the index refused rather than allowing two rows to share a seq.
      const rows = await pool.query(`SELECT session_seq FROM human_confirmation WHERE scan_session_id = $1`, [
        other.id,
      ]);
      const seqs = (rows.rows as Array<{ session_seq: string }>).map((r) => Number(r.session_seq));
      expect(new Set(seqs).size).toBe(seqs.length);
    }, 60_000);

    it("refuses a duplicate (scan_session_id, session_seq) rather than silently reusing one (I6b)", async () => {
      await expect(
        pool.query(
          `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source, confirmed_by, session_seq)
           VALUES ($1,$2,'{}'::jsonb,'one_tap','op',1)`,
          [sessionB, shopB]
        )
      ).rejects.toThrow(/human_confirmation_session_seq_idx/);
    });

    it("stays NULLABLE, because a legacy row is never backfilled (041 §5.3's stated limit)", async () => {
      const id = await confirm(shopA, sessionA2);
      const row = await pool.query(`SELECT session_seq FROM human_confirmation WHERE id = $1`, [id]);
      expect(row.rows[0]).toEqual({ session_seq: null });
    });
  });

  describe("042 §5.2 — request_idempotency", () => {
    it("carries the specified shape and serialises on (shop_id, idempotency_key)", async () => {
      await pool.query(
        `INSERT INTO request_idempotency (shop_id, idempotency_key, route, request_hash, response_status, response_body)
         VALUES ($1,'k1','/api/v1/shops/:shopId/scan-sessions/:id/confirm','abc',201,'{"ok":true}'::jsonb)`,
        [shopA]
      );
      await expect(
        pool.query(
          `INSERT INTO request_idempotency (shop_id, idempotency_key, route, request_hash, response_status, response_body)
           VALUES ($1,'k1','/other','abc',201,'{}'::jsonb)`,
          [shopA]
        )
      ).rejects.toThrow(/request_idempotency_shop_id_idempotency_key_key/);
      // Same key, different shop: allowed. The key is scoped by tenant, not global.
      await expect(
        pool.query(
          `INSERT INTO request_idempotency (shop_id, idempotency_key, route, request_hash, response_status, response_body)
           VALUES ($1,'k1','/other','abc',201,'{}'::jsonb)`,
          [shopB]
        )
      ).resolves.toBeDefined();
    });

    // 041 A11 / 042 A5: the exemption is what makes the completion UPDATE legal.
    // Asserted here rather than assumed, because the whole idempotency construction
    // in 042 §5.3 rests on it.
    it("is UPDATEable, which is the declared exemption doing its job", async () => {
      const res = await pool.query(
        `UPDATE request_idempotency SET response_status = 200 WHERE shop_id = $1 AND idempotency_key = 'k1'`,
        [shopA]
      );
      expect(res.rowCount).toBe(1);
      const row = APPEND_ONLY_EXEMPTIONS.find((e) => e.table === "request_idempotency");
      expect(row?.kind).toBe("permanent");
      expect(row?.pending).toBeUndefined();
      expect(row?.reason).toContain("deletion right");
    });
  });

  describe("040 §3.3 — scan_session_transition", () => {
    async function transition(over: Record<string, unknown>): Promise<pg.QueryResult> {
      const row = {
        kind: "parked",
        reopened_to_rung: null,
        against_table: null,
        against_id: null,
        observed_state: "confirmed",
        reason: "second look",
        actor_role: "operator",
        ...over,
      };
      return pool.query(
        // `session_seq` is NOT NULL on this table (041 §5.3: strict on tables
        // created after the record), so every insert supplies it. Assigned the way
        // the real writer will: max+1 for the session, which is safe here because
        // these inserts are sequential.
        `INSERT INTO scan_session_transition
           (shop_id, scan_session_id, kind, reopened_to_rung, against_table, against_id,
            observed_state, reason, actor_role, session_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                 (SELECT coalesce(max(session_seq),0)+1 FROM scan_session_transition
                   WHERE scan_session_id = $2))`,
        [
          shopA,
          sessionA,
          row.kind,
          row.reopened_to_rung,
          row.against_table,
          row.against_id,
          row.observed_state,
          row.reason,
          row.actor_role,
        ]
      );
    }

    it("accepts the four kinds and refuses a fifth (A2 — no 'abandoned', no 'failed', no 'published')", async () => {
      await expect(transition({ kind: "parked" })).resolves.toBeDefined();
      await expect(transition({ kind: "resumed" })).resolves.toBeDefined();
      await expect(transition({ kind: "voided", actor_role: "owner" })).resolves.toBeDefined();
      await expect(transition({ kind: "published", actor_role: "owner" })).rejects.toThrow(
        /scan_session_transition_kind_check/
      );
      await expect(transition({ kind: "abandoned", actor_role: "owner" })).rejects.toThrow(
        /scan_session_transition_kind_check/
      );
    });

    it("pairs reopened_to_rung with `reopened` in both directions (A2)", async () => {
      await expect(
        transition({ kind: "reopened", reopened_to_rung: "confirmed", actor_role: "manager" })
      ).resolves.toBeDefined();
      await expect(transition({ kind: "reopened", actor_role: "manager" })).rejects.toThrow(
        /rung_pairs_with_reopened/
      );
      await expect(transition({ kind: "parked", reopened_to_rung: "confirmed" })).rejects.toThrow(
        /rung_pairs_with_reopened/
      );
    });

    it("takes the causal reference whole or absent, never half (A1)", async () => {
      await expect(transition({ against_table: "human_confirmation" })).rejects.toThrow(/reference_is_whole/);
      await expect(
        transition({ against_table: "human_confirmation", against_id: sessionA })
      ).resolves.toBeDefined();
    });

    it("lets only a shop principal void or reopen (040 §3.3), and knows no 'system' role (A3)", async () => {
      await expect(transition({ kind: "voided", actor_role: "operator" })).rejects.toThrow(
        /principal_only_decisions/
      );
      await expect(transition({ actor_role: "system" })).rejects.toThrow(
        /scan_session_transition_actor_role_check/
      );
    });

    it("is append-only in the database, like every other witness table", async () => {
      await expect(pool.query(`UPDATE scan_session_transition SET reason = 'x'`)).rejects.toThrow(
        /append-only \(Hickey model\): UPDATE not allowed/
      );
      await expect(pool.query(`DELETE FROM scan_session_transition`)).rejects.toThrow(
        /append-only \(Hickey model\): DELETE not allowed/
      );
    });
  });
});
