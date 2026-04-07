import { MockProvider, type Provider } from "../../api/src/index.js";
import { CommandRegistry } from "../../commands/src/index.js";
import { defaultUpstreamPaths } from "../../compat/src/index.js";
import { LspManager } from "../../lsp/src/index.js";
import { PluginRegistry } from "../../plugins/src/index.js";
import { ConversationRuntime } from "../../runtime/src/index.js";
import { Server } from "../../server/src/index.js";
import { ConsoleTelemetrySink } from "../../telemetry/src/index.js";
import { RealToolExecutor, ToolRegistry } from "../../tools/src/index.js";
import { SystemDispatcher } from "./dispatch.js";
import { DEFAULT_STARTER_SYSTEM_CONFIG, type StarterSystemConfig } from "./config.js";
import { LifecycleTracker } from "./lifecycle.js";
import type { StarterSystemReport } from "./report.js";
import { ControlSequenceEngine } from "./sequence.js";
import { TurnEngine } from "./turn.js";

export class StarterSystemApplication {
  readonly provider: Provider;
  readonly toolExecutor = new RealToolExecutor();
  readonly telemetry = new ConsoleTelemetrySink();
  readonly runtime: ConversationRuntime;
  readonly commands = new CommandRegistry();
  readonly tools = new ToolRegistry();
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
  ) {
    this.provider = provider ?? new MockProvider();
    this.runtime = new ConversationRuntime(this.provider, this.toolExecutor, this.telemetry);
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

  shutdown(): void {
    this.controlSequence.shutdown();
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
      rustAnchor: this.paths.emberRuntimeLibRs,
      turnCount: this.runtime.turnCount(),
      handledRequestCount: this.controlSequence.records().length,
      lifecycleState: this.controlSequence.lifecycleState(),
      lastRoute: lastRecord?.route ?? null,
      lastPhaseHistory: lastRecord?.phases ?? [],
      lastTurnInput: lastTurn?.input ?? null,
    };
  }
}
