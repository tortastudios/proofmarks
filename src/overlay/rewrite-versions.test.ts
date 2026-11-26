import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteVersions, nextVersion, waitingVersion } from '../versions';
import { versionSlots, selectedSlot, rewriteQueue, stepQueue, acceptsAll, acceptAllStatus } from './rewrite-versions';
import { rewriteState } from './agents';
import { proofShortcut } from './shortcuts';
import type { ProofmarksFinding } from './types';
const base: ProofmarksFinding = { id: 'F', rule: 'r', match: 'Original.' };
const two: ProofmarksFinding = {
  ...base,
  proposed: 'Second.',
  proposals: [
    { version: 1, text: 'First.' },
    { version: 2, text: 'Second.' },
  ],
  rewriteRequest: { status: 'proposed', version: 2 },
};
test('a review saved before versions reads its one proposal as version 1', () => {
  assert.deepEqual(rewriteVersions(base), []);
  assert.equal(nextVersion(base), 1);
  assert.deepEqual(
    rewriteVersions({
      ...base,
      proposed: 'Only.',
      rewriteRequest: { status: 'proposed', by: 'agent', stillFlagged: true },
    }),
    [{ version: 1, text: 'Only.', by: 'agent', stillFlagged: true }],
  );
  assert.equal(nextVersion(two), 3);
  assert.equal(waitingVersion(two), undefined);
  assert.equal(waitingVersion({ ...two, rewriteRequest: { status: 'claimed', version: 3 } }), 3);
});
test('the card keeps the reader on their version: arrivals fill the owed slot, a cancelled slot falls back', () => {
  const writing = { ...two, rewriteRequest: { status: 'pending' as const, version: 3 } };
  const slots = versionSlots(writing, true);
  assert.deepEqual(
    slots.map(s => [s.version, !!s.rewrite]),
    [
      [1, true],
      [2, true],
      [3, false],
    ],
  );
  assert.equal(selectedSlot(slots, 3)?.version, 3);
  assert.equal(selectedSlot(slots, 1)?.version, 1);
  assert.equal(
    selectedSlot(slots, undefined, 'First.')?.version,
    1,
    'without a choice, the current rewrite (restored by Undo)',
  );
  assert.equal(selectedSlot(slots)?.version, 2, 'otherwise the newest rewrite, never the empty slot');
  assert.equal(selectedSlot(versionSlots(two, false), 3)?.version, 2, 'a cancelled request leaves the latest version');
  assert.deepEqual(versionSlots(base, true), [], 'the first rewrite has no versions to step');
});
test('another request is waiting on its own slot; a cancelled one is no failure to show', () => {
  const waiting = rewriteState({
    ...two,
    rewriteRequest: { status: 'claimed', version: 3, target: 'headless:claude' },
  });
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.working, 'writing');
  assert.equal(
    rewriteState({ ...two, rewriteRequest: { status: 'failed', version: 3, error: 'Cancelled' } }).message,
    '',
  );
  const failed = rewriteState({
    ...two,
    rewriteRequest: { status: 'failed', version: 3, error: 'The agent gave up.' },
  });
  assert.equal(failed.retry, true);
  assert.equal(failed.message, 'The agent gave up.');
  assert.equal(rewriteState(two).waiting, false);
  assert.equal(rewriteState(two).message, '');
});
test('the queue holds open proofs with rewrites to decide, steps in reading order, and wraps', () => {
  const findings: ProofmarksFinding[] = [
    { ...base, id: 'A', proposed: 'a' },
    { ...base, id: 'B', rewriteRequest: { status: 'pending' } },
    { ...base, id: 'C', proposed: 'c', status: 'accepted' },
    { ...base, id: 'D', proposed: 'd' },
    { ...base, id: 'E' },
  ];
  const q = rewriteQueue(findings);
  assert.deepEqual(
    [q.ready, q.writing, q.missing].map(list => list.map(f => f.id)),
    [['A', 'D'], ['B'], ['E']],
  );
  const ready = new Set(q.ready.map(f => f.id));
  assert.equal(stepQueue(findings, ready, 'B', 1)?.id, 'D');
  assert.equal(stepQueue(findings, ready, 'B', -1)?.id, 'A');
  assert.equal(stepQueue(findings, ready, 'D', 1)?.id, 'A');
  assert.equal(stepQueue(findings, new Set(), 'A', 1), undefined);
});
test('[ and ] step versions only on an open card; R stays unbound', () => {
  const key = (k: string) => ({
    key: k,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    repeat: false,
  });
  const card = { editable: false, card: true, pill: false, help: false, badgeExpanded: false };
  assert.equal(proofShortcut(key('r'), card), undefined);
  assert.equal(proofShortcut(key('['), card), 'previous-version');
  assert.equal(proofShortcut(key(']'), card), 'next-version');
  assert.equal(proofShortcut(key(']'), { ...card, card: false }), undefined);
  assert.equal(proofShortcut(key('['), { ...card, editable: true }), undefined);
});

test('Accept all takes open proofs whose rewrite on screen cleared, and leaves the rest', () => {
  const ready: ProofmarksFinding = {
    id: 'A',
    rule: 'contrast',
    match: 'x',
    proposed: 'Clear.',
    proposals: [{ version: 1, text: 'Clear.' }],
  };
  const slot = (f: ProofmarksFinding) => selectedSlot(versionSlots(f, false), undefined, f.proposed);
  assert.equal(acceptsAll(ready, 'Clear.', slot(ready)), true);
  assert.equal(acceptsAll(ready, '', slot(ready)), true, 'an empty deletion is a rewrite too');
  const flagged = { ...ready, proposals: [{ version: 1, text: 'Clear.', stillFlagged: true }] };
  assert.equal(acceptsAll(flagged, 'Clear.', slot(flagged)), false);
  assert.equal(acceptsAll({ ...ready, status: 'accepted' }, 'Clear.', slot(ready)), false);
  assert.equal(acceptsAll({ ...ready, actionReason: 'Crosses markup.' }, 'Clear.', slot(ready)), false);
  assert.equal(acceptsAll(ready, undefined, slot(ready)), false, 'nothing on screen while the next version is written');
});

test("Accept all's line says what's ready, what's left, then how far the run is", () => {
  assert.equal(acceptAllStatus(4, 1), '4 rewrites ready, and 1 to check yourself.');
  assert.equal(acceptAllStatus(1, 0), '1 rewrite ready.');
  assert.equal(acceptAllStatus(4, 1, { done: 0, total: 4 }), 'Accepting 1 of 4…');
  assert.equal(acceptAllStatus(4, 1, { done: 4, total: 4 }), 'Accepting 4 of 4…');
});
