import { MockProvider, type Provider } from "../../api/src/index.js";
import { CommandRegistry } from "../../commands/src/index.js";
import { defaultUpstreamPaths } from "../../compat/src/index.js";
import { LspManager } from "../../lsp/src/index.js";
import { PluginRegistry } from "../../plugins/src/index.js";
import { ConversationRuntime } from "../../runtime/src/index.js";
import { McpClient, type McpServerConfig } from "../../mcp/src/index.js";
import { Server } from "../../server/src/index.js";
import { ConsoleTelemetrySink, type TelemetrySink } from "../../telemetry/src/index.js";
import { PermissionMode, RealToolExecutor, ToolDispatcher, ToolRegistry } from "../../tools/src/index.js";
import { StarterBuddyState } from "./buddy.js";
import { SystemDispatcher } from "./dispatch.js";
import { DEFAULT_STARTER_SYSTEM_CONFIG, type StarterSystemConfig } from "./config.js";
import { LifecycleTracker } from "./lifecycle.js";
import type { StarterSystemReport } from "./report.js";
import { TaskQuestionStateStore } from "./task_question_state.js";
import { ControlSequenceEngine } from "./sequence.js";
import { TurnEngine } from "./turn.js";

export class StarterSystemApplication {
  readonly provider: Provider;
  readonly toolExecutor = new RealToolExecutor();
  readonly telemetry: TelemetrySink;
  readonly runtime: ConversationRuntime;
  readonly buddy = new StarterBuddyState();
  readonly taskQuestionState = new TaskQuestionStateStore();
  readonly commands = new CommandRegistry();
  tools = new ToolRegistry();
  // Permission-gated dispatch over the local executor (EFPORT-7). Runs in
  // danger-full-access by default so local tools (including bash) are usable.
  readonly toolDispatcher = new ToolDispatcher(
    this.toolExecutor,
    this.tools,
    PermissionMode.DangerFullAccess,
  );
  readonly mcp: McpClient;
  readonly plugins = new PluginRegistry();
  readonly lifecycle = new LifecycleTracker();
  readonly dispatcher = new SystemDispatcher(this.commands, this.tools);
  readonly controlSequence: ControlSequenceEngine;
  readonly turn: TurnEngine;
  readonly server: Server;
  readonly lsp = new LspManager();
  readonly paths = defaultUpstreamPaths();

  constructor(
    readonly config: StarterSystemConfig = DEFAULT_STARTER_SYSTEM_CONFIG,
    provider?: Provider,
    mcpServers: McpServerConfig[] = [],
    telemetry?: TelemetrySink,
  ) {
    this.telemetry = telemetry ?? new ConsoleTelemetrySink();
    this.provider = provider ?? new MockProvider();
    this.mcp = new McpClient(mcpServers);
    this.runtime = new ConversationRuntime(this.provider, this.toolExecutor, this.telemetry, {
      toolDispatcher: this.toolDispatcher,
      toolRegistry: this.tools,
    });
    this.controlSequence = new ControlSequenceEngine(
      this.runtime,
      this.commands,
      this.dispatcher,
      this.lifecycle,
      this.telemetry,
    );
    this.server = new Server({ port: config.port });
    this.turn = new TurnEngine(this.controlSequence, {
      maxTurns: config.maxTurns,
      maxCostUsd: config.maxCostUsd,
    });
  }

  async runDemo(): Promise<string[]> {
    this.controlSequence.bootstrap();
    return [
      (await this.controlSequence.handle(`/${this.config.commandDemoName}`)).output,
      (await this.controlSequence.handle(this.config.greeting)).output,
      (await this.controlSequence.handle(`/tool ${this.config.toolDemoCommand}`)).output,
    ];
  }

  /**
   * Connects to any configured MCP servers, discovers their tools, and merges
   * them into the tool registry under their qualified `mcp__server__tool`
   * names. No-op (and never spawns a process) when no servers are configured,
   * keeping application startup offline-safe by default.
   */
  async initMcp(): Promise<void> {
    if (this.mcp.serverNames().length === 0) {
      return;
    }
    await this.mcp.discoverAll();
    this.tools = this.mcp.registerInto(this.tools);
  }

  shutdown(): void {
    this.controlSequence.shutdown();
    void this.mcp.shutdown();
  }

  report(): StarterSystemReport {
    const lastTurn = this.runtime.summarizeLastTurn();
    const lastRecord = this.controlSequence.lastRecord();
    return {
      appName: this.config.appName,
      commandCount: this.commands.list().length,
      toolCount: this.tools.list().length,
      pluginCount: this.plugins.list().length,
      serverDescription: this.server.describe(),
      lspSummary: this.lsp.summary(),
      turnCount: this.runtime.turnCount(),
      handledRequestCount: this.controlSequence.records().length,
      lifecycleState: this.controlSequence.lifecycleState(),
      lastRoute: lastRecord?.route ?? null,
      lastPhaseHistory: lastRecord?.phases ?? [],
      lastTurnInput: lastTurn?.input ?? null,
    };
  }
}
