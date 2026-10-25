import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { clampSettings } from '../src/logic/settings.js';
import { clearRooms, createRoom, listBrowsableRooms } from '../src/store.js';

afterEach(() => {
  clearRooms();
});

test('new rooms are listed and not public', () => {
  const settings = clampSettings({});
  assert.equal(settings.listed, true);
  const created = createRoom({ hostName: 'Ada', settings, socketId: 's1' });
  const [row] = listBrowsableRooms();
  assert.equal(row.host, 'Ada');
  assert.equal(row.playerCount, 1);
  assert.equal(row.rounds, 3);
  assert.equal(row.maxPlayers, 8);
  assert.equal(row.roomId, created.room.id);
});

test('unlisted rooms stay off Browse', () => {
  createRoom({
    hostName: 'Bea',
    settings: { listed: false },
    socketId: 's2',
  });
  assert.equal(listBrowsableRooms().length, 0);
});

test('full rooms are omitted and the list caps at 10 newest', () => {
  for (let i = 0; i < 12; i += 1) {
    createRoom({ hostName: `Host${i}`, settings: {}, socketId: `s${i}` });
  }
  const full = createRoom({
    hostName: 'Full',
    settings: { maxPlayers: 2 },
    socketId: 'full',
  });
  full.room.players.set('p2', { id: 'p2', name: 'Other' });

  const rows = listBrowsableRooms();
  assert.equal(rows.length, 10);
  assert.equal(rows.some((row) => row.host === 'Full'), false);
  assert.equal(rows[0].host, 'Host11');
  assert.equal(rows.at(-1).host, 'Host2');
});
