import { avoidDockObstacles } from './badge-dock';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockSlots, overlaps, projected, resist } from './badge-dock';
test('docking excludes occupied slots and retains header and home-indicator clearance', () => {
  const obstacle = { left: 0, top: 800, right: 360, bottom: 900 };
  const slots = dockSlots(1440, 900, 88, 12, false, [obstacle]);
  assert.equal(slots.length, 3);
  assert.ok(!slots.some(s => s.slot === 'bottom-left'));
  assert.ok(
    slots.every(s => s.y >= 88 && !overlaps({ left: s.x, top: s.y, right: s.x + 146, bottom: s.y + 46 }, obstacle)),
  );
  const mobile = dockSlots(375, 844, 88, 46, true, []);
  assert.equal(mobile.length, 3);
  assert.ok(mobile.every(s => s.slot.startsWith('bottom') && s.y + 46 === 798));
});
test('release projection uses pixels per millisecond and resistance affects only overshoot', () => {
  assert.equal(projected(100, 0), 100);
  assert.equal(projected(100, 1), 599);
  assert.equal(projected(100, -1), -399);
  assert.equal(resist(40, 10, 100), 40);
  assert.equal(resist(125, 10, 100), 110);
  assert.equal(resist(-15, 10, 100), 0);
});
import { glideProgress } from './card-position';
test('return approach uses bounded monotonic house easing with exact endpoints', () => {
  assert.equal(glideProgress(0), 0);
  assert.equal(glideProgress(1), 1);
  let last = 0;
  for (let i = 1; i <= 180; i++) {
    const next = glideProgress(i / 180);
    assert.ok(next >= last && next <= 1);
    last = next;
  }
  assert.ok(glideProgress(0.5) > 0.95);
});
test('pill and circle use their measured width at each edge and center slot', () => {
  for (const width of [46, 148, 182]) {
    const slots = dockSlots(390, 844, 80, 46, true, [], width);
    assert.equal(slots.length, 3);
    assert.equal(slots[0]!.x, 12);
    assert.equal(slots[1]!.x + width / 2, 195);
    assert.equal(slots[2]!.x + width, 378);
  }
  const blocker = { left: 300, top: 750, right: 390, bottom: 844 };
  assert.ok(!dockSlots(390, 844, 80, 12, true, [blocker], 46).some(s => s.slot === 'bottom-right'));
});

import { pinnedCardPosition } from './card-position';
test('expanded pins clamp all edges and choose the less overflowing vertical side', () => {
  for (const point of [
    { x: 1268, y: 880 },
    { x: 1268, y: 90 },
    { x: 40, y: 450 },
  ]) {
    const state = { left: false, above: false };
    const p = pinnedCardPosition(point.x, point.y, 330, 640, 1280, 900, state);
    assert.ok(p.x >= 12 && p.x + 330 <= 1268);
    assert.ok(p.y >= 12 && p.y + 640 <= 888);
  }
  const state = { left: false, above: false };
  assert.deepEqual(pinnedCardPosition(1268, 880, 330, 1200, 1280, 900, state), { x: 922, y: 12 });
  const nearTop = { left: false, above: false };
  pinnedCardPosition(600, 280, 330, 700, 1280, 900, nearTop);
  assert.equal(nearTop.above, false);
});

import { cursorCardPosition } from './card-position';
test('a following card moves back to the side with room', () => {
  const side = { left: true, above: true };
  assert.deepEqual(cursorCardPosition(700, 500, 330, 250, 1440, 900, side), { x: 716, y: 520 });
  assert.deepEqual(side, { left: false, above: false });
});

test('desktop offers only four corners while mobile retains bottom center', () => {
  assert.deepEqual(
    dockSlots(1440, 900, 88, 12, false, []).map(s => s.slot),
    ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  );
  assert.deepEqual(
    dockSlots(375, 844, 88, 12, true, []).map(s => s.slot),
    ['bottom-left', 'bottom-center', 'bottom-right'],
  );
});

test('an occupied dock corner shifts along its edge without changing identity', () => {
  const moved = avoidDockObstacles(
    { slot: 'bottom-left' as const, x: 12, y: 842 },
    [{ left: 20, right: 175, top: 840, bottom: 880 }],
    46,
  );
  assert.deepEqual(moved, { slot: 'bottom-left', x: 12, y: 786 });
});

import { badgeInkClip } from './badge-dock';
test('close ends at the painted circle or capsule, not the 46px pointer slot', () => {
  assert.equal(badgeInkClip(330, 300, 284, 254, 44, 44), 'inset(258px 6px 6px 288px round 18px)');
  assert.equal(badgeInkClip(330, 300, 0, 0, 44, 44), 'inset(4px 290px 260px 4px round 18px)');
  assert.equal(badgeInkClip(330, 300, 212, 0, 116, 44), 'inset(4px 6px 260px 216px round 18px)');
});

import { inkDissolveDelay } from './card-position';
test('ink stays opaque until the eased close clip is within one pixel of its circle', () => {
  for (const [w, h] of [
    [330, 275],
    [330, 840],
    [330, 1800],
  ]) {
    const delay = inkDissolveDelay(w!, h!),
      distance = Math.max(w! - 36, h! - 36);
    assert.ok(delay > 90 && delay < 150);
    assert.ok(distance * (1 - glideProgress(delay / 150)) <= 1);
    assert.ok(distance * (1 - glideProgress((delay - 1) / 150)) > 1);
  }
});
