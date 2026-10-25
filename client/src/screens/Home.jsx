import { useState } from 'react';
import SettingsForm from '../components/SettingsForm.jsx';
import { DEFAULT_SETTINGS } from '../constants.js';
import { loadSession } from '../hooks/useRoom.js';

// What: name, then either create a room or join one by code.
// Why: an invite URL prefills the code and opens the join tab. Settings stay local
// until create, because there is no room yet for the server to store them in.
export default function Home({ room }) {
  const [name, setName] = useState(() => loadSession()?.name || '');
  const [code, setCode] = useState(() => (
    new URLSearchParams(window.location.search).get('room') || ''
  ).toUpperCase());
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [mode, setMode] = useState(code ? 'join' : 'create');

  function create(event) {
    event.preventDefault();
    if (!name.trim()) return;
    room.createRoom(name.trim(), settings);
  }

  function join(event) {
    event.preventDefault();
    if (!name.trim() || code.length < 4) return;
    room.joinRoom(name.trim(), code);
  }

  return (
    <main className="home">
      <section className="hero">
        <p className="eyebrow">Draw and guess</p>
        <h1>Skribbl</h1>
        <p className="lede">
          One person draws. Everyone else races to name it. Rooms stay private and travel by a short code.
        </p>
      </section>
      <section className="card">
        <label>
          <span>Your name</span>
          <input
            value={name}
            maxLength={16}
            placeholder="Ada"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="tabs" role="tablist">
          <button type="button" className={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')}>
            Create
          </button>
          <button type="button" className={mode === 'join' ? 'on' : ''} onClick={() => setMode('join')}>
            Join
          </button>
        </div>
        {mode === 'create' ? (
          <form onSubmit={create}>
            <SettingsForm settings={settings} onChange={setSettings} />
            <button className="primary" type="submit" disabled={room.busy || !name.trim()}>
              {room.busy ? 'Creating…' : 'Create room'}
            </button>
          </form>
        ) : (
          <form onSubmit={join}>
            <label>
              <span>Room code</span>
              <input
                value={code}
                placeholder="AB12CD"
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
                }}
              />
            </label>
            <button className="primary" type="submit" disabled={room.busy || !name.trim() || code.length < 4}>
              {room.busy ? 'Joining…' : 'Join room'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
