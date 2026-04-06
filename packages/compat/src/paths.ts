export interface UpstreamPaths {
  claudeCommandsTs: string;
  claudeToolsTs: string;
  emberRuntimeLibRs: string;
}

export function defaultUpstreamPaths(): UpstreamPaths {
  return {
    claudeCommandsTs: "/home/zeyufu/Desktop/claude-code-src/commands.ts",
    claudeToolsTs: "/home/zeyufu/Desktop/claude-code-src/tools.ts",
    emberRuntimeLibRs: "/home/zeyufu/Desktop/emberforge/crates/runtime/src/lib.rs",
  };
}
