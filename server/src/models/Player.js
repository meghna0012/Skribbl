// A seat in a room. The id stays stable across a refresh. The socket id does not,
// which is why reconnect looks the player up by id and then swaps the socket.
export class Player {
  // What: create a connected player at score 0.
  // Why: score and ready are server state. Letting the client send them would
  // let someone join already on 500 points.
  constructor({ id, name, socketId }) {
    this.id = id;
    this.name = name;
    this.socketId = socketId;
    this.score = 0;
    this.ready = false;
    this.connected = true;
    // Holds the 20s removal timer while the socket is gone. Cleared if they return.
    this.disconnectTimer = null;
  }

  // What: the fields every client is allowed to see.
  // Why: socketId and the disconnect timer are server bookkeeping.
  // Sending them would not help the UI and would expose connection details.
  toPublic() {
    return {
      id: this.id,
      name: this.name,
      score: this.score,
      ready: this.ready,
      connected: this.connected,
    };
  }
}
