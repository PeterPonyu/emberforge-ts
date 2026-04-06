import type { CommandRegistry } from "../../commands/src/index.js";
import type { ToolRegistry } from "../../tools/src/index.js";

export type DispatchRoute = "command" | "tool" | "prompt";

export interface DispatchDecision {
  route: DispatchRoute;
  payload: string;
  commandName?: string;
  toolName?: string;
}

export class SystemDispatcher {
  constructor(
    private readonly commands: CommandRegistry,
    private readonly tools: ToolRegistry,
  ) {}

  dispatch(input: string): DispatchDecision {
    const trimmed = input.trim();

    if (trimmed.startsWith("/tool ")) {
      return {
        route: "tool",
        toolName: this.tools.has("bash") ? "bash" : undefined,
        payload: trimmed.slice(6),
      };
    }

    if (trimmed.startsWith("/")) {
      const commandName = trimmed.slice(1).split(/\s+/, 1)[0] ?? "";
      const payload = trimmed.slice(commandName.length + 1).trim();
      return {
        route: "command",
        commandName,
        payload,
      };
    }

    return {
      route: "prompt",
      payload: trimmed,
    };
  }
}
