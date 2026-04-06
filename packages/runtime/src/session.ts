export interface SessionTurn {
  input: string;
  output: string;
}

export class Session {
  private readonly turns: SessionTurn[] = [];

  addTurn(turn: SessionTurn): void {
    this.turns.push(turn);
  }

  history(): SessionTurn[] {
    return [...this.turns];
  }
}
