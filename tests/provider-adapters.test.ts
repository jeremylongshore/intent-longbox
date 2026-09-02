// Transport tests for both vision adapters against a stubbed global fetch:
// request shaping (auth headers, max_tokens floor, image encoding) and the
// status-not-throw error contract.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createAnthropicProvider } from "../src/providers/anthropic.js";
import { createOpenAICompatProvider } from "../src/providers/openaiCompat.js";
import type { ImageRef } from "../src/providers/types.js";
import { MAX_OUTPUT_TOKENS_FLOOR } from "../src/providers/types.js";
import { fakeResponse } from "./fakes.js";

const dir = mkdtempSync(join(tmpdir(), "longbox-adapter-"));
const imagePath = join(dir, "cover.jpg");
writeFileSync(imagePath, Buffer.from("fake-jpeg-bytes"));
const images: ImageRef[] = [{ path: imagePath, mediaType: "image/jpeg", kind: "cover" }];

const modelJson = JSON.stringify({
  candidates: [{ title: "ASM", issue: "300", confidence: 0.9 }],
  evidence: { issue_number_read: null, price_box_text: null, logo_era_guess: null },
  confidence: 0.9,
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("anthropic adapter", () => {
  const provider = () => createAnthropicProvider({ apiKey: "sk-ant-test", model: "claude-sonnet-5" });

  it("posts base64 images + the identify prompt with key header and max_tokens floor", async () => {
    const spy = stubFetch(async () =>
      fakeResponse(200, {
        content: [{ type: "text", text: modelJson }],
        usage: { input_tokens: 123, output_tokens: 45 },
      })
    );
    const result = await provider().identify({ images });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ranked[0]?.title).toBe("ASM");
      expect(result.usage).toEqual({ tokensIn: 123, tokensOut: 45 });
    }
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test");
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS_FLOOR);
    expect(body.messages[0].content[0].source).toMatchObject({
      type: "base64",
      media_type: "image/jpeg",
      data: Buffer.from("fake-jpeg-bytes").toString("base64"),
    });
  });

  it("returns status (not a throw) on API errors", async () => {
    stubFetch(async () => fakeResponse(401, { error: "bad key" }));
    const result = await provider().identify({ images });
    expect(result).toMatchObject({ ok: false, status: 401, error: "anthropic api error 401" });
  });

  it("returns status 0 on network failure", async () => {
    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await provider().identify({ images });
    expect(result).toMatchObject({ ok: false, status: 0 });
  });

  it("returns 502 on unparseable model output", async () => {
    stubFetch(async () => fakeResponse(200, { content: [{ type: "text", text: "sorry, no json" }] }));
    const result = await provider().identify({ images });
    expect(result).toMatchObject({ ok: false, status: 502 });
    if (!result.ok) expect(result.error).toMatch(/unparseable model output/);
  });

  it("honors a custom baseUrl (BYOK endpoint)", async () => {
    const spy = stubFetch(async () =>
      fakeResponse(200, { content: [{ type: "text", text: modelJson }], usage: {} })
    );
    await createAnthropicProvider({
      apiKey: "k",
      model: "claude-sonnet-5",
      baseUrl: "https://proxy.example.com/",
    }).identify({ images });
    expect(spy.mock.calls[0]![0]).toBe("https://proxy.example.com/v1/messages");
  });
});

describe("openai-compat adapter", () => {
  const provider = () => createOpenAICompatProvider({ apiKey: "sk-oai-test", model: "gpt-4o" });

  it("posts data-URL images with bearer auth to /chat/completions", async () => {
    const spy = stubFetch(async () =>
      fakeResponse(200, {
        choices: [{ message: { content: modelJson } }],
        usage: { prompt_tokens: 77, completion_tokens: 33 },
      })
    );
    const result = await provider().identify({ images });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.usage).toEqual({ tokensIn: 77, tokensOut: 33 });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-oai-test");
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("returns status (not a throw) on API errors", async () => {
    stubFetch(async () => fakeResponse(500, {}));
    const result = await provider().identify({ images });
    expect(result).toMatchObject({ ok: false, status: 500, error: "openai-compat api error 500" });
  });

  it("returns status 0 on network failure and 502 on garbage output", async () => {
    stubFetch(async () => {
      throw new Error("socket hang up");
    });
    expect(await provider().identify({ images })).toMatchObject({ ok: false, status: 0 });

    stubFetch(async () => fakeResponse(200, { choices: [{ message: { content: "" } }] }));
    expect(await provider().identify({ images })).toMatchObject({ ok: false, status: 502 });
  });
});
