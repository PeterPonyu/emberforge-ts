/**
 * Hook & lifecycle event model.
 *
 * Mirrors the cross-port contract (see the reference Rust implementation at
 * `crates/plugins/src/hooks.rs` and `crates/runtime/src/hooks.rs`). The TS port
 * exposes the unified set of 17 lifecycle/hook events that plugins and custom
 * script integrations may subscribe to.
 */

/** The 17 hook/lifecycle event names from the cross-port contract. */
export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "SessionEnd",
  "SubagentStart",
  "SubagentStop",
  "CompactStart",
  "CompactEnd",
  "PreCompact",
  "ToolError",
  "PermissionDenied",
  "ConfigChange",
  "UserPromptSubmit",
  "Notification",
  "PluginLoad",
  "PluginUnload",
  "Stop",
] as const;

/** Union of every hook/lifecycle event name. */
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** Runtime guard: is `value` a known {@link HookEvent}. */
export function isHookEvent(value: string): value is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(value);
}

/**
 * Whether an event carries tool context (a `tool_name` / `tool_input`).
 *
 * Tool events run the deny/warn pipeline against their exit code; lifecycle
 * events are fire-and-forget.
 */
export function isToolEvent(event: HookEvent): boolean {
  return (
    event === "PreToolUse" ||
    event === "PostToolUse" ||
    event === "ToolError" ||
    event === "PermissionDenied"
  );
}
