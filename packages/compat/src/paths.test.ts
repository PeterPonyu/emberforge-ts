import assert from "node:assert/strict";
import test from "node:test";

import { defaultUpstreamPaths } from "./paths.js";

const MACHINE_LOCAL_PATH = /(?:\/home\/[^/]+\/Desktop|file:\/\/\/home\/[^/]+|[A-Za-z]:[\\/]+Users[\\/]+)/;
const UPSTREAM_TOOL_NAME = /claude-code-src|crates\//;

test("default upstream references are portable and brand-neutral", () => {
  const paths = defaultUpstreamPaths();
  const values = [
    paths.commandsReference,
    paths.toolsReference,
    paths.runtimeReference,
  ];

  for (const value of values) {
    assert.doesNotMatch(value, MACHINE_LOCAL_PATH);
    assert.doesNotMatch(value, UPSTREAM_TOOL_NAME);
  }
});

test("default upstream references can be overridden by environment", () => {
  const previous = {
    commands: process.env.EMBERFORGE_COMMANDS_REFERENCE,
    tools: process.env.EMBERFORGE_TOOLS_REFERENCE,
    runtime: process.env.EMBERFORGE_RUNTIME_REFERENCE,
  };
  try {
    process.env.EMBERFORGE_COMMANDS_REFERENCE = "vendor/reference/commands";
    process.env.EMBERFORGE_TOOLS_REFERENCE = "vendor/reference/tools";
    process.env.EMBERFORGE_RUNTIME_REFERENCE = "vendor/reference/runtime";

    assert.deepEqual(defaultUpstreamPaths(), {
      commandsReference: "vendor/reference/commands",
      toolsReference: "vendor/reference/tools",
      runtimeReference: "vendor/reference/runtime",
    });
  } finally {
    if (previous.commands === undefined) delete process.env.EMBERFORGE_COMMANDS_REFERENCE;
    else process.env.EMBERFORGE_COMMANDS_REFERENCE = previous.commands;
    if (previous.tools === undefined) delete process.env.EMBERFORGE_TOOLS_REFERENCE;
    else process.env.EMBERFORGE_TOOLS_REFERENCE = previous.tools;
    if (previous.runtime === undefined) delete process.env.EMBERFORGE_RUNTIME_REFERENCE;
    else process.env.EMBERFORGE_RUNTIME_REFERENCE = previous.runtime;
  }
});
