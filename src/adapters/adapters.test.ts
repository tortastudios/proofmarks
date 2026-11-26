import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterFor, matchRegion } from './index';
test('HTML entities preserve offsets and round-trip safely; scripts/styles/comments/templates and attributes are excluded', () => {
  const source =
    '<p title="A &amp; B">A &amp; B &#x2014; ©.</p><script>A &amp; B</script><style>A &amp; B</style><!-- A &amp; B --><template>A &amp; B</template>';
  const adapter = adapterFor('html'),
    span = matchRegion(source, 'A & B — ©.', 'html');
  assert.equal(source.slice(span.start, span.end), 'A &amp; B &#x2014; ©.');
  const changed = adapter.apply(source, span, 'C < D & E.');
  assert.ok(changed.startsWith('<p title="A &amp; B">C &lt; D &amp; E.</p>'));
  assert.equal(
    adapter
      .regions(changed)
      .filter(r => r.editable)
      .map(r => r.text)
      .join(''),
    'C < D & E.',
  );
});
test('Jinja masks expressions, directives and comments, with editable text inside and outside blocks', () => {
  const source = '<p>Outside.</p>{% if user %}<p>Hello {{ user.name }}. Inside.</p>{% endif %}{# hidden #}';
  const adapter = adapterFor('jinja');
  assert.equal(
    adapter.apply(source, matchRegion(source, 'Outside.', 'jinja'), 'After.'),
    source.replace('Outside.', 'After.'),
  );
  assert.equal(
    source.slice(...(Object.values(matchRegion(source, '. Inside.', 'jinja')) as [number, number])),
    '. Inside.',
  );
  assert.throws(() => matchRegion(source, 'Hello {{ user.name }}. Inside.', 'jinja'), /template expression/);
  assert.throws(
    () =>
      adapter.apply(
        source,
        { start: source.indexOf('Hello'), end: source.indexOf('</p>', source.indexOf('Hello')) },
        'Unsafe',
      ),
    /template expression/,
  );
  assert.equal(adapter.regions(source).filter(r => !r.editable).length, 4);
});
test('Markdown adapters expose body plus supported frontmatter hidden copies', () => {
  const source =
    '---\ndescription: "Same sentence."\nsummary: Same sentence.\ntakeaways:\n  - Same sentence.\n---\nSame sentence.';
  const regions = adapterFor('mdx').regions(source);
  assert.equal(regions.filter(r => r.kind === 'meta').length, 3);
  assert.equal(regions[0]!.text, 'Same sentence.');
});

test('all named references decode, unclosed raw-text elements are excluded, and Jinja replacements stay text', () => {
  const adapter = adapterFor('html');
  assert.equal(adapter.regions('<p>&eacute; &NotEqualTilde; &AElig;</p>')[0]!.text, 'é ≂̸ Æ');
  assert.equal(adapter.regions('<script>Unclosed secret').filter(r => r.editable).length, 0);
  const jinja = adapterFor('jinja'),
    source = '<p>Hello.</p>';
  assert.equal(
    jinja.apply(source, matchRegion(source, 'Hello.', 'jinja'), '{{ expression }}'),
    '<p>&#123;&#123; expression &#125;&#125;</p>',
  );
});
