# Emberforge (TypeScript)

**Local-first terminal tooling for language-model workflows.**

Emberforge is a terminal coding tool that works with local models through Ollama and can use hosted providers when configured. It includes a REPL, tool execution, session management, plugins, and multiple provider backends. This repository contains the TypeScript implementation, organized as a Node.js monorepo.

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
- **Hosted providers**: Anthropic Claude and xAI Grok when API keys are configured
- **Task-based model selection**: Selects models by task complexity
- **Slash commands**: `/help`, `/status`, `/doctor`, `/model`, `/compact`, `/review`, `/commit`, `/pr`, and more
- **Tools**: bash, file ops, search, web, notebooks, agents, skills
- **Sessions**: Save, resume, export conversations
- **Plugin system**: Extend with custom tools and hooks
- **MCP integration**: Connect to Model Context Protocol servers
- **Telemetry**: Session tracing and usage analytics
- **Prompt caching**: Request fingerprinting with TTL

## Architecture

```text
apps/
└── ember-cli/      Interactive REPL, streaming renderer, slash commands

packages/
├── api/            API client — Anthropic, OpenAI-compat, Ollama provider routing
├── commands/       Shared slash command definitions and help text
├── compat/         Compatibility layer and legacy path resolution
├── lsp/            Language Server Protocol integration
├── plugins/        Plugin system with pre/post tool hooks
├── runtime/        Session state, conversation history, compaction
├── server/         HTTP/SSE server infrastructure
├── system/         Application lifecycle, config, context, diagnostics
├── telemetry/      Session tracing, analytics events, JSONL sink
└── tools/          Built-in tool specs with execution dispatch
```

## Model Support

| Provider | Models | Auth |
| --- | --- | --- |
| **Ollama** (local) | qwen3, llama3, gemma3, mistral, deepseek-r1, phi4, plus many more local families | None needed |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | `ANTHROPIC_API_KEY` |
| **xAI** | Grok 3, Grok 3 Mini | `XAI_API_KEY` |

## Configuration

Emberforge reads configuration from (in order of priority):

1. `.ember.json` (project config)
2. `.ember/settings.json` (project settings)
3. `~/.ember/settings.json` (user settings)

Environment variables:

- `EMBER_CONFIG_HOME` — override config directory
- `OLLAMA_BASE_URL` — custom Ollama endpoint (default: `http://localhost:11434`)
- `ANTHROPIC_API_KEY` — Anthropic API credentials
- `XAI_API_KEY` — xAI API credentials

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
