export { McpClient } from "./client.js";
export type { McpServerConfig, ManagedMcpTool } from "./client.js";
export { McpStdioProcess, encodeFrame } from "./stdio.js";
export { normalizeNameForMcp, mcpToolPrefix, mcpToolName } from "./names.js";
export {
  DEFAULT_PROTOCOL_VERSION,
  defaultInitializeParams,
} from "./types.js";
export type {
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  McpInitializeParams,
  McpInitializeResult,
  McpInitializeClientInfo,
  McpInitializeServerInfo,
  McpListToolsParams,
  McpListToolsResult,
  McpTool,
  McpToolCallParams,
  McpToolCallResult,
  McpToolCallContent,
  McpStdioTransport,
} from "./types.js";

export const RUST_MCP_REFERENCE = "crates/runtime/src/mcp_stdio.rs";
