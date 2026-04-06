export class Server {
    config;
    constructor(config) {
        this.config = config;
    }
    describe() {
        return `Server listening on port ${this.config.port}`;
    }
}
