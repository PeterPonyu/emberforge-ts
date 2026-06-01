import { PermissionMode, type ToolSpec } from "./spec.js";

/**
 * The full built-in tool registry (EFPORT-7). Schemas and permission tiers
 * mirror the Rust canonical specs in `crates/tools/src/specs.rs`. Local tools
 * (bash/read/write/edit/glob/grep) have real executors; web/notebook/agent/
 * skill are permission-gated structural specs.
 */
export const DEFAULT_TOOLS: ToolSpec[] = [
  {
    name: "bash",
    description: "Execute a shell command in the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout: { type: "integer", minimum: 1 },
        description: { type: "string" },
        run_in_background: { type: "boolean" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    requiredPermission: PermissionMode.DangerFullAccess,
  },
  {
    name: "read_file",
    description: "Read a text file from the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
    requiredPermission: PermissionMode.ReadOnly,
  },
  {
    name: "write_file",
    description: "Write a text file in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    requiredPermission: PermissionMode.WorkspaceWrite,
  },
  {
    name: "edit_file",
    description: "Replace text in a workspace file.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false,
    },
    requiredPermission: PermissionMode.WorkspaceWrite,
  },
  {
    name: "glob_search",
    description: "Find files by glob pattern.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    requiredPermission: PermissionMode.ReadOnly,
  },
  {
    name: "grep_search",
    description: "Search file contents with a regex pattern.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        "-i": { type: "boolean" },
        "-n": { type: "boolean" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    requiredPermission: PermissionMode.ReadOnly,
  },
  {
    name: "web",
    description: "Fetch a URL or run a web search and return readable text.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        query: { type: "string" },
        prompt: { type: "string" },
      },
      additionalProperties: false,
    },
    requiredPermission: PermissionMode.ReadOnly,
  },
  {
    name: "notebook",
    description: "Replace, insert, or delete a cell in a Jupyter notebook.",
    inputSchema: {
      type: "object",
      properties: {
        notebook_path: { type: "string" },
        cell_id: { type: "string" },
        new_source: { type: "string" },
        cell_type: { type: "string" },
        edit_mode: { type: "string" },
      },
      required: ["notebook_path"],
      additionalProperties: false,
    },
    requiredPermission: PermissionMode.WorkspaceWrite,
  },
  {
    name: "agent",
    description: "Launch a specialized agent task and persist its handoff metadata.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        prompt: { type: "string" },
        subagent_type: { type: "string" },
        model: { type: "string" },
      },
      required: ["description", "prompt"],
      additionalProperties: false,
    },
    requiredPermission: PermissionMode.DangerFullAccess,
  },
  {
    name: "skill",
    description: "Load a local skill definition and its instructions.",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string" },
        args: { type: "string" },
      },
      required: ["skill"],
      additionalProperties: false,
    },
    requiredPermission: PermissionMode.ReadOnly,
  },
];

export class ToolRegistry {
  constructor(private readonly tools: ToolSpec[] = DEFAULT_TOOLS) {}

  list(): ToolSpec[] {
    return [...this.tools];
  }

  has(toolName: string): boolean {
    return this.tools.some((tool) => tool.name === toolName);
  }

  get(toolName: string): ToolSpec | undefined {
    return this.tools.find((tool) => tool.name === toolName);
  }
}

export function getTools(): ToolSpec[] {
  return new ToolRegistry().list();
}
