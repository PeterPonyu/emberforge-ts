import {
  buildSystemPrompt,
  DEFAULT_MODEL,
  type ChatMessage,
  type Provider,
  type ToolCall,
  type ToolDefinition,
} from "../../api/src/index.js";
import type { TelemetrySink } from "../../telemetry/src/index.js";
import type { ToolDispatcher, ToolExecutor, ToolRegistry } from "../../tools/src/index.js";
import { Session } from "./session.js";

export interface TurnSummary {
  input: string;
  output: string;
}

/**
 * Default upper bound on agentic loop iterations, mirroring the Rust reference's
 * `max_iterations` (`crates/runtime/src/conversation.rs`). Bounds runaway
 * tool-calling: each iteration is one model turn that may request tools.
 */
export const DEFAULT_MAX_ITERATIONS = 25;

/**
 * Resolve the configurable max-iterations bound from `EMBER_MAX_ITERATIONS`,
 * falling back to {@link DEFAULT_MAX_ITERATIONS}. Only positive integers are
 * accepted; anything else uses the default.
 */
export function resolveMaxIterations(raw: string | undefined = process.env.EMBER_MAX_ITERATIONS): number {
  if (raw === undefined) return DEFAULT_MAX_ITERATIONS;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value <= 0) return DEFAULT_MAX_ITERATIONS;
  return value;
}

export interface ConversationRuntimeOptions {
  /** Permission-gated dispatcher used to execute the model's tool calls. */
  toolDispatcher?: ToolDispatcher;
  /** Registry whose specs are offered to the model as the `tools` array. */
  toolRegistry?: ToolRegistry;
  /** Upper bound on loop iterations (defaults to {@link resolveMaxIterations}). */
  maxIterations?: number;
}

export class ConversationRuntime {
  private readonly session = new Session();
  private activeModel: string | undefined;
  private readonly toolDispatcher?: ToolDispatcher;
  private readonly toolRegistry?: ToolRegistry;
  private readonly maxIterations: number;

  /**
   * Optional streaming sink for assistant text. When set, the agentic loop
   * surfaces text deltas incrementally as they arrive; the single-turn fallback
   * emits the full text once so consumers always receive content.
   */
  onText?: (delta: string) => void;

  constructor(
    private readonly provider: Provider,
    private readonly toolExecutor: ToolExecutor,
    private readonly telemetry: TelemetrySink,
    options: ConversationRuntimeOptions = {},
  ) {
    this.toolDispatcher = options.toolDispatcher;
    this.toolRegistry = options.toolRegistry;
    this.maxIterations = options.maxIterations ?? resolveMaxIterations();
  }

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
    } else if (this.canRunAgentic()) {
      output = await this.runAgenticTurn(input);
    } else {
      output = (await this.provider.sendMessage({
        model: this.getActiveModel(),
        prompt: input,
      })).text;
      // Single-turn fallback: emit the whole answer once so a streaming sink
      // still receives content even without a chat-capable provider.
      this.onText?.(output);
      this.telemetry.record({ name: "provider_completed", details: output });
    }

    this.session.addTurn({ input, output });
    return output;
  }

  /** Whether the agentic tool loop can run (chat-capable provider + tooling). */
  private canRunAgentic(): boolean {
    return (
      typeof this.provider.chat === "function" &&
      this.toolDispatcher !== undefined &&
      this.toolRegistry !== undefined
    );
  }

  /**
   * Multi-turn agentic loop mirroring the Rust reference
   * (`crates/runtime/src/conversation.rs:210-258`): send the conversation +
   * tool specs, execute any requested tools via the permission-gated dispatcher,
   * append their results as `tool` messages, and re-send until the model returns
   * no tool calls — bounded by {@link maxIterations}.
   */
  private async runAgenticTurn(input: string): Promise<string> {
    const model = this.getActiveModel();
    const tools = buildToolDefinitions(this.toolRegistry!);
    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: input },
    ];

    let finalText = "";
    for (let iteration = 1; ; iteration += 1) {
      if (iteration > this.maxIterations) {
        throw new Error(
          `conversation loop exceeded the maximum number of iterations (${this.maxIterations})`,
        );
      }

      const response = await this.provider.chat!({ model, messages, tools, onText: this.onText });
      finalText = response.text;
      messages.push({
        role: "assistant",
        content: response.text,
        tool_calls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      if (response.toolCalls.length === 0) {
        break;
      }

      for (const call of response.toolCalls) {
        const result = await this.executeToolCall(call);
        messages.push({ role: "tool", content: result, tool_name: call.name });
      }
    }

    this.telemetry.record({ name: "provider_completed", details: finalText });
    return finalText;
  }

  /**
   * Execute one tool call through the permission-gated dispatcher. Errors
   * (permission denied, unsupported tool, executor failure) are returned as the
   * tool result so the model can observe and recover, mirroring the Rust
   * reference's `is_error` tool_result blocks.
   */
  private async executeToolCall(call: ToolCall): Promise<string> {
    try {
      const dispatcherInput = formatToolInput(call.name, call.arguments);
      const output = await this.toolDispatcher!.dispatch(call.name, dispatcherInput);
      this.telemetry.record({ name: "tool_executed", details: `${call.name}: ${output}` });
      return output;
    } catch (err) {
      const message = (err as Error).message;
      this.telemetry.record({ name: "tool_failed", details: `${call.name}: ${message}` });
      return `Error: ${message}`;
    }
  }

  summarizeLastTurn(): TurnSummary | undefined {
    const history = this.session.history();
    return history.at(-1);
  }

  turnCount(): number {
    return this.session.history().length;
  }
}

/** Map the existing registry specs into provider-agnostic tool definitions. */
function buildToolDefinitions(registry: ToolRegistry): ToolDefinition[] {
  return registry.list().map((spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: spec.inputSchema,
  }));
}

/**
 * Bridge the model's structured tool arguments into the string input each
 * registry executor expects. The local executors use tool-specific input
 * encodings (raw command/path, `path\ncontent`, or JSON); this adapter mirrors
 * those contracts so structured `tool_calls` can drive them without changing
 * the executor surface.
 */
function formatToolInput(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case "bash":
      return String(args.command ?? "");
    case "read_file":
      return String(args.path ?? "");
    case "write_file":
      return `${String(args.path ?? "")}\n${String(args.content ?? "")}`;
    default:
      // edit_file, glob_search, grep_search (and other JSON-input tools).
      return JSON.stringify(args);
  }
}
