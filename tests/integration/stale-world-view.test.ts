// L4: the second device (042 §6, 040 A9, 042 I3).
//
// 041 §4.2 is what makes this DETERMINISTIC rather than racy: the read and the
// write run under one `SELECT … FROM scan_session … FOR UPDATE`, so the loser
// BLOCKS, then reads the winner's row, and is refused with the winner's answer
// in hand. A test that only fired two requests in sequence would prove the
// comparison and not the lock, so this one fires them concurrently.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { appUrl, asShop, createFreshDb, probeDb, runMigrations, seedShop } from "./helpers.js";
import { TEST_PIN_PEPPER } from "../testConfig.js";
import { signIn, type AuthedInject } from "./authHelpers.js";

const dbUp = await probeDb();
const UPLOADS_DIR = "tests/.tmp-stale-uploads";

describe.skipIf(!dbUp)("optimistic concurrency on the causal reference (042 §6)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  /** `app.inject` carrying a live device + operator session (048 I1). */
  let inject: AuthedInject;
  let shopId: string;
  let base: string;

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
    const migrateUrl = await createFreshDb("longbox_stale_test");
    await runMigrations(migrateUrl);
    const ownerPool = new pg.Pool({ connectionString: migrateUrl });
    shopId = await seedShop(ownerPool, { name: "Two Counters", slug: `stale-${Date.now()}` });
    await ownerPool.end();
    pool = new pg.Pool({ connectionString: appUrl(migrateUrl) });
    app = await buildApp(pool, {
      port: 0,
      databaseUrl: appUrl(migrateUrl),
      uploadsDir: UPLOADS_DIR,
      bands: { high: 0.85, medium: 0.5 },
      pinPepper: TEST_PIN_PEPPER,
      publicOrigins: [],
    });
    base = `/api/v1/shops/${shopId}/scan-sessions`;

    // E03-D09: every shop-scoped route is behind a device session plus an
    // operator session now (048 I1), so the suite signs one phone in and uses
    // `inject` in place of `app.inject`.
    ({ inject } = await signIn(pool, app, shopId));
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  async function newSession(): Promise<string> {
    const res = await inject({
      method: "POST",
      url: base,
      payload: {},
      headers: { "idempotency-key": randomUUID() },
    });
    return (res.json() as { session: { id: string } }).session.id;
  }

  async function post(url: string, payload: object) {
    return inject({ method: "POST", url, payload, headers: { "idempotency-key": randomUUID() } });
  }

  it("accepts a write made against the session's current witness", async () => {
    const sid = await newSession();
    const first = await post(`${base}/${sid}/confirm`, {
      issue: { title: "Hulk", issue: "180" },
      source: "grid_pick",
    });
    expect(first.statusCode).toBe(201);
    const confirmationId = (first.json() as { confirmation: { id: string } }).confirmation.id;
    const condition = await post(`${base}/${sid}/condition`, {
      grade_range_low: "FN",
      grade_range_high: "VF",
      defects: [],
      against: { table: "human_confirmation", id: confirmationId },
    });
    expect(condition.statusCode).toBe(201);
  });

  it("refuses a write made against a SUPERSEDED record with 409 STALE_WORLD_VIEW", async () => {
    const sid = await newSession();
    const first = await post(`${base}/${sid}/confirm`, {
      issue: { title: "Hulk", issue: "180" },
      source: "grid_pick",
    });
    const stale = (first.json() as { confirmation: { id: string } }).confirmation.id;

    // A second operator corrects the identification: the first confirmation is
    // now superseded, and the world the first operator was shown has moved.
    const corrected = await post(`${base}/${sid}/confirm`, {
      issue: { title: "Hulk", issue: "181" },
      source: "owner_review",
      against: { table: "human_confirmation", id: stale },
    });
    expect(corrected.statusCode).toBe(201);

    const late = await post(`${base}/${sid}/condition`, {
      grade_range_low: "GD",
      grade_range_high: "VG",
      defects: [],
      against: { table: "human_confirmation", id: stale },
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe("STALE_WORLD_VIEW");
    // 042 §6.4: the reference ONLY — never the row, never an actor. Putting the
    // winning row in the error body would be a second read path with its own
    // leak surface, at the exact moment two operators are already confused.
    // The reference is a table AND an id: the client re-reads the winning row
    // through the ordinary, tenancy-scoped path rather than being handed it here.
    expect(late.json().error.details).toEqual({
      current: { table: "human_confirmation", id: corrected.json().confirmation.id },
    });
    expect(late.body).not.toMatch(/confirmed_by|created_by|employee|owner/);
    // Not retryable: retrying sends the same stale reference and gets the same
    // answer. A PERSON has to resolve it (042 §4.4).
    expect(late.json().error.retryable).toBe(false);
  });

  it("refuses a reference the session has moved PAST (040 §3.4 clause 2)", async () => {
    const sid = await newSession();
    // Seed a proposal (rung 2) and then confirm (rung 3), so a write that still
    // names the proposal is looking at a world two records old.
    const proposal = await shopQuery(
      `INSERT INTO candidate_set (scan_session_id, shop_id, method, candidates)
       VALUES ($1,$2,'llm_vision','[]') RETURNING id`,
      [sid, shopId]
    );
    const candidateSetId = (proposal.rows[0] as { id: string }).id;
    await post(`${base}/${sid}/confirm`, { issue: { title: "Bone", issue: "1" }, source: "grid_pick" });

    const late = await post(`${base}/${sid}/condition`, {
      grade_range_low: "FN",
      grade_range_high: "VF",
      defects: [],
      against: { table: "candidate_set", id: candidateSetId },
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe("STALE_WORLD_VIEW");
  });

  it("lets exactly ONE of two concurrent confirmations against the same witness win (I3)", async () => {
    const sid = await newSession();
    const first = await post(`${base}/${sid}/confirm`, {
      issue: { title: "Hulk", issue: "180" },
      source: "grid_pick",
    });
    const witness = (first.json() as { confirmation: { id: string } }).confirmation.id;

    const both = await Promise.all([
      post(`${base}/${sid}/confirm`, {
        issue: { title: "Hulk", issue: "181" },
        source: "owner_review",
        against: { table: "human_confirmation", id: witness },
      }),
      post(`${base}/${sid}/confirm`, {
        issue: { title: "Hulk", issue: "182" },
        source: "owner_review",
        against: { table: "human_confirmation", id: witness },
      }),
    ]);
    const statuses = both.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    const loser = both.find((r) => r.statusCode === 409)!;
    // Either the causal check refused it (the witness was superseded while it
    // blocked) or the supersession writer did (something already supersedes the
    // predecessor). Both are the same finding stated one layer apart, and both
    // arrive as the same CODE — which is the point of §4.6: a client branches on
    // one value rather than on which layer noticed.
    expect(loser.json().error.code).toBe("STALE_WORLD_VIEW");

    // And the log holds exactly one successor: 041 §3.2 R2 — a chain never forks.
    const rows = await shopQuery(
      `SELECT count(*)::int AS n FROM human_confirmation WHERE supersedes_id = $1`,
      [witness]
    );
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });

  // ---------------------------------------------------------------------
  // E02-D11 — the reference is STORED, and what is stored is what the actor saw.
  // ---------------------------------------------------------------------

  it("STORES the checked reference on the row the write appends (041 §3.5)", async () => {
    const sid = await newSession();
    const first = await post(`${base}/${sid}/confirm`, {
      issue: { title: "Hulk", issue: "180" },
      source: "grid_pick",
    });
    const confirmationId = (first.json() as { confirmation: { id: string } }).confirmation.id;

    const condition = await post(`${base}/${sid}/condition`, {
      grade_range_low: "FN",
      grade_range_high: "VF",
      defects: [],
      against: { table: "human_confirmation", id: confirmationId },
    });
    expect(condition.statusCode).toBe(201);

    // E03-B04: the read-back goes through the SHOP'S context, exactly as the
    // running system does. A bare `pool.query` on this least-privileged role is
    // subject to every policy and would return zero rows — which would read as
    // "the column was not written" rather than as "the reader had no tenant".
    const stored = await shopQuery(
      `SELECT against_table, against_id FROM condition_assessment WHERE id = $1`,
      [(condition.json() as { assessment: { id: string } }).assessment.id]
    );
    // EXACTLY the pair the check accepted. Not the newest witness, not the row
    // the session is on now — the record this operator was looking at.
    expect(stored.rows[0]).toEqual({
      against_table: "human_confirmation",
      against_id: confirmationId,
    });
  });

  it("stores NULL for both columns when the client sends no reference", async () => {
    const sid = await newSession();
    const confirmation = await post(`${base}/${sid}/confirm`, {
      issue: { title: "Bone", issue: "1" },
      source: "grid_pick",
    });
    const stored = await shopQuery(`SELECT against_table, against_id FROM human_confirmation WHERE id = $1`, [
      (confirmation.json() as { confirmation: { id: string } }).confirmation.id,
    ]);
    // 042 §6.5's counted fallback, written honestly: the row says nothing about
    // what was on the screen, because nothing said what was on the screen.
    expect(stored.rows[0]).toEqual({ against_table: null, against_id: null });
  });

  it("keeps naming the SUPERSEDED record after the world moves on (040 §3.4 clause 2)", async () => {
    // The whole point of the column, and the one property a write-time check
    // alone cannot give: the stored reference is a statement about the past, so
    // it must not follow the present. If it advanced to the winner, the audit
    // answer to "what were they looking at when they decided that?" would become
    // "whatever is current now", which is not an answer.
    const sid = await newSession();
    const first = await post(`${base}/${sid}/confirm`, {
      issue: { title: "Hulk", issue: "180" },
      source: "grid_pick",
    });
    const witness = (first.json() as { confirmation: { id: string } }).confirmation.id;

    // The condition call is made against the confirmation that is current NOW.
    const condition = await post(`${base}/${sid}/condition`, {
      grade_range_low: "FN",
      grade_range_high: "VF",
      defects: [],
      against: { table: "human_confirmation", id: witness },
    });
    expect(condition.statusCode).toBe(201);
    const assessmentId = (condition.json() as { assessment: { id: string } }).assessment.id;

    // …and then the owner corrects the identification, so that witness is
    // superseded and no longer current.
    const corrected = await post(`${base}/${sid}/confirm`, {
      issue: { title: "Hulk", issue: "181" },
      source: "owner_review",
      against: { table: "condition_assessment", id: assessmentId },
    });
    expect(corrected.statusCode).toBe(201);
    const successor = (corrected.json() as { confirmation: { id: string } }).confirmation.id;
    expect(successor).not.toBe(witness);

    const stored = await shopQuery(
      `SELECT against_table, against_id FROM condition_assessment WHERE id = $1`,
      [assessmentId]
    );
    // Still the superseded row. The successor exists, the session has moved, and
    // the record of what the first operator saw is unchanged — because nothing
    // ever edits an append-only row, and because nobody wrote a second value.
    expect(stored.rows[0]).toEqual({ against_table: "human_confirmation", against_id: witness });

    // And it is READABLE through the ordinary trail, so 022 P8's decision strip
    // can be built without a second query nobody would write.
    const detail = await inject({ method: "GET", url: `${base}/${sid}` });
    const events = detail.json() as {
      events: { condition_assessment: Array<{ id: string; against_table: string; against_id: string }> };
    };
    expect(events.events.condition_assessment.find((r) => r.id === assessmentId)).toMatchObject({
      against_table: "human_confirmation",
      against_id: witness,
    });
  });

  it("carries the reference onto a CORRECTION, which sees its own world", async () => {
    // A superseding row is an act by a second person against a state of their
    // own. Copying the predecessor's reference forward would attribute the first
    // actor's view to the second.
    const sid = await newSession();
    const first = await post(`${base}/${sid}/confirm`, {
      issue: { title: "Bone", issue: "1" },
      source: "grid_pick",
    });
    const witness = (first.json() as { confirmation: { id: string } }).confirmation.id;
    const corrected = await post(`${base}/${sid}/confirm`, {
      issue: { title: "Bone", issue: "2" },
      source: "owner_review",
      against: { table: "human_confirmation", id: witness },
    });
    const rows = await shopQuery(
      `SELECT id, supersedes_id, against_table, against_id FROM human_confirmation
        WHERE scan_session_id = $1 ORDER BY session_seq`,
      [sid]
    );
    expect(rows.rows).toEqual([
      { id: witness, supersedes_id: null, against_table: null, against_id: null },
      {
        id: (corrected.json() as { confirmation: { id: string } }).confirmation.id,
        supersedes_id: witness,
        against_table: "human_confirmation",
        against_id: witness,
      },
    ]);
  });

  it("still accepts a write with NO reference, and counts the fallback (042 §6.5, 040 I18)", async () => {
    const sid = await newSession();
    await post(`${base}/${sid}/confirm`, { issue: { title: "Bone", issue: "1" }, source: "grid_pick" });
    // E05-B08's offline queue replays writes made by a client that predates the
    // field. Refusing them would 400 that queue's normal operation.
    const noReference = await post(`${base}/${sid}/condition`, {
      grade_range_low: "FN",
      grade_range_high: "VF",
      defects: [],
    });
    expect(noReference.statusCode).toBe(201);
  });
});
