import { test } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import {
  OllamaProvider,
  normalizeOllamaBaseURL,
  maxTokensForModel,
  parseNumPredict,
  isThinkingModel,
  shouldShowThinking,
  ThinkStreamSeparator,
  DEFAULT_OLLAMA_NUM_PREDICT,
  OPUS_OLLAMA_NUM_PREDICT,
} from "./ollama_provider.js";
import { listOllamaModels } from "./model_router.js";
import { SYSTEM_PROMPT_INTRO_MARKER } from "./system_prompt.js";

/** Streams the given NDJSON lines from a one-shot server, returns text result. */
async function streamLines(
  model: string,
  lines: string[],
): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    for (const line of lines) res.write(`${line}\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`, model);
    const resp = await provider.sendMessage({ model, prompt: "hi" });
    return resp.text;
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

/** Spins up a one-shot Ollama-like server that captures the request body. */
async function captureBody(
  run: (port: number) => Promise<void>,
): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> = {};
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    captured = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write(`{"model":"test","done":true}\n`);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    await run(port);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  return captured;
}

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

test("OllamaProvider sends a bounded options.num_predict by default", async () => {
  const body = await captureBody(async (port) => {
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`, "qwen3:8b");
    await provider.sendMessage({ model: "qwen3:8b", prompt: "hi" });
  });
  const options = body.options as { num_predict?: unknown } | undefined;
  assert.ok(options, "request body must carry an options object");
  // Generous model-aware default mirroring the Rust reference (64_000 non-opus).
  assert.equal(options?.num_predict, DEFAULT_OLLAMA_NUM_PREDICT);
});

test("OllamaProvider honors an explicit constructor num_predict override", async () => {
  const body = await captureBody(async (port) => {
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`, "qwen3:8b", 256);
    await provider.sendMessage({ model: "qwen3:8b", prompt: "hi" });
  });
  const options = body.options as { num_predict?: unknown };
  assert.equal(options.num_predict, 256);
});

test("OllamaProvider reads num_predict from OLLAMA_NUM_PREDICT env var", async () => {
  const prev = process.env.OLLAMA_NUM_PREDICT;
  process.env.OLLAMA_NUM_PREDICT = "1234";
  try {
    const body = await captureBody(async (port) => {
      const provider = new OllamaProvider(`http://127.0.0.1:${port}`, "qwen3:8b");
      await provider.sendMessage({ model: "qwen3:8b", prompt: "hi" });
    });
    const options = body.options as { num_predict?: unknown };
    assert.equal(options.num_predict, 1234);
  } finally {
    if (prev === undefined) delete process.env.OLLAMA_NUM_PREDICT;
    else process.env.OLLAMA_NUM_PREDICT = prev;
  }
});

test("OllamaProvider prepends a canonical system message before the user message", async () => {
  const body = await captureBody(async (port) => {
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`, "qwen3:8b");
    await provider.sendMessage({ model: "qwen3:8b", prompt: "hi" });
  });
  const messages = body.messages as Array<{ role?: string; content?: string }>;
  assert.ok(Array.isArray(messages), "request body must carry a messages array");
  // A system message must lead, ahead of the user message (parity framing).
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[1]?.role, "user");
  assert.equal(messages[1]?.content, "hi");
  // Its content must contain the stable canonical intro marker line.
  assert.ok(
    typeof messages[0]?.content === "string" &&
      messages[0].content.includes(SYSTEM_PROMPT_INTRO_MARKER),
    "system message must contain the canonical intro marker",
  );
});

test("maxTokensForModel mirrors the Rust reference's opus/default split", () => {
  assert.equal(maxTokensForModel("qwen3:32b"), DEFAULT_OLLAMA_NUM_PREDICT);
  assert.equal(maxTokensForModel("claude-opus-4-6"), OPUS_OLLAMA_NUM_PREDICT);
});

test("parseNumPredict accepts positive integers and rejects junk", () => {
  assert.equal(parseNumPredict("2048"), 2048);
  assert.equal(parseNumPredict(undefined), undefined);
  assert.equal(parseNumPredict(""), undefined);
  assert.equal(parseNumPredict("  "), undefined);
  assert.equal(parseNumPredict("0"), undefined);
  assert.equal(parseNumPredict("-1"), undefined);
  assert.equal(parseNumPredict("abc"), undefined);
  assert.equal(parseNumPredict("12.5"), undefined);
});

test("isThinkingModel detects the Rust THINKING_FAMILIES", () => {
  assert.equal(isThinkingModel("qwen3:8b"), true);
  assert.equal(isThinkingModel("deepseek-r1:7b"), true);
  assert.equal(isThinkingModel("QWEN3:32B"), true);
  assert.equal(isThinkingModel("llama3:8b"), false);
  assert.equal(isThinkingModel("starcoder2"), false);
});

test("shouldShowThinking reads EMBER_SHOW_THINKING with sane truthiness", () => {
  assert.equal(shouldShowThinking({}), false);
  assert.equal(shouldShowThinking({ EMBER_SHOW_THINKING: "" }), false);
  assert.equal(shouldShowThinking({ EMBER_SHOW_THINKING: "0" }), false);
  assert.equal(shouldShowThinking({ EMBER_SHOW_THINKING: "false" }), false);
  assert.equal(shouldShowThinking({ EMBER_SHOW_THINKING: "off" }), false);
  assert.equal(shouldShowThinking({ EMBER_SHOW_THINKING: "1" }), true);
  assert.equal(shouldShowThinking({ EMBER_SHOW_THINKING: "true" }), true);
});

test("ThinkStreamSeparator strips a leading think block split across deltas", () => {
  const sep = new ThinkStreamSeparator();
  let answer = "";
  // The <think> block and its close are split across chunk boundaries.
  answer += sep.pushContent("<thi");
  answer += sep.pushContent("nk>reason");
  answer += sep.pushContent("ing here</thi");
  answer += sep.pushContent("nk>\nThe answer");
  answer += sep.pushContent(" is 42.");
  answer += sep.finish();
  assert.equal(answer, "The answer is 42.");
  assert.equal(sep.thinkingText, "reasoning here");
});

test("ThinkStreamSeparator leaves content without a leading think block untouched", () => {
  const sep = new ThinkStreamSeparator();
  let answer = "";
  answer += sep.pushContent("Hello, ");
  answer += sep.pushContent("a <think> later is fine.");
  answer += sep.finish();
  assert.equal(answer, "Hello, a <think> later is fine.");
  assert.equal(sep.thinkingText, "");
});

test("OllamaProvider strips an inline leading <think> block from the answer", async () => {
  const text = await streamLines("llama3:8b", [
    `{"model":"llama3:8b","message":{"role":"assistant","content":"<think>I should greet."},"done":false}`,
    `{"model":"llama3:8b","message":{"role":"assistant","content":"</think>Hello!"},"done":false}`,
    `{"model":"llama3:8b","done":true}`,
  ]);
  // stdout/answer must NOT contain the reasoning or any <think> tags.
  assert.equal(text, "Hello!");
  assert.ok(!text.includes("<think>"));
  assert.ok(!text.includes("I should greet"));
});

test("OllamaProvider separates the structured message.thinking channel", async () => {
  const text = await streamLines("qwen3:8b", [
    `{"model":"qwen3:8b","message":{"role":"assistant","thinking":"deliberating"},"done":false}`,
    `{"model":"qwen3:8b","message":{"role":"assistant","content":"Final answer."},"done":false}`,
    `{"model":"qwen3:8b","done":true}`,
  ]);
  assert.equal(text, "Final answer.");
  assert.ok(!text.includes("deliberating"));
});

test("OllamaProvider requests structured think mode for thinking-family models", async () => {
  const body = await captureBody(async (port) => {
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`, "qwen3:8b");
    await provider.sendMessage({ model: "qwen3:8b", prompt: "hi" });
  });
  assert.equal(body.think, true);
});

test("OllamaProvider does not request think mode for non-thinking models", async () => {
  const body = await captureBody(async (port) => {
    const provider = new OllamaProvider(`http://127.0.0.1:${port}`, "llama3:8b");
    await provider.sendMessage({ model: "llama3:8b", prompt: "hi" });
  });
  assert.equal(body.think, undefined);
});

test("EMBER_SHOW_THINKING off hides reasoning; on reveals it on stderr", async () => {
  const lines = [
    `{"model":"llama3:8b","message":{"role":"assistant","content":"<think>secret reasoning</think>Done."},"done":false}`,
    `{"model":"llama3:8b","done":true}`,
  ];
  const prev = process.env.EMBER_SHOW_THINKING;
  const originalWrite = process.stderr.write.bind(process.stderr);
  let captured = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: unknown): boolean => {
    captured += String(chunk);
    return true;
  };
  try {
    // Default OFF: nothing about reasoning on stderr; answer is clean.
    delete process.env.EMBER_SHOW_THINKING;
    const off = await streamLines("llama3:8b", lines);
    assert.equal(off, "Done.");
    assert.ok(!captured.includes("secret reasoning"));

    // Toggled ON: reasoning surfaces on stderr, answer still clean on return.
    captured = "";
    process.env.EMBER_SHOW_THINKING = "1";
    const on = await streamLines("llama3:8b", lines);
    assert.equal(on, "Done.");
    assert.ok(captured.includes("secret reasoning"));
  } finally {
    (process.stderr as { write: typeof originalWrite }).write = originalWrite;
    if (prev === undefined) delete process.env.EMBER_SHOW_THINKING;
    else process.env.EMBER_SHOW_THINKING = prev;
  }
});

test("listOllamaModels parses an Ollama /api/tags fixture (sorted + deduped)", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.url, "/api/tags");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        models: [
          { name: "qwen3:8b" },
          { name: "llama3:8b" },
          { name: "qwen3:8b" },
          { name: "qwen2.5:1.5b" },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    const models = await listOllamaModels(`http://127.0.0.1:${port}`);
    assert.deepEqual(models, ["llama3:8b", "qwen2.5:1.5b", "qwen3:8b"]);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("listOllamaModels throws on a non-200 /api/tags response", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(503);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    await assert.rejects(() => listOllamaModels(`http://127.0.0.1:${port}`), /HTTP 503/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
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
