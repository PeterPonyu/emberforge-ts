import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ToolExecutor } from "./executor.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const BLOCKED_COMMAND_PREFIXES = ["sudo", "rm -rf /"];

function isBlockedCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  return BLOCKED_COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function isWorkspaceRelative(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const cwd = process.cwd();
  return resolved.startsWith(cwd + path.sep) || resolved === cwd;
}

export class RealToolExecutor implements ToolExecutor {
  async execute(toolName: string, input: string): Promise<string> {
    switch (toolName) {
      case "read_file":
        return this.readFile(input);
      case "write_file":
        return this.writeFile(input);
      case "bash":
        return this.bash(input);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async readFile(filePath: string): Promise<string> {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${stat.size} bytes exceeds 10 MB limit`,
      );
    }
    return fs.readFile(filePath, "utf-8");
  }

  private async writeFile(input: string): Promise<string> {
    const newlineIndex = input.indexOf("\n");
    if (newlineIndex === -1) {
      throw new Error(
        "write_file input must be: <path>\\n<content>",
      );
    }
    const filePath = input.slice(0, newlineIndex);
    const content = input.slice(newlineIndex + 1);

    if (!isWorkspaceRelative(filePath)) {
      throw new Error(
        `Path outside workspace: ${filePath}`,
      );
    }

    await fs.writeFile(filePath, content);
    return `Written: ${filePath}`;
  }

  private bash(cmd: string): Promise<string> {
    if (isBlockedCommand(cmd)) {
      return Promise.reject(new Error(`Blocked command: ${cmd}`));
    }

    return new Promise<string>((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);

      const proc = spawn(cmd, [], {
        shell: true,
        signal: controller.signal,
      });

      const chunks: Buffer[] = [];

      proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      proc.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));

      proc.on("close", (code) => {
        clearTimeout(timer);
        const output = Buffer.concat(chunks).toString("utf-8");
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Command exited with code ${code}: ${output}`));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (controller.signal.aborted) {
          reject(new Error("Command timed out after 30 seconds"));
        } else {
          reject(err);
        }
      });
    });
  }
}
