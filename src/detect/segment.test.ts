import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectMdx, projectText, sentences, sourceSpan } from './segment';

const split = (text: string) => sentences({ text }).map(s => s.text);

test('abbreviations, initialisms and decimals stay inside their sentence', () => {
  assert.deepEqual(split('When on board H.M.S. ‘Beagle,’ as naturalist, I was struck. These facts seemed new.'), [
    'When on board H.M.S. ‘Beagle,’ as naturalist, I was struck.',
    'These facts seemed new.',
  ]);
  assert.deepEqual(split('Use plain words, e.g. use instead of utilize. It works.'), [
    'Use plain words, e.g. use instead of utilize.',
    'It works.',
  ]);
  assert.deepEqual(split('The share rose to 2.4 percent in 2024. Then 1,000 agents arrived.'), [
    'The share rose to 2.4 percent in 2024.',
    'Then 1,000 agents arrived.',
  ]);
  assert.deepEqual(split('J.R. Moss joined. Dana and I talked.'), ['J.R. Moss joined.', 'Dana and I talked.']);
  assert.deepEqual(split('Mr. Smith went to Washington, D.C. on Monday. He stayed.'), [
    'Mr. Smith went to Washington, D.C. on Monday.',
    'He stayed.',
  ]);
  assert.deepEqual(split('It costs $3.50 vs. $4. Fine.'), ['It costs $3.50 vs. $4.', 'Fine.']);
});

test('a lowercase continuation joins the question before it', () => {
  assert.deepEqual(split('And the best part? it is cheap. Done.'), ['And the best part? it is cheap.', 'Done.']);
  assert.deepEqual(split('And the best part? It is cheap.'), ['And the best part?', 'It is cheap.']);
});

const mdx = `---
title: "A test"
summary: "Not prose"
---

import { Chart } from './chart';

## The split *already* happened

They're not getting scraped. They're getting *used*. See [the report](https://example.com/a_(b)) today.

<Compare
  rows={[["a", "b"]]}
/>

- **First item:** has a [link](https://x.dev).
- Second item

\`\`\`ts
const notProse = true;
\`\`\`

> A quoted line.
`;

test('MDX projection skips frontmatter, imports, JSX and code, and keeps block kinds', () => {
  const blocks = projectMdx(mdx);
  assert.deepEqual(
    blocks.map(b => [b.kind, b.text]),
    [
      ['heading', 'The split already happened'],
      ['paragraph', "They're not getting scraped. They're getting used. See the report today."],
      ['list-item', 'First item: has a link.'],
      ['list-item', 'Second item'],
      ['quote', 'A quoted line.'],
    ],
  );
});

test('source spans are exact and widen over emphasis and link markup', () => {
  const block = projectMdx(mdx)[1]!;
  const parts = sentences(block);
  const second = sourceSpan(block, parts[1]!.start, parts[1]!.end, mdx);
  assert.equal(mdx.slice(second.start, second.end), "They're getting *used*.");
  const word = block.text.indexOf('used');
  const inner = sourceSpan(block, word, word + 4, mdx);
  assert.equal(mdx.slice(inner.start, inner.end), '*used*');
  const link = block.text.indexOf('the report');
  const linked = sourceSpan(block, link, link + 'the report'.length, mdx);
  assert.equal(mdx.slice(linked.start, linked.end), '[the report](https://example.com/a_(b))');
  for (const b of projectMdx(mdx)) b.map.forEach((at, i) => assert.equal(mdx[at] === '\n' ? ' ' : mdx[at], b.text[i]));
});

test('plain text: short unpunctuated lines are headings, wrapped lines join', () => {
  const blocks = projectText('The Five Horsemen\n\nOne line\nwraps here. Another sentence.\n\n- a list item');
  assert.deepEqual(
    blocks.map(b => [b.kind, b.text]),
    [
      ['heading', 'The Five Horsemen'],
      ['paragraph', 'One line wraps here. Another sentence.'],
      ['list-item', 'a list item'],
    ],
  );
});
