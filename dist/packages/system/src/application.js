import { MockProvider } from "../../api/src/index.js";
import { CommandRegistry } from "../../commands/src/index.js";
import { defaultUpstreamPaths } from "../../compat/src/index.js";
import { LspManager } from "../../lsp/src/index.js";
import { PluginRegistry } from "../../plugins/src/index.js";
import { ConversationRuntime } from "../../runtime/src/index.js";
import { Server } from "../../server/src/index.js";
import { ConsoleTelemetrySink } from "../../telemetry/src/index.js";
import { MockToolExecutor, ToolRegistry } from "../../tools/src/index.js";
import { DEFAULT_STARTER_SYSTEM_CONFIG } from "./config.js";
export class StarterSystemApplication {
    config;
    provider = new MockProvider();
    toolExecutor = new MockToolExecutor();
    telemetry = new ConsoleTelemetrySink();
    runtime = new ConversationRuntime(this.provider, this.toolExecutor, this.telemetry);
    commands = new CommandRegistry();
    tools = new ToolRegistry();
    plugins = new PluginRegistry();
    server;
    lsp = new LspManager();
    paths = defaultUpstreamPaths();
    constructor(config = DEFAULT_STARTER_SYSTEM_CONFIG) {
        this.config = config;
        this.server = new Server({ port: config.port });
    }
    runDemo() {
        return [
            this.runtime.runTurn(this.config.greeting),
            this.runtime.runTurn(`/tool ${this.config.toolDemoCommand}`),
        ];
    }
    report() {
        const lastTurn = this.runtime.summarizeLastTurn();
        return {
            appName: this.config.appName,
            commandCount: this.commands.list().length,
            toolCount: this.tools.list().length,
            pluginCount: this.plugins.list().length,
            serverDescription: this.server.describe(),
            lspSummary: this.lsp.summary(),
            rustAnchor: this.paths.emberRuntimeLibRs,
            turnCount: this.runtime.turnCount(),
            lastTurnInput: lastTurn?.input ?? null,
        };
    }
}
