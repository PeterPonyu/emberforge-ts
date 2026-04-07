export interface StarterSystemConfig {
  appName: string;
  port: number;
  commandDemoName: string;
  greeting: string;
  toolDemoCommand: string;
  maxTurns: number;
  maxCostUsd: number;
}

export const DEFAULT_STARTER_SYSTEM_CONFIG: StarterSystemConfig = {
  appName: "emberforge-ts system",
  port: 8080,
  commandDemoName: "help",
  greeting: "hello from typescript system",
  toolDemoCommand: "printf translated",
  maxTurns: 16,
  maxCostUsd: 1.0,
};
