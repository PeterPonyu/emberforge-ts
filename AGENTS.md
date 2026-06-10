# AGENTS.md — emberforge-ts operating contract

This file is the onboarding/operating contract for AI agents (and humans driving
them) working in the **emberforge-ts** repository. It is intentionally factual to
*this* TypeScript port — see the notes about what does and does not exist.

## What this repo is

A single Node.js/TypeScript project (Node 22+) compiled by one root
`tsconfig.json`. Source lives under `packages/` (internal libraries) and
`apps/ember-cli/` (the CLI). It is **not** an npm workspaces monorepo: there is
one root `package.json` and the internal folders are imported by relative path
(`../../packages/...`), not as published packages. ESM only (`"type": "module"`,
`module: NodeNext`) — intra-repo imports use explicit `.js` extensions.

## Build / install

```bash
npm install        # install dev deps (TypeScript, @types/node)
npm run build      # tsc -p tsconfig.json  → emits to dist/
npm run typecheck  # tsc --noEmit (no output, type errors only)
npm run clean      # rm -rf dist dist-test
```

There is **no `ember` binary on your `PATH`** — the package declares no `bin`
entry and is not published to npm. After `npm run build`, invoke the CLI with
Node against the compiled entrypoint:

```bash
node dist/apps/ember-cli/src/main.js [args]
# or via the npm script (REPL, no args):
npm start
```

## Direct loop (non-interactive one-shot)

The `prompt` subcommand runs **one** agent turn through the existing
conversation runtime and exits — the TypeScript analogue of the Rust reference's
`ember prompt "<text>"` (`run_turn_with_output`). It reuses the same control
sequence engine the REPL uses, so model routing and tool dispatch are identical;
it does not introduce a separate engine.

```bash
# Plain-text output (default)
node dist/apps/ember-cli/src/main.js prompt "explain the dispatch flow"

# Single-line structured JSON (for scripting/agents)
node dist/apps/ember-cli/src/main.js prompt --output json "list registered tools"

# Choose the model for the turn (sets OLLAMA_MODEL/EMBER_MODEL for the run)
node dist/apps/ember-cli/src/main.js prompt --model qwen3:8b "hi"
```

Exit codes: `0` on success, `1` if the turn fails (e.g. the selected provider is
unreachable — a local turn needs a running Ollama or hosted credentials; without
one you get `prompt failed: fetch failed`), `2` on usage errors (missing prompt
string or an unsupported `--output` value). `--output` accepts `text` or `json`
(the Rust reference additionally supports `ndjson`; this port ships text/json).

Other CLI entry points: `doctor` / `doctor status` (diagnostics), bare invocation
or `--repl` starts the interactive REPL, `--resume [<id>]` resumes a session, and
slash commands (`/help`, `/status`, `/model`, …) can be passed directly.

## Providers + environment variables

The CLI selects a provider at startup by **credential detection**
(`resolveProvider()` in `packages/api/src/router.ts`), in this precedence:

1. **Anthropic** — if `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set. Real
   HTTP client posting to `/v1/messages` (`anthropic-version: 2023-06-01`).
2. **xAI** — else if `XAI_API_KEY` is set. OpenAI-compatible client posting to
   `{base}/chat/completions` with bearer auth.
3. **Ollama** (local default) — when no hosted credential is present. Talks to
   `http://localhost:11434` by default.

A **mock** provider also exists (`MockProvider`) for deterministic offline use;
the unit tests use it directly. It is not auto-selected by the CLI.

> Caveat: the `doctor` command's printed `provider:` line is hardcoded to
> `ollama` and reflects the local default + hosted-key *presence*, not the live
> routing decision. The actual runtime provider is whatever `resolveProvider()`
> returns.

| Env var | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic API key (`x-api-key`); routes to Anthropic |
| `ANTHROPIC_AUTH_TOKEN` | Anthropic bearer token; routes to Anthropic |
| `ANTHROPIC_BASE_URL` | Anthropic endpoint override (default `https://api.anthropic.com`) |
| `XAI_API_KEY` | xAI API key (bearer); routes to xAI when no Anthropic cred |
| `OLLAMA_BASE_URL` | Ollama endpoint (default `http://localhost:11434`) |
| `OLLAMA_MODEL` | Ollama model (default `qwen3:8b`) |
| `OLLAMA_NUM_PREDICT` | Max output tokens (`options.num_predict`) bounding runaway generation; positive int, default generous model-aware bound (`64000`, `32000` opus) |
| `EMBER_MODEL` | Fallback model when `OLLAMA_MODEL` is unset |
| `EMBER_CONFIG_HOME` | Config directory (default `~/.emberforge`) |
| `EMBER_BUDDY_STATE_PATH` | Buddy-state file override |
| `EMBER_TASK_STATE_PATH` | Task/question-state file override |

## Tests

```bash
npm test       # compiles tsconfig.test.json → dist-test/, runs node --test
npm run typecheck
```

`npm test` runs the full `node:test` suite (104 tests as of this change),
including `apps/ember-cli/src/prompt.test.js` for the direct-loop subcommand. CI
(`.github/workflows/ci.yml`, Node 22 on ubuntu + macos) runs exactly:
`npm ci` → `npm run typecheck` → `npm run build` → `npm test`.

When adding a new test file, add its compiled `dist-test/...` path to the `test`
script's `node --test` argument list in `package.json` (the runner takes an
explicit file list, not a glob).

## Repo layout

```text
apps/
└── ember-cli/src/
    ├── main.ts       CLI entry: prompt (direct loop), doctor, REPL, slash commands
    └── prompt.ts     Direct-loop helpers (parsePromptArgs, runPromptTurn)

packages/
├── api/         Providers (Ollama, mock, Anthropic, xAI) + credential router
├── commands/    Slash command definitions and help text
├── compat/      Compatibility layer and path resolution
├── lsp/         Language Server Protocol integration
├── mcp/         Model Context Protocol stdio client + tool registration
├── plugins/     Plugin metadata, registry, and hook surfaces
├── runtime/     ConversationRuntime (runTurn), sessions, REPL, persistence
├── server/      HTTP/SSE server infrastructure
├── system/      App lifecycle, dispatch, control sequence, turn engine, doctor
├── telemetry/   Session tracing, analytics events, JSONL sink
└── tools/       Built-in tool specs + permission-gated execution dispatch
```

## Ground rules for agents

- Verify before claiming. Run `npm run build && npm run typecheck && npm test`
  and paste real output; do not assert success without evidence.
- Keep diffs minimal and match existing patterns (explicit `.js` import
  extensions, relative cross-package imports, `node:test` + `node:assert/strict`).
- Do not overstate capabilities. If a feature is partial, say so.
- Do not commit build artifacts: `dist/`, `dist-test/`, `node_modules/` are
  git-ignored — keep them out of commits.
