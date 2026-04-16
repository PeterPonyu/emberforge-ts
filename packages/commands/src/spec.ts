export type CommandCategory = "core" | "workspace" | "session" | "git" | "automation";

export interface CommandSpec {
  name: string;
  description: string;
  category: CommandCategory;
  argumentHint?: string;
}
