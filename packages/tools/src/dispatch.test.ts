import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  ToolDispatcher,
  PermissionDeniedError,
  UnsupportedToolError,
} from "./dispatch.js";
import { ToolRegistry } from "./registry.js";
import { PermissionMode } from "./spec.js";
import type { ToolExecutor } from "./executor.js";

class RecordingExecutor implements ToolExecutor {
  calls: Array<{ toolName: string; input: string }> = [];
  execute(toolName: string, input: string): string {
    this.calls.push({ toolName, input });
    return `ok:${toolName}`;
  }
}

test("dispatch allows a tool when active mode meets requirement", async () => {
  const exec = new RecordingExecutor();
  const dispatcher = new ToolDispatcher(exec, new ToolRegistry(), PermissionMode.DangerFullAccess);
  const result = await dispatcher.dispatch("bash", "echo hi");
  assert.equal(result, "ok:bash");
  assert.equal(exec.calls.length, 1);
});

test("dispatch denies escalation when active mode is too low", async () => {
  const exec = new RecordingExecutor();
  // read-only mode cannot run bash (danger-full-access)
  const dispatcher = new ToolDispatcher(exec, new ToolRegistry(), PermissionMode.ReadOnly);
  await assert.rejects(
    () => dispatcher.dispatch("bash", "echo hi"),
    (err: unknown) => {
      assert.ok(err instanceof PermissionDeniedError);
      assert.equal(err.toolName, "bash");
      assert.match(err.message, /requires danger-full-access/);
      return true;
    },
  );
  assert.equal(exec.calls.length, 0);
});

test("read-only mode permits read_file but blocks write_file", async () => {
  const exec = new RecordingExecutor();
  const dispatcher = new ToolDispatcher(exec, new ToolRegistry(), PermissionMode.ReadOnly);
  assert.ok(dispatcher.isAllowed("read_file"));
  assert.ok(!dispatcher.isAllowed("write_file"));
  await assert.rejects(
    () => dispatcher.dispatch("write_file", "{}"),
    PermissionDeniedError,
  );
});

test("workspace-write mode permits write_file and edit_file", () => {
  const exec = new RecordingExecutor();
  const dispatcher = new ToolDispatcher(exec, new ToolRegistry(), PermissionMode.WorkspaceWrite);
  assert.ok(dispatcher.isAllowed("write_file"));
  assert.ok(dispatcher.isAllowed("edit_file"));
  assert.ok(!dispatcher.isAllowed("bash"));
});

test("dispatch rejects unknown tools", async () => {
  const exec = new RecordingExecutor();
  const dispatcher = new ToolDispatcher(exec, new ToolRegistry());
  await assert.rejects(
    () => dispatcher.dispatch("nope", "{}"),
    UnsupportedToolError,
  );
});

test("dispatch rejects permission-passing structural-only tools (no local executor)", async () => {
  const exec = new RecordingExecutor();
  // 'skill' is ReadOnly so it passes the permission gate, but has no executor.
  const dispatcher = new ToolDispatcher(exec, new ToolRegistry(), PermissionMode.DangerFullAccess);
  assert.ok(dispatcher.isAllowed("skill"));
  await assert.rejects(
    () => dispatcher.dispatch("skill", "{}"),
    UnsupportedToolError,
  );
  assert.equal(exec.calls.length, 0);
});
