import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type StarterTaskStatus =
  | "pending"
  | "in_progress"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "stopped";

export type StarterQuestionStatus = "pending" | "answered";

export interface StarterTaskRecord {
  id: string;
  kind: "prompt";
  input: string;
  status: StarterTaskStatus;
  questionId: string | null;
  answer: string | null;
  output: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StarterQuestionRecord {
  id: string;
  taskId: string;
  text: string;
  status: StarterQuestionStatus;
  answer: string | null;
  createdAt: string;
  answeredAt: string | null;
}

type TaskQuestionSnapshot = {
  nextTaskIndex: number;
  nextQuestionIndex: number;
  tasks: StarterTaskRecord[];
  questions: StarterQuestionRecord[];
};

type TaskStateBlock = {
  type: "task_state";
  task_id: string;
  status: StarterTaskStatus;
  input?: string;
  question_id?: string;
  answer?: string;
  output?: string;
};

type QuestionStateBlock = {
  type: "question_state";
  question_id: string;
  task_id: string;
  status: StarterQuestionStatus;
  text?: string;
  answer?: string;
};

function resolveStatePath(explicitPath?: string): string {
  if (explicitPath && explicitPath.trim() !== "") {
    return explicitPath;
  }
  const envPath = process.env.EMBER_TASK_STATE_PATH?.trim();
  if (envPath) {
    return envPath;
  }
  const configHome = process.env.EMBER_CONFIG_HOME?.trim();
  if (configHome) {
    return join(configHome, "task-question-state.json");
  }
  return join(homedir(), ".emberforge", "task-question-state.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

export class TaskQuestionStateStore {
  private readonly statePath: string;
  private readonly transcriptPath: string;
  private nextTaskIndex = 1;
  private nextQuestionIndex = 1;
  private tasks: StarterTaskRecord[] = [];
  private questions: StarterQuestionRecord[] = [];

  constructor(statePath?: string) {
    this.statePath = resolveStatePath(statePath);
    this.transcriptPath = join(dirname(this.statePath), "task-question-transcript.jsonl");
    this.load();
  }

  private load(): void {
    if (!existsSync(this.statePath)) {
      return;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.statePath, "utf-8")) as TaskQuestionSnapshot;
      this.nextTaskIndex = parsed.nextTaskIndex ?? 1;
      this.nextQuestionIndex = parsed.nextQuestionIndex ?? 1;
      this.tasks = parsed.tasks ?? [];
      this.questions = parsed.questions ?? [];
    } catch {
      this.nextTaskIndex = 1;
      this.nextQuestionIndex = 1;
      this.tasks = [];
      this.questions = [];
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    const snapshot: TaskQuestionSnapshot = {
      nextTaskIndex: this.nextTaskIndex,
      nextQuestionIndex: this.nextQuestionIndex,
      tasks: this.tasks,
      questions: this.questions,
    };
    writeFileSync(this.statePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8");
  }

  private appendTranscript(blocks: Array<TaskStateBlock | QuestionStateBlock>): void {
    mkdirSync(dirname(this.transcriptPath), { recursive: true });
    if (!existsSync(this.transcriptPath)) {
      appendFileSync(
        this.transcriptPath,
        `${JSON.stringify({
          type: "session",
          id: "task-question-runtime",
          createdAt: nowIso(),
          planMode: false,
        })}\n`,
        "utf-8",
      );
    }
    appendFileSync(
      this.transcriptPath,
      `${JSON.stringify({
        type: "message",
        role: "system",
        blocks,
        timestamp: nowIso(),
      })}\n`,
      "utf-8",
    );
  }

  createPromptTask(input: string): StarterTaskRecord {
    const task: StarterTaskRecord = {
      id: `task-${this.nextTaskIndex}`,
      kind: "prompt",
      input: input.trim(),
      status: "in_progress",
      questionId: null,
      answer: null,
      output: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.nextTaskIndex += 1;
    this.tasks.push(task);
    this.persist();
    this.appendTranscript([
      {
        type: "task_state",
        task_id: task.id,
        status: task.status,
        input: task.input,
      },
    ]);
    return task;
  }

  listTasks(): StarterTaskRecord[] {
    return [...this.tasks];
  }

  getTask(taskId: string): StarterTaskRecord | null {
    return this.tasks.find((task) => task.id === taskId) ?? null;
  }

  askQuestion(taskId: string, text: string): { task: StarterTaskRecord; question: StarterQuestionRecord } {
    const task = this.tasks.find((entry) => entry.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status === "completed" || task.status === "failed" || task.status === "stopped") {
      throw new Error(`Task is not active: ${taskId}`);
    }

    const question: StarterQuestionRecord = {
      id: `question-${this.nextQuestionIndex}`,
      taskId,
      text: text.trim(),
      status: "pending",
      answer: null,
      createdAt: nowIso(),
      answeredAt: null,
    };
    this.nextQuestionIndex += 1;
    task.questionId = question.id;
    task.status = "waiting_for_user";
    task.updatedAt = nowIso();
    this.questions.push(question);
    this.persist();
    this.appendTranscript([
      {
        type: "question_state",
        question_id: question.id,
        task_id: task.id,
        status: question.status,
        text: question.text,
      },
      {
        type: "task_state",
        task_id: task.id,
        status: task.status,
        question_id: question.id,
      },
    ]);
    return { task: { ...task }, question };
  }

  listQuestions(status?: StarterQuestionStatus): StarterQuestionRecord[] {
    return this.questions.filter((question) => !status || question.status === status);
  }

  answerQuestion(questionId: string, answer: string): { task: StarterTaskRecord; question: StarterQuestionRecord } {
    const question = this.questions.find((entry) => entry.id === questionId);
    if (!question) {
      throw new Error(`Question not found: ${questionId}`);
    }
    if (question.status === "answered") {
      throw new Error(`Question already answered: ${questionId}`);
    }

    question.status = "answered";
    question.answer = answer.trim();
    question.answeredAt = nowIso();

    const task = this.tasks.find((entry) => entry.id === question.taskId);
    if (!task) {
      throw new Error(`Task not found for question: ${question.taskId}`);
    }

    task.answer = question.answer;
    task.output = `Task resumed after ${question.id} and completed with answer: ${question.answer}`;
    task.status = "completed";
    task.updatedAt = nowIso();
    this.persist();
    this.appendTranscript([
      {
        type: "question_state",
        question_id: question.id,
        task_id: task.id,
        status: question.status,
        answer: question.answer ?? undefined,
      },
      {
        type: "task_state",
        task_id: task.id,
        status: task.status,
        question_id: question.id,
        answer: task.answer ?? undefined,
        output: task.output ?? undefined,
      },
    ]);
    return { task: { ...task }, question: { ...question } };
  }

  stopTask(taskId: string): StarterTaskRecord {
    const task = this.tasks.find((entry) => entry.id === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status === "completed" || task.status === "failed") {
      return { ...task };
    }
    task.status = "stopped";
    task.updatedAt = nowIso();
    this.persist();
    this.appendTranscript([
      {
        type: "task_state",
        task_id: task.id,
        status: task.status,
      },
    ]);
    return { ...task };
  }
}
