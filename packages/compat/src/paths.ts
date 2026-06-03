export interface UpstreamPaths {
  commandsReference: string;
  toolsReference: string;
  runtimeReference: string;
}

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
}

// Optional, opt-in pointers to an external reference implementation used only by
// cross-port comparison tooling. Defaults are neutral placeholders; set the
// corresponding `EMBERFORGE_*` environment variables to point at a local
// reference checkout when running such tooling. Nothing here is surfaced to
// end users at runtime.
export function defaultUpstreamPaths(): UpstreamPaths {
  return {
    commandsReference: envOrDefault("EMBERFORGE_COMMANDS_REFERENCE", "reference/commands"),
    toolsReference: envOrDefault("EMBERFORGE_TOOLS_REFERENCE", "reference/tools"),
    runtimeReference: envOrDefault("EMBERFORGE_RUNTIME_REFERENCE", "reference/runtime"),
  };
}
