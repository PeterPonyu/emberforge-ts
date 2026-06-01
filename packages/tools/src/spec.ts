/**
 * Tool specifications (EFPORT-7). Each spec carries a JSON-schema-shaped input
 * descriptor and the permission required to execute it, mirroring the Rust
 * `ToolSpec` in `crates/tools/src/specs.rs`.
 */

/**
 * Permission tiers, ordered least → most privileged. Mirrors the Rust
 * `PermissionMode` (the subset relevant to tool requirements). The numeric
 * ordering lets the dispatcher compare an active mode against a requirement.
 */
export enum PermissionMode {
  ReadOnly = 0,
  WorkspaceWrite = 1,
  DangerFullAccess = 2,
}

/** Minimal JSON-schema-shaped descriptor for a tool's input. */
export interface InputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: InputSchema;
  requiredPermission: PermissionMode;
}
