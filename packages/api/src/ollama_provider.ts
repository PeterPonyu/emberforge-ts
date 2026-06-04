import type { MessageRequest, MessageResponse } from "./types.js";
import type { Provider } from "./provider.js";

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

export class OllamaProvider implements Provider {
  private readonly baseURL: string;
  private readonly model: string;

  constructor(baseURL?: string, model?: string) {
    const resolved = baseURL ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    this.baseURL = normalizeOllamaBaseURL(resolved);
    this.model = model ?? process.env.OLLAMA_MODEL ?? process.env.EMBER_MODEL ?? "qwen3:8b";
  }

  async sendMessage(request: MessageRequest): Promise<MessageResponse> {
    const effectiveModel = request.model || this.model;
    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: effectiveModel,
        messages: [{ role: "user", content: request.prompt }],
        stream: true,
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
