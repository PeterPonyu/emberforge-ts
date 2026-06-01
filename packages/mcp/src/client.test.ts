import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpClient } from "./client.js";
import { mcpToolName, normalizeNameForMcp } from "./names.js";
import { encodeFrame } from "./stdio.js";
import { ToolRegistry } from "../../tools/src/index.js";

/**
 * A minimal offline MCP server fixture written in Node. It speaks the same
 * Content-Length JSON-RPC framing the client uses, answering `initialize`,
 * `tools/list`, and `tools/call`. No network access is involved.
 */
const FIXTURE_SERVER = `
let buffer = Buffer.alloc(0);
function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf-8");
  process.stdout.write(Buffer.from("Content-Length: " + body.length + "\\r\\n\\r\\n", "utf-8"));
  process.stdout.write(body);
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString("utf-8");
    const m = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!m) return;
    const len = Number(m[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + len) return;
    const payload = buffer.subarray(start, start + len).toString("utf-8");
    buffer = buffer.subarray(start + len);
    const req = JSON.parse(payload);
    if (req.method === "initialize") {
      send({ jsonrpc: "2.0", id: req.id, result: {
        protocolVersion: req.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fixture-mcp", version: "0.1.0" },
      }});
    } else if (req.method === "tools/list") {
      send({ jsonrpc: "2.0", id: req.id, result: {
        tools: [{ name: "echo", description: "Echoes text", inputSchema: { type: "object" } }],
      }});
    } else if (req.method === "tools/call") {
      const args = (req.params && req.params.arguments) || {};
      send({ jsonrpc: "2.0", id: req.id, result: {
        content: [{ type: "text", text: "echo:" + (args.text || "") }],
        isError: false,
      }});
    } else {
      send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "unknown: " + req.method } });
    }
  }
});
`;

async function writeFixture(): Promise<{ dir: string; script: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-mcp-test-"));
  const script = path.join(dir, "fixture-server.mjs");
  await fs.writeFile(script, FIXTURE_SERVER, "utf-8");
  return { dir, script };
}

test("encodeFrame produces Content-Length framing", () => {
  const framed = encodeFrame('{"a":1}').toString("utf-8");
  assert.ok(framed.startsWith("Content-Length: 7\r\n\r\n"));
  assert.ok(framed.endsWith('{"a":1}'));
});

test("normalizeNameForMcp and mcpToolName mirror Rust normalization", () => {
  assert.equal(normalizeNameForMcp("github.com"), "github_com");
  assert.equal(normalizeNameForMcp("tool name!"), "tool_name_");
  assert.equal(
    mcpToolName("claude.ai Example Server", "weather tool"),
    "mcp__claude_ai_Example_Server__weather_tool",
  );
});

test("McpClient spawns, initializes, lists, and calls tools over stdio", async () => {
  const { dir, script } = await writeFixture();
  const client = new McpClient([
    {
      name: "fixture",
      transport: { command: process.execPath, args: [script], env: {} },
    },
  ]);
  try {
    const tools = await client.discoverAll();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].rawName, "echo");
    assert.equal(tools[0].qualifiedName, "mcp__fixture__echo");

    // Tools register into the runtime registry under their qualified names.
    const registry = client.registerInto(new ToolRegistry());
    assert.ok(registry.has("mcp__fixture__echo"));
    assert.ok(registry.has("bash"), "existing tools must be preserved");

    const result = (await client.callTool("mcp__fixture__echo", { text: "hi" })) as {
      content: Array<{ type: string; text: string }>;
    };
    assert.equal(result.content[0].text, "echo:hi");

    await assert.rejects(
      () => client.callTool("mcp__fixture__missing"),
      /unknown MCP tool/,
    );
  } finally {
    await client.shutdown();
    await fs.rm(dir, { recursive: true });
  }
});

test("McpClient.toolSpecs is structural without spawning", () => {
  // A client with no configured servers yields no tools and no processes.
  const client = new McpClient();
  assert.deepEqual(client.serverNames(), []);
  assert.deepEqual(client.toolSpecs(), []);
});
