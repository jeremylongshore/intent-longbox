// BYOK provider resolution precedence (R18): gateway override > shop credential
// > global env DEFAULT; raw keys resolved from env NAMES, never the database.
//
// E03-D01 (bead longbox-e5b.3.11) rewrote two rules this file used to assert:
//   * a key_ref is resolved WITHIN ITS SHOP'S NAMESPACE or refused — the rule
//     itself lives in tests/contract/credential-namespace.test.ts;
//   * the global env vars are the default for a shop with NO credential row, and
//     are NEVER substituted for a shop whose row does not resolve. The old
//     "falls back to the global env var" cases encoded exactly that silent
//     substitution, and the refusals that replaced them are below.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadShopCredential,
  resolveEbayCredentials,
  resolveShopToken,
  resolveVisionProvider,
} from "../src/providers/registry.js";
import { resolveKeyRef, setCredentialRefusalSink } from "../src/providers/credentialPolicy.js";
import { fakePool } from "./fakes.js";

const PROVIDER_ENV = [
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "LONGBOX_TESTSHOP_ANTHROPIC_KEY",
  "LONGBOX_TESTSHOP_OPENAI_KEY",
  "LONGBOX_TESTSHOP_EBAY_KEY",
  "LONGBOX_TESTSHOP_EBAY_KEY_SECRET",
  "LONGBOX_TESTSHOP_PRICECHARTING_KEY",
  "LONGBOX_OTHERSHOP_ANTHROPIC_KEY",
  "PRICECHARTING_TOKEN",
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_BASE_URL",
];

let restoreSink: (e: unknown) => void;

beforeEach(() => {
  // Empty string reads as unset (envOr/resolveKeyRef treat "" as absent).
  for (const name of PROVIDER_ENV) vi.stubEnv(name, "");
  // The refusal detector writes to stderr by default. Silenced here so the
  // refusal cases below do not print; its CONTENT is asserted where it belongs,
  // in tests/contract/credential-namespace.test.ts.
  restoreSink = setCredentialRefusalSink(() => undefined) as unknown as (e: unknown) => void;
});
afterEach(() => {
  setCredentialRefusalSink(restoreSink as never);
  vi.unstubAllEnvs();
});

/** The shop the fake pool describes. Its slug is the namespace every key_ref
 *  below has to carry — and the resolver reads it from the `shop` row, never
 *  from the caller, because a caller-supplied namespace is one the caller picks. */
const SLUG = "testshop";

function credPool(
  rows: Array<{ kind: string; key_ref: string; base_url: string | null }>,
  slug: string | undefined = SLUG
) {
  return fakePool((text, values) => {
    if (text.includes("FROM shop_credentials")) {
      const kind = values?.[1];
      return { rows: rows.filter((r) => r.kind === kind).slice(0, 1) };
    }
    if (text.includes("FROM shop ")) {
      return { rows: slug === undefined ? [] : [{ slug }] };
    }
    return undefined;
  });
}

describe("resolveKeyRef", () => {
  it("resolves a name in the shop's namespace and treats empty/unset as unset", () => {
    vi.stubEnv("LONGBOX_TESTSHOP_ANTHROPIC_KEY", "sk-test-123");
    expect(resolveKeyRef("LONGBOX_TESTSHOP_ANTHROPIC_KEY", SLUG)).toEqual({
      ok: true,
      value: "sk-test-123",
    });
    expect(resolveKeyRef("LONGBOX_TESTSHOP_SHOPIFY_KEY", SLUG)).toEqual({ ok: false, reason: "unset" });
    vi.stubEnv("LONGBOX_TESTSHOP_ANTHROPIC_KEY", "");
    expect(resolveKeyRef("LONGBOX_TESTSHOP_ANTHROPIC_KEY", SLUG)).toEqual({ ok: false, reason: "unset" });
  });
});

describe("loadShopCredential", () => {
  it("selects the newest credential row for the shop + kind", async () => {
    const { pool, calls } = credPool([
      { kind: "anthropic", key_ref: "LONGBOX_TESTSHOP_ANTHROPIC_KEY", base_url: null },
    ]);
    const row = await loadShopCredential(pool, "shop-1", "anthropic");
    expect(row?.key_ref).toBe("LONGBOX_TESTSHOP_ANTHROPIC_KEY");
    expect(calls[0]?.text).toMatch(/ORDER BY created_at DESC LIMIT 1/);
    expect(calls[0]?.values).toEqual(["shop-1", "anthropic"]);
  });
});

describe("resolveVisionProvider precedence", () => {
  it("1: the LLM_BASE_URL + LLM_API_KEY gateway override wins outright", async () => {
    vi.stubEnv("LLM_BASE_URL", "https://gw.example.com/v1");
    vi.stubEnv("LLM_API_KEY", "gw-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "should-lose");
    const { pool, calls } = credPool([]);
    const provider = await resolveVisionProvider(pool, "shop-1");
    expect(provider.id).toBe("openai-compat"); // gateways speak the OpenAI dialect
    expect(provider.model).toBe("claude-sonnet-5"); // default model
    expect(calls).toHaveLength(0); // never even asks the database
  });

  it("2: a shop anthropic credential row resolves via its env key_ref", async () => {
    vi.stubEnv("LONGBOX_TESTSHOP_ANTHROPIC_KEY", "sk-shop");
    const { pool } = credPool([
      { kind: "anthropic", key_ref: "LONGBOX_TESTSHOP_ANTHROPIC_KEY", base_url: null },
    ]);
    const provider = await resolveVisionProvider(pool, "shop-1");
    expect(provider.id).toBe("anthropic");
  });

  it("2b: an unset anthropic row still falls through to a RESOLVING openai_compat row", async () => {
    vi.stubEnv("LONGBOX_TESTSHOP_OPENAI_KEY", "sk-shop");
    const { pool } = credPool([
      { kind: "anthropic", key_ref: "LONGBOX_TESTSHOP_ANTHROPIC_KEY", base_url: null },
      {
        kind: "openai_compat",
        key_ref: "LONGBOX_TESTSHOP_OPENAI_KEY",
        base_url: "https://api.openai.com/v1",
      },
    ]);
    const provider = await resolveVisionProvider(pool, "shop-1");
    expect(provider.id).toBe("openai-compat");
    expect(provider.model).toBe("gpt-4o");
  });

  it("2c: THE FALLBACK IS GONE — a declared-but-unset row refuses instead of borrowing the global key", async () => {
    // The case E03-D01 exists for. Before it, this resolved to `sk-global` and
    // the shop silently spent the estate's credential (046 §5 A7).
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-global");
    const { pool } = credPool([
      { kind: "anthropic", key_ref: "LONGBOX_TESTSHOP_ANTHROPIC_KEY", base_url: null },
    ]);
    await expect(resolveVisionProvider(pool, "shop-1")).rejects.toThrow(/not a substitute for a shop/);
  });

  it("2d: a row naming ANOTHER SHOP'S set variable is refused, not resolved", async () => {
    vi.stubEnv("LONGBOX_OTHERSHOP_ANTHROPIC_KEY", "sk-other-shop");
    const { pool } = credPool([
      { kind: "anthropic", key_ref: "LONGBOX_OTHERSHOP_ANTHROPIC_KEY", base_url: null },
    ]);
    await expect(resolveVisionProvider(pool, "shop-1")).rejects.toThrow(/outside this shop's namespace/);
  });

  it("2e: THE HOSTILE ROW — a global key_ref pointed at an attacker host is refused at both halves", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-the-estate-key");
    const { pool } = credPool([
      { kind: "anthropic", key_ref: "ANTHROPIC_API_KEY", base_url: "https://attacker.example" },
    ]);
    // The key_ref half refuses first, so the value is never read at all.
    await expect(resolveVisionProvider(pool, "shop-1")).rejects.toThrow(
      /not a LONGBOX_<SLUG>_<PROVIDER>_KEY name/
    );
    // …and the host half refuses on its own, with a perfectly good key_ref.
    vi.stubEnv("LONGBOX_TESTSHOP_ANTHROPIC_KEY", "sk-shop");
    const hostile = credPool([
      {
        kind: "anthropic",
        key_ref: "LONGBOX_TESTSHOP_ANTHROPIC_KEY",
        base_url: "https://attacker.example",
      },
    ]);
    await expect(resolveVisionProvider(hostile.pool, "shop-1")).rejects.toThrow(
      /not a registered provider host/
    );
  });

  it("3: uses the global ANTHROPIC_API_KEY for a shop with NO credential row", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-global");
    const { pool } = credPool([]);
    const provider = await resolveVisionProvider(pool, "shop-1");
    expect(provider.id).toBe("anthropic");
  });

  it("3b: then the global OPENAI_API_KEY", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-oai");
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    const { pool } = credPool([]);
    const provider = await resolveVisionProvider(pool, "shop-1");
    expect(provider.id).toBe("openai-compat");
    expect(provider.model).toBe("gpt-4o-mini");
  });

  it("throws a clear error when nothing is configured", async () => {
    const { pool } = credPool([]);
    await expect(resolveVisionProvider(pool, "shop-1")).rejects.toThrow(/no vision provider configured/);
  });
});

describe("resolveShopToken", () => {
  it("prefers the shop credential's key_ref over the global env var", async () => {
    vi.stubEnv("LONGBOX_TESTSHOP_PRICECHARTING_KEY", "shop-token");
    vi.stubEnv("PRICECHARTING_TOKEN", "global-token");
    const { pool } = credPool([
      { kind: "pricecharting", key_ref: "LONGBOX_TESTSHOP_PRICECHARTING_KEY", base_url: null },
    ]);
    expect(await resolveShopToken(pool, "shop-1", "pricecharting", "PRICECHARTING_TOKEN")).toBe("shop-token");
  });

  it("a declared-but-unset row STUBS rather than borrowing the global token (E03-D01)", async () => {
    vi.stubEnv("PRICECHARTING_TOKEN", "global-token");
    const { pool } = credPool([
      { kind: "pricecharting", key_ref: "LONGBOX_TESTSHOP_PRICECHARTING_KEY", base_url: null },
    ]);
    // `undefined` is the stub path every external client already has: the
    // pipeline never blocks on a missing token, and it never spends another
    // party's either.
    expect(await resolveShopToken(pool, "shop-1", "pricecharting", "PRICECHARTING_TOKEN")).toBeUndefined();
  });

  it("uses the global env var for a shop with NO row, and undefined when neither exists", async () => {
    vi.stubEnv("PRICECHARTING_TOKEN", "global-token");
    const { pool } = credPool([]);
    expect(await resolveShopToken(pool, "shop-1", "pricecharting", "PRICECHARTING_TOKEN")).toBe(
      "global-token"
    );
    vi.stubEnv("PRICECHARTING_TOKEN", "");
    expect(await resolveShopToken(pool, "shop-1", "pricecharting", "PRICECHARTING_TOKEN")).toBeUndefined();
  });
});

describe("resolveEbayCredentials", () => {
  it("prefers the shop credential pair (key_ref = client-id var, `${key_ref}_SECRET`)", async () => {
    vi.stubEnv("LONGBOX_TESTSHOP_EBAY_KEY", "shop-client-id");
    vi.stubEnv("LONGBOX_TESTSHOP_EBAY_KEY_SECRET", "shop-client-secret");
    vi.stubEnv("EBAY_CLIENT_ID", "global-id");
    vi.stubEnv("EBAY_CLIENT_SECRET", "global-secret");
    const { pool } = credPool([
      { kind: "ebay", key_ref: "LONGBOX_TESTSHOP_EBAY_KEY", base_url: "https://api.sandbox.ebay.com" },
    ]);
    expect(await resolveEbayCredentials(pool, "shop-1")).toEqual({
      clientId: "shop-client-id",
      clientSecret: "shop-client-secret",
      baseUrl: "https://api.sandbox.ebay.com",
    });
  });

  it("an incomplete shop pair STUBS rather than falling back to the global pair (E03-D01)", async () => {
    vi.stubEnv("LONGBOX_TESTSHOP_EBAY_KEY", "shop-client-id"); // secret missing → incomplete pair
    vi.stubEnv("EBAY_CLIENT_ID", "global-id");
    vi.stubEnv("EBAY_CLIENT_SECRET", "global-secret");
    const { pool } = credPool([{ kind: "ebay", key_ref: "LONGBOX_TESTSHOP_EBAY_KEY", base_url: null }]);
    expect(await resolveEbayCredentials(pool, "shop-1")).toBeUndefined();
  });

  it("undefined when neither shop nor global creds exist (stub provider engages)", async () => {
    const { pool } = credPool([]);
    expect(await resolveEbayCredentials(pool, "shop-1")).toBeUndefined();
  });
});
