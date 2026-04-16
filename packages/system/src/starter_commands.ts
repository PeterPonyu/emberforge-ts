import type { StarterSystemApplication } from "./application.js";
import { executeBuddyCommand } from "./buddy.js";
import { buildDoctorReport } from "./doctor.js";
import type { StarterQuestionRecord, StarterTaskRecord } from "./task_question_state.js";

function renderHelp(app: StarterSystemApplication): string {
  const lines = ["available commands:"];
  for (const command of app.commands.list()) {
    const suffix = command.argumentHint ? ` ${command.argumentHint}` : "";
    lines.push(`  /${command.name}${suffix} — ${command.description}`);
  }
  return lines.join("\n");
}

function fallbackPayload(payload: string, fallback: string): string {
  return payload.trim() === "" ? fallback : payload.trim();
}

function renderTask(task: StarterTaskRecord, header = "[command] tasks show"): string {
  return [
    header,
    `task_id: ${task.id}`,
    `kind: ${task.kind}`,
    `status: ${task.status}`,
    `input: ${task.input}`,
    `question_id: ${task.questionId ?? "none"}`,
    `answer: ${task.answer ?? "none"}`,
    `output: ${task.output ?? "none"}`,
  ].join("\n");
}

function renderPendingQuestions(questions: StarterQuestionRecord[]): string {
  if (questions.length === 0) {
    return ["[command] questions pending", "pending: 0"].join("\n");
  }
  const lines = ["[command] questions pending", `pending: ${questions.length}`];
  for (const question of questions) {
    lines.push(`${question.id} -> ${question.taskId} :: ${question.text}`);
  }
  return lines.join("\n");
}

function executeTasksCommand(app: StarterSystemApplication, payload: string): string {
  const parts = payload.trim().split(/\s+/).filter(Boolean);
  const [action = "list", ...rest] = parts;

  switch (action) {
    case "create": {
      const [kind = "", ...inputParts] = rest;
      if (kind !== "prompt") {
        return "[command] tasks: usage /tasks create prompt <text>";
      }
      const input = inputParts.join(" ").trim();
      if (input === "") {
        return "[command] tasks: prompt input required";
      }
      const task = app.taskQuestionState.createPromptTask(input);
      return renderTask(task, "[command] tasks create");
    }
    case "list": {
      const tasks = app.taskQuestionState.listTasks();
      if (tasks.length === 0) {
        return ["[command] tasks list", "tasks: 0"].join("\n");
      }
      return [
        "[command] tasks list",
        `tasks: ${tasks.length}`,
        ...tasks.map((task) => `${task.id} :: ${task.status} :: ${task.input}`),
      ].join("\n");
    }
    case "show": {
      const taskId = rest[0];
      if (!taskId) {
        return "[command] tasks: usage /tasks show <task-id>";
      }
      const task = app.taskQuestionState.getTask(taskId);
      if (!task) {
        return `[command] tasks: task not found ${taskId}`;
      }
      return renderTask(task);
    }
    case "stop": {
      const taskId = rest[0];
      if (!taskId) {
        return "[command] tasks: usage /tasks stop <task-id>";
      }
      return renderTask(app.taskQuestionState.stopTask(taskId), "[command] tasks stop");
    }
    default:
      return `[command] tasks: unsupported action ${action}`;
  }
}

function executeQuestionsCommand(app: StarterSystemApplication, payload: string): string {
  const parts = payload.trim().split(/\s+/).filter(Boolean);
  const [action = "pending", ...rest] = parts;

  switch (action) {
    case "pending":
      return renderPendingQuestions(app.taskQuestionState.listQuestions("pending"));
    case "ask": {
      const [taskId = "", ...textParts] = rest;
      if (!taskId || textParts.length === 0) {
        return "[command] questions: usage /questions ask <task-id> <text>";
      }
      const { task, question } = app.taskQuestionState.askQuestion(taskId, textParts.join(" "));
      return [
        "[command] questions ask",
        `question_id: ${question.id}`,
        `task_id: ${task.id}`,
        `status: ${task.status}`,
        `question: ${question.text}`,
      ].join("\n");
    }
    case "answer": {
      const [questionId = "", ...answerParts] = rest;
      if (!questionId || answerParts.length === 0) {
        return "[command] questions: usage /questions answer <question-id> <text>";
      }
      const { task, question } = app.taskQuestionState.answerQuestion(questionId, answerParts.join(" "));
      return [
        "[command] questions answer",
        `question_id: ${question.id}`,
        `task_id: ${task.id}`,
        `task_status: ${task.status}`,
        `answer: ${question.answer}`,
      ].join("\n");
    }
    default:
      return `[command] questions: unsupported action ${action}`;
  }
}

export function executeStarterSlashCommand(app: StarterSystemApplication, input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const withoutSlash = trimmed.slice(1);
  const [commandName = "", ...rest] = withoutSlash.split(/\s+/);
  const payload = rest.join(" ").trim();
  const report = app.report();

  switch (commandName) {
    case "help":
      return renderHelp(app);
    case "status":
      return `[command] status: lifecycle=${report.lifecycleState} handled=${report.handledRequestCount} turns=${report.turnCount}`;
    case "doctor":
      if (payload === "" || payload === "quick") {
        return buildDoctorReport(report);
      }
      if (payload === "status") {
        return [
          "emberforge-ts doctor status",
          `lifecycle: ${report.lifecycleState}`,
          `handled_requests: ${report.handledRequestCount}`,
          `turns: ${report.turnCount}`,
          `last_route: ${report.lastRoute ?? "none"}`,
        ].join("\n");
      }
      return `[command] doctor: unsupported mode ${payload}`;
    case "model": {
      const activeModel = process.env.OLLAMA_MODEL ?? process.env.EMBER_MODEL ?? "qwen3:8b";
      if (payload === "list") {
        return `[command] model list: ${activeModel}`;
      }
      return `[command] model: ${payload || activeModel}`;
    }
    case "questions":
      return executeQuestionsCommand(app, payload);
    case "tasks":
      return executeTasksCommand(app, payload);
    case "buddy":
      return executeBuddyCommand(app.buddy, payload);
    case "compact":
      return `[command] compact: turns=${report.turnCount} handled=${report.handledRequestCount} lifecycle=${report.lifecycleState}`;
    case "review":
      return [
        "[command] review",
        `scope: ${fallbackPayload(payload, "workspace")}`,
        `commands: ${report.commandCount}`,
        `tools: ${report.toolCount}`,
        `plugins: ${report.pluginCount}`,
        "note: starter translation review placeholder",
      ].join("\n");
    case "commit":
      return [
        "[command] commit",
        `summary: ${fallbackPayload(payload, "starter translation update")}`,
        `lifecycle: ${report.lifecycleState}`,
        `turns: ${report.turnCount}`,
        "note: starter commit workflow placeholder",
      ].join("\n");
    case "pr":
      return [
        "[command] pr",
        `context: ${fallbackPayload(payload, "starter translation update")}`,
        `commands: ${report.commandCount}`,
        `handled_requests: ${report.handledRequestCount}`,
        "note: starter pull request workflow placeholder",
      ].join("\n");
    default:
      return null;
  }
}
