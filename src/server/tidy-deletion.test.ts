import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readReview, applySourceAction } from './source';

const original = [
  '# Faster CI',
  '',
  "This is how we got it down to six minutes, and what we learned along the way. Let's dive in.",
  '',
  "It's worth noting that this is a common pattern. Experts agree on it.",
  '',
  'At the end of the day, fast CI is about speed. It is a seamless, quick tool.',
  '',
].join('\n');

test('accepting a deletion tidies its sentence, and Undo restores the original byte for byte', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'proofmarks-tidy-'));
  try {
    await mkdir(path.join(base, 'drafts'));
    await mkdir(path.join(base, 'reviews'));
    await writeFile(path.join(base, 'drafts/post.md'), original);
    const finding = (id: string, rule: string, match: string) => ({ id, rule, match, proposed: '' });
    await writeFile(
      path.join(base, 'reviews/post.json'),
      JSON.stringify({
        source: 'drafts/post.md',
        rules: [],
        findings: [
          finding('S', 'signpost', "Let's dive in"),
          finding('F', 'filler', "It's worth noting that"),
          finding('E', 'filler', 'At the end of the day'),
          finding('P', 'promo-adjective', 'seamless'),
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
    for (const id of ['S', 'F', 'E', 'P']) await act(id, 'accept');
    assert.equal(
      await text(),
      [
        '# Faster CI',
        '',
        'This is how we got it down to six minutes, and what we learned along the way.',
        '',
        'This is a common pattern. Experts agree on it.',
        '',
        'Fast CI is about speed. It is a quick tool.',
        '',
      ].join('\n'),
    );
    for (const id of ['P', 'E', 'F', 'S']) await act(id, 'revert');
    assert.equal(await text(), original);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
