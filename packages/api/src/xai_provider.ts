import type { MessageRequest, MessageResponse } from "./types.js";
import type { Provider } from "./provider.js";
import { resolveXaiApiKey, type EnvMap, type XaiSettings } from "./auth.js";
import { globalFetch, type FetchLike } from "./transport.js";
import { buildSystemPrompt } from "./system_prompt.js";

export const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";

export interface XaiProviderOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injected transport — defaults to the global fetch. Override in tests. */
  fetchImpl?: FetchLike;
}

/**
 * xAI client over the OpenAI-compatible Chat Completions API (EFPORT-2).
 * Mirrors the Rust `OpenAiCompatClient` configured for xAI: bearer auth, posts
 * to `{base}/chat/completions`, and normalizes the first choice's message into
 * `MessageResponse.text`.
 */
export class XaiProvider implements Provider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: XaiProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_XAI_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? globalFetch;
  }

  /**
   * Build an `XaiProvider` from env/settings, or `null` when no xAI API key is
   * resolvable (so routing can fall through).
   */
  static fromEnv(
    env: EnvMap = process.env,
    settings: XaiSettings = {},
    fetchImpl: FetchLike = globalFetch,
  ): XaiProvider | null {
    const apiKey = resolveXaiApiKey(env, settings);
    if (!apiKey) {
      return null;
    }
    return new XaiProvider({
      apiKey,
      baseUrl: settings.baseUrl ?? env.XAI_BASE_URL ?? DEFAULT_XAI_BASE_URL,
      fetchImpl,
    });
  }

  buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
    };
  }

  buildBody(request: MessageRequest): string {
    return JSON.stringify({
      model: request.model,
      // Prepend the canonical agent system prompt (parity with the Rust
      // reference) ahead of the user message, for cross-provider consistency.
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: request.prompt },
      ],
      stream: false,
    });
  }

  endpoint(): string {
    const trimmed = this.baseUrl.replace(/\/+$/, "");
    return trimmed.endsWith("/chat/completions")
      ? trimmed
      : `${trimmed}/chat/completions`;
  }

  async sendMessage(request: MessageRequest): Promise<MessageResponse> {
    const response = await this.fetchImpl(this.endpoint(), {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildBody(request),
    });
    if (!response.ok) {
      throw new Error(`xAI HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
    };
    const message = payload.choices?.[0]?.message;
    const text = message?.content || message?.reasoning || "";
    return { text };
  }
}
