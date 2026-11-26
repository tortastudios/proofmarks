import test from 'node:test';
import assert from 'node:assert/strict';
import { registryReview } from './registry';
import { markPlan } from './marks';
import type { ProofmarksFinding, ProofmarksRule } from './types';
const rule: ProofmarksRule = { id: 'contrast', label: 'old name', color: '#994b52', mark: 'circle' };
const finding: ProofmarksFinding = { id: 'T', rule: 'contrast', match: 'A passage.' };
test('registry supplies names and explanations at read time without changing identities or ink', () => {
  const input = { rules: [rule, { ...rule, id: 'actor', label: 'name the actor' }], findings: [finding] };
  const normalized = registryReview(input);
  assert.equal(normalized.rules[0]!.label, 'Not X, but Y');
  assert.equal(normalized.rules[0]!.color, rule.color);
  assert.equal(normalized.rules[0]!.mark, 'circle');
  assert.equal(normalized.rules[0]!.why, 'Sets up a claim just to knock it down.');
  assert.equal(normalized.rules[1]!.label, 'Vague attribution');
  assert.equal(normalized.rules[1]!.id, 'actor');
  assert.equal(input.rules[0]!.label, 'old name');
});
test('edit vocabulary overrides decorative marks; replacement keeps seeded existing shapes', () => {
  assert.equal(markPlan(rule, finding, 1).mark, 'circle');
  assert.equal(markPlan(rule, finding, 3).mark, 'underline');
  assert.equal(markPlan(rule, { ...finding, rule: 'filler' }, 3).mark, 'strike-through');
  assert.equal(markPlan(rule, { ...finding, rule: 'attribution' }, 3).mark, 'caret');
  assert.equal(markPlan(rule, { ...finding, rule: 'generic-voice', edit: 'paragraph' }, 3).bracketOnly, true);
});

test('accepted marks describe settled text, including paragraph and delete findings', () => {
  for (const ruleId of ['contrast', 'filler', 'generic-voice'])
    assert.deepEqual(markPlan(rule, { ...finding, rule: ruleId, status: 'accepted' }, 3), {
      mark: 'underline',
      bracket: false,
    });
});
