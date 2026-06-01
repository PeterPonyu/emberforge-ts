/**
 * MCP tool/server name normalization, mirroring `crates/runtime/src/mcp.rs`.
 * Characters outside `[A-Za-z0-9_-]` are replaced with `_` so server and tool
 * names can be safely composed into qualified tool identifiers.
 */
const CLAUDEAI_SERVER_PREFIX = "claude.ai ";

export function normalizeNameForMcp(name: string): string {
  let normalized = "";
  for (const ch of name) {
    if (/[a-zA-Z0-9_-]/.test(ch)) {
      normalized += ch;
    } else {
      normalized += "_";
    }
  }
  if (name.startsWith(CLAUDEAI_SERVER_PREFIX)) {
    normalized = collapseUnderscores(normalized).replace(/^_+|_+$/g, "");
  }
  return normalized;
}

export function mcpToolPrefix(serverName: string): string {
  return `mcp__${normalizeNameForMcp(serverName)}__`;
}

export function mcpToolName(serverName: string, toolName: string): string {
  return `${mcpToolPrefix(serverName)}${normalizeNameForMcp(toolName)}`;
}

function collapseUnderscores(value: string): string {
  let collapsed = "";
  let lastWasUnderscore = false;
  for (const ch of value) {
    if (ch === "_") {
      if (!lastWasUnderscore) {
        collapsed += ch;
      }
      lastWasUnderscore = true;
    } else {
      collapsed += ch;
      lastWasUnderscore = false;
    }
  }
  return collapsed;
}
