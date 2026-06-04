import { detectProviderKind, type EnvMap } from "../../api/src/index.js";
import type { StarterSystemReport } from "./report.js";

export interface DoctorEnvironment {
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
  EMBER_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  XAI_API_KEY?: string;
}

function presence(value: string | undefined): string {
  return value && value.trim() !== "" ? "present" : "missing";
}

export function buildDoctorReport(
  report: StarterSystemReport,
  env: DoctorEnvironment = process.env,
): string {
  const model = env.OLLAMA_MODEL ?? env.EMBER_MODEL ?? "qwen3:8b";
  const baseUrl = env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  // Reflect the LIVE resolved provider (same credential precedence the router
  // uses to pick a provider) instead of a hardcoded constant: an Anthropic key
  // → anthropic, an xAI key → xai, otherwise the local Ollama default.
  const provider = detectProviderKind(env as EnvMap);

  return [
    "emberforge-ts doctor",
    `provider: ${provider}`,
    `base_url: ${baseUrl}`,
    `model: ${model}`,
    `anthropic_api_key: ${presence(env.ANTHROPIC_API_KEY)}`,
    `xai_api_key: ${presence(env.XAI_API_KEY)}`,
    `commands: ${report.commandCount}`,
    `tools: ${report.toolCount}`,
    `plugins: ${report.pluginCount}`,
    `server: ${report.serverDescription}`,
    `lsp: ${report.lspSummary}`,
    `lifecycle: ${report.lifecycleState}`,
  ].join("\n");
}
