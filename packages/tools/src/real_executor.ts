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

function isWithin(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

function isWorkspaceRelative(filePath: string): boolean {
  return isWithin(process.cwd(), path.resolve(filePath));
}

/**
 * Resolve the real (symlink-free) path of `filePath` and confirm it stays
 * inside the workspace root. The target itself may not exist yet, so we
 * resolve `fs.realpath()` of the nearest existing ancestor directory and then
 * re-join the not-yet-created components. This defeats symlinks that live
 * inside the workspace but point outside it. Returns the real path on success.
 */
async function resolveWithinWorkspace(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);

  // Cheap lexical gate first (also rejects `..` traversal pre-symlink).
  if (!isWorkspaceRelative(resolved)) {
    throw new Error(`Path outside workspace: ${filePath}`);
  }

  const realRoot = await fs.realpath(process.cwd());

  // Walk up to the nearest existing ancestor, then realpath it.
  let existing = resolved;
  const pending: string[] = [];
  while (true) {
    try {
      const realExisting = await fs.realpath(existing);
      const realTarget = pending.length
        ? path.join(realExisting, ...pending)
        : realExisting;
      if (!isWithin(realRoot, realTarget)) {
        throw new Error(`Path outside workspace: ${filePath}`);
      }
      return realTarget;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw err;
      }
      const parent = path.dirname(existing);
      if (parent === existing) {
        // Reached filesystem root without an existing ancestor.
        throw new Error(`Path outside workspace: ${filePath}`);
      }
      pending.unshift(path.basename(existing));
      existing = parent;
    }
  }
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
    const realPath = await resolveWithinWorkspace(filePath);

    const stat = await fs.stat(realPath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File too large: ${stat.size} bytes exceeds 10 MB limit`,
      );
    }
    return fs.readFile(realPath, "utf-8");
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

    const realPath = await resolveWithinWorkspace(filePath);

    await fs.writeFile(realPath, content);
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
