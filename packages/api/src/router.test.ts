import { test } from "node:test";
import { strict as assert } from "node:assert";
import { detectProviderKind, resolveProvider } from "./router.js";
import { AnthropicProvider } from "./anthropic_provider.js";
import { XaiProvider } from "./xai_provider.js";
import { OllamaProvider } from "./ollama_provider.js";
import {
  resolveAnthropicAuth,
  resolveXaiApiKey,
  applyAnthropicAuth,
  readEnvNonEmpty,
} from "./auth.js";
import type { FetchLike, FetchResponse } from "./transport.js";

function jsonResponse(body: unknown): FetchResponse {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

// ── Auth resolution (EFPORT-2) ───────────────────────────────────────────

test("readEnvNonEmpty treats empty strings as absent", () => {
  assert.equal(readEnvNonEmpty({ A: "" }, "A"), undefined);
  assert.equal(readEnvNonEmpty({ A: "v" }, "A"), "v");
  assert.equal(readEnvNonEmpty({}, "A"), undefined);
});

test("resolveAnthropicAuth returns null when no credentials present", () => {
  assert.equal(resolveAnthropicAuth({}, {}), null);
});

test("resolveAnthropicAuth reads api key and auth token from env", () => {
  const auth = resolveAnthropicAuth(
    { ANTHROPIC_API_KEY: "key", ANTHROPIC_AUTH_TOKEN: "tok" },
    {},
  );
  assert.deepEqual(auth, { apiKey: "key", authToken: "tok" });
});

test("resolveAnthropicAuth lets settings override env", () => {
  const auth = resolveAnthropicAuth(
    { ANTHROPIC_API_KEY: "env-key" },
    { apiKey: "settings-key" },
  );
  assert.deepEqual(auth, { apiKey: "settings-key", authToken: undefined });
});

test("applyAnthropicAuth sets x-api-key and bearer headers", () => {
  const headers = applyAnthropicAuth({}, { apiKey: "key", authToken: "tok" });
  assert.equal(headers["x-api-key"], "key");
  assert.equal(headers["authorization"], "Bearer tok");
});

test("resolveXaiApiKey reads env and respects settings precedence", () => {
  assert.equal(resolveXaiApiKey({ XAI_API_KEY: "k" }, {}), "k");
  assert.equal(resolveXaiApiKey({ XAI_API_KEY: "env" }, { apiKey: "set" }), "set");
  assert.equal(resolveXaiApiKey({}, {}), null);
});

// ── Routing / detection precedence (EFPORT-2) ────────────────────────────

test("detectProviderKind prefers anthropic, then xai, then ollama", () => {
  assert.equal(
    detectProviderKind({ ANTHROPIC_API_KEY: "a", XAI_API_KEY: "x" }, {}),
    "anthropic",
  );
  assert.equal(detectProviderKind({ XAI_API_KEY: "x" }, {}), "xai");
  assert.equal(detectProviderKind({}, {}), "ollama");
});

test("resolveProvider returns Ollama when no hosted creds", () => {
  const provider = resolveProvider({ env: {} });
  assert.ok(provider instanceof OllamaProvider);
});

test("resolveProvider returns AnthropicProvider when anthropic key present", () => {
  const provider = resolveProvider({ env: { ANTHROPIC_API_KEY: "key" } });
  assert.ok(provider instanceof AnthropicProvider);
});

test("resolveProvider returns XaiProvider when only xai key present", () => {
  const provider = resolveProvider({ env: { XAI_API_KEY: "key" } });
  assert.ok(provider instanceof XaiProvider);
});

// ── Request construction via injected transport (offline) ────────────────

test("AnthropicProvider builds Messages API request and parses content", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody = "";
  const fetchImpl: FetchLike = async (url, init) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    capturedBody = init.body;
    return jsonResponse({ content: [{ type: "text", text: "Hello" }] });
  };
  const provider = AnthropicProvider.fromEnv(
    { ANTHROPIC_API_KEY: "secret-key" },
    {},
    fetchImpl,
  );
  assert.ok(provider);
  const resp = await provider.sendMessage({ model: "claude-x", prompt: "hi" });

  assert.equal(resp.text, "Hello");
  assert.match(capturedUrl, /\/v1\/messages$/);
  assert.equal(capturedHeaders["x-api-key"], "secret-key");
  assert.equal(capturedHeaders["anthropic-version"], "2023-06-01");
  const parsedBody = JSON.parse(capturedBody);
  assert.equal(parsedBody.model, "claude-x");
  assert.equal(parsedBody.messages[0].content, "hi");
});

test("AnthropicProvider throws on non-ok response", async () => {
  const fetchImpl: FetchLike = async () => ({
    ok: false,
    status: 401,
    text: async () => "",
    json: async () => ({}),
  });
  const provider = new AnthropicProvider({ apiKey: "k", fetchImpl });
  await assert.rejects(
    () => provider.sendMessage({ model: "m", prompt: "p" }),
    /Anthropic HTTP 401/,
  );
});

test("XaiProvider builds chat/completions request with bearer auth", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  const fetchImpl: FetchLike = async (url, init) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    return jsonResponse({ choices: [{ message: { content: "Yo" } }] });
  };
  const provider = XaiProvider.fromEnv({ XAI_API_KEY: "xai-key" }, {}, fetchImpl);
  assert.ok(provider);
  const resp = await provider.sendMessage({ model: "grok", prompt: "hi" });

  assert.equal(resp.text, "Yo");
  assert.match(capturedUrl, /\/chat\/completions$/);
  assert.equal(capturedHeaders["authorization"], "Bearer xai-key");
});

test("XaiProvider falls back to reasoning when content is empty", async () => {
  const fetchImpl: FetchLike = async () =>
    jsonResponse({ choices: [{ message: { reasoning: "thought" } }] });
  const provider = new XaiProvider({ apiKey: "k", fetchImpl });
  const resp = await provider.sendMessage({ model: "m", prompt: "p" });
  assert.equal(resp.text, "thought");
});

test("resolveProvider wires injected transport end-to-end (offline)", async () => {
  const fetchImpl: FetchLike = async () =>
    jsonResponse({ content: [{ type: "text", text: "routed" }] });
  const provider = resolveProvider({
    env: { ANTHROPIC_API_KEY: "key" },
    fetchImpl,
  });
  const resp = await provider.sendMessage({ model: "m", prompt: "p" });
  assert.equal(resp.text, "routed");
});
