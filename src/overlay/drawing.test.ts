import test from 'node:test';
import assert from 'node:assert/strict';
import { markPadding, ellipsePath, findingSeed } from './drawing';
test('flat oval clears end glyphs by 6–10px without entering neighboring lines', () => {
  for (const w of [20, 35, 330, 660, 1000])
    for (const gap of [0, 2, 4, 8, 16]) {
      const p = markPadding(w, 24, 'circle', gap);
      assert.ok(p.x >= 6 && p.x <= 10);
      assert.ok(p.y <= gap / 2);
      assert.ok(p.y <= 2);
    }
  assert.ok(markPadding(660, 24, 'circle').x > markPadding(35, 24, 'circle').x);
  assert.deepEqual(markPadding(660, 24, 'box'), { x: 6, y: 6 });
  const d = ellipsePath(600, 24, 4);
  assert.ok(d.startsWith('M 0 -1 C'));
  assert.ok(d.endsWith('0 -1 Z'));
  // A cubic shoulder's extremum is 3/4 of its equal control-point offset.
  assert.equal(((markPadding(600, 24, 'circle').x * 4) / 3) * 0.75, 10);
  assert.equal(findingSeed('J01:0:circle'), findingSeed('J01:0:circle'));
});
