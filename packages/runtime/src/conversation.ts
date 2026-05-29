import { DEFAULT_MODEL, type Provider } from "../../api/src/index.js";
import type { TelemetrySink } from "../../telemetry/src/index.js";
import type { ToolExecutor } from "../../tools/src/index.js";
import { Session } from "./session.js";

export interface TurnSummary {
  input: string;
  output: string;
}

export class ConversationRuntime {
  private readonly session = new Session();
  private activeModel: string | undefined;

  constructor(
    private readonly provider: Provider,
    private readonly toolExecutor: ToolExecutor,
    private readonly telemetry: TelemetrySink,
  ) {}

  getActiveModel(): string {
    return this.activeModel ?? process.env.OLLAMA_MODEL ?? process.env.EMBER_MODEL ?? DEFAULT_MODEL;
  }

  setActiveModel(model: string): string {
    this.activeModel = model;
    return this.activeModel;
  }

  async runTurn(input: string): Promise<string> {
    this.telemetry.record({ name: "turn_started", details: input });

    let output: string;
    if (input.startsWith("/tool ")) {
      const payload = input.slice(6);
      output = await this.toolExecutor.execute("bash", payload);
      this.telemetry.record({ name: "tool_executed", details: output });
    } else {
      output = (await this.provider.sendMessage({
        model: this.getActiveModel(),
        prompt: input,
      })).text;
      this.telemetry.record({ name: "provider_completed", details: output });
    }

    this.session.addTurn({ input, output });
    return output;
  }

  summarizeLastTurn(): TurnSummary | undefined {
    const history = this.session.history();
    return history.at(-1);
  }

  turnCount(): number {
    return this.session.history().length;
  }
}
