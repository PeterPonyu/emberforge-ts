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

test("RealToolExecutor write_file rejects absolute path outside workspace", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-test-"));
  const outside = path.join(dir, "out.txt");

  const executor = new RealToolExecutor();
  await assert.rejects(
    () => executor.execute("write_file", `${outside}\nshould not be written`),
    /Path outside workspace/,
  );

  await fs.rm(dir, { recursive: true });
});

test("RealToolExecutor write_file rejects traversal-shaped path", async () => {
  const executor = new RealToolExecutor();
  await assert.rejects(
    () => executor.execute("write_file", "../outside.txt\nnope"),
    /Path outside workspace/,
  );
});

test("RealToolExecutor write_file rejects in-workspace symlink escaping the workspace", async () => {
  // Outside target the attacker wants to overwrite.
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "ember-test-"));
  const outsideFile = path.join(outsideDir, "secret.txt");
  await fs.writeFile(outsideFile, "before", "utf-8");

  // Symlink living INSIDE the workspace but pointing OUTSIDE it.
  const linkDir = path.join(process.cwd(), "dist");
  await fs.mkdir(linkDir, { recursive: true });
  const link = path.join(linkDir, ".test-escape-link.txt");
  await fs.rm(link, { force: true });
  await fs.symlink(outsideFile, link);

  const executor = new RealToolExecutor();
  await assert.rejects(
    () => executor.execute("write_file", `${link}\nafter`),
    /Path outside workspace/,
  );

  // The outside file must remain untouched.
  const outsideContent = await fs.readFile(outsideFile, "utf-8");
  assert.equal(outsideContent, "before");

  await fs.rm(link, { force: true });
  await fs.rm(outsideDir, { recursive: true });
});

test("RealToolExecutor write_file allows normal in-workspace write", async () => {
  const tmpFile = path.join(process.cwd(), "dist", ".test-write-ok.txt");
  await fs.mkdir(path.dirname(tmpFile), { recursive: true });
  await fs.rm(tmpFile, { force: true });
  const content = "normal in-workspace write\n";

  const executor = new RealToolExecutor();
  const result = await executor.execute("write_file", `${tmpFile}\n${content}`);
  assert.ok(result.startsWith("Written:"));

  const readBack = await fs.readFile(tmpFile, "utf-8");
  assert.equal(readBack, content);

  await fs.rm(tmpFile, { force: true });
});

test("RealToolExecutor bash echo returns output", async () => {
  const executor = new RealToolExecutor();
  const result = await executor.execute("bash", "echo hello-from-bash");
  assert.equal(result.trim(), "hello-from-bash");
});
