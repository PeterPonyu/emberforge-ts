/**
 * Hook & lifecycle dispatcher.
 *
 * Holds a set of {@link HookDefinition}s and drives the cross-port dispatch
 * loop: for a given event it selects the matching definitions, runs each
 * backend (command or HTTP), aggregates messages, and short-circuits on the
 * first `deny`. Lifecycle (non-tool) events are fire-and-forget.
 *
 * This is the WIP skeleton: it implements the core dispatch/deny/warn loop and
 * the convenience pre/post tool-use entry points. Wiring it into the live tool
 * execution pipeline is tracked as a follow-up (see PR checklist).
 */

import { isToolEvent, type HookEvent } from "./events.js";
import { ruleMatches } from "./match_rule.js";
import { runCommandHook } from "./command_executor.js";
import { runHttpHook } from "./http_executor.js";
import {
  allowResult,
  type HookCommandOutcome,
  type HookContext,
  type HookDefinition,
  type HookRunResult,
} from "./types.js";

/** Dispatches hook definitions for lifecycle and tool events. */
export class HookDispatcher {
  private readonly definitions: HookDefinition[];

  constructor(definitions: HookDefinition[] = []) {
    this.definitions = [...definitions];
  }

  /** All registered definitions (defensive copy). */
  list(): HookDefinition[] {
    return [...this.definitions];
  }

  /** Register an additional hook definition. */
  register(definition: HookDefinition): void {
    this.definitions.push(definition);
  }

  /** Definitions for `event` whose match rule accepts the tool/input. */
  private select(event: HookEvent, toolName: string, toolInput: string): HookDefinition[] {
    return this.definitions.filter((def) => {
      if (def.event !== event) return false;
      if (def.match && !ruleMatches(def.match, toolName, toolInput)) return false;
      return true;
    });
  }

  private async runBackend(
    def: HookDefinition,
    ctx: HookContext,
  ): Promise<HookCommandOutcome> {
    if (def.backend.type === "command") {
      return runCommandHook(def.backend.run, ctx, { timeoutMs: def.timeoutMs });
    }
    return runHttpHook(
      {
        url: def.backend.url,
        method: def.backend.method,
        headers: def.backend.headers,
        timeoutMs: def.timeoutMs,
      },
      ctx,
    );
  }

  /**
   * Dispatch `event` with the given context, running every matching hook in
   * order. Stops at the first denial. Returns the aggregated result.
   */
  async dispatch(ctx: HookContext): Promise<HookRunResult> {
    const matched = this.select(ctx.event, ctx.toolName, ctx.toolInput);
    if (matched.length === 0) {
      return allowResult();
    }

    const messages: string[] = [];
    for (const def of matched) {
      const outcome = await this.runBackend(def, ctx);
      if (outcome.decision === "deny") {
        messages.push(
          outcome.message ?? `${ctx.event} hook denied tool \`${ctx.toolName}\``,
        );
        return { denied: true, messages };
      }
      if (outcome.message !== undefined) {
        messages.push(outcome.message);
      }
    }
    return allowResult(messages);
  }

  /** Convenience: run PreToolUse hooks for a tool call. */
  runPreToolUse(toolName: string, toolInput: string): Promise<HookRunResult> {
    return this.dispatch({
      event: "PreToolUse",
      toolName,
      toolInput,
      isError: false,
    });
  }

  /** Convenience: run PostToolUse hooks for a completed tool call. */
  runPostToolUse(
    toolName: string,
    toolInput: string,
    toolOutput: string,
    isError: boolean,
  ): Promise<HookRunResult> {
    return this.dispatch({
      event: "PostToolUse",
      toolName,
      toolInput,
      toolOutput,
      isError,
    });
  }

  /**
   * Fire a lifecycle (non-tool) event. Fire-and-forget: the returned promise
   * resolves once dispatch completes, but callers may ignore it. Denials from
   * lifecycle events are not enforced.
   */
  async fireEvent(event: HookEvent, contextKey = "", contextValue = ""): Promise<void> {
    if (isToolEvent(event)) {
      // Tool events should go through dispatch()/run*ToolUse for deny handling.
      await this.dispatch({
        event,
        toolName: contextKey,
        toolInput: contextValue,
        isError: false,
      });
      return;
    }
    await this.dispatch({
      event,
      toolName: contextKey,
      toolInput: contextValue,
      isError: false,
    });
  }
}
