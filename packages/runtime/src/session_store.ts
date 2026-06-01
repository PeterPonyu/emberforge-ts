import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Default session directory: `.emberforge/sessions` under the current working
 * directory, mirroring the Rust port's project-local session storage. Resolved
 * lazily so tests and callers can override the base dir explicitly.
 */
export function defaultSessionDir(): string {
  return join(process.cwd(), ".emberforge", "sessions");
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: string;
}

export interface Session {
  id: string;
  createdAt: string;
  messages: ConversationMessage[];
}

export interface SessionSummary {
  id: string;
  messageCount: number;
  lastModified: string;
}

export function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return randomBytes(16).toString("hex");
}

type MetaRecord = {
  type: "session";
  id: string;
  createdAt: string;
};

type MessageRecord = {
  type: "message";
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: string;
};

export class SessionStore {
  constructor(
    private readonly baseDir: string = defaultSessionDir(),
  ) {}

  private pathFor(id: string): string {
    return join(this.baseDir, `${id}.jsonl`);
  }

  private encodeMessage(message: ConversationMessage): string {
    const record: MessageRecord = {
      type: "message",
      role: message.role,
      content: message.content,
      ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
    };
    return JSON.stringify(record);
  }

  /**
   * Ensures the JSONL file for `session` exists with its meta header line.
   * Idempotent: if the file already exists it is left untouched so prior turns
   * are preserved. Call once before streaming turns with {@link appendMessage}.
   */
  async ensureSession(session: Pick<Session, "id" | "createdAt">): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const path = this.pathFor(session.id);
    try {
      await fs.access(path);
      return;
    } catch {
      // not present yet — write the meta header
    }
    const meta: MetaRecord = {
      type: "session",
      id: session.id,
      createdAt: session.createdAt,
    };
    await fs.writeFile(path, JSON.stringify(meta) + "\n", "utf-8");
  }

  /**
   * Appends a single message record to the session's JSONL file. Used to
   * persist after each turn rather than only on exit, mirroring the Rust port's
   * append-on-turn behavior. Assumes {@link ensureSession} has run first.
   */
  async appendMessage(id: string, message: ConversationMessage): Promise<void> {
    await fs.appendFile(this.pathFor(id), this.encodeMessage(message) + "\n", "utf-8");
  }

  async save(session: Session): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const meta: MetaRecord = {
      type: "session",
      id: session.id,
      createdAt: session.createdAt,
    };
    const lines: string[] = [JSON.stringify(meta)];
    for (const m of session.messages) {
      lines.push(this.encodeMessage(m));
    }
    await fs.writeFile(this.pathFor(session.id), lines.join("\n") + "\n", "utf-8");
  }

  async load(id: string): Promise<Session> {
    let raw: string;
    try {
      raw = await fs.readFile(this.pathFor(id), "utf-8");
    } catch {
      throw new Error(`Session not found: ${id}`);
    }
    const nonEmpty = raw.split("\n").filter((l) => l.trim() !== "");
    if (nonEmpty.length === 0) {
      throw new Error(`Session file is empty: ${id}`);
    }
    const meta = JSON.parse(nonEmpty[0]) as MetaRecord;
    if (meta.type !== "session") {
      throw new Error(`Invalid session file format: ${id}`);
    }
    const messages: ConversationMessage[] = nonEmpty.slice(1).map((line) => {
      const rec = JSON.parse(line) as MessageRecord;
      const msg: ConversationMessage = { role: rec.role, content: rec.content };
      if (rec.timestamp !== undefined) {
        msg.timestamp = rec.timestamp;
      }
      return msg;
    });
    return { id: meta.id, createdAt: meta.createdAt, messages };
  }

  async list(): Promise<SessionSummary[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.baseDir);
    } catch {
      return [];
    }
    const jsonlFiles = entries.filter((e) => e.endsWith(".jsonl"));
    const summaries: SessionSummary[] = [];
    for (const file of jsonlFiles) {
      const id = file.slice(0, -".jsonl".length);
      const filePath = join(this.baseDir, file);
      try {
        const [raw, stat] = await Promise.all([
          fs.readFile(filePath, "utf-8"),
          fs.stat(filePath),
        ]);
        const messageCount = raw
          .split("\n")
          .filter((l) => l.trim() !== "")
          .filter((_, i) => i > 0).length;
        summaries.push({
          id,
          messageCount,
          lastModified: stat.mtime.toISOString(),
        });
      } catch {
        // skip malformed sessions
      }
    }
    return summaries;
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.pathFor(id));
    } catch {
      throw new Error(`Session not found: ${id}`);
    }
  }
}
