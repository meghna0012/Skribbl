import { cleanName, clampSettings } from './logic/settings.js';
import { createPlayer } from './models/Room.js';
import {
  createRoom,
  findReclaim,
  getRoom,
  uniqueName,
} from './store.js';

// What: answer a client event once.
// Why: if the client passed an ack, that is the error channel for the thing they just did.
// Emitting `error` as well would toast the same failure twice. If there is no ack,
// `error` is the only way to tell them.
function reply(socket, callback, result) {
  if (typeof callback === 'function') callback(result);
  else if (result && result.ok === false) socket.emit('error', { message: result.error });
}

// What: drop chat and guesses that arrive faster than 4 per second.
// Why: drawing is already throttled by the client. Text is the event a client can
// spam to probe the secret word. 250ms is short enough that normal typing still works.
function tooFast(socket) {
  const now = Date.now();
  if (socket.data.lastText && now - socket.data.lastText < 250) return true;
  socket.data.lastText = now;
  return false;
}

// What: the room and player this socket is allowed to act as.
// Why: we require the stored socket id to match. A reconnect that has not reclaimed
// the seat, or an old tab after a new tab took over, must not keep drawing or guessing.
function actor(socket) {
  const room = getRoom(socket.data.roomId);
  if (!room) return {};
  const player = room.players.get(socket.data.playerId);
  if (!player || !player.connected || player.socketId !== socket.id) return {};
  return { room, player };
}

// What: the private snapshot sent to one player when they join or refresh.
// Why: `game.toPublic()` is safe for everyone. This adds the word only if they
// are the drawer, already guessed it, or the round is over and the word is public.
// Word choices are included only for the drawer during choosing.
function viewFor(room, player) {
  const game = room.game;
  const knowsWord = Boolean(
    game?.word
    && game.phase !== 'choosing'
    && (
      game.phase === 'roundEnd'
      || player.id === game.drawerId
      || game.guessed.has(player.id)
    ),
  );

  return {
    roomId: room.id,
    playerId: player.id,
    hostId: room.hostId,
    settings: room.settings,
    players: room.playerList(),
    phase: room.phase,
    messages: room.messages,
    game: game ? game.toPublic() : { phase: 'lobby' },
    strokes: game ? game.snapshotStrokes() : [],
    yourWord: knowsWord ? game.word : '',
    wordOptions: game && player.id === game.drawerId && game.phase === 'choosing'
      ? game.wordOptions
      : [],
    roundEnd: game?.phase === 'roundEnd' ? {
      word: game.word,
      reason: game.roundReason,
      scores: room.playerList(),
      nextDrawerId: game.peekNextDrawer(),
    } : null,
    gameOver: game?.phase === 'gameOver' ? game.finalResult : null,
  };
}

// What: put the socket in the room channel and remember who it is.
// Why: later events look up the player from `socket.data` instead of trusting a player id in the payload.
function bind(socket, room, player) {
  socket.join(room.channel);
  socket.data.roomId = room.id;
  socket.data.playerId = player.id;
}

// What: leave the current room immediately, without the 20s grace period.
// Why: create, join-elsewhere, and the Leave button are intentional. A refresh is not,
// so refresh uses `disconnect` instead. The player id is copied before it is cleared,
// or the lookup would run against null and the seat would leak.
function detach(socket) {
  const room = getRoom(socket.data.roomId);
  const playerId = socket.data.playerId;
  socket.data.roomId = null;
  socket.data.playerId = null;
  if (!room) return;
  const player = room.players.get(playerId);
  socket.leave(room.channel);
  if (player && player.socketId === socket.id) room.removePlayer(player.id);
}

// What: wire socket events to Room and Game. This file checks who may emit.
// It does not score, match words, or store strokes. Those methods live on the models.
export function attachSocket(io) {
  io.on('connection', (socket) => {
    // Leave any room this socket already joined so one connection cannot sit in two rooms.
    socket.on('create_room', (payload = {}, callback) => {
      detach(socket);
      const created = createRoom({
        hostName: payload.hostName,
        settings: payload.settings,
        socketId: socket.id,
      });
      if (created.error) {
        reply(socket, callback, { ok: false, error: created.error });
        return;
      }
      const { room, player } = created;
      room.attach(io);
      bind(socket, room, player);
      socket.emit('room_joined', viewFor(room, player));
      room.emit('player_joined', {
        player: player.toPublic(),
        players: room.playerList(),
        hostId: room.hostId,
      });
      console.log(`room ${room.id} created`);
      reply(socket, callback, { ok: true, roomId: room.id, playerId: player.id });
    });

    // Join by code. Same socket already in the seat just gets a fresh snapshot.
    // A known player id, or the only disconnected player with that name, reclaims the seat.
    // Otherwise we add a new player if the room is not full.
    socket.on('join_room', (payload = {}, callback) => {
      const room = getRoom(payload.roomId);
      if (!room) {
        reply(socket, callback, { ok: false, error: 'Room not found' });
        return;
      }
      const name = cleanName(payload.playerName);
      if (!name) {
        reply(socket, callback, { ok: false, error: 'Enter a name' });
        return;
      }

      room.attach(io);

      if (socket.data.roomId === room.id && socket.data.playerId) {
        const current = room.players.get(socket.data.playerId);
        if (current && current.socketId === socket.id) {
          socket.emit('room_joined', viewFor(room, current));
          reply(socket, callback, { ok: true, roomId: room.id, playerId: current.id });
          return;
        }
      }

      const reclaim = findReclaim(room, { playerId: payload.playerId, playerName: name });
      if (reclaim) {
        if (socket.data.roomId && socket.data.roomId !== room.id) detach(socket);
        const previousId = room.reclaim(reclaim, socket);
        // A second tab took this seat. The old tab must stop receiving the word and strokes.
        if (previousId && previousId !== socket.id) {
          const previous = io.sockets.sockets.get(previousId);
          if (previous) {
            previous.leave(room.channel);
            previous.data.roomId = null;
            previous.data.playerId = null;
            previous.emit('session_taken', { message: 'You opened this game in another tab.' });
          }
        }
        bind(socket, room, reclaim);
        socket.emit('room_joined', viewFor(room, reclaim));
        room.broadcastRoster();
        reply(socket, callback, { ok: true, roomId: room.id, playerId: reclaim.id });
        return;
      }

      if (room.players.size >= room.settings.maxPlayers) {
        reply(socket, callback, { ok: false, error: 'Room is full' });
        return;
      }

      if (socket.data.roomId) detach(socket);
      const player = createPlayer(uniqueName(room, name), socket.id);
      room.players.set(player.id, player);
      bind(socket, room, player);
      socket.emit('room_joined', viewFor(room, player));
      room.emit('player_joined', {
        player: player.toPublic(),
        players: room.playerList(),
        hostId: room.hostId,
      });
      console.log(`${player.name} joined ${room.id}`);
      reply(socket, callback, { ok: true, roomId: room.id, playerId: player.id });
    });

    socket.on('leave_room', (_payload, callback) => {
      detach(socket);
      reply(socket, callback, { ok: true });
    });

    socket.on('player_ready', (payload = {}, callback) => {
      const { room, player } = actor(socket);
      if (!player) {
        reply(socket, callback, { ok: false, error: 'You are not in a room' });
        return;
      }
      reply(socket, callback, room.setReady(player, payload.ready));
    });

    // Host only, and the values are clamped again here even if the client edited the DOM.
    socket.on('update_settings', (payload = {}, callback) => {
      const { room, player } = actor(socket);
      if (!player) {
        reply(socket, callback, { ok: false, error: 'You are not in a room' });
        return;
      }
      if (player.id !== room.hostId) {
        reply(socket, callback, { ok: false, error: 'Only the host can change settings' });
        return;
      }
      reply(socket, callback, room.updateSettings(clampSettings({ ...room.settings, ...payload })));
    });

    // Host only. The room itself still requires two connected players.
    socket.on('start_game', (_payload, callback) => {
      const { room, player } = actor(socket);
      if (!player) {
        reply(socket, callback, { ok: false, error: 'You are not in a room' });
        return;
      }
      if (player.id !== room.hostId) {
        reply(socket, callback, { ok: false, error: 'Only the host can start' });
        return;
      }
      reply(socket, callback, room.startGame());
    });

    socket.on('return_lobby', (_payload, callback) => {
      const { room, player } = actor(socket);
      if (!player) {
        reply(socket, callback, { ok: false, error: 'You are not in a room' });
        return;
      }
      if (player.id !== room.hostId) {
        reply(socket, callback, { ok: false, error: 'Only the host can do that' });
        return;
      }
      reply(socket, callback, room.returnToLobby());
    });

    // Only the current drawer may choose, and only from the options Game already dealt them.
    socket.on('word_chosen', (payload = {}, callback) => {
      const { room, player } = actor(socket);
      if (!player || !room.game) {
        reply(socket, callback, { ok: false, error: 'You are not in a game' });
        return;
      }
      if (player.id !== room.game.drawerId) {
        reply(socket, callback, { ok: false, error: 'Only the drawer can choose' });
        return;
      }
      reply(socket, callback, room.game.chooseWord(payload.word));
    });

    // Draw events have no ack. Game silently ignores them unless this socket is the drawer.
    // An ack on every move would add a round trip to a stream that is already throttled.
    socket.on('draw_start', (payload) => {
      const { room, player } = actor(socket);
      room?.game?.startStroke(player, payload);
    });

    socket.on('draw_move', (payload) => {
      const { room, player } = actor(socket);
      room?.game?.addPoint(player, payload);
    });

    socket.on('draw_end', () => {
      const { room, player } = actor(socket);
      room?.game?.endStroke(player);
    });

    socket.on('draw_undo', () => {
      const { room, player } = actor(socket);
      room?.game?.undo(player);
    });

    socket.on('canvas_clear', () => {
      const { room, player } = actor(socket);
      room?.game?.clearCanvas(player);
    });

    // Both event names hit the same judge. A client that emits `chat` during drawing
    // still cannot smuggle a correct guess past scoring, or a wrong path past the word check.
    function onText(payload = {}, callback) {
      const { room, player } = actor(socket);
      if (!player) {
        reply(socket, callback, { ok: false, error: 'You are not in a room' });
        return;
      }
      if (tooFast(socket)) {
        reply(socket, callback, { ok: false, error: 'Slow down a little' });
        return;
      }
      reply(socket, callback, room.handleText(player, payload.text));
    }

    socket.on('guess', onText);
    socket.on('chat', onText);

    // Ignore the disconnect if this socket is no longer the one that owns the seat.
    // That happens when a new tab already reclaimed the player and the old tab closes.
    socket.on('disconnect', () => {
      const room = getRoom(socket.data.roomId);
      const player = room?.players.get(socket.data.playerId);
      if (!room || !player || player.socketId !== socket.id) return;
      room.disconnect(player);
    });
  });
}
