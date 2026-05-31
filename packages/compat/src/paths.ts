export interface UpstreamPaths {
  claudeCommandsTs: string;
  claudeToolsTs: string;
  emberRuntimeLibRs: string;
}

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

export function defaultUpstreamPaths(): UpstreamPaths {
  return {
    claudeCommandsTs: envOrDefault("EMBERFORGE_CLAUDE_COMMANDS_TS", "claude-code-src/commands.ts"),
    claudeToolsTs: envOrDefault("EMBERFORGE_CLAUDE_TOOLS_TS", "claude-code-src/tools.ts"),
    emberRuntimeLibRs: envOrDefault("EMBERFORGE_RUNTIME_LIB_RS", "crates/runtime/src/lib.rs"),
  };
}
