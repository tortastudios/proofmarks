import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceRangeText } from './text-transaction';
test('text transaction preserves boundary text and exact rollback across inline nodes', () => {
  const a = { nodeType: 3, nodeValue: 'prefix original' },
    b = { nodeType: 3, nodeValue: ' middle ' },
    c = { nodeType: 3, nodeValue: 'end suffix' };
  const segment = (node: unknown, startOffset: number, endOffset: number) =>
    ({ startContainer: node, endContainer: node, startOffset, endOffset }) as Range;
  const tx = replaceRangeText([segment(a, 7, 15), segment(b, 0, 8), segment(c, 0, 3)], 'proposal');
  assert.deepEqual([a.nodeValue, b.nodeValue, c.nodeValue], ['prefix proposal', '', ' suffix']);
  tx.rollback();
  assert.deepEqual([a.nodeValue, b.nodeValue, c.nodeValue], ['prefix original', ' middle ', 'end suffix']);
});
test('rollback does not overwrite a subsequent React or external write', () => {
  const node = { nodeType: 3, nodeValue: 'original' };
  const tx = replaceRangeText(
    [{ startContainer: node, endContainer: node, startOffset: 0, endOffset: 8 } as unknown as Range],
    'proposal',
  );
  node.nodeValue = 'new external value';
  tx.rollback();
  assert.equal(node.nodeValue, 'new external value');
});

import { optimisticProse, readsAsMarkdown } from './optimistic-prose';
test('optimistic prose preserves displayed inline citations or a footnote projection', () => {
  const source = "Agents aren't browsing ([Research](https://example.com), March 2026).";
  assert.equal(
    optimisticProse(source, 'Agents are buying (Research, March 2026).'),
    'Agents aren’t browsing (Research, March 2026).',
  );
  assert.equal(optimisticProse(source, 'Agents are buying.'), 'Agents aren’t browsing.');
});

test('optimistic compound swaps update both rendered copies and roll back together', async () => {
  const { replaceTextCopies } = await import('./text-transaction');
  const body = { nodeType: 3, nodeValue: 'Original.' },
    summary = { nodeType: 3, nodeValue: 'Original.' };
  const copy = (node: typeof body) => ({
    segments: [{ startContainer: node, endContainer: node, startOffset: 0, endOffset: 9 } as unknown as Range],
    replacement: 'Rewritten.',
  });
  const transaction = replaceTextCopies([copy(body), copy(summary)]);
  assert.equal(body.nodeValue, 'Rewritten.');
  assert.equal(summary.nodeValue, 'Rewritten.');
  transaction.rollback();
  assert.equal(body.nodeValue, 'Original.');
  assert.equal(summary.nodeValue, 'Original.');
  assert.throws(() => replaceTextCopies([copy(body), copy({ nodeType: 1, nodeValue: 'Original.' })]), /text-only/);
  assert.equal(body.nodeValue, 'Original.');
});

test('formatted rewrite leaves React-owned surviving children intact through Accept and Undo', () => {
  const a = { nodeType: 3, nodeValue: 'They’re not getting scraped. They’re getting ' },
    b = { nodeType: 3, nodeValue: 'used' },
    c = { nodeType: 3, nodeValue: '.' };
  const segment = (node: typeof a) =>
    ({
      startContainer: node,
      endContainer: node,
      startOffset: 0,
      endOffset: node.nodeValue.length,
    }) as unknown as Range;
  const before = [a.nodeValue, b.nodeValue, c.nodeValue];
  const transaction = replaceRangeText([segment(a), segment(b), segment(c)], 'They’re getting used.');
  assert.deepEqual([a.nodeValue, b.nodeValue, c.nodeValue], ['They’re getting ', 'used', '.']);
  // The server-rendered em still says "used", so React may leave that node untouched.
  a.nodeValue = 'They’re getting ';
  assert.equal([a.nodeValue, b.nodeValue, c.nodeValue].join(''), 'They’re getting used.');
  replaceRangeText([segment(a), segment(b), segment(c)], before.join(''));
  assert.deepEqual([a.nodeValue, b.nodeValue, c.nodeValue], before);
  transaction.rollback();
  assert.deepEqual([a.nodeValue, b.nodeValue, c.nodeValue], before);
});
test('Markdown and MDX sources get reading text on Accept without the page declaring it', () => {
  for (const source of ['essay.md', 'content/post.MDX', 'src/content/blog/why.md'])
    assert.equal(readsAsMarkdown(source), true, source);
  for (const source of [undefined, 'templates/page.html', 'index.htm', 'templates/post.jinja'])
    assert.equal(readsAsMarkdown(source), false, String(source));
  assert.equal(readsAsMarkdown('templates/page.html', 'markdown'), true, 'an explicit data-prose still wins');
  assert.equal(
    optimisticProse('Those accounts are getting *used*.', 'They’re not getting scraped. They’re getting used.'),
    'Those accounts are getting used.',
  );
});
