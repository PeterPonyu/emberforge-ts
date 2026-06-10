/**
 * Model listing & routing, ported for parity with the Rust reference
 * (`crates/runtime/src/model_router.rs` + the `ember-cli` model report in
 * `crates/ember-cli/src/main.rs`). Two concerns live here:
 *
 * 1. **Routing strategy** — `auto` / `hybrid` complexity heuristics plus the
 *    fixed default, mirroring Rust's `parse_strategy` / `estimate_complexity` /
 *    `select_model`. All thresholds and default models are NAMED constants, not
 *    buried literals.
 * 2. **Local model discovery** — querying Ollama's native `GET {base}/api/tags`
 *    to list the real local models, mirroring `list_ollama_models`, and
 *    rendering the same "Available models" report shape the Rust CLI prints.
 */

import { normalizeOllamaBaseURL } from "./ollama_provider.js";

/** Words at or below this count (without code markers) are Simple. Mirrors Rust `words <= 5`. */
export const SIMPLE_MAX_WORDS = 5;

/** Words strictly above this count are Complex. Mirrors Rust `words > 50`. */
export const COMPLEX_MIN_WORDS = 50;

/** Auto-routing fast model for simple prompts (Rust `parse_strategy` "auto"). */
export const AUTO_FAST_MODEL = "qwen2.5:1.5b";
/** Auto-routing capable model for medium/complex prompts. */
export const AUTO_CAPABLE_MODEL = "qwen3:8b";
/** Hybrid-routing local model for simple/medium prompts. */
export const HYBRID_LOCAL_MODEL = "qwen3:8b";
/** Hybrid-routing cloud model for complex prompts. */
export const HYBRID_CLOUD_MODEL = "claude-sonnet-4-6";
/** Default fixed model when no strategy keyword is given (Rust `RoutingStrategy::default`). */
export const DEFAULT_FIXED_MODEL = "qwen3:8b";

/**
 * Cloud model alias rows shown under "Cloud shortcuts", mirroring Rust's
 * `MODEL_ALIAS_ROWS` (`crates/ember-cli/src/main.rs:73`).
 */
export const MODEL_ALIAS_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["opus", "claude-opus-4-6"],
  ["sonnet", "claude-sonnet-4-6"],
  ["haiku", "claude-haiku-4-5-20251213"],
  ["grok", "grok-3"],
  ["grok-mini", "grok-3-mini"],
];

/** Estimated complexity of a user query, mirroring Rust's `TaskComplexity`. */
export enum TaskComplexity {
  Simple = "simple",
  Medium = "medium",
  Complex = "complex",
}

/** Routing strategy, mirroring Rust's `RoutingStrategy` enum. */
export type RoutingStrategy =
  | { kind: "fixed"; model: string }
  | { kind: "auto"; fastModel: string; capableModel: string }
  | { kind: "hybrid"; localModel: string; cloudModel: string };

const CODE_MARKERS = ["```", "refactor", "architect", "implement", "design"];
const MULTI_STEP_MARKERS = ["then", "after that", "step by step", "and also", "first", "finally"];

/**
 * Estimates query complexity from surface heuristics, mirroring Rust's
 * `estimate_complexity`: short non-code prompts are Simple; code markers,
 * multi-step language, or very long prompts are Complex; the rest are Medium.
 */
export function estimateComplexity(query: string): TaskComplexity {
  const words = query.split(/\s+/).filter(Boolean).length;
  const hasCodeMarkers = CODE_MARKERS.some((marker) => query.includes(marker));
  const hasMultiStep = MULTI_STEP_MARKERS.some((marker) => query.includes(marker));

  if (words <= SIMPLE_MAX_WORDS && !hasCodeMarkers) {
    return TaskComplexity.Simple;
  }
  if (hasCodeMarkers || hasMultiStep || words > COMPLEX_MIN_WORDS) {
    return TaskComplexity.Complex;
  }
  return TaskComplexity.Medium;
}

/**
 * Selects the model for a query under a strategy, mirroring Rust's
 * `select_model`. Auto routes Simple→fast, else→capable; Hybrid routes
 * Simple/Medium→local, Complex→cloud; Fixed always returns its model.
 */
export function selectModel(strategy: RoutingStrategy, query: string): string {
  switch (strategy.kind) {
    case "fixed":
      return strategy.model;
    case "auto": {
      const complexity = estimateComplexity(query);
      return complexity === TaskComplexity.Simple ? strategy.fastModel : strategy.capableModel;
    }
    case "hybrid": {
      const complexity = estimateComplexity(query);
      return complexity === TaskComplexity.Complex ? strategy.cloudModel : strategy.localModel;
    }
  }
}

/**
 * Parses a routing strategy from a model string, mirroring Rust's
 * `parse_strategy`: "auto" / "hybrid" map to their default model pairs;
 * anything else is a Fixed model.
 */
export function parseStrategy(modelStr: string): RoutingStrategy {
  switch (modelStr.trim().toLowerCase()) {
    case "auto":
      return { kind: "auto", fastModel: AUTO_FAST_MODEL, capableModel: AUTO_CAPABLE_MODEL };
    case "hybrid":
      return { kind: "hybrid", localModel: HYBRID_LOCAL_MODEL, cloudModel: HYBRID_CLOUD_MODEL };
    default:
      return { kind: "fixed", model: modelStr };
  }
}

/** Discovered local-model catalog, mirroring Rust's `AvailableModelCatalog`. */
export interface AvailableModelCatalog {
  ollamaModels: string[];
  ollamaStatus: string;
}

/** Native Ollama `/api/tags` response shape (only the fields we read). */
interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

/** Injectable fetch (defaults to the global) so listing stays offline-testable. */
type FetchFn = typeof fetch;

/**
 * Lists local Ollama models via the native `GET {base}/api/tags`, mirroring
 * Rust's `list_ollama_models`: returns the sorted, de-duplicated model names.
 * Throws on transport/HTTP/parse failure so the caller can surface a status.
 */
export async function listOllamaModels(
  baseURL: string = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  fetchImpl: FetchFn = fetch,
): Promise<string[]> {
  const base = normalizeOllamaBaseURL(baseURL);
  const response = await fetchImpl(`${base}/api/tags`, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as OllamaTagsResponse;
  const names = (payload.models ?? [])
    .map((model) => model.name)
    .filter((name): name is string => typeof name === "string" && name.trim() !== "");
  return [...new Set(names)].sort();
}

/** Truncates a string for inclusion in a one-line status, mirroring Rust's helper. */
function truncateForSummary(value: string, maxChars: number): string {
  const chars = [...value];
  return chars.length <= maxChars ? value : `${chars.slice(0, maxChars).join("")}…`;
}

/**
 * Discovers the available-model catalog for the current session model, mirroring
 * Rust's `discover_available_models`: query Ollama, fold in the current model
 * when it's a local tag, and describe reachability. Network failures degrade to
 * an "unreachable" status rather than throwing.
 */
export async function discoverAvailableModels(
  currentModel: string,
  baseURL: string = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  fetchImpl: FetchFn = fetch,
): Promise<AvailableModelCatalog> {
  const models = new Set<string>();
  // The current model is a local tag unless it resolves to a cloud alias.
  const currentIsCloud = MODEL_ALIAS_ROWS.some(([, model]) => model === currentModel);
  if (!currentIsCloud) {
    models.add(currentModel);
  }

  let ollamaStatus: string;
  try {
    const listed = await listOllamaModels(baseURL, fetchImpl);
    for (const model of listed) {
      models.add(model);
    }
    ollamaStatus =
      models.size === 0
        ? "reachable, but no local models were reported"
        : `reachable - ${models.size} local model(s) detected`;
  } catch (error) {
    const message = truncateForSummary((error as Error).message, 60);
    ollamaStatus = currentIsCloud
      ? `unreachable (${message})`
      : `unreachable - showing the current session model only (${message})`;
  }

  return { ollamaModels: [...models].sort(), ollamaStatus };
}

/**
 * Renders the "Available models" report, mirroring Rust's
 * `format_available_models_report`: Ollama state + local models (current marked
 * with `*`), cloud shortcut aliases, and routing shortcuts.
 */
export function renderAvailableModelsReport(
  currentModel: string,
  catalog: AvailableModelCatalog,
): string {
  const lines = ["Available models", `  Ollama state     ${catalog.ollamaStatus}`];

  if (catalog.ollamaModels.length === 0) {
    lines.push("  Ollama models    none listed");
  } else {
    lines.push("  Ollama models");
    for (const model of catalog.ollamaModels) {
      const marker = model === currentModel ? "*" : "-";
      lines.push(`    ${marker} ${model}`);
    }
  }

  lines.push("Cloud shortcuts");
  for (const [alias, model] of MODEL_ALIAS_ROWS) {
    const marker = model === currentModel ? "*" : "-";
    lines.push(`  ${marker} ${alias.padEnd(10)} ${model}`);
  }

  lines.push("Routing shortcuts");
  lines.push("  - auto       Route simpler prompts to a faster model");
  lines.push("  - hybrid     Prefer local for lighter work, cloud for harder work");
  return lines.join("\n");
}
