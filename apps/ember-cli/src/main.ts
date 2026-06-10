import { resolveProvider } from "../../../packages/api/src/index.js";
import { buildDoctorReport, DEFAULT_STARTER_SYSTEM_CONFIG, executeStarterSlashCommand, StarterSystemApplication } from "../../../packages/system/src/index.js";
import { Repl, SessionStore, newSessionId } from "../../../packages/runtime/src/index.js";
import type { ConversationMessage, SessionSummary } from "../../../packages/runtime/src/index.js";
import { ConsoleTelemetrySink } from "../../../packages/telemetry/src/index.js";
import { parsePromptArgs, runPromptTurn } from "./prompt.js";

/**
 * Resolves the `--resume` flag. `--resume <id>` (or `--resume=<id>`) targets a
 * specific session; a bare `--resume` requests the most recent session.
 */
function resolveResumeArg(argv: string[]): { resume: boolean; id: string | null } {
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index] ?? "";
    if (current === "--resume") {
      const next = argv[index + 1];
      const id = next && !next.startsWith("--") ? next.trim() : null;
      return { resume: true, id: id || null };
    }
    if (current.startsWith("--resume=")) {
      return { resume: true, id: current.slice("--resume=".length).trim() || null };
    }
  }
  return { resume: false, id: null };
}

/** Picks the session to resume: explicit id, else the most recently modified. */
function pickResumeSession(summaries: SessionSummary[], id: string | null): SessionSummary | null {
  if (summaries.length === 0) {
    return null;
  }
  if (id) {
    return summaries.find((s) => s.id === id) ?? null;
  }
  return [...summaries].sort((a, b) => b.lastModified.localeCompare(a.lastModified))[0] ?? null;
}

const useRepl =
  process.argv.includes("--repl") ||
  process.argv.includes("--resume") ||
  process.argv.some((a) => a.startsWith("--resume=")) ||
  process.argv.length === 2;

function resolveCliModelArg(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index] ?? "";
    if (current === "--model") {
      return argv[index + 1]?.trim() || null;
    }
    if (current.startsWith("--model=")) {
      return current.slice("--model=".length).trim() || null;
    }
  }
  return null;
}

function stripConsumedCliFlags(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index] ?? "";
    if (current === "--model") {
      index += 1;
      continue;
    }
    if (current.startsWith("--model=")) {
      continue;
    }
    if (current === "--repl") {
      continue;
    }
    if (current === "--resume") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        index += 1;
      }
      continue;
    }
    if (current.startsWith("--resume=")) {
      continue;
    }
    result.push(current);
  }
  return result;
}

const cliModel = resolveCliModelArg(process.argv.slice(2));
if (cliModel) {
  process.env.OLLAMA_MODEL = cliModel;
  process.env.EMBER_MODEL = cliModel;
}
const remainingArgs = stripConsumedCliFlags(process.argv.slice(2));
const doctorArgs = remainingArgs;
const doctorMode = doctorArgs[0] === "doctor";
const promptMode = doctorArgs[0] === "prompt";
const modelsMode = doctorArgs[0] === "models";

if (promptMode) {
  // Direct loop: drive ONE non-interactive agent turn through the existing
  // runtime and exit, mirroring the Rust reference's `ember prompt "<text>"`.
  let parsed;
  try {
    parsed = parsePromptArgs(doctorArgs.slice(1));
  } catch (err: unknown) {
    console.error(`[ember] prompt: ${(err as Error).message}`);
    process.exit(2);
  }
  if (!parsed.prompt) {
    console.error('[ember] prompt: requires a prompt string, e.g. prompt "hello"');
    process.exit(2);
  }
  // One-shot prompt mode: stdout must carry ONLY the model answer, so route
  // telemetry/diagnostics to stderr via the sink abstraction (no string-stripping).
  const promptTelemetry = new ConsoleTelemetrySink((line) => process.stderr.write(`${line}\n`));
  const app = new StarterSystemApplication(
    DEFAULT_STARTER_SYSTEM_CONFIG,
    resolveProvider(),
    [],
    promptTelemetry,
  );
  try {
    // Stream assistant text deltas to stdout as they arrive (text mode only).
    // JSON mode needs the whole structured record, so it stays buffered.
    if (parsed.output === "text") {
      app.runtime.onText = (delta) => process.stdout.write(delta);
    }
    const rendered = await runPromptTurn(app, parsed.prompt, parsed.output);
    if (parsed.output === "json") {
      console.log(rendered);
    } else {
      // Content already streamed via onText; terminate the line.
      process.stdout.write("\n");
    }
    app.shutdown();
    process.exit(0);
  } catch (err: unknown) {
    console.error(`[ember] prompt failed: ${(err as Error).message}`);
    app.shutdown();
    process.exit(1);
  }
} else if (modelsMode) {
  // `ember models`: list the real local models from Ollama's /api/tags (plus
  // cloud shortcuts + routing shortcuts), mirroring the Rust reference's
  // `CliAction::Models`. Reuses the same `/model list` path the REPL uses.
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG, resolveProvider());
  try {
    console.log(await executeStarterSlashCommand(app, "/model list"));
  } catch (err: unknown) {
    console.error(`[ember] models: ${(err as Error).message}`);
    app.shutdown();
    process.exit(1);
  }
  app.shutdown();
} else if (doctorMode) {
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG, resolveProvider());
  const doctorSubmode = doctorArgs[1]?.trim();
  try {
    if (doctorSubmode === "status") {
      console.log(await executeStarterSlashCommand(app, "/doctor status"));
    } else {
      console.log(buildDoctorReport(app.report()));
    }
  } catch (err: unknown) {
    console.error(`[ember] doctor: ${(err as Error).message}`);
    app.shutdown();
    process.exit(1);
  }
  app.shutdown();
} else if (useRepl) {
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG, resolveProvider());
  // Discover + register any configured MCP tools before the REPL accepts input.
  // Offline-safe: a no-op when no MCP servers are configured.
  await app.initMcp();
  const store = new SessionStore();

  // Resolve the active session: either resume a prior one (--resume / --resume <id>)
  // or start a fresh session. Either way we persist after every turn, not just on exit.
  const { resume, id: resumeId } = resolveResumeArg(process.argv.slice(2));
  let sessionId = newSessionId();
  let createdAt = new Date().toISOString();

  if (resume) {
    const summaries = await store.list();
    if (summaries.length > 0) {
      console.log("[ember] available sessions:");
      for (const summary of summaries) {
        console.log(`  ${summary.id}  (${summary.messageCount} messages, ${summary.lastModified})`);
      }
    }
    const target = pickResumeSession(summaries, resumeId);
    if (target) {
      const loaded = await store.load(target.id);
      sessionId = loaded.id;
      createdAt = loaded.createdAt;
      console.log(`[ember] resuming session ${sessionId} (${loaded.messages.length} messages)`);
    } else {
      console.log("[ember] no matching session to resume; starting a new session");
    }
  }

  await store.ensureSession({ id: sessionId, createdAt });

  // Persist a message immediately; surface failures without crashing the REPL.
  const persist = async (message: ConversationMessage): Promise<void> => {
    try {
      await store.appendMessage(sessionId, message);
    } catch (err: unknown) {
      console.error(`[ember] failed to persist turn: ${(err as Error).message}`);
    }
  };

  // In-REPL `/resume` lists prior sessions, and `/resume <id>` reloads one and
  // switches the active session so subsequent turns append to it.
  const handleResumeCommand = async (payload: string): Promise<string> => {
    const summaries = await store.list();
    const target = pickResumeSession(summaries, payload.trim() || null);
    if (payload.trim() === "") {
      if (summaries.length === 0) {
        return "[ember] /resume: no saved sessions";
      }
      const lines = ["[ember] /resume: available sessions"];
      for (const summary of summaries) {
        lines.push(`  ${summary.id}  (${summary.messageCount} messages, ${summary.lastModified})`);
      }
      lines.push("usage: /resume <id> to reload a session");
      return lines.join("\n");
    }
    if (!target) {
      return `[ember] /resume: session not found: ${payload.trim()}`;
    }
    const loaded = await store.load(target.id);
    sessionId = loaded.id;
    createdAt = loaded.createdAt;
    await store.ensureSession({ id: sessionId, createdAt });
    return `[ember] resumed session ${sessionId} (${loaded.messages.length} messages)`;
  };

  // Stream assistant text deltas to stdout live during agentic turns.
  app.runtime.onText = (delta) => process.stdout.write(delta);

  const repl = new Repl({
    prompt: "ember> ",
    onInput: async (line: string): Promise<string> => {
      if (line === "/resume" || line.startsWith("/resume ")) {
        return handleResumeCommand(line.slice("/resume".length));
      }
      await persist({ role: "user", content: line, timestamp: new Date().toISOString() });
      const slashOutput = await executeStarterSlashCommand(app, line);
      if (slashOutput !== null) {
        await persist({ role: "assistant", content: slashOutput, timestamp: new Date().toISOString() });
        return slashOutput;
      }

      const record = await app.controlSequence.handle(line);
      await persist({ role: "assistant", content: record.output, timestamp: new Date().toISOString() });
      // The answer already streamed to stdout via onText; return empty so the
      // REPL only appends the terminating newline (no duplicate print).
      return "";
    },
    onExit: (): void => {
      app.shutdown();
    },
  });

  await repl.start();
} else {
  const rawCommand = remainingArgs.join(" ").trim();
  if (rawCommand.startsWith("/")) {
    const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG, resolveProvider());
    const output = await executeStarterSlashCommand(app, rawCommand);
    if (output !== null) {
      console.log(output);
      app.shutdown();
      process.exit(0);
    }
    const record = await app.controlSequence.handle(rawCommand);
    console.log(record.output);
    app.shutdown();
    process.exit(0);
  }
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG, resolveProvider());
  const [commandReply, firstReply, secondReply] = await app.runDemo();
  app.shutdown();
  const report = app.report();

  console.log("emberforge-ts starter");
  console.log(`system: ${report.appName}`);
  console.log(`lifecycle: ${report.lifecycleState}`);
  console.log(`commands: ${report.commandCount}`);
  console.log(`tools: ${report.toolCount}`);
  console.log(`plugins: ${report.pluginCount}`);
  console.log(`handled requests: ${report.handledRequestCount}`);
  console.log(app.plugins.list()[0]?.validate() ?? false ? "plugin valid: true" : "plugin valid: false");
  console.log(report.serverDescription);
  console.log(report.lspSummary);
  console.log(`turns: ${report.turnCount}`);
  console.log(commandReply);
  console.log(firstReply);
  console.log(secondReply);
  console.log(`last route: ${report.lastRoute ?? "none"}`);
  console.log(`last phases: ${report.lastPhaseHistory.join(" -> ")}`);
  console.log(`last turn: ${report.lastTurnInput ?? "none"}`);
}
