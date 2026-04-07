import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RealToolExecutor } from "./real_executor.js";

test("RealToolExecutor read_file round-trip", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-test-"));
  const filePath = path.join(dir, "hello.txt");
  const content = "hello world\n";
  await fs.writeFile(filePath, content, "utf-8");

  const executor = new RealToolExecutor();
  const result = await executor.execute("read_file", filePath);
  assert.equal(result, content);

  await fs.rm(dir, { recursive: true });
});

test("RealToolExecutor write_file creates file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-test-"));
  const filePath = path.join(dir, "out.txt");
  const content = "written by test\n";

  const tmpFile = path.join(process.cwd(), "dist", ".test-write-tmp.txt");
  await fs.mkdir(path.dirname(tmpFile), { recursive: true });

  const executor = new RealToolExecutor();
  const result = await executor.execute("write_file", `${tmpFile}\n${content}`);
  assert.ok(result.startsWith("Written:"));

  const readBack = await fs.readFile(tmpFile, "utf-8");
  assert.equal(readBack, content);

  await fs.rm(tmpFile, { force: true });
  await fs.rm(dir, { recursive: true });
});

test("RealToolExecutor bash echo returns output", async () => {
  const executor = new RealToolExecutor();
  const result = await executor.execute("bash", "echo hello-from-bash");
  assert.equal(result.trim(), "hello-from-bash");
});
