import type { MessageRequest, MessageResponse } from "./types.js";
import type { Provider } from "./provider.js";
import { applyAnthropicAuth, resolveAnthropicAuth, type AnthropicSettings, type EnvMap } from "./auth.js";
import { globalFetch, type FetchLike } from "./transport.js";

export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 1024;

export interface AnthropicProviderOptions {
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
  maxTokens?: number;
  /** Injected transport — defaults to the global fetch. Override in tests. */
  fetchImpl?: FetchLike;
}

/**
 * Anthropic Messages API client (EFPORT-2). Mirrors the Rust `ClawApiClient`:
 * posts to `/v1/messages` with `anthropic-version`, `x-api-key`, and/or bearer
 * auth, and flattens the returned content blocks into `MessageResponse.text`.
 */
export class AnthropicProvider implements Provider {
  private readonly auth: { apiKey?: string; authToken?: string };
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: AnthropicProviderOptions = {}) {
    this.auth = { apiKey: options.apiKey, authToken: options.authToken };
    this.baseUrl = options.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.fetchImpl = options.fetchImpl ?? globalFetch;
  }

  /**
   * Build an `AnthropicProvider` from env/settings, or `null` when no
   * Anthropic credentials are resolvable (so routing can fall through).
   */
  static fromEnv(
    env: EnvMap = process.env,
    settings: AnthropicSettings = {},
    fetchImpl: FetchLike = globalFetch,
  ): AnthropicProvider | null {
    const auth = resolveAnthropicAuth(env, settings);
    if (!auth) {
      return null;
    }
    return new AnthropicProvider({
      apiKey: auth.apiKey,
      authToken: auth.authToken,
      baseUrl: settings.baseUrl ?? env.ANTHROPIC_BASE_URL ?? DEFAULT_ANTHROPIC_BASE_URL,
      fetchImpl,
    });
  }

  /** Constructs the request headers (auth + anthropic-version). Exposed for tests. */
  buildHeaders(): Record<string, string> {
    return applyAnthropicAuth(
      {
        "content-type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
      },
      this.auth,
    );
  }

  /** Constructs the JSON request body. Exposed for tests. */
  buildBody(request: MessageRequest): string {
    return JSON.stringify({
      model: request.model,
      max_tokens: this.maxTokens,
      messages: [{ role: "user", content: request.prompt }],
      stream: false,
    });
  }

  endpoint(): string {
    return `${this.baseUrl.replace(/\/+$/, "")}/v1/messages`;
  }

  async sendMessage(request: MessageRequest): Promise<MessageResponse> {
    const response = await this.fetchImpl(this.endpoint(), {
      method: "POST",
      headers: this.buildHeaders(),
      body: this.buildBody(request),
    });
    if (!response.ok) {
      throw new Error(`Anthropic HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (payload.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
    return { text };
  }
}
