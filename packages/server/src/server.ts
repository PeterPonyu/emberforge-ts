export interface ServerConfig {
  port: number;
}

export class Server {
  constructor(private readonly config: ServerConfig) {}

  describe(): string {
    return `Server listening on port ${this.config.port}`;
  }
}
