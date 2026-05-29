/**
 * Shared hook execution types: definitions, backends, outcomes and results.
 *
 * Exit-code semantics (cross-port contract, see the reference hooks.rs files):
 *   - 0       => allow  (stdout, if any, becomes an informational message)
 *   - 2       => deny   (stdout, if any, becomes the denial reason)
 *   - other   => warn   (execution continues; a warning message is recorded)
 */

import type { HookEvent } from "./events.js";
import type { HookMatchRule } from "./match_rule.js";

/** Decision a single hook command/endpoint produced for a tool call. */
export type HookDecision = "allow" | "deny" | "warn";

/** Normalized outcome of running one hook backend. */
export interface HookCommandOutcome {
  decision: HookDecision;
  /** Human-readable message (denial reason / warning / info), if any. */
  message?: string;
}

/** Aggregated result of running all hooks for an event. */
export interface HookRunResult {
  /** True when any hook denied the tool call. */
  denied: boolean;
  /** Ordered messages collected from every hook that produced one. */
  messages: string[];
}

/** Construct an allow-result carrying the given messages. */
export function allowResult(messages: string[] = []): HookRunResult {
  return { denied: false, messages };
}

/** Execution backend for a hook. Discriminated on `type`. */
export type HookBackend =
  | { type: "command"; run: string }
  | { type: "http"; url: string; method?: string; headers?: Record<string, string> };

/** A structured hook definition (settings.json style configuration). */
export interface HookDefinition {
  /** Which event triggers this hook. */
  event: HookEvent;
  /** Execution backend. */
  backend: HookBackend;
  /** Optional match rule (only meaningful for tool events). */
  match?: HookMatchRule;
  /** Timeout in milliseconds (default: 30_000). */
  timeoutMs?: number;
  /** Whether to run asynchronously (non-blocking / fire-and-forget). */
  async?: boolean;
  /** Custom status message to surface while the hook runs. */
  statusMessage?: string;
  /** Fire only once, then auto-remove. */
  once?: boolean;
}

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

/** Context passed to a hook backend when it is invoked. */
export interface HookContext {
  event: HookEvent;
  toolName: string;
  toolInput: string;
  toolOutput?: string;
  isError: boolean;
}

/**
 * Build the JSON stdin payload handed to command hooks, matching the field
 * names emitted by the reference implementation.
 */
export function buildHookPayload(ctx: HookContext): string {
  let toolInput: unknown;
  try {
    toolInput = JSON.parse(ctx.toolInput);
  } catch {
    toolInput = { raw: ctx.toolInput };
  }
  return JSON.stringify({
    hook_event_name: ctx.event,
    tool_name: ctx.toolName,
    tool_input: toolInput,
    tool_input_json: ctx.toolInput,
    tool_output: ctx.toolOutput ?? null,
    tool_result_is_error: ctx.isError,
  });
}

/** Format a warning message for a non-deny, non-zero command outcome. */
export function formatWarning(
  command: string,
  code: number,
  stdout: string,
  stderr: string,
): string {
  let message = `Hook \`${command}\` exited with status ${code}; allowing tool execution to continue`;
  if (stdout.length > 0) {
    message += `: ${stdout}`;
  } else if (stderr.length > 0) {
    message += `: ${stderr}`;
  }
  return message;
}
