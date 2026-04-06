export class MockToolExecutor {
    execute(toolName, input) {
        return `[ts tool] ${toolName} => ${input}`;
    }
}
