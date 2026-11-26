import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutMarginLabels, marginLabelLeft } from './label-layout';
const label = (id: string, anchor: number, anchorLeft = 400) => ({
  id,
  anchor,
  anchorLeft,
  left: 1200,
  width: 148,
  height: 34,
});
test('uncrowded labels align to their mark in one column', () => {
  assert.deepEqual(
    layoutMarginLabels([label('later', 300), label('earlier', 100)]).map(r => [r.id, r.left, r.top]),
    [
      ['earlier', 1200, 100],
      ['later', 1200, 300],
    ],
  );
});
test('same-line labels stack in mark order with a six pixel gap', () => {
  assert.deepEqual(
    layoutMarginLabels([label('later', 100, 700), label('earlier', 100, 400)]).map(r => [r.id, r.left, r.top]),
    [
      ['earlier', 1200, 100],
      ['later', 1200, 140],
    ],
  );
});
test('neighbouring lines move down only far enough to clear their predecessor', () => {
  assert.deepEqual(
    layoutMarginLabels([label('a', 100), label('b', 120), label('c', 300)]).map(r => r.top),
    [100, 140, 300],
  );
});
test('all twelve labels reserve space without hiding, clamping or wrapping', () => {
  assert.deepEqual(
    layoutMarginLabels(Array.from({ length: 12 }, (_, i) => label(String(i), 800, 400 + i))).map(r => [r.left, r.top]),
    Array.from({ length: 12 }, (_, i) => [1200, 800 + i * 40]),
  );
});
test('off-screen predecessors still reserve space in the static layout', () => {
  assert.deepEqual(
    layoutMarginLabels([label('above', -20), label('partial', 0), label('below', 901)]).map(r => r.top),
    [-20, 20, 901],
  );
});
test('subpixel differences on a rendered line retain mark order', () => {
  assert.deepEqual(
    layoutMarginLabels([label('right', 100, 700), label('left', 100.5, 400)]).map(r => [r.id, r.top]),
    [
      ['left', 100.5],
      ['right', 140.5],
    ],
  );
});
test('layout does not mutate its input', () => {
  const labels = [label('b', 100, 700), label('a', 100, 400)],
    before = JSON.stringify(labels);
  layoutMarginLabels(labels);
  assert.equal(JSON.stringify(labels), before);
});
test('the prose gutter and existing marginalia yield the sample and approved essay columns', () => {
  assert.equal(marginLabelLeft(1060, false, 1440), 1068);
  assert.equal(marginLabelLeft(980, false, 1280), 988);
  assert.equal(marginLabelLeft(1010, true, 1440), 1276);
  assert.equal(marginLabelLeft(930, true, 1280), 1116);
});
test('one label per line: same-line marks share the first label, which counts the rest; lines stack and never overlap', async () => {
  const { layoutLineLabels, lineLabelWidth, lineRows } = await import('./label-layout');
  // Three marks on the line at 100 (out of order), one on 120 (pushed below), one well clear at 400.
  const placed = layoutLineLabels([
    label('c', 100, 900),
    label('a', 100, 380),
    label('b', 100, 700),
    label('d', 120, 380),
    label('e', 400, 500),
  ]);
  assert.deepEqual(
    placed.map(p => [p.id, p.left, p.top, p.hidden ?? false, p.count ?? null, p.head ?? null]),
    [
      ['a', 1200, 100, false, 3, null],
      ['b', 1200, 100, true, null, 'a'],
      ['c', 1200, 100, true, null, 'a'],
      ['d', 1200, 140, false, 1, null],
      ['e', 1200, 400, false, 1, null],
    ],
  );
  // Within a pixel is the same line, as rendered lines can differ by subpixels.
  assert.deepEqual(
    lineRows([label('x', 100.4, 600), label('y', 100.9, 300)]).map(row => row.map(l => l.id)),
    [['y', 'x']],
  );
  assert.deepEqual([lineLabelWidth(336), lineLabelWidth(148), lineLabelWidth(-4)], [200, 148, 0]);
  // An open proof owns the shared label even after a decided one to its left.
  assert.deepEqual(
    layoutLineLabels([{ ...label('done', 100, 300), rank: 1 }, label('open', 100, 600)]).map(p => [
      p.id,
      p.hidden ?? false,
      p.count ?? null,
    ]),
    [
      ['open', false, 2],
      ['done', true, null],
    ],
  );
});
