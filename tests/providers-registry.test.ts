// BYOK provider resolution precedence (R18): gateway override > shop credential
// > global env fallback; raw keys resolved from env NAMES, never the database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadShopCredential,
  resolveKeyRef,
  resolveShopToken,
  resolveVisionProvider,
} from "../src/providers/registry.js";
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
  "SHOP_TEST_KEY",
  "PRICECHARTING_TOKEN",
];

beforeEach(() => {
  // Empty string reads as unset (envOr/resolveKeyRef treat "" as absent).
  for (const name of PROVIDER_ENV) vi.stubEnv(name, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function credPool(rows: Array<{ kind: string; key_ref: string; base_url: string | null }>) {
  return fakePool((text, values) => {
    if (text.includes("FROM shop_credentials")) {
      const kind = values?.[1];
      return { rows: rows.filter((r) => r.kind === kind).slice(0, 1) };
    }
    return undefined;
  });
}

describe("resolveKeyRef", () => {
  it("resolves a set env var and treats empty/unset as undefined", () => {
    vi.stubEnv("SHOP_TEST_KEY", "sk-test-123");
    expect(resolveKeyRef("SHOP_TEST_KEY")).toBe("sk-test-123");
    expect(resolveKeyRef("SHOP_NEVER_SET_ANYWHERE")).toBeUndefined();
    vi.stubEnv("SHOP_TEST_KEY", "");
    expect(resolveKeyRef("SHOP_TEST_KEY")).toBeUndefined();
  });
});

describe("loadShopCredential", () => {
  it("selects the newest credential row for the shop + kind", async () => {
    const { pool, calls } = credPool([{ kind: "anthropic", key_ref: "SHOP_TEST_KEY", base_url: null }]);
    const row = await loadShopCredential(pool, "shop-1", "anthropic");
    expect(row?.key_ref).toBe("SHOP_TEST_KEY");
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
    vi.stubEnv("SHOP_TEST_KEY", "sk-shop");
    const { pool } = credPool([{ kind: "anthropic", key_ref: "SHOP_TEST_KEY", base_url: null }]);
    const provider = await resolveVisionProvider(pool, "shop-1");
    expect(provider.id).toBe("anthropic");
  });

  it("2b: an unset key_ref falls through to the openai_compat credential", async () => {
    vi.stubEnv("SHOP_TEST_KEY", "sk-shop");
    const { pool } = credPool([
      { kind: "anthropic", key_ref: "SHOP_UNSET_REF", base_url: null },
      { kind: "openai_compat", key_ref: "SHOP_TEST_KEY", base_url: "https://oai.example.com/v1" },
    ]);
    const provider = await resolveVisionProvider(pool, "shop-1");
    expect(provider.id).toBe("openai-compat");
    expect(provider.model).toBe("gpt-4o");
  });

  it("3: falls back to the global ANTHROPIC_API_KEY (Claude is the reference provider)", async () => {
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
    vi.stubEnv("SHOP_TEST_KEY", "shop-token");
    vi.stubEnv("PRICECHARTING_TOKEN", "global-token");
    const { pool } = credPool([{ kind: "pricecharting", key_ref: "SHOP_TEST_KEY", base_url: null }]);
    expect(await resolveShopToken(pool, "shop-1", "pricecharting", "PRICECHARTING_TOKEN")).toBe("shop-token");
  });

  it("falls back to the global env var, and to undefined when neither exists", async () => {
    vi.stubEnv("PRICECHARTING_TOKEN", "global-token");
    const { pool } = credPool([]);
    expect(await resolveShopToken(pool, "shop-1", "pricecharting", "PRICECHARTING_TOKEN")).toBe(
      "global-token"
    );
    vi.stubEnv("PRICECHARTING_TOKEN", "");
    expect(await resolveShopToken(pool, "shop-1", "pricecharting", "PRICECHARTING_TOKEN")).toBeUndefined();
  });
});
