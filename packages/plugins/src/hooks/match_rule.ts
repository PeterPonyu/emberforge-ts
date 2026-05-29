/**
 * Hook match rules and glob matching.
 *
 * Mirrors `HookMatchRule` from the reference `crates/runtime/src/hooks.rs`: a
 * rule filters which tool calls trigger a hook by tool name and/or by command
 * patterns. Patterns support a trailing `*` wildcard (case-insensitive
 * substring/prefix containment) matching the reference semantics.
 */

/** Filter describing which tool calls trigger a hook. */
export interface HookMatchRule {
  /** Only trigger for these tool names. Empty / omitted = match all. */
  toolNames?: string[];
  /** Only trigger when the input matches one of these patterns. */
  commands?: string[];
}

/**
 * Glob-style match for a single pattern against `input`, case-insensitive.
 *
 * - A trailing `*` is treated as "contains the prefix before the `*`".
 * - Otherwise the pattern must appear as a substring of the input.
 *
 * This intentionally matches the lenient containment semantics of the Rust
 * reference rather than a full POSIX glob.
 */
export function globMatches(pattern: string, input: string): boolean {
  const p = pattern.toLowerCase();
  const haystack = input.toLowerCase();
  if (p.endsWith("*")) {
    return haystack.includes(p.slice(0, -1));
  }
  return haystack.includes(p);
}

/**
 * Whether `rule` matches the given tool name and (raw) tool input.
 *
 * Empty / omitted fields are treated as "match anything", consistent with the
 * reference implementation.
 */
export function ruleMatches(
  rule: HookMatchRule,
  toolName: string,
  toolInput: string,
): boolean {
  const toolNames = rule.toolNames ?? [];
  if (toolNames.length > 0 && !toolNames.some((name) => name === toolName)) {
    return false;
  }

  const commands = rule.commands ?? [];
  if (commands.length > 0 && !commands.some((pattern) => globMatches(pattern, toolInput))) {
    return false;
  }

  return true;
}
