import { createInterface, type Interface } from "node:readline";

export interface ReplOptions {
  prompt?: string;
  onInput: (line: string) => Promise<string> | string;
  onExit?: () => void;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export class Repl {
  private readonly opts: {
    prompt: string;
    onInput: (line: string) => Promise<string> | string;
    onExit?: () => void;
    input: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
  };

  constructor(opts: ReplOptions) {
    this.opts = {
      prompt: opts.prompt ?? "ember> ",
      onInput: opts.onInput,
      onExit: opts.onExit,
      input: opts.input ?? process.stdin,
      output: opts.output ?? process.stdout,
    };
  }

  async start(): Promise<void> {
    const rl: Interface = createInterface({
      input: this.opts.input,
      output: this.opts.output,
      prompt: this.opts.prompt,
      // PassThrough streams don't have terminal capabilities; setting terminal:false
      // prevents readline from emitting ANSI escape codes that corrupt test output.
      terminal: false,
    });

    // Override SIGINT so Ctrl-C does NOT kill the Node process.
    // Choice: reprompt on SIGINT (keeps the session alive). Users who want to quit
    // should type /quit or /exit. This matches typical REPL conventions (e.g. Node REPL).
    rl.on("SIGINT", () => {
      this.opts.output.write("\n");
      rl.prompt();
    });

    rl.prompt();

    return new Promise<void>((resolve) => {
      rl.on("line", async (raw) => {
        const line = raw.trim();
        if (line === "/quit" || line === "/exit") {
          rl.close();
          return;
        }
        try {
          const out = await this.opts.onInput(line);
          this.opts.output.write(out + "\n");
        } catch (err) {
          this.opts.output.write(`error: ${(err as Error).message}\n`);
        }
        rl.prompt();
      });

      rl.on("close", () => {
        if (this.opts.onExit) this.opts.onExit();
        resolve();
      });
    });
  }
}
