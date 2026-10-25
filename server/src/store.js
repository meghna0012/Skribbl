import { randomInt } from 'node:crypto';
import { clampSettings, cleanName } from './logic/settings.js';
import { createPlayer, makeRoomCode, Room } from './models/Room.js';

// Rooms die with the process. A Map is the whole database: lookup by code is O(1),
// and there is nothing to persist after the last player leaves.
const rooms = new Map();
const BROWSE_LIMIT = 10;
let onRoomsChanged = () => {};

// What: let the socket layer push a fresh browse list after any roster change.
export function setRoomsChangedListener(fn) {
  onRoomsChanged = typeof fn === 'function' ? fn : () => {};
}

function notifyRoomsChanged() {
  onRoomsChanged();
}

// What: find a room from a code the user typed.
// Why: codes are generated in uppercase. Lowercasing the lookup means "ab12cd" still joins.
export function getRoom(id) {
  return rooms.get(String(id || '').trim().toUpperCase()) || null;
}

// What: keep generating until the code is unused.
// Why: six characters from a 32-letter alphabet almost never collide, but a collision
// would make two hosts share a room. The loop is the cheap guard.
function uniqueCode() {
  let code = makeRoomCode();
  while (rooms.has(code)) code = makeRoomCode();
  return code;
}

// What: keep two players from having the same display name.
// Why: chat lines are "Ada: hello". A duplicate name makes guesses ambiguous.
// We suffix " 2", " 3", ... instead of rejecting the join.
export function uniqueName(room, rawName, exceptId) {
  const base = cleanName(rawName);
  const taken = new Set(
    [...room.players.values()]
      .filter((player) => player.id !== exceptId)
      .map((player) => player.name.toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let suffix = 2; suffix < 50; suffix += 1) {
    const next = `${base.slice(0, 13)} ${suffix}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  return `${base.slice(0, 10)} ${randomInt(100, 999)}`;
}

// What: create the room, the host player, and register cleanup for when it empties.
// Why: the host is just the first player. Settings are clamped here so every later
// read can trust `room.settings` without checking ranges again.
export function createRoom({ hostName, settings, socketId }) {
  const name = cleanName(hostName);
  if (!name) return { error: 'Enter a name' };
  const id = uniqueCode();
  const player = createPlayer(name, socketId);
  const room = new Room(id, player, clampSettings(settings));
  room.onChange = notifyRoomsChanged;
  room.onEmpty = () => {
    rooms.delete(id);
    notifyRoomsChanged();
  };
  rooms.set(id, room);
  notifyRoomsChanged();
  return { room, player };
}

// What: up to 10 listed rooms a home-screen client can join.
// Why: rooms are invite-code rooms, not a public matchmaking pool. Hosts can
// uncheck "List in Browse" to stay code-only. Full rooms waste a slot.
export function listBrowsableRooms() {
  const listed = [];
  for (const room of rooms.values()) {
    if (room.settings.listed === false) continue;
    if (room.players.size >= room.settings.maxPlayers) continue;
    listed.push(room.toBrowse());
  }
  return listed.slice(-BROWSE_LIMIT).reverse();
}

// What: drop a room from the map.
// Why: exposed for callers that already decided the room is gone. The normal
// path is `room.onEmpty`, set in createRoom, so the map does not keep empty rooms.
export function deleteRoom(id) {
  rooms.delete(id);
}

// What: find the seat a reconnecting player should take back.
// Why: a refresh gets a new socket id. The player id in sessionStorage is the
// stable key. If that is missing, one disconnected player with the same name
// is good enough. Two disconnected "Ada"s are not, because we would guess wrong.
export function findReclaim(room, { playerId, playerName }) {
  const name = cleanName(playerName).toLowerCase();
  if (playerId && room.players.has(playerId)) {
    const player = room.players.get(playerId);
    if (player.name.toLowerCase() === name) return player;
  }
  const matches = [...room.players.values()].filter(
    (player) => !player.connected && player.name.toLowerCase() === name,
  );
  return matches.length === 1 ? matches[0] : null;
}

// What: how many rooms are alive. Useful while debugging a leak. Not used by the game.
export function roomCount() {
  return rooms.size;
}

export function clearRooms() {
  rooms.clear();
}
