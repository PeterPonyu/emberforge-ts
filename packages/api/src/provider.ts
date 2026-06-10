import type {
  ChatRequest,
  ChatResponse,
  MessageRequest,
  MessageResponse,
} from "./types.js";

export const DEFAULT_MODEL = "qwen3:8b";

export interface Provider {
  sendMessage(request: MessageRequest): Promise<MessageResponse> | MessageResponse;
  /**
   * Optional agentic chat turn (multi-turn tool loop). Providers that support
   * native tool-calling implement this to return structured tool calls; the
   * runtime drives the loop. Providers without it fall back to single-turn
   * {@link Provider.sendMessage}.
   */
  chat?(request: ChatRequest): Promise<ChatResponse>;
}
