// **No secret value reaches any of 019 T31's six surfaces** — 050 §9 I1.
//
// Bead: longbox-e5b.3.5 (alias E03-B05), the code half. Docs: 050 §2 Q1 (the
// honest cost of the custody ruling: *the environment is flat, and nothing in
// this system prevents `console.log(process.env)` — that is answered by a
// detector, and §9 I1 is that detector*), §8's G-9 row, §9 I1/I9; 046 §5 A14,
// §7.3 (the five uncovered surfaces and the nightly cadence); 019 T31,
// NON-WAIVABLE.
//
// WHAT T31 COVERS AND WHAT CI COVERED. 019 T31 names SIX surfaces and TWO
// cadences. The repository scan (gitleaks) covers ONE surface and ONE cadence.
// The other five — **database columns, log lines, error payloads, LLM prompts,
// and the artifacts that quote them** — had no instrument at all (050 §1 E13,
// 046 §7.3). This file is the assertion for all five.
//
// ⚠ THE ASSERTION IS ON THE CANARY'S VALUE, NEVER ON A REDACTION RULE, and that
// is 050 §9 I1's own wording. A test that asserts "the redactor redacted" tests
// the redactor; a test that plants a real-shaped value in a real credential
// variable, runs the real pipeline, and then greps everything the pipeline
// touched, tests the SYSTEM. The difference is that the second one fails when
// somebody adds a new surface the redactor has never heard of.
//
// ⚠ THE NIGHTLY RUNNER IS NOT HERE (050 §9 I9, §8's G-9 row). This file is the
// ASSERTION; the nightly job that runs an equivalent sweep against a live
// deployment's logs and database, with the T34 heartbeat that makes a silent
// detector a K1, is **E13-B04's**. 046 is not self-consistent about who owns
// that (`046:341` says E03-B05 + E13-B04; §7.3's decision sentence says E03-B05
// alone) and 050 §8 records the tension rather than resolving it — so this file
// does not claim to discharge the other bead's half.
//
// THE CANARY OBEYS THE FIXTURE CONVENTION (E03-D04,
// `tests/contract/secret-fixture-convention.test.ts`): it begins `test-` and
// ends `-key`, so it can only ever live under `tests/`, and a real key can never
// hide behind the shape.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import * as api from "../../src/services/sessionApi.js";
import type { AppConfig } from "../../src/config.js";
import { ShopRateLimiter } from "../../src/services/rateLimit.js";
import { setCredentialRefusalSink } from "../../src/providers/credentialPolicy.js";
import { setCredentialOverlapSink } from "../../src/providers/credentialVersions.js";
import { buildUserText } from "../../src/providers/shared.js";
import { IDENTIFY_PROMPT } from "../../src/providers/types.js";
import { fakeResponse, fakeTxPool, type FakeTxPool, type QueryCall } from "../fakes.js";
import { open, requireAuthenticatorKey, seal } from "../../src/services/auth/aead.js";
import type { AuthenticatorKeyring } from "../../src/services/auth/aead.js";
import { enrollAuthenticator, verifyTotp } from "../../src/services/auth/index.js";
import { base32Encode, stepAt, totpCode } from "../../src/services/auth/totp.js";
import type { Queryable, Tx } from "../../src/db.js";
import { TEST_PIN_PEPPER } from "../testConfig.js";

const SHOP = "11111111-1111-1111-1111-111111111111";
const SESSION = "22222222-2222-2222-2222-222222222222";
const SLUG = "testshop";
const KEY_REF = "LONGBOX_TESTSHOP_ANTHROPIC_KEY";

/**
 * Every kind the pipeline resolves, each with the ONE legal name for this shop.
 *
 * Kind-aware on purpose: giving every kind the anthropic name would make the
 * pricing route refuse at the namespace check and stop the run three routes
 * early — a canary sweep that never reaches the draft is not the sweep 050 §9 I1
 * specifies.
 */
const KEY_REFS = {
  anthropic: KEY_REF,
  openai_compat: "LONGBOX_TESTSHOP_OPENAI_KEY",
  shopify: "LONGBOX_TESTSHOP_SHOPIFY_KEY",
  pricecharting: "LONGBOX_TESTSHOP_PRICECHARTING_KEY",
  ebay: "LONGBOX_TESTSHOP_EBAY_KEY",
} as const;

/** The planted value. Nothing in `src/` may ever reproduce it. */
const CANARY = "test-t31-planted-canary-key";

const UPLOADS = "tests/.tmp-secret-surfaces";

const CONFIG: AppConfig = {
  port: 0,
  databaseUrl: "",
  uploadsDir: UPLOADS,
  bands: { high: 0.85, medium: 0.5 },
  pinPepper: TEST_PIN_PEPPER,
  publicOrigins: [],
};

/** Everything written to a console during one run, whatever the level. */
let logLines: string[];
let restoreRefusals: () => void;
let restoreOverlaps: () => void;

/** A model answer good enough to make the run SPEND — so `cost_log` is written. */
const MODEL_ANSWER = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        candidates: [
          {
            title: "Amazing Spider-Man",
            issue: "300",
            publisher: "Marvel",
            year: 1988,
            variant: null,
            variantHints: [],
            confidence: 0.9,
          },
        ],
        evidence: {
          issue_number_read: "300",
          price_box_text: "$1.00",
          logo_era_guess: "late-80s Marvel",
          unreadable_reasons: {},
        },
        confidence: 0.9,
      }),
    },
  ],
  usage: { input_tokens: 1000, output_tokens: 500 },
};

beforeAll(() => {
  mkdirSync(UPLOADS, { recursive: true });
  writeFileSync(`${UPLOADS}/cover.jpg`, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
});
afterAll(() => rmSync(UPLOADS, { recursive: true, force: true }));

beforeEach(() => {
  logLines = [];
  // The TRANSPORT is stubbed and nothing else is (the harness `tests/fakes.ts`
  // documents the rule). A real provider call is what makes `cost_log` carry a
  // row at all, and a run that writes no cost row cannot prove the cost-row
  // surface is clean.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => fakeResponse(200, MODEL_ANSWER))
  );
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  // The two structured sinks this seam owns are routed into the SAME capture, so
  // a refusal or an overlap report is checked by the same assertion as a log
  // line — they are log lines, and giving them their own quiet path is how a
  // surface stops being covered.
  restoreRefusals = setCredentialRefusalSink((e) => logLines.push(JSON.stringify(e))) as never;
  restoreOverlaps = setCredentialOverlapSink((e) => logLines.push(JSON.stringify(e))) as never;
  vi.stubEnv(KEY_REF, CANARY);
  for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LLM_BASE_URL", "LLM_API_KEY"]) {
    vi.stubEnv(name, "");
  }
});

afterEach(() => {
  setCredentialRefusalSink(restoreRefusals as never);
  setCredentialOverlapSink(restoreOverlaps as never);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const noWitness = {
  captured: null,
  proposed: null,
  confirmed: null,
  conditioned: null,
  priced: null,
  drafted: null,
};

/** A pool that answers every read the five routes make, and records every write. */
function pipelinePool(): FakeTxPool {
  let cs = 0;
  return fakeTxPool((text, values) => {
    // FIRST, because the session-seq statement is a UNION over every
    // session-scoped table and therefore contains `FROM scan_photo` — a later
    // branch would answer it with the wrong shape.
    if (text.includes("coalesce(max(m)")) return { rows: [{ m: "2" }] };
    if (text.includes("FROM shop_credential_version v")) {
      const kind = values?.[1] as keyof typeof KEY_REFS;
      return {
        rows: [
          {
            id: `ver-${kind}`,
            kind,
            key_ref: KEY_REFS[kind],
            version_no: 1,
            introduced_at: new Date("2026-09-01T00:00:00Z"),
            retired: false,
          },
        ],
      };
    }
    if (text.includes("FROM shop_credentials")) {
      const kind = values?.[1] as keyof typeof KEY_REFS;
      return { rows: [{ kind, key_ref: KEY_REFS[kind], base_url: null }] };
    }
    if (text.includes("FROM shop WHERE id"))
      return { rows: [{ id: SHOP, name: "Gotham", slug: SLUG, shopify_domain: null }] };
    if (text.includes("FROM shop ")) return { rows: [{ slug: SLUG }] };
    if (text.includes("FROM scan_session WHERE id"))
      return { rows: [{ id: SESSION, shop_id: SHOP, created_at: "t" }] };
    if (text.includes("FROM scan_photo")) {
      return { rows: [{ id: "p-1", kind: "cover", storage_url: `${UPLOADS}/cover.jpg` }] };
    }
    if (text.includes("INSERT INTO request_idempotency")) return { rows: [{ id: "idem-1" }] };
    if (text.includes("SELECT request_hash")) return { rows: [] };
    if (text.includes("AS captured")) {
      return { rows: [{ ...noWitness, captured: "p-1", confirmed: "c-1", priced: "ps-1" }] };
    }
    if (text.includes("shop_pricing_policy")) {
      return { rows: [{ id: "p-1", comp_percent: 90, floor_cents: 300, rounding_rule: "nearest_99" }] };
    }
    if (text.includes("INSERT INTO candidate_set")) return { rows: [{ id: `cs-${++cs}` }] };
    if (text.includes("INSERT INTO llm_rerank")) return { rows: [{ id: "rr-1" }] };
    if (text.includes("INSERT INTO human_confirmation")) {
      return { rows: [{ id: "c-1", created_at: "t", outcome: "confirm" }] };
    }
    if (text.includes("INSERT INTO condition_assessment")) return { rows: [{ id: "a-1", created_at: "t" }] };
    if (text.includes("INSERT INTO pricing_snapshot")) return { rows: [{ id: "ps-1" }] };
    if (text.includes("INSERT INTO outbox")) return { rows: [{ id: "o-1" }] };
    return undefined;
  });
}

function deps(pool: pg.Pool): api.ApiDeps {
  return { pool, config: CONFIG, limiter: new ShopRateLimiter() };
}

function ctx(route: string) {
  return { shopId: SHOP, sessionId: SESSION, idempotencyKey: `key-${route}`, route, method: "POST" };
}

/** Every statement and every bound value the run produced, as one searchable list. */
function everythingWritten(p: FakeTxPool): string {
  const all: QueryCall[] = p.calls;
  return all.map((c) => `${c.text} ${JSON.stringify(c.values ?? [])}`).join("\n");
}

/**
 * Run the whole pipeline once. Each route's body — or the error it threw — is
 * collected, so the RESPONSE surface is checked on both paths.
 */
async function runPipeline(p: FakeTxPool): Promise<string> {
  const seen: unknown[] = [];
  const steps: Array<() => Promise<unknown>> = [
    () => api.identify(deps(p.pool), ctx("/identify"), {} as never),
    () =>
      api.confirm(deps(p.pool), ctx("/confirm"), {
        issue: { title: "Hulk" },
        source: "grid_pick",
      } as never),
    () =>
      api.assessCondition(deps(p.pool), ctx("/condition"), {
        grade_range: { low: "GD", high: "VG" },
        defects: ["spine_stress"],
      } as never),
    () => api.price(deps(p.pool), ctx("/price"), { title: "Amazing Spider-Man" } as never),
    () => api.requestDraft(deps(p.pool), ctx("/draft"), {} as never),
  ];
  for (const step of steps) {
    // A THROW IS A SURFACE TOO (046 §5 A14). 042's envelope is composed from a
    // keyed MESSAGES map, so a value can only reach a client here by riding in
    // `message` or `details` — which is precisely what this serialisation looks
    // at, rather than trusting that it cannot happen.
    seen.push(
      await step().catch((err: unknown) => ({
        thrown: {
          message: (err as Error).message,
          details: (err as { details?: unknown }).details,
          stack: (err as Error).stack,
        },
      }))
    );
  }
  return JSON.stringify(seen);
}

/**
 * A scripted connection for the stream-sink case: it answers the membership read,
 * remembers the id `enrollAuthenticator` minted (which is the AEAD's AAD, so the
 * test cannot seal a matching row without it), and serves the authenticator row
 * back to `verifyTotp`.
 */
function scriptedDb(): {
  db: Tx & Queryable;
  lastInsert?: string;
  rowFor?: Record<string, unknown>;
} {
  const state: { db: Tx & Queryable; lastInsert?: string; rowFor?: Record<string, unknown> } = {
    db: null as unknown as Tx & Queryable,
  };
  state.db = {
    async query(text: string, values?: unknown[]) {
      if (text.includes("FROM membership m")) return { rows: [{ role: "owner" }], rowCount: 1 };
      // A regex, not a substring: the statement wraps after the table name, and
      // `INSERT INTO user_authenticator_retirement` contains the same prefix.
      if (/INSERT INTO user_authenticator\s*\(/.test(text)) {
        state.lastInsert = values?.[0] as string;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("FROM user_authenticator a")) {
        return { rows: state.rowFor ? [state.rowFor] : [], rowCount: state.rowFor ? 1 : 0 };
      }
      if (text.includes("FROM auth_attempt")) return { rows: [{ failures: 0, age: null }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  } as unknown as Tx & Queryable;
  return state;
}

/** The row `verifyTotp` reads back, sealed under the id the INSERT actually used. */
function enrolledRow(id: string, secret: Buffer, ring: AuthenticatorKeyring): Record<string, unknown> {
  const sealed = seal(ring, secret, id);
  return {
    id,
    app_user_id: "person-1",
    kind: "totp",
    secret_ciphertext: sealed.ciphertext,
    secret_nonce: sealed.nonce,
    key_version: sealed.keyVersion,
    digits: 6,
    period_seconds: 30,
    algorithm: "SHA1",
    last_used_step: null,
    enrolled_at: new Date(),
  };
}

describe("019 T31's five uncovered surfaces, under a planted canary (050 §9 I1)", () => {
  it("runs the whole pipeline and leaks the value into NONE of them", async () => {
    const p = pipelinePool();
    const responses = await runPipeline(p);
    const written = everythingWritten(p);

    // Surface 1 — DATABASE COLUMNS. Every statement and every bound value of the
    // run, which covers `cost_log`, `llm_rerank`, `outbox`, `candidate_set` and
    // anything a future handler adds without telling this test.
    expect(written).not.toContain(CANARY);

    // Surface 2 — LOG LINES, including the two structured sinks this seam owns.
    expect(logLines.join("\n")).not.toContain(CANARY);

    // Surface 3 — ERROR PAYLOADS, and Surface 4 — RESPONSE BODIES. Both are in
    // `responses`: a route either returned a body or threw, and the thrown case
    // is serialised with its `message`, its `details` and its stack.
    expect(responses).not.toContain(CANARY);

    // The run really happened — otherwise every assertion above passes vacuously,
    // which is the failure mode a canary test is most prone to.
    expect(written).toContain("INSERT INTO request_idempotency");
    expect(written).toContain("INSERT INTO cost_log");
    expect(written).toContain("INSERT INTO human_confirmation");
    expect(written).toContain("INSERT INTO condition_assessment");
    expect(written).toContain("INSERT INTO pricing_snapshot");
    expect(written).toContain("INSERT INTO outbox");
    // …and the identify call genuinely SPENT, so the cost row it wrote is a real
    // row on the real path rather than a shape assembled by this test.
    expect(written).toContain("ver-anthropic");
    // …and the canary was genuinely reachable: the variable was set, and the
    // resolver really did read it (the cost row names the version it resolved).
    expect(process.env[KEY_REF]).toBe(CANARY);
  });

  it("surface 5 — the LLM PROMPT carries the request and never the credential", () => {
    // `buildUserText` is the only place a prompt is composed (both adapters call
    // it), so the assertion is on the function rather than on a captured HTTP
    // body: a body assertion would pass just as well if a future adapter stopped
    // going through the network at all.
    const text = buildUserText(IDENTIFY_PROMPT, {
      images: [{ base64: "AAAA", mediaType: "image/jpeg" }],
      candidates: [{ title: "Amazing Spider-Man", issue: "300" }],
    } as never);
    expect(text).not.toContain(CANARY);
    // It really did compose the re-rank half rather than returning the bare
    // prompt, which is the branch a value could conceivably ride out on.
    expect(text).toContain("Amazing Spider-Man");
  });

  // -------------------------------------------------------------------------
  // E03-D06 — the SECOND FACTOR's material, on the same five surfaces.
  //
  // 048 §11 I9 extends this file by name: `user_authenticator`'s secret column is
  // AEAD ciphertext with a per-row nonce, a `key_version` and the row id as AAD,
  // and "a canary planted in a password, a PIN, a pepper and a TOTP secret
  // appears in no log line, no error body, no `pg_dump` fixture and no test
  // output". Two of those four already have coverage (the PIN in
  // `operator-pin.test.ts`, the pepper here). These are the other two.
  //
  // The assertion is on the CANARY'S VALUE and never on a redaction rule, which
  // is this file's own discipline: what is planted is a recognisable byte string
  // INSIDE a real secret, sealed by the real function, and what is searched is
  // everything the subsystem would hand to a database, a log or an error.
  // -------------------------------------------------------------------------
  it("a TOTP secret's plaintext reaches no column, no error and no key-ring message", () => {
    const ring = requireAuthenticatorKey({
      LONGBOX_AUTHENTICATOR_KEY_V1: Buffer.alloc(32, 0x11).toString("base64"),
    });
    const planted = Buffer.from("test-totp-canary-key", "utf8");
    const rowId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const sealed = seal(ring, planted, rowId);

    // Surface 1 — the COLUMNS. These three buffers are literally what the INSERT
    // binds, so this is the database surface itself rather than a proxy for it.
    const columns = Buffer.concat([sealed.ciphertext, sealed.nonce]).toString("binary");
    expect(columns).not.toContain(planted.toString("binary"));

    // Surfaces 3 and 4 — ERRORS. Every failure this envelope can produce, with
    // its message and its stack: a wrong AAD, a wrong key, a truncated value, and
    // a missing key version. None may quote the secret OR the key.
    const key = Buffer.alloc(32, 0x11).toString("base64");
    const failures: string[] = [];
    const attempts: Array<() => unknown> = [
      () => open(ring, { ...sealed, aad: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
      () => open(ring, { ...sealed, ciphertext: Buffer.alloc(2), aad: rowId }),
      () => open(ring, { ...sealed, keyVersion: 9, aad: rowId }),
      () => requireAuthenticatorKey({ LONGBOX_AUTHENTICATOR_KEY_V1: "c2hvcnQ=" }),
      () => requireAuthenticatorKey({}),
    ];
    for (const attempt of attempts) {
      try {
        attempt();
      } catch (err) {
        failures.push(`${(err as Error).message}\n${(err as Error).stack ?? ""}`);
      }
    }
    expect(failures).toHaveLength(attempts.length);
    const errorText = failures.join("\n");
    expect(errorText).not.toContain(planted.toString("utf8"));
    expect(errorText).not.toContain(key);
    // …and they are real refusals rather than a silent pass: each named the
    // problem in the terms an operator can act on.
    expect(errorText).toContain("did not authenticate");
    expect(errorText).toContain("LONGBOX_AUTHENTICATOR_KEY_V1");
  });

  // ⚠ THE RECOVERY-CODE HALF OF THE SAME RULE IS ASSERTED IN THE INTEGRATION
  // LANE, DELIBERATELY (`tests/integration/recovery-codes.test.ts`). It needs
  // argon2id at the parameters `secrets.ts` sets, and three of those runs is four
  // seconds of one CPU — in a unit lane of seventy parallel files, adding that
  // here made two unrelated suites time out. It is not a weaker assertion: the
  // integration version reads the digests out of real rows written by the real
  // enrollment, and additionally shows the digest does NOT verify against the code
  // alone, which is the pepper doing its job.
  it("ENROLL AND VERIFY WRITE NOTHING to any stream: the plaintext secret reaches no sink", async () => {
    // ⚠ THE FINDING THIS CLOSES (invariant review of `faf105f`). A `console.log`
    // of the DECRYPTED secret planted inside `aead.open()` passed the entire unit
    // lane — 1367 of 1367 — because nothing in this file watched a stream while
    // the real enrollment and the real verification ran. 019 T31's second surface
    // is LOG LINES, and the assertion above only covers the ones the pipeline's
    // own routes emit.
    //
    // So this captures every stream a Node process can write to — the five
    // `console` methods AND `process.stdout.write` / `process.stderr.write`, which
    // is where a `console.log` actually lands and where a hand-rolled debug line
    // would go — around the two calls that hold a plaintext TOTP secret in memory.
    const planted = Buffer.from("test-enrolled-totp-canary-key", "utf8");
    const captured: string[] = [];
    const writes: Array<[NodeJS.WriteStream, NodeJS.WriteStream["write"]]> = [];
    for (const stream of [process.stdout, process.stderr]) {
      const original = stream.write.bind(stream) as NodeJS.WriteStream["write"];
      writes.push([stream, original]);
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        captured.push(typeof chunk === "string" ? chunk : String(chunk));
        return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as NodeJS.WriteStream["write"];
    }
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }

    const ring = requireAuthenticatorKey({
      LONGBOX_AUTHENTICATOR_KEY_V1: Buffer.alloc(32, 0x11).toString("base64"),
    });
    const now = new Date(1_700_000_000_000);
    const db = scriptedDb();
    try {
      const enrolled = await enrollAuthenticator(db.db, {
        appUserId: "person-1",
        secret: planted,
        confirmationCode: totpCode(planted, stepAt(now)),
        keyring: ring,
        pepper: TEST_PIN_PEPPER,
        now,
      });
      expect(enrolled.ok).toBe(true);

      const later = new Date(now.getTime() + 30_000);
      db.rowFor = enrolledRow(db.lastInsert!, planted, ring);
      expect(
        await verifyTotp(db.db, {
          appUserId: "person-1",
          code: totpCode(planted, stepAt(later)),
          keyring: ring,
          now: later,
        })
      ).toEqual({ ok: true, step: stepAt(later) });

      // THE SINK REALLY IS WATCHING. Without this the whole test passes when the
      // capture is broken, which is the failure mode a canary test is most prone
      // to — and is exactly how the planted `console.log` survived before.
      console.log("sink-probe");
      process.stdout.write("");
    } finally {
      for (const [stream, original] of writes) stream.write = original;
      vi.restoreAllMocks();
    }

    const sunk = captured.join("\n");
    expect(sunk).toContain("sink-probe");
    // Every encoding a well-meaning debug line would reach for.
    expect(sunk).not.toContain(planted.toString("utf8"));
    expect(sunk).not.toContain(planted.toString("hex"));
    expect(sunk).not.toContain(planted.toString("base64"));
    expect(sunk).not.toContain(base32Encode(planted));
  }, 30_000);

  it("the canary is shaped like a fixture credential, so the convention test governs it", () => {
    // E03-D04's rule: a value of this shape may live only under `tests/`. That
    // is what stops this file from becoming a place a real key could be planted
    // "just to check the detector".
    expect(CANARY).toMatch(/^test-[a-z0-9-]+-key$/);
  });
});
