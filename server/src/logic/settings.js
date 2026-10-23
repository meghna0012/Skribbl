// These bounds match the assignment. They live on the server so a modified client
// cannot invent a 1-second round or a 100-player room.
export const LIMITS = {
  maxPlayers: { min: 2, max: 20, default: 8 },
  rounds: { min: 2, max: 10, default: 3 },
  drawTime: { min: 15, max: 240, default: 80 },
  wordCount: { min: 1, max: 5, default: 3 },
  hints: { min: 0, max: 5, default: 2 },
};

// What: force every setting into its allowed range, and fill gaps with defaults.
// Why: the host form is only a convenience. The socket payload is untrusted.
export function clampSettings(input = {}) {
  const settings = {};
  for (const key of Object.keys(LIMITS)) {
    const { min, max, default: fallback } = LIMITS[key];
    const value = Number(input?.[key]);
    // Round first so "3.9" cannot sneak past the integer options in the brief.
    settings[key] = Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : fallback;
  }
  return settings;
}

// What: turn whatever the user typed into a short display name.
// Why: names are shown in chat and the player list. Empty, huge, or
// newline-stuffed names would break the layout and the chat log.
export function cleanName(input) {
  return String(input || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}
