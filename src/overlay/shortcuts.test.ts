import test from 'node:test';
import assert from 'node:assert/strict';
import { proofShortcut } from './shortcuts';
const state = { editable: false, card: true, pill: true, help: false, badgeExpanded: false };
const key = (key: string, extra = {}) => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  repeat: false,
  ...extra,
});
test('approved keys and contextual navigation', () => {
  for (const [k, want] of Object.entries({
    o: 'overview',
    i: 'why',
    ',': 'settings',
    p: 'toggle-card',
    n: 'next-open',
    ArrowLeft: 'previous',
    ArrowRight: 'next',
    a: 'accept',
    d: 'dismiss',
    u: 'undo',
    Escape: 'escape',
    '?': 'help',
  }))
    assert.equal(proofShortcut(key(k), state), want);
  assert.equal(proofShortcut(key('P', { shiftKey: true }), state), 'toggle-marks');
  assert.equal(proofShortcut(key('N', { shiftKey: true }), state), 'previous-open');
  for (const k of ['ArrowUp', 'ArrowDown', 's', 'r']) assert.equal(proofShortcut(key(k), state), undefined);
  for (const k of ['a', 'd', 'u', 'r', 'ArrowLeft', 'ArrowRight'])
    assert.equal(proofShortcut(key(k), { ...state, card: false }), undefined);
  for (const k of ['r']) assert.equal(proofShortcut(key(k), { ...state, pill: false }), undefined);
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
    assert.equal(proofShortcut(key(k, { altKey: true }), state), 'dock');
});
test('editable, IME, modifiers, repeats and other interface keys pass through without a command', () => {
  for (const k of ['i', 'p', 'n', 'a', 'd', 'u', 'o', 'r', 'Escape', '?', 'ArrowLeft']) {
    assert.equal(proofShortcut(key(k), { ...state, editable: true }), undefined);
    for (const guard of ['isComposing', 'metaKey', 'ctrlKey'])
      assert.equal(proofShortcut(key(k, { [guard]: true }), state), undefined);
    assert.equal(proofShortcut(key(k, { altKey: true }), state), k === 'ArrowLeft' ? 'dock' : undefined);
  }
  for (const k of ['S', 'R', 'V', 'C', 'D', 'A', ' ', 'Escape'])
    assert.equal(proofShortcut(key(k, { shiftKey: true }), state), undefined);
  assert.equal(proofShortcut(key('s'), state), undefined);
});

test('held navigation advances without a queue while repeated decisions and toggles stay guarded', () => {
  for (const k of ['ArrowLeft', 'ArrowRight', 'n']) assert.ok(proofShortcut(key(k, { repeat: true }), state));
  assert.equal(proofShortcut(key('N', { repeat: true, shiftKey: true }), state), 'previous-open');
  for (const k of ['a', 'd', 'u', 'p', 'Escape', '?'])
    assert.equal(proofShortcut(key(k, { repeat: true }), state), undefined);
});
