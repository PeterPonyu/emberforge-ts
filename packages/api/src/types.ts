export interface MessageRequest {
  model: string;
  prompt: string;
}

export interface MessageResponse {
  text: string;
}

/**
 * Agentic chat surface (multi-turn tool loop). Mirrors the Rust reference's
 * structured `ApiRequest` / assistant `ContentBlock`s in
 * `crates/runtime/src/conversation.rs`: a turn carries a full conversation
 * (`messages`) plus the available tool specs, and returns BOTH the assistant
 * text AND any structured tool calls so the runtime can loop until the model
 * stops requesting tools.
 */

/** Roles in an agentic conversation. `tool` carries a tool-result message. */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/**
 * A structured tool call requested by the model. Mirrors Ollama's native
 * `message.tool_calls[].function` ({ name, arguments }) and the Rust
 * `ContentBlock::ToolUse { name, input }`. `arguments` is the parsed JSON
 * object the model supplied for the tool's input schema.
 */
export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** One message in an agentic conversation accumulated across loop iterations. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant turns that requested tools. */
  tool_calls?: ToolCall[];
  /** Present on `tool` result messages: the tool whose output this carries. */
  tool_name?: string;
}

/**
 * A tool exposed to the model. Provider-agnostic: the runtime maps the existing
 * tool registry specs into these, and each provider serializes them to its own
 * wire format (e.g. Ollama's `{ type: "function", function: {...} }`).
 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON-schema-shaped input descriptor (reused from the tool registry). */
  parameters: unknown;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  /** The tool specs offered to the model for this turn (may be empty). */
  tools?: ToolDefinition[];
  /**
   * Optional streaming sink. When set, the provider invokes it with each
   * assistant text delta as it arrives, enabling incremental terminal output.
   */
  onText?: (delta: string) => void;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
}
