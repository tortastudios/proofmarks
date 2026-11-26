import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readerActionReason } from './action-reason';
test('locked-proof reasons use reader language, with no diagnostic fallback leakage', () => {
  for (const reason of [
    'The source match is ambiguous (more than once).',
    'Applied text is ambiguous; cannot revert safely.',
  ])
    assert.equal(
      readerActionReason(reason),
      "This sentence appears more than once in the file, so it can't be edited from here.",
    );
  for (const reason of [
    'Source text no longer matches this finding.',
    'Applied text has changed; cannot revert safely.',
    'The source match is empty.',
  ])
    assert.equal(readerActionReason(reason), 'The text changed since this proof was made.');
  for (const reason of ['No nonempty rewrite is available.', 'Empty rewrite.'])
    assert.equal(readerActionReason(reason), 'No rewrite yet.');
  const stale = 'Another copy of this sentence changed. Reload to try again.';
  assert.equal(readerActionReason(stale), stale);
  for (const reason of ['Exact revert history is missing.', 'Internal error /private/file', ''])
    assert.equal(readerActionReason(reason), "This proof can't be applied right now.");
});
