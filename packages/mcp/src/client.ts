import type { ToolSpec } from "../../tools/src/index.js";
import { PermissionMode, ToolRegistry } from "../../tools/src/index.js";
import { mcpToolName, mcpToolPrefix, normalizeNameForMcp } from "./names.js";
import { McpStdioProcess } from "./stdio.js";
import {
  defaultInitializeParams,
  type JsonRpcId,
  type McpStdioTransport,
  type McpTool,
} from "./types.js";

/**
 * A configured stdio MCP server. Only the stdio transport is supported, matching
 * the Rust `McpServerManager`, which records other transports as unsupported.
 */
export interface McpServerConfig {
  name: string;
  transport: McpStdioTransport;
}

/** A tool discovered on an MCP server, with its qualified (prefixed) name. */
export interface ManagedMcpTool {
  serverName: string;
  qualifiedName: string;
  rawName: string;
  tool: McpTool;
}

interface ManagedServer {
  config: McpServerConfig;
  process: McpStdioProcess | null;
  initialized: boolean;
}

interface ToolRoute {
  serverName: string;
  rawName: string;
}

/**
 * Spawns and manages MCP server subprocesses over stdio, performs the
 * `initialize` handshake, lists their tools, and exposes them as runtime
 * {@link ToolSpec}s. Mirrors the Rust `McpServerManager`.
 *
 * Offline-safe: the manager only spawns the commands it is configured with and
 * performs no network I/O. In tests it is exercised against local fixture
 * processes (or purely structurally via {@link toolSpecs}).
 */
export class McpClient {
  private readonly servers = new Map<string, ManagedServer>();
  private readonly toolIndex = new Map<string, ToolRoute>();
  private readonly discovered: ManagedMcpTool[] = [];
  private nextRequestId = 1;

  constructor(configs: McpServerConfig[] = []) {
    for (const config of configs) {
      this.servers.set(config.name, { config, process: null, initialized: false });
    }
  }

  serverNames(): string[] {
    return [...this.servers.keys()];
  }

  /** Tools discovered across all servers, qualified with their MCP prefix. */
  tools(): ManagedMcpTool[] {
    return [...this.discovered];
  }

  /** Qualified MCP tools rendered as runtime {@link ToolSpec}s. */
  toolSpecs(): ToolSpec[] {
    return this.discovered.map((t) => ({
      name: t.qualifiedName,
      description: t.tool.description ?? `MCP tool ${t.rawName} on ${t.serverName}`,
      inputSchema: { type: "object", properties: {} },
      // MCP tools invoke a remote server; gate them behind full access.
      requiredPermission: PermissionMode.DangerFullAccess,
    }));
  }

  /**
   * Registers all discovered MCP tools into the runtime by returning a new
   * {@link ToolRegistry} that contains both the existing tools and the MCP
   * tools. The registry is immutable, so callers swap in the returned instance.
   */
  registerInto(registry: ToolRegistry): ToolRegistry {
    return new ToolRegistry([...registry.list(), ...this.toolSpecs()]);
  }

  /**
   * Connects to every configured server: spawns it, performs `initialize`, then
   * paginates `tools/list`, indexing each discovered tool under its qualified
   * name. Returns the full set of discovered tools.
   */
  async discoverAll(): Promise<ManagedMcpTool[]> {
    this.discovered.length = 0;
    this.toolIndex.clear();
    for (const name of this.servers.keys()) {
      await this.discoverServer(name);
    }
    return this.tools();
  }

  private async discoverServer(serverName: string): Promise<void> {
    await this.ensureReady(serverName);
    const server = this.servers.get(serverName);
    if (!server || !server.process) {
      throw new Error(`MCP server process missing after initialize: ${serverName}`);
    }

    let cursor: string | undefined;
    do {
      const response = await server.process.listTools(this.takeRequestId(), { cursor });
      if (response.error) {
        throw new Error(
          `MCP server \`${serverName}\` returned JSON-RPC error for tools/list: ${response.error.message} (${response.error.code})`,
        );
      }
      const result = response.result;
      if (!result) {
        throw new Error(`MCP server \`${serverName}\` returned no result for tools/list`);
      }
      for (const tool of result.tools) {
        const qualifiedName = mcpToolName(serverName, tool.name);
        this.toolIndex.set(qualifiedName, { serverName, rawName: tool.name });
        this.discovered.push({ serverName, qualifiedName, rawName: tool.name, tool });
      }
      cursor = result.nextCursor;
    } while (cursor !== undefined);
  }

  /** Calls a discovered MCP tool by its qualified name. */
  async callTool(qualifiedName: string, args?: unknown): Promise<unknown> {
    const route = this.toolIndex.get(qualifiedName);
    if (!route) {
      throw new Error(`unknown MCP tool \`${qualifiedName}\``);
    }
    await this.ensureReady(route.serverName);
    const server = this.servers.get(route.serverName);
    if (!server || !server.process) {
      throw new Error(`MCP server process missing: ${route.serverName}`);
    }
    const response = await server.process.callTool(this.takeRequestId(), {
      name: route.rawName,
      ...(args !== undefined ? { arguments: args } : {}),
    });
    if (response.error) {
      throw new Error(
        `MCP server \`${route.serverName}\` returned JSON-RPC error for tools/call: ${response.error.message} (${response.error.code})`,
      );
    }
    return response.result;
  }

  /** Shuts down all spawned server processes. */
  async shutdown(): Promise<void> {
    for (const server of this.servers.values()) {
      if (server.process) {
        await server.process.shutdown();
        server.process = null;
        server.initialized = false;
      }
    }
  }

  private async ensureReady(serverName: string): Promise<void> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`unknown MCP server \`${serverName}\``);
    }
    if (!server.process) {
      server.process = McpStdioProcess.spawn(server.config.transport);
      server.initialized = false;
    }
    if (!server.initialized) {
      const response = await server.process.initialize(
        this.takeRequestId(),
        defaultInitializeParams(),
      );
      if (response.error) {
        throw new Error(
          `MCP server \`${serverName}\` returned JSON-RPC error for initialize: ${response.error.message} (${response.error.code})`,
        );
      }
      if (!response.result) {
        throw new Error(`MCP server \`${serverName}\` returned no result for initialize`);
      }
      server.initialized = true;
    }
  }

  private takeRequestId(): JsonRpcId {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return id;
  }
}

export { mcpToolName, mcpToolPrefix, normalizeNameForMcp };
