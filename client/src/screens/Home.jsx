import { useState } from 'react';
import SettingsForm, { FIELDS } from '../components/SettingsForm.jsx';
import { DEFAULT_SETTINGS } from '../constants.js';
import { loadSession } from '../hooks/useRoom.js';

// What: name, then create a room, join by code, or pick a listed room from Browse.
// Why: an invite URL prefills the code and opens the join tab. Settings stay local
// until create, because there is no room yet for the server to store them in.
export default function Home({ room }) {
  const [name, setName] = useState(() => loadSession()?.name || '');
  const [code, setCode] = useState(() => (
    new URLSearchParams(window.location.search).get('room') || ''
  ).toUpperCase());
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [mode, setMode] = useState(code ? 'join' : 'create');
  // Messages stay hidden until the first Create click, so an untouched form is not red.
  const [triedCreate, setTriedCreate] = useState(false);
  const [triedJoin, setTriedJoin] = useState(false);
  const [triedBrowse, setTriedBrowse] = useState(false);
  // The name box is shared by all three tabs. Mark it once any tab was tried without a name.
  const nameMissing = !name.trim() && (
    (mode === 'create' && triedCreate)
    || (mode === 'join' && triedJoin)
    || (mode === 'browse' && triedBrowse)
  );

  // Empty or out-of-range fields, found before anything is sent. The server clamps too,
  // but silently turning a blank "Rounds" into 2 would hide the mistake from the host.
  const problems = [];
  const invalidKeys = [];
  if (!name.trim()) problems.push('Enter your name.');
  for (const [key, label, min, max] of FIELDS) {
    const value = settings[key];
    const ok = value !== '' && Number.isInteger(value) && value >= min && value <= max;
    if (!ok) {
      invalidKeys.push(key);
      problems.push(
        value === ''
          ? `${label} is empty. Enter a number from ${min} to ${max}.`
          : `${label} must be a whole number from ${min} to ${max}.`,
      );
    }
  }

  function create(event) {
    event.preventDefault();
    setTriedCreate(true);
    if (problems.length > 0) return;
    room.createRoom(name.trim(), settings);
  }

  // Room codes are always 6 characters, so a shorter one can never match a room.
  const joinProblems = [];
  if (!name.trim()) joinProblems.push('Enter your name.');
  if (code.length === 0) joinProblems.push('Enter a room code.');
  else if (code.length < 6) joinProblems.push('Room codes are 6 characters. Check the code and try again.');

  function join(event) {
    event.preventDefault();
    setTriedJoin(true);
    if (joinProblems.length > 0) return;
    room.joinRoom(name.trim(), code);
  }

  return (
    <main className="home">
      <section className="hero">
        <p className="eyebrow">Draw and guess</p>
        <h1>Skribbl</h1>
        <p className="lede">
          One person draws. Everyone else races to name it. Create a room, join with a code, or pick an open room from Browse.
        </p>
      </section>
      <section className="card">
        <label>
          <span>Your name</span>
          <input
            value={name}
            maxLength={16}
            placeholder="Ada"
            className={nameMissing ? 'invalid' : undefined}
            aria-invalid={nameMissing ? true : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="tabs" role="tablist">
          {/* The tab you are already on is hidden: clicking it would do nothing. */}
          {mode !== 'create' && (
            <button type="button" onClick={() => setMode('create')}>
              Create
            </button>
          )}
          {mode !== 'join' && (
            <button type="button" onClick={() => setMode('join')}>
              Join Via Code
            </button>
          )}
          {mode !== 'browse' && (<button
            type="button"
            onClick={() => {
              setMode('browse');
              room.refreshBrowse();
            }}
          >
            Browse rooms
          </button>)}
        </div>
        {mode === 'create' ? (
          <form onSubmit={create} noValidate>
            <SettingsForm
              settings={settings}
              onChange={setSettings}
              invalid={triedCreate ? invalidKeys : []}
            />
            {triedCreate && problems.length > 0 && (
              <ul className="form-error" role="alert">
                {problems.map((message) => <li key={message}>{message}</li>)}
              </ul>
            )}
            <button className="primary submit-btn" type="submit" disabled={room.busy}>
              {room.busy ? 'Creating…' : 'Create room'}
            </button>
          </form>
        ) : mode === 'join' ? (
          <form onSubmit={join} noValidate>
            <label>
              <span>Room code</span>
              <input
                value={code}
                placeholder="AB12CD"
                className={triedJoin && code.length < 6 ? 'invalid' : undefined}
                aria-invalid={triedJoin && code.length < 6 ? true : undefined}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
                }}
              />
            </label>
            {triedJoin && joinProblems.length > 0 && (
              <ul className="form-error" role="alert">
                {joinProblems.map((message) => <li key={message}>{message}</li>)}
              </ul>
            )}
            <button className="primary submit-btn" type="submit" disabled={room.busy}>
              {room.busy ? 'Joining…' : 'Join room'}
            </button>
          </form>
        ) : (
          <div className="browse">
            {triedBrowse && !name.trim() && (
              <ul className="form-error" role="alert">
                <li>Enter your name above, then press Join.</li>
              </ul>
            )}
            {(room.browseRooms || []).length === 0 ? (
              <p className="muted">No open rooms right now. Create one, or join with a code.</p>
            ) : (
              <ul className="browse-list">
                <li className="browse-head">
                  <span>Host</span>
                  <span>Players</span>
                  <span>Rounds</span>
                  <span />
                </li>
                {room.browseRooms.map((row) => (
                  <li key={row.roomId}>
                    <span>{row.host}</span>
                    <span>{row.playerCount}/{row.maxPlayers}</span>
                    <span>{row.rounds}</span>
                    <button
                      type="button"
                      className="primary"
                      disabled={room.busy}
                      onClick={() => {
                        setTriedBrowse(true);
                        if (!name.trim()) return;
                        room.joinRoom(name.trim(), row.roomId);
                      }}
                    >
                      {room.busy ? 'Joining…' : 'Join'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
