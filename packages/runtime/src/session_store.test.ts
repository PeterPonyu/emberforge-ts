import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore, newSessionId } from "./session_store.js";
import type { Session } from "./session_store.js";

function makeSession(): Session {
  return {
    id: newSessionId(),
    createdAt: new Date().toISOString(),
    messages: [
      { role: "user", content: "Hello", timestamp: new Date().toISOString() },
      { role: "assistant", content: "Hi there!", timestamp: new Date().toISOString() },
    ],
  };
}

test("save and load round trip", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-session-test-"));
  try {
    const store = new SessionStore(dir);
    const session = makeSession();
    await store.save(session);

    const store2 = new SessionStore(dir);
    const loaded = await store2.load(session.id);

    assert.equal(loaded.id, session.id);
    assert.equal(loaded.createdAt, session.createdAt);
    assert.equal(loaded.messages.length, session.messages.length);
    assert.equal(loaded.messages[0].role, session.messages[0].role);
    assert.equal(loaded.messages[0].content, session.messages[0].content);
    assert.equal(loaded.messages[0].timestamp, session.messages[0].timestamp);
    assert.equal(loaded.messages[1].role, session.messages[1].role);
    assert.equal(loaded.messages[1].content, session.messages[1].content);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});

test("list returns created sessions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-session-test-"));
  try {
    const store = new SessionStore(dir);
    const s1 = makeSession();
    const s2 = makeSession();
    await store.save(s1);
    await store.save(s2);

    const summaries = await store.list();
    assert.equal(summaries.length, 2);
    const ids = summaries.map((s) => s.id).sort();
    assert.deepEqual(ids, [s1.id, s2.id].sort());
    for (const summary of summaries) {
      const expected = [s1, s2].find((s) => s.id === summary.id);
      assert.ok(expected !== undefined);
      assert.equal(summary.messageCount, expected.messages.length);
    }
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});

test("delete removes file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-session-test-"));
  try {
    const store = new SessionStore(dir);
    const session = makeSession();
    await store.save(session);
    await store.delete(session.id);

    await assert.rejects(
      () => store.load(session.id),
      /Session not found/,
    );
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});

test("load on missing id rejects", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-session-test-"));
  try {
    const store = new SessionStore(dir);
    await assert.rejects(
      () => store.load("nonexistent"),
      /Session not found/,
    );
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});

test("JSONL format is valid", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-session-test-"));
  try {
    const store = new SessionStore(dir);
    const session = makeSession();
    await store.save(session);

    const raw = await fs.readFile(path.join(dir, `${session.id}.jsonl`), "utf-8");
    const nonEmpty = raw.split("\n").filter((l) => l.trim() !== "");
    assert.ok(nonEmpty.length > 0, "Expected at least one line");
    for (const line of nonEmpty) {
      assert.doesNotThrow(() => JSON.parse(line), `Invalid JSON on line: ${line}`);
    }
    const meta = JSON.parse(nonEmpty[0]) as { type: string; id: string; createdAt: string };
    assert.equal(meta.type, "session");
    assert.equal(meta.id, session.id);
    for (const line of nonEmpty.slice(1)) {
      const rec = JSON.parse(line) as { type: string };
      assert.equal(rec.type, "message");
    }
  } finally {
    await fs.rm(dir, { recursive: true });
  }
});
