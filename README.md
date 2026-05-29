# Emberforge (TypeScript)

**Local-first terminal tooling for language-model workflows.**

Emberforge is a terminal coding tool that works with local models through Ollama. It includes a REPL, tool execution, session management, and plugin scaffolding. This repository contains the TypeScript implementation, organized as a Node.js monorepo.

> **Status note:** The TypeScript port currently ships two provider backends — a built-in mock provider (for tests/offline use) and the Ollama provider used by the CLI. Hosted providers (Anthropic Claude, xAI Grok) and MCP integration are **planned** and not yet implemented in this port. Sections below mark planned capabilities explicitly.

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
```

## Features

- **Local-first**: Runs with Ollama — no API keys needed for local models
- **Hosted providers** *(planned)*: Anthropic Claude and xAI Grok routing is not yet implemented in the TypeScript port. The `doctor` command only reports whether `ANTHROPIC_API_KEY` / `XAI_API_KEY` are present in the environment; no hosted provider is wired into the CLI.
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
├── api/            API client — Ollama + mock providers (Anthropic/OpenAI-compat routing planned)
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
| **Anthropic** | Claude Opus, Sonnet, and Haiku families | `ANTHROPIC_API_KEY` | Planned — not yet implemented |
| **xAI** | Grok 3, Grok 3 Mini | `XAI_API_KEY` | Planned — not yet implemented |

> The CLI always constructs the Ollama provider today. The `ANTHROPIC_API_KEY` / `XAI_API_KEY` variables below are only surfaced by `ember doctor` for diagnostics; they do not yet enable hosted-provider routing.

## Configuration

Emberforge reads configuration from (in order of priority):

1. `.ember.json` (project config)
2. `.ember/settings.json` (project settings)
3. `~/.ember/settings.json` (user settings)

Environment variables:

- `EMBER_CONFIG_HOME` — override config directory
- `OLLAMA_BASE_URL` — custom Ollama endpoint (default: `http://localhost:11434`)
- `ANTHROPIC_API_KEY` — Anthropic API credentials *(read by `ember doctor` for diagnostics only; hosted Anthropic routing is planned)*
- `XAI_API_KEY` — xAI API credentials *(read by `ember doctor` for diagnostics only; hosted xAI routing is planned)*

## Project Instructions

Create an `EMBER.md` file in your project root to provide persistent guidance:

```bash
ember /init    # Scaffolds EMBER.md, .ember.json, and .gitignore entries
```

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
