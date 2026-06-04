import type { MessageRequest, MessageResponse } from "./types.js";
import type { Provider } from "./provider.js";
import { buildSystemPrompt } from "./system_prompt.js";

/**
 * Normalizes an Ollama base URL so both the root form (`http://HOST:PORT`) and
 * the OpenAI-compat form (`http://HOST:PORT/v1`) resolve to the same native
 * endpoint root. The provider talks to Ollama's native API (`/api/chat`), so a
 * trailing `/v1` (the OpenAI-compatibility path) must be stripped before the
 * native path is appended — otherwise `.../v1/api/chat` 404s. Idempotent and
 * host/port-agnostic: trailing slashes and at most one trailing `/v1` segment
 * are removed, leaving any other path untouched.
 */
export function normalizeOllamaBaseURL(raw: string): string {
  let base = raw.trim().replace(/\/+$/, "");
  if (/\/v1$/i.test(base)) {
    base = base.slice(0, -"/v1".length).replace(/\/+$/, "");
  }
  return base;
}

/**
 * Default output-token bound for local Ollama models. Mirrors the Rust
 * reference's `max_tokens_for_model` non-opus default (64_000): generous enough
 * that normal answers are never truncated, while still bounding pathological
 * runaway generation from thinking models (e.g. qwen3's unbounded `<think>`).
 */
export const DEFAULT_OLLAMA_NUM_PREDICT = 64_000;

/**
 * Output-token bound for opus-class models. Mirrors the Rust reference's
 * `max_tokens_for_model` opus branch (32_000).
 */
export const OPUS_OLLAMA_NUM_PREDICT = 32_000;

/**
 * Model-aware output-token bound, mirroring the Rust reference's
 * `max_tokens_for_model` intent: opus-class models get a tighter bound, all
 * others (the local Ollama tags this provider serves) get the generous default.
 */
export function maxTokensForModel(model: string): number {
  return model.toLowerCase().includes("opus")
    ? OPUS_OLLAMA_NUM_PREDICT
    : DEFAULT_OLLAMA_NUM_PREDICT;
}

/**
 * Parses an explicit num_predict override (constructor arg or `OLLAMA_NUM_PREDICT`
 * env var). Returns `undefined` for absent/blank/invalid values so the caller
 * falls back to the model-aware default rather than sending a bogus bound.
 * Only positive integers are accepted (`-1` would mean "unbounded" to Ollama,
 * which defeats the purpose of this fix).
 */
export function parseNumPredict(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

export class OllamaProvider implements Provider {
  private readonly baseURL: string;
  private readonly model: string;
  /**
   * Explicit output-token bound. When set (constructor arg or `OLLAMA_NUM_PREDICT`
   * env var) it overrides the model-aware default; when `undefined` the bound is
   * resolved per-request via {@link maxTokensForModel}.
   */
  private readonly numPredict?: number;

  constructor(baseURL?: string, model?: string, numPredict?: number) {
    const resolved = baseURL ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    this.baseURL = normalizeOllamaBaseURL(resolved);
    this.model = model ?? process.env.OLLAMA_MODEL ?? process.env.EMBER_MODEL ?? "qwen3:8b";
    this.numPredict = numPredict ?? parseNumPredict(process.env.OLLAMA_NUM_PREDICT);
  }

  async sendMessage(request: MessageRequest): Promise<MessageResponse> {
    const effectiveModel = request.model || this.model;
    // Bound output generation so thinking models (e.g. qwen3) cannot run away
    // emitting `<think>` tokens until natural stop. Configurable via the
    // constructor or `OLLAMA_NUM_PREDICT`; otherwise a generous model-aware
    // default mirroring the Rust reference's `max_tokens_for_model`.
    const numPredict = this.numPredict ?? maxTokensForModel(effectiveModel);
    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: effectiveModel,
        // Prepend the canonical agent system prompt (parity with the Rust
        // reference) so the model is framed identically across all ports,
        // ahead of the user message.
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: request.prompt },
        ],
        stream: true,
        options: { num_predict: numPredict },
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
        if (obj.message?.content) text += obj.message.content;
        if (obj.done) return { text };
      }
    }

    return { text };
  }
}
