import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  estimateComplexity,
  selectModel,
  parseStrategy,
  renderAvailableModelsReport,
  discoverAvailableModels,
  TaskComplexity,
  AUTO_FAST_MODEL,
  AUTO_CAPABLE_MODEL,
  HYBRID_LOCAL_MODEL,
  HYBRID_CLOUD_MODEL,
} from "./model_router.js";

test("estimateComplexity flags short non-code prompts as Simple", () => {
  assert.equal(estimateComplexity("hello"), TaskComplexity.Simple);
  assert.equal(estimateComplexity("what time is it"), TaskComplexity.Simple);
});

test("estimateComplexity flags code + multi-step prompts as Complex", () => {
  assert.equal(
    estimateComplexity("refactor the authentication module to use JWT"),
    TaskComplexity.Complex,
  );
  assert.equal(estimateComplexity("implement a REST API with pagination"), TaskComplexity.Complex);
  assert.equal(
    estimateComplexity("first read the config, then update the db, finally restart"),
    TaskComplexity.Complex,
  );
});

test("estimateComplexity flags mid-length non-code prompts as Medium", () => {
  assert.equal(estimateComplexity("what files are in the src directory"), TaskComplexity.Medium);
});

test("parseStrategy maps auto/hybrid keywords and falls back to fixed", () => {
  assert.deepEqual(parseStrategy("auto"), {
    kind: "auto",
    fastModel: AUTO_FAST_MODEL,
    capableModel: AUTO_CAPABLE_MODEL,
  });
  assert.deepEqual(parseStrategy("hybrid"), {
    kind: "hybrid",
    localModel: HYBRID_LOCAL_MODEL,
    cloudModel: HYBRID_CLOUD_MODEL,
  });
  assert.deepEqual(parseStrategy("qwen3:8b"), { kind: "fixed", model: "qwen3:8b" });
});

test("selectModel under auto routes simple->fast and complex->capable", () => {
  const strategy = parseStrategy("auto");
  assert.equal(selectModel(strategy, "hi"), AUTO_FAST_MODEL);
  assert.equal(selectModel(strategy, "refactor the auth module please now"), AUTO_CAPABLE_MODEL);
});

test("selectModel under hybrid routes light->local and complex->cloud", () => {
  const strategy = parseStrategy("hybrid");
  assert.equal(selectModel(strategy, "what files are in the src directory"), HYBRID_LOCAL_MODEL);
  assert.equal(selectModel(strategy, "implement a full auth subsystem"), HYBRID_CLOUD_MODEL);
});

test("selectModel under fixed always returns the same model", () => {
  const strategy = parseStrategy("llama3.1:8b");
  assert.equal(selectModel(strategy, "hi"), "llama3.1:8b");
  assert.equal(selectModel(strategy, "implement a database"), "llama3.1:8b");
});

test("renderAvailableModelsReport marks the current model and lists shortcuts", () => {
  const report = renderAvailableModelsReport("qwen3:8b", {
    ollamaModels: ["llama3:8b", "qwen3:8b"],
    ollamaStatus: "reachable - 2 local model(s) detected",
  });
  assert.match(report, /Available models/);
  assert.match(report, /Ollama state {5}reachable - 2 local model\(s\) detected/);
  assert.match(report, /\* qwen3:8b/);
  assert.match(report, /- llama3:8b/);
  assert.match(report, /Cloud shortcuts/);
  assert.match(report, /opus {7}claude-opus-4-6/);
  assert.match(report, /Routing shortcuts/);
  assert.match(report, /auto {7}Route simpler prompts/);
});

test("discoverAvailableModels degrades to unreachable status on transport failure", async () => {
  // No server on this port: discovery must NOT throw; it returns a status.
  const catalog = await discoverAvailableModels("qwen3:8b", "http://127.0.0.1:1");
  assert.match(catalog.ollamaStatus, /unreachable/);
  // The current local model is still surfaced even when Ollama is unreachable.
  assert.deepEqual(catalog.ollamaModels, ["qwen3:8b"]);
});

test("discoverAvailableModels folds in real /api/tags models", async () => {
  const http = await import("node:http");
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "qwen3:8b" }, { name: "llama3:8b" }] }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    const catalog = await discoverAvailableModels("qwen3:8b", `http://127.0.0.1:${port}`);
    assert.deepEqual(catalog.ollamaModels, ["llama3:8b", "qwen3:8b"]);
    assert.match(catalog.ollamaStatus, /reachable - 2 local model\(s\) detected/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
