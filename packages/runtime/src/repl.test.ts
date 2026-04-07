import { test } from "node:test";
import { strict as assert } from "node:assert";
import { PassThrough } from "node:stream";
import { Repl } from "./repl.js";

test("Repl_processes_lines_via_onInput", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let captured = "";
  output.on("data", (chunk) => {
    captured += chunk.toString();
  });

  const lines: string[] = [];
  const repl = new Repl({
    input,
    output,
    onInput: (line) => {
      lines.push(line);
      return `echo: ${line}`;
    },
  });
  const done = repl.start();
  input.write("hello\n");
  input.write("world\n");
  input.end(); // EOF closes the readline interface
  await done;

  assert.deepEqual(lines, ["hello", "world"]);
  assert.match(captured, /echo: hello/);
  assert.match(captured, /echo: world/);
});

test("Repl_quit_command_exits", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let exited = false;
  const repl = new Repl({
    input,
    output,
    onInput: () => "should-not-be-called",
    onExit: () => {
      exited = true;
    },
  });
  const done = repl.start();
  input.write("/quit\n");
  await done;
  assert.equal(exited, true);
});
