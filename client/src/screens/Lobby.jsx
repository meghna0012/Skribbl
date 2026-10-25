import { useState } from 'react';
import Chat from '../components/Chat.jsx';
import PlayerList from '../components/PlayerList.jsx';
import RoomBar from '../components/RoomBar.jsx';
import SettingsForm from '../components/SettingsForm.jsx';
import { settingsLine } from '../format.js';

// What: the waiting room. Host edits settings and starts. Everyone else sees the summary.
// Why: the code and the invite link have their own copy buttons. Start waits for Ready.
// That rule lives on the server. This screen only disables Start when fewer than two people are connected.
export default function Lobby({ room }) {
  // Which copy button was just used: 'code', 'link', 'failed', or '' for none.
  const [copied, setCopied] = useState('');
  const me = room.players.find((player) => player.id === room.playerId);
  // Same rule as the server: the host counts as ready, every other connected player must be.
  const waitingFor = room.players.filter(
    (player) => player.connected && player.id !== room.hostId && !player.ready,
  );
  const canStart = room.connectedCount >= 2 && waitingFor.length === 0;

  // What: copy either the bare room code or the full invite link.
  // Why: the code is for reading out loud or typing into Join. The link opens straight
  // into the Join tab with the code filled in. They are different things to paste.
  // The clipboard API can be refused (no permission, or a non-secure page), so a failure
  // says so instead of leaving the user thinking it worked.
  async function copy(kind) {
    const text = kind === 'code'
      ? room.roomId
      : `${window.location.origin}/?room=${room.roomId}`;
    let result = kind;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      result = 'failed';
    }
    setCopied(result);
    window.setTimeout(() => setCopied(''), 1800);
  }

  const copyMessage = {
    code: 'Room code copied.',
    link: 'Invite link copied.',
    failed: 'Could not copy. Select the code and copy it by hand.',
  }[copied];

  return (
    <div className="shell">
      <RoomBar roomId={room.roomId} onLeave={room.leaveRoom}>
        <span>{room.players.length} in the room</span>
      </RoomBar>
      <div className="stage">
        <PlayerList
          players={room.players}
          playerId={room.playerId}
          hostId={room.hostId}
          phase="lobby"
        />
        <section className="panel lobby-main">
          <p className="eyebrow">{room.settings?.listed === false ? 'Private room' : 'Open room'}</p>
          <div className="code" aria-label={`Room code ${room.roomId}`}>{room.roomId}</div>
          <div className="copy-row">
            <button type="button" className="ghost" onClick={() => copy('code')}>
              {copied === 'code' ? 'Copied ✓' : 'Copy code'}
            </button>
            <button type="button" className="ghost" onClick={() => copy('link')}>
              {copied === 'link' ? 'Copied ✓' : 'Copy link'}
            </button>
          </div>
          <p className="muted" role="status">{copyMessage}</p>
          {room.isHost ? (
            <SettingsForm settings={room.settings} onChange={room.updateSettings} />
          ) : (
            <p className="summary">{settingsLine(room.settings)}</p>
          )}
          <div className="lobby-actions">
            {/* The host starts the game, which is their "ready", so they get no Ready button. */}
            {!room.isHost && (
              /* The label is the action the click performs, not the current state.
                 The state is already shown as "ready" next to your name in the player list. */
              <button
                type="button"
                className={me?.ready ? 'ghost' : 'primary'}
                onClick={() => room.setReady(!me?.ready)}
              >
                {me?.ready ? 'Not ready' : 'Ready'}
              </button>
            )}
            {room.isHost ? (
              <button
                type="button"
                className="primary"
                disabled={!canStart}
                onClick={room.startGame}
              >
                Start game
              </button>
            ) : (
              <p className="muted">
                {me?.ready ? 'Waiting for the host to start.' : 'Press Ready when you are set.'}
              </p>
            )}
          </div>
          {room.isHost && room.connectedCount < 2 && (
            <p className="muted">Need at least 2 connected players to start.</p>
          )}
          {room.isHost && room.connectedCount >= 2 && waitingFor.length > 0 && (
            <p className="muted">
              Waiting for {waitingFor.map((player) => player.name).join(', ')} to be ready.
            </p>
          )}
        </section>
        <Chat
          messages={room.messages}
          onSend={room.sendText}
          placeholder="Say something"
        />
      </div>
    </div>
  );
}
