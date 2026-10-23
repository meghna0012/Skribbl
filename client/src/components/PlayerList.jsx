import { colorFor } from '../format.js';

// Lobby keeps join order so the host is easy to find. During a game, score order
// is the leaderboard. "you / host / drawing / got it" are labels, not permissions.
export default function PlayerList({
  players,
  playerId,
  hostId,
  drawerId,
  guessedIds = [],
  phase,
}) {
  const rows = phase === 'lobby'
    ? players
    : [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return (
    <aside className="panel players">
      <h2>Players</h2>
      <ul>
        {rows.map((player) => {
          const detail = [
            player.id === playerId ? 'you' : '',
            player.id === hostId ? 'host' : '',
            phase !== 'lobby' && player.id === drawerId ? 'drawing' : '',
            guessedIds.includes(player.id) ? 'got it' : '',
            phase === 'lobby' && player.ready ? 'ready' : '',
            !player.connected ? 'disconnected' : '',
          ].filter(Boolean).join(' · ');
          return (
            <li key={player.id} className={player.connected ? '' : 'away'}>
              <span className="avatar" style={{ background: colorFor(player.id) }}>
                {player.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="who">
                <strong>{player.name}</strong>
                {detail && <small>{detail}</small>}
              </span>
              <b className="score">{player.score}</b>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
