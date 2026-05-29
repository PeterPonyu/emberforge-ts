export type { Plugin, PluginMetadata } from "./types.js";
export { ExamplePlugin, PluginRegistry, getPlugins } from "./registry.js";
export {
  HOOK_EVENTS,
  HookDispatcher,
  DEFAULT_HOOK_TIMEOUT_MS,
  allowResult,
  buildHookPayload,
  formatWarning,
  globMatches,
  isHookEvent,
  isToolEvent,
  runCommandHook,
  runHttpHook,
  ruleMatches,
  statusToDecision,
  type CommandExecutorOptions,
  type HookBackend,
  type HookCommandOutcome,
  type HookContext,
  type HookDecision,
  type HookDefinition,
  type HookEvent,
  type HookMatchRule,
  type HookRunResult,
  type HttpHookConfig,
} from "./hooks/index.js";

export const RUST_PLUGINS_REFERENCE = "/home/zeyufu/Desktop/emberforge/crates/plugins/src/types.rs";
