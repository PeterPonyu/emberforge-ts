import type { Provider } from "./provider.js";
import { OllamaProvider } from "./ollama_provider.js";
import { AnthropicProvider } from "./anthropic_provider.js";
import { XaiProvider } from "./xai_provider.js";
import { resolveAnthropicAuth, resolveXaiApiKey, type AnthropicSettings, type EnvMap, type XaiSettings } from "./auth.js";
import { globalFetch, type FetchLike } from "./transport.js";

export type ProviderKind = "anthropic" | "xai" | "ollama";

export interface ProviderSettings {
  anthropic?: AnthropicSettings;
  xai?: XaiSettings;
}

export interface RouterOptions {
  env?: EnvMap;
  settings?: ProviderSettings;
  /** Injected transport for hosted providers — defaults to the global fetch. */
  fetchImpl?: FetchLike;
}

/**
 * Detects which provider to use based on resolvable credentials, mirroring the
 * Rust precedence: hosted Anthropic first, then xAI, then Ollama as the local
 * default when no hosted creds are present.
 */
export function detectProviderKind(
  env: EnvMap = process.env,
  settings: ProviderSettings = {},
): ProviderKind {
  if (resolveAnthropicAuth(env, settings.anthropic ?? {})) {
    return "anthropic";
  }
  if (resolveXaiApiKey(env, settings.xai ?? {})) {
    return "xai";
  }
  return "ollama";
}

/**
 * Resolves a concrete `Provider` using credential detection. Hosted providers
 * receive the injected transport so the whole pipeline stays offline-testable;
 * Ollama is the default when no hosted credentials resolve.
 */
export function resolveProvider(options: RouterOptions = {}): Provider {
  const env = options.env ?? process.env;
  const settings = options.settings ?? {};
  const fetchImpl = options.fetchImpl ?? globalFetch;

  switch (detectProviderKind(env, settings)) {
    case "anthropic": {
      const provider = AnthropicProvider.fromEnv(env, settings.anthropic ?? {}, fetchImpl);
      if (provider) {
        return provider;
      }
      break;
    }
    case "xai": {
      const provider = XaiProvider.fromEnv(env, settings.xai ?? {}, fetchImpl);
      if (provider) {
        return provider;
      }
      break;
    }
    case "ollama":
      break;
  }

  return new OllamaProvider(env.OLLAMA_BASE_URL, env.OLLAMA_MODEL ?? env.EMBER_MODEL);
}
