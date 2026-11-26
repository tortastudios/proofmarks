import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eventFixture } from '../events/fixture';
import { fakeProvider } from './fake';
import { ReviewService } from './service';
import type { JudgeProvider } from '../judge/types';

// A fixture with a word-level mark (F2) beside the default contrast mark (F1), and a judge that records what it was
// asked.
async function scoringFixture(
  sentence = 'We leverage customer feedback to shape every release.',
  rule = 'inflated',
  match = 'leverage',
) {
  const f = await eventFixture([sentence]);
  const reviewFile = path.join(f.base, 'content/reviews/proofmarks-fixture.json');
  const review = JSON.parse(await readFile(reviewFile, 'utf8'));
  Object.assign(review.findings[1], { rule, match });
  await writeFile(reviewFile, JSON.stringify(review));
  const asked: { target: string; ask: string }[] = [];
  const provider: JudgeProvider = {
    ...fakeProvider,
    async judge(input, questions, opts) {
      asked.push({ target: input.target, ask: questions[0]!.ask });
      return {
        ...(await fakeProvider.judge(input, questions, opts)),
        answers: [{ id: questions[0]!.id, probability: 0.1 }],
      };
    },
  };
  const service = new ReviewService(f.store, { root: f.root, provider, cacheDir: f.base + '/cache' });
  return { ...f, asked, service };
}

test('a word-list rewrite to words the list does not flag clears without asking the judge', async () => {
  const f = await scoringFixture();
  try {
    const result = await f.service.checkRewrite({ reviewId: 'fixture', findingId: 'F2', text: 'use' });
    assert.deepEqual([result.clears, result.probability, f.asked.length], [true, 0, 0]);
  } finally {
    await f.close();
  }
});

test('a swap to another listed word is judged in its sentence, asking about the new word', async () => {
  const f = await scoringFixture();
  try {
    await f.service.checkRewrite({ reviewId: 'fixture', findingId: 'F2', text: 'utilize' });
    assert.equal(f.asked.length, 1);
    assert.equal(f.asked[0]!.target, 'We utilize customer feedback to shape every release.');
    assert.match(f.asked[0]!.ask, /“utilize”/);
    assert.doesNotMatch(f.asked[0]!.ask, /leverage/);
  } finally {
    await f.close();
  }
});

test('a word-level deletion scores zero without asking the judge', async () => {
  const f = await scoringFixture(
    'Our seamless onboarding gets new hires working on day one.',
    'promo-adjective',
    'seamless',
  );
  try {
    const result = await f.service.checkRewrite({ reviewId: 'fixture', findingId: 'F2', text: '' });
    assert.deepEqual([result.clears, result.probability, f.asked.length], [true, 0, 0]);
  } finally {
    await f.close();
  }
});

test('an em dash rewrite that drops the dash clears without asking the judge', async () => {
  const f = await scoringFixture('The update is small — but it changes how the whole team works.', 'em-dash', ' — but');
  try {
    const result = await f.service.checkRewrite({ reviewId: 'fixture', findingId: 'F2', text: ', but' });
    assert.deepEqual([result.clears, result.probability, f.asked.length], [true, 0, 0]);
    // A dash the rewrite keeps is judged in its new sentence, not as the bare replacement.
    await f.service.checkRewrite({ reviewId: 'fixture', findingId: 'F2', text: ' — and' });
    assert.equal(f.asked[0]!.target, 'The update is small — and it changes how the whole team works.');
  } finally {
    await f.close();
  }
});

test('a bold rewrite is checked in the source: dropping the asterisks clears, new bold is judged in its sentence', async () => {
  const f = await scoringFixture('Our new dashboard is **incredibly** easy to use.', 'bold', '**incredibly**');
  try {
    const plain = await f.service.checkRewrite({ reviewId: 'fixture', findingId: 'F2', text: 'incredibly' });
    assert.deepEqual([plain.clears, plain.probability, f.asked.length], [true, 0, 0]);
    await f.service.checkRewrite({ reviewId: 'fixture', findingId: 'F2', text: '**truly**' });
    assert.equal(f.asked.length, 1);
    assert.equal(f.asked[0]!.target, 'Our new dashboard is truly easy to use.');
    assert.match(f.asked[0]!.ask, /the bold on “truly”/);
  } finally {
    await f.close();
  }
});

test('a sentence-level rewrite is still judged on its own text', async () => {
  const f = await scoringFixture();
  try {
    await f.service.checkRewrite({ reviewId: 'fixture', findingId: 'F1', text: 'It is a revolution.' });
    assert.equal(f.asked[0]!.target, 'It is a revolution.');
  } finally {
    await f.close();
  }
});
