import test from 'node:test';
import assert from 'node:assert/strict';
import { keepCurrent } from './live';

// A window with controllable time, visibility and change streams.
function fakeWindow(withStream = true) {
  let now = 0,
    next = 1,
    visibility = 'visible';
  const timers = new Map<number, { at: number; every?: number; run: () => void }>(),
    listeners: (() => void)[] = [],
    streams: FakeSource[] = [];
  class FakeSource {
    handlers: Record<string, (() => void)[]> = {};
    closed = false;
    constructor(readonly url: string) {
      streams.push(this);
    }
    addEventListener(type: string, run: () => void) {
      (this.handlers[type] ??= []).push(run);
    }
    emit(type: string) {
      for (const run of this.handlers[type] ?? []) run();
    }
    close() {
      this.closed = true;
    }
  }
  const schedule = (run: () => void, ms: number, every?: number) => {
    const id = next++;
    timers.set(id, { at: now + ms, every, run });
    return id;
  };
  const win = {
    setTimeout: (run: () => void, ms: number) => schedule(run, ms),
    setInterval: (run: () => void, ms: number) => schedule(run, ms, ms),
    clearTimeout: (id?: number) => {
      if (id !== undefined) timers.delete(id);
    },
    clearInterval: (id?: number) => {
      if (id !== undefined) timers.delete(id);
    },
    document: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (_: string, run: () => void) => listeners.push(run),
      removeEventListener: () => {},
    },
    ...(withStream ? { EventSource: FakeSource } : {}),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      now = timer.at;
      if (timer.every) timer.at += timer.every;
      else timers.delete(id);
      timer.run();
    }
    now = end;
  };
  const show = (state: string) => {
    visibility = state;
    for (const run of listeners) run();
  };
  return { win: win as unknown as Window, streams, advance, show, pending: () => timers.size };
}
function counter() {
  const calls = { review: 0, agents: 0, status: 0 };
  return {
    calls,
    refresh: { review: () => calls.review++, agents: () => calls.agents++, status: () => calls.status++ },
  };
}

test('a visible page follows the change stream and fetches only when told', () => {
  const { win, streams, advance } = fakeWindow(),
    { calls, refresh } = counter();
  const stop = keepCurrent(win, 'http://127.0.0.1:4848/__proofmarks/changes?reviewId=essay', refresh);
  assert.equal(streams.length, 1);
  streams[0]!.emit('ready');
  assert.deepEqual(calls, { review: 1, agents: 1, status: 1 });
  advance(20000);
  assert.deepEqual(calls, { review: 1, agents: 1, status: 1 }, 'nothing is asked while nothing changes');
  streams[0]!.emit('review');
  streams[0]!.emit('agents');
  assert.deepEqual(calls, { review: 2, agents: 2, status: 1 });
  advance(10000);
  assert.deepEqual(calls, { review: 3, agents: 3, status: 2 }, 'the 30 s safety check');
  stop();
  assert.equal(streams[0]!.closed, true);
});

test('a stream that never says ready falls back to asking as before', () => {
  const { win, streams, advance } = fakeWindow(),
    { calls, refresh } = counter();
  keepCurrent(win, 'http://127.0.0.1:4849/__proofmarks/changes?reviewId=essay', refresh);
  advance(5000);
  assert.equal(streams[0]!.closed, true);
  assert.deepEqual(calls, { review: 1, agents: 1, status: 1 }, 'catches up as it switches');
  advance(5000);
  assert.deepEqual(calls, { review: 5, agents: 2, status: 2 });
});

test('without EventSource or a review, the page asks as before', () => {
  for (const [stream, url] of [
    [false, 'http://x/changes'],
    [true, undefined],
  ] as const) {
    const { win, advance } = fakeWindow(stream),
      { calls, refresh } = counter();
    keepCurrent(win, url, refresh);
    advance(6000);
    assert.deepEqual(calls, { review: 6, agents: 2, status: 2 });
  }
});

test('a hidden tab neither streams nor asks, and catches up when shown', () => {
  const { win, streams, advance, show, pending } = fakeWindow(),
    { calls, refresh } = counter();
  keepCurrent(win, 'http://127.0.0.1:4848/__proofmarks/changes?reviewId=essay', refresh);
  streams[0]!.emit('ready');
  show('hidden');
  assert.equal(streams[0]!.closed, true);
  assert.equal(pending(), 0);
  advance(120000);
  assert.deepEqual(calls, { review: 1, agents: 1, status: 1 });
  show('visible');
  assert.equal(streams.length, 2);
  assert.equal(streams[1]!.closed, false);
  streams[1]!.emit('ready');
  assert.deepEqual(calls, { review: 2, agents: 2, status: 2 }, 'catches up once the stream is back');
});

test('a dropped stream checks whether the helper is still there', () => {
  const { win, streams } = fakeWindow(),
    { calls, refresh } = counter();
  keepCurrent(win, 'http://127.0.0.1:4848/__proofmarks/changes?reviewId=essay', refresh);
  streams[0]!.emit('ready');
  streams[0]!.emit('error');
  assert.equal(calls.status, 2);
  streams[0]!.emit('ready');
  assert.deepEqual(calls, { review: 2, agents: 2, status: 3 }, 'catches up after reconnecting');
});
