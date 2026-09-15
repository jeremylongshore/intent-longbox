// L3 unit: the pure half of the outbox runtime — the three eligibility
// predicates, the backoff formula, the failure classification and the attempt
// detail allowlist.
//
// WHY THESE ARE TESTED AS SHAPES AND NOT ONLY THROUGH A DATABASE. 043 §2.4's
// whole claim is that eligibility is a PREDICATE and not stored state, and the
// predicates are exported so the claim query, the tests and any future read
// model share ONE definition. A test that only ran the composed query would
// prove the composition and say nothing about whether the three sentences still
// mean what §2.4 says they mean. The behavioural half — two pollers, a crash
// mid-attempt, a lease that expires with no reaper — is
// tests/integration/outbox-skip-locked.test.ts, and it needs a real Postgres.
//
// Bead: longbox-e5b.2.17 (E02-D07). Docs: 043 §2.4, §5.2, §5.3, §7.2, §11 I6, I11, I16.
import { describe, expect, it } from "vitest";
import {
  assertAttemptDetail,
  AttemptDetailError,
  ATTEMPT_DETAIL_KEYS,
  ATTEMPT_KINDS,
  backoffDelayMs,
  claimQuerySql,
  DEFAULT_OUTBOX_PARAMS,
  duePredicateSql,
  GUARD_REASON_CODES,
  inFlightPredicateSql,
  isTerminalFailure,
  loadOutboxParams,
  REASON_CODES,
  terminalPredicateSql,
  TERMINAL_KINDS,
} from "../src/services/outbox.js";

describe("the eligibility predicates (043 §2.4)", () => {
  it("terminal is exactly {delivered, dead_lettered} — no third way for a row to end", () => {
    expect(TERMINAL_KINDS).toEqual(["delivered", "dead_lettered"]);
    const sql = terminalPredicateSql();
    expect(sql).toContain("outbox_attempt");
    expect(sql).toContain("'delivered'");
    expect(sql).toContain("'dead_lettered'");
    // A `failed` row must NOT be terminal: that is the difference between a
    // retry and a dead letter, and it is the whole of 043 §5.
    expect(sql).not.toContain("'failed'");
  });

  it("in flight reads the NEWEST attempt and compares it to a server-side now()", () => {
    const sql = inFlightPredicateSql("o", "$1");
    expect(sql).toContain("ORDER BY a.created_at DESC, a.id DESC");
    expect(sql).toContain("LIMIT 1");
    expect(sql).toContain("'started'");
    // 043 A7: the clock is the server's, inside the claim transaction. A worker
    // wall clock anywhere in this expression would make the lease derive from
    // whichever host was fastest to be wrong.
    expect(sql).toContain("now()");
    expect(sql).not.toMatch(/\$\d+::timestamptz/);
  });

  it("in flight is FALSE for a row with no attempts, rather than NULL propagating", () => {
    // A row nothing has tried is not "in flight"; leaving the scalar subquery's
    // NULL to behave like false by accident is how a three-valued result becomes
    // a bug the day somebody negates it.
    expect(inFlightPredicateSql()).toContain("coalesce(");
    expect(inFlightPredicateSql()).toContain(", false)");
  });

  it("due backs off from the newest FAILURE only — a crashed `started` is not a failure", () => {
    const sql = duePredicateSql();
    expect(sql).toContain("a.kind = 'failed'");
    // 043 §11 I12: a `started` with no terminal partner becomes eligible again
    // when it ages past attempt_visibility. That is the IN-FLIGHT predicate's
    // job; if `due` also gated on it, a crashed worker's row would need a
    // failure row it never got to write.
    expect(sql).not.toContain("'started'");
    expect(sql).toContain("power(2");
    expect(sql).toContain("least(");
  });

  it("due carries jitter by default, and the jitter is overridable for a deterministic test", () => {
    expect(duePredicateSql()).toContain("(0.5 + random())");
    expect(duePredicateSql("o", "$2", "$3", "1.0")).not.toContain("random()");
  });

  it("the claim query is the three predicates plus SKIP LOCKED and 043 §3.2's order", () => {
    const sql = claimQuerySql();
    expect(sql).toContain("FOR UPDATE OF o SKIP LOCKED");
    expect(sql).toContain("ORDER BY o.scan_session_id, o.session_seq NULLS LAST, o.created_at, o.id");
    expect(sql).toContain("NOT EXISTS"); // terminal, negated
    expect(sql).toContain("coalesce("); // in flight, negated
    // Shop scoping is a seam for E13-B03's fairness, not a policy: NULL drains
    // every shop, which is what one process does today.
    expect(sql).toContain("$5::uuid IS NULL OR o.shop_id = $5::uuid");
  });

  it("the claim query names no status, claimed_at, lease or next_attempt column (I11)", () => {
    // This is the assertion that fails first if somebody adds the column under
    // load. 043 §2.4's escape hatch is a materialized index over the log
    // (041 §6.2's first form), NEVER a status column.
    const sql = claimQuerySql();
    for (const banned of ["status", "claimed_at", "locked_at", "lease_until", "next_attempt_at"]) {
      expect(sql).not.toContain(`o.${banned}`);
    }
  });
});

describe("backoff (043 §5.2)", () => {
  const params = { backoffBaseMs: 30_000, backoffCeilingMs: 30 * 60_000 };

  it("doubles per attempt, with the jitter pinned", () => {
    const noJitter = () => 0.5; // 0.5 + 0.5 = 1.0 exactly
    expect(backoffDelayMs(1, params, noJitter)).toBe(30_000);
    expect(backoffDelayMs(2, params, noJitter)).toBe(60_000);
    expect(backoffDelayMs(3, params, noJitter)).toBe(120_000);
    expect(backoffDelayMs(4, params, noJitter)).toBe(240_000);
  });

  it("caps at the ceiling so one job cannot stretch across a working day", () => {
    const noJitter = () => 0.5;
    expect(backoffDelayMs(10, params, noJitter)).toBe(30 * 60_000);
    expect(backoffDelayMs(50, params, noJitter)).toBe(30 * 60_000);
  });

  it("jitters within [0.5x, 1.5x) — the anti-thundering-herd property, not decoration", () => {
    // 035's Pilot C is ≥300 items: a shop that scans a batch during a provider
    // incident has ~300 jobs that failed within minutes of each other. Without
    // jitter they retry in one spike when the incident ends, converting one
    // outage into a self-inflicted second one. THE NUMBER OF JOBS IS SMALL; THE
    // CORRELATION BETWEEN THEM IS TOTAL.
    expect(backoffDelayMs(1, params, () => 0)).toBe(15_000);
    expect(backoffDelayMs(1, params, () => 0.5)).toBe(30_000);
    // `random()` is [0, 1), so the factor is [0.5, 1.5) and the product rounds
    // to at most the ceiling of that half-open range.
    expect(backoffDelayMs(1, params, () => 0.999999)).toBeLessThanOrEqual(45_000);
    expect(backoffDelayMs(1, params, () => 0.999999)).toBeGreaterThan(44_000);
  });

  it("two jobs failing in the same instant get DIFFERENT due times (I16)", () => {
    const a = backoffDelayMs(1, params, () => 0.1);
    const b = backoffDelayMs(1, params, () => 0.9);
    expect(a).not.toBe(b);
  });

  it("refuses attempt numbers below 1 rather than computing a fractional delay", () => {
    expect(() => backoffDelayMs(0, params)).toThrow(/attemptNo must be >= 1/);
    expect(() => backoffDelayMs(1.5, params)).toThrow(/attemptNo must be >= 1/);
  });
});

describe("failure classification (043 §5.2, §5.3)", () => {
  it("a PERMANENT failure is terminal on the first attempt, with no backoff", () => {
    // A Shopify `userErrors` entry — an invalid price, a missing required field
    // — will fail identically forever. Retrying it six times over 75 minutes
    // buys nothing and delays the owner hearing about it.
    expect(isTerminalFailure({ permanent: true }, 1, 6)).toBe(true);
  });

  it("a transient failure retries until the PROVISIONAL ceiling", () => {
    expect(isTerminalFailure({}, 1, 6)).toBe(false);
    expect(isTerminalFailure({}, 5, 6)).toBe(false);
    expect(isTerminalFailure({}, 6, 6)).toBe(true);
  });
});

describe("the attempt detail allowlist (043 §2.5, §11 I6)", () => {
  it("accepts the declared keys", () => {
    expect(assertAttemptDetail({ reason_code: "listing_left_draft", http_status: 502 })).toEqual({
      reason_code: "listing_left_draft",
      http_status: 502,
    });
    expect(assertAttemptDetail(undefined)).toBeUndefined();
  });

  it("REFUSES a provider exception message, a response body or a model name", () => {
    // 042 §4.3's "the server emits no operator prose", applied to a table
    // instead of a wire, plus 022 P8 (cost stays in cost_log) and 019 T35.
    expect(() => assertAttemptDetail({ message: "boom" } as never)).toThrow(AttemptDetailError);
    expect(() => assertAttemptDetail({ body: "{...}" } as never)).toThrow(/not an allowlisted key/);
    expect(() => assertAttemptDetail({ model: "claude-sonnet-5" } as never)).toThrow(AttemptDetailError);
    expect(() => assertAttemptDetail({ operator: "operator-a" } as never)).toThrow(AttemptDetailError);
    expect(() => assertAttemptDetail({ estimated_usd: 0.01 } as never)).toThrow(AttemptDetailError);
  });

  it("names every offending key in the error, so the fix is not a guessing game", () => {
    try {
      assertAttemptDetail({ message: "x", body: "y" } as never);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as AttemptDetailError).keys).toEqual(["message", "body"]);
      expect((err as Error).message).toContain(ATTEMPT_DETAIL_KEYS.join(", "));
    }
  });

  it("carries error_class and not error_message — a class is diagnostic, a message is prose", () => {
    expect(ATTEMPT_DETAIL_KEYS).toContain("error_class");
    expect(ATTEMPT_DETAIL_KEYS).not.toContain("error_message");
  });
});

describe("the declared kinds and reason codes", () => {
  it("has exactly the five kinds migration 011's CHECK constraint names", () => {
    expect([...ATTEMPT_KINDS]).toEqual([
      "started",
      "delivered",
      "failed",
      "dead_lettered",
      "replay_requested",
    ]);
  });

  it("keeps the GUARD refusals identifiable as a group (043 A5)", () => {
    // A dead letter from a Shopify 500 is a provider problem and belongs in
    // T17's "declared provider outage" arithmetic. A dead letter carrying one of
    // these two is the guard WORKING. Counted together, a guard doing its job
    // reads as a reliability problem and a reliability problem reads as a guard
    // doing its job — so the grouping is a declared constant, not a convention.
    //
    // E03-B08 added the third — `customer_scope_was_granted`, the privacy job's
    // refusal — and the EXACT list is what made that an edit somebody had to
    // make on purpose. A new dead-letter code is a decision about which side of
    // the T17 line it falls on, and this assertion is where that decision is
    // taken rather than inherited.
    //
    // E03-B08's cannon added the FOURTH — `no_recorded_grant`, the security
    // lens's F4 — and deliberately did NOT add `privacy_topic_not_auto_fulfillable`
    // beside it (the gate audit's B6). That split is the whole content of this
    // assertion: a guard refusal says A CONTROL WORKED, and a job enqueued for a
    // topic nothing answers automatically is a PRODUCER defect where nothing was
    // controlled. Filing it as a guard refusal would have put a false sentence in
    // `outbox_dead_letter` (041 §8.2) and counted a bug as a control.
    expect([...GUARD_REASON_CODES]).toEqual([
      "listing_left_draft",
      "no_observation_evidence",
      "customer_scope_was_granted",
      "no_recorded_grant",
    ]);
    expect(REASON_CODES).toContain("privacy_topic_not_auto_fulfillable");
    expect([...GUARD_REASON_CODES]).not.toContain("privacy_topic_not_auto_fulfillable");
    for (const code of GUARD_REASON_CODES) expect(REASON_CODES).toContain(code);
  });
});

describe("the PROVISIONAL parameters (043 §5.3)", () => {
  it("defaults to the four floors the record adopted", () => {
    expect(DEFAULT_OUTBOX_PARAMS.maxAttempts).toBe(6);
    expect(DEFAULT_OUTBOX_PARAMS.backoffBaseMs).toBe(30_000);
    expect(DEFAULT_OUTBOX_PARAMS.backoffCeilingMs).toBe(30 * 60_000);
    expect(DEFAULT_OUTBOX_PARAMS.attemptVisibilityMs).toBe(5 * 60_000);
  });

  it("computes the span six attempts actually cover, matching 043 v1.1.2", () => {
    // A DERIVATION NIT THAT IS NOW CLOSED, and the sequence is worth keeping.
    //
    // 043 v1.0.0–v1.1.1 §5.3 read: "six attempts span roughly **75 minutes** of
    // wall clock before dead-lettering." With `delay(n) = min(base × 2^(n-1),
    // ceiling)` and jitter at its mean of 1.0, the five delays BETWEEN six
    // attempts are 30 s + 1 + 2 + 4 + 8 min = 15.5 min, and six delays including
    // the one after the last attempt are 31.5 min. The ceiling is never reached
    // (2^5 × 30 s = 16 min < 30 min), so no reading of the formula produced 75.
    //
    // **043 v1.1.2 corrected this upstream; the test asserts the code, which the
    // correction now matches.** The DECISION was never in question —
    // `job_max_attempts` is a PROVISIONAL floor — only a sentence of arithmetic
    // in its derivation, which 029 §9 makes repairable by a row. The test was
    // written to the code rather than to the record precisely so that it would
    // still be right whichever way the discrepancy resolved.
    const noJitter = () => 0.5;
    const fiveDelays = [1, 2, 3, 4, 5]
      .map((n) => backoffDelayMs(n, DEFAULT_OUTBOX_PARAMS, noJitter))
      .reduce((a, b) => a + b, 0);
    const sixDelays = fiveDelays + backoffDelayMs(6, DEFAULT_OUTBOX_PARAMS, noJitter);
    expect(fiveDelays / 60_000).toBeCloseTo(15.5, 5);
    expect(sixDelays / 60_000).toBeCloseTo(31.5, 5);
    // The ceiling is never reached within the attempt budget.
    expect(backoffDelayMs(6, DEFAULT_OUTBOX_PARAMS, noJitter)).toBeLessThan(
      DEFAULT_OUTBOX_PARAMS.backoffCeilingMs
    );
  });

  it("reads overrides from the environment and refuses a non-positive one", () => {
    const prev = process.env["OUTBOX_MAX_ATTEMPTS"];
    try {
      process.env["OUTBOX_MAX_ATTEMPTS"] = "12";
      expect(loadOutboxParams().maxAttempts).toBe(12); // 018 C3: raising is free
      process.env["OUTBOX_MAX_ATTEMPTS"] = "0";
      expect(() => loadOutboxParams()).toThrow(/must be a positive integer/);
      process.env["OUTBOX_MAX_ATTEMPTS"] = "";
      expect(loadOutboxParams().maxAttempts).toBe(6);
    } finally {
      if (prev === undefined) delete process.env["OUTBOX_MAX_ATTEMPTS"];
      else process.env["OUTBOX_MAX_ATTEMPTS"] = prev;
    }
  });
});
