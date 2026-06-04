import test from "node:test";
import assert from "node:assert/strict";

import { StarterSystemApplication } from "../../../packages/system/src/index.js";
import { DEFAULT_STARTER_SYSTEM_CONFIG } from "../../../packages/system/src/index.js";
import { parsePromptArgs, runPromptTurn } from "./prompt.js";

test("parsePromptArgs joins bare tokens into the prompt with text default", () => {
  const parsed = parsePromptArgs(["hello", "world"]);
  assert.equal(parsed.prompt, "hello world");
  assert.equal(parsed.output, "text");
});

test("parsePromptArgs recognizes --output json (spaced and equals forms)", () => {
  assert.equal(parsePromptArgs(["--output", "json", "hi"]).output, "json");
  assert.equal(parsePromptArgs(["--output=json", "hi"]).output, "json");
  // The flag is stripped from the prompt text.
  assert.equal(parsePromptArgs(["--output", "json", "hi", "there"]).prompt, "hi there");
});

test("parsePromptArgs rejects an unsupported --output value", () => {
  assert.throws(() => parsePromptArgs(["--output", "yaml", "hi"]), /unsupported value for --output/);
});

test("runPromptTurn drives one runtime turn and returns the text output", async () => {
  // Default app uses the built-in MockProvider (offline, deterministic).
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG);
  const output = await runPromptTurn(app, "ping", "text");
  // The mock provider echoes the model + prompt; one turn must have run.
  assert.match(output, /prompt=ping/);
  assert.equal(app.runtime.turnCount(), 1);
  app.shutdown();
});

test("runPromptTurn json output is a single structured line", async () => {
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG);
  const output = await runPromptTurn(app, "ping", "json");
  const payload = JSON.parse(output) as {
    type: string;
    route: string;
    input: string;
    output: string;
    model: string;
  };
  assert.equal(payload.type, "prompt_result");
  assert.equal(payload.route, "prompt");
  assert.equal(payload.input, "ping");
  assert.match(payload.output, /prompt=ping/);
  assert.ok(payload.model.length > 0);
  app.shutdown();
});
