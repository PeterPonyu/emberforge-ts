import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { StarterSystemApplication } from "./application.js";
import { DEFAULT_STARTER_SYSTEM_CONFIG } from "./config.js";
import { executeStarterSlashCommand } from "./starter_commands.js";

test("executeStarterSlashCommand renders help with hints", () => {
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG);
  const output = executeStarterSlashCommand(app, "/help");
  assert.ok(output);
  assert.match(output, /\/questions \[ask <task-id> <text>\|pending\|answer <question-id> <text>\]/);
  assert.match(output, /\/tasks \[create prompt <text>\|list\|show <task-id>\|stop <task-id>\]/);
  assert.match(output, /\/buddy \[hatch\|rehatch\|pet\|mute\|unmute\]/);
  assert.match(output, /\/doctor \[quick\|status\]/);
  assert.match(output, /\/pr \[context\]/);
  app.shutdown();
});

test("executeStarterSlashCommand renders doctor output", () => {
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG);
  const output = executeStarterSlashCommand(app, "/doctor");
  assert.ok(output);
  assert.match(output, /emberforge-ts doctor/);
  app.shutdown();
});

test("executeStarterSlashCommand renders doctor status output", () => {
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG);
  const output = executeStarterSlashCommand(app, "/doctor status");
  assert.ok(output);
  assert.match(output, /emberforge-ts doctor status/);
  assert.match(output, /last_route: none/);
  app.shutdown();
});

test("executeStarterSlashCommand returns null for unsupported slash commands", () => {
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG);
  assert.equal(executeStarterSlashCommand(app, "/unknown"), null);
  app.shutdown();
});

test("executeStarterSlashCommand supports model list and payload-bearing review/pr placeholders", () => {
  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG);
  assert.match(executeStarterSlashCommand(app, "/model list") ?? "", /model list:/);
  assert.match(executeStarterSlashCommand(app, "/review workspace") ?? "", /\[command\] review/);
  assert.match(executeStarterSlashCommand(app, "/review workspace") ?? "", /scope: workspace/);
  assert.match(executeStarterSlashCommand(app, "/pr release notes") ?? "", /\[command\] pr/);
  assert.match(executeStarterSlashCommand(app, "/pr release notes") ?? "", /context: release notes/);
  app.shutdown();
});

test("executeStarterSlashCommand supports the starter buddy lifecycle", () => {
  const originalStatePath = process.env.EMBER_BUDDY_STATE_PATH;
  process.env.EMBER_BUDDY_STATE_PATH = join(mkdtempSync(join(tmpdir(), "ember-buddy-ts-")), "buddy-state.json");

  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG);

  assert.match(executeStarterSlashCommand(app, "/buddy") ?? "", /status: no companion/);

  const hatchOutput = executeStarterSlashCommand(app, "/buddy hatch") ?? "";
  assert.match(hatchOutput, /\[command\] buddy hatch/);
  assert.match(hatchOutput, /name: Waddles/);
  assert.match(hatchOutput, /species: Duck/);

  const secondHatchOutput = executeStarterSlashCommand(app, "/buddy hatch") ?? "";
  assert.match(secondHatchOutput, /status: companion already active/);
  assert.match(secondHatchOutput, /\/buddy rehatch/);

  const buddyOutput = executeStarterSlashCommand(app, "/buddy") ?? "";
  assert.match(buddyOutput, /commands: \/buddy pet/);

  const muteOutput = executeStarterSlashCommand(app, "/buddy mute") ?? "";
  assert.match(muteOutput, /status: muted/);
  assert.match(muteOutput, /hide quietly/);

  const secondMuteOutput = executeStarterSlashCommand(app, "/buddy mute") ?? "";
  assert.match(secondMuteOutput, /status: already muted/);

  const petOutput = executeStarterSlashCommand(app, "/buddy pet") ?? "";
  assert.match(petOutput, /reaction: Waddles purrs happily!/);

  const unmuteOutput = executeStarterSlashCommand(app, "/buddy unmute") ?? "";
  assert.match(unmuteOutput, /status: active/);
  assert.match(unmuteOutput, /welcome back/);

  const secondUnmuteOutput = executeStarterSlashCommand(app, "/buddy unmute") ?? "";
  assert.match(secondUnmuteOutput, /status: already active/);

  const rehatchOutput = executeStarterSlashCommand(app, "/buddy rehatch") ?? "";
  assert.match(rehatchOutput, /name: Goosberry/);
  assert.match(rehatchOutput, /species: Goose/);

  app.shutdown();

  const restored = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG);
  const restoredBuddy = executeStarterSlashCommand(restored, "/buddy") ?? "";
  assert.match(restoredBuddy, /name: Goosberry/);
  assert.match(restoredBuddy, /species: Goose/);
  restored.shutdown();

  if (originalStatePath === undefined) {
    delete process.env.EMBER_BUDDY_STATE_PATH;
  } else {
    process.env.EMBER_BUDDY_STATE_PATH = originalStatePath;
  }
});

test("executeStarterSlashCommand supports persisted task-question resume flow", () => {
  const originalStatePath = process.env.EMBER_TASK_STATE_PATH;
  process.env.EMBER_TASK_STATE_PATH = join(mkdtempSync(join(tmpdir(), "ember-task-ts-")), "task-state.json");

  const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG);

  const createOutput = executeStarterSlashCommand(app, "/tasks create prompt investigate auth flow") ?? "";
  assert.match(createOutput, /task_id: task-1/);
  assert.match(createOutput, /status: in_progress/);

  const askOutput = executeStarterSlashCommand(app, "/questions ask task-1 Which tenant should we target first\\?") ?? "";
  assert.match(askOutput, /question_id: question-1/);
  assert.match(askOutput, /status: waiting_for_user/);

  const pendingOutput = executeStarterSlashCommand(app, "/questions pending") ?? "";
  assert.match(pendingOutput, /question-1 -> task-1/);

  app.shutdown();

  const restarted = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG);
  const showWaiting = executeStarterSlashCommand(restarted, "/tasks show task-1") ?? "";
  assert.match(showWaiting, /status: waiting_for_user/);

  const answerOutput = executeStarterSlashCommand(restarted, "/questions answer question-1 Start with the billing tenant") ?? "";
  assert.match(answerOutput, /task_status: completed/);

  const showCompleted = executeStarterSlashCommand(restarted, "/tasks show task-1") ?? "";
  assert.match(showCompleted, /status: completed/);
  assert.match(showCompleted, /answer: Start with the billing tenant/);

  const transcriptRaw = readFileSync(join(dirname(process.env.EMBER_TASK_STATE_PATH!), "task-question-transcript.jsonl"), "utf-8");
  assert.match(transcriptRaw, /"id":"task-question-runtime"/);
  assert.match(transcriptRaw, /"type":"task_state"/);
  assert.match(transcriptRaw, /"type":"question_state"/);
  assert.match(transcriptRaw, /"status":"waiting_for_user"/);
  assert.match(transcriptRaw, /"status":"completed"/);

  restarted.shutdown();

  if (originalStatePath === undefined) {
    delete process.env.EMBER_TASK_STATE_PATH;
  } else {
    process.env.EMBER_TASK_STATE_PATH = originalStatePath;
  }
});
