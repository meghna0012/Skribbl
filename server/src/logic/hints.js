// What: how many letters should be open at this moment on the clock.
// Why: the client must not decide hints. Splitting the draw time into
// hintCount + 1 slices opens one letter at the end of each slice except the last,
// so the final slice is the end of the round rather than a free reveal.
export function hintsDue(drawTime, timeLeft, hintCount) {
  if (!hintCount || hintCount <= 0 || drawTime <= 0) return 0;
  const elapsed = drawTime - timeLeft;
  const slice = drawTime / (hintCount + 1);
  return Math.min(hintCount, Math.floor(elapsed / slice));
}

// What: a fresh "nothing revealed" list, one flag per character.
// Why: spaces are handled later in formatMask. Starting from all-false
// keeps revealOne from special-casing the first hint.
export function freshReveal(word) {
  return [...word].map(() => false);
}

// What: flip one random still-hidden letter, and return the same array if we should not.
// Why: hints should not spell the whole word before time runs out.
// Leaving the last letter closed means a 2-letter word only ever reveals one letter.
export function revealOne(word, revealed) {
  const hidden = [];
  for (let i = 0; i < word.length; i += 1) {
    // Spaces are already visible. They are not a "hint".
    if (word[i] !== ' ' && !revealed[i]) hidden.push(i);
  }
  if (hidden.length <= 1) return revealed;
  const index = hidden[Math.floor(Math.random() * hidden.length)];
  const next = revealed.slice();
  next[index] = true;
  return next;
}

// What: the string guessers are allowed to see, like "_ _ a _ _".
// Why: joining with spaces makes each blank readable. A space inside the
// word stays a space, so "ice cream" shows a visible gap from the start.
export function formatMask(word, revealed) {
  return [...word]
    .map((character, index) => {
      if (character === ' ') return ' ';
      return revealed[index] ? character : '_';
    })
    .join(' ');
}
