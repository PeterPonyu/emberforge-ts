import { OllamaProvider } from "../../../packages/api/src/index.js";
import { DEFAULT_STARTER_SYSTEM_CONFIG, StarterSystemApplication } from "../../../packages/system/src/index.js";
import { Repl, SessionStore, newSessionId } from "../../../packages/runtime/src/index.js";
import type { ConversationMessage } from "../../../packages/runtime/src/index.js";

const useRepl =
  process.argv.includes("--repl") || process.argv.length === 2;

if (useRepl) {
  const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";
  const provider = new OllamaProvider(undefined, model);
  const store = new SessionStore();
  const messages: ConversationMessage[] = [];

  const repl = new Repl({
    prompt: "ember> ",
    onInput: async (line: string): Promise<string> => {
      messages.push({ role: "user", content: line, timestamp: new Date().toISOString() });
      try {
        const response = await provider.sendMessage({ model, prompt: line });
        messages.push({ role: "assistant", content: response.text, timestamp: new Date().toISOString() });
        return response.text;
      } catch (err) {
        return `[error: ${(err as Error).message}]`;
      }
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
    },
  });

  await repl.start();
} else {
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
