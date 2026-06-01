import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type {
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  McpInitializeParams,
  McpInitializeResult,
  McpListToolsParams,
  McpListToolsResult,
  McpStdioTransport,
  McpToolCallParams,
  McpToolCallResult,
} from "./types.js";

/** Child with piped stdin/stdout and inherited stderr. */
type StdioChild = ChildProcessByStdio<Writable, Readable, null>;

/**
 * Encodes a JSON-RPC payload using LSP-style `Content-Length` framing, matching
 * the wire format produced by the Rust `encode_frame`.
 */
export function encodeFrame(payload: string): Buffer {
  const body = Buffer.from(payload, "utf-8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf-8");
  return Buffer.concat([header, body]);
}

/**
 * Manages a single MCP server subprocess over stdio with `Content-Length`
 * framing, mirroring the Rust `McpStdioProcess`. The implementation is
 * structural and offline-safe: it spawns whatever command it is given and never
 * performs network I/O itself.
 */
export class McpStdioProcess {
  private readonly child: StdioChild;
  private buffer = Buffer.alloc(0);
  private readonly pending: Array<{
    resolve: (frame: Buffer) => void;
    reject: (err: Error) => void;
  }> = [];
  private readError: Error | null = null;

  private constructor(child: StdioChild) {
    this.child = child;
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.stdout.on("error", (err: Error) => this.failPending(err));
    this.child.on("error", (err: Error) => this.failPending(err));
    this.child.on("close", () => {
      this.failPending(new Error("MCP stdio stream closed"));
    });
  }

  static spawn(transport: McpStdioTransport): McpStdioProcess {
    const child = spawn(transport.command, transport.args, {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, ...transport.env },
    }) as StdioChild;
    return new McpStdioProcess(child);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drainFrames();
  }

  private drainFrames(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      const header = this.buffer.subarray(0, headerEnd).toString("utf-8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.failPending(new Error("missing Content-Length header"));
        return;
      }
      const contentLength = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) {
        return;
      }
      const body = this.buffer.subarray(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.subarray(bodyStart + contentLength);
      const waiter = this.pending.shift();
      if (waiter) {
        waiter.resolve(Buffer.from(body));
      }
    }
  }

  private failPending(err: Error): void {
    this.readError = err;
    while (this.pending.length > 0) {
      const waiter = this.pending.shift();
      waiter?.reject(err);
    }
  }

  private readFrame(): Promise<Buffer> {
    if (this.readError) {
      return Promise.reject(this.readError);
    }
    return new Promise<Buffer>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      // A frame may already be buffered from a prior chunk.
      this.drainFrames();
    });
  }

  private writeFrame(payload: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.child.stdin.write(encodeFrame(payload), (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async request<TParams, TResult>(
    id: JsonRpcId,
    method: string,
    params?: TParams,
  ): Promise<JsonRpcResponse<TResult>> {
    const message: JsonRpcRequest<TParams> = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    await this.writeFrame(JSON.stringify(message));
    const frame = await this.readFrame();
    return JSON.parse(frame.toString("utf-8")) as JsonRpcResponse<TResult>;
  }

  initialize(
    id: JsonRpcId,
    params: McpInitializeParams,
  ): Promise<JsonRpcResponse<McpInitializeResult>> {
    return this.request(id, "initialize", params);
  }

  listTools(
    id: JsonRpcId,
    params?: McpListToolsParams,
  ): Promise<JsonRpcResponse<McpListToolsResult>> {
    return this.request(id, "tools/list", params);
  }

  callTool(
    id: JsonRpcId,
    params: McpToolCallParams,
  ): Promise<JsonRpcResponse<McpToolCallResult>> {
    return this.request(id, "tools/call", params);
  }

  /** Terminates the subprocess and waits for it to exit. */
  async shutdown(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill();
    }
    await new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        resolve();
        return;
      }
      this.child.once("close", () => resolve());
    });
  }
}
