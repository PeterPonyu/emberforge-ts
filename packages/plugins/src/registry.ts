import type { Plugin, PluginMetadata } from "./types.js";

export class ExamplePlugin implements Plugin {
  private readonly info: PluginMetadata = {
    id: "example.bundled",
    name: "ExamplePlugin",
    version: "0.1.0",
    description: "A minimal plugin mirroring emberforge::plugins::Plugin",
  };

  metadata(): PluginMetadata {
    return this.info;
  }

  validate(): boolean {
    return this.info.id.length > 0 && this.info.name.length > 0;
  }
}

export class PluginRegistry {
  constructor(private readonly plugins: Plugin[] = [new ExamplePlugin()]) {}

  list(): Plugin[] {
    return [...this.plugins];
  }
}

export function getPlugins(): Plugin[] {
  return new PluginRegistry().list();
}
