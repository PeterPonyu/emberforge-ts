import type { Provider } from "./provider.js";
import type { MessageRequest, MessageResponse } from "./types.js";

export class MockProvider implements Provider {
  sendMessage(request: MessageRequest): MessageResponse {
    return {
      text: `[ts provider] model=${request.model} prompt=${request.prompt}`,
    };
  }
}
