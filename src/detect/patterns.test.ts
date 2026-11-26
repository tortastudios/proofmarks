import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATTERNS } from './patterns';
import { projectMdx, projectText, sentences } from './segment';

/** Marked text (and focus, when the pattern sets one) for one pattern over one paragraph. */
function run(pattern: string, text: string) {
  const block = projectText(text)[0]!;
  return PATTERNS[pattern]!({ block, sentences: sentences(block), source: text }).map(h => ({
    marked: block.text.slice(h.start, h.end),
    focus: h.focusStart === undefined ? undefined : block.text.slice(h.focusStart, h.focusEnd),
  }));
}
const marked = (pattern: string, text: string) => run(pattern, text).map(h => h.marked);
/** Marked text for one pattern over Markdown, where headings and bold exist. */
const markedMdx = (pattern: string, text: string) =>
  projectMdx(text).flatMap(block =>
    PATTERNS[pattern]!({ block, sentences: sentences(block), source: text }).map(h => block.text.slice(h.start, h.end)),
  );

test('contrast: pair, one sentence with or without "but", less/more, and the last sentence', () => {
  assert.deepEqual(marked('contrast', "They aren't browsing. They're buying."), [
    "They aren't browsing. They're buying.",
  ]);
  assert.deepEqual(marked('contrast', 'This requires not that the writer be short but that every word tell.'), [
    'This requires not that the writer be short but that every word tell.',
  ]);
  assert.deepEqual(marked('contrast', "Work hard. It's not about doing more — it's about doing what matters."), [
    "It's not about doing more — it's about doing what matters.",
  ]);
  assert.deepEqual(marked('contrast', "It isn't a design problem; it's a trust problem."), [
    "It isn't a design problem; it's a trust problem.",
  ]);
  assert.deepEqual(marked('contrast', "Our customers don't buy software, they buy outcomes. And more."), [
    "Our customers don't buy software, they buy outcomes.",
  ]);
  assert.deepEqual(
    marked('contrast', 'The real question is less about which tool you pick and more about how you use it.'),
    ['The real question is less about which tool you pick and more about how you use it.'],
  );
  assert.deepEqual(
    marked('contrast', 'Not because she rebuilt her product. Because she built a second product alongside it.'),
    ['Not because she rebuilt her product. Because she built a second product alongside it.'],
  );
});

test('contrast: plain negation, conditions and long sentences are not candidates', () => {
  assert.deepEqual(marked('contrast', "Priya has users. She's not alone."), []);
  assert.deepEqual(
    marked('contrast', "If you're not in this stack, we think agents will pick a competitor that is."),
    [],
  );
  assert.deepEqual(
    marked(
      'contrast',
      "It stays because your uptime is high, your latency is low, and you haven't broken compatibility in six whole months of steady work. That's the model.",
    ),
    [],
  );
  assert.deepEqual(marked('contrast', 'The agents are buying. Revenue grew.'), []);
});

test('list of three: inline, repeated word, and three short fragments, but not longer runs', () => {
  assert.deepEqual(
    run('three', 'Fast, flexible, and secure, Relay fits your work.').map(h => h.focus),
    ['Fast, flexible, and secure'],
  );
  assert.deepEqual(marked('three', 'Steady calls, no mood, no drift.'), ['Steady calls, no mood, no drift.']);
  assert.deepEqual(marked('three', 'We sell apples, pears, plums, and grapes.'), []);
  assert.deepEqual(
    marked(
      'three',
      'We have said this many times before. Speed matters. Focus matters. Clarity matters most. That is all we said today.',
    ),
    ['Speed matters. Focus matters. Clarity matters most.'],
  );
  assert.deepEqual(
    marked('three', 'Onboarding tours. Push notifications. Habit loops. Dark patterns. Social proof.'),
    [],
  );
  assert.deepEqual(
    marked(
      'three',
      'Copy-paste code for beginners. Detailed API reference for intermediates. Custom integration patterns for enterprises.',
    ),
    [
      'Copy-paste code for beginners. Detailed API reference for intermediates. Custom integration patterns for enterprises.',
    ],
  );
});

test('trailing -ing clause, but not participle lists or prepositions', () => {
  assert.deepEqual(
    run('trailing', 'Revenue doubled, cementing its position as a leader.').map(h => h.focus),
    ['cementing its position as a leader'],
  );
  assert.deepEqual(
    marked('trailing', 'Agents pulling data, cross-referencing records, generating docs before every call.'),
    [],
  );
  assert.deepEqual(marked('trailing', 'Five teams joined, including ours.'), []);
});

test('stacked hedges, vague attribution and false ranges', () => {
  assert.deepEqual(
    run('hedging', 'This could potentially help some teams.').map(h => h.focus),
    ['could potentially'],
  );
  assert.deepEqual(marked('hedging', 'This may help.'), []);
  assert.deepEqual(
    run('attribution', 'Studies show that people prefer it.').map(h => h.focus),
    ['Studies show'],
  );
  assert.deepEqual(
    run('false-range', 'From solo freelancers to Fortune 500 companies, everyone trusts us.').map(h => h.focus),
    ['From solo freelancers to Fortune 500 companies'],
  );
  assert.deepEqual(marked('false-range', 'Traffic rose from 2019 to 2024, and it happens from time to time.'), []);
});

test('uniform rhythm needs four or more even sentences or a repeated opener', () => {
  assert.equal(
    marked('rhythm', 'We start with research. We talk to users. We map their problems. We ship what works.').length,
    1,
  );
  assert.equal(
    marked(
      'rhythm',
      'Short one. Then a much longer sentence that wanders before it arrives somewhere useful at last. Ok. Fine then, this one is medium length.',
    ).length,
    0,
  );
});

// The four rules a project turns on.
test('em dash: spaced or not, a spaced en dash and a double hyphen, but not ranges or hyphens', () => {
  // The mark runs from the dash to the next word, so a rewrite can fix the capital too.
  assert.deepEqual(marked('em-dash', 'The update is small — but it changes everything.'), ['— but']);
  assert.deepEqual(
    run('em-dash', 'The update is small — but it changes everything.').map(h => h.focus),
    ['—'],
  );
  assert.deepEqual(marked('em-dash', 'Some years ago—never mind how long—I went to sea.'), ['—never', '—I']);
  assert.deepEqual(marked('em-dash', 'Fast – and cheap.'), ['– and']);
  assert.deepEqual(marked('em-dash', 'A long-term plan -- with a catch.'), ['-- with']);
  assert.deepEqual(marked('em-dash', 'It went on and on—'), ['—']);
  assert.deepEqual(marked('em-dash', 'It ran 1998–2004 and cost $5–10 for a well-known tool.'), []);
});

test('connecting colon: a colon inside a sentence, but not times, quotations or a closing colon', () => {
  assert.deepEqual(
    run('colon', 'The answer was simple: we stopped holding meetings.').map(h => h.focus),
    [':'],
  );
  assert.deepEqual(marked('colon', 'We met at 3:30 and left at 4:15.'), []);
  assert.deepEqual(marked('colon', 'She said: "No."'), []);
  assert.deepEqual(marked('colon', 'Here is what you need:'), []);
});

test('connecting colon: not the colon of a bold label that opens a paragraph or list item', () => {
  const focus = (text: string) =>
    projectMdx(text).flatMap(block =>
      PATTERNS.colon!({ block, sentences: sentences(block), source: text }).map(h =>
        block.text.slice(h.focusStart, h.focusEnd! + 12),
      ),
    );
  assert.deepEqual(focus('**No documentation:** Some tasks are never written down.'), []);
  assert.deepEqual(focus('**7:00 a.m.:** Rise and shine.'), []);
  assert.deepEqual(focus('- **Speed**: pages load in half the time.'), []);
  assert.deepEqual(focus('**No documentation:** The cause was simple: nobody owned it.'), [': nobody owne']);
});

test('title case: headings with most words capitalized, but not sentence case or names', () => {
  assert.deepEqual(markedMdx('title-case', '## How We Rebuilt Our Onboarding Flow'), [
    'How We Rebuilt Our Onboarding Flow',
  ]);
  assert.deepEqual(markedMdx('title-case', '## The Death Trap of Hallucinations'), [
    'The Death Trap of Hallucinations',
  ]);
  assert.deepEqual(markedMdx('title-case', '## How we rebuilt our onboarding flow'), []);
  // Names with a capital inside them don't make a heading title case.
  assert.deepEqual(markedMdx('title-case', '## Working with GitHub and LinkedIn'), []);
  assert.deepEqual(markedMdx('title-case', 'How We Rebuilt Our Onboarding Flow, in a paragraph.'), []);
});

test('bold: each bold phrase in running text, but not a lead-in label or a heading', () => {
  assert.deepEqual(markedMdx('bold', 'Every plan includes **unlimited** projects.'), ['unlimited']);
  assert.deepEqual(markedMdx('bold', 'This is **really** **important** for **everyone**.'), [
    'really',
    'important',
    'everyone',
  ]);
  assert.deepEqual(markedMdx('bold', '- **Speed:** pages load in half the time.'), []);
  assert.deepEqual(markedMdx('bold', '- **Self-service** to reach those services quickly'), []);
  assert.deepEqual(markedMdx('bold', '**No documentation:** Some tasks are never written down.'), []);
  assert.deepEqual(markedMdx('bold', '**Optimized services:** a suite that is **really** fast.'), ['really']);
  // A bold sentence that opens a paragraph is emphasis, not a label.
  assert.deepEqual(markedMdx('bold', '**This changes everything.** Support and product see the same data.'), [
    'This changes everything.',
  ]);
  assert.deepEqual(markedMdx('bold', '## **Pricing**'), []);
});
