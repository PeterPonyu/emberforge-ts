export class Session {
    turns = [];
    addTurn(turn) {
        this.turns.push(turn);
    }
    history() {
        return [...this.turns];
    }
}
