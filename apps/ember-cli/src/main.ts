import { OllamaProvider } from "../../../packages/api/src/index.js";
import { buildDoctorReport, DEFAULT_STARTER_SYSTEM_CONFIG, executeStarterSlashCommand, StarterSystemApplication } from "../../../packages/system/src/index.js";
import { Repl, SessionStore, newSessionId } from "../../../packages/runtime/src/index.js";
import type { ConversationMessage } from "../../../packages/runtime/src/index.js";

const useRepl =
  process.argv.includes("--repl") || process.argv.length === 2;

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

if (doctorMode) {
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG, new OllamaProvider());
  const doctorSubmode = doctorArgs[1]?.trim();
  if (doctorSubmode === "status") {
    console.log(executeStarterSlashCommand(app, "/doctor status"));
  } else {
    console.log(buildDoctorReport(app.report()));
  }
  app.shutdown();
} else if (useRepl) {
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG, new OllamaProvider());
  const store = new SessionStore();
  const messages: ConversationMessage[] = [];

  const repl = new Repl({
    prompt: "ember> ",
    onInput: async (line: string): Promise<string> => {
      messages.push({ role: "user", content: line, timestamp: new Date().toISOString() });
      const slashOutput = executeStarterSlashCommand(app, line);
      if (slashOutput !== null) {
        messages.push({ role: "assistant", content: slashOutput, timestamp: new Date().toISOString() });
        return slashOutput;
      }

      const record = await app.controlSequence.handle(line);
      messages.push({ role: "assistant", content: record.output, timestamp: new Date().toISOString() });
      return record.output;
    },
    onExit: (): void => {
      if (messages.length > 0) {
        const session = {
          id: newSessionId(),
          createdAt: new Date().toISOString(),
          messages,
        };
        // onExit is sync per the Repl interface; fire-and-forget with .catch() for async save.
        store.save(session).catch((err: unknown) => {
          console.error(`[ember] failed to save session: ${(err as Error).message}`);
        });
      }
      app.shutdown();
    },
  });

  await repl.start();
} else {
  const rawCommand = remainingArgs.join(" ").trim();
  if (rawCommand.startsWith("/")) {
    const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG, new OllamaProvider());
    const output = executeStarterSlashCommand(app, rawCommand);
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
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG, new OllamaProvider());
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
  console.log(`rust anchor: ${report.rustAnchor}`);
  console.log(`turns: ${report.turnCount}`);
  console.log(commandReply);
  console.log(firstReply);
  console.log(secondReply);
  console.log(`last route: ${report.lastRoute ?? "none"}`);
  console.log(`last phases: ${report.lastPhaseHistory.join(" -> ")}`);
  console.log(`last turn: ${report.lastTurnInput ?? "none"}`);
}
