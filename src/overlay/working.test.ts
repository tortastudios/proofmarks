import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handwritingTimes } from './working';
import { rewriteState } from './agents';
import { mockAgents } from './fixtures/agents';
import type { ProofmarksFinding } from './types';

test('only active requests animate; proposals, failures, cancellation and stalled delivery stop immediately', () => {
  const now = Date.now(),
    agents = mockAgents();
  const finding: ProofmarksFinding = {
    id: 'working',
    rule: 'r',
    match: 'Original',
    rewriteRequest: { status: 'pending', target: 'mock-claude', requestedAt: new Date(now).toISOString() },
  };
  assert.equal(rewriteState(finding, agents, now).working, 'sent');
  assert.equal(
    rewriteState({ ...finding, rewriteRequest: { ...finding.rewriteRequest!, status: 'claimed' } }, agents, now)
      .working,
    'writing',
  );
  assert.equal(
    rewriteState(
      { ...finding, rewriteRequest: { ...finding.rewriteRequest!, target: 'headless:claude' } },
      agents,
      now + 60_000,
    ).working,
    'sent',
  );
  assert.equal(rewriteState(finding, agents, now + 30_000).working, undefined);
  assert.equal(rewriteState(finding, agents, now, 'Failed').working, undefined);
  for (const error of ['Failed', 'Cancelled'])
    assert.equal(
      rewriteState({ ...finding, rewriteRequest: { status: 'failed', error } }, agents, now).working,
      undefined,
    );
  assert.equal(rewriteState({ ...finding, proposed: 'Proposal' }, agents, now).working, undefined);
  assert.equal(rewriteState({ ...finding, status: 'accepted' }, agents, now).working, undefined);
});

test('handwriting varies glyph intervals and completes even long labels within 1.2 seconds', () => {
  const times = handwritingTimes(21);
  assert.equal(times[0], 0);
  const intervals = times.slice(1).map((t, i) => t - times[i]!);
  assert.ok(intervals.every(t => t >= 30 && t <= 45));
  assert.ok(new Set(intervals).size > 1);
  assert.ok(handwritingTimes(200).at(-1)! + 80 <= 1200);
  assert.ok(handwritingTimes(200, 150).at(-1)! + 80 + 150 <= 1200);
});
