export const DEFAULT_MODEL = "claude-sonnet-4-6";
export class MockProvider {
    sendMessage(request) {
        return {
            text: `[ts provider] model=${request.model} prompt=${request.prompt}`,
        };
    }
}
