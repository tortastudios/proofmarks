import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLineRects } from './line-geometry';
const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
test('em, link and code text fragments merge into one stable rect per line', () => {
  const plain = rect(20, 100, 150, 123),
    em = rect(150, 99, 190, 124),
    link = rect(190, 100, 240, 123),
    code = rect(240, 101, 280, 122),
    next = rect(20, 132, 100, 155);
  const expected = [rect(20, 99, 280, 124), next];
  assert.deepEqual(mergeLineRects([plain, em, link, code, next]), expected);
  assert.deepEqual(mergeLineRects([next, code, em, plain, link, plain]), expected);
});

test('DOMRect prototype accessors retain their coordinates', () => {
  const inherited = Object.create({ left: 20, right: 150, top: 100, bottom: 123 });
  assert.deepEqual(mergeLineRects([inherited, rect(150, 100, 190, 123)]), [rect(20, 100, 190, 123)]);
});
