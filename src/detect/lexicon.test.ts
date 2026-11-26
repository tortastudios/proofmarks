import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileLexicon, inflect, lexiconHits } from './lexicon';

test('verbs, nouns and adjectives inflect', () => {
  assert.deepEqual(inflect({ term: 'leverage', pos: 'verb' }), ['leverage', 'leverages', 'leveraged', 'leveraging']);
  assert.deepEqual(inflect({ term: 'foster', pos: 'verb' }), ['foster', 'fosters', 'fostered', 'fostering']);
  assert.deepEqual(inflect({ term: 'harness', pos: 'verb' }), ['harness', 'harnesses', 'harnessed', 'harnessing']);
  assert.deepEqual(inflect({ term: 'delve', pos: 'verb' }), ['delve', 'delves', 'delved', 'delving']);
  assert.deepEqual(inflect({ term: 'serve as', pos: 'verb' }), ['serve as', 'serves as', 'served as', 'serving as']);
  assert.deepEqual(inflect({ term: 'synergy', pos: 'noun' }), ['synergy', 'synergies']);
  assert.deepEqual(inflect({ term: 'north star', pos: 'noun' }), ['north star', 'north stars']);
  assert.deepEqual(inflect({ term: 'seamless', pos: 'adj' }), ['seamless', 'seamlessly']);
  assert.deepEqual(inflect({ term: 'stand as', pos: 'verb', forms: ['stood as'] }), [
    'stand as',
    'stands as',
    'standed as',
    'standing as',
    'stood as',
  ]);
});

test('hits match inflections, hyphen or space compounds and either apostrophe, on word boundaries', () => {
  const lexicon = compileLexicon([
    { term: 'foster', pos: 'verb' },
    { term: 'game-changer', pos: 'noun' },
    { term: "let's delve into" },
    { term: "here's the thing" },
    { term: 'leverage', pos: 'verb' },
  ]);
  const found = (text: string) => lexiconHits(text, lexicon).map(h => h.text);
  assert.deepEqual(found('By fostering trust, a true game changer.'), ['fostering', 'game changer']);
  assert.deepEqual(found('Two game-changers.'), ['game-changers']);
  assert.deepEqual(found('Let’s delve into it. Here’s the thing: no.'), ['Let’s delve into', 'Here’s the thing']);
  assert.deepEqual(found('Leveraged, LEVERAGING, leverageable, preleverage.'), ['Leveraged', 'LEVERAGING']);
});

test('the longest form wins inside one lexicon', () => {
  const lexicon = compileLexicon([
    { term: 'harness', pos: 'verb' },
    { term: 'harness the power of', pos: 'verb' },
  ]);
  assert.deepEqual(
    lexiconHits('By harnessing the power of AI.', lexicon).map(h => h.text),
    ['harnessing the power of'],
  );
});
