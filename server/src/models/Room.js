import { randomInt, randomUUID } from 'node:crypto';
import { Player } from './Player.js';
import { Game } from './Game.js';

// Dropped 0/O and 1/I so a code read out loud is less likely to be mistyped.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// How long a dropped socket keeps its seat. Long enough for a refresh, short
// enough that a drawer who closed the tab does not freeze the game.
export const GRACE_MS = 20_000;

// What: a 6-character private room code.
// Why: the room is invite-only. A short code is the whole join flow. No accounts.
export function makeRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

// The room owns who is here and how to talk to them. It does not own turn
// order or scoring. That stays on Game so a lobby and a match are different objects.
export class Room {
  constructor(id, host, settings) {
    this.id = id;
    // Prefixed so a socket id can never collide with a room code inside Socket.IO's rooms.
    this.channel = `room:${id}`;
    this.hostId = host.id;
    this.settings = settings;
    this.players = new Map();
    this.players.set(host.id, host);
    this.game = null;
    this.phase = 'lobby';
    this.messages = [];
    this.io = null;
  }

  // What: keep the Socket.IO server this room broadcasts through.
  // Why: the room is created before it is wired to `io`. Attach happens on the connection.
  attach(io) {
    this.io = io;
  }

  // What: send one event to everyone currently in the room.
  emit(event, payload) {
    this.io?.to(this.channel).emit(event, payload);
  }

  // What: broadcast, but skip one socket.
  // Why: the drawer already painted the stroke locally. Echoing it back would
  // draw the same line twice. If we do not know their socket, fall back to everyone.
  emitExcept(socketId, event, payload) {
    if (!socketId) {
      this.emit(event, payload);
      return;
    }
    this.io?.to(this.channel).except(socketId).emit(event, payload);
  }

  // What: send a private event to one socket.
  // Why: the secret word and the word choices must not ride on a room broadcast.
  emitTo(socketId, event, payload) {
    if (socketId) this.io?.to(socketId).emit(event, payload);
  }

  // What: the roster clients can render. Order is join order.
  playerList() {
    return [...this.players.values()].map((player) => player.toPublic());
  }

  // What: one payload for every roster change (ready, score, host, settings, disconnect).
  // Why: the client should not have to merge five different events to draw the sidebar.
  rosterPayload() {
    return {
      players: this.playerList(),
      hostId: this.hostId,
      settings: this.settings,
      phase: this.phase,
    };
  }

  // What: push the latest roster to every socket in the room.
  broadcastRoster() {
    this.emit('room_update', this.rosterPayload());
    this.onChange?.();
  }

  // What: the fields a stranger on the home screen is allowed to see.
  // Why: Browse should not print the room code. Join still sends the id on the socket.
  toBrowse() {
    const host = this.players.get(this.hostId);
    return {
      roomId: this.id,
      host: host?.name || 'Host',
      playerCount: this.players.size,
      maxPlayers: this.settings.maxPlayers,
      rounds: this.settings.rounds,
    };
  }

  // What: players whose socket is up right now.
  // Why: a seat in the 20s grace window still exists, but it cannot draw or start a game.
  connectedPlayers() {
    return [...this.players.values()].filter((player) => player.connected);
  }

  // What: store a chat line and send it to the room.
  // Why: a player who refreshes should see recent chat, so we keep a short history
  // instead of only emitting and forgetting. Eighty lines is enough for one game.
  addMessage(partial) {
    const message = {
      id: randomUUID(),
      playerId: partial.playerId || null,
      playerName: partial.playerName || '',
      text: partial.text,
      system: Boolean(partial.system),
    };
    this.messages.push(message);
    if (this.messages.length > 80) this.messages.shift();
    this.emit('chat_message', message);
    return message;
  }

  // What: a normal chat line from a player, as opposed to a system line.
  addChat(player, text) {
    return this.addMessage({
      playerId: player.id,
      playerName: player.name,
      text,
    });
  }

  // What: toggle ready, but only in the lobby.
  // Why: ready is a signal for the host. It does not block start, so we do not
  // need a "everyone is ready" rule that one idle player can deadlock.
  setReady(player, ready) {
    if (this.phase !== 'lobby') {
      return { ok: false, error: 'The game has already started' };
    }
    player.ready = Boolean(ready);
    this.broadcastRoster();
    return { ok: true };
  }

  // What: replace settings while still in the lobby.
  // Why: changing draw time after a round has started would make the current
  // clock and the hint slices disagree. The socket layer clamps before calling this.
  updateSettings(input) {
    if (this.phase !== 'lobby') {
      return { ok: false, error: 'Settings can only change in the lobby' };
    }
    this.settings = input;
    this.broadcastRoster();
    return { ok: true };
  }

  // What: start a match from the players who are actually connected.
  // Why: scores are reset here so a second game in the same room does not
  // inherit the last leaderboard. Turn order is built only from connected ids.
  startGame() {
    if (this.phase !== 'lobby') {
      return { ok: false, error: 'Game already started' };
    }
    const ids = this.connectedPlayers().map((player) => player.id);
    if (ids.length < 2) {
      return { ok: false, error: 'Need at least 2 players' };
    }
    // The host pressing Start counts as the host being ready. Everyone else who is
    // connected must have pressed Ready. A disconnected seat cannot press it, so it
    // is ignored here, the same way it is ignored for the 2-player minimum.
    const waiting = this.connectedPlayers().filter(
      (player) => player.id !== this.hostId && !player.ready,
    );
    if (waiting.length > 0) {
      const names = waiting.map((player) => player.name);
      const shown = names.length > 3
        ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
        : names.join(', ');
      return { ok: false, error: `Waiting for ${shown} to be ready` };
    }
    for (const player of this.players.values()) {
      player.score = 0;
      player.ready = false;
    }
    this.game = new Game(this);
    this.game.start(ids);
    this.broadcastRoster();
    return { ok: true };
  }

  // What: host ends the results screen and returns to the same room code.
  // Why: the room should survive the match. Scores reset so the next game is clean.
  // Only gameOver is allowed, so the host cannot skip a round that is still running.
  returnToLobby() {
    if (this.phase !== 'gameOver') {
      return { ok: false, error: 'The game is still going' };
    }
    this.game?.stop();
    this.game = null;
    this.phase = 'lobby';
    for (const player of this.players.values()) {
      player.score = 0;
      player.ready = false;
    }
    this.addMessage({ system: true, text: 'Back in the lobby. Scores reset.' });
    this.broadcastRoster();
    this.emit('game_state', { phase: 'lobby' });
    return { ok: true };
  }

  // What: stop the match immediately and go back to the lobby.
  // Why: with one player left there is nobody to guess or to draw for.
  // We do not show a winner, because the game did not finish.
  abandonGame(message) {
    this.game?.stop();
    this.game = null;
    this.phase = 'lobby';
    for (const player of this.players.values()) {
      player.score = 0;
      player.ready = false;
    }
    this.addMessage({ system: true, text: message });
    this.broadcastRoster();
    this.emit('game_state', { phase: 'lobby' });
  }

  // What: accept a chat or guess line and decide which path it takes.
  // Why: outside the drawing phase there is nothing to guess, so the text is chat.
  // During choosing and drawing, Game decides. Empty text is ignored so we do not
  // broadcast blank lines. The 100-character cap keeps one message from flooding the log.
  handleText(player, text) {
    const cleaned = String(text || '').trim();
    if (!cleaned) return { ok: true };
    if (cleaned.length > 100) return { ok: false, error: 'Message is too long' };
    if (!this.game || this.phase === 'lobby' || this.phase === 'roundEnd' || this.phase === 'gameOver') {
      this.addChat(player, cleaned);
      return { ok: true };
    }
    return this.game.handleText(player, cleaned);
  }

  // What: mark the seat disconnected and start the 20s removal timer.
  // Why: a refresh disconnects the old socket before the new one connects.
  // Removing immediately would wipe their score. If they are the drawer, Game pauses the clock.
  disconnect(player) {
    if (!player || player.socketId == null && !player.connected) return;
    player.connected = false;
    player.socketId = null;
    clearTimeout(player.disconnectTimer);
    this.broadcastRoster();
    this.game?.onDrawerDisconnect(player.id);
    player.disconnectTimer = setTimeout(() => {
      this.removePlayer(player.id);
    }, GRACE_MS);
  }

  // What: put a returning player back on this socket and cancel removal.
  // Why: the player id and score stay. Only the socket id changes. The previous
  // socket id is returned so the caller can kick a second tab off this seat.
  reclaim(player, socket) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
    const previousSocketId = player.socketId;
    player.socketId = socket.id;
    player.connected = true;
    this.game?.onDrawerReconnect(player.id);
    return previousSocketId;
  }

  // What: delete the seat for good. This is an explicit leave, or the grace timer firing.
  // Why: an empty room is removed from the map. If the host was removed, the next
  // player in join order becomes host so someone can still start or return to the lobby.
  // Game is told after the delete so it sees the roster that remains.
  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    clearTimeout(player.disconnectTimer);
    const name = player.name;
    this.players.delete(playerId);

    if (this.players.size === 0) {
      this.game?.stop();
      this.game = null;
      this.onEmpty?.();
      return { deleted: true };
    }

    if (this.hostId === playerId) {
      this.hostId = this.players.values().next().value.id;
    }

    this.addMessage({ system: true, text: `${name} left` });
    this.game?.onPlayerRemoved(playerId);
    this.emit('player_left', {
      playerId,
      players: this.playerList(),
      hostId: this.hostId,
    });
    this.broadcastRoster();
    return { deleted: false };
  }
}

// What: a new seat with a random id.
// Why: the id is what sessionStorage stores. It must not be the socket id,
// because the socket id changes on every reconnect.
export function createPlayer(name, socketId) {
  return new Player({ id: randomUUID(), name, socketId });
}
