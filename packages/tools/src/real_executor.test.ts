import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RealToolExecutor } from "./real_executor.js";

test("RealToolExecutor read_file round-trip", async () => {
  const filePath = path.join(process.cwd(), "dist", ".test-read-tmp.txt");
  const content = "hello world\n";
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");

  const executor = new RealToolExecutor();
  const result = await executor.execute("read_file", filePath);
  assert.equal(result, content);

  await fs.rm(filePath, { force: true });
});

test("RealToolExecutor read_file rejects absolute path outside workspace", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-test-"));
  const outside = path.join(dir, "secret.txt");
  await fs.writeFile(outside, "outside-secret", "utf-8");

  const executor = new RealToolExecutor();
  await assert.rejects(
    () => executor.execute("read_file", outside),
    /Path outside workspace/,
  );

  await fs.rm(dir, { recursive: true });
});

test("RealToolExecutor read_file rejects traversal-shaped path", async () => {
  const executor = new RealToolExecutor();
  await assert.rejects(
    () => executor.execute("read_file", "../outside"),
    /Path outside workspace/,
  );
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
