import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signalThreshold } from './judge-record';
import { completionStatus } from './completion';
import type { ProofmarksFinding } from './types';
const f: ProofmarksFinding = {
  id: 'J01',
  rule: 'three',
  match: 'a, b, c',
  severity: 'warning',
  note: 'Consider breaking the rhythm.',
};
test('record uses optional signal threshold or broad-check default', () => {
  assert.equal(signalThreshold({}), 0.6);
  assert.equal(signalThreshold({ threshold: 0.8 }), 0.8);
});
test('warnings contribute to completion like flags', () => {
  assert.equal(completionStatus([f]).complete, false);
  assert.equal(completionStatus([{ ...f, status: 'dismissed' }]).complete, true);
});
