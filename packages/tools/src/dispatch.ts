import { PermissionMode } from "./spec.js";
import type { ToolExecutor } from "./executor.js";
import { ToolRegistry } from "./registry.js";

/** Raised when a tool's required permission exceeds the active mode. */
export class PermissionDeniedError extends Error {
  constructor(
    readonly toolName: string,
    readonly required: PermissionMode,
    readonly active: PermissionMode,
  ) {
    super(
      `tool '${toolName}' requires ${permissionName(required)} permission; ` +
        `active mode is ${permissionName(active)}`,
    );
    this.name = "PermissionDeniedError";
  }
}

/** Raised when a tool has no local executor wired up (structural-only specs). */
export class UnsupportedToolError extends Error {
  constructor(readonly toolName: string) {
    super(`tool '${toolName}' has no local executor`);
    this.name = "UnsupportedToolError";
  }
}

function permissionName(mode: PermissionMode): string {
  switch (mode) {
    case PermissionMode.ReadOnly:
      return "read-only";
    case PermissionMode.WorkspaceWrite:
      return "workspace-write";
    case PermissionMode.DangerFullAccess:
      return "danger-full-access";
  }
}

/** Tools that have a real local executor implementation. */
const LOCAL_TOOLS = new Set([
  "bash",
  "read_file",
  "write_file",
  "edit_file",
  "glob_search",
  "grep_search",
]);

/**
 * Routes tool calls through a permission gate before delegating to the
 * underlying executor (EFPORT-7). Looks each tool up in the registry to read
 * its required permission, compares it against the active mode, and only then
 * invokes the executor. Tools without a local executor (web/notebook/agent/
 * skill / MCP) raise {@link UnsupportedToolError}.
 */
export class ToolDispatcher {
  constructor(
    private readonly executor: ToolExecutor,
    private readonly registry: ToolRegistry = new ToolRegistry(),
    private readonly activeMode: PermissionMode = PermissionMode.DangerFullAccess,
  ) {}

  /** Whether the active mode satisfies a tool's required permission. */
  isAllowed(toolName: string): boolean {
    const spec = this.registry.get(toolName);
    if (!spec) {
      return false;
    }
    return this.activeMode >= spec.requiredPermission;
  }

  async dispatch(toolName: string, input: string): Promise<string> {
    const spec = this.registry.get(toolName);
    if (!spec) {
      throw new UnsupportedToolError(toolName);
    }
    if (this.activeMode < spec.requiredPermission) {
      throw new PermissionDeniedError(toolName, spec.requiredPermission, this.activeMode);
    }
    if (!LOCAL_TOOLS.has(toolName)) {
      throw new UnsupportedToolError(toolName);
    }
    return this.executor.execute(toolName, input);
  }
}
