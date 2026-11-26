import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadRegistry, registryErrors } from './registry';
import { labeledSet, labeledSetHash } from './labeled';

const registry = loadRegistry();
const clone = () => JSON.parse(JSON.stringify(registry)) as typeof registry;

test('the shipped registry is valid and keeps the essay labels', () => {
  assert.deepEqual(registryErrors(registry), []);
  const labels = new Map(registry.rules.map(r => [r.id, r.label]));
  assert.equal(labels.get('contrast'), 'Not X, but Y');
  assert.equal(labels.get('filler'), 'Filler');
  assert.equal(labels.get('three'), 'List of three');
  assert.equal(labels.get('inflated'), 'Inflated word');
  for (const level of ['word', 'sentence', 'paragraph'])
    assert.ok(
      registry.rules.some(r => r.default && r.level === level),
      `a default ${level} rule`,
    );
  for (const rule of registry.rules) {
    if (!rule.judge) assert.equal(rule.default, false, `${rule.id}: code-only rules are off by default`);
    if (rule.level === 'paragraph') assert.equal(rule.edit, 'paragraph');
  }
});

test('schema validation names each problem', () => {
  const broken = clone();
  broken.rules[0]!.label = '';
  (broken.rules[1] as { level: string }).level = 'chapter';
  broken.rules.push({ ...broken.rules[2]!, id: broken.rules[2]!.id });
  const contrast = broken.rules.find(r => r.id === 'contrast')!;
  contrast.detector = { kind: 'pattern', pattern: 'nope' };
  const inflated = broken.rules.find(r => r.id === 'inflated')!;
  inflated.judge = { ...inflated.judge!, ask: 'Is this inflated?' };
  const errors = registryErrors(broken).join('\n');
  assert.match(errors, /\(inflated\): label is required/);
  assert.match(errors, /\(filler\): level must be/);
  assert.match(errors, /duplicate id/);
  assert.match(errors, /unknown pattern "nope"/);
  assert.match(errors, /must name \{term\}/);
  assert.deepEqual(registryErrors({ version: '2', rules: [] }), [
    'version must be "3".',
    'rules must be a non-empty array.',
  ]);
});

test('the labeled set is frozen: its hash matches the manifest and every plant is in its passage', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../rules/labeled/MANIFEST.json', import.meta.url), 'utf8')) as {
    hash: string;
  };
  assert.equal(labeledSetHash(), manifest.hash);
  const set = labeledSet();
  const ids = new Set(registry.rules.map(r => r.id));
  for (const level of ['word', 'sentence', 'paragraph'])
    assert.ok(
      set.planted.flatMap(p => p.plants).filter(p => p.level === level).length >= 15,
      `at least 15 ${level} plants`,
    );
  assert.ok(set.human.length >= 12);
  for (const passage of set.planted)
    for (const plant of passage.plants) {
      if (plant.text) assert.ok(passage.text.includes(plant.text), `${passage.id}: ${plant.text}`);
      for (const rule of plant.rules) assert.ok(ids.has(rule), `${passage.id}: unknown rule ${rule}`);
    }
});
test('ink metadata is optional, but provided colors and marks must be valid', () => {
  const optional = clone();
  for (const rule of optional.rules) {
    delete rule.color;
    delete rule.mark;
  }
  assert.deepEqual(registryErrors(optional), []);
  const broken = clone();
  broken.rules[0]!.color = 'red';
  (broken.rules[1] as { mark: string }).mark = 'unknown';
  assert.match(registryErrors(broken).join('\n'), /color must be a six-digit hex ink/);
  assert.match(registryErrors(broken).join('\n'), /mark must be one of/);
});
