import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildSystemPrompt,
  renderEnvironmentSection,
  FRONTIER_MODEL_NAME,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  SYSTEM_PROMPT_INTRO_MARKER,
  INTRO_SECTION,
  SYSTEM_SECTION,
  DOING_TASKS_SECTION,
  TOOL_USAGE_SECTION,
  ACTIONS_SECTION,
} from "./system_prompt.js";

test("buildSystemPrompt assembles the five static sections in Rust order", () => {
  const prompt = buildSystemPrompt({
    cwd: "/work",
    date: "2026-06-04",
    osName: "linux",
    osVersion: "6.8",
  });
  const indices = [
    prompt.indexOf(INTRO_SECTION),
    prompt.indexOf(SYSTEM_SECTION),
    prompt.indexOf(DOING_TASKS_SECTION),
    prompt.indexOf(TOOL_USAGE_SECTION),
    prompt.indexOf(ACTIONS_SECTION),
    prompt.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY),
  ];
  for (const index of indices) {
    assert.notEqual(index, -1, "every section must be present");
  }
  // Sections must appear in the same order as Rust's builder.
  const sorted = [...indices].sort((a, b) => a - b);
  assert.deepEqual(indices, sorted);
});

test("buildSystemPrompt leads with the stable intro marker line", () => {
  const prompt = buildSystemPrompt();
  assert.ok(prompt.startsWith(SYSTEM_PROMPT_INTRO_MARKER));
});

test("static sections are byte-faithful to the Rust reference headers", () => {
  assert.ok(SYSTEM_SECTION.startsWith("# System\n - "));
  assert.ok(DOING_TASKS_SECTION.startsWith("# Doing tasks\n - "));
  assert.ok(TOOL_USAGE_SECTION.startsWith("# Using your tools\n - "));
  assert.ok(ACTIONS_SECTION.startsWith("# Executing actions with care\n"));
  // Verbatim recovery line from the Rust tool-usage section.
  assert.ok(TOOL_USAGE_SECTION.includes("Never invent a file path or repository artifact"));
  assert.ok(TOOL_USAGE_SECTION.includes("git status --short --branch"));
});

test("renderEnvironmentSection emits model family, cwd, date, and platform", () => {
  const section = renderEnvironmentSection({
    cwd: "/work",
    date: "2026-06-04",
    osName: "linux",
    osVersion: "6.8",
  });
  assert.ok(section.startsWith("# Environment context\n"));
  assert.ok(section.includes(` - Model family: ${FRONTIER_MODEL_NAME}`));
  assert.ok(section.includes(" - Working directory: /work"));
  assert.ok(section.includes(" - Date: 2026-06-04"));
  assert.ok(section.includes(" - Platform: linux 6.8"));
});

test("renderEnvironmentSection defaults to live process/host values", () => {
  const section = renderEnvironmentSection();
  assert.ok(section.includes(` - Working directory: ${process.cwd()}`));
  // Date defaults to an ISO YYYY-MM-DD prefix.
  assert.ok(/ - Date: \d{4}-\d{2}-\d{2}/.test(section));
});
