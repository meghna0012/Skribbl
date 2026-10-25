import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Room, createPlayer } from '../src/models/Room.js';
import { clampSettings } from '../src/logic/settings.js';

function lobby(extra = 2) {
  const host = createPlayer('Ada', 's0');
  const room = new Room('ROOM01', host, clampSettings({}));
  const others = [];
  for (let i = 1; i <= extra; i += 1) {
    const player = createPlayer(`P${i}`, `s${i}`);
    room.players.set(player.id, player);
    others.push(player);
  }
  return { room, host, others };
}

test('host cannot start while a connected player is not ready', () => {
  const { room, others } = lobby(2);
  others[0].ready = true;
  const result = room.startGame();
  assert.equal(result.ok, false);
  assert.match(result.error, /Waiting for P2 to be ready/);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.game, null);
});

test('a disconnected, not-ready seat does not block the start', () => {
  const { room, others } = lobby(2);
  others[0].ready = true;
  others[1].connected = false;
  const result = room.startGame();
  assert.equal(result.ok, true);
  room.game.stop();
});

test('the host does not need to press Ready', () => {
  const { room, host, others } = lobby(1);
  others[0].ready = true;
  assert.equal(host.ready, false);
  const result = room.startGame();
  assert.equal(result.ok, true);
  room.game.stop();
});

test('the error names at most three players', () => {
  const { room } = lobby(6);
  const result = room.startGame();
  assert.equal(result.ok, false);
  assert.match(result.error, /P1, P2, P3 and 3 more/);
});
