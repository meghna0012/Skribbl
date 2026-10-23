import { roundSubtitle, winnerTitle } from '../format.js';

// Sort a copy. The server list is join order. The overlay should read highest score first.
function ScoreList({ scores = [] }) {
  const ranked = [...scores].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return (
    <ol className="scores">
      {ranked.map((player) => (
        <li key={player.id}>
          <span>{player.name}</span>
          <b>{player.score}</b>
        </li>
      ))}
    </ol>
  );
}

// Round end and final results share one overlay so the canvas stays mounted underneath.
// Only the host can return to the lobby. Other clients would be rejected by the server anyway.
export default function RoundOverlay({ roundEnd, gameOver, players, isHost, onReturn }) {
  if (gameOver) {
    return (
      <div className="overlay final">
        <p className="eyebrow">Game over</p>
        <h2>{winnerTitle(gameOver)}</h2>
        <ScoreList scores={gameOver.leaderboard} />
        {isHost ? (
          <button type="button" className="primary" onClick={onReturn}>Back to lobby</button>
        ) : (
          <p className="muted">Waiting for the host to return to the lobby.</p>
        )}
      </div>
    );
  }

  if (!roundEnd) return null;
  const next = players.find((player) => player.id === roundEnd.nextDrawerId);

  return (
    <div className="overlay">
      <p className="eyebrow">{roundSubtitle(roundEnd.reason)}</p>
      <h2 className="reveal">{roundEnd.word || 'No word chosen'}</h2>
      <ScoreList scores={roundEnd.scores} />
      <p className="muted">{next ? `Next drawer: ${next.name}` : 'That was the last round'}</p>
    </div>
  );
}
