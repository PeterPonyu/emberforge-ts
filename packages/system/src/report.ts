export interface StarterSystemReport {
  appName: string;
  commandCount: number;
  toolCount: number;
  pluginCount: number;
  serverDescription: string;
  lspSummary: string;
  rustAnchor: string;
  turnCount: number;
  handledRequestCount: number;
  lifecycleState: string;
  lastRoute: string | null;
  lastPhaseHistory: string[];
  lastTurnInput: string | null;
}
