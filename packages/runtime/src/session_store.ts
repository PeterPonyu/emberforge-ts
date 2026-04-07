import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

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
    private readonly baseDir: string = join(homedir(), ".emberforge", "sessions"),
  ) {}

  private pathFor(id: string): string {
    return join(this.baseDir, `${id}.jsonl`);
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
      const record: MessageRecord = {
        type: "message",
        role: m.role,
        content: m.content,
        ...(m.timestamp !== undefined ? { timestamp: m.timestamp } : {}),
      };
      lines.push(JSON.stringify(record));
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
