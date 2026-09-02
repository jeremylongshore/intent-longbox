// Anthropic Messages adapter (default / reference provider). fetch-based,
// returns status on 4xx/5xx instead of throwing, never logs keys.
import type { IdentifyRequest, IdentifyResult, ProviderConfig, VisionProvider } from "./types.js";
import { IDENTIFY_PROMPT, MAX_OUTPUT_TOKENS_FLOOR, parseModelJson } from "./types.js";
import { buildUserText, imageToBase64, toIdentifyResult } from "./shared.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";

export function createAnthropicProvider(cfg: ProviderConfig): VisionProvider {
  const baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  return {
    id: "anthropic",
    model: cfg.model,
    async identify(req: IdentifyRequest): Promise<IdentifyResult> {
      const content: unknown[] = req.images.map((img) => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: imageToBase64(img.path) },
      }));
      content.push({ type: "text", text: buildUserText(IDENTIFY_PROMPT, req) });

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": cfg.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: cfg.model,
            max_tokens: MAX_OUTPUT_TOKENS_FLOOR,
            messages: [{ role: "user", content }],
          }),
        });
      } catch (err) {
        return { ok: false, status: 0, error: `network error: ${(err as Error).message}` };
      }

      const body: unknown = await res.json().catch(() => undefined);
      if (!res.ok) {
        return { ok: false, status: res.status, error: `anthropic api error ${res.status}`, raw: body };
      }
      const b = body as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (b.content ?? [])
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("\n");
      let payload: unknown;
      try {
        payload = parseModelJson(text);
      } catch (err) {
        return {
          ok: false,
          status: 502,
          error: `unparseable model output: ${(err as Error).message}`,
          raw: body,
        };
      }
      return toIdentifyResult(payload, body, {
        tokensIn: b.usage?.input_tokens ?? 0,
        tokensOut: b.usage?.output_tokens ?? 0,
      });
    },
  };
}
