import assert from "node:assert/strict";
import test from "node:test";

import { CLAUDE_COMMANDS_REFERENCE } from "../../commands/src/index.js";
import { RUST_PLUGINS_REFERENCE } from "../../plugins/src/index.js";
import { RUST_TELEMETRY_REFERENCE } from "../../telemetry/src/index.js";
import { defaultUpstreamPaths } from "./paths.js";

const MACHINE_LOCAL_PATH = /(?:\/home\/[^/]+\/Desktop|file:\/\/\/home\/[^/]+|[A-Za-z]:[\\/]+Users[\\/]+)/;

test("default upstream references are portable", () => {
  const paths = defaultUpstreamPaths();
  const values = [
    paths.claudeCommandsTs,
    paths.claudeToolsTs,
    paths.emberRuntimeLibRs,
    CLAUDE_COMMANDS_REFERENCE,
    RUST_PLUGINS_REFERENCE,
    RUST_TELEMETRY_REFERENCE,
  ];

  for (const value of values) {
    assert.doesNotMatch(value, MACHINE_LOCAL_PATH);
  }
});

test("default upstream references can be overridden by environment", () => {
  const previous = {
    commands: process.env.EMBERFORGE_CLAUDE_COMMANDS_TS,
    tools: process.env.EMBERFORGE_CLAUDE_TOOLS_TS,
    runtime: process.env.EMBERFORGE_RUNTIME_LIB_RS,
  };
  try {
    process.env.EMBERFORGE_CLAUDE_COMMANDS_TS = "vendor/claude/commands.ts";
    process.env.EMBERFORGE_CLAUDE_TOOLS_TS = "vendor/claude/tools.ts";
    process.env.EMBERFORGE_RUNTIME_LIB_RS = "vendor/emberforge/runtime/lib.rs";

    assert.deepEqual(defaultUpstreamPaths(), {
      claudeCommandsTs: "vendor/claude/commands.ts",
      claudeToolsTs: "vendor/claude/tools.ts",
      emberRuntimeLibRs: "vendor/emberforge/runtime/lib.rs",
    });
  } finally {
    if (previous.commands === undefined) delete process.env.EMBERFORGE_CLAUDE_COMMANDS_TS;
    else process.env.EMBERFORGE_CLAUDE_COMMANDS_TS = previous.commands;
    if (previous.tools === undefined) delete process.env.EMBERFORGE_CLAUDE_TOOLS_TS;
    else process.env.EMBERFORGE_CLAUDE_TOOLS_TS = previous.tools;
    if (previous.runtime === undefined) delete process.env.EMBERFORGE_RUNTIME_LIB_RS;
    else process.env.EMBERFORGE_RUNTIME_LIB_RS = previous.runtime;
  }
});
