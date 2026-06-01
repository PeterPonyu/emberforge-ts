import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DEFAULT_TOOLS, ToolRegistry, getTools } from "./registry.js";
import { PermissionMode } from "./spec.js";

const EXPECTED_TOOLS = [
  "bash",
  "read_file",
  "write_file",
  "edit_file",
  "glob_search",
  "grep_search",
  "web",
  "notebook",
  "agent",
  "skill",
];

test("DEFAULT_TOOLS contains the full registry surface", () => {
  const names = DEFAULT_TOOLS.map((tool) => tool.name);
  for (const expected of EXPECTED_TOOLS) {
    assert.ok(names.includes(expected), `missing tool: ${expected}`);
  }
});

test("every tool spec carries an input schema and required permission", () => {
  for (const tool of DEFAULT_TOOLS) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(typeof tool.inputSchema.properties, "object");
    assert.ok(
      tool.requiredPermission === PermissionMode.ReadOnly ||
        tool.requiredPermission === PermissionMode.WorkspaceWrite ||
        tool.requiredPermission === PermissionMode.DangerFullAccess,
    );
  }
});

test("permission tiers mirror the Rust canonical specs", () => {
  const byName = new Map(DEFAULT_TOOLS.map((t) => [t.name, t]));
  assert.equal(byName.get("bash")?.requiredPermission, PermissionMode.DangerFullAccess);
  assert.equal(byName.get("read_file")?.requiredPermission, PermissionMode.ReadOnly);
  assert.equal(byName.get("write_file")?.requiredPermission, PermissionMode.WorkspaceWrite);
  assert.equal(byName.get("edit_file")?.requiredPermission, PermissionMode.WorkspaceWrite);
  assert.equal(byName.get("glob_search")?.requiredPermission, PermissionMode.ReadOnly);
  assert.equal(byName.get("grep_search")?.requiredPermission, PermissionMode.ReadOnly);
  assert.equal(byName.get("agent")?.requiredPermission, PermissionMode.DangerFullAccess);
});

test("ToolRegistry has/get/list operate over the spec set", () => {
  const registry = new ToolRegistry();
  assert.ok(registry.has("bash"));
  assert.ok(!registry.has("nonexistent"));
  assert.equal(registry.get("read_file")?.name, "read_file");
  assert.equal(registry.get("nonexistent"), undefined);
  assert.equal(registry.list().length, DEFAULT_TOOLS.length);
  assert.equal(getTools().length, DEFAULT_TOOLS.length);
});

test("required schema fields are declared for edit_file", () => {
  const editFile = DEFAULT_TOOLS.find((t) => t.name === "edit_file");
  assert.deepEqual(editFile?.inputSchema.required, ["path", "old_string", "new_string"]);
});
