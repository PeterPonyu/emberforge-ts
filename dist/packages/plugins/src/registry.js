export class ExamplePlugin {
    info = {
        id: "example.bundled",
        name: "ExamplePlugin",
        version: "0.1.0",
        description: "A minimal plugin mirroring emberforge::plugins::Plugin",
    };
    metadata() {
        return this.info;
    }
    validate() {
        return this.info.id.length > 0 && this.info.name.length > 0;
    }
}
export class PluginRegistry {
    plugins;
    constructor(plugins = [new ExamplePlugin()]) {
        this.plugins = plugins;
    }
    list() {
        return [...this.plugins];
    }
}
export function getPlugins() {
    return new PluginRegistry().list();
}
