import type { MessageRequest, MessageResponse } from "./types.js";

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface Provider {
  sendMessage(request: MessageRequest): Promise<MessageResponse> | MessageResponse;
}
