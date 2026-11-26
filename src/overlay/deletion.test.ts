import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replacementStart, tidyDeletion } from './deletion';

/** Delete `marked` from `text` the way Accept does, tidied. */
const remove = (text: string, marked: string, unique?: Parameters<typeof tidyDeletion>[3]) => {
  const at = text.indexOf(marked),
    t = tidyDeletion(text, at, at + marked.length, unique);
  return text.slice(0, t.start) + t.after + text.slice(t.end);
};

test('a whole sentence goes with its period and one space', () => {
  assert.equal(remove('We learned along the way. Let’s dive in.\n', 'Let’s dive in'), 'We learned along the way.\n');
  assert.equal(remove("Let's dive in. The rest was setup.", "Let's dive in"), 'The rest was setup.');
  assert.equal(remove('Thanks.\n\nFeel free to reach out!\n', 'Feel free to reach out!'), 'Thanks.\n\n\n');
  assert.equal(remove('- Let’s dive in.\n- Next', 'Let’s dive in'), '- \n- Next');
  assert.equal(remove('<p>Intro. Let’s dive in.</p>', 'Let’s dive in'), '<p>Intro.</p>');
});

test('an opener takes its comma, and the next word starts the sentence', () => {
  assert.equal(
    remove("It's worth noting that this is a common pattern. Experts agree.", "It's worth noting that"),
    'This is a common pattern. Experts agree.',
  );
  assert.equal(
    remove('At the end of the day, fast CI is about speed.', 'At the end of the day'),
    'Fast CI is about speed.',
  );
  assert.equal(remove('Notably, Docker builds took eight minutes.', 'Notably'), 'Docker builds took eight minutes.');
});

test('an opener takes a colon, semicolon or dash the same way', () => {
  assert.equal(
    remove("Here's the thing: most teams never read their own documentation.", "Here's the thing"),
    'Most teams never read their own documentation.',
  );
  assert.equal(remove('Here’s why; the build was slow.', 'Here’s why'), 'The build was slow.');
  assert.equal(remove('Here’s the kicker — nobody noticed.', 'Here’s the kicker'), 'Nobody noticed.');
  assert.equal(remove('Plans changed. Here’s why: costs rose.', 'Here’s why'), 'Plans changed. Costs rose.');
});

test('a capitalized opener grows until its text is unique, or stays a plain deletion', () => {
  const text = 'Honestly, this is it. This is it too.';
  const seen = (after: string, start: number, end: number) => {
    const result = text.slice(0, start) + after + text.slice(end);
    return result.indexOf(after) === result.lastIndexOf(after);
  };
  const at = text.indexOf('Honestly');
  // 'This' and 'This is' appear twice once capitalized; 'This is it.' doesn't.
  assert.deepEqual(tidyDeletion(text, at, at + 8, seen), { start: 0, end: 21, after: 'This is it.' });
  const never = tidyDeletion(text, at, at + 8, () => false);
  assert.deepEqual(never, { start: 0, end: 10, after: '' });
});

test('mid-sentence, no double space or orphaned comma is left', () => {
  assert.equal(remove('A seamless sync tool.', 'seamless'), 'A sync tool.');
  assert.equal(remove('A seamless, quick tool.', 'seamless'), 'A quick tool.');
  assert.equal(remove('It is fast, highlighting our care.', 'highlighting our care'), 'It is fast.');
  assert.equal(remove('A tool , really.', 'really'), 'A tool.');
  assert.equal(remove('Shipped, making it easy.', ', making it easy'), 'Shipped.');
});

test('a rewrite that opens with punctuation takes the space before its mark', () => {
  const text = 'The update is small — but it changes everything.',
    at = text.indexOf('—');
  assert.equal(replacementStart(text, at, ', but'), at - 1);
  assert.equal(replacementStart(text, at, '. But'), at - 1);
  // Words keep the space; an unspaced dash has none to take; a soft line break goes, a blank line stays.
  assert.equal(replacementStart(text, at, 'and'), at);
  assert.equal(replacementStart('small—but', 5, ', but'), 5);
  assert.equal(replacementStart('small\n— but', 6, ', but'), 5);
  assert.equal(replacementStart('small\n\n— but', 7, ', but'), 7);
});
