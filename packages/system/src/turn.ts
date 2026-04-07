import { ControlSequenceEngine, type SequenceRecord } from "./sequence.js";

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export const EMPTY_TURN_USAGE: TurnUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  costUsd: 0,
};

export function addTurnUsage(a: TurnUsage, b: TurnUsage): TurnUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

export interface TurnBudget {
  maxTurns: number;
  maxCostUsd: number;
}

export class TurnInterruptedError extends Error {
  constructor() {
    super("turn engine: interrupted");
    this.name = "TurnInterruptedError";
  }
}

export class TurnBudgetExceededError extends Error {
  constructor() {
    super("turn engine: budget exceeded");
    this.name = "TurnBudgetExceededError";
  }
}

export class TurnEngine {
  private interrupted = false;
  private turnsRunCount = 0;
  private accumulatedUsage: TurnUsage = { ...EMPTY_TURN_USAGE };

  constructor(
    private readonly sequence: ControlSequenceEngine,
    private readonly budget: TurnBudget,
  ) {}

  async submit(input: string, estimated: TurnUsage): Promise<SequenceRecord> {
    if (this.interrupted) {
      throw new TurnInterruptedError();
    }
    if (this.budget.maxTurns > 0 && this.turnsRunCount >= this.budget.maxTurns) {
      throw new TurnBudgetExceededError();
    }
    const projected = addTurnUsage(this.accumulatedUsage, estimated);
    if (this.budget.maxCostUsd > 0 && projected.costUsd > this.budget.maxCostUsd) {
      throw new TurnBudgetExceededError();
    }

    const record = await this.sequence.handle(input);

    if (this.interrupted) {
      throw new TurnInterruptedError();
    }
    this.turnsRunCount++;
    this.accumulatedUsage = projected;
    return record;
  }

  interrupt(): void {
    this.interrupted = true;
  }

  reset(): void {
    this.interrupted = false;
  }

  totalUsage(): TurnUsage {
    return { ...this.accumulatedUsage };
  }

  turnsRun(): number {
    return this.turnsRunCount;
  }
}
