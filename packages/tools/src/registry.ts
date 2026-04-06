import type { ToolSpec } from "./spec.js";

export const DEFAULT_TOOLS: ToolSpec[] = [
  { name: "read_file", description: "Read workspace files" },
  { name: "grep_search", description: "Search text across files" },
  { name: "bash", description: "Run shell commands" },
];

export class ToolRegistry {
  constructor(private readonly tools: ToolSpec[] = DEFAULT_TOOLS) {}

  list(): ToolSpec[] {
    return [...this.tools];
  }

  has(toolName: string): boolean {
    return this.tools.some((tool) => tool.name === toolName);
  }
}

export function getTools(): ToolSpec[] {
  return new ToolRegistry().list();
}
