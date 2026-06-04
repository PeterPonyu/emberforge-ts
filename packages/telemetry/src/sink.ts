import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AnalyticsEvent,
  SessionTraceRecord,
  TelemetryEvent,
  TelemetryRecord,
} from "./types.js";

export interface TelemetrySink {
  record(event: TelemetryEvent): void;
}

/**
 * Emits human-readable telemetry lines. The destination writer is injectable so
 * callers can route diagnostics off stdout — e.g. one-shot `prompt` mode passes
 * a stderr writer so stdout carries only the model answer. Defaults to
 * `console.log` (stdout) for the interactive REPL, preserving prior behavior.
 */
export class ConsoleTelemetrySink implements TelemetrySink {
  private readonly write: (line: string) => void;

  constructor(write: (line: string) => void = (line) => console.log(line)) {
    this.write = write;
  }

  record(event: TelemetryEvent): void {
    this.write(`[telemetry] ${event.name}: ${event.details}`);
  }
}

/**
 * Structured sink for the JSONL/session-trace surface, mirroring the Rust
 * `TelemetrySink` trait in `crates/telemetry/src/lib.rs`. Kept separate from the
 * legacy `{ name, details }` `TelemetrySink` so existing runtime call sites are
 * untouched.
 */
export interface StructuredTelemetrySink {
  recordRecord(record: TelemetryRecord): void;
}

/**
 * Collects structured records in memory. Mirrors the Rust `MemoryTelemetrySink`
 * and is primarily useful for tests and the session tracer.
 */
export class MemoryTelemetrySink implements StructuredTelemetrySink {
  private readonly records: TelemetryRecord[] = [];

  recordRecord(record: TelemetryRecord): void {
    this.records.push(record);
  }

  events(): TelemetryRecord[] {
    return [...this.records];
  }
}

/**
 * Appends structured telemetry records as JSON Lines to a file, creating parent
 * directories on construction and opening the log in append mode so existing
 * telemetry is preserved. Mirrors the Rust `JsonlTelemetrySink`.
 *
 * Writes are synchronous (`appendFileSync`) so each `recordRecord` call is
 * durable before it returns — matching the Rust sink's flush-after-write
 * semantics and avoiding interleaving across concurrent callers.
 */
export class JsonlTelemetrySink implements StructuredTelemetrySink {
  private readonly logPath: string;

  constructor(path: string) {
    this.logPath = path;
    const parent = dirname(path);
    if (parent && parent !== ".") {
      mkdirSync(parent, { recursive: true });
    }
  }

  path(): string {
    return this.logPath;
  }

  recordRecord(record: TelemetryRecord): void {
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      return;
    }
    appendFileSync(this.logPath, line + "\n", "utf-8");
  }
}

function currentTimestampMs(): number {
  return Date.now();
}

/**
 * Session-scoped tracer that stamps each emitted record with a monotonically
 * increasing sequence number, mirroring the Rust `SessionTracer`.
 */
export class SessionTracer {
  private sequence = 0;

  constructor(
    private readonly sessionId: string,
    private readonly sink: StructuredTelemetrySink,
  ) {}

  getSessionId(): string {
    return this.sessionId;
  }

  record(name: string, attributes: Record<string, unknown> = {}): void {
    const record: SessionTraceRecord = {
      sessionId: this.sessionId,
      sequence: this.sequence,
      name,
      timestampMs: currentTimestampMs(),
      attributes,
    };
    this.sequence += 1;
    this.sink.recordRecord({
      type: "session_trace",
      session_id: record.sessionId,
      sequence: record.sequence,
      name: record.name,
      timestamp_ms: record.timestampMs,
      ...(Object.keys(record.attributes ?? {}).length > 0
        ? { attributes: record.attributes }
        : {}),
    });
  }

  recordAnalytics(event: AnalyticsEvent): void {
    this.sink.recordRecord({
      type: "analytics",
      namespace: event.namespace,
      action: event.action,
      ...(event.properties && Object.keys(event.properties).length > 0
        ? { properties: event.properties }
        : {}),
    });
    const attributes: Record<string, unknown> = {
      ...(event.properties ?? {}),
      namespace: event.namespace,
      action: event.action,
    };
    this.record("analytics", attributes);
  }
}
