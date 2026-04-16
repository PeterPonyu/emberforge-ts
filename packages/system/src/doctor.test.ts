import test from "node:test";
import assert from "node:assert/strict";

import { buildDoctorReport } from "./doctor.js";

test("buildDoctorReport renders translated starter diagnostics", () => {
  const report = buildDoctorReport(
    {
      appName: "emberforge-ts",
      commandCount: 11,
      toolCount: 3,
      pluginCount: 1,
      serverDescription: "server: disabled",
      lspSummary: "lsp: idle",
      rustAnchor: "/tmp/runtime/lib.rs",
      turnCount: 0,
      handledRequestCount: 0,
      lifecycleState: "ready",
      lastRoute: null,
      lastPhaseHistory: [],
      lastTurnInput: null,
    },
    {
      OLLAMA_BASE_URL: "http://localhost:11434",
      OLLAMA_MODEL: "qwen3:8b",
      ANTHROPIC_API_KEY: "",
      XAI_API_KEY: "token",
    },
  );

  assert.match(report, /emberforge-ts doctor/);
  assert.match(report, /commands: 11/);
  assert.match(report, /xai_api_key: present/);
  assert.match(report, /anthropic_api_key: missing/);
});
