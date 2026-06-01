/**
 * JSON-RPC and Model Context Protocol message shapes for the stdio transport,
 * mirroring `crates/runtime/src/mcp_stdio.rs`. Field names use the camelCase
 * wire format expected by MCP servers (e.g. `protocolVersion`, `inputSchema`).
 */
export type JsonRpcId = number | string | null;

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: T;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id: JsonRpcId;
  result?: T;
  error?: JsonRpcError;
}

export interface McpInitializeClientInfo {
  name: string;
  version: string;
}

export interface McpInitializeParams {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  clientInfo: McpInitializeClientInfo;
}

export interface McpInitializeServerInfo {
  name: string;
  version: string;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: McpInitializeServerInfo;
}

export interface McpListToolsParams {
  cursor?: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
  _meta?: unknown;
}

export interface McpListToolsResult {
  tools: McpTool[];
  nextCursor?: string;
}

export interface McpToolCallParams {
  name: string;
  arguments?: unknown;
  _meta?: unknown;
}

export interface McpToolCallContent {
  type: string;
  [key: string]: unknown;
}

export interface McpToolCallResult {
  content?: McpToolCallContent[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: unknown;
}

/**
 * Stdio transport descriptor for an MCP server subprocess, mirroring the Rust
 * `McpStdioTransport`.
 */
export interface McpStdioTransport {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const DEFAULT_PROTOCOL_VERSION = "2025-03-26";

export function defaultInitializeParams(): McpInitializeParams {
  return {
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "emberforge-ts", version: "0.1.0" },
  };
}
