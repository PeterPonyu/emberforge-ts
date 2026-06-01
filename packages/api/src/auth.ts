/**
 * Credential resolution for hosted providers (EFPORT-2). Mirrors the Rust
 * precedence in `crates/api/src/providers/{claw_provider,openai_compat}.rs`:
 *
 * - Anthropic (Claw): `ANTHROPIC_API_KEY` → `x-api-key`; `ANTHROPIC_AUTH_TOKEN`
 *   → bearer. Either, both, or neither may be present.
 * - xAI / OpenAI-compat: a single API key env (`XAI_API_KEY`) sent as a bearer
 *   token.
 *
 * Resolution reads from an injected environment map (defaults to `process.env`)
 * and/or explicit settings, so auth can be exercised offline in tests.
 */
export type EnvMap = Record<string, string | undefined>;

export interface AnthropicSettings {
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
}

export interface XaiSettings {
  apiKey?: string;
  baseUrl?: string;
}

/** Reads an env var, treating empty strings as absent (matches Rust). */
export function readEnvNonEmpty(env: EnvMap, key: string): string | undefined {
  const value = env[key];
  return value && value !== "" ? value : undefined;
}

/**
 * Anthropic authorization headers. Settings take precedence over env, then env
 * fills any gaps. Returns `null` when no credential is resolvable.
 */
export function resolveAnthropicAuth(
  env: EnvMap = process.env,
  settings: AnthropicSettings = {},
): { apiKey?: string; authToken?: string } | null {
  const apiKey = settings.apiKey ?? readEnvNonEmpty(env, "ANTHROPIC_API_KEY");
  const authToken = settings.authToken ?? readEnvNonEmpty(env, "ANTHROPIC_AUTH_TOKEN");
  if (!apiKey && !authToken) {
    return null;
  }
  return { apiKey, authToken };
}

/** Applies Anthropic auth onto a header map (x-api-key and/or bearer). */
export function applyAnthropicAuth(
  headers: Record<string, string>,
  auth: { apiKey?: string; authToken?: string },
): Record<string, string> {
  if (auth.apiKey) {
    headers["x-api-key"] = auth.apiKey;
  }
  if (auth.authToken) {
    headers["authorization"] = `Bearer ${auth.authToken}`;
  }
  return headers;
}

/**
 * xAI API key (settings take precedence over env). Returns `null` when no key
 * is resolvable.
 */
export function resolveXaiApiKey(
  env: EnvMap = process.env,
  settings: XaiSettings = {},
): string | null {
  return settings.apiKey ?? readEnvNonEmpty(env, "XAI_API_KEY") ?? null;
}
