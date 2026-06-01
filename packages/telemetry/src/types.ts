/**
 * Telemetry event surface, mirroring the Rust `TelemetryEvent` enum in
 * `crates/telemetry/src/lib.rs`. The legacy `{ name, details }` shape is kept as
 * the simple console/runtime event; the structured records below back the JSONL
 * sink and session-scoped sequencing.
 */
export interface TelemetryEvent {
  name: string;
  details: string;
}

export interface AnalyticsEvent {
  namespace: string;
  action: string;
  properties?: Record<string, unknown>;
}

export interface SessionTraceRecord {
  sessionId: string;
  sequence: number;
  name: string;
  timestampMs: number;
  attributes?: Record<string, unknown>;
}

/**
 * Structured telemetry record persisted to the JSONL sink. The `type`
 * discriminant mirrors the snake_case tag used by the Rust serde enum so the
 * two ports emit interchangeable log lines.
 */
export type TelemetryRecord =
  | { type: "analytics"; namespace: string; action: string; properties?: Record<string, unknown> }
  | {
      type: "session_trace";
      session_id: string;
      sequence: number;
      name: string;
      timestamp_ms: number;
      attributes?: Record<string, unknown>;
    };
