import test from 'node:test';
import assert from 'node:assert/strict';
import { proofSet, stepProof, orderProofs, pageAnchorReason, ProofOrder } from './proof-set';
import type { ProofmarksFinding } from './types';
const findings: ProofmarksFinding[] = [
  { id: 'meta', rule: 'r', match: 'meta', status: 'accepted', target: { kind: 'meta', field: 'description' } },
  { id: 'a', rule: 'r', match: 'a' },
  { id: 'b', rule: 'r', match: 'b', status: 'dismissed' },
  { id: 'c', rule: 'r', match: 'c' },
];
test('cycling preserves document order when a decision removes the current proof', () => {
  assert.equal(stepProof(findings, 'b', 1, 'open')?.id, 'c');
  assert.equal(stepProof(findings, 'c', 1, 'open')?.id, 'a');
  assert.equal(stepProof(findings, 'a', -1, 'open')?.id, 'c');
  assert.equal(stepProof(findings, undefined, 1, 'open')?.id, 'a');
});
test('reviewed includes unlocated metadata and dismissed proofs; empty sets terminate', () => {
  assert.deepEqual(
    proofSet(findings, 'reviewed').map(f => f.id),
    ['meta', 'b'],
  );
  assert.equal(stepProof([], undefined, 1, 'open'), undefined);
  assert.equal(
    stepProof(
      findings.map(f => ({ ...f, status: 'accepted' })),
      'a',
      1,
      'open',
    ),
    undefined,
  );
});

test('unlocated metadata sorts last in both cycles without mutating source order', () => {
  const sorted = orderProofs(findings);
  assert.deepEqual(
    sorted.map(f => f.id),
    ['a', 'b', 'c', 'meta'],
  );
  assert.deepEqual(
    findings.map(f => f.id),
    ['meta', 'a', 'b', 'c'],
  );
  assert.deepEqual(
    proofSet(sorted, 'reviewed').map(f => f.id),
    ['b', 'meta'],
  );
  assert.equal(stepProof(sorted, 'b', 1, 'reviewed')?.id, 'meta');
});

test('explicit metadata sorts last even if its sentence also appears on the page', () => {
  const meta: ProofmarksFinding = { id: 'hidden', rule: 'r', match: 'a', target: { kind: 'meta', field: 'summary' } };
  assert.deepEqual(
    orderProofs([meta, ...findings]).map(f => f.id),
    ['a', 'b', 'c', 'hidden', 'meta'],
  );
});

test('missing body anchors keep document order and show an informational reason only', () => {
  const body = findings.filter(f => !f.target);
  assert.deepEqual(
    orderProofs(body).map(f => f.id),
    ['a', 'b', 'c'],
  );
  assert.equal(pageAnchorReason(body[0]!, false), "Couldn't find this text on the page.");
  assert.equal(pageAnchorReason(body[0]!, true), undefined);
  assert.equal(pageAnchorReason(findings[0]!, false), undefined);
  assert.equal(pageAnchorReason(body[1]!, false), undefined);
  assert.equal(body[0]!.actionReason, undefined);
});

import { stepAllProofs } from './proof-set';
test('D pager retains decided proofs and wraps in document order', () => {
  const list = [
    { id: 'a', rule: 'r', match: 'a' },
    { id: 'b', rule: 'r', match: 'b', status: 'accepted' as const },
    { id: 'c', rule: 'r', match: 'c', status: 'dismissed' as const },
  ];
  assert.equal(stepAllProofs(list, 'a', 1)?.id, 'b');
  assert.equal(stepAllProofs(list, 'b', 1)?.id, 'c');
  assert.equal(stepAllProofs(list, 'c', 1)?.id, 'a');
  assert.equal(stepAllProofs(list, 'a', -1)?.id, 'c');
  assert.equal(stepAllProofs([], undefined, 1), undefined);
});

test('superseded proofs leave marks, counts, overview sets and every pager until Undo restores them', async () => {
  const { visibleProofs } = await import('./proof-set');
  const { completionStatus } = await import('./completion');
  const all: ProofmarksFinding[] = [
    { id: 'accepted', rule: 'three', match: 'New text.', status: 'accepted' },
    { id: 'overlap', rule: 'puffery', match: 'Old text.', status: 'superseded', supersededBy: 'accepted' },
    { id: 'later', rule: 'puffery', match: 'Later.' },
  ];
  assert.deepEqual(
    visibleProofs(all).map(f => f.id),
    ['accepted', 'later'],
  );
  assert.equal(proofSet(all, 'reviewed').length, 1);
  assert.equal(proofSet(all, 'open').length, 1);
  assert.deepEqual(
    orderProofs(all).map(f => f.id),
    ['accepted', 'later'],
  );
  assert.equal(stepAllProofs(all, 'accepted', 1)?.id, 'later');
  assert.equal(completionStatus(all).reviewed, 1);
  const { findProofmarks } = await import('./matcher');
  const root = { ownerDocument: { createTreeWalker: () => ({ nextNode: () => null }) } } as unknown as HTMLElement;
  assert.equal(
    findProofmarks(root, all).some(m => m.finding.id === 'overlap'),
    false,
  );
  const restored = all.map(f => (f.id === 'overlap' ? { ...f, status: 'open' as const } : f));
  assert.equal(visibleProofs(restored).length, 3);
  assert.equal(stepAllProofs(restored, 'accepted', 1)?.id, 'overlap');
});

const fakeRange = (start: number, end: number) =>
  ({
    cloneRange() {
      return fakeRange(start, end);
    },
    compareBoundaryPoints(how: number, other: Range) {
      const r = other as unknown as { start: number; end: number };
      return how === 0 ? start - r.start : end - r.end;
    },
    start,
    end,
  }) as unknown as Range;
test('DOM boundaries beat scrambled file/source order; shared starts prefer longer then file order', () => {
  const all: ProofmarksFinding[] = ['last', 'short', 'tie', 'first', 'long'].map((id, i) => ({
    id,
    rule: 'r',
    match: id,
    span: { start: i, end: i + 1 },
  }));
  const spans: Record<string, number[]> = {
    first: [0, 4],
    long: [10, 40],
    short: [10, 20],
    tie: [10, 20],
    last: [50, 60],
  };
  const order = new ProofOrder(),
    matches = all.map(f => ({ finding: f, range: fakeRange(spans[f.id]![0]!, spans[f.id]![1]!) }));
  assert.deepEqual(
    order.order(all, matches).map(f => f.id),
    ['first', 'long', 'short', 'tie', 'last'],
  );
});
test('Accept, Dismiss, Undo and rematched shorter text never reshuffle established numbers', () => {
  const all: ProofmarksFinding[] = ['later', 'early', 'same'].map(id => ({ id, rule: 'r', match: id }));
  const order = new ProofOrder(),
    initial = all.map((f, i) => ({ finding: f, range: fakeRange(i === 0 ? 30 : 0, i === 1 ? 20 : i === 2 ? 10 : 40) }));
  const expected = ['early', 'same', 'later'];
  assert.deepEqual(
    order.order(all, initial).map(f => f.id),
    expected,
  );
  for (const status of ['accepted', 'dismissed', 'open'] as const) {
    const changed = all.map(f => (f.id === 'early' ? { ...f, status } : f));
    assert.deepEqual(
      order
        .order(
          changed,
          changed
            .filter(f => f.status !== 'dismissed')
            .map(f => ({ finding: f, range: fakeRange(f.id === 'early' ? 80 : 0, 90) })),
        )
        .map(f => f.id),
      expected,
    );
  }
});
test('unlocated source spans follow located ranges; hidden copy is last; newly located proofs join the DOM sequence', () => {
  const all: ProofmarksFinding[] = [
    { id: 'hidden', rule: 'r', match: 'h', target: { kind: 'meta', field: 'summary' }, span: { start: 0, end: 1 } },
    { id: 'missing2', rule: 'r', match: 'm', span: { start: 50, end: 60 } },
    { id: 'found', rule: 'r', match: 'f', span: { start: 100, end: 110 } },
    { id: 'missing1', rule: 'r', match: 'n', span: { start: 20, end: 30 } },
  ];
  const order = new ProofOrder();
  assert.deepEqual(
    order.order(all, [{ finding: all[2]!, range: fakeRange(10, 20) }]).map(f => f.id),
    ['found', 'missing1', 'missing2', 'hidden'],
  );
  assert.deepEqual(
    order.order(all, [{ finding: all[3]!, range: fakeRange(0, 4) }]).map(f => f.id),
    ['missing1', 'found', 'missing2', 'hidden'],
  );
  assert.equal(stepAllProofs(order.order(all, []), 'missing1', 1)?.id, 'found');
});
