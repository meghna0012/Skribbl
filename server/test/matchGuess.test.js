import assert from 'node:assert/strict';
import test from 'node:test';
import { judgeGuess, levenshtein, normalize } from '../src/logic/matchGuess.js';

// These tests lock the three outcomes a walkthrough will be asked about:
// normalized exact match, a near miss, and a normal chat line.
test('normalize trims, lowercases, and collapses spaces', () => {
  assert.equal(normalize('  Ice   Cream '), 'ice cream');
});

test('exact guesses ignore case and extra spaces', () => {
  assert.equal(judgeGuess('  Cat ', 'cat'), 'correct');
  assert.equal(judgeGuess('ICE   CREAM', 'ice cream'), 'correct');
  assert.equal(judgeGuess('apple', 'APPLE'), 'correct');
});

test('near misses are close and other words stay chat', () => {
  assert.equal(judgeGuess('cot', 'cat'), 'close');
  assert.equal(judgeGuess('elephent', 'elephant'), 'close');
  assert.equal(judgeGuess('elefhxnt', 'elephant'), 'close');
  assert.equal(judgeGuess('dog', 'cat'), 'chat');
  assert.equal(judgeGuess('', 'cat'), 'ignore');
});

test('levenshtein distance', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('cat', 'cat'), 0);
});
