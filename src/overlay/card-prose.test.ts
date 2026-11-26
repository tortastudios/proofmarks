import test from 'node:test';
import assert from 'node:assert/strict';
import { cardProse } from './card-prose';

test('card prose renders link labels, emphasis and citations with page typography without changing source', () => {
  const finding = Object.freeze({
    match: `"Don't" **hide** the *evidence*: [Stacklok's _survey_](https://example.org/report_(final).pdf) ([State of MCP in Software 2026](https://stacklok.com/report.pdf), January 2026).`,
  });
  const original = finding.match;
  assert.equal(
    cardProse(finding.match),
    '“Don’t” hide the evidence: Stacklok’s survey (State of MCP in Software 2026, January 2026).',
  );
  assert.equal(finding.match, original);
  assert.equal(
    cardProse('Keep snake_case and 2 * 3; `"literal"` and \\*stars\\*.'),
    'Keep snake_case and 2 * 3; "literal" and *stars*.',
  );
});

test('one reader projection handles inline forms, escaped punctuation and literal code', async () => {
  const { matchVariants } = await import('./matcher');
  const { optimisticProse } = await import('./optimistic-prose');
  for (const [source, plain] of [
    ['*used*', 'used'],
    ['_used_', 'used'],
    ['**used**', 'used'],
    ['__used__', 'used'],
    ['`used`', 'used'],
    ['[used](https://example.com/a_(b))', 'used'],
    ['\\*used\\*', '*used*'],
    ['\\[used](https://example.com)', '[used](https://example.com)'],
    ['`*used*`', '*used*'],
    ['`[x](url)`', '[x](url)'],
    ['[\\*used\\*](https://example.com)', '*used*'],
    ['[`used`](https://example.com)', 'used'],
    ['\\> used', '> used'],
    ['`` a ` b ``', 'a ` b'],
  ]) {
    assert.equal(cardProse(source!), plain);
    assert.equal(matchVariants(source!)[0], plain);
    assert.equal(optimisticProse(source!, plain!), plain);
  }
});
