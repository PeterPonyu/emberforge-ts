import { test } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import { OllamaProvider } from "./ollama_provider.js";

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
