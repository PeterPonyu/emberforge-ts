export const LIFECYCLE_STATES = [
  "created",
  "bootstrapping",
  "ready",
  "dispatching",
  "executing",
  "persisting",
  "reporting",
  "shutting_down",
  "stopped",
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export class LifecycleTracker {
  private currentState: LifecycleState = "created";
  private readonly stateHistory: LifecycleState[] = ["created"];

  transition(nextState: LifecycleState): void {
    this.currentState = nextState;
    this.stateHistory.push(nextState);
  }

  current(): LifecycleState {
    return this.currentState;
  }

  history(): LifecycleState[] {
    return [...this.stateHistory];
  }
}
