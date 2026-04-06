import type { CommandRegistry } from "../../commands/src/index.js";
import type { ConversationRuntime } from "../../runtime/src/index.js";
import type { TelemetrySink } from "../../telemetry/src/index.js";
import type { ControlSequenceContext } from "./context.js";
import type { DispatchDecision, DispatchRoute, SystemDispatcher } from "./dispatch.js";
import { LifecycleTracker, type LifecycleState } from "./lifecycle.js";

export interface SequenceRecord {
  requestId: string;
  input: string;
  route: DispatchRoute;
  phases: LifecycleState[];
  output: string;
}

export class ControlSequenceEngine {
  private nextRequestNumber = 1;
  private readonly sequenceRecords: SequenceRecord[] = [];

  constructor(
    private readonly runtime: ConversationRuntime,
    private readonly commands: CommandRegistry,
    private readonly dispatcher: SystemDispatcher,
    private readonly lifecycle: LifecycleTracker,
    private readonly telemetry: TelemetrySink,
  ) {}

  bootstrap(): void {
    if (this.lifecycle.current() !== "created") {
      return;
    }
    this.lifecycle.transition("bootstrapping");
    this.telemetry.record({ name: "bootstrap_completed", details: "system ready" });
    this.lifecycle.transition("ready");
  }

  handle(input: string): SequenceRecord {
    if (this.lifecycle.current() === "created") {
      this.bootstrap();
    }

    const context: ControlSequenceContext = {
      requestId: `req-${this.nextRequestNumber++}`,
      input,
    };
    const phases: LifecycleState[] = [];
    const mark = (state: LifecycleState): void => {
      this.lifecycle.transition(state);
      phases.push(state);
    };

    mark("dispatching");
    const decision = this.dispatcher.dispatch(input);
    context.route = decision.route;

    mark("executing");
    const output = this.executeDecision(decision);

    mark("persisting");
    const record: SequenceRecord = {
      requestId: context.requestId,
      input: context.input,
      route: decision.route,
      phases,
      output,
    };
    this.sequenceRecords.push(record);
    this.telemetry.record({ name: "sequence_persisted", details: `${record.requestId}:${record.route}` });

    mark("reporting");
    this.telemetry.record({ name: "sequence_reported", details: output });

    this.lifecycle.transition("ready");
    return record;
  }

  shutdown(): void {
    if (this.lifecycle.current() === "stopped") {
      return;
    }
    this.lifecycle.transition("shutting_down");
    this.telemetry.record({ name: "shutdown_completed", details: `handled=${this.sequenceRecords.length}` });
    this.lifecycle.transition("stopped");
  }

  records(): SequenceRecord[] {
    return [...this.sequenceRecords];
  }

  lastRecord(): SequenceRecord | undefined {
    return this.sequenceRecords.at(-1);
  }

  lifecycleState(): LifecycleState {
    return this.lifecycle.current();
  }

  private executeDecision(decision: DispatchDecision): string {
    switch (decision.route) {
      case "command":
        return this.renderCommandOutput(decision.commandName ?? "unknown");
      case "tool":
        return this.runtime.runTurn(`/tool ${decision.payload}`);
      case "prompt":
        return this.runtime.runTurn(decision.payload);
    }
  }

  private renderCommandOutput(commandName: string): string {
    const command = this.commands.find(commandName);
    if (commandName === "status") {
      return `[command] status: lifecycle=${this.lifecycle.current()} handled=${this.sequenceRecords.length}`;
    }
    if (commandName === "model") {
      return "[command] model: registry-driven control sequence starter";
    }
    if (command) {
      return `[command] ${command.name}: ${command.description}`;
    }
    return `[command] unknown: ${commandName}`;
  }
}
