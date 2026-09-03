// Contract: vision LLM providers — Anthropic Messages + OpenAI-compatible chat
// completions (R6 — LLM re-rank annotates with provider/model/response;
// R18 — BYOK per shop, Claude default, OpenAI-compat supported; R7 evidence
// gate input). L4 recorded-fixture contract: exact outgoing request (model pin,
// version header, image block encoding, prompt demanding the evidence block,
// no temperature) and parsing of recorded-shape responses, including the
// 502 rejection when the evidence block is missing. Injected fetch only.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createAnthropicProvider } from "../../src/providers/anthropic.js";
import { createOpenAICompatProvider } from "../../src/providers/openaiCompat.js";
import type { ImageRef } from "../../src/providers/types.js";
import { IDENTIFY_PROMPT } from "../../src/providers/types.js";
import { fakeResponse } from "../fakes.js";

const dir = mkdtempSync(join(tmpdir(), "longbox-contract-llm-"));
const coverBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const barcodeBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x16, 0x45, 0x78, 0x69, 0x66]);
const coverPath = join(dir, "cover.png");
const barcodePath = join(dir, "barcode.jpg");
writeFileSync(coverPath, coverBytes);
writeFileSync(barcodePath, barcodeBytes);
const images: ImageRef[] = [
  { path: coverPath, mediaType: "image/png", kind: "cover" },
  { path: barcodePath, mediaType: "image/jpeg", kind: "barcode" },
];

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

// The model payload both adapters must extract from their transport envelope.
const MODEL_PAYLOAD = {
  candidates: [
    {
      title: "Uncanny X-Men",
      issue: "266",
      publisher: "Marvel",
      year: 1990,
      variant: "Newsstand",
      variantHints: ["UPC barcode box instead of direct-edition Spider-Man head"],
      confidence: 0.91,
    },
    {
      title: "Uncanny X-Men",
      issue: "266",
      publisher: "Marvel",
      year: 1990,
      variant: null,
      confidence: 0.07,
    },
  ],
  evidence: {
    issue_number_read: "266",
    price_box_text: "$1.00 US $1.25 CAN AUG",
    logo_era_guess: "1990s Marvel corner box",
  },
  confidence: 0.91,
};

const PAYLOAD_WITHOUT_EVIDENCE = {
  candidates: [{ title: "Uncanny X-Men", issue: "266", confidence: 0.91 }],
  confidence: 0.91,
};

// Recorded-shape Anthropic Messages response.
const RECORDED_ANTHROPIC = (text: string) => ({
  id: "msg_01XFDUDYJgAACzvnptvVoYEL",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: {
    input_tokens: 2914,
    output_tokens: 231,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
});

// Recorded-shape OpenAI chat completion response.
const RECORDED_OPENAI = (content: string) => ({
  id: "chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT",
  object: "chat.completion",
  created: 1741569952,
  model: "gpt-4o-2024-08-06",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content, refusal: null },
      logprobs: null,
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 1873, completion_tokens: 194, total_tokens: 2067 },
  system_fingerprint: "fp_06737a9306",
});

function recordFetch(body: unknown, status = 200) {
  const spy = vi.fn(async (_url: string, _init: RequestInit) => fakeResponse(status, body));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function sent(spy: ReturnType<typeof recordFetch>) {
  const [url, init] = spy.mock.calls[0]!;
  return {
    url,
    init,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string),
  };
}

const EXPECTED_OK = {
  ok: true,
  ranked: [
    {
      title: "Uncanny X-Men",
      issue: "266",
      publisher: "Marvel",
      year: 1990,
      variant: "Newsstand",
      variantHints: ["UPC barcode box instead of direct-edition Spider-Man head"],
      confidence: 0.91,
    },
    { title: "Uncanny X-Men", issue: "266", publisher: "Marvel", year: 1990, confidence: 0.07 },
  ],
  evidence: {
    issue_number_read: "266",
    price_box_text: "$1.00 US $1.25 CAN AUG",
    logo_era_guess: "1990s Marvel corner box",
  },
  confidence: 0.91,
};

describe("Anthropic Messages — outgoing request contract", () => {
  const provider = createAnthropicProvider({ apiKey: "test-anthropic-key-gotham", model: "claude-sonnet-5" });

  it("sends exactly model/max_tokens/messages with the pinned model, anthropic-version 2023-06-01, no temperature", async () => {
    const spy = recordFetch(RECORDED_ANTHROPIC(JSON.stringify(MODEL_PAYLOAD)));
    await provider.identify({ images });
    const { init, headers, body } = sent(spy);
    expect(init.method).toBe("POST");
    expect(headers).toEqual({
      "content-type": "application/json",
      "x-api-key": "test-anthropic-key-gotham",
      "anthropic-version": "2023-06-01",
    });
    expect(Object.keys(body)).toEqual(["model", "max_tokens", "messages"]);
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.max_tokens).toBe(2048);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("tools");
  });

  it("encodes every image as a base64 block in order, with the text block last", async () => {
    const spy = recordFetch(RECORDED_ANTHROPIC(JSON.stringify(MODEL_PAYLOAD)));
    await provider.identify({ images });
    const { body } = sent(spy);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    const content = body.messages[0].content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: coverBytes.toString("base64") },
    });
    expect(content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: barcodeBytes.toString("base64") },
    });
    expect(content[2]).toEqual({ type: "text", text: IDENTIFY_PROMPT });
  });

  it("the prompt demands the three evidence fields as REQUIRED and forbids a numeric grade", async () => {
    const spy = recordFetch(RECORDED_ANTHROPIC(JSON.stringify(MODEL_PAYLOAD)));
    await provider.identify({ images });
    const text = sent(spy).body.messages[0].content[2].text as string;
    expect(text).toContain('"issue_number_read": string|null');
    expect(text).toContain('"price_box_text": string|null');
    expect(text).toContain('"logo_era_guess": string|null');
    expect(text).toContain("evidence fields are REQUIRED");
    expect(text).toContain("Condition/grade is out of scope");
  });

  it("appends the candidate metadata JSON to the text block in re-rank mode", async () => {
    const spy = recordFetch(RECORDED_ANTHROPIC(JSON.stringify(MODEL_PAYLOAD)));
    await provider.identify({
      images,
      candidates: [{ title: "Uncanny X-Men", issue: "266", publisher: "Marvel", year: 1990 }],
    });
    const text = sent(spy).body.messages[0].content[2].text as string;
    expect(text.startsWith(IDENTIFY_PROMPT)).toBe(true);
    expect(
      text.endsWith(
        JSON.stringify([{ title: "Uncanny X-Men", issue: "266", publisher: "Marvel", year: 1990 }], null, 2)
      )
    ).toBe(true);
  });
});

describe("Anthropic Messages — recorded response parsing", () => {
  const provider = createAnthropicProvider({ apiKey: "test-anthropic-key-gotham", model: "claude-sonnet-5" });

  it("parses the recorded envelope into ranked candidates + evidence + usage, keeping raw verbatim", async () => {
    const raw = RECORDED_ANTHROPIC(JSON.stringify(MODEL_PAYLOAD));
    recordFetch(raw);
    const result = await provider.identify({ images });
    expect(result).toEqual({ ...EXPECTED_OK, raw, usage: { tokensIn: 2914, tokensOut: 231 } });
  });

  it("joins multiple text blocks and ignores non-text blocks before parsing", async () => {
    recordFetch({
      ...RECORDED_ANTHROPIC(""),
      content: [
        { type: "thinking", thinking: "The corner box shows a UPC…" },
        { type: "text", text: "Identification follows." },
        { type: "text", text: JSON.stringify(MODEL_PAYLOAD) },
      ],
    });
    const result = await provider.identify({ images });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ranked[0]!.variant).toBe("Newsstand");
  });

  it("rejects a response whose JSON lacks the evidence block with 502 (never ok)", async () => {
    recordFetch(RECORDED_ANTHROPIC(JSON.stringify(PAYLOAD_WITHOUT_EVIDENCE)));
    const result = await provider.identify({ images });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/^model payload failed validation: /);
    expect(result.error).toContain('"path": [\n      "evidence"\n    ]');
  });

  it("rejects a response whose evidence block has a missing field with 502", async () => {
    recordFetch(
      RECORDED_ANTHROPIC(
        JSON.stringify({
          ...MODEL_PAYLOAD,
          evidence: { issue_number_read: "266", price_box_text: "$1.00 US" },
        })
      )
    );
    const result = await provider.identify({ images });
    expect(result).toMatchObject({ ok: false, status: 502 });
  });
});

describe("OpenAI-compatible chat completions — outgoing request contract", () => {
  const provider = createOpenAICompatProvider({ apiKey: "test-openai-key-gotham", model: "gpt-4o" });

  it("sends exactly model/max_tokens/messages with bearer auth and no temperature or response_format", async () => {
    const spy = recordFetch(RECORDED_OPENAI(JSON.stringify(MODEL_PAYLOAD)));
    await provider.identify({ images });
    const { init, headers, body } = sent(spy);
    expect(init.method).toBe("POST");
    expect(headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer test-openai-key-gotham",
    });
    expect(Object.keys(body)).toEqual(["model", "max_tokens", "messages"]);
    expect(body.model).toBe("gpt-4o");
    expect(body.max_tokens).toBe(2048);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("response_format");
  });

  it("encodes every image as a data-URL image_url part in order, text part last", async () => {
    const spy = recordFetch(RECORDED_OPENAI(JSON.stringify(MODEL_PAYLOAD)));
    await provider.identify({ images });
    const content = sent(spy).body.messages[0].content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${coverBytes.toString("base64")}` },
    });
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${barcodeBytes.toString("base64")}` },
    });
    expect(content[2]).toEqual({ type: "text", text: IDENTIFY_PROMPT });
  });

  it("routes to the gateway override host when baseUrl is set (LLM_BASE_URL path)", async () => {
    const spy = recordFetch(RECORDED_OPENAI(JSON.stringify(MODEL_PAYLOAD)));
    await createOpenAICompatProvider({
      apiKey: "gw-key",
      model: "anthropic/claude-sonnet-5",
      baseUrl: "https://gateway.intentsolutions.io/v1/",
    }).identify({ images });
    const { url, body } = sent(spy);
    expect(url).toBe("https://gateway.intentsolutions.io/v1/chat/completions");
    expect(body.model).toBe("anthropic/claude-sonnet-5");
  });
});

describe("OpenAI-compatible chat completions — recorded response parsing", () => {
  const provider = createOpenAICompatProvider({ apiKey: "test-openai-key-gotham", model: "gpt-4o" });

  it("parses the recorded envelope into ranked candidates + evidence + usage, keeping raw verbatim", async () => {
    const raw = RECORDED_OPENAI(JSON.stringify(MODEL_PAYLOAD));
    recordFetch(raw);
    const result = await provider.identify({ images });
    expect(result).toEqual({ ...EXPECTED_OK, raw, usage: { tokensIn: 1873, tokensOut: 194 } });
  });

  it("strips a reasoning-model <think> block and markdown fence around the JSON", async () => {
    recordFetch(
      RECORDED_OPENAI(
        `<think>Corner box has a UPC, so newsstand.</think>\n\`\`\`json\n${JSON.stringify(MODEL_PAYLOAD)}\n\`\`\``
      )
    );
    const result = await provider.identify({ images });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.evidence.issue_number_read).toBe("266");
  });

  it("rejects a response whose JSON lacks the evidence block with 502 (never ok)", async () => {
    recordFetch(RECORDED_OPENAI(JSON.stringify(PAYLOAD_WITHOUT_EVIDENCE)));
    const result = await provider.identify({ images });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/^model payload failed validation: /);
  });

  it("returns 502 when choices is empty (no message content)", async () => {
    recordFetch({ ...RECORDED_OPENAI(""), choices: [] });
    const result = await provider.identify({ images });
    expect(result).toMatchObject({
      ok: false,
      status: 502,
      error: "unparseable model output: no JSON object found in model output",
    });
  });
});
