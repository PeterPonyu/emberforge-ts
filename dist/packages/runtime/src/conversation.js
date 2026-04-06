import { DEFAULT_MODEL } from "../../api/src/index.js";
import { Session } from "./session.js";
export class ConversationRuntime {
    provider;
    toolExecutor;
    telemetry;
    session = new Session();
    constructor(provider, toolExecutor, telemetry) {
        this.provider = provider;
        this.toolExecutor = toolExecutor;
        this.telemetry = telemetry;
    }
    runTurn(input) {
        this.telemetry.record({ name: "turn_started", details: input });
        let output;
        if (input.startsWith("/tool ")) {
            const payload = input.slice(6);
            output = this.toolExecutor.execute("bash", payload);
            this.telemetry.record({ name: "tool_executed", details: output });
        }
        else {
            output = this.provider.sendMessage({
                model: DEFAULT_MODEL,
                prompt: input,
            }).text;
            this.telemetry.record({ name: "provider_completed", details: output });
        }
        this.session.addTurn({ input, output });
        return output;
    }
    summarizeLastTurn() {
        const history = this.session.history();
        return history.at(-1);
    }
    turnCount() {
        return this.session.history().length;
    }
}
