export type { MessageRequest, MessageResponse } from "./types.js";
export type {
  ChatRole,
  ToolCall,
  ChatMessage,
  ToolDefinition,
  ChatRequest,
  ChatResponse,
} from "./types.js";
export { DEFAULT_MODEL } from "./provider.js";
export type { Provider } from "./provider.js";
export { MockProvider } from "./mock_provider.js";
export { OllamaProvider, normalizeOllamaBaseURL } from "./ollama_provider.js";
export { AnthropicProvider, DEFAULT_ANTHROPIC_BASE_URL } from "./anthropic_provider.js";
export type { AnthropicProviderOptions } from "./anthropic_provider.js";
export { XaiProvider, DEFAULT_XAI_BASE_URL } from "./xai_provider.js";
export type { XaiProviderOptions } from "./xai_provider.js";
export {
  resolveAnthropicAuth,
  applyAnthropicAuth,
  resolveXaiApiKey,
  readEnvNonEmpty,
} from "./auth.js";
export type { AnthropicSettings, XaiSettings, EnvMap } from "./auth.js";
export { globalFetch } from "./transport.js";
export type { FetchLike, FetchResponse } from "./transport.js";
export { detectProviderKind, resolveProvider } from "./router.js";
export type { ProviderKind, ProviderSettings, RouterOptions } from "./router.js";
export {
  buildSystemPrompt,
  buildAgentSystemPrompt,
  renderEnvironmentSection,
  renderProjectContext,
  renderInstructionFiles,
  renderConfigSection,
  discoverProjectContext,
  discoverProjectContextWithGit,
  discoverInstructionFiles,
  discoverConfigFiles,
  readGitStatus,
  readGitDiff,
  FRONTIER_MODEL_NAME,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  SYSTEM_PROMPT_INTRO_MARKER,
  INTRO_SECTION,
  SYSTEM_SECTION,
  DOING_TASKS_SECTION,
  TOOL_USAGE_SECTION,
  ACTIONS_SECTION,
  MAX_INSTRUCTION_FILE_CHARS,
  MAX_TOTAL_INSTRUCTION_CHARS,
  INSTRUCTION_FILE_CANDIDATES,
  CONFIG_FILE_CANDIDATES,
} from "./system_prompt.js";
export type {
  EnvironmentContext,
  BuildSystemPromptOptions,
  ProjectContext,
  ContextFile,
  ConfigFile,
} from "./system_prompt.js";
export {
  estimateComplexity,
  selectModel,
  parseStrategy,
  listOllamaModels,
  discoverAvailableModels,
  renderAvailableModelsReport,
  TaskComplexity,
  MODEL_ALIAS_ROWS,
  SIMPLE_MAX_WORDS,
  COMPLEX_MIN_WORDS,
  AUTO_FAST_MODEL,
  AUTO_CAPABLE_MODEL,
  HYBRID_LOCAL_MODEL,
  HYBRID_CLOUD_MODEL,
  DEFAULT_FIXED_MODEL,
} from "./model_router.js";
export type { RoutingStrategy, AvailableModelCatalog } from "./model_router.js";
