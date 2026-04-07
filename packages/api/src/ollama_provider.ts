import type { MessageRequest, MessageResponse } from "./types.js";
import type { Provider } from "./provider.js";

export class OllamaProvider implements Provider {
  private readonly baseURL: string;
  private readonly model: string;

  constructor(baseURL?: string, model?: string) {
    this.baseURL = baseURL ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    this.model = model ?? "llama3.2";
  }

  async sendMessage(request: MessageRequest): Promise<MessageResponse> {
    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
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
