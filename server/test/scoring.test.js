import assert from 'node:assert/strict';
import test from 'node:test';
import { drawerPoints, guesserPoints } from '../src/logic/scoring.js';

// The numbers below are the ones we recite: 500 at full time, minus 25 per
// earlier guess, never under 50, and 50 to the drawer per correct guess.
test('a first guess with the full clock is worth 500', () => {
  assert.equal(guesserPoints({ timeLeft: 80, drawTime: 80, earlierCorrect: 0 }), 500);
});

test('points fall with the clock and with earlier correct guesses', () => {
  assert.equal(guesserPoints({ timeLeft: 40, drawTime: 80, earlierCorrect: 1 }), 275);
  assert.equal(guesserPoints({ timeLeft: 0, drawTime: 80, earlierCorrect: 0 }), 100);
});

test('guesser points never drop below 50', () => {
  assert.equal(guesserPoints({ timeLeft: 80, drawTime: 80, earlierCorrect: 20 }), 50);
  assert.equal(guesserPoints({ timeLeft: 0, drawTime: 0, earlierCorrect: 0 }), 100);
});

test('the drawer earns 50 points for each player who guessed', () => {
  assert.equal(drawerPoints(0), 0);
  assert.equal(drawerPoints(3), 150);
});
