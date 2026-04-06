export const DEFAULT_COMMANDS = [
    { name: "help", description: "Show the translated command registry" },
    { name: "status", description: "Report starter runtime status" },
    { name: "model", description: "Mirror a Rust-style CLI command" },
];
export class CommandRegistry {
    commands;
    constructor(commands = DEFAULT_COMMANDS) {
        this.commands = commands;
    }
    list() {
        return [...this.commands];
    }
    find(name) {
        return this.commands.find((command) => command.name === name);
    }
}
export function getCommands() {
    return new CommandRegistry().list();
}
