import { DEFAULT_STARTER_SYSTEM_CONFIG, StarterSystemApplication } from "../../../packages/system/src/index.js";

const app = new StarterSystemApplication(DEFAULT_STARTER_SYSTEM_CONFIG);
const [commandReply, firstReply, secondReply] = app.runDemo();
app.shutdown();
const report = app.report();

console.log("emberforge-ts starter");
console.log(`system: ${report.appName}`);
console.log(`lifecycle: ${report.lifecycleState}`);
console.log(`commands: ${report.commandCount}`);
console.log(`tools: ${report.toolCount}`);
console.log(`plugins: ${report.pluginCount}`);
console.log(`handled requests: ${report.handledRequestCount}`);
console.log(app.plugins.list()[0]?.validate() ?? false ? "plugin valid: true" : "plugin valid: false");
console.log(report.serverDescription);
console.log(report.lspSummary);
console.log(`rust anchor: ${report.rustAnchor}`);
console.log(`turns: ${report.turnCount}`);
console.log(commandReply);
console.log(firstReply);
console.log(secondReply);
console.log(`last route: ${report.lastRoute ?? "none"}`);
console.log(`last phases: ${report.lastPhaseHistory.join(" -> ")}`);
console.log(`last turn: ${report.lastTurnInput ?? "none"}`);
