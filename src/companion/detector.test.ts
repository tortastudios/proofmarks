import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { enabledRules, registeredReview } from './detector';
import type { JudgeProvider } from '../judge/types';
test('registry detector receives the shared contract and independent cached repeats', async () => {
  const work = new URL('../../.test-work/', import.meta.url);
  await mkdir(work, { recursive: true });
  const cacheDir = await mkdtemp(new URL('bridge-', work).pathname);
  let calls = 0;
  const provider: JudgeProvider = {
    id: 'fake',
    model: 'fixture-1',
    capabilities: { maxQuestionsPerCall: 32, pricing: 'per-call' },
    async judge(_input, questions) {
      calls++;
      return {
        answers: questions.map(q => ({ id: q.id, probability: 0.9 })),
        provider: 'fake',
        model: 'fixture-1',
        cached: false,
        latencyMs: 0,
        usage: { calls: 1, dollars: 0 },
      };
    },
  };
  const detect: Parameters<typeof registeredReview>[0] = async (doc, registry, judge, calibration) => {
    assert.equal(doc.kind, 'mdx');
    assert.equal(doc.source, 'A concrete paragraph.');
    assert.equal(registry.version, '3');
    assert.equal(calibration.provider, 'fake');
    for (let i = 0; i < 2; i++)
      await judge.judge({ target: doc.source }, [{ id: 'contrast', kind: 'yes-no', ask: 'Contrast?' }]);
    return [
      {
        id: 'P1',
        rule: 'contrast',
        level: 'sentence',
        edit: 'replace',
        match: doc.source,
        span: { start: 0, end: doc.source.length },
        note: 'State the claim directly.',
        severity: 'flag',
        status: 'open',
        judge: {
          provider: 'fake',
          model: 'fixture-1',
          probability: 0.9,
          threshold: 0.8,
          rulesVersion: registry.version,
        },
      },
    ];
  };
  try {
    const review = await registeredReview(
      detect,
      'A concrete paragraph.',
      'content/essays/proofmarks-fixture.mdx',
      provider,
      { cacheDir },
    );
    assert.equal(calls, 2);
    assert.equal(review.findings[0]?.judge?.score, 0.9);
    assert.equal(review.source, 'content/essays/proofmarks-fixture.mdx');
    await registeredReview(detect, 'A concrete paragraph.', 'content/essays/proofmarks-fixture.mdx', provider, {
      cacheDir,
    });
    assert.equal(calls, 2);
  } finally {
    await rm(cacheDir, { recursive: true });
  }
});
test('review rules retain registry inks and marks, including the essay styles and paragraph brackets', async () => {
  const { loadRegistry } = await import('../detect/registry');
  const { fakeProvider } = await import('./fake');
  const registry = loadRegistry();
  const review = await registeredReview(
    async () => [],
    'A concrete paragraph.',
    'content/essays/proofmarks-fixture.mdx',
    fakeProvider,
    {},
  );
  assert.deepEqual(
    review.rules.map(rule => ({ id: rule.id, color: rule.color, mark: rule.mark })),
    registry.rules.map(rule => ({ id: rule.id, color: rule.color, mark: rule.mark })),
  );
  const styles = Object.fromEntries(review.rules.map(rule => [rule.id, [rule.color, rule.mark]]));
  assert.deepEqual(styles.contrast, ['#994b52', 'circle']);
  assert.deepEqual(styles.filler, ['#5e6b38', 'box']);
  assert.deepEqual(styles.three, ['#87532f', 'underline']);
  assert.deepEqual(styles.inflated, ['#875f45', 'underline']);
  assert.equal(new Set(review.rules.map(rule => rule.color)).size, registry.rules.length);
  for (const rule of registry.rules.filter(rule => rule.level === 'paragraph'))
    assert.equal(styles[rule.id]?.[1], 'bracket');
});
test('review-rule style fallbacks apply only when registry metadata is absent', async () => {
  const { fakeProvider } = await import('./fake');
  const review = await registeredReview(
    async (_doc, registry) => {
      delete registry.rules[0]!.color;
      delete registry.rules[0]!.mark;
      return [];
    },
    'A concrete paragraph.',
    'content/essays/proofmarks-fixture.mdx',
    fakeProvider,
    {},
  );
  assert.equal(review.rules[0]?.color, '#87532f');
  assert.equal(review.rules[0]?.mark, 'underline');
  assert.equal(review.rules.find(rule => rule.id === 'contrast')?.color, '#994b52');
});

test('registered review serializes detector output by span without changing identities', async () => {
  const { fakeProvider } = await import('./fake');
  const row = {
    rule: 'contrast',
    match: 'text',
    level: 'sentence' as const,
    edit: 'replace' as const,
    note: '',
    severity: 'flag' as const,
    status: 'open' as const,
  };
  const review = await registeredReview(
    async () => [
      { ...row, id: 'later', span: { start: 20, end: 30 } },
      { ...row, id: 'short', span: { start: 0, end: 4 } },
      { ...row, id: 'long', span: { start: 0, end: 10 } },
    ],
    'text',
    'doc.mdx',
    fakeProvider,
    {},
  );
  assert.deepEqual(
    review.findings.map(f => f.id),
    ['long', 'short', 'later'],
  );
});

test('a project turns rules on or off in its config, and the rest keep their defaults', async () => {
  const { loadRegistry, detect } = await import('../detect/index');
  const { fakeProvider } = await import('./fake');
  const registry = loadRegistry();
  const defaults = enabledRules(registry);
  assert.ok(!defaults.includes('title-case') && defaults.includes('contrast'));
  const chosen = enabledRules(registry, { 'title-case': true, contrast: false });
  assert.ok(chosen.includes('title-case') && !chosen.includes('contrast'));
  assert.equal(chosen.length, defaults.length);
  assert.throws(() => enabledRules(registry, { 'title case': true }), /rules that don't exist: title case/);
  // Through a real review: a title case heading is marked only once the project turns its rule on.
  const text = '## How We Rebuilt Our Onboarding Flow\n\nWe moved the welcome email to the first screen.\n';
  const marked = async (rules?: Record<string, boolean>) =>
    (await registeredReview(detect, text, 'doc.mdx', fakeProvider, { rules })).findings.map(f => f.rule);
  assert.ok(!(await marked()).includes('title-case'));
  assert.ok((await marked({ 'title-case': true })).includes('title-case'));
});
