import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { learnLine, outcomes, siteStrictness, storeStrictness, type Outcome } from './strictness';
import { registeredReview } from './detector';
import { fakeProvider } from './fake';
import { ReviewStore, type Decision } from './state';

const mark = (score: number, kept: boolean, line = 0.7, at = '2026-11-23T12:00:00.000Z'): Outcome => ({
  rule: 'generic-voice',
  score,
  line,
  kept,
  at,
});
const many = (count: number, score: number, kept: boolean, line = 0.7) =>
  Array.from({ length: count }, () => mark(score, kept, line));

test('a rule keeps its calibrated line until 8 calls are in', () => {
  assert.equal(learnLine(0.7, [...many(7, 0.72, false)]).line, 0.7);
  assert.deepEqual(learnLine(0.7, []), { line: 0.7, base: 0.7, kept: 0, dismissed: 0 });
});

test('dismissing the marks near the line raises it, and kept marks above stay', () => {
  const marks = [...many(6, 0.72, false), ...many(4, 0.9, true)];
  assert.deepEqual(learnLine(0.7, marks), { line: 0.75, base: 0.7, kept: 4, dismissed: 6 });
});

test('dismissing every mark raises the line as far as it goes, and no further', () => {
  assert.equal(learnLine(0.7, many(9, 0.84, false)).line, 0.85);
  assert.equal(learnLine(0.9, many(9, 0.94, false)).line, 0.95);
  // No line within reach would hide marks Jev is this sure of, so the line stays where it is.
  assert.equal(learnLine(0.7, many(9, 0.95, false)).line, 0.7);
});

test("one or two dismissals among kept marks don't move the line", () => {
  assert.equal(learnLine(0.7, [...many(1, 0.72, false), ...many(8, 0.8, true)]).line, 0.7);
  assert.equal(learnLine(0.7, [...many(2, 0.72, false), ...many(8, 0.8, true)]).line, 0.7);
  assert.equal(learnLine(0.7, [...many(3, 0.72, false), ...many(8, 0.8, true)]).line, 0.75);
});

test('keeping the marks just over the line lowers it one step, until marks are shown under the new one', () => {
  // Nothing under 0.65 has been shown yet, so the old calls can't carry the line further down.
  assert.equal(learnLine(0.7, many(9, 0.72, true)).line, 0.65);
  // Marks shown under 0.65 and kept earn the next step; the walk stops at the most it may move.
  const shown = [...many(9, 0.72, true), ...many(5, 0.66, true, 0.65), ...many(5, 0.61, true, 0.6)];
  assert.equal(learnLine(0.7, shown).line, 0.55);
  assert.equal(learnLine(0.7, [...shown, ...many(5, 0.56, true, 0.55)]).line, 0.55);
});

test('a lowered line comes back up when the marks it let in are dismissed', () => {
  const marks = [...many(9, 0.72, true), ...many(3, 0.66, false, 0.65)];
  assert.equal(learnLine(0.7, marks).line, 0.7);
});

test("kept marks far above the line don't lower it", () => {
  assert.equal(learnLine(0.7, many(12, 0.95, true)).line, 0.7);
});

const decision = (action: string, match: string, extra: Partial<Decision> = {}): Decision => ({
  action,
  timestamp: '2026-11-23T12:00:00.000Z',
  before: {
    finding: {
      id: 'D001',
      rule: 'generic-voice',
      match,
      judge: { probability: 0.74, threshold: 0.7 },
    } as NonNullable<Decision['before']>['finding'],
  },
  ...extra,
});

test("each mark counts once, by the person's last call", () => {
  const events = [
    decision('accept', 'One.'),
    decision('dismiss', 'Two.'),
    decision('dismiss', 'Three.'),
    decision('restore', 'Three.'),
    decision('accept', 'Four.'),
    decision('revert', 'Four.'),
    decision('dismiss', 'Five.'),
    decision('accept', 'Five.'),
    decision('supersede', 'Six.'),
    decision('dismiss', 'No score.', { before: { finding: { id: 'D9', rule: 'contrast', match: 'x' } as never } }),
  ];
  assert.deepEqual(
    outcomes(events).map(outcome => [outcome.score, outcome.kept]),
    [
      [0.74, true],
      [0.74, false],
      [0.74, true],
    ],
  );
});

test('a reset forgets the calls on that rule up to then', () => {
  const old = many(9, 0.8, false),
    lines = siteStrictness({ 'generic-voice': 0.7, contrast: 0.8 }, old, { 'generic-voice': '2026-11-24T00:00:00Z' });
  assert.deepEqual(
    lines.map(entry => [entry.rule, entry.line, entry.dismissed]),
    [
      ['generic-voice', 0.7, 0],
      ['contrast', 0.8, 0],
    ],
  );
  assert.equal(siteStrictness({ 'generic-voice': 0.7 }, old)[0]!.line, 0.85);
});

test("a site's lines come from every review's log, and Reset is kept beside Dismiss memory", async () => {
  const work = new URL('../../.test-work/', import.meta.url);
  await mkdir(work, { recursive: true });
  const dir = await mkdtemp(new URL('strictness-', work).pathname);
  try {
    const root = path.join(dir, 'essays'),
      reviews = path.join(dir, 'reviews');
    await mkdir(root, { recursive: true });
    await mkdir(reviews, { recursive: true });
    const lines = (matches: string[]) =>
      matches.map(match => JSON.stringify(decision('dismiss', match)) + '\n').join('');
    await writeFile(path.join(reviews, 'one.json'), '{}');
    await writeFile(path.join(reviews, 'one.log.jsonl'), lines(['A.', 'B.', 'C.', 'D.', 'E.']));
    await writeFile(path.join(reviews, 'two.json'), '{}');
    await writeFile(path.join(reviews, 'two.log.jsonl'), lines(['F.', 'G.', 'H.', 'I.']));
    const store = await ReviewStore.create(root, { reviewsDir: reviews });
    assert.deepEqual(await storeStrictness(store, { 'generic-voice': 0.7 }), [
      { rule: 'generic-voice', line: 0.75, base: 0.7, kept: 0, dismissed: 9 },
    ]);
    await store.resetStrictness('generic-voice');
    const saved = JSON.parse(await readFile(path.join(root, '.proofmarks/strictness.json'), 'utf8'));
    assert.ok(Date.parse(saved.resets['generic-voice']) > 0);
    assert.equal((await storeStrictness(store, { 'generic-voice': 0.7 }))[0]!.line, 0.7);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a review marks by the site's lines and records the ones that moved", async () => {
  const work = new URL('../../.test-work/', import.meta.url);
  await mkdir(work, { recursive: true });
  const cacheDir = await mkdtemp(new URL('strictness-review-', work).pathname);
  let seen: Record<string, number> = {};
  try {
    const review = await registeredReview(
      async (_doc, _registry, _judge, calibration) => {
        seen = Object.fromEntries(Object.entries(calibration.rules).map(([id, value]) => [id, value.threshold]));
        return [];
      },
      'A paragraph.',
      'essays/a.md',
      fakeProvider,
      {
        cacheDir,
        strictness: async bases =>
          Object.entries(bases).map(([rule, base]) =>
            rule === 'puffery'
              ? { rule, line: 0.95, base, kept: 1, dismissed: 8 }
              : { rule, line: base, base, kept: 0, dismissed: 0 },
          ),
      },
    );
    assert.equal(seen.puffery, 0.95);
    assert.equal(seen.contrast, 0.8);
    assert.deepEqual(review.strictness, [{ rule: 'puffery', line: 0.95, base: 0.8, kept: 1, dismissed: 8 }]);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});
