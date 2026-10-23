const SWATCH = ['#0f766e', '#b45309', '#1d4ed8', '#be123c', '#6d28d9', '#047857', '#c2410c', '#0369a1'];

// A stable color from the player id, so the same person keeps the same dot after a refresh.
// This is not an avatar system. It is only so the list is readable.
export function colorFor(id = '') {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SWATCH[hash % SWATCH.length];
}

// Display the server's remaining seconds as m:ss. We do not tick this locally.
export function formatTime(seconds = 0) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

// The summary guests see. Hosts get the form instead. Zero hints is said as "no hints"
// so it does not look like a missing setting.
export function settingsLine(settings) {
  if (!settings) return '';
  const hints = settings.hints === 0
    ? 'no hints'
    : `${settings.hints} hint${settings.hints === 1 ? '' : 's'}`;
  return `${settings.rounds} rounds · ${settings.drawTime}s · ${settings.wordCount} word choices · ${hints} · up to ${settings.maxPlayers} players`;
}

// One winner gets a name. If the whole table shares the top score, say it is a tie
// instead of listing every name. A partial tie still names the people who tied.
export function winnerTitle(result) {
  const winners = result?.winners || [];
  if (winners.length === 0) return 'Game over';
  if (winners.length === 1) return `${winners[0].name} wins`;
  if (result.leaderboard && winners.length === result.leaderboard.length) return "It's a tie";
  if (winners.length === 2) return `${winners[0].name} and ${winners[1].name} tie`;
  const names = winners.map((player) => player.name);
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)} tie`;
}

// The server sends a reason string. The overlay turns it into a sentence.
// Unknown reasons fall through to "time's up", which is the common ending.
export function roundSubtitle(reason) {
  if (reason === 'all_guessed') return 'Everyone got it';
  if (reason === 'drawer_left') return 'The drawer left';
  return "Time's up";
}
