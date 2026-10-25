import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PALETTE, sanitizeColor } from '../src/logic/draw.js';

// The client eraser is a white stroke. If white leaves the palette the server would
// snap it to ink and the eraser would draw black lines for everyone else.
test('the eraser color (white) survives server sanitizing', () => {
  assert.ok(PALETTE.includes('#ffffff'));
  assert.equal(sanitizeColor('#FFFFFF'), '#ffffff');
});
