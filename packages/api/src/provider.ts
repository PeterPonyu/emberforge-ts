import type { MessageRequest, MessageResponse } from "./types.js";

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export interface Provider {
  sendMessage(request: MessageRequest): MessageResponse;
}

export class MockProvider implements Provider {
  sendMessage(request: MessageRequest): MessageResponse {
    return {
      text: `[ts provider] model=${request.model} prompt=${request.prompt}`,
    };
  }
}
