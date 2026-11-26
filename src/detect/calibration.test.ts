import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detect } from './detect';
import { labeledSet, passageDoc, plantCaught } from './labeled';
import { loadCalibration, loadRegistry, rulesDir } from './registry';
import { replayJudge } from './replay';

const registry = loadRegistry(),
  set = labeledSet();
const calibration = loadCalibration(new URL('calibration/jev-jev-1.14.0.json', rulesDir));
const onByDefault = new Set(registry.rules.filter(r => r.default).map(r => r.id));

test('the Jev calibration matches this registry and this frozen labeled set', () => {
  assert.equal(calibration.provider, 'jev');
  assert.equal(calibration.model, 'jev-1.14.0');
  assert.equal(calibration.rulesVersion, registry.version);
  assert.equal(calibration.labeledSetHash, set.hash);
  // Rules that start off are calibrated too: a project can turn them on.
  for (const rule of registry.rules.filter(r => r.judge)) {
    const entry = calibration.rules[rule.id];
    assert.ok(entry, `${rule.id} is calibrated`);
    assert.ok(
      entry.band[0] <= entry.threshold && entry.threshold <= entry.band[1],
      `${rule.id}: band holds the threshold`,
    );
    if (rule.detector.kind === 'lexicon')
      assert.ok(entry.threshold <= 0.5, `${rule.id}: a lexicon threshold is a veto floor`);
  }
});

test('replaying the recorded judge reproduces the frozen-set results: at least 80% recall per level', async () => {
  const { judge, labeledSetHash } = replayJudge();
  assert.equal(labeledSetHash, set.hash);
  const caught: Record<string, [number, number]> = { word: [0, 0], sentence: [0, 0], paragraph: [0, 0] };
  for (const passage of set.planted) {
    const findings = await detect(passageDoc(passage), registry, judge, calibration);
    for (const plant of passage.plants.filter(p => p.rules.some(rule => onByDefault.has(rule)))) {
      caught[plant.level]![1]++;
      if (plantCaught(passage, plant, findings)) caught[plant.level]![0]++;
    }
  }
  // Em dash (9 of 9 planted), connecting colon (6 of 6) and bold (9 of 14) are on by default.
  assert.deepEqual(caught, { word: [57, 62], sentence: [34, 37], paragraph: [19, 20] });
  for (const [level, [hit, total]] of Object.entries(caught))
    assert.ok(hit / total >= 0.8, `${level} recall ${hit}/${total}`);
  let marked = 0,
    marks = 0;
  for (const passage of set.human) {
    const findings = await detect(passageDoc(passage), registry, judge, calibration);
    marks += findings.length;
    if (findings.length) marked++;
  }
  // No contrast marks where Colin would leave the text as it is (Strunk, Hemingway, USGS). Generic voice marks Kennedy's
  // "breathtaking pace", and false range Justice Jackson's sweep from Rome to the present.
  // Of six 18F excerpts, one is marked: inflated, on "a federal ecosystem" in a thank-you note.
  // Turning on em dash and connecting colon adds three: USGS's en dash, an 18F appositive dash and 18F's "Don't be
  // fooled: Our potlucks are second to none."
  assert.deepEqual([marked, marks], [8, 9], 'human controls: 8 of 19 passages carry 9 marks');
  const counts = await Promise.all(set.real.map(async doc => (await detect(doc, registry, judge, calibration)).length));
  // November 19, 2026: 52 → 48 for the guide, since four marks sat inside quotations (an award name and three
  // people's quotes).
  // November 20, 2026: 9 → 11 on the 18F post (generic voice now marks its abstract advice, as Colin did, and
  // leaves the paragraph that names monoliths and services), and 48 → 42 on the guide.
  // November 24, 2026: 11 → 12 on the 18F post (a connecting colon before "integration"), and 42 → 82 on the
  // guide (34 em dashes and 6 connecting colons).
  assert.deepEqual(counts, [12, 82]);
});

test('em dash, connecting colon and bold: replay catches their planted problems and marks human controls as calibrated', async () => {
  const { judge } = replayJudge();
  const rules = ['em-dash', 'colon', 'bold'];
  const caught: Record<string, [number, number]> = {};
  for (const passage of set.planted) {
    const plants = passage.plants.filter(p => p.rules.some(rule => rules.includes(rule)));
    if (!plants.length) continue;
    const findings = await detect(passageDoc(passage), registry, judge, calibration, { rules });
    for (const plant of plants) {
      const tally = (caught[plant.rules[0]!] ??= [0, 0]);
      tally[1]++;
      if (plantCaught(passage, plant, findings)) tally[0]++;
    }
  }
  assert.deepEqual(caught, { 'em-dash': [9, 9], colon: [6, 6], bold: [9, 14] });
  const marks: Record<string, number> = Object.fromEntries(rules.map(id => [id, 0]));
  for (const passage of set.human)
    for (const finding of await detect(passageDoc(passage), registry, judge, calibration, { rules }))
      marks[finding.rule]!++;
  assert.deepEqual(marks, Object.fromEntries(rules.map(id => [id, calibration.rules[id]!.humanMarks])));
});
