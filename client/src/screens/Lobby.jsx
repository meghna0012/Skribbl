import { useState } from 'react';
import Chat from '../components/Chat.jsx';
import PlayerList from '../components/PlayerList.jsx';
import RoomBar from '../components/RoomBar.jsx';
import SettingsForm from '../components/SettingsForm.jsx';
import { settingsLine } from '../format.js';

// What: the waiting room. Host edits settings and starts. Everyone else sees the summary.
// Why: the code button copies the invite link. Ready is visible but does not gate start.
// That rule lives on the server. This screen only disables Start when fewer than two people are connected.
export default function Lobby({ room }) {
  const [copied, setCopied] = useState(false);
  const me = room.players.find((player) => player.id === room.playerId);

  async function copyInvite() {
    const link = `${window.location.origin}/?room=${room.roomId}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

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
          <p className="eyebrow">Private room</p>
          <h2>Share the code</h2>
          <button type="button" className="code" onClick={copyInvite}>{room.roomId}</button>
          <p className="muted">
            {copied ? 'Invite link copied.' : 'Click the code to copy an invite link.'}
          </p>
          {room.isHost ? (
            <SettingsForm settings={room.settings} onChange={room.updateSettings} />
          ) : (
            <p className="summary">{settingsLine(room.settings)}</p>
          )}
          <div className="lobby-actions">
            <button
              type="button"
              className={me?.ready ? 'primary' : 'ghost'}
              onClick={() => room.setReady(!me?.ready)}
            >
              {me?.ready ? 'Ready' : 'Not ready'}
            </button>
            {room.isHost ? (
              <button
                type="button"
                className="primary"
                disabled={room.connectedCount < 2}
                onClick={room.startGame}
              >
                Start game
              </button>
            ) : (
              <p className="muted">Waiting for the host to start.</p>
            )}
          </div>
          {room.isHost && room.connectedCount < 2 && (
            <p className="muted">Need at least 2 connected players to start.</p>
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
