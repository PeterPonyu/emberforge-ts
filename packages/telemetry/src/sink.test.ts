import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  JsonlTelemetrySink,
  MemoryTelemetrySink,
  SessionTracer,
} from "./sink.js";
import type { TelemetryRecord } from "./types.js";

test("JsonlTelemetrySink creates parent dirs and appends JSONL records", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-telemetry-test-"));
  try {
    // Nested path that does not yet exist exercises parent-dir creation.
    const logPath = path.join(dir, "nested", "trace", "telemetry.jsonl");
    const sink = new JsonlTelemetrySink(logPath);
    assert.equal(sink.path(), logPath);

    sink.recordRecord({
      type: "analytics",
      namespace: "cli",
      action: "turn_completed",
      properties: { ok: true },
    });
    sink.recordRecord({
      type: "session_trace",
      session_id: "session-1",
      sequence: 0,
      name: "analytics",
      timestamp_ms: 123,
    });

    const raw = await fs.readFile(logPath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), `invalid JSON: ${line}`);
    }
    const first = JSON.parse(lines[0]) as TelemetryRecord;
    assert.equal(first.type, "analytics");
    assert.ok(raw.includes('"action":"turn_completed"'));
    assert.ok(raw.includes('"type":"session_trace"'));
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});

test("JsonlTelemetrySink appends to existing log without truncating", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-telemetry-test-"));
  try {
    const logPath = path.join(dir, "telemetry.jsonl");

    const first = new JsonlTelemetrySink(logPath);
    first.recordRecord({ type: "analytics", namespace: "cli", action: "a" });

    // Reopening the same path must preserve the prior record.
    const second = new JsonlTelemetrySink(logPath);
    second.recordRecord({ type: "analytics", namespace: "cli", action: "b" });

    const raw = await fs.readFile(logPath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    assert.equal(lines.length, 2);
    assert.ok(raw.includes('"action":"a"'));
    assert.ok(raw.includes('"action":"b"'));
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});

test("SessionTracer assigns monotonically increasing sequence numbers", () => {
  const sink = new MemoryTelemetrySink();
  const tracer = new SessionTracer("session-123", sink);

  tracer.record("turn_started", { input: "hi" });
  tracer.recordAnalytics({
    namespace: "cli",
    action: "prompt_sent",
    properties: { model: "qwen3" },
  });

  const events = sink.events();
  // record() -> 1 trace; recordAnalytics() -> 1 analytics + 1 trace.
  assert.equal(events.length, 3);

  const traces = events.filter((e) => e.type === "session_trace");
  assert.equal(traces.length, 2);
  assert.equal(traces[0].type === "session_trace" && traces[0].sequence, 0);
  assert.equal(traces[1].type === "session_trace" && traces[1].sequence, 1);
  assert.equal(
    traces[0].type === "session_trace" && traces[0].session_id,
    "session-123",
  );

  const analytics = events.find((e) => e.type === "analytics");
  assert.ok(analytics !== undefined);
  assert.equal(analytics.type === "analytics" && analytics.action, "prompt_sent");
});

test("SessionTracer round-trips through JsonlTelemetrySink", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-telemetry-test-"));
  try {
    const logPath = path.join(dir, "session.jsonl");
    const sink = new JsonlTelemetrySink(logPath);
    const tracer = new SessionTracer("session-xyz", sink);

    tracer.record("provider_completed", { tokens: 42 });

    const raw = await fs.readFile(logPath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]) as TelemetryRecord;
    assert.equal(record.type, "session_trace");
    assert.equal(record.type === "session_trace" && record.session_id, "session-xyz");
    assert.equal(record.type === "session_trace" && record.sequence, 0);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});
