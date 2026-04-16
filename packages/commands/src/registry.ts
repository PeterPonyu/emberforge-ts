import type { CommandSpec } from "./spec.js";

export const DEFAULT_COMMANDS: CommandSpec[] = [
  { name: "help", description: "Show the translated command registry", category: "core" },
  { name: "status", description: "Report starter runtime status", category: "core" },
  { name: "doctor", description: "Run translated environment diagnostics", category: "core", argumentHint: "[quick|status]" },
  { name: "model", description: "Switch or inspect the active model", category: "core", argumentHint: "[model|list]" },
  { name: "questions", description: "Inspect and answer task-linked questions", category: "session", argumentHint: "[ask <task-id> <text>|pending|answer <question-id> <text>]" },
  { name: "tasks", description: "Create and inspect translated background tasks", category: "automation", argumentHint: "[create prompt <text>|list|show <task-id>|stop <task-id>]" },
  { name: "buddy", description: "Manage the translated companion buddy", category: "core", argumentHint: "[hatch|rehatch|pet|mute|unmute]" },
  { name: "compact", description: "Summarize the current conversation state", category: "core" },
  { name: "review", description: "Review the current workspace changes", category: "git", argumentHint: "[scope]" },
  { name: "commit", description: "Prepare a translated commit summary", category: "git" },
  { name: "pr", description: "Prepare a translated pull request summary", category: "git", argumentHint: "[context]" },
];

export class CommandRegistry {
  constructor(private readonly commands: CommandSpec[] = DEFAULT_COMMANDS) {}

  list(): CommandSpec[] {
    return [...this.commands];
  }

  find(name: string): CommandSpec | undefined {
    return this.commands.find((command) => command.name === name);
  }
}

export function getCommands(): CommandSpec[] {
  return new CommandRegistry().list();
}
