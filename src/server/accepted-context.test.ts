import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { availableReview, readReview, applySourceAction } from './source';

// Both rewrites are "use", which the page already says.
const original = [
  '# How we use checklists',
  '',
  'We leverage customer feedback to shape every release. Support teams utilize it daily.',
  '',
].join('\n');

test('an accepted rewrite keeps its context, so Undo finds it where it was made', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'proofmarks-context-'));
  try {
    await mkdir(path.join(base, 'drafts'));
    await mkdir(path.join(base, 'reviews'));
    await writeFile(path.join(base, 'drafts/post.md'), original);
    await writeFile(
      path.join(base, 'reviews/post.json'),
      JSON.stringify({
        source: 'drafts/post.md',
        rules: [],
        findings: [
          { id: 'L', rule: 'inflated', match: 'leverage', proposed: 'use' },
          { id: 'U', rule: 'inflated', match: 'utilize', proposed: 'use' },
        ],
      }),
    );
    await writeFile(
      path.join(base, 'proofmarks.config.json'),
      JSON.stringify({
        version: 1,
        documents: [{ id: 'post', source: 'drafts/post.md', review: 'reviews/post.json', write: true }],
        roots: ['drafts'],
        judge: { provider: 'fake', model: 'fixture' },
      }),
    );
    const act = async (id: string, action: 'accept' | 'revert') =>
      applySourceAction(
        base,
        id,
        action,
        (await readReview(base, 'post')).revision,
        undefined,
        undefined,
        undefined,
        'post',
      );
    const text = () => readFile(path.join(base, 'drafts/post.md'), 'utf8');
    for (const id of ['L', 'U']) await act(id, 'accept');
    assert.match(await text(), /We use customer feedback to shape every release\. Support teams use it daily\./);
    const review = availableReview(await readReview(base, 'post'));
    for (const finding of review.findings) {
      assert.equal(finding.status, 'accepted');
      assert.equal(finding.actionReason, undefined, `${finding.id} can be undone`);
      assert.ok(finding.edits?.[0]?.context, `${finding.id} keeps its context`);
    }
    assert.deepEqual(review.findings[0]!.edits![0]!.context, {
      left: '# How we use checklists\n\nWe ',
      right: ' customer feedback to shape every release. Support teams utilize',
    });
    // Without its context, Undo would refuse: "use" appears three times. Accepting "utilize" changed the end of this
    // context, so the shorter context finds it.
    for (const id of ['L', 'U']) await act(id, 'revert');
    assert.equal(await text(), original);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('a rewrite that opens with punctuation takes the space before its mark, and Undo puts it back', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'proofmarks-punctuation-'));
  const dashed = 'The update is small — but it changes how the whole team works.\n';
  try {
    await mkdir(path.join(base, 'drafts'));
    await mkdir(path.join(base, 'reviews'));
    await writeFile(path.join(base, 'drafts/post.md'), dashed);
    await writeFile(
      path.join(base, 'reviews/post.json'),
      JSON.stringify({
        source: 'drafts/post.md',
        rules: [],
        findings: [{ id: 'D', rule: 'em-dash', match: '— but', proposed: ', but' }],
      }),
    );
    await writeFile(
      path.join(base, 'proofmarks.config.json'),
      JSON.stringify({
        version: 1,
        documents: [{ id: 'post', source: 'drafts/post.md', review: 'reviews/post.json', write: true }],
        roots: ['drafts'],
        judge: { provider: 'fake', model: 'fixture' },
      }),
    );
    const act = async (action: 'accept' | 'revert') =>
      applySourceAction(
        base,
        'D',
        action,
        (await readReview(base, 'post')).revision,
        undefined,
        undefined,
        undefined,
        'post',
      );
    const text = () => readFile(path.join(base, 'drafts/post.md'), 'utf8');
    await act('accept');
    assert.equal(await text(), 'The update is small, but it changes how the whole team works.\n');
    await act('revert');
    assert.equal(await text(), dashed);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
