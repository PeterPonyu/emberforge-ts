import type { TelemetryEvent } from "./types.js";

export interface TelemetrySink {
  record(event: TelemetryEvent): void;
}

export class ConsoleTelemetrySink implements TelemetrySink {
  record(event: TelemetryEvent): void {
    console.log(`[telemetry] ${event.name}: ${event.details}`);
  }
}
