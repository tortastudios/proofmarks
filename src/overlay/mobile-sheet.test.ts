import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetReleaseCloses } from './mobile-sheet';
test('sheet release projects downward momentum but rejects taps and upward return', () => {
  assert.equal(sheetReleaseCloses(5, 2, 400), false);
  assert.equal(sheetReleaseCloses(50, 0.3, 400), true);
  assert.equal(sheetReleaseCloses(180, 0, 400), true);
  assert.equal(sheetReleaseCloses(100, -0.3, 400), false);
  assert.equal(sheetReleaseCloses(-20, 0, 400), false);
});
