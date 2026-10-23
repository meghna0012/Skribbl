import { readFileSync } from 'node:fs';

// What: load the word list once, from disk, when the module loads.
// Why: a JSON file is enough for a few hundred drawable words. A database
// would add a service this game does not need, and the list does not change at runtime.
const WORDS = JSON.parse(
  readFileSync(new URL('../data/words.json', import.meta.url), 'utf8'),
);

// What: choose `count` words the drawer has not already drawn this game.
// Why: repeating "cat" every round is dull. If the fresh pool is smaller than
// the request, we fall back to the full list so a long game can still start a turn.
export function pickWords(count, used) {
  const fresh = WORDS.filter((word) => !used.has(word.toLowerCase()));
  const pool = fresh.length >= count ? fresh : WORDS.slice();
  const bag = pool.slice();
  const picked = [];
  const want = Math.max(0, count);

  // Splice a random index instead of sorting the whole list. We only need `count` words.
  while (picked.length < want && bag.length > 0) {
    const index = Math.floor(Math.random() * bag.length);
    picked.push(bag.splice(index, 1)[0]);
  }
  return picked;
}
