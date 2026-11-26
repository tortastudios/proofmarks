import test from 'node:test';
import assert from 'node:assert/strict';
import { completionStatus, completionPlayback } from './completion';
const f = (status: 'open' | 'accepted' | 'accepted-unrecorded' | 'dismissed') => ({
  id: status,
  rule: 'test',
  match: 'test',
  status,
});
test('completion recognizes accepted and dismissed proofs with a singular accessible equivalent', () => {
  assert.equal(completionStatus([]).complete, false);
  assert.equal(completionStatus([f('open')]).complete, false);
  assert.deepEqual(completionStatus([f('accepted'), f('accepted-unrecorded'), f('dismissed')]), {
    reviewed: 3,
    complete: true,
    announcement: 'All 3 proofs reviewed',
  });
  assert.equal(completionStatus([f('dismissed')]).announcement, 'All 1 proof reviewed');
});
test('completion plays only once, reopening is still, undo resets, and reduced motion consumes silently', () => {
  const p = completionPlayback();
  assert.equal(p.consume(false), false);
  p.complete();
  assert.equal(p.consume(false), true);
  assert.equal(p.consume(false), false);
  p.complete();
  p.reset();
  assert.equal(p.consume(false), false);
  p.complete();
  assert.equal(p.consume(true), false);
  assert.equal(p.consume(false), false);
});
