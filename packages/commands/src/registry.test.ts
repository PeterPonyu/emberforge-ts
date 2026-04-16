import test from "node:test";
import assert from "node:assert/strict";

import { getCommands } from "./registry.js";

test("translated registry exposes the README command surface", () => {
  const commands = getCommands();
  const names = commands.map((command) => command.name);
  assert.deepEqual(
    names,
    ["help", "status", "doctor", "model", "questions", "tasks", "buddy", "compact", "review", "commit", "pr"],
  );
  assert.equal(commands.find((command) => command.name === "doctor")?.argumentHint, "[quick|status]");
  assert.equal(commands.find((command) => command.name === "questions")?.category, "session");
  assert.equal(commands.find((command) => command.name === "tasks")?.category, "automation");
  assert.equal(commands.find((command) => command.name === "buddy")?.argumentHint, "[hatch|rehatch|pet|mute|unmute]");
  assert.equal(commands.find((command) => command.name === "review")?.category, "git");
});
