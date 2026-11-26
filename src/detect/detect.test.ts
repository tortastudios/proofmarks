import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, detect, questionId, quotedRanges } from './detect';
import type { JudgeProvider, Question } from './judge-contract';
import { loadRegistry } from './registry';
import type { Calibration, Doc } from './types';

const registry = loadRegistry();

/** A deterministic judge: probability by question id prefix, with a call log. */
function fakeJudge(probability: (q: Question) => number, maxQuestionsPerCall = 32) {
  const calls: { target: string; questions: string[] }[] = [];
  const judge: JudgeProvider = {
    id: 'fake',
    model: 'fake-1',
    capabilities: { maxQuestionsPerCall, pricing: 'per-call' },
    async judge(input, questions) {
      calls.push({ target: input.target, questions: questions.map(q => q.id) });
      return {
        answers: questions.map(q => ({ id: q.id, probability: probability(q) })),
        provider: 'fake',
        model: 'fake-1',
        latencyMs: 0,
        cached: false,
        usage: { calls: 1, dollars: 0.001 },
      };
    },
  };
  return { judge, calls };
}
const calibration = (rules: Record<string, number>): Calibration => ({
  provider: 'fake',
  model: 'fake-1',
  rulesVersion: '3',
  labeledSetHash: 'test',
  fitted: 'November 5, 2026',
  rules: Object.fromEntries(
    Object.entries(rules).map(([id, threshold]) => [
      id,
      { threshold, band: [threshold - 0.1, threshold + 0.1], repeats: 1 },
    ]),
  ),
});

const doc: Doc = {
  id: 'sample',
  kind: 'mdx',
  source: `---
title: x
---

We leverage robust tools. They aren't browsing. They're buying.

Teams leverage data daily, and we leverage it too.
`,
};

test('findings carry exact source matches, levels, edits and judge metadata', async () => {
  const { judge } = fakeJudge(q => (q.id.startsWith('contrast') || q.id.startsWith('inflated') ? 0.9 : 0.1));
  const findings = await detect(doc, registry, judge, calibration({ contrast: 0.8, inflated: 0.2 }));
  const contrast = findings.find(f => f.rule === 'contrast')!;
  assert.equal(contrast.match, "They aren't browsing. They're buying.");
  assert.deepEqual(
    [contrast.level, contrast.edit, contrast.severity, contrast.status],
    ['sentence', 'replace', 'flag', 'open'],
  );
  assert.deepEqual(contrast.judge, {
    provider: 'fake',
    model: 'fake-1',
    probability: 0.9,
    threshold: 0.8,
    rulesVersion: '3',
  });
  for (const f of findings) assert.equal(doc.source.slice(f.span.start, f.span.end), f.match);
  const words = findings.filter(f => f.rule === 'inflated');
  assert.equal(words.length, 3);
  for (const f of words) {
    assert.equal(doc.source.split(f.match).length, 2, `"${f.match}" is unique`);
    assert.equal(f.match.slice(f.focus!.start, f.focus!.end).toLowerCase(), 'leverage');
    assert.match(f.note, /Try “use”/);
  }
});

test('a lexicon hit is a mark unless the judge vetoes it; a pattern needs the judge to agree', async () => {
  const { judge } = fakeJudge(q =>
    q.id === questionId({ rule: 'inflated', term: 'leverage' }) ? 0.05 : q.id.startsWith('contrast') ? 0.5 : 0.3,
  );
  const findings = await detect(
    doc,
    registry,
    judge,
    calibration({ contrast: 0.8, inflated: 0.2, 'promo-adjective': 0.2 }),
  );
  assert.equal(findings.filter(f => f.rule === 'inflated').length, 0, 'every leverage hit was vetoed at 0.05');
  assert.ok(
    findings.some(f => f.rule === 'promo-adjective'),
    'robust survives at 0.3 against a 0.2 veto floor',
  );
  assert.ok(!findings.some(f => f.rule === 'contrast'), 'contrast at 0.5 stays below 0.8');
});

test('questions about one target share a call, chunked by the provider limit, and repeats are averaged', async () => {
  const wide = fakeJudge(() => 0.9);
  await analyze(doc, registry, wide.judge);
  const target = wide.calls.find(c => c.target === 'We leverage robust tools.')!;
  assert.deepEqual(target.questions.sort(), ['inflated__leverage', 'promo_adjective__robust', 'puffery'].sort());
  const narrow = fakeJudge(() => 0.9, 1);
  await analyze(doc, registry, narrow.judge);
  assert.equal(narrow.calls.filter(c => c.target === 'We leverage robust tools.').length, 3);
  let n = 0;
  const alternating = fakeJudge(() => (n++ % 2 ? 0.2 : 0.8));
  const { candidates } = await analyze(doc, registry, alternating.judge, { rules: ['contrast'], repeats: 2 });
  assert.equal(alternating.calls.length, 2);
  assert.deepEqual(
    candidates.map(c => [c.probabilities, Number(c.probability!.toFixed(3))]),
    [[[0.8, 0.2], 0.5]],
  );
});

test('code-only rules decide without the judge; paragraph rules mark the whole paragraph', async () => {
  const { judge, calls } = fakeJudge(() => 0.95);
  const paragraphText =
    'One idea, then another. This paragraph has enough words to be judged as a paragraph, with a second sentence that keeps going on for a while longer than the first one did.';
  const text: Doc = { id: 't', kind: 'mdx', source: `## How We Rebuilt Our Onboarding Flow\n\n${paragraphText}\n` };
  const findings = await detect(text, registry, judge, calibration({ 'generic-voice': 0.9 }), {
    rules: ['title-case', 'generic-voice'],
  });
  const heading = findings.find(f => f.rule === 'title-case')!;
  assert.equal(heading.judge, undefined);
  assert.equal(heading.severity, 'warning');
  assert.equal(heading.match, 'How We Rebuilt Our Onboarding Flow');
  const paragraph = findings.find(f => f.rule === 'generic-voice')!;
  assert.equal(paragraph.match, paragraphText);
  assert.equal(paragraph.edit, 'paragraph');
  assert.equal(calls.length, 1);
});

test('a word-level pattern asks about its own words when its question names them, as bold does', async () => {
  const asked: string[] = [];
  const { judge } = fakeJudge(q => (asked.push(q.ask), 0.9));
  const bold: Doc = { id: 'b', kind: 'mdx', source: 'Every plan includes **unlimited** projects and **fast** sync.\n' };
  const findings = await detect(bold, registry, judge, calibration({ bold: 0.5 }), { rules: ['bold'] });
  // The mark covers the asterisks, so a rewrite can drop the bold.
  assert.deepEqual(
    findings.map(f => f.match),
    ['**unlimited**', '**fast**'],
  );
  assert.ok(asked.some(ask => ask.includes('the bold on “unlimited”')));
  assert.ok(asked.some(ask => ask.includes('the bold on “fast”')));
});

test('nothing is judged or marked without a judge result, and an uncalibrated rule uses the defaults', async () => {
  const { candidates } = await analyze(doc, registry);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every(c => c.probability === undefined));
  const { judge } = fakeJudge(() => 0.65);
  const findings = await detect(doc, registry, judge);
  assert.ok(
    findings.some(f => f.rule === 'contrast'),
    'pattern default 0.6',
  );
  assert.ok(!findings.some(f => f.rule === 'puffery'), 'judge default 0.7');
});

test('words inside a quotation are left alone; prose in attributes, code strings and inch marks is not a quotation', async () => {
  const quoted = (source: string) => quotedRanges(source).map(r => source.slice(r.start, r.end));
  assert.deepEqual(quoted('She said “it was seamless” and he said "it wasn\'t".'), [
    '“it was seamless”',
    '"it wasn\'t"',
  ]);
  assert.deepEqual(
    quoted('<Callout text="We leverage robust tools." /> {"robust"} a 12" pizza'),
    [],
    'attributes, code strings and inch marks',
  );
  assert.deepEqual(quoted('An open "quote here.\n\nNext paragraph" ends.'), [], 'a blank line ends an open quote');
  assert.deepEqual(quoted('A "hard-wrapped\nquotation" here.'), ['"hard-wrapped\nquotation"']);
  assert.deepEqual(quoted('As one VP told me: "We didn\'t need to throw out AI."'), [
    '"We didn\'t need to throw out AI."',
  ]);
  const { judge } = fakeJudge(q => (q.id.startsWith('contrast') || q.id.startsWith('inflated') ? 0.9 : 0.1));
  const page: Doc = {
    id: 'quotes',
    kind: 'mdx',
    source: `We leverage our data well.\n\nA customer told us: “Brightline didn't just save us time. It changed the way our practice runs, and we leverage it daily.”\n\n<Callout tone="calm" />\n\nOur teams leverage it too, he said "often".\n`,
  };
  const findings = await detect(page, registry, judge, calibration({ contrast: 0.8, inflated: 0.2 }));
  assert.deepEqual(
    findings.map(f =>
      page.source
        .slice(f.span.start + (f.focus?.start ?? 0), f.span.start + (f.focus?.end ?? f.match.length))
        .toLowerCase(),
    ),
    ['leverage', 'leverage'],
    "the writer's own words around the quotation and the attribute, not the customer's",
  );
  assert.ok(
    findings.every(
      f => !page.source.slice(0, f.span.start).includes('“') || page.source.slice(0, f.span.start).includes('”'),
    ),
  );
});
