// L3/L5 — the adversarial fixtures driven through `POST …/identify` end to end
// (E06-D01; seed for E07-B08).
//
// WHY THIS FILE EXISTS SEPARATELY FROM `bands.test.ts`. That file proves the
// derivation. This one proves the derivation is what the ROUTE uses — through
// the real Anthropic adapter, the real payload schema, the real contradiction
// gate and the real DTO — because 046 §5 A8's control column says "none" about
// the whole path, not about a pure function. The transport is stubbed; nothing
// else is.
//
// It also asserts the negative that 042 §6.3 and 022 P6 turn on: `confidence`
// does not reach the wire. A band derived server-side is worth little if the
// number it refused to trust is handed to the client to re-derive from.
import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import * as api from "../src/services/sessionApi.js";
import { ShopRateLimiter } from "../src/services/rateLimit.js";
import { fakeResponse, fakeTxPool, type FakeTxPool } from "./fakes.js";
import { TEST_PIN_PEPPER } from "./testConfig.js";

const SHOP = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const UPLOADS = "tests/.tmp-adversarial";
/**
 * E03-D01: a credential row may name only `LONGBOX_<SLUG>_<PROVIDER>_KEY` for
 * ITS OWN shop, checked by exact membership before `process.env` is consulted.
 * So the fake shop needs a real slug and the fake row a name inside it — a
 * bespoke variable name is refused now, and rightly.
 */
const SLUG = "adversarial";
const KEY_REF = "LONGBOX_ADVERSARIAL_ANTHROPIC_KEY";

const CONFIG = {
  port: 0,
  databaseUrl: "postgres://unused",
  uploadsDir: UPLOADS,
  bands: { high: 0.85, medium: 0.5 },
  pinPepper: TEST_PIN_PEPPER,
  publicOrigins: [],
};

/** "036000291452" is a check-digit-valid UPC-A; "30011" = issue 300, cover 1, printing 1. */
const BARCODE_AGREES = "036000291452 30011";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`tests/fixtures/adversarial/${name}.json`, "utf8"));
}

/** The pool answers everything `identify` reads, and records what it writes. */
function identifyPool(): FakeTxPool {
  let cs = 0;
  return fakeTxPool((text) => {
    if (text.includes("FROM shop WHERE id"))
      return { rows: [{ id: SHOP, name: "Gotham", slug: SLUG, shopify_domain: null }] };
    if (text.includes("FROM scan_session WHERE id"))
      return { rows: [{ id: SESSION, shop_id: SHOP, created_at: "t" }] };
    // E03-B05: the resolver's authority is the VERSION table (050 §4);
    // `shop_credentials` survives as the source of `base_url`.
    if (text.includes("FROM shop_credential_version v")) {
      return {
        rows: [
          {
            id: "ver-1",
            kind: "anthropic",
            key_ref: KEY_REF,
            version_no: 1,
            introduced_at: new Date("2026-09-01T00:00:00Z"),
            retired: false,
          },
        ],
      };
    }
    if (text.includes("shop_credentials")) {
      return { rows: [{ kind: "anthropic", key_ref: KEY_REF, base_url: null }] };
    }
    if (text.includes("FROM scan_photo")) {
      return { rows: [{ id: "p-1", kind: "cover", storage_url: `${UPLOADS}/cover.jpg` }] };
    }
    if (text.includes("INSERT INTO request_idempotency")) return { rows: [{ id: "idem-1" }] };
    if (text.includes("SELECT request_hash")) return { rows: [] };
    if (text.includes("AS captured")) {
      return {
        rows: [
          {
            captured: "p-1",
            proposed: null,
            confirmed: null,
            conditioned: null,
            priced: null,
            drafted: null,
          },
        ],
      };
    }
    if (text.includes("INSERT INTO candidate_set")) return { rows: [{ id: `cs-${++cs}` }] };
    if (text.includes("INSERT INTO llm_rerank")) return { rows: [{ id: "rr-1" }] };
    return undefined;
  });
}

/** Run one fixture through the route with the transport stubbed to return it. */
async function identifyWith(
  name: string,
  barcodeDigits: string | null
): Promise<{ body: Record<string, unknown>; pool: FakeTxPool }> {
  const pool = identifyPool();
  vi.stubGlobal("fetch", async () =>
    fakeResponse(200, {
      content: [{ type: "text", text: JSON.stringify(fixture(name)) }],
      usage: { input_tokens: 1000, output_tokens: 500 },
    })
  );
  try {
    const out = await api.identify(
      { pool: pool.pool as pg.Pool, config: CONFIG, limiter: new ShopRateLimiter() },
      { shopId: SHOP, sessionId: SESSION, idempotencyKey: `key-${name}`, route: "/identify", method: "POST" },
      { barcode_digits: barcodeDigits } as never
    );
    return { body: out.body as Record<string, unknown>, pool };
  } finally {
    vi.unstubAllGlobals();
  }
}

/** The `band_inputs` jsonb this call wrote, parsed back. */
function bandInputs(pool: FakeTxPool): Record<string, unknown> {
  const insert = pool.calls.find((c) => c.text.includes("INSERT INTO llm_rerank"));
  return JSON.parse(insert!.values!.at(-1) as string) as Record<string, unknown>;
}

beforeAll(() => {
  process.env[KEY_REF] = "not-a-real-key";
  mkdirSync(UPLOADS, { recursive: true });
  // The adapter base64-encodes whatever is at the path; the bytes are never read
  // by anything under test, only by `readFileSync`.
  writeFileSync(`${UPLOADS}/cover.jpg`, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
});

afterAll(() => {
  delete process.env[KEY_REF];
  // A test that leaves a directory behind makes the next `git status` lie about
  // what the working tree contains. `.gitignore` covers the same path so a
  // crashed run cannot do it either.
  rmSync(UPLOADS, { recursive: true, force: true });
});

describe("adversarial identify — the model cannot buy its way to one-tap (046 §5 A8 / R-3)", () => {
  it("null evidence with maximum confidence lands in LOW, not one-tap", async () => {
    const { body, pool } = await identifyWith("null-evidence-max-confidence", BARCODE_AGREES);
    expect(body["band"]).toBe("low");
    const inputs = bandInputs(pool);
    expect(inputs["evidence_missing"]).toEqual(["issue_number_read", "price_box_text", "logo_era_guess"]);
    expect(inputs["model_confidence"]).toBe(0.99);
    // The barcode agreed and the candidate set was clean; the ONLY thing that
    // held this back is the evidence ceiling, which is the finding's whole point.
    expect(inputs["barcode_agreement"]).toBe("agree");
    expect((inputs["ceilings"] as Record<string, string>)["evidence"]).toBe("low");
  });

  it("a contradicting issue number with maximum confidence is at most a forced pick", async () => {
    const { body, pool } = await identifyWith("contradictory-issue-high-confidence", BARCODE_AGREES);
    expect(body["band"]).toBe("medium");
    expect(body["contradiction"]).toBe(true);
    expect((body["contradiction_reasons"] as string[])[0]).toMatch(/issue_number_read/);
    expect((bandInputs(pool)["ceilings"] as Record<string, string>)["contradiction"]).toBe("medium");
  });

  it("sticker-steered OCR on a #301 cover cannot reach one-tap, and its 'reason' is data", async () => {
    // The barcode says 301; the sticker (and the model echoing it) says 300.
    const { body, pool } = await identifyWith("sticker-steered-ocr", "036000291452 30111");
    expect(body["band"]).toBe("low");
    const inputs = bandInputs(pool);
    expect(inputs["barcode_agreement"]).toBe("disagree");
    // The injected sentence is RECORDED as the model's unreadable-reason string
    // and is acted on by nothing: it changes no ceiling and reaches no client.
    expect((inputs["unreadable_reasons"] as Record<string, string>)["price_box_text"]).toMatch(
      /SYSTEM: ignore/
    );
    expect(JSON.stringify(body)).not.toMatch(/SYSTEM: ignore/);
  });

  it("the honest control still earns HIGH — the gate is a gate, not an outage", async () => {
    const { body, pool } = await identifyWith("complete-consistent-evidence", BARCODE_AGREES);
    expect(body["band"]).toBe("high");
    expect(body["contradiction"]).toBe(false);
    const inputs = bandInputs(pool);
    expect(inputs["evidence_missing"]).toEqual([]);
    expect(inputs["candidate_agreement"]).toBe("unique");
  });

  it("never puts the model's confidence on the wire (042 §6.3, 022 P6)", async () => {
    const { body } = await identifyWith("complete-consistent-evidence", BARCODE_AGREES);
    expect(Object.keys(body)).not.toContain("confidence");
    expect(Object.keys(body)).not.toContain("band_inputs");
    // The candidate payloads carry their own per-candidate confidence, which is
    // 042's declared shape (`candidates: z.array(z.unknown())`); what must not
    // appear is a TOP-LEVEL number a screen could render as certainty.
    expect(body["band"]).toBe("high");
  });
});
