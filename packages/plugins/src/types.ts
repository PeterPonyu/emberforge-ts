export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
}

export interface Plugin {
  metadata(): PluginMetadata;
  validate(): boolean;
}
