import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  ConversationRuntime,
  DEFAULT_MAX_ITERATIONS,
  resolveMaxIterations,
} from "./conversation.js";
import type {
  ChatRequest,
  ChatResponse,
  MessageRequest,
  MessageResponse,
  Provider,
} from "../../api/src/index.js";
import type { TelemetrySink } from "../../telemetry/src/index.js";
import {
  PermissionMode,
  ToolDispatcher,
  ToolRegistry,
  type ToolExecutor,
} from "../../tools/src/index.js";

/** Telemetry sink that drops everything (keeps test output clean). */
const silentTelemetry: TelemetrySink = { record: () => {} };

/** Records every dispatched tool call so the test can assert on execution. */
class RecordingToolExecutor implements ToolExecutor {
  readonly calls: Array<{ tool: string; input: string }> = [];
  constructor(private readonly output: string) {}
  execute(toolName: string, input: string): string {
    this.calls.push({ tool: toolName, input });
    return this.output;
  }
}

/**
 * Chat provider driven by a scripted list of responses (one per turn). Captures
 * every request so the test can assert the `tools` array was sent and that tool
 * results were appended to the conversation before the next turn.
 */
class ScriptedChatProvider implements Provider {
  readonly requests: ChatRequest[] = [];
  private turn = 0;
  constructor(private readonly script: ChatResponse[]) {}

  sendMessage(_request: MessageRequest): MessageResponse {
    return { text: "unused" };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // Deep-copy the messages so later mutation can't rewrite captured history.
    this.requests.push({ ...request, messages: request.messages.map((m) => ({ ...m })) });
    const response = this.script[this.turn] ?? { text: "", toolCalls: [] };
    this.turn += 1;
    return response;
  }
}

/** Chat provider that always requests a tool — used to exercise the loop bound. */
class RunawayChatProvider implements Provider {
  sendMessage(_request: MessageRequest): MessageResponse {
    return { text: "unused" };
  }
  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return { text: "", toolCalls: [{ name: "bash", arguments: { command: "echo loop" } }] };
  }
}

function makeRuntime(provider: Provider, executor: ToolExecutor, maxIterations?: number) {
  const registry = new ToolRegistry();
  const dispatcher = new ToolDispatcher(executor, registry, PermissionMode.DangerFullAccess);
  return new ConversationRuntime(provider, executor, silentTelemetry, {
    toolDispatcher: dispatcher,
    toolRegistry: registry,
    maxIterations,
  });
}

test("agentic loop executes a tool, appends the result, and terminates", async () => {
  const provider = new ScriptedChatProvider([
    // Turn 1: model requests a tool.
    { text: "", toolCalls: [{ name: "bash", arguments: { command: "ls" } }] },
    // Turn 2: model returns the final answer (no more tool calls).
    { text: "there are 3 files", toolCalls: [] },
  ]);
  const executor = new RecordingToolExecutor("a.ts\nb.ts\nc.ts");
  const runtime = makeRuntime(provider, executor);

  const output = await runtime.runTurn("How many files are here?");

  // Loop terminated with the model's final text.
  assert.equal(output, "there are 3 files");

  // The tool actually executed, with the structured argument bridged to the
  // bash executor's raw-command input contract.
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(executor.calls[0], { tool: "bash", input: "ls" });

  // Exactly two model turns were taken.
  assert.equal(provider.requests.length, 2);

  // Turn 1 carried the tool registry as the `tools` array (native tool-calling).
  const firstTools = provider.requests[0]?.tools ?? [];
  assert.ok(firstTools.length > 0, "first request must carry a tools array");
  assert.ok(
    firstTools.some((t) => t.name === "bash"),
    "tools array must include the bash spec from the registry",
  );
  // Specs are reused verbatim (schema carried through, not hardcoded).
  const bashTool = firstTools.find((t) => t.name === "bash");
  assert.ok(bashTool?.parameters, "bash tool must carry its input schema");

  // Turn 2 re-sent the conversation with the assistant tool-call turn AND the
  // appended tool result, so the model can observe the tool output.
  const secondMessages = provider.requests[1]?.messages ?? [];
  const assistantTurn = secondMessages.find((m) => m.role === "assistant");
  assert.ok(assistantTurn?.tool_calls?.some((c) => c.name === "bash"), "assistant turn recorded the tool call");
  const toolResult = secondMessages.find((m) => m.role === "tool");
  assert.ok(toolResult, "a tool-result message must be appended");
  assert.equal(toolResult?.tool_name, "bash");
  assert.equal(toolResult?.content, "a.ts\nb.ts\nc.ts");
});

test("agentic loop is bounded by maxIterations to stop runaway tool calls", async () => {
  const provider = new RunawayChatProvider();
  const executor = new RecordingToolExecutor("loop");
  const runtime = makeRuntime(provider, executor, 3);

  await assert.rejects(
    () => runtime.runTurn("go forever"),
    /exceeded the maximum number of iterations \(3\)/,
  );
});

test("a chat-incapable provider falls back to a single buffered turn", async () => {
  let streamed = "";
  const provider: Provider = {
    sendMessage(request: MessageRequest): MessageResponse {
      return { text: `echo:${request.prompt}` };
    },
  };
  // No dispatcher/registry → not agentic; exercises the fallback path.
  const runtime = new ConversationRuntime(
    provider,
    new RecordingToolExecutor("unused"),
    silentTelemetry,
  );
  runtime.onText = (delta) => {
    streamed += delta;
  };

  const output = await runtime.runTurn("hi");
  assert.equal(output, "echo:hi");
  // The fallback emits the whole answer once so a streaming sink still sees it.
  assert.equal(streamed, "echo:hi");
});

test("resolveMaxIterations honors a valid override and rejects junk", () => {
  assert.equal(resolveMaxIterations("10"), 10);
  assert.equal(resolveMaxIterations(undefined), DEFAULT_MAX_ITERATIONS);
  assert.equal(resolveMaxIterations(""), DEFAULT_MAX_ITERATIONS);
  assert.equal(resolveMaxIterations("0"), DEFAULT_MAX_ITERATIONS);
  assert.equal(resolveMaxIterations("-4"), DEFAULT_MAX_ITERATIONS);
  assert.equal(resolveMaxIterations("abc"), DEFAULT_MAX_ITERATIONS);
});
