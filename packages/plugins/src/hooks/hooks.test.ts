import { test } from "node:test";
import { strict as assert } from "node:assert";

import { HOOK_EVENTS, isHookEvent, isToolEvent } from "./events.js";
import { globMatches, ruleMatches } from "./match_rule.js";
import { statusToDecision, runHttpHook } from "./http_executor.js";
import { runCommandHook } from "./command_executor.js";
import { HookDispatcher } from "./dispatcher.js";
import { buildHookPayload, type HookContext } from "./types.js";

const isWindows = process.platform === "win32";
const toolCtx = (overrides: Partial<HookContext> = {}): HookContext => ({
  event: "PreToolUse",
  toolName: "Bash",
  toolInput: '{"command":"pwd"}',
  isError: false,
  ...overrides,
});

// ── Event model ──────────────────────────────────────────────────────────

test("defines the 17 hook event variants", () => {
  assert.equal(HOOK_EVENTS.length, 17);
  assert.equal(new Set(HOOK_EVENTS).size, 17);
  for (const name of [
    "PreToolUse",
    "PostToolUse",
    "SessionStart",
    "SessionEnd",
    "ToolError",
    "PermissionDenied",
    "PluginLoad",
    "PluginUnload",
  ]) {
    assert.ok(HOOK_EVENTS.includes(name as (typeof HOOK_EVENTS)[number]), `${name} present`);
  }
});

test("isHookEvent / isToolEvent classify correctly", () => {
  assert.ok(isHookEvent("PreToolUse"));
  assert.ok(!isHookEvent("NotARealEvent"));
  assert.ok(isToolEvent("PreToolUse"));
  assert.ok(isToolEvent("PostToolUse"));
  assert.ok(!isToolEvent("SessionStart"));
});

// ── Match rules / glob ─────────────────────────────────────────────────────

test("empty rule matches everything", () => {
  assert.ok(ruleMatches({}, "bash", '{"command":"ls"}'));
  assert.ok(ruleMatches({}, "read_file", '{"path":"foo.ts"}'));
});

test("tool_names filter restricts matching", () => {
  const rule = { toolNames: ["bash", "REPL"] };
  assert.ok(ruleMatches(rule, "bash", "{}"));
  assert.ok(ruleMatches(rule, "REPL", "{}"));
  assert.ok(!ruleMatches(rule, "read_file", "{}"));
});

test("command patterns with trailing wildcard", () => {
  const rule = { toolNames: ["bash"], commands: ["rm *", "git push*"] };
  assert.ok(ruleMatches(rule, "bash", '{"command":"rm -rf /tmp"}'));
  assert.ok(ruleMatches(rule, "bash", '{"command":"git push --force"}'));
  assert.ok(!ruleMatches(rule, "bash", '{"command":"ls -la"}'));
});

test("globMatches is case-insensitive and supports prefix wildcard", () => {
  assert.ok(globMatches("RM*", "rm -rf"));
  assert.ok(globMatches("push", "git PUSH origin"));
  assert.ok(!globMatches("delete", "git push"));
});

// ── Payload ────────────────────────────────────────────────────────────────

test("buildHookPayload parses JSON input and carries metadata", () => {
  const payload = JSON.parse(buildHookPayload(toolCtx({ toolOutput: "ok" })));
  assert.equal(payload.hook_event_name, "PreToolUse");
  assert.equal(payload.tool_name, "Bash");
  assert.deepEqual(payload.tool_input, { command: "pwd" });
  assert.equal(payload.tool_output, "ok");
  assert.equal(payload.tool_result_is_error, false);
});

test("buildHookPayload wraps non-JSON input as { raw }", () => {
  const payload = JSON.parse(buildHookPayload(toolCtx({ toolInput: "not json" })));
  assert.deepEqual(payload.tool_input, { raw: "not json" });
});

// ── HTTP status mapping ──────────────────────────────────────────────────

test("statusToDecision maps 200/403/other to allow/deny/warn", () => {
  assert.equal(statusToDecision(200), "allow");
  assert.equal(statusToDecision(403), "deny");
  assert.equal(statusToDecision(500), "warn");
  assert.equal(statusToDecision(201), "warn");
});

// ── Command executor exit-code semantics ───────────────────────────────────

test("command hook exit 0 allows and captures stdout", { skip: isWindows }, async () => {
  const outcome = await runCommandHook("printf 'pre ok'", toolCtx());
  assert.equal(outcome.decision, "allow");
  assert.equal(outcome.message, "pre ok");
});

test("command hook exit 2 denies with message", { skip: isWindows }, async () => {
  const outcome = await runCommandHook("printf 'blocked'; exit 2", toolCtx());
  assert.equal(outcome.decision, "deny");
  assert.equal(outcome.message, "blocked");
});

test("command hook other non-zero exit warns", { skip: isWindows }, async () => {
  const outcome = await runCommandHook("printf 'oops'; exit 1", toolCtx());
  assert.equal(outcome.decision, "warn");
  assert.match(outcome.message ?? "", /allowing tool execution to continue/);
});

// ── Dispatcher loop ──────────────────────────────────────────────────────

test("dispatcher allows when no hooks registered", async () => {
  const dispatcher = new HookDispatcher();
  const result = await dispatcher.runPreToolUse("Bash", "{}");
  assert.equal(result.denied, false);
  assert.deepEqual(result.messages, []);
});

test("dispatcher short-circuits on first deny", { skip: isWindows }, async () => {
  const dispatcher = new HookDispatcher([
    { event: "PreToolUse", backend: { type: "command", run: "printf 'first ok'" } },
    { event: "PreToolUse", backend: { type: "command", run: "printf 'denied'; exit 2" } },
    { event: "PreToolUse", backend: { type: "command", run: "printf 'never runs'" } },
  ]);
  const result = await dispatcher.runPreToolUse("Bash", '{"command":"pwd"}');
  assert.equal(result.denied, true);
  assert.deepEqual(result.messages, ["first ok", "denied"]);
});

test("dispatcher honors match rules", { skip: isWindows }, async () => {
  const dispatcher = new HookDispatcher([
    {
      event: "PreToolUse",
      backend: { type: "command", run: "printf 'denied'; exit 2" },
      match: { toolNames: ["bash"], commands: ["rm *"] },
    },
  ]);
  const denied = await dispatcher.runPreToolUse("bash", '{"command":"rm -rf x"}');
  assert.equal(denied.denied, true);
  const allowed = await dispatcher.runPreToolUse("bash", '{"command":"ls"}');
  assert.equal(allowed.denied, false);
});

test("dispatcher fireEvent is non-throwing for lifecycle events", async () => {
  const dispatcher = new HookDispatcher();
  await dispatcher.fireEvent("SessionStart");
  await dispatcher.fireEvent("PluginLoad", "example.bundled", "1.0.0");
});

// ── HTTP executor against a local server ───────────────────────────────────

import http from "node:http";

function listen(handler: http.RequestListener): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

test("http hook maps 200 to allow and forwards payload", async () => {
  let received = "";
  const server = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received = Buffer.concat(chunks).toString();
      res.statusCode = 200;
      res.end();
    });
  });
  try {
    const outcome = await runHttpHook({ url: server.url }, toolCtx());
    assert.equal(outcome.decision, "allow");
    assert.equal(JSON.parse(received).tool_name, "Bash");
  } finally {
    server.close();
  }
});

test("http hook maps 403 to deny and surfaces JSON message", async () => {
  const server = await listen((_req, res) => {
    res.statusCode = 403;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ message: "blocked by policy" }));
  });
  try {
    const outcome = await runHttpHook({ url: server.url }, toolCtx());
    assert.equal(outcome.decision, "deny");
    assert.equal(outcome.message, "blocked by policy");
  } finally {
    server.close();
  }
});

test("http hook JSON decision overrides status mapping", async () => {
  const server = await listen((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ decision: "deny", message: "explicit deny" }));
  });
  try {
    const outcome = await runHttpHook({ url: server.url }, toolCtx());
    assert.equal(outcome.decision, "deny");
    assert.equal(outcome.message, "explicit deny");
  } finally {
    server.close();
  }
});

test("http hook warns on 500", async () => {
  const server = await listen((_req, res) => {
    res.statusCode = 500;
    res.end();
  });
  try {
    const outcome = await runHttpHook({ url: server.url }, toolCtx());
    assert.equal(outcome.decision, "warn");
    assert.match(outcome.message ?? "", /HTTP 500/);
  } finally {
    server.close();
  }
});

test("http hook warns on transport failure", async () => {
  // Nothing is listening on this port -> connection refused -> warn.
  const outcome = await runHttpHook({ url: "http://127.0.0.1:1", timeoutMs: 2000 }, toolCtx());
  assert.equal(outcome.decision, "warn");
});
