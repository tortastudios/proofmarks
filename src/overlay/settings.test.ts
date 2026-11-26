import test from 'node:test';
import assert from 'node:assert/strict';
import { companionStatusText, settingsState, strictnessText } from './settings';

test('a page with no proofs is ready after its first review, and rule switches stay in memory', () => {
  const empty = settingsState({ empty: true });
  assert.equal(empty.ready, false);
  assert.equal(empty.visible('contrast'), false);
  empty.finish();
  assert.equal(empty.ready, true);
  assert.equal(empty.visible('contrast'), true);
  assert.equal(empty.toggleRule('contrast'), false);
  assert.equal(empty.visible('contrast'), false);
  assert.equal(empty.visible('filler'), true);
  assert.equal(empty.toggleRule('contrast'), true);
  assert.equal(settingsState({ empty: false }).ready, true);
});

test('the judge line says who judges and whether it answers', () => {
  assert.equal(
    companionStatusText({ connected: true, provider: 'jev', model: 'jev-1.14.0' }),
    'jev · connected · jev-1.14.0',
  );
  assert.equal(
    companionStatusText({ connected: false, reason: 'Proofmarks companion is not running. Start proofmarks serve.' }),
    'Proofmarks companion is not running. Start proofmarks serve.',
  );
  assert.equal(companionStatusText(), 'Jev · not connected');
});

test("a rule's page says how this site has called its marks, and whether that moved its line", () => {
  const entry = { rule: 'contrast', base: 0.8 };
  assert.equal(strictnessText({ ...entry, line: 0.95, kept: 6, dismissed: 3 }), 'Stricter here: you dismissed 3 of 9.');
  assert.equal(strictnessText({ ...entry, line: 0.75, kept: 9, dismissed: 1 }), 'Looser here: you kept 9 of 10.');
  assert.equal(strictnessText({ ...entry, line: 0.8, kept: 2, dismissed: 1 }), 'You kept 2 and dismissed 1 so far.');
  assert.equal(strictnessText({ ...entry, line: 0.8, kept: 0, dismissed: 1 }), 'You dismissed 1 mark so far.');
  assert.equal(strictnessText({ ...entry, line: 0.8, kept: 3, dismissed: 0 }), 'You kept 3 marks so far.');
});
