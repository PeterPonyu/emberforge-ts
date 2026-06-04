import type { StarterSystemApplication } from "../../../packages/system/src/index.js";

/**
 * Output format for the non-interactive `prompt` subcommand. Mirrors a subset
 * of the Rust reference's `CliOutputFormat` (`crates/ember-cli/src/main.rs`):
 * `text` prints the raw turn output, `json` prints a single structured line.
 * The Rust port additionally supports `ndjson`; this port ships the two formats
 * the CLI surface needs today.
 */
export type PromptOutputFormat = "text" | "json";

export interface ParsedPromptArgs {
  prompt: string;
  output: PromptOutputFormat;
}

function parseOutputFormat(value: string | undefined): PromptOutputFormat {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "text" || normalized === "json") {
    return normalized;
  }
  throw new Error(`unsupported value for --output: ${value ?? "(missing)"} (expected text or json)`);
}

/**
 * Parses the arguments following the `prompt` subcommand token. Recognizes
 * `--output <text|json>` / `--output=<value>` anywhere in the argument list;
 * every remaining token is joined into the prompt string (mirroring the Rust
 * reference's `rest[1..].join(" ")`).
 */
export function parsePromptArgs(args: string[]): ParsedPromptArgs {
  let output: PromptOutputFormat = "text";
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index] ?? "";
    if (current === "--output") {
      output = parseOutputFormat(args[index + 1]);
      index += 1;
      continue;
    }
    if (current.startsWith("--output=")) {
      output = parseOutputFormat(current.slice("--output=".length));
      continue;
    }
    rest.push(current);
  }
  return { prompt: rest.join(" ").trim(), output };
}

/**
 * Drives a single non-interactive agent turn through the existing conversation
 * runtime and returns the rendered output. This is the TypeScript analogue of
 * the Rust reference's `run_turn_with_output`: it reuses the same control
 * sequence engine the REPL uses (`app.controlSequence.handle`) so model routing
 * and tool dispatch behave identically — it does not introduce a new engine.
 */
export async function runPromptTurn(
  app: StarterSystemApplication,
  prompt: string,
  output: PromptOutputFormat = "text",
): Promise<string> {
  const record = await app.controlSequence.handle(prompt);
  if (output === "json") {
    return JSON.stringify({
      type: "prompt_result",
      model: app.runtime.getActiveModel(),
      route: record.route,
      input: record.input,
      output: record.output,
    });
  }
  return record.output;
}
