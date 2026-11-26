import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOrderedReview } from './order';
import { compareSourcePosition } from '../finding-order';
test('helper orders legacy no-span findings by source, with missing spans and hidden copy last', () => {
  const findings = [
    { id: 'b', rule: 'r', match: 'Second.' },
    { id: 'hidden', rule: 'r', match: 'First.', target: { kind: 'meta', field: 'summary' } },
    { id: 'lost', rule: 'r', match: 'Missing.', span: { start: 100, end: 110 } },
    { id: 'a', rule: 'r', match: 'First.' },
  ];
  const review = { source: 'doc.mdx', rules: [], findings };
  assert.deepEqual(
    sourceOrderedReview(review, 'First. Second.', 'doc.mdx').findings.map(f => f.id),
    ['a', 'b', 'lost', 'hidden'],
  );
  assert.deepEqual(
    review.findings.map(f => f.id),
    ['b', 'hidden', 'lost', 'a'],
  );
});
test('helper resolves HTML markup and accepted text, keeping shared-start longer ranges first', () => {
  const review = {
    source: 'doc.html',
    rules: [],
    findings: [
      { id: 'short', rule: 'r', match: 'First' },
      { id: 'last', rule: 'r', match: 'Old.', proposed: 'Second.', status: 'accepted' },
      { id: 'long', rule: 'r', match: 'First sentence.' },
    ],
  };
  assert.deepEqual(
    sourceOrderedReview(review, '<p>First sentence.</p><p>Second.</p>', 'doc.html').findings.map(f => f.id),
    ['long', 'short', 'last'],
  );
  assert.deepEqual(
    [
      { id: 'b', span: { start: 10, end: 12 } },
      { id: 'a', span: { start: 0, end: 4 } },
      { id: 'c', span: { start: 0, end: 20 } },
    ]
      .sort(compareSourcePosition)
      .map(f => f.id),
    ['c', 'a', 'b'],
  );
});

test('valid source spans distinguish repeated identical text instead of using its first occurrence', () => {
  const findings = [
    { id: 'second', rule: 'r', match: 'Same.', span: { start: 6, end: 11 } },
    { id: 'middle', rule: 'r', match: ' ', span: { start: 5, end: 6 } },
    { id: 'first', rule: 'r', match: 'Same.', span: { start: 0, end: 5 } },
  ];
  assert.deepEqual(
    sourceOrderedReview({ source: 'doc.mdx', rules: [], findings }, 'Same. Same.', 'doc.mdx').findings.map(f => f.id),
    ['first', 'middle', 'second'],
  );
});
