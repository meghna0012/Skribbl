// What: one comparable form of a guess and of the secret word.
// Why: "  Ice   Cream " and "ice cream" are the same guess. We only normalize
// case and whitespace. Punctuation stays, so "cat!" is not "cat".
export function normalize(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// What: count the single-character edits between two strings.
// Why: "close" needs a real distance, not a substring check. Substring would
// mark "a" as close to almost every word. Two rows of dynamic programming
// are enough; words are short, so the full matrix would not be faster to read.
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[b.length];
}

// What: decide whether a message is a correct guess, a near miss, or chat.
// Why: one text box is used for both. The server, not the client, classifies it
// so a modified client cannot skip the check by emitting "chat" instead of "guess".
// correct: same word after trim, case, and collapsed spaces.
// close: one edit, or two edits when the word is longer than 6 letters.
// chat: show it as a normal message.
export function judgeGuess(guess, word) {
  const given = normalize(guess);
  const target = normalize(word);
  // Empty input is not a chat line and not a guess.
  if (!given || !target) return 'ignore';
  if (given === target) return 'correct';

  // Short words get a tighter threshold so "cat" / "dog" (distance 3) stays chat.
  const limit = target.length > 6 ? 2 : 1;
  // Skip the matrix when the lengths already prove the strings are too far apart.
  if (Math.abs(given.length - target.length) > limit) return 'chat';
  return levenshtein(given, target) <= limit ? 'close' : 'chat';
}
