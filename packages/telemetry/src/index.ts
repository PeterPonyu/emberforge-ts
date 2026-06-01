export type {
  TelemetryEvent,
  AnalyticsEvent,
  SessionTraceRecord,
  TelemetryRecord,
} from "./types.js";
export type { TelemetrySink, StructuredTelemetrySink } from "./sink.js";
export {
  ConsoleTelemetrySink,
  JsonlTelemetrySink,
  MemoryTelemetrySink,
  SessionTracer,
} from "./sink.js";

export const RUST_TELEMETRY_REFERENCE = "crates/telemetry/src/lib.rs";
