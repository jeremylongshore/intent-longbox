// L3: the application service behind the HTTP edge, against a fake pool.
//
// What a fake CAN decide, and what this file is therefore for: the STATEMENT
// ORDER inside each transaction (042 I22's fixed lock order, which is the whole
// of the deadlock argument), the DTO each route returns, which reads drive which
// gate, and that the provider call happens OUTSIDE the transaction (041 §4.1).
// What it cannot decide — that a duplicate key blocks on a constraint — is the
// integration lane's, and is not simulated here.
import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import * as api from "../src/services/sessionApi.js";
import { MESSAGES } from "../src/contracts/v1/errors.js";
import { ShopRateLimiter } from "../src/services/rateLimit.js";
import { requestHash } from "../src/services/idempotency.js";
import { fakeResponse, fakeTxPool, type FakeTxPool } from "./fakes.js";
import { TEST_PIN_PEPPER } from "./testConfig.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";

const CONFIG = {
  port: 0,
  databaseUrl: "postgres://unused",
  uploadsDir: "tests/.tmp-unused",
  bands: { high: 0.85, medium: 0.5 },
  pinPepper: TEST_PIN_PEPPER,
  publicOrigins: [],
};

function deps(pool: pg.Pool, limiter = new ShopRateLimiter()): api.ApiDeps {
  return { pool, config: CONFIG, limiter };
}

function ctx(route: string, sessionId = SESSION) {
  return { shopId: SHOP, sessionId, idempotencyKey: `key-${route}`, route, method: "POST" };
}

/** The one route with no session: `POST …/scan-sessions` opens it. */
function shopCtx(route: string) {
  return { shopId: SHOP, idempotencyKey: `key-${route}`, route, method: "POST" };
}

/** The witness query returns the CURRENT row's id per rung, or null. */
const noWitness = {
  captured: null,
  proposed: null,
  confirmed: null,
  conditioned: null,
  priced: null,
  drafted: null,
};

/** The witness statement, recognised by a column only it declares. */
const isWitnessQuery = (text: string): boolean => text.includes("AS captured");

/** A pool that answers the reads every mutating path makes on the way in. */
function apiPool(overrides: (text: string) => { rows: unknown[] } | undefined = () => undefined): FakeTxPool {
  return fakeTxPool((text, values) => {
    const custom = overrides(text);
    if (custom) return custom;
    if (text.includes("FROM shop WHERE id"))
      return { rows: [{ id: SHOP, name: "Gotham", shopify_domain: null }] };
    if (text.includes("FROM scan_session WHERE id")) {
      return { rows: [{ id: SESSION, shop_id: SHOP, created_at: "t" }] };
    }
    if (text.includes("INSERT INTO request_idempotency")) return { rows: [{ id: "idem-1" }] };
    if (text.includes("SELECT request_hash")) return { rows: [] };
    if (isWitnessQuery(text)) return { rows: [{ ...noWitness, confirmed: "c-1", priced: "ps-1" }] };
    if (text.includes("coalesce(max")) return { rows: [{ m: "2" }] };
    if (text.includes("INSERT INTO scan_session")) {
      return { rows: [{ id: SESSION, shop_id: SHOP, created_at: "t" }] };
    }
    if (text.includes("INSERT INTO human_confirmation")) {
      return { rows: [{ id: "c-1", created_at: "t", outcome: "confirm" }] };
    }
    if (text.includes("INSERT INTO condition_assessment")) return { rows: [{ id: "a-1", created_at: "t" }] };
    if (text.includes("INSERT INTO pricing_snapshot")) return { rows: [{ id: "ps-1" }] };
    if (values !== undefined && text.includes("INSERT INTO outbox")) return { rows: [{ id: "o-1" }] };
    return undefined;
  });
}

/**
 * Statement texts seen on the WRITING connection, whitespace-normalised.
 *
 * ⚠ NOT `clients[0]` any more (E03-B04). Every read on the way in now runs in its
 * own small transaction so that `SET LOCAL longbox.shop_id` has somewhere to live
 * (034 §3.2: transaction-local, never sticky), so a mutating path checks out
 * several connections and the interesting one is the connection that took the
 * `request_idempotency` row. It is found by that statement rather than by an
 * index, which is what these assertions were always about.
 */
function writeClient(p: FakeTxPool): FakeTxPool["clients"][number] | undefined {
  return p.clients.find((c) => c.calls.some((q) => q.text.includes("INSERT INTO request_idempotency")));
}

function heads(p: FakeTxPool): string[] {
  return (writeClient(p)?.calls ?? []).map((c) => c.text.trim().replace(/\s+/g, " "));
}

/** Did any connection take a lock or write the idempotency row? */
function tookTheWriteTransaction(p: FakeTxPool): boolean {
  return writeClient(p) !== undefined;
}

describe("createSession", () => {
  it("returns the projection and writes no operator identifier (041 §8.4, 042 I1)", async () => {
    const p = apiPool();
    const out = await api.createSession(deps(p.pool), shopCtx("/scan-sessions"));
    expect(out.status).toBe(201);
    expect(out.body).toEqual({ session: { id: SESSION, shop_id: SHOP, created_at: "t" } });
    const insert = p.calls.find((c) => c.text.includes("INSERT INTO scan_session"))!;
    // 048 §6.3: `operator_id` comes from the context the hook resolved. This
    // fixture context carries none, so it is NULL — and `created_by` is still
    // absent from the statement entirely.
    expect(insert.values).toEqual([SHOP, null]);
  });

  it("refuses an unknown shop with SHOP_NOT_FOUND before opening a transaction", async () => {
    const p = fakeTxPool(() => ({ rows: [] }));
    await expect(api.createSession(deps(p.pool), shopCtx("/scan-sessions"))).rejects.toMatchObject({
      code: "SHOP_NOT_FOUND",
      status: 404,
    });
    // The shop read itself now runs in a transaction of its own — that is what
    // carries the tenant context (E03-B04) — so the property is no longer "no
    // connection at all" but "no idempotency row and no lock": the refusal still
    // happens before the request transaction is opened.
    expect(tookTheWriteTransaction(p)).toBe(false);
  });
});

describe("confirm", () => {
  it("takes the idempotency row FIRST and the anchor lock SECOND (042 I22)", async () => {
    const p = apiPool();
    await api.confirm(deps(p.pool), ctx("/confirm"), {
      issue: { title: "Hulk" },
      source: "grid_pick",
    });
    const seen = heads(p);
    // The identity of the request, then the subject it acts on, in that order,
    // in every handler, always (042 §5.3(b)): a replay is recognised before it
    // takes any lock on domain state, and two handlers with opposite orders
    // deadlock intermittently at a counter.
    // E03-B04: the tenant context travels WITH `BEGIN`, in one statement, so it
    // precedes the idempotency INSERT by construction and cannot be expressed
    // later. It takes no lock, so it adds no position to 042 §5.3(b)'s order.
    expect(seen[0]).toContain("BEGIN");
    expect(seen[0]).toContain("set_config('longbox.shop_id'");
    expect(seen[1]).toContain("INSERT INTO request_idempotency");
    expect(seen[2]).toContain("FOR UPDATE");
    expect(seen.at(-1)).toBe("COMMIT");
  });

  it("returns the confirmation DTO and the outcome it just wrote", async () => {
    const p = apiPool();
    const out = await api.confirm(deps(p.pool), ctx("/confirm"), {
      issue: { title: "Hulk" },
      source: "grid_pick",
    });
    const body = out.body as { confirmation: Record<string, unknown> };
    expect(out.status).toBe(201);
    // The DTO is stated by the handler and not passed through from the row,
    // because the two branches (a first append and a supersession) RETURN
    // different column sets and the wire contract must not depend on which ran.
    expect(Object.keys(body.confirmation).sort()).toEqual(["created_at", "id", "outcome"]);
    expect(body.confirmation["id"]).toBe("c-1");
  });

  it("refuses a one-tap against a contradicting re-rank with a CODE, not a sentence (040 F3)", async () => {
    const p = apiPool((text) =>
      text.includes("FROM llm_rerank")
        ? {
            rows: [
              {
                id: "r-1",
                band: "medium",
                contradiction: true,
                response: { contradiction_reasons: ["barcode says 181, cover says 180"] },
              },
            ],
          }
        : undefined
    );
    const err = await api
      .confirm(deps(p.pool), ctx("/confirm"), { issue: { title: "Hulk" }, source: "one_tap" })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "CONTRADICTION_BLOCKS_ONE_TAP", status: 409 });
    // The structured reasons `checkEvidenceContradiction` already computed, and
    // already stored on `llm_rerank.response`: evidence about the BOOK, never
    // prose about the person (042 §4.6).
    expect((err as { details: { reasons: string[] } }).details.reasons).toEqual([
      "barcode says 181, cover says 180",
    ]);
    // And it refuses INSIDE the transaction, so nothing it wrote survives.
    expect(heads(p)).toContain("ROLLBACK");
  });

  it("refuses a one-tap on a NON-high band with no contradiction (E06-D01, 040 v1.3.0 F3)", async () => {
    // The 046 R-3 shape: the model claimed 0.99 with no readable evidence, the
    // server derived `low`, and the contradiction gate — which only fires on a
    // NON-NULL evidence field — stayed silent. A refusal keyed on `contradiction`
    // would have waved this through.
    const p = apiPool((text) =>
      text.includes("FROM llm_rerank")
        ? { rows: [{ id: "r-1", band: "low", contradiction: false, response: {} }] }
        : undefined
    );
    const err = await api
      .confirm(deps(p.pool), ctx("/confirm"), { issue: { title: "Hulk" }, source: "one_tap" })
      .catch((e: unknown) => e);
    // A SIBLING code, not the contradiction one: 021 C3 says "the barcode and the
    // cover don't agree", and here they did not disagree — we could not read
    // enough of the cover to be sure. The wrong sentence is worse than none.
    expect(err).toMatchObject({ code: "ONE_TAP_NOT_CORROBORATED", status: 409 });
    expect((err as { details: { band: string } }).details.band).toBe("low");
    expect(heads(p)).toContain("ROLLBACK");
  });

  it("refuses a one-tap when the session has NO re-rank at all", async () => {
    const p = apiPool((text) => (text.includes("FROM llm_rerank") ? { rows: [] } : undefined));
    const err = await api
      .confirm(deps(p.pool), ctx("/confirm"), { issue: { title: "Hulk" }, source: "one_tap" })
      .catch((e: unknown) => e);
    // Absent is not `high`. Nothing corroborated anything, so there is nothing
    // for a one-tap to be a shortcut THROUGH.
    expect(err).toMatchObject({ code: "ONE_TAP_NOT_CORROBORATED", status: 409 });
    expect((err as { details: { band: string | null } }).details.band).toBeNull();
  });

  it("lets a one-tap through on a high band — the guard is a guard, not an outage", async () => {
    const p = apiPool((text) =>
      text.includes("FROM llm_rerank")
        ? { rows: [{ id: "r-1", band: "high", contradiction: false, response: {} }] }
        : undefined
    );
    await expect(
      api.confirm(deps(p.pool), ctx("/confirm"), { issue: { title: "Hulk" }, source: "one_tap" })
    ).resolves.toMatchObject({ status: 201 });
  });

  it("lets a grid pick through on the same contradicting re-rank", async () => {
    const p = apiPool((text) =>
      text.includes("FROM llm_rerank")
        ? { rows: [{ id: "r-1", band: "medium", contradiction: true, response: {} }] }
        : undefined
    );
    // 040 F3 forbids the ONE-TAP, not the confirmation: the forced pick is the
    // product answer, and refusing it would strand the operator.
    await expect(
      api.confirm(deps(p.pool), ctx("/confirm"), { issue: { title: "Hulk" }, source: "grid_pick" })
    ).resolves.toMatchObject({ status: 201 });
  });
});

describe("assessCondition", () => {
  it("refuses an inverted range before it opens a transaction", async () => {
    const p = apiPool();
    await expect(
      api.assessCondition(deps(p.pool), ctx("/condition"), {
        grade_range_low: "VF",
        grade_range_high: "GD",
        defects: [],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    // As above: the validation refusal precedes the request transaction, which is
    // the property. The scoped session read is a transaction of its own (E03-B04).
    expect(tookTheWriteTransaction(p)).toBe(false);
  });

  it("appends and returns the assessment DTO", async () => {
    const p = apiPool();
    const out = await api.assessCondition(deps(p.pool), ctx("/condition"), {
      grade_range_low: "FN",
      grade_range_high: "VF",
      defects: ["spine_ticks"],
    });
    expect(out).toMatchObject({ status: 201, body: { assessment: { id: "a-1", created_at: "t" } } });
  });
});

describe("price", () => {
  it("refuses a shop with no pricing policy, and calls no provider", async () => {
    const p = apiPool((text) => (text.includes("shop_pricing_policy") ? { rows: [] } : undefined));
    await expect(
      api.price(deps(p.pool), ctx("/price"), { title: "Amazing Spider-Man" })
    ).rejects.toMatchObject({ code: "SHOP_HAS_NO_PRICING_POLICY", status: 409 });
  });

  it("fetches OUTSIDE the transaction and records INSIDE it (041 §4.1)", async () => {
    const p = apiPool((text) =>
      text.includes("shop_pricing_policy")
        ? { rows: [{ id: "p-1", comp_percent: 90, floor_cents: 300, rounding_rule: "nearest_99" }] }
        : undefined
    );
    const out = await api.price(deps(p.pool), ctx("/price"), { title: "Amazing Spider-Man" });
    expect(out.status).toBe(201);
    // Both stub providers run and each writes its own snapshot row — inside the
    // one transaction that also carries the idempotency record.
    const inserts = (writeClient(p)?.calls ?? []).filter((c) =>
      c.text.includes("INSERT INTO pricing_snapshot")
    );
    expect(inserts).toHaveLength(2);
    expect((out.body as { stub: boolean }).stub).toBe(true);
  });
});

describe("requestDraft", () => {
  it("gates on the CURRENT confirmation and pricing, never on the newest row (041 I8)", async () => {
    const p = apiPool((text) => (isWitnessQuery(text) ? { rows: [{ ...noWitness }] } : undefined));
    await expect(api.requestDraft(deps(p.pool), ctx("/draft"), {})).rejects.toMatchObject({
      code: "SESSION_HAS_NO_CONFIRMATION",
    });
    const gate = p.calls.find((c) => isWitnessQuery(c.text))!;
    for (const view of ["human_confirmation_current", "pricing_snapshot_current"]) {
      expect(gate.text).toContain(view);
    }
  });

  it("refuses a session with a confirmation and no price", async () => {
    const p = apiPool((text) =>
      isWitnessQuery(text) ? { rows: [{ ...noWitness, confirmed: "c-1" }] } : undefined
    );
    await expect(api.requestDraft(deps(p.pool), ctx("/draft"), {})).rejects.toMatchObject({
      code: "SESSION_HAS_NO_PRICING",
    });
  });

  it("owes the effect: 202 with the outbox id, and no Shopify call in the request", async () => {
    const p = apiPool((text) =>
      text.includes("INSERT INTO outbox") ? { rows: [{ id: "o-1", already: false }] } : undefined
    );
    const out = await api.requestDraft(deps(p.pool), ctx("/draft"), {});
    expect(out.status).toBe(202);
    expect((out.body as { status: string }).status).toBe("accepted");
  });
});

// The metered class only. A vision call is somebody else's HTTP server, and the
// provider seam has its own transport tests (`tests/contract/llm-provider…`);
// what belongs here is the ONE path that reaches no provider at all.
describe("identify — the metered fallback (042 §8.3)", () => {
  function identifyPool(): FakeTxPool {
    let cs = 0;
    return apiPool((text) => {
      if (text.includes("shop_credentials"))
        return { rows: [{ kind: "anthropic", key_ref: "X", base_url: null }] };
      if (text.includes("FROM scan_photo")) {
        return { rows: [{ id: "p-1", kind: "cover", storage_url: "tests/.tmp-unused/cover.jpg" }] };
      }
      if (text.includes("INSERT INTO candidate_set")) return { rows: [{ id: `cs-${++cs}` }] };
      if (text.includes("INSERT INTO llm_rerank")) return { rows: [{ id: "rr-1" }] };
      return undefined;
    });
  }

  it("degrades to the MANUAL PATH when the metered budget is spent, never to an error (042 §8.3)", async () => {
    const p = identifyPool();
    const limiter = new ShopRateLimiter({ meteredPerDay: 0 });
    const out = await api.identify(deps(p.pool, limiter), ctx("/identify"), {} as never);
    // 019 K4: "the pipeline never blocks on a provider", and a throttle we impose
    // on ourselves is a provider outage we caused — so it degrades exactly as a
    // provider failure degrades, through a path that already exists.
    expect(out.status).toBe(200);
    expect((out.body as { manual_path: boolean }).manual_path).toBe(true);
    expect((out.body as { band: string }).band).toBe("low");
    expect(limiter.events.meteredExhausted).toBe(1);
    // Nothing was spent: no vision candidate set, no rerank, no cost row.
    expect(p.calls.some((c) => c.text.includes("INSERT INTO llm_rerank"))).toBe(false);
    expect(p.calls.some((c) => c.text.includes("INSERT INTO cost_log"))).toBe(false);
  });

  it("recognises a REPLAY before it resolves a provider or spends a metered unit", async () => {
    // The ordering this asserts is the whole reason `replayIfSettled` is exported.
    // `runIdempotent` pre-reads too, but only AFTER the caller's non-transactional
    // work — and here that work is a paid model call. A retry over the counter's
    // bad Wi-Fi would otherwise buy a second call to answer with the first call's
    // stored response, which is 042 §5.3's "cheapest possible rejection path"
    // read as an optimisation instead of as a rule about money.
    let providerLookups = 0;
    const stored = { candidate_set_ids: ["cs-1"], llm_rerank_id: "rr-1", band: "high" };
    const p = apiPool((text) => {
      // BOTH halves of the credential read are counted: after E03-B05 the
      // resolver asks the version table first, so counting only the legacy table
      // would let a lookup slip past this assertion.
      if (text.includes("FROM shop_credential_version v")) {
        providerLookups += 1;
        return { rows: [] };
      }
      if (text.includes("shop_credentials")) {
        providerLookups += 1;
        return { rows: [{ kind: "anthropic", key_ref: "X", base_url: null }] };
      }
      if (text.includes("SELECT request_hash")) {
        // The hash the handler will compute for this exact call. Matching it is
        // what makes the row a REPLAY rather than a 422.
        return {
          rows: [
            {
              request_hash: requestHash({
                method: "POST",
                route: "/identify",
                params: { shopId: SHOP, id: SESSION },
                body: { barcode_digits: null, against: undefined },
              }),
              response_status: 200,
              response_body: JSON.stringify(stored),
            },
          ],
        };
      }
      return undefined;
    });
    const limiter = new ShopRateLimiter();
    const out = await api.identify(deps(p.pool, limiter), ctx("/identify"), {} as never);

    expect(out).toMatchObject({ status: 200, body: stored, replayed: true });
    expect(providerLookups).toBe(0);
    // The budget is untouched: a replay is not a second act, so it is not a
    // second unit of a shop's daily spend.
    expect(limiter.takeMetered(SHOP).allowed).toBe(true);
    // The replay pre-read runs in a scoped transaction of its own (E03-B04), so
    // the property is that NO request transaction was opened — no idempotency row,
    // no lock — rather than that no connection was checked out.
    expect(tookTheWriteTransaction(p)).toBe(false);
  });

  it("turns an identify that cannot answer into a 502 CODE, not a success body (042 E10)", async () => {
    // `routes:192` returned an `IdentifyOutcome` with an `error` string INSIDE it,
    // beside `confidence`, `provider`, `model` and `costUsd` — a 502 whose body
    // was the success shape with a field renamed, and the only shape in the API a
    // client could branch on was the one no handler composed.
    //
    // The failure driven here is the no-photos one, because it is deterministic
    // and needs no network: the provider-TRANSPORT half is `tests/identify.test.ts`
    // ("surfaces provider transport failures without inserting a vision set").
    // Both arrive at the same place, which is the point of a registry.
    // E03-D01: the credential row names a variable in THIS shop's namespace, and
    // the `shop` row supplies the slug the resolver derives it from. The fixture
    // used to name `ANTHROPIC_API_KEY` directly, which is now a refusal rather
    // than a resolution — a different failure from the one this test is about.
    process.env["LONGBOX_TESTSHOP_ANTHROPIC_KEY"] = "test-key-not-a-real-one";
    const fetchSpy = vi.fn(async () => fakeResponse(500, { error: { message: "upstream exploded" } }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const p = apiPool((text) => {
        // E03-B05 (050 §4): the resolver reads the VERSION table, and a version
        // with no retirement is what "live" means. `shop_credentials` stays in
        // the fixture because `base_url` is still read from it.
        if (text.includes("FROM shop_credential_version v")) {
          return {
            rows: [
              {
                id: "ver-1",
                kind: "anthropic",
                key_ref: "LONGBOX_TESTSHOP_ANTHROPIC_KEY",
                version_no: 1,
                introduced_at: new Date("2026-09-01T00:00:00Z"),
                retired: false,
              },
            ],
          };
        }
        if (text.includes("shop_credentials")) {
          return { rows: [{ kind: "anthropic", key_ref: "LONGBOX_TESTSHOP_ANTHROPIC_KEY", base_url: null }] };
        }
        if (text.includes("FROM shop ")) return { rows: [{ slug: "testshop" }] };
        if (text.includes("FROM scan_photo")) return { rows: [] };
        return undefined;
      });
      const err = await api.identify(deps(p.pool), ctx("/identify"), {} as never).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "IDENTIFY_FAILED", status: 502 });
      // Whatever went wrong, the caller gets the REGISTRY's sentence and never a
      // bespoke one — so a provider's exception text cannot ride out on this path
      // (042 E10, §4.3), and there is nothing here for a client to parse.
      expect((err as Error).message).toBe(MESSAGES.IDENTIFY_FAILED);
      expect((err as { details: unknown }).details).toEqual({});
      // It refused INSIDE the transaction, so anything the call did write — a
      // barcode candidate_set, say — goes back with it, and the retry is a fresh
      // act under a fresh key.
      expect(writeClient(p)!.calls.map((c) => c.text)).toContain("ROLLBACK");
      // 502 is retryable and operator-renderable: the screen's next move is the
      // manual-search path, not an apology.
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      delete process.env["LONGBOX_TESTSHOP_ANTHROPIC_KEY"];
    }
  });
});

describe("getSessionDetail", () => {
  it("projects every event table onto its declared DTO and derives the state", async () => {
    const p = fakeTxPool((text) => {
      if (text.includes("FROM scan_session WHERE id")) {
        return { rows: [{ id: SESSION, shop_id: SHOP, created_at: "t" }] };
      }
      if (isWitnessQuery(text)) return { rows: [{ ...noWitness, captured: "p-1", confirmed: "c-1" }] };
      if (text.includes("FROM scan_session_transition")) return { rows: [] };
      if (text.includes("FROM human_confirmation WHERE")) {
        return {
          rows: [
            {
              id: "c-1",
              confirmed_issue: { title: "Hulk" },
              source: "one_tap",
              outcome: "confirm",
              supersedes_id: null,
              created_at: "t",
              // The columns a star projection would have published:
              confirmed_by: "employee",
              authored_by: "human",
              session_seq: 3,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const detail = await api.getSessionDetail(deps(p.pool), SHOP, SESSION);
    expect(detail.session).toEqual({ id: SESSION, shop_id: SHOP, created_at: "t" });
    expect(detail.state).toBe("confirmed");
    // 042 §3.3: a response body may contain no key its DTO does not declare —
    // and E16 is why that is a CLASS and not an instance.
    expect(Object.keys(detail.events.human_confirmation[0]!).sort()).toEqual(
      ["confirmed_issue", "created_at", "id", "outcome", "source", "supersedes_id"].sort()
    );
  });

  it("refuses a session that is not this shop's with SESSION_NOT_FOUND", async () => {
    const p = fakeTxPool(() => ({ rows: [] }));
    await expect(api.getSessionDetail(deps(p.pool), SHOP, SESSION)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
      status: 404,
    });
  });
});
