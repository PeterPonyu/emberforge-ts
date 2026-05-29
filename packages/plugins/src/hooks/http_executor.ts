/**
 * HTTP hook executor.
 *
 * Issues an HTTP request (default POST) to the configured endpoint with the
 * JSON hook payload as the body, then maps the response to a
 * {@link HookDecision} using the same allow/deny/warn semantics as the command
 * executor's exit codes:
 *
 *   - HTTP 200 (or `{ "decision": "allow" }`) => allow
 *   - HTTP 403 (or `{ "decision": "deny" }`)  => deny
 *   - any other status / transport error      => warn (non-blocking)
 *
 * A JSON body may carry an explicit `{ "decision": "...", "message": "..." }`
 * which overrides the status-code mapping, mirroring how command hooks let
 * stdout carry the human-readable reason.
 */

import {
  DEFAULT_HOOK_TIMEOUT_MS,
  buildHookPayload,
  type HookCommandOutcome,
  type HookContext,
  type HookDecision,
} from "./types.js";

/** A single HTTP hook endpoint definition. */
export interface HttpHookConfig {
  url: string;
  /** HTTP method (default "POST"). */
  method?: string;
  /** Extra request headers merged over the defaults. */
  headers?: Record<string, string>;
  /** Timeout in milliseconds (default 30s). */
  timeoutMs?: number;
}

/** Map an HTTP status code to a decision, mirroring exit-code semantics. */
export function statusToDecision(status: number): HookDecision {
  if (status === 200) return "allow";
  if (status === 403) return "deny";
  return "warn";
}

function coerceDecision(value: unknown): HookDecision | undefined {
  return value === "allow" || value === "deny" || value === "warn" ? value : undefined;
}

/**
 * Run a single HTTP hook and resolve to its normalized outcome.
 *
 * Never rejects: transport failures and timeouts surface as `warn` outcomes so
 * an unreachable endpoint cannot block the tool pipeline.
 */
export async function runHttpHook(
  config: HttpHookConfig,
  ctx: HookContext,
): Promise<HookCommandOutcome> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  const payload = buildHookPayload(ctx);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(config.url, {
      method: config.method ?? "POST",
      headers: {
        "content-type": "application/json",
        "x-hook-event": ctx.event,
        "x-hook-tool-name": ctx.toolName,
        ...(config.headers ?? {}),
      },
      body: payload,
      signal: controller.signal,
    });

    const text = (await response.text()).trim();
    let bodyDecision: HookDecision | undefined;
    let bodyMessage: string | undefined;
    if (text.length > 0) {
      try {
        const parsed = JSON.parse(text) as { decision?: unknown; message?: unknown };
        bodyDecision = coerceDecision(parsed.decision);
        if (typeof parsed.message === "string") {
          bodyMessage = parsed.message;
        }
      } catch {
        // Non-JSON body becomes a plain message.
        bodyMessage = text;
      }
    }

    const decision = bodyDecision ?? statusToDecision(response.status);

    if (decision === "warn" && bodyMessage === undefined) {
      bodyMessage = `${ctx.event} hook ${config.url} responded with HTTP ${response.status}; allowing tool execution to continue`;
    }

    return { decision, message: bodyMessage };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      decision: "warn",
      message: aborted
        ? `${ctx.event} hook ${config.url} timed out after ${timeoutMs}ms while handling \`${ctx.toolName}\``
        : `${ctx.event} hook ${config.url} failed for \`${ctx.toolName}\`: ${reason}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
