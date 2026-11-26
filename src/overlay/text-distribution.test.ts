import test from 'node:test';
import assert from 'node:assert/strict';
import { distributeReplacement } from './text-distribution';

test('unchanged emphasized words and punctuation survive an optimistic rewrite in their own nodes', () => {
  assert.deepEqual(
    distributeReplacement(['They’re not getting scraped. They’re getting ', 'used', '.'], 'They’re getting used.'),
    ['They’re getting ', 'used', '.'],
  );
  // React will skip this unchanged em child on its next render. It must still contain its word.
  const changed = distributeReplacement(['The sentence is ', 'very', ' clear.'], 'The sentence is clear.');
  assert.equal(changed.join(''), 'The sentence is clear.');
});
test('replacement distribution never reorders or drops inserted text across inline boundaries', () => {
  for (const pieces of [['one ', 'two', ' three.'], ['', 'word', ''], ['Original.'], ['one', 'two'], ['', '', '']])
    for (const text of ['A new sentence.', 'one three.', 'new one two three.', '', 'word', 'one TWO three.'])
      assert.equal(distributeReplacement(pieces, text).join(''), text);
});
