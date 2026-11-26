import test from 'node:test';
import assert from 'node:assert/strict';
import { tooltipDelay, tooltipPosition, uncoveredBox } from './tooltips';
test('tooltip intent waits initially, transfers immediately, and resets after 600ms away', () => {
  assert.equal(tooltipDelay(100, 0, false), 400);
  assert.equal(tooltipDelay(100, Infinity, false), 0);
  assert.equal(tooltipDelay(699, 700, false), 0);
  assert.equal(tooltipDelay(701, 700, false), 400);
  assert.equal(tooltipDelay(100, 0, true), 0);
});
test('tooltips stay clear of control text, flip below the top edge, and clamp horizontally', () => {
  assert.deepEqual(tooltipPosition({ left: 10, right: 40, top: 50, bottom: 94 }, 80, 26, 1280), { left: 8, top: 16 });
  assert.deepEqual(tooltipPosition({ left: 1230, right: 1274, top: 8, bottom: 52 }, 80, 26, 1280), {
    left: 1192,
    top: 60,
  });
});
test('header tips prefer outside the card and avoid pilcrow, toggle and neighboring controls', () => {
  const r = { left: 1200, right: 1228, top: 138, bottom: 182 },
    header = { left: 938, right: 1268, top: 84, bottom: 182 };
  assert.deepEqual(
    tooltipPosition(r, 72, 29, 1280, {
      height: 900,
      header,
      obstacles: [{ left: 1224, right: 1268, top: 84, bottom: 128 }],
    }),
    { left: 1178, top: 47 },
  );
  const edge = { ...header, top: 8 };
  assert.deepEqual(tooltipPosition(r, 72, 29, 1280, { height: 900, header: edge }), { left: 1178, top: 190 });
  const blocked = { left: 1170, right: 1260, top: 190, bottom: 234 };
  const p = tooltipPosition(r, 72, 29, 1280, { height: 900, header: edge, obstacles: [blocked] })!;
  assert.ok(p.left + 72 <= header.left - 4 || p.top >= blocked.bottom + 4);
});

test('footer tooltip uses an adjacent side when actions and page links block above and below', () => {
  const r = { left: 146, right: 207, top: 323, bottom: 363 };
  const p = tooltipPosition(r, 81, 29, 1440, {
    height: 900,
    obstacles: [
      { left: 26, right: 180, top: 267, bottom: 307 },
      { left: 205, right: 400, top: 375, bottom: 400 },
      { left: 302, right: 342, top: 321, bottom: 365 },
    ],
  });
  assert.deepEqual(p, { left: 211, top: 328.5 });
});

test('page controls behind the ink card do not push its tooltips away', () => {
  assert.deepEqual(
    uncoveredBox({ left: 205, right: 400, top: 300, bottom: 340 }, { left: 12, right: 342, top: 84, bottom: 373 }),
    [{ left: 342, right: 400, top: 300, bottom: 340 }],
  );
});

test('card hints sit outside the complete surface, never over its copy', () => {
  const r = { left: 1200, right: 1260, top: 400, bottom: 440 },
    surface = { left: 1098, right: 1428, top: 84, bottom: 700 };
  assert.deepEqual(tooltipPosition(r, 80, 20, 1440, { height: 900, surface, side: 'right' }), { left: 1010, top: 410 });
  const leftSurface = { left: 12, right: 342, top: 84, bottom: 700 };
  assert.deepEqual(
    tooltipPosition({ ...r, left: 100, right: 160 }, 80, 20, 1440, { height: 900, surface: leftSurface, side: 'left' }),
    { left: 350, top: 410 },
  );
});

test("with both sides taken, a card title's hint goes above the card, the end nearer the title", () => {
  const title = { left: 1110, right: 1190, top: 440, bottom: 470 },
    surface = { left: 1086, right: 1416, top: 430, bottom: 760 },
    tabs = [{ left: 1046, right: 1086, top: 444, bottom: 476 }];
  assert.deepEqual(tooltipPosition(title, 55, 22, 1440, { height: 900, surface, side: 'right', obstacles: tabs }), {
    left: 1122.5,
    top: 400,
  });
  const action = { ...title, top: 720, bottom: 750 },
    beside = [{ left: 1000, right: 1086, top: 700, bottom: 770 }];
  assert.deepEqual(tooltipPosition(action, 55, 22, 1440, { height: 900, surface, side: 'right', obstacles: beside }), {
    left: 1122.5,
    top: 768,
  });
});
