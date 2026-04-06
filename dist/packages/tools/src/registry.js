export const DEFAULT_TOOLS = [
    { name: "read_file", description: "Read workspace files" },
    { name: "grep_search", description: "Search text across files" },
    { name: "bash", description: "Run shell commands" },
];
export class ToolRegistry {
    tools;
    constructor(tools = DEFAULT_TOOLS) {
        this.tools = tools;
    }
    list() {
        return [...this.tools];
    }
    has(toolName) {
        return this.tools.some((tool) => tool.name === toolName);
    }
}
export function getTools() {
    return new ToolRegistry().list();
}
