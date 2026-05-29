/**
 * Command (shell / child_process) hook executor.
 *
 * Spawns the configured command through the platform shell, pipes the JSON
 * payload to stdin, exports the same `HOOK_*` environment variables as the
 * reference Rust implementation, and maps the exit code to a {@link HookDecision}:
 *   - 0     => allow
 *   - 2     => deny
 *   - other => warn
 * Signal termination and spawn failure both degrade to `warn` (non-blocking),
 * matching the cross-port contract.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import {
  DEFAULT_HOOK_TIMEOUT_MS,
  buildHookPayload,
  formatWarning,
  type HookCommandOutcome,
  type HookContext,
} from "./types.js";

const isWindows = process.platform === "win32";

/** Resolve the shell invocation `[program, args]` for a hook command. */
function shellInvocation(command: string): [string, string[]] {
  if (isWindows) {
    return ["cmd", ["/C", command]];
  }
  // An existing executable file is run directly; otherwise treat as a snippet.
  if (existsSync(command)) {
    return ["sh", [command]];
  }
  return ["sh", ["-lc", command]];
}

/** Options controlling a single command-hook invocation. */
export interface CommandExecutorOptions {
  /** Timeout in milliseconds before the child is killed (default 30s). */
  timeoutMs?: number;
}

/**
 * Run a single shell command hook and resolve to its normalized outcome.
 *
 * Never rejects: failures are surfaced as `warn` outcomes so a misbehaving
 * hook cannot crash the tool pipeline.
 */
export function runCommandHook(
  command: string,
  ctx: HookContext,
  options: CommandExecutorOptions = {},
): Promise<HookCommandOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  const payload = buildHookPayload(ctx);
  const [program, args] = shellInvocation(command);

  return new Promise((resolve) => {
    const child = spawn(program, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HOOK_EVENT: ctx.event,
        HOOK_TOOL_NAME: ctx.toolName,
        HOOK_TOOL_INPUT: ctx.toolInput,
        HOOK_TOOL_IS_ERROR: ctx.isError ? "1" : "0",
        ...(ctx.toolOutput !== undefined ? { HOOK_TOOL_OUTPUT: ctx.toolOutput } : {}),
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (outcome: HookCommandOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        decision: "warn",
        message: `${ctx.event} hook \`${command}\` timed out after ${timeoutMs}ms while handling \`${ctx.toolName}\``,
      });
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: Error) => {
      finish({
        decision: "warn",
        message: `${ctx.event} hook \`${command}\` failed to start for \`${ctx.toolName}\`: ${error.message}`,
      });
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      const out = stdout.trim();
      const err = stderr.trim();
      const message = out.length > 0 ? out : undefined;

      if (code === 0) {
        finish({ decision: "allow", message });
      } else if (code === 2) {
        finish({ decision: "deny", message });
      } else if (code === null) {
        finish({
          decision: "warn",
          message: `${ctx.event} hook \`${command}\` terminated by signal ${signal ?? "unknown"} while handling \`${ctx.toolName}\``,
        });
      } else {
        finish({ decision: "warn", message: formatWarning(command, code, out, err) });
      }
    });

    // Pipe the JSON payload to the hook's stdin; ignore broken pipes.
    child.stdin?.on("error", () => {
      /* hook closed stdin early; ignore */
    });
    child.stdin?.end(payload);
  });
}
