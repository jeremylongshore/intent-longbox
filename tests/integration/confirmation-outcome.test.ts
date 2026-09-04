// L4/L6: migration 004's `human_confirmation.outcome` slot behaves the way
// 019 §3.0 requires — the CHECK admits exactly {confirm, correct, NULL}, the row
// is still append-only, the current-record view carries the column, and the real
// confirm route writes the right value for each source.
//
// Bead longbox-e5b.2.13 (E02-D03). Docs: 019 §3.0 / T3 / T20, 035 §4.3, 030 A1.
import { readFile } from "node:fs/promises";
import { mkdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createScanSession } from "../../src/services/scanSession.js";
import { createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";

const dbUp = await probeDb();

const UPLOADS_DIR = "tests/.tmp-outcome-uploads";
const ASM300 = { title: "Amazing Spider-Man", issue: "300", variant: "Direct" };
const HULK181 = { title: "Hulk", issue: "181" };

describe.skipIf(!dbUp)("004 human_confirmation.outcome", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let shopId: string;

  beforeAll(async () => {
    const url = await createFreshDb("longbox_outcome_test");
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    shopId = await seedShop(pool, { name: "Outcome Test Shop" });
    mkdirSync(UPLOADS_DIR, { recursive: true });
    app = await buildApp(pool, {
      port: 0,
      databaseUrl: url,
      uploadsDir: UPLOADS_DIR,
      bands: { high: 0.85, medium: 0.5 },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    rmSync(UPLOADS_DIR, { recursive: true, force: true });
  });

  // --- the migration itself ---------------------------------------------------

  it("re-applies by hand without error (idempotent outside the runner's ledger)", async () => {
    const sql = await readFile(
      new URL("../../migrations/004_human_confirmation_outcome.sql", import.meta.url),
      "utf8"
    );
    await pool.query(sql);
    await pool.query(sql);
    const col = await pool.query(
      `SELECT is_nullable, data_type FROM information_schema.columns
       WHERE table_name = 'human_confirmation' AND column_name = 'outcome'`
    );
    expect(col.rowCount).toBe(1);
    // NULLABLE by design: a pre-004 row has no outcome and is never backfilled.
    expect((col.rows[0] as { is_nullable: string }).is_nullable).toBe("YES");
  });

  it("admits NULL — the pre-G2 row that 030 A1 forbids backfilling", async () => {
    const sessionId = (await createScanSession(pool, shopId)).id;
    const r = await pool.query(
      `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source)
       VALUES ($1,$2,$3,'grid_pick') RETURNING outcome`,
      [sessionId, shopId, JSON.stringify(ASM300)]
    );
    expect((r.rows[0] as { outcome: string | null }).outcome).toBeNull();
  });

  it("admits confirm and correct", async () => {
    const sessionId = (await createScanSession(pool, shopId)).id;
    for (const outcome of ["confirm", "correct"]) {
      const r = await pool.query(
        `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source, outcome)
         VALUES ($1,$2,$3,'grid_pick',$4) RETURNING outcome`,
        [sessionId, shopId, JSON.stringify(ASM300), outcome]
      );
      expect((r.rows[0] as { outcome: string }).outcome).toBe(outcome);
    }
  });

  it("rejects any other value — the CHECK is the guard on T3's arithmetic", async () => {
    const sessionId = (await createScanSession(pool, shopId)).id;
    for (const bad of ["Confirm", "corrected", "unknown", "", "confirm "]) {
      await expect(
        pool.query(
          `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source, outcome)
           VALUES ($1,$2,$3,'grid_pick',$4)`,
          [sessionId, shopId, JSON.stringify(ASM300), bad]
        )
      ).rejects.toThrow(/human_confirmation_outcome_check/);
    }
  });

  it("keeps human_confirmation append-only: outcome cannot be updated after the fact", async () => {
    const sessionId = (await createScanSession(pool, shopId)).id;
    const r = await pool.query(
      `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source, outcome)
       VALUES ($1,$2,$3,'one_tap','confirm') RETURNING id`,
      [sessionId, shopId, JSON.stringify(ASM300)]
    );
    const id = (r.rows[0] as { id: string }).id;
    await expect(
      pool.query(`UPDATE human_confirmation SET outcome = 'correct' WHERE id = $1`, [id])
    ).rejects.toThrow(/append-only|immutable|forbid/i);
    await expect(pool.query(`DELETE FROM human_confirmation WHERE id = $1`, [id])).rejects.toThrow();
    const still = await pool.query(`SELECT outcome FROM human_confirmation WHERE id = $1`, [id]);
    expect((still.rows[0] as { outcome: string }).outcome).toBe("confirm");
  });

  it("exposes outcome through human_confirmation_current, so the read model matches the table", async () => {
    const sessionId = (await createScanSession(pool, shopId)).id;
    const first = await pool.query(
      `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source, outcome)
       VALUES ($1,$2,$3,'one_tap','confirm') RETURNING id`,
      [sessionId, shopId, JSON.stringify(ASM300)]
    );
    // A correction supersedes rather than edits (022 P2) — and the view follows.
    await pool.query(
      `INSERT INTO human_confirmation (scan_session_id, shop_id, confirmed_issue, source, outcome,
                                       supersedes_id, session_seq)
       VALUES ($1,$2,$3,'manual_search','correct',$4,
               (SELECT coalesce(max(session_seq), 0) + 1 FROM human_confirmation WHERE scan_session_id = $1))`,
      [
        sessionId,
        shopId,
        JSON.stringify({ title: "Hulk", issue: "181" }),
        (first.rows[0] as { id: string }).id,
      ]
    );
    const current = await pool.query(
      `SELECT outcome, source FROM human_confirmation_current WHERE scan_session_id = $1`,
      [sessionId]
    );
    expect(current.rowCount).toBe(1);
    expect(current.rows[0]).toMatchObject({ outcome: "correct", source: "manual_search" });
  });

  // --- the confirm route ------------------------------------------------------

  async function newSession(): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/shops/${shopId}/scan-sessions`,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    return (res.json() as { session: { id: string } }).session.id;
  }

  async function seedCandidateSet(sessionId: string, candidates: unknown[]): Promise<void> {
    await pool.query(
      `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates)
       VALUES ($1,$2,'llm_vision',$3)`,
      [sessionId, shopId, JSON.stringify(candidates)]
    );
  }

  /** The BarcodeParse shape identify.ts inserts before the vision call (barcode.ts:61-69):
   *  issue lives under supplement, never at top level, so identityKey sees no identity. */
  async function seedBarcodeSet(sessionId: string): Promise<void> {
    await pool.query(
      `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates, barcode_raw)
       VALUES ($1,$2,'barcode',$3,'759606043019 01711')`,
      [
        sessionId,
        shopId,
        JSON.stringify([
          {
            ok: true,
            upc: "759606043019",
            supplement: { raw: "01711", issue: 17, cover: 1, printing: 1 },
          },
        ]),
      ]
    );
  }

  /**
   * E06-D01 / 040 v1.3.0 F3: `POST …/confirm` with `source='one_tap'` is now
   * refused unless the session's current `llm_rerank` is in the HIGH band. These
   * tests are about `outcome` arithmetic, not about the band guard, so they seed
   * the corroborated row the guard asks for rather than working around it.
   */
  async function seedHighBandRerank(sessionId: string): Promise<void> {
    const cs = await pool.query(
      `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates)
       VALUES ($1,$2,'llm_vision',$3) RETURNING id`,
      [sessionId, shopId, JSON.stringify([ASM300])]
    );
    await pool.query(
      `INSERT INTO llm_rerank
         (candidate_set_id, scan_session_id, shop_id, provider, model, prompt_hash, response,
          confidence, band, contradiction)
       VALUES ($1,$2,$3,'anthropic','claude-sonnet-5','deadbeef','{}'::jsonb,0.92,'high',false)`,
      [(cs.rows[0] as { id: string }).id, sessionId, shopId]
    );
  }

  async function confirm(
    sessionId: string,
    body: { issue: Record<string, unknown>; source: string }
  ): Promise<string | null> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/shops/${shopId}/scan-sessions/${sessionId}/confirm`,
      payload: body,
      headers: { "idempotency-key": randomUUID() },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { confirmation: { outcome: string | null } }).confirmation.outcome;
  }

  it("writes confirm for a one-tap acceptance", async () => {
    const sessionId = await newSession();
    await seedCandidateSet(sessionId, [ASM300, { title: "Hulk", issue: "181" }]);
    await seedHighBandRerank(sessionId);
    expect(await confirm(sessionId, { issue: ASM300, source: "one_tap" })).toBe("confirm");
  });

  it("writes correct when a manual pick differs from the top proposal", async () => {
    const sessionId = await newSession();
    await seedCandidateSet(sessionId, [ASM300, { title: "Hulk", issue: "181" }]);
    expect(
      await confirm(sessionId, { issue: { title: "Hulk", issue: "181" }, source: "manual_search" })
    ).toBe("correct");
  });

  it("writes confirm when a grid pick lands on the top proposal despite a JSON round trip", async () => {
    const sessionId = await newSession();
    await seedCandidateSet(sessionId, [{ ...ASM300, publisher: "Marvel", year: 1988, confidence: 0.62 }]);
    // Same identity, different object, different extra fields, different casing.
    expect(
      await confirm(sessionId, {
        issue: { title: "amazing spider-man", issue: "#300", variant: "direct" },
        source: "grid_pick",
      })
    ).toBe("confirm");
  });

  it("writes correct for a manual search on a session that has no candidates at all", async () => {
    const sessionId = await newSession();
    expect(await confirm(sessionId, { issue: ASM300, source: "manual_search" })).toBe("correct");
  });

  it("compares against the LATEST candidate_set, not the first", async () => {
    const sessionId = await newSession();
    await seedCandidateSet(sessionId, [{ title: "Hulk", issue: "181" }]);
    await seedCandidateSet(sessionId, [ASM300]);
    expect(await confirm(sessionId, { issue: ASM300, source: "grid_pick" })).toBe("confirm");
    expect(await confirm(sessionId, { issue: { title: "Hulk", issue: "181" }, source: "grid_pick" })).toBe(
      "correct"
    );
  });

  // T20: the owner reviews the identity they INHERITED, not the model's ranking.
  it("scores an owner_review that agrees with the employee's correction as confirm", async () => {
    const sessionId = await newSession();
    await seedCandidateSet(sessionId, [ASM300]);
    expect(await confirm(sessionId, { issue: HULK181, source: "manual_search" })).toBe("correct");
    // The owner agrees with Hulk 181 — no owner edit, even though the model said ASM 300.
    expect(await confirm(sessionId, { issue: HULK181, source: "owner_review" })).toBe("confirm");
  });

  it("scores an owner_review that reverts to the model's top candidate as correct", async () => {
    const sessionId = await newSession();
    await seedCandidateSet(sessionId, [ASM300]);
    expect(await confirm(sessionId, { issue: HULK181, source: "manual_search" })).toBe("correct");
    // The owner changes it back to ASM 300 — an owner edit, even though it matches the model.
    expect(await confirm(sessionId, { issue: ASM300, source: "owner_review" })).toBe("correct");
  });

  // A failed vision call leaves the barcode set as the newest one; a bare
  // BarcodeParse has no title/issue, so counting it would score every
  // non-one_tap confirm as 'correct' and inflate T3.
  it("ignores a barcode candidate_set written after the vision set", async () => {
    const sessionId = await newSession();
    await seedCandidateSet(sessionId, [ASM300]);
    await seedBarcodeSet(sessionId);
    expect(await confirm(sessionId, { issue: ASM300, source: "grid_pick" })).toBe("confirm");
  });

  it("has no baseline at all when the session's only candidate_set is a barcode parse", async () => {
    const sessionId = await newSession();
    await seedBarcodeSet(sessionId);
    expect(await confirm(sessionId, { issue: ASM300, source: "manual_search" })).toBe("correct");
  });

  it("never leaves outcome NULL on a row the route wrote (no second meaning for NULL)", async () => {
    const sessionId = await newSession();
    await seedCandidateSet(sessionId, [ASM300]);
    await seedHighBandRerank(sessionId);
    for (const source of ["one_tap", "grid_pick", "manual_search", "owner_review"]) {
      expect(await confirm(sessionId, { issue: ASM300, source })).not.toBeNull();
    }
    const nulls = await pool.query(
      `SELECT count(*)::int AS n FROM human_confirmation
       WHERE scan_session_id = $1 AND outcome IS NULL`,
      [sessionId]
    );
    expect((nulls.rows[0] as { n: number }).n).toBe(0);
  });
});
