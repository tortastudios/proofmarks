export type Refreshers = { review: () => void; agents: () => void; status: () => void };

/**
 * Keeps a page's review, agents and helper status current without asking while nothing changes.
 *
 * While the tab is visible it follows the helper's change stream and fetches only when told, with a check every 30 s
 * as a safety net. A stream that doesn't say it's ready within 5 s (a proxy holding it back, or a helper without one)
 * falls back to asking as before: the review every 1.2 s, agents and status every 5 s. A hidden tab neither streams
 * nor asks, and catches up when shown, so open tabs never use up the browser's six connections to the helper.
 */
export function keepCurrent(win: Window, url: string | undefined, refresh: Refreshers) {
  const doc = win.document;
  const Source = (win as Window & { EventSource?: typeof EventSource }).EventSource;
  let stream: EventSource | undefined,
    timers: number[] = [],
    ready: number | undefined,
    stopped = false;
  const all = () => {
    refresh.review();
    refresh.agents();
    refresh.status();
  };
  const clear = () => {
    stream?.close();
    stream = undefined;
    for (const timer of timers) win.clearInterval(timer);
    timers = [];
    win.clearTimeout(ready);
  };
  const ask = () => {
    clear();
    all();
    timers.push(
      win.setInterval(refresh.review, 1200),
      win.setInterval(() => {
        refresh.agents();
        refresh.status();
      }, 5000),
    );
  };
  const follow = () => {
    clear();
    if (!url || !Source) {
      ask();
      return;
    }
    stream = new Source(url);
    ready = win.setTimeout(ask, 5000);
    // Ready, including after a reconnect or the tab being shown again: catch up on anything that changed meanwhile.
    stream.addEventListener('ready', () => {
      win.clearTimeout(ready);
      all();
    });
    stream.addEventListener('review', () => refresh.review());
    stream.addEventListener('agents', () => refresh.agents());
    // While the stream reconnects, the status check shows whether the helper is still there.
    stream.addEventListener('error', () => refresh.status());
    timers.push(win.setInterval(all, 30000));
  };
  const visibility = () => {
    if (stopped) return;
    if (doc.visibilityState === 'hidden') clear();
    else follow();
  };
  doc.addEventListener('visibilitychange', visibility);
  if (doc.visibilityState !== 'hidden') follow();
  return () => {
    stopped = true;
    clear();
    doc.removeEventListener('visibilitychange', visibility);
  };
}
