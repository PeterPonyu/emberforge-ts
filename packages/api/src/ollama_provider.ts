import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  MessageRequest,
  MessageResponse,
  ToolCall,
} from "./types.js";
import type { Provider } from "./provider.js";
import { buildAgentSystemPrompt } from "./system_prompt.js";

/**
 * Env flag that reveals separated thinking/reasoning content. Named constant
 * (not a buried literal), default OFF — mirrors the Rust reference where the
 * `thinking_visible` toggle is off unless the user opts in. When truthy, the
 * provider writes the model's reasoning to stderr; stdout always stays the final
 * answer only.
 */
export const EMBER_SHOW_THINKING_ENV = "EMBER_SHOW_THINKING";

/**
 * Model families that emit a separate reasoning channel, mirroring the Rust
 * reference's `THINKING_FAMILIES` (`crates/runtime/src/model_profiles.rs:65`).
 * For these we request Ollama's structured `think` mode so reasoning arrives in
 * `message.thinking` instead of being inlined into the answer.
 */
export const THINKING_FAMILIES = ["qwen3", "deepseek-r1"] as const;

/** Whether `model` is a known thinking model (case-insensitive family prefix). */
export function isThinkingModel(model: string): boolean {
  const family = model.toLowerCase();
  return THINKING_FAMILIES.some((prefix) => family.startsWith(prefix));
}

/** Whether reasoning should be surfaced, per {@link EMBER_SHOW_THINKING_ENV}. */
export function shouldShowThinking(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[EMBER_SHOW_THINKING_ENV];
  if (raw === undefined) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false" && normalized !== "off";
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/**
 * Longest suffix of `s` that is a strict prefix of `marker`. Lets the streaming
 * separator hold back a partial `</think>` that may be split across NDJSON
 * chunks instead of misclassifying it.
 */
function partialMarkerSuffix(s: string, marker: string): number {
  const max = Math.min(s.length, marker.length - 1);
  for (let k = max; k > 0; k -= 1) {
    if (s.slice(s.length - k) === marker.slice(0, k)) return k;
  }
  return 0;
}

/**
 * Streaming separator that splits a model's output into the final ANSWER and its
 * THINKING/reasoning, mirroring the Rust reference's separate-channel handling.
 * It does two things, both incremental so it works mid-stream:
 *
 * - Accumulates structured `message.thinking` deltas (preferred channel) via
 *   {@link addStructuredThinking} — these never reach the answer.
 * - Strips a single well-formed LEADING `<think>...</think>` block from the
 *   content channel (the inline fallback some models use). It only treats a
 *   block as thinking when content *starts* with `<think>`; legitimate later
 *   `<think>` text is left untouched (no regex-mangling).
 *
 * `pushContent` returns only the answer text safe to emit so far.
 */
export class ThinkStreamSeparator {
  private state: "detecting" | "thinking" | "answer" = "detecting";
  private pending = "";
  private thinking = "";

  /** Feed a content delta; returns the answer text to emit now (may be empty). */
  pushContent(delta: string): string {
    this.pending += delta;
    let emit = "";
    for (;;) {
      if (this.state === "detecting") {
        const lstripped = this.pending.replace(/^\s+/, "");
        if (lstripped === "") return emit; // only whitespace so far — keep buffering
        if (lstripped.startsWith(THINK_OPEN)) {
          this.pending = lstripped.slice(THINK_OPEN.length);
          this.state = "thinking";
          continue;
        }
        if (THINK_OPEN.startsWith(lstripped)) return emit; // could still become <think>
        // Not a leading think block: flush everything as answer.
        emit += this.pending;
        this.pending = "";
        this.state = "answer";
        return emit;
      }
      if (this.state === "thinking") {
        const idx = this.pending.indexOf(THINK_CLOSE);
        if (idx === -1) {
          // Hold back a possible partial close; the rest is reasoning.
          const keep = partialMarkerSuffix(this.pending, THINK_CLOSE);
          this.thinking += this.pending.slice(0, this.pending.length - keep);
          this.pending = this.pending.slice(this.pending.length - keep);
          return emit;
        }
        this.thinking += this.pending.slice(0, idx);
        this.pending = this.pending.slice(idx + THINK_CLOSE.length);
        if (this.pending.startsWith("\n")) this.pending = this.pending.slice(1);
        this.state = "answer";
        continue;
      }
      // answer state: everything flows straight through.
      emit += this.pending;
      this.pending = "";
      return emit;
    }
  }

  /** Accumulate a structured `message.thinking` delta (preferred channel). */
  addStructuredThinking(delta: string): void {
    this.thinking += delta;
  }

  /** Flush any buffered content at stream end; returns the final answer tail. */
  finish(): string {
    if (this.state === "thinking") {
      // Unterminated leading think block → the remainder is all reasoning.
      this.thinking += this.pending;
      this.pending = "";
      return "";
    }
    // detecting (never matched a full <think>) or answer → remainder is answer.
    const out = this.pending;
    this.pending = "";
    this.state = "answer";
    return out;
  }

  /** The accumulated reasoning content (answer-free). */
  get thinkingText(): string {
    return this.thinking;
  }
}

/**
 * Surfaces separated reasoning to stderr when {@link shouldShowThinking}. Kept
 * provider-level so both the REPL and one-shot prompt paths benefit, and so
 * stdout stays the answer only.
 */
function emitThinking(thinking: string, env: Record<string, string | undefined>): void {
  const trimmed = thinking.trim();
  if (trimmed !== "" && shouldShowThinking(env)) {
    process.stderr.write(`[thinking] ${trimmed}\n`);
  }
}

/**
 * Normalizes an Ollama base URL so both the root form (`http://HOST:PORT`) and
 * the OpenAI-compat form (`http://HOST:PORT/v1`) resolve to the same native
 * endpoint root. The provider talks to Ollama's native API (`/api/chat`), so a
 * trailing `/v1` (the OpenAI-compatibility path) must be stripped before the
 * native path is appended — otherwise `.../v1/api/chat` 404s. Idempotent and
 * host/port-agnostic: trailing slashes and at most one trailing `/v1` segment
 * are removed, leaving any other path untouched.
 */
export function normalizeOllamaBaseURL(raw: string): string {
  let base = raw.trim().replace(/\/+$/, "");
  if (/\/v1$/i.test(base)) {
    base = base.slice(0, -"/v1".length).replace(/\/+$/, "");
  }
  return base;
}

/**
 * Default output-token bound for local Ollama models. Mirrors the Rust
 * reference's `max_tokens_for_model` non-opus default (64_000): generous enough
 * that normal answers are never truncated, while still bounding pathological
 * runaway generation from thinking models (e.g. qwen3's unbounded `<think>`).
 */
export const DEFAULT_OLLAMA_NUM_PREDICT = 64_000;

/**
 * Output-token bound for opus-class models. Mirrors the Rust reference's
 * `max_tokens_for_model` opus branch (32_000).
 */
export const OPUS_OLLAMA_NUM_PREDICT = 32_000;

/**
 * Model-aware output-token bound, mirroring the Rust reference's
 * `max_tokens_for_model` intent: opus-class models get a tighter bound, all
 * others (the local Ollama tags this provider serves) get the generous default.
 */
export function maxTokensForModel(model: string): number {
  return model.toLowerCase().includes("opus")
    ? OPUS_OLLAMA_NUM_PREDICT
    : DEFAULT_OLLAMA_NUM_PREDICT;
}

/**
 * Parses an explicit num_predict override (constructor arg or `OLLAMA_NUM_PREDICT`
 * env var). Returns `undefined` for absent/blank/invalid values so the caller
 * falls back to the model-aware default rather than sending a bogus bound.
 * Only positive integers are accepted (`-1` would mean "unbounded" to Ollama,
 * which defeats the purpose of this fix).
 */
export function parseNumPredict(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

export class OllamaProvider implements Provider {
  private readonly baseURL: string;
  private readonly model: string;
  /**
   * Explicit output-token bound. When set (constructor arg or `OLLAMA_NUM_PREDICT`
   * env var) it overrides the model-aware default; when `undefined` the bound is
   * resolved per-request via {@link maxTokensForModel}.
   */
  private readonly numPredict?: number;

  constructor(baseURL?: string, model?: string, numPredict?: number) {
    const resolved = baseURL ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    this.baseURL = normalizeOllamaBaseURL(resolved);
    this.model = model ?? process.env.OLLAMA_MODEL ?? process.env.EMBER_MODEL ?? "qwen3:8b";
    this.numPredict = numPredict ?? parseNumPredict(process.env.OLLAMA_NUM_PREDICT);
  }

  async sendMessage(request: MessageRequest): Promise<MessageResponse> {
    const effectiveModel = request.model || this.model;
    // Bound output generation so thinking models (e.g. qwen3) cannot run away
    // emitting `<think>` tokens until natural stop. Configurable via the
    // constructor or `OLLAMA_NUM_PREDICT`; otherwise a generous model-aware
    // default mirroring the Rust reference's `max_tokens_for_model`.
    const numPredict = this.numPredict ?? maxTokensForModel(effectiveModel);
    const body: Record<string, unknown> = {
      model: effectiveModel,
      // Prepend the canonical agent system prompt WITH fresh dynamic context
      // (git state, EMBER.md/CLAW.md instructions, settings) — parity with the
      // Rust reference's `load_system_prompt` — ahead of the user message.
      messages: [
        { role: "system", content: buildAgentSystemPrompt() },
        { role: "user", content: request.prompt },
      ],
      stream: true,
      options: { num_predict: numPredict },
    };
    // Thinking models route reasoning into the structured `message.thinking`
    // channel when asked; the separator still strips any inline <think> block.
    if (isThinkingModel(effectiveModel)) {
      body.think = true;
    }
    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const separator = new ThinkStreamSeparator();

    const finalize = (): MessageResponse => {
      text += separator.finish();
      emitThinking(separator.thinkingText, process.env);
      return { text };
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const obj = JSON.parse(line) as OllamaChatChunk;
        if (obj.message?.thinking) separator.addStructuredThinking(obj.message.thinking);
        if (obj.message?.content) text += separator.pushContent(obj.message.content);
        if (obj.done) return finalize();
      }
    }

    return finalize();
  }

  /**
   * Agentic chat turn using Ollama's NATIVE tool-calling. Sends the supplied
   * conversation `messages` and the available tool specs as the `tools` array on
   * `/api/chat`, streams assistant text deltas (surfaced via `request.onText`),
   * and collects any structured `message.tool_calls` from the response. The
   * runtime drives the multi-turn loop; this method returns one turn's text +
   * tool calls. Mirrors the Rust reference's structured `ApiRequest` → assistant
   * message (`crates/runtime/src/conversation.rs`).
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const effectiveModel = request.model || this.model;
    const numPredict = this.numPredict ?? maxTokensForModel(effectiveModel);

    const body: Record<string, unknown> = {
      model: effectiveModel,
      messages: request.messages.map(toOllamaMessage),
      stream: true,
      options: { num_predict: numPredict },
    };
    // Thinking models route reasoning into the structured `message.thinking`
    // channel; the separator also strips any inline leading <think> block so the
    // streamed answer (and tool-call turns) never leak reasoning.
    if (isThinkingModel(effectiveModel)) {
      body.think = true;
    }
    // Reuse the existing tool registry specs verbatim (no hardcoded schemas):
    // map each into Ollama's native function-tool shape.
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const toolCalls: ToolCall[] = [];
    const separator = new ThinkStreamSeparator();

    const finalize = (): ChatResponse => {
      const tail = separator.finish();
      if (tail) {
        text += tail;
        request.onText?.(tail);
      }
      emitThinking(separator.thinkingText, process.env);
      return { text, toolCalls };
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const obj = JSON.parse(line) as OllamaChatChunk;
        if (obj.message?.thinking) separator.addStructuredThinking(obj.message.thinking);
        const delta = obj.message?.content;
        if (delta) {
          // Stream only the ANSWER portion; reasoning is held back by the
          // separator so it never reaches stdout.
          const answer = separator.pushContent(delta);
          if (answer) {
            text += answer;
            request.onText?.(answer);
          }
        }
        // Tool calls arrive in the aggregated message (one chunk before/at
        // `done`); collect them from any chunk that carries them.
        for (const raw of obj.message?.tool_calls ?? []) {
          const name = raw.function?.name;
          if (name) {
            toolCalls.push({ name, arguments: normalizeToolArguments(raw.function?.arguments) });
          }
        }
        if (obj.done) return finalize();
      }
    }

    return finalize();
  }
}

/** Ollama `/api/chat` NDJSON chunk shape (the fields this provider reads). */
interface OllamaChatChunk {
  message?: {
    content?: string;
    /** Structured reasoning channel emitted by thinking models in `think` mode. */
    thinking?: string;
    tool_calls?: Array<{
      function?: { name?: string; arguments?: unknown };
    }>;
  };
  done?: boolean;
}

/** Serialize an internal {@link ChatMessage} to Ollama's wire message shape. */
function toOllamaMessage(message: ChatMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: message.role, content: message.content };
  if (message.tool_calls && message.tool_calls.length > 0) {
    wire.tool_calls = message.tool_calls.map((call) => ({
      function: { name: call.name, arguments: call.arguments },
    }));
  }
  if (message.tool_name) {
    wire.tool_name = message.tool_name;
  }
  return wire;
}

/**
 * Normalize Ollama's tool-call `arguments` into a plain object. The native API
 * returns an object, but some builds return a JSON string; tolerate both and
 * degrade to an empty object on malformed input.
 */
function normalizeToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") {
    return raw as Record<string, unknown>;
  }
  return {};
}
