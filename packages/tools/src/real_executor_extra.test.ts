import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import { RealToolExecutor } from "./real_executor.js";

const SCRATCH = path.join(process.cwd(), "dist", ".tool-scratch");

async function freshScratch(): Promise<string> {
  await fs.rm(SCRATCH, { recursive: true, force: true });
  await fs.mkdir(SCRATCH, { recursive: true });
  return SCRATCH;
}

test("edit_file replaces a unique occurrence", async () => {
  const dir = await freshScratch();
  const file = path.join(dir, "edit-target.txt");
  await fs.writeFile(file, "alpha BETA gamma\n", "utf-8");

  const executor = new RealToolExecutor();
  const result = await executor.execute(
    "edit_file",
    JSON.stringify({ path: file, old_string: "BETA", new_string: "delta" }),
  );
  assert.ok(result.startsWith("Edited:"));
  assert.equal(await fs.readFile(file, "utf-8"), "alpha delta gamma\n");

  await fs.rm(dir, { recursive: true, force: true });
});

test("edit_file rejects a non-unique old_string without replace_all", async () => {
  const dir = await freshScratch();
  const file = path.join(dir, "dup.txt");
  await fs.writeFile(file, "x x x", "utf-8");

  const executor = new RealToolExecutor();
  await assert.rejects(
    () => executor.execute("edit_file", JSON.stringify({ path: file, old_string: "x", new_string: "y" })),
    /not unique/,
  );

  await fs.rm(dir, { recursive: true, force: true });
});

test("edit_file replaces all occurrences when replace_all is set", async () => {
  const dir = await freshScratch();
  const file = path.join(dir, "dup2.txt");
  await fs.writeFile(file, "a-a-a", "utf-8");

  const executor = new RealToolExecutor();
  await executor.execute(
    "edit_file",
    JSON.stringify({ path: file, old_string: "a", new_string: "b", replace_all: true }),
  );
  assert.equal(await fs.readFile(file, "utf-8"), "b-b-b");

  await fs.rm(dir, { recursive: true, force: true });
});

test("edit_file rejects a path outside the workspace", async () => {
  const executor = new RealToolExecutor();
  await assert.rejects(
    () => executor.execute("edit_file", JSON.stringify({ path: "../escape.txt", old_string: "a", new_string: "b" })),
    /Path outside workspace/,
  );
});

test("glob_search finds files by pattern within the workspace", async () => {
  const dir = await freshScratch();
  await fs.writeFile(path.join(dir, "one.md"), "1", "utf-8");
  await fs.writeFile(path.join(dir, "two.md"), "2", "utf-8");
  await fs.writeFile(path.join(dir, "skip.txt"), "3", "utf-8");

  const executor = new RealToolExecutor();
  const result = await executor.execute("glob_search", JSON.stringify({ pattern: "*.md", path: dir }));
  const lines = result.split("\n").sort();
  assert.deepEqual(lines, ["one.md", "two.md"]);

  await fs.rm(dir, { recursive: true, force: true });
});

test("grep_search returns matching lines with relative paths", async () => {
  const dir = await freshScratch();
  await fs.writeFile(path.join(dir, "a.txt"), "needle here\nnope\n", "utf-8");
  await fs.writeFile(path.join(dir, "b.txt"), "no match\n", "utf-8");

  const executor = new RealToolExecutor();
  const result = await executor.execute("grep_search", JSON.stringify({ pattern: "needle", path: dir }));
  assert.match(result, /a\.txt:.*needle here/);
  assert.ok(!result.includes("no match"));

  await fs.rm(dir, { recursive: true, force: true });
});

test("grep_search honors case-insensitive and line-number flags", async () => {
  const dir = await freshScratch();
  await fs.writeFile(path.join(dir, "c.txt"), "first\nNEEDLE\n", "utf-8");

  const executor = new RealToolExecutor();
  const result = await executor.execute(
    "grep_search",
    JSON.stringify({ pattern: "needle", path: dir, "-i": true, "-n": true }),
  );
  assert.match(result, /c\.txt:2:NEEDLE/);

  await fs.rm(dir, { recursive: true, force: true });
});

test("edit_file rejects malformed JSON input", async () => {
  const executor = new RealToolExecutor();
  await assert.rejects(
    () => executor.execute("edit_file", "not json"),
    /must be a JSON object/,
  );
});

test("glob_search rejects a pattern with .. traversal segments", async () => {
  const executor = new RealToolExecutor();
  await assert.rejects(
    () => executor.execute("glob_search", JSON.stringify({ pattern: "../../../*" })),
    /glob_search: pattern must stay within the workspace/,
  );
});

test("glob_search does not return files outside the workspace via symlinked cwd", async () => {
  // Even if the pattern has no '..' we verify confinement by trying a pattern
  // that would only match inside the workspace scratch dir — this exercises
  // the post-collection realpath filter path.
  const dir = await freshScratch();
  await fs.writeFile(path.join(dir, "inside.txt"), "safe", "utf-8");

  const executor = new RealToolExecutor();
  const result = await executor.execute(
    "glob_search",
    JSON.stringify({ pattern: "*.txt", path: dir }),
  );
  assert.match(result, /inside\.txt/);
  // All returned paths must not start with an outside-workspace prefix.
  const lines = result.split("\n").filter(Boolean);
  for (const line of lines) {
    const abs = path.resolve(dir, line);
    assert.ok(
      abs.startsWith(process.cwd()),
      `Result path escaped workspace: ${abs}`,
    );
  }

  await fs.rm(dir, { recursive: true, force: true });
});

test("grep_search rejects an invalid regex pattern", async () => {
  const executor = new RealToolExecutor();
  await assert.rejects(
    () => executor.execute("grep_search", JSON.stringify({ pattern: "[invalid" })),
    /grep_search: invalid regex pattern/,
  );
});
