// What: points for one correct guess.
// Why: faster guesses and earlier guesses should be worth more, and the
// formula has to be short enough to explain out loud.
// First guess at full time is 500. Each earlier correct guess costs 25, floored at 50.
export function guesserPoints({ timeLeft, drawTime, earlierCorrect }) {
  // Guard the division. Settings already reject 0, but a bad caller should not produce NaN.
  const ratio = drawTime > 0 ? timeLeft / drawTime : 0;
  const base = Math.round(100 + 400 * ratio);
  return Math.max(50, base - 25 * earlierCorrect);
}

// What: the drawer's reward for this round.
// Why: the drawer did not guess, so they need a separate, obvious rule:
// 50 points for each player who got the word. Applied once, at round end.
export function drawerPoints(guessCount) {
  return 50 * guessCount;
}
