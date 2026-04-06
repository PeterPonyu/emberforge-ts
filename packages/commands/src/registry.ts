import type { CommandSpec } from "./spec.js";

export const DEFAULT_COMMANDS: CommandSpec[] = [
  { name: "help", description: "Show the translated command registry" },
  { name: "status", description: "Report starter runtime status" },
  { name: "model", description: "Mirror a Rust-style CLI command" },
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
