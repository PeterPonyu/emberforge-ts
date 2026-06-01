import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
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

type JsonObject = Record<string, unknown>;

/** Parse a tool's JSON input, raising a tool-named error on malformed input. */
function parseJsonInput(input: string, tool: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error(`${tool}: input must be a JSON object`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${tool}: input must be a JSON object`);
  }
  return parsed as JsonObject;
}

/** Extract a required string field from parsed JSON input. */
function requireString(args: JsonObject, field: string, tool: string): string {
  const value = args[field];
  if (typeof value !== "string") {
    throw new Error(`${tool}: missing required string field '${field}'`);
  }
  return value;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

const WALK_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "dist-test"]);

/** Recursively yield regular file paths under `root`, skipping noise dirs. */
async function* walkFiles(root: string): AsyncGenerator<string> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (WALK_SKIP_DIRS.has(entry.name)) {
        continue;
      }
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
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
      case "edit_file":
        return this.editFile(input);
      case "glob_search":
        return this.globSearch(input);
      case "grep_search":
        return this.grepSearch(input);
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

  /**
   * Replaces `old_string` with `new_string` in a workspace file. Input is JSON
   * matching the `edit_file` schema. Fails if `old_string` is absent, or (when
   * `replace_all` is false) appears more than once — mirroring an exact, unique
   * edit contract.
   */
  private async editFile(input: string): Promise<string> {
    const args = parseJsonInput(input, "edit_file");
    const filePath = requireString(args, "path", "edit_file");
    const oldString = requireString(args, "old_string", "edit_file");
    const newString = requireString(args, "new_string", "edit_file");
    const replaceAll = args.replace_all === true;

    const realPath = await resolveWithinWorkspace(filePath);
    const original = await fs.readFile(realPath, "utf-8");

    const occurrences = countOccurrences(original, oldString);
    if (occurrences === 0) {
      throw new Error("edit_file: old_string not found");
    }
    if (occurrences > 1 && !replaceAll) {
      throw new Error(
        `edit_file: old_string is not unique (${occurrences} matches); set replace_all`,
      );
    }

    const updated = replaceAll
      ? original.split(oldString).join(newString)
      : original.replace(oldString, newString);
    await fs.writeFile(realPath, updated);
    return `Edited: ${filePath}`;
  }

  /**
   * Lists workspace files matching a glob pattern. Input is JSON matching the
   * `glob_search` schema. Uses `fs.glob` and confines results to the workspace.
   */
  private async globSearch(input: string): Promise<string> {
    const args = parseJsonInput(input, "glob_search");
    const pattern = requireString(args, "pattern", "glob_search");
    const cwd =
      typeof args.path === "string" && args.path
        ? await resolveWithinWorkspace(args.path)
        : process.cwd();

    const matches: string[] = [];
    for await (const entry of fs.glob(pattern, { cwd })) {
      matches.push(entry);
    }
    matches.sort();
    return matches.join("\n");
  }

  /**
   * Searches file contents for a regex pattern. Input is JSON matching the
   * `grep_search` schema. Walks the workspace (or `path` subtree), skipping the
   * `node_modules` / `.git` / `dist` directories, and returns matching lines.
   */
  private async grepSearch(input: string): Promise<string> {
    const args = parseJsonInput(input, "grep_search");
    const pattern = requireString(args, "pattern", "grep_search");
    const ignoreCase = args["-i"] === true;
    const showLineNumbers = args["-n"] === true;
    const root =
      typeof args.path === "string" && args.path
        ? await resolveWithinWorkspace(args.path)
        : process.cwd();

    const regex = new RegExp(pattern, ignoreCase ? "i" : "");
    const results: string[] = [];
    for await (const filePath of walkFiles(root)) {
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch {
        continue; // unreadable/binary — skip
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (regex.test(line)) {
          const rel = path.relative(process.cwd(), filePath);
          results.push(showLineNumbers ? `${rel}:${i + 1}:${line}` : `${rel}:${line}`);
        }
      }
    }
    return results.join("\n");
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
