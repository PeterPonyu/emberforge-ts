# Emberforge (TypeScript)

**Local-first terminal tooling for language-model workflows.**

Emberforge is a terminal coding tool that works with local models through Ollama. It includes a REPL, tool execution, session management, and plugin scaffolding. This repository contains the TypeScript implementation: a single Node.js/TypeScript project whose source is organized into internal `packages/` and `apps/` folders compiled together by one root `tsconfig.json`. It is not an npm workspaces monorepo — there is one root `package.json` and the internal folders are imported by relative path, not as published workspace packages.

> **Status note:** The TypeScript port ships four provider backends — a built-in
> mock provider (tests/offline), the local Ollama provider, and hosted
> **Anthropic** and **xAI** providers. The CLI selects a provider automatically
> by credential detection (`resolveProvider()`): Anthropic when an Anthropic
> credential is set, else xAI when `XAI_API_KEY` is set, else Ollama. The hosted
> clients are real HTTP clients (`/v1/messages` for Anthropic, OpenAI-compatible
> `/chat/completions` for xAI). One caveat: the `doctor` command's printed
> `provider:` line currently always reads `ollama` — it shows the local default
> plus hosted-key presence, not the live routing decision.

## Prerequisites: Ollama

Emberforge talks to a running Ollama instance at `http://localhost:11434` by
default, so install and start Ollama before building or running the CLI.

```bash
# Install Ollama (Linux, and the same official script on macOS)
curl -fsSL https://ollama.com/install.sh | sh

# Or on macOS with Homebrew
brew install ollama

# Start the Ollama server (leave running in its own terminal/session)
ollama serve

# Pull at least one model the CLI can route to
ollama pull qwen3:8b
```

The Linux `install.sh` script registers a systemd service that starts Ollama
automatically, so `ollama serve` is only needed where the service isn't running
(for example a fresh macOS Homebrew install or a manual setup). See the
[official Ollama install docs](https://ollama.com/download) for platform-specific
details and alternative package managers. Override the endpoint with
`OLLAMA_BASE_URL` if Ollama runs elsewhere.

## Quick Start

```bash
# Install dependencies
npm install

# Build from source
npm run build

# Start the REPL (auto-detects Ollama)
npm start

# Or run directly
node dist/apps/ember-cli/src/main.js

# With a specific model
node dist/apps/ember-cli/src/main.js --model qwen3:8b

# Run diagnostics (checks Ollama, env vars, and registered commands/tools)
node dist/apps/ember-cli/src/main.js doctor

# Direct loop: run ONE non-interactive agent turn and exit
node dist/apps/ember-cli/src/main.js prompt "summarize the repo layout"

# Structured (single-line JSON) output for scripting/agents
node dist/apps/ember-cli/src/main.js prompt --output json "list the open tasks"
```

The `prompt` subcommand is the non-interactive **direct loop**: it drives a
single agent turn through the same runtime the REPL uses (model routing + tool
dispatch), prints the result, and exits. Output defaults to plain text; pass
`--output json` for a single structured line. It uses the same provider routing
as the REPL, so a local turn requires a reachable Ollama (or hosted credentials)
— without one it exits non-zero with `prompt failed: fetch failed`.

> There is no `ember` binary on your `PATH` — the package ships no `bin` entry.
> Invoke the CLI via `npm start` or `node dist/apps/ember-cli/src/main.js ...`
> (with optional subcommands such as `doctor`, or slash commands such as
> `/status`) as shown above.

## Features

- **Local-first**: Runs with Ollama — no API keys needed for local models
- **Hosted providers**: Anthropic Claude and xAI Grok are implemented as real HTTP clients and selected automatically by credential detection (`resolveProvider()`). Set `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) to route to Anthropic, or `XAI_API_KEY` to route to xAI; with neither set the CLI uses local Ollama. Note: the `doctor` report's `provider:` line still prints `ollama` regardless of routing (a display limitation).
- **Task-based model selection**: Selects models by task complexity
- **Slash commands**: `/help`, `/status`, `/doctor`, `/model`, `/questions`, `/tasks`, `/buddy`, `/compact`, `/review`, `/commit`, `/pr`, and more
- **Tools**: bash, file ops, search, web, notebooks, agents, skills
- **Sessions**: Save, resume, export conversations
- **Plugin system**: Includes plugin metadata and registry scaffolding
- **MCP integration** *(planned)*: Model Context Protocol support is not yet implemented in this port
- **Telemetry**: Session tracing and usage analytics
- **Prompt caching**: Request fingerprinting with TTL

## Architecture

```text
apps/
└── ember-cli/      Interactive REPL, streaming renderer, slash commands

packages/
├── api/            API client — Ollama, mock, Anthropic, and xAI providers with credential-based routing
├── commands/       Shared slash command definitions and help text
├── compat/         Compatibility layer and legacy path resolution
├── lsp/            Language Server Protocol integration
├── plugins/        Plugin metadata and registry surfaces; runtime hook parity is planned
├── runtime/        Session state, conversation history, compaction
├── server/         HTTP/SSE server infrastructure
├── system/         Application lifecycle, config, context, diagnostics
├── telemetry/      Session tracing, analytics events, JSONL sink
└── tools/          Built-in tool specs with execution dispatch
```

## Model Support

| Provider | Models | Auth | Status |
| --- | --- | --- | --- |
| **Ollama** (local) | qwen3, llama3, gemma3, mistral, deepseek-r1, phi4, plus many more local families | None needed | Implemented |
| **Mock** (built-in) | Deterministic responses for tests/offline use | None needed | Implemented |
| **Anthropic** | Claude Opus, Sonnet, and Haiku families | `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` | Implemented |
| **xAI** | Grok 3, Grok 3 Mini | `XAI_API_KEY` | Implemented |

> The CLI picks a provider by credential detection at startup
> (`resolveProvider()` in `packages/api/src/router.ts`): Anthropic if an
> Anthropic credential is set, else xAI if `XAI_API_KEY` is set, else local
> Ollama. The `doctor` command additionally surfaces `ANTHROPIC_API_KEY` /
> `XAI_API_KEY` presence for diagnostics, but its printed `provider:` line is
> hardcoded to `ollama` and does not reflect the live routing decision.

## Configuration

Emberforge is configured through environment variables. Persistent state
(buddy state, task/question state, sessions) is written under the per-user
config directory `~/.emberforge/` (and `.emberforge/sessions` in the current
project for session transcripts). Set `EMBER_CONFIG_HOME` to relocate the
config directory.

> **Note:** There is no settings-file loader yet. A layered config-file
> precedence chain (project/user JSON settings) is **planned** but not
> implemented — configure the tool via the environment variables below.

Environment variables:

- `EMBER_CONFIG_HOME` — override the config directory (default: `~/.emberforge`)
- `EMBER_MODEL` — default model when `OLLAMA_MODEL` is unset
- `EMBER_BUDDY_STATE_PATH` — override the buddy-state file location
- `EMBER_TASK_STATE_PATH` — override the task/question-state file location
- `OLLAMA_BASE_URL` — custom Ollama endpoint (default: `http://localhost:11434`)
- `OLLAMA_MODEL` — Ollama model to route to (default: `qwen3:8b`)
- `ANTHROPIC_API_KEY` — Anthropic API key (`x-api-key`); when set, routes the CLI to the hosted Anthropic provider
- `ANTHROPIC_AUTH_TOKEN` — Anthropic bearer token (alternative/additional to the API key); also routes to Anthropic
- `ANTHROPIC_BASE_URL` — override the Anthropic endpoint (default: `https://api.anthropic.com`)
- `XAI_API_KEY` — xAI API key (bearer); when set (and no Anthropic credential), routes the CLI to the hosted xAI provider

## Project Instructions

Create an `EMBER.md` file in your project root to provide persistent guidance.
Add it by hand for now — there is no scaffolding command yet.

> **Planned:** an `/init` slash command that scaffolds `EMBER.md` and related
> config/`.gitignore` entries is not yet implemented. The currently handled
> slash commands are `/help`, `/status`, `/doctor`, `/model`, `/questions`,
> `/tasks`, `/buddy`, `/compact`, `/review`, `/commit`, and `/pr`.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Type-check without emitting
npm run typecheck

# Run
npm start
```

## License

MIT
