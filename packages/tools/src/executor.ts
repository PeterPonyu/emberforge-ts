export interface ToolExecutor {
  execute(toolName: string, input: string): Promise<string> | string;
}

export class MockToolExecutor implements ToolExecutor {
  execute(toolName: string, input: string): string {
    return `[ts tool] ${toolName} => ${input}`;
  }
}
