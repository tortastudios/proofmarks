import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptedText, deletionGap, indexText, matchVariants, normalize, rewriteAt } from './matcher';
import { markPlan } from './marks';
const text = (textContent: string) => ({ textContent }) as Text;
test('indexes whitespace and curly quotes across inline text nodes without changing offsets', () => {
  const a = text('The agents aren’t '),
    b = text('browsing.\n  They’re'),
    c = text(' buying.');
  const index = indexText([a, b, c]);
  assert.equal(index.text, "The agents aren't browsing. They're buying.");
  const start = index.text.indexOf('browsing');
  assert.deepEqual(index.starts[start], { node: b, offset: 0 });
  assert.deepEqual(index.ends[index.text.length - 1], { node: c, offset: c.textContent!.length });
  assert.equal(b.textContent, 'browsing.\n  They’re');
});
test('matches real-link text and a footnote citation projection from one finding', () => {
  assert.deepEqual(matchVariants('A claim ([A source](https://example.com/a), March 2026).'), [
    'A claim (A source, March 2026).',
    'A claim.',
  ]);
  assert.equal(normalize('“Hello”\n\tthere'), '"Hello" there');
});
test('review data accounts for all 15 findings and colors contrast with paper', async () => {
  const review = (await import('./fixtures/review.json')).default;
  assert.equal(review.findings.length, 15);
  assert.equal(new Set(review.findings.map(f => f.id)).size, 15);
  const lum = (s: string) =>
    s
      .slice(1)
      .match(/../g)!
      .map(v => parseInt(v, 16) / 255)
      .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  for (const rule of review.rules) {
    assert.ok((lum('#f4f0e8') + 0.05) / (lum(rule.color) + 0.05) > 4.5);
  }
  assert.ok(review.findings.every(f => review.rules.some(r => r.id === f.rule)));
});

test('mark policy keeps multiline rewrites readable and reserves strikes for deletions', async () => {
  const { markPlan } = await import('./marks');
  const finding = { id: 'T', rule: 'r', match: 'Short phrase.', proposed: 'Clear phrase.' };
  const rule = { id: 'r', label: 'rule', color: '#87532f', mark: 'circle' as const };
  assert.deepEqual(markPlan(rule, finding, 1), { mark: 'circle', bracket: false });
  assert.deepEqual(markPlan(rule, finding, 2), { mark: 'underline', bracket: true });
  assert.deepEqual(markPlan({ ...rule, mark: 'crossed-off' }, finding, 1), { mark: 'underline', bracket: false });
  assert.deepEqual(markPlan({ ...rule, mark: 'crossed-off' }, { ...finding, proposed: '' }, 1), {
    mark: 'crossed-off',
    bracket: false,
  });
  assert.deepEqual(markPlan(rule, { ...finding, match: 'Long passage. '.repeat(10) }, 1), {
    mark: 'underline',
    bracket: true,
  });
});

test('one curve points to the nearest span and leaves room for its label', async () => {
  const { arrowCurve } = await import('./arrows');
  const curve = arrowCurve({ x: 500, y: 100 }, [
    { left: 20, right: 200, top: 20, bottom: 40 },
    { left: 20, right: 300, top: 90, bottom: 110 },
  ])!;
  assert.deepEqual(curve.end, { x: 303, y: 100 });
  assert.ok(curve.first.x < 500 && curve.last.x < 500);
  assert.equal(arrowCurve({ x: 310, y: 100 }, [{ left: 20, right: 300, top: 90, bottom: 110 }]), null);
});
test('margin dimming is scoped, instant and inactive without the root flag', async () => {
  const { marginStyles } = await import('./margins');
  assert.equal(marginStyles([]), '');
  assert.match(
    marginStyles(['html[data-proofmarks-on] > body > aside']),
    /opacity: .3 !important; transition: none !important/,
  );
});

test('finding seeds remain stable across redraw order and distinguish mark parts', async () => {
  const { findingSeed } = await import('./drawing');
  const keys = ['U04:0:underline', 'U04:1:underline', 'U04:arrow', 'U03:0:underline'];
  const first = keys.map(findingSeed);
  assert.deepEqual([...keys].reverse().map(findingSeed).reverse(), first);
  assert.equal(new Set(first).size, keys.length);
  assert.ok(first.every(seed => Number.isInteger(seed) && seed > 0 && seed < 2147483647));
});

test('cursor cards use direct offsets, flip at right/bottom edges and clamp at every corner', async () => {
  const { cursorCardPosition: place } = await import('./card-position');
  assert.deepEqual(place(400, 200, 360, 300, 1440, 900), { x: 416, y: 220 });
  assert.deepEqual(place(1300, 200, 360, 300, 1440, 900), { x: 924, y: 220 });
  assert.deepEqual(place(400, 800, 360, 300, 1440, 900), { x: 416, y: 480 });
  for (const [x, y] of [
    [0, 0],
    [1439, 0],
    [0, 899],
    [1439, 899],
  ]) {
    const p = place(x!, y!, 360, 300, 1440, 900);
    assert.ok(p.x >= 8 && p.x + 360 <= 1432 && p.y >= 8 && p.y + 300 <= 892);
  }
});

test('finding hit unions fill line gaps without expanding ragged horizontal edges', async () => {
  const { findingHitRegion, containsPoint } = await import('./hit-region');
  const region = findingHitRegion([
    { left: 100, right: 200, top: 10, bottom: 30 },
    { left: 200, right: 400, top: 10, bottom: 30 },
    { left: 100, right: 250, top: 42, bottom: 62 },
    { left: 100, right: 190, top: 74, bottom: 94 },
  ]);
  assert.equal(region.length, 3);
  for (let y = 10; y <= 94; y++)
    assert.ok(
      region.some(r => containsPoint(r, 150, y)),
      `gap at ${y}`,
    );
  assert.equal(
    region.some(r => containsPoint(r, 300, 60)),
    false,
  );
  assert.equal(
    region.some(r => containsPoint(r, 99, 36)),
    false,
  );
  assert.deepEqual(findingHitRegion([]), []);
  assert.deepEqual(findingHitRegion([{ left: 1, right: 20, top: 2, bottom: 12 }]), [
    { left: 1, right: 20, top: 2, bottom: 12 },
  ]);
});

test('cursor placement holds each flipped axis until 24px of preferred room returns', async () => {
  const { cursorCardPosition: place } = await import('./card-position');
  const state = { left: false, above: false };
  const at = (roomX: number, roomY: number) =>
    place(1440 - 8 - 16 - 280 - roomX, 900 - 8 - 20 - 200 - roomY, 280, 200, 1440, 900, state);
  at(0, 0);
  assert.deepEqual(state, { left: false, above: false });
  at(-1, -1);
  assert.deepEqual(state, { left: true, above: true });
  for (const room of [1, -1, 12, -2, 23, 0]) {
    at(room, room);
    assert.deepEqual(state, { left: true, above: true });
  }
  at(24, 23);
  assert.deepEqual(state, { left: false, above: true });
  at(23, 24);
  assert.deepEqual(state, { left: false, above: false });
  at(0, 0);
  assert.deepEqual(state, { left: false, above: false });
});

test('unrendered metadata never creates a page range from an untagged body copy', async () => {
  const { findProofmarks } = await import('./matcher');
  let read = false;
  const node = { textContent: 'Same sentence.', parentElement: { closest: () => null, checkVisibility: () => true } };
  const root = {
    ownerDocument: {
      createTreeWalker: () => ({ nextNode: () => (read ? null : ((read = true), node)) }),
      createRange: () => {
        throw Error('Metadata must never create a range');
      },
    },
  } as unknown as HTMLElement;
  const [match] = findProofmarks(root, [
    { id: 'M', rule: 'r', match: 'Same sentence.', target: { kind: 'meta', field: 'summary' } },
  ]);
  assert.equal(match!.range, null);
});

test('body and metadata matches use separate DOM regions, including takeaway indexes', async () => {
  const { findProofmarks } = await import('./matcher');
  const region = (field: string, index?: number) => ({
    getAttribute: (name: string) =>
      name === 'data-proofmarks-meta' ? field : index === undefined ? null : String(index),
  });
  const summary = region('summary'),
    first = region('takeaways', 0),
    second = region('takeaways', 1);
  const node = (meta: ReturnType<typeof region> | null) => ({
    textContent: 'Same sentence.',
    length: 14,
    parentElement: {
      closest: (selector: string) => (selector === '[data-proofmarks-meta]' ? meta : null),
      checkVisibility: () => true,
    },
  });
  const nodes = [node(summary), node(first), node(second), node(null)];
  const root = {
    ownerDocument: {
      createTreeWalker: () => {
        let n = 0;
        return { nextNode: () => nodes[n++] ?? null };
      },
      createRange: () => ({
        startContainer: null as unknown,
        endContainer: null as unknown,
        setStart(node: unknown) {
          this.startContainer = node;
        },
        setEnd(node: unknown) {
          this.endContainer = node;
        },
      }),
    },
  } as unknown as HTMLElement;
  const base = { id: 'body', rule: 'r', match: 'Same sentence.' };
  const result = findProofmarks(root, [
    base,
    { ...base, id: 'summary', target: { kind: 'meta', field: 'summary' } },
    { ...base, id: 'takeaway', target: { kind: 'meta', field: 'takeaways', index: 1 } },
    { ...base, id: 'hidden', target: { kind: 'meta', field: 'description' } },
  ]);
  assert.equal(result[0]!.range!.startContainer, nodes[3]);
  assert.equal(result[1]!.range!.startContainer, nodes[0]);
  assert.equal(result[2]!.range!.startContainer, nodes[2]);
  assert.equal(result[3]!.range, null);
});

test('emphasis anchors across inline nodes and swaps only rendered text', async () => {
  const { findProofmarks } = await import('./matcher');
  const { replaceRangeText } = await import('./text-transaction');
  const { optimisticProse } = await import('./optimistic-prose');
  const text = (value: string) => ({
    nodeType: 3,
    nodeValue: value,
    get textContent() {
      return this.nodeValue;
    },
    get length() {
      return this.nodeValue.length;
    },
    parentElement: { closest: () => null, checkVisibility: () => true },
  });
  const nodes = [text('They’re getting '), text('used'), text('.')];
  const root = {
    ownerDocument: {
      createTreeWalker: () => {
        let n = 0;
        return { nextNode: () => nodes[n++] ?? null };
      },
      createRange: () => ({
        startContainer: null as unknown,
        endContainer: null as unknown,
        startOffset: 0,
        endOffset: 0,
        setStart(node: unknown, offset: number) {
          this.startContainer = node;
          this.startOffset = offset;
        },
        setEnd(node: unknown, offset: number) {
          this.endContainer = node;
          this.endOffset = offset;
        },
      }),
    },
  } as unknown as HTMLElement;
  const [match] = findProofmarks(root, [
    { id: 'J01', rule: 'r', match: "They're getting *used*.", proposed: "They're **useful**." },
  ]);
  assert.equal(match!.range!.startContainer, nodes[0]);
  assert.equal(match!.segments!.length, 3);
  const tx = replaceRangeText(match!.segments!, optimisticProse("They're **useful**.", 'They’re getting used.'));
  assert.equal(nodes.map(n => n.nodeValue).join(''), 'They’re useful.');
  assert.equal(nodes[1]!.nodeValue, '');
  tx.rollback();
  assert.equal(nodes.map(n => n.nodeValue).join(''), 'They’re getting used.');
});

test("an accepted deletion's gap is found from its context, as the page reads it", () => {
  const page = 'Our onboarding gets new hires working on their first day. Thanks for reading this far. Next paragraph.';
  // A word deleted mid-sentence: the gap sits right before "onboarding".
  assert.equal(
    deletionGap(page, { left: 'Our ', right: 'onboarding gets new hires working on their first day.' }),
    page.indexOf('onboarding'),
  );
  // The source has markdown the page doesn't; shorter contexts still meet.
  assert.equal(
    deletionGap(page, { left: 'first **day**. Thanks for reading this far.', right: '\n\nNext [paragraph](/p).' }),
    page.indexOf(' Next'),
  );
  assert.equal(deletionGap(page, { left: 'Nothing like this', right: 'appears anywhere' }), -1);
  // A context that meets twice is too short to place; a longer one decides.
  assert.equal(deletionGap('a b c. a b c. Done.', { left: 'a b c.', right: ' Done.' }), 'a b c. a b c.'.length);
});
test('an accepted rewrite is placed by its context, not by the first copy of its text', () => {
  const page = 'Not X, but Y. The update is small, but it changes how the whole team works.';
  const at = rewriteAt(page, {
    after: ', but',
    context: { left: '## Not X, but Y\n\nThe update is small', right: ' it changes how the whole team works.' },
  })!;
  assert.deepEqual([at.start, page.slice(at.start, at.end)], [page.lastIndexOf(', but'), ', but']);
  // A rewrite with its own space before it, and a right side a later accept changed: shorter context still places it.
  const teams = 'We use it. Teams use it daily.',
    use = rewriteAt(teams, {
      after: ' use',
      context: { left: 'Teams', right: ' it daily, and they utilize it weekly.' },
    })!;
  assert.deepEqual([use.start, teams.slice(use.start, use.end)], [teams.lastIndexOf('use'), 'use']);
  assert.equal(
    rewriteAt(page, { after: ', but', context: { left: 'Nothing like this', right: ' appears anywhere' } }),
    undefined,
  );
});
test('an accepted deletion that left nothing gets a caret, and an opener its next word', () => {
  const rule = { id: 'signpost', label: 'Signposting', color: '#75642f', mark: 'strike-through' as const };
  const base = { id: 'F', rule: 'signpost', match: "Here's the thing", status: 'accepted' as const, proposed: '' };
  assert.equal(markPlan(rule, { ...base, after: '' }, 1).mark, 'caret');
  assert.equal(acceptedText({ ...base, after: 'Most' }), 'Most');
  assert.equal(markPlan(rule, { ...base, after: 'Most' }, 1).mark, 'underline');
  assert.equal(acceptedText({ ...base, proposed: 'A rewrite.', after: 'A rewrite.' }), 'A rewrite.');
});
