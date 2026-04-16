import type { StarterSystemReport } from "./report.js";

export interface DoctorEnvironment {
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
  EMBER_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
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

  return [
    "emberforge-ts doctor",
    `provider: ollama`,
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
