import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileReview, assertReviewConsistency } from './reconcile';
import type { ProofmarksReview } from './types';
const review: ProofmarksReview = {
  rules: [],
  findings: [{ id: 'U03', rule: 'r', match: "The agent doesn't browse.", proposed: 'The agent buys.' }],
};
test('accepted with restored before text is reopened without mutating inputs or stale history', () => {
  const stale: ProofmarksReview = {
    ...review,
    findings: [
      {
        ...review.findings[0]!,
        status: 'accepted',
        before: review.findings[0]!.match,
        after: 'The agent buys.',
        appliedAt: 'date',
      },
    ],
  };
  const original = JSON.stringify(stale);
  const result = reconcileReview('The agent doesn’t browse.', stale);
  assert.equal(result.review.findings[0]!.status, 'open');
  assert.equal(result.review.findings[0]!.after, undefined);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(result.issues, []);
  assert.equal(JSON.stringify(stale), original);
  assert.throws(() => assertReviewConsistency('The agent doesn’t browse.', stale), /Inconsistent/);
});
test('unrecorded proposal is explicit and cannot fabricate revert history; reconciliation is idempotent', () => {
  const result = reconcileReview('The agent buys.', review);
  assert.equal(result.review.findings[0]!.status, 'accepted-unrecorded');
  assert.equal(result.review.findings[0]!.before, undefined);
  assert.match(result.review.findings[0]!.actionReason!, /no exact revert history/);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(reconcileReview('The agent buys.', result.review).warnings, []);
  assertReviewConsistency('The agent buys.', result.review);
});
test('consistent accepted/open/dismissed findings stay put; neither or ambiguous matches never guess', () => {
  assertReviewConsistency(review.findings[0]!.match, review);
  assertReviewConsistency('The agent buys.', {
    ...review,
    findings: [
      { ...review.findings[0]!, status: 'accepted', before: review.findings[0]!.match, after: 'The agent buys.' },
    ],
  });
  assertReviewConsistency(review.findings[0]!.match, {
    ...review,
    findings: [{ ...review.findings[0]!, status: 'dismissed' }],
  });
  for (const source of ['Unrelated text.', 'The agent buys. The agent buys.']) {
    const result = reconcileReview(source, review);
    assert.equal(result.review.findings[0]!.status, undefined);
    assert.equal(result.warnings.length, 0);
    assert.ok(result.issues.length);
    assert.throws(() => assertReviewConsistency(source, review));
  }
});

test('body-first reconciliation and self-heal ignore frontmatter duplicates across original/rewrite states', () => {
  const f = review.findings[0]!,
    front = `---\nsummary: "${f.match}"\ntakeaways: "${f.match}"\nafter: "${f.proposed}"\n---\n`;
  assertReviewConsistency(front + f.match, review);
  const accepted = { ...review, findings: [{ ...f, status: 'accepted' as const, before: f.match, after: f.proposed }] };
  assertReviewConsistency(front + f.proposed, accepted);
  assert.equal(reconcileReview(front + f.match, accepted).review.findings[0]!.status, 'open');
  assert.equal(reconcileReview(front + f.proposed, review).review.findings[0]!.status, 'accepted-unrecorded');
  assert.ok(reconcileReview(front + f.match + ' ' + f.match, review).issues.length);
  const metadata = {
    rules: [],
    findings: [{ id: 'U01', rule: 'r', match: 'Description.', proposed: 'New description.' }],
  };
  assertReviewConsistency('---\ndescription: Description.\n---\nUnrelated body.', metadata);
});

test('recorded companion edits leave sibling metadata decisions open through accept and undo', () => {
  const body = {
    id: 'B',
    rule: 'r',
    match: 'Original.',
    proposed: 'Better.',
    status: 'accepted' as const,
    before: 'Original.',
    after: 'Better.',
    edits: [
      { start: 0, end: 9, before: 'Original.', after: 'Better.' },
      {
        target: { kind: 'meta' as const, field: 'summary' as const },
        start: 0,
        end: 9,
        before: 'Original.',
        after: 'Better.',
      },
    ],
  };
  const sibling = {
    id: 'M',
    rule: 'r',
    match: 'Original.',
    proposed: 'Better.',
    status: 'open' as const,
    target: { kind: 'meta' as const, field: 'summary' as const },
  };
  const r = { rules: [], findings: [body, sibling] },
    original = JSON.stringify(r);
  const accepted = reconcileReview('---\nsummary: "Better."\n---\nBetter.', r);
  assert.equal(accepted.review.findings[1]!.status, 'open');
  assert.deepEqual(accepted.warnings, []);
  assert.deepEqual(accepted.issues, []);
  assert.equal(JSON.stringify(r), original);
  const undone = reconcileReview('---\nsummary: "Original."\n---\nOriginal.', {
    rules: [],
    findings: [{ id: 'B', rule: 'r', match: 'Original.', proposed: 'Better.', status: 'open' }, sibling],
  });
  assert.equal(undone.review.findings[1]!.status, 'open');
  assert.deepEqual(undone.warnings, []);
  assert.equal(
    reconcileReview('---\nsummary: "Better."\n---\nOriginal.', { rules: [], findings: [sibling] }).review.findings[0]!
      .status,
    'accepted-unrecorded',
  );
});
