import test from 'node:test';
import assert from 'node:assert/strict';
import { words, wordDiff, morphFallback } from './word-morph';
test('word LCS handles repeated words, punctuation and quote normalization', () => {
  assert.deepEqual(
    words('One, two! three.').map(w => w.text),
    ['One,', 'two!', 'three.'],
  );
  assert.deepEqual(wordDiff(['It’s', 'the', 'same', 'the'], ["It's", 'same', 'the', 'new']), {
    kept: [
      { old: 0, next: 0 },
      { old: 2, next: 1 },
      { old: 3, next: 2 },
    ],
    removed: [1],
    added: [3],
  });
  assert.deepEqual(wordDiff([], ['New.']), { kept: [], removed: [], added: [0] });
});
test('morph fallback covers word budget, block/inline structure and missing highlights', () => {
  const safe = { count: 60, nextCount: 60, inline: false, blocks: false, supported: true };
  assert.equal(morphFallback(safe), undefined);
  for (const change of [{ count: 61 }, { nextCount: 61 }, { inline: true }, { blocks: true }, { supported: false }])
    assert.ok(morphFallback({ ...safe, ...change }));
});
