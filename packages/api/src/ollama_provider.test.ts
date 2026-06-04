import { test } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import { OllamaProvider, normalizeOllamaBaseURL } from "./ollama_provider.js";

test("normalizeOllamaBaseURL strips a trailing /v1 and is idempotent", () => {
  // Root form is unchanged.
  assert.equal(normalizeOllamaBaseURL("http://host:11434"), "http://host:11434");
  // OpenAI-compat /v1 suffix is removed so the native /api path resolves.
  assert.equal(normalizeOllamaBaseURL("http://host:11434/v1"), "http://host:11434");
  // Trailing slashes (with or without /v1) are tolerated.
  assert.equal(normalizeOllamaBaseURL("http://host:11434/"), "http://host:11434");
  assert.equal(normalizeOllamaBaseURL("http://host:11434/v1/"), "http://host:11434");
  // Case-insensitive and host/port-agnostic.
  assert.equal(normalizeOllamaBaseURL("https://example.test:8443/V1"), "https://example.test:8443");
  // Idempotent: normalizing an already-normalized value is a no-op.
  assert.equal(
    normalizeOllamaBaseURL(normalizeOllamaBaseURL("http://host:11434/v1")),
    "http://host:11434",
  );
  // A non-/v1 path segment is preserved.
  assert.equal(normalizeOllamaBaseURL("http://host:11434/ollama"), "http://host:11434/ollama");
});

test("OllamaProvider hits the native /api/chat path for BOTH base forms", async () => {
  const paths: string[] = [];
  const server = http.createServer((req, res) => {
    paths.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(`{"model":"test","message":{"role":"assistant","content":"ok"},"done":false}\n`);
    res.write(`{"model":"test","done":true}\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;

  // Root base form.
  const rootProvider = new OllamaProvider(`http://127.0.0.1:${port}`, "test");
  const rootResp = await rootProvider.sendMessage({ model: "test", prompt: "hi" });
  assert.equal(rootResp.text, "ok");

  // OpenAI-compat /v1 base form must resolve to the same native endpoint.
  const v1Provider = new OllamaProvider(`http://127.0.0.1:${port}/v1`, "test");
  const v1Resp = await v1Provider.sendMessage({ model: "test", prompt: "hi" });
  assert.equal(v1Resp.text, "ok");

  // Both requests must have targeted the native /api/chat path (no /v1 prefix).
  assert.deepEqual(paths, ["/api/chat", "/api/chat"]);
  await new Promise<void>((r) => server.close(() => r()));
});

test("OllamaProvider concatenates NDJSON deltas", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(`{"model":"test","message":{"role":"assistant","content":"He"},"done":false}\n`);
    res.write(`{"model":"test","message":{"role":"assistant","content":"llo"},"done":false}\n`);
    res.write(`{"model":"test","done":true}\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const provider = new OllamaProvider(`http://127.0.0.1:${port}`, "test");
  const resp = await provider.sendMessage({ model: "test", prompt: "hi" });
  assert.equal(resp.text, "Hello");
  await new Promise<void>((r) => server.close(() => r()));
});

test("OllamaProvider throws on non-200 response", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(500);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const provider = new OllamaProvider(`http://127.0.0.1:${port}`, "test");
  await assert.rejects(
    () => provider.sendMessage({ model: "test", prompt: "hi" }),
    /Ollama HTTP 500/,
  );
  await new Promise<void>((r) => server.close(() => r()));
});

test("OllamaProvider prefers request.model over constructor default", async () => {
  let capturedModel = "";
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    capturedModel = JSON.parse(Buffer.concat(chunks).toString("utf8")).model;
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(`{"model":"test","done":true}\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const provider = new OllamaProvider(`http://127.0.0.1:${port}`, "constructor-model");
  await provider.sendMessage({ model: "request-model", prompt: "hi" });
  assert.equal(capturedModel, "request-model");
  await new Promise<void>((r) => server.close(() => r()));
});
