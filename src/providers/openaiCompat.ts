// OpenAI-compatible chat-completions adapter (image_url content parts).
// Serves api.openai.com or any compatible endpoint. fetch-based, returns
// status on 4xx/5xx instead of throwing, never logs keys.
import type { IdentifyRequest, IdentifyResult, ProviderConfig, VisionProvider } from "./types.js";
import { IDENTIFY_PROMPT, MAX_OUTPUT_TOKENS_FLOOR, parseModelJson } from "./types.js";
import { buildUserText, imageToBase64, toIdentifyResult } from "./shared.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function createOpenAICompatProvider(cfg: ProviderConfig): VisionProvider {
  const baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  return {
    id: "openai-compat",
    model: cfg.model,
    async identify(req: IdentifyRequest): Promise<IdentifyResult> {
      const content: unknown[] = req.images.map((img) => ({
        type: "image_url",
        image_url: { url: `data:${img.mediaType};base64,${imageToBase64(img.path)}` },
      }));
      content.push({ type: "text", text: buildUserText(IDENTIFY_PROMPT, req) });

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.apiKey}`,
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
        return { ok: false, status: res.status, error: `openai-compat api error ${res.status}`, raw: body };
      }
      const b = body as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = b.choices?.[0]?.message?.content ?? "";
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
        tokensIn: b.usage?.prompt_tokens ?? 0,
        tokensOut: b.usage?.completion_tokens ?? 0,
      });
    },
  };
}
