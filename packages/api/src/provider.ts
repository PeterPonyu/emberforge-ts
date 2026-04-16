import type { MessageRequest, MessageResponse } from "./types.js";

export const DEFAULT_MODEL = "qwen3:8b";

export interface Provider {
  sendMessage(request: MessageRequest): Promise<MessageResponse> | MessageResponse;
}
