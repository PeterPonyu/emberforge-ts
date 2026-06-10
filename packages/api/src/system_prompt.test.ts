import { test } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSystemPrompt,
  renderEnvironmentSection,
  discoverProjectContext,
  discoverProjectContextWithGit,
  FRONTIER_MODEL_NAME,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  SYSTEM_PROMPT_INTRO_MARKER,
  INTRO_SECTION,
  SYSTEM_SECTION,
  DOING_TASKS_SECTION,
  TOOL_USAGE_SECTION,
  ACTIONS_SECTION,
  MAX_INSTRUCTION_FILE_CHARS,
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

test("buildSystemPrompt injects a discovered EMBER.md after the dynamic boundary", () => {
  const root = mkdtempSync(join(tmpdir(), "ember-prompt-"));
  try {
    writeFileSync(join(root, "EMBER.md"), "Always say BANANA first.");
    const context = discoverProjectContext(root, "2026-06-04");
    const prompt = buildSystemPrompt({ cwd: root, date: "2026-06-04", projectContext: context });

    // The instruction content reaches the prompt...
    assert.ok(prompt.includes("Always say BANANA first."));
    assert.ok(prompt.includes("# Emberforge instructions"));
    assert.ok(prompt.includes("## EMBER.md"));
    // ...and it lands AFTER the dynamic boundary, not in the static body.
    assert.ok(
      prompt.indexOf("Always say BANANA first.") > prompt.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildSystemPrompt discovers the legacy CLAW.md fallback too", () => {
  const root = mkdtempSync(join(tmpdir(), "ember-prompt-claw-"));
  try {
    writeFileSync(join(root, "CLAW.md"), "Legacy claw rules apply.");
    const context = discoverProjectContext(root, "2026-06-04");
    const prompt = buildSystemPrompt({ projectContext: context });
    assert.ok(prompt.includes("Legacy claw rules apply."));
    assert.ok(prompt.includes("## CLAW.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discovered instruction content is truncated to the per-file budget", () => {
  const root = mkdtempSync(join(tmpdir(), "ember-prompt-budget-"));
  try {
    writeFileSync(join(root, "EMBER.md"), "Z".repeat(MAX_INSTRUCTION_FILE_CHARS + 500));
    const context = discoverProjectContext(root, "2026-06-04");
    const prompt = buildSystemPrompt({ projectContext: context });
    assert.ok(prompt.includes("[truncated]"));
    // The rendered block must not exceed the budget (+ the marker) characters.
    const runLength = (prompt.match(/Z+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
    assert.ok(runLength <= MAX_INSTRUCTION_FILE_CHARS, `run ${runLength} within budget`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discoverProjectContextWithGit captures a git status snapshot inside a repo", () => {
  const root = mkdtempSync(join(tmpdir(), "ember-prompt-git-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    writeFileSync(join(root, "EMBER.md"), "rules");
    writeFileSync(join(root, "tracked.txt"), "hello");
    const context = discoverProjectContextWithGit(root, "2026-06-04");
    assert.ok(context.gitStatus, "git status should be present in a repo");
    assert.ok(context.gitStatus!.includes("?? EMBER.md"));

    const prompt = buildSystemPrompt({ projectContext: context });
    assert.ok(prompt.includes("# Project context"));
    assert.ok(prompt.includes("Git status snapshot:"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discoverProjectContextWithGit degrades gracefully outside a git repo", () => {
  const root = mkdtempSync(join(tmpdir(), "ember-prompt-nogit-"));
  try {
    // A bare temp dir is not a git repo: status/diff must be undefined, no throw.
    const context = discoverProjectContextWithGit(root, "2026-06-04");
    assert.equal(context.gitStatus, undefined);
    assert.equal(context.gitDiff, undefined);
    const prompt = buildSystemPrompt({ projectContext: context });
    assert.ok(!prompt.includes("Git status snapshot:"));
    // The config section still renders its "no settings" note.
    assert.ok(prompt.includes("# Runtime config"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderConfigSection surfaces discovered settings files", () => {
  const root = mkdtempSync(join(tmpdir(), "ember-prompt-cfg-"));
  try {
    mkdirSync(join(root, ".ember"));
    writeFileSync(join(root, ".ember", "settings.json"), '{"permissionMode":"acceptEdits"}');
    const context = discoverProjectContext(root, "2026-06-04");
    const prompt = buildSystemPrompt({ projectContext: context });
    assert.ok(prompt.includes("# Runtime config"));
    assert.ok(prompt.includes("Loaded settings:"));
    assert.ok(prompt.includes("permissionMode"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
