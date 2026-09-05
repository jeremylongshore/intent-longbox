// L4: the causal reference AS THE DATABASE ENFORCES IT (E02-D11; migration `030`,
// 040 §3.3, 041 §3.5, 042 §6).
//
// `tests/causal-reference.test.ts` reads the migration as text and proves the
// file says what it should. This file proves the DATABASE does what the file
// says — which is the only version of the claim that survives a hand-edited
// deploy, a partial re-run, or a future migration that drops a constraint on its
// way past. The distinction is the same one 041 §9 draws for the append-only
// triggers: a service check is a message, the database is the guarantee.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createScanSession } from "../../src/services/scanSession.js";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { AGAINST_TABLES } from "../../src/contracts/v1/schemas.js";

const dbUp = await probeDb();

/** The two tables 041 §3.5 puts the columns on. */
const TABLES = ["human_confirmation", "condition_assessment"] as const;

describe.skipIf(!dbUp)("the causal reference, in the schema (030)", () => {
  let pool: pg.Pool;
  let shopId: string;
  let sessionId: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_causal_reference");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    shopId = await seedShop(pool);
    sessionId = (await createScanSession(pool, shopId)).id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** One confirmation with whatever reference the case is about. */
  const confirmWith = (againstTable: string | null, againstId: string | null): Promise<pg.QueryResult> =>
    pool.query(
      `INSERT INTO human_confirmation
         (scan_session_id, shop_id, confirmed_issue, source, against_table, against_id)
       VALUES ($1,$2,$3,'grid_pick',$4,$5) RETURNING id`,
      [sessionId, shopId, JSON.stringify({ title: "Hulk", issue: "181" }), againstTable, againstId]
    );

  const assessWith = (againstTable: string | null, againstId: string | null): Promise<pg.QueryResult> =>
    pool.query(
      `INSERT INTO condition_assessment
         (scan_session_id, shop_id, grade_range_low, grade_range_high, defects, against_table, against_id)
       VALUES ($1,$2,'VG','FN','{}',$3,$4) RETURNING id`,
      [sessionId, shopId, againstTable, againstId]
    );

  const writers = [
    ["human_confirmation", confirmWith],
    ["condition_assessment", assessWith],
  ] as const;

  it.each(writers)("%s stores a whole reference exactly as given", async (table, write) => {
    const target = randomUUID();
    const res = await write("llm_rerank", target);
    const stored = await pool.query(`SELECT against_table, against_id FROM ${table} WHERE id = $1`, [
      (res.rows[0] as { id: string }).id,
    ]);
    expect(stored.rows[0]).toEqual({ against_table: "llm_rerank", against_id: target });
  });

  it.each(writers)("%s stores NULL for both when no reference is sent (042 §6.5)", async (table, write) => {
    // The counted fallback. NULL is an absence, and 041 §10.1's rule is that an
    // absence is never filled in with a guess — the one column that answers
    // "what was this person looking at" may not answer it by inference.
    const res = await write(null, null);
    const stored = await pool.query(`SELECT against_table, against_id FROM ${table} WHERE id = $1`, [
      (res.rows[0] as { id: string }).id,
    ]);
    expect(stored.rows[0]).toEqual({ against_table: null, against_id: null });
  });

  it.each(writers)("%s REFUSES half a reference — a table with no id", async (_table, write) => {
    // 040 §3.3's whole-or-absent CHECK. Half a reference claims a rung with no
    // row to check it against, and 040 §3.4 clause 2 would then compare
    // something it can neither confirm nor refute.
    await expect(write("human_confirmation", null)).rejects.toThrow(/reference_is_whole/);
  });

  it.each(writers)("%s REFUSES half a reference — an id with no table", async (_table, write) => {
    await expect(write(null, randomUUID())).rejects.toThrow(/reference_is_whole/);
  });

  it.each(writers)("%s REFUSES a table name outside the enumerated set", async (_table, write) => {
    // Free text here reads back as a reference that names nothing — at query
    // time indistinguishable from a reference to a row that was purged.
    await expect(write("human_confirmations", randomUUID())).rejects.toThrow(/against_table_check/);
    await expect(write("human_confirmation_current", randomUUID())).rejects.toThrow(/against_table_check/);
  });

  it("accepts every table the WIRE can name, so no legal request can 500", async () => {
    // Zod's `AGAINST_TABLES` is what a client may send. A value the contract
    // accepts and the CHECK refuses would be a 500 on a request the API
    // documented as legal — proved here against the live constraint rather than
    // by comparing two lists by eye.
    for (const table of AGAINST_TABLES) {
      await expect(confirmWith(table, randomUUID())).resolves.toBeDefined();
    }
  });

  it.each(TABLES)("re-created %s_current so the read model carries both columns", async (table) => {
    // A view's column list is frozen at CREATE time (004:95-101). Without the
    // replacement in `030` §5 the read model would silently omit the columns and
    // disagree with its own table.
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = $1 AND column_name LIKE 'against%' ORDER BY column_name`,
      [`${table}_current`]
    );
    expect(cols.rows).toEqual([{ column_name: "against_id" }, { column_name: "against_table" }]);
  });

  it("left pricing_snapshot without the columns (041 §3.5)", async () => {
    // A machine-authored record was not "made against" a world a provider was
    // shown. The absence is the decision, so it is asserted rather than assumed.
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'pricing_snapshot' AND column_name LIKE 'against%'`
    );
    expect(cols.rows).toEqual([]);
  });

  it("keeps the columns immutable like every other one (locked decision 4)", async () => {
    // A stored reference is a fact about what somebody saw. Correcting it is a
    // new row naming the old one, never an UPDATE — and the trigger, not this
    // test's good intentions, is what makes that true.
    const res = await confirmWith("candidate_set", randomUUID());
    await expect(
      pool.query(`UPDATE human_confirmation SET against_table = 'scan_photo' WHERE id = $1`, [
        (res.rows[0] as { id: string }).id,
      ])
    ).rejects.toThrow(/append-only|immutable/i);
  });
});
