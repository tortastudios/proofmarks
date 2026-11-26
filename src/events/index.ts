import { randomUUID } from 'node:crypto';
import { open, readFile, realpath } from 'node:fs/promises';
import { watch, watchFile, unwatchFile } from 'node:fs';
import { projectMdx, loadRegistry } from '../detect/index';
import { atomicJson, ReviewError, type ReviewFinding, type Snapshot, type ReviewStore } from '../companion/state';
import { nextVersion, rewriteVersions } from '../versions';
import { acquireReviewLock } from '../review-lock.mjs';
export type EventType =
  | 'rewrite.requested'
  | 'rewrite.claimed'
  | 'rewrite.proposed'
  | 'rewrite.failed'
  | 'decision.accepted'
  | 'decision.dismissed'
  | 'decision.undone';
export type ProofmarksEvent = {
  v: 1;
  id: string;
  type: EventType;
  at: string;
  reviewId: string;
  findingId: string;
  rule: string;
  target?: string;
  version?: number;
  previous?: string[];
  original?: string;
  paragraph?: string;
  why?: string;
  by?: string;
  text?: string;
  stillFlagged?: boolean;
  reason?: string;
};
export function paragraph(source: string, finding: ReviewFinding) {
  const matches = projectMdx(source).filter(block => block.text.includes(finding.match));
  return matches.length === 1 ? matches[0]!.text : finding.match;
}
export function projectEvent(entry: Record<string, unknown>, reviewId: string): ProofmarksEvent | undefined {
  const before = entry.before as { finding?: ReviewFinding } | undefined,
    after = entry.after as { finding?: ReviewFinding } | undefined;
  const finding = after?.finding ?? before?.finding;
  if (!finding) return;
  const type =
    typeof entry.action === 'string' && (entry.action.startsWith('rewrite.') || entry.action.startsWith('decision.'))
      ? entry.action
      : (
          {
            accept: 'decision.accepted',
            dismiss: 'decision.dismissed',
            revert: 'decision.undone',
            restore: 'decision.undone',
          } as Record<string, string>
        )[String(entry.action)];
  if (
    ![
      'rewrite.requested',
      'rewrite.claimed',
      'rewrite.proposed',
      'rewrite.failed',
      'decision.accepted',
      'decision.dismissed',
      'decision.undone',
    ].includes(type ?? '')
  )
    return;
  if (typeof entry.eventId !== 'string' || typeof entry.timestamp !== 'string') return;
  const request = finding.rewriteRequest,
    previous = type === 'rewrite.requested' ? rewriteVersions(finding).map(v => v.text) : [];
  return {
    v: 1,
    id: entry.eventId,
    type: type as EventType,
    at: entry.timestamp,
    reviewId,
    findingId: finding.id,
    rule: finding.rule,
    ...(request?.target ? { target: request.target } : {}),
    ...((type as EventType).startsWith('rewrite.')
      ? {
          version:
            request?.version ?? (type === 'rewrite.proposed' ? rewriteVersions(finding).length : nextVersion(finding)),
        }
      : {}),
    ...(previous.length ? { previous } : {}),
    ...(type === 'rewrite.requested'
      ? { original: finding.match, paragraph: String(entry.paragraph ?? finding.match), why: String(entry.why ?? '') }
      : {}),
    ...(type === 'rewrite.claimed' ? { by: request?.claimedBy } : {}),
    ...(type === 'rewrite.proposed'
      ? { by: request?.by, text: finding.proposed ?? '', stillFlagged: !!request?.stillFlagged }
      : {}),
    ...(type === 'rewrite.failed'
      ? { by: request?.claimedBy ?? request?.target, reason: request?.error ?? 'Rewrite failed' }
      : {}),
  };
}
export async function eventFeed(store: ReviewStore, cursor: Record<string, string> = {}) {
  const events: ProofmarksEvent[] = [],
    next = { ...cursor };
  for (const review of await store.list()) {
    const snapshot = await store.read(review.reviewId);
    let raw = '';
    try {
      raw = await readFile(snapshot.log, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (raw && !raw.endsWith('\n')) throw new ReviewError('Decision log is incomplete');
    const rows = raw
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as Record<string, unknown>);
    const start = cursor[review.reviewId] ? rows.findIndex(row => row.eventId === cursor[review.reviewId]) + 1 : 0;
    if (cursor[review.reviewId] && start === 0) throw new ReviewError('Unknown event cursor');
    for (const row of rows.slice(start)) {
      const event = projectEvent(row, review.reviewId);
      if (event) events.push(event);
    }
    const last = rows.at(-1);
    if (typeof last?.eventId === 'string') next[review.reviewId] = last.eventId;
  }
  return { events, cursor: next };
}
export async function journalEvent(snapshot: Snapshot, before: ReviewFinding, after: ReviewFinding, type: EventType) {
  const rule = loadRegistry().rules.find(rule => rule.id === before.rule);
  const record = {
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    id: snapshot.reviewId,
    beforeRevision: snapshot.revision,
    action: type,
    finding: before.id,
    before: { finding: before },
    after: { finding: after },
    paragraph: paragraph(snapshot.source, before),
    why: rule?.why ?? '',
  };
  let raw = '';
  try {
    if ((await realpath(snapshot.log)) !== snapshot.log) throw new ReviewError('Decision log must not be a symlink');
    raw = await readFile(snapshot.log, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (raw && !raw.endsWith('\n')) throw new ReviewError('Decision log is incomplete');
  for (const line of raw.split('\n').filter(Boolean)) JSON.parse(line);
  const log = await open(snapshot.log, 'a', 0o600);
  try {
    await log.writeFile(JSON.stringify(record) + '\n');
    await log.sync();
  } finally {
    await log.close();
  }
  return record.eventId;
}
/** Journal first under the same lock used by page decisions and provider proposals. */
export async function updateRequest(
  store: ReviewStore,
  reviewId: string,
  findingId: string,
  change: (finding: ReviewFinding, snapshot: Snapshot) => ReviewFinding | undefined,
  type?: EventType,
) {
  const initial = await store.read(reviewId);
  store.assertMutable(initial);
  const lock = await acquireReviewLock(initial.log + '.lock').catch(() => {
    throw new ReviewError('Review is busy; retry after the current action');
  });
  try {
    const snapshot = await store.read(reviewId);
    const before = snapshot.review!.findings.find(f => f.id === findingId);
    if (!before) throw new ReviewError('Finding does not exist');
    const after = change(before, snapshot);
    if (!after) return before;
    const eventId = type ? await journalEvent(snapshot, before, after, type) : undefined;
    await atomicJson(snapshot.file, {
      ...snapshot.review,
      ...(eventId ? { proofmarksEventCursor: eventId } : {}),
      findings: snapshot.review!.findings.map(f => (f.id === findingId ? after : f)),
    });
    return after;
  } finally {
    await lock.close();
    const { unlink } = await import('node:fs/promises');
    await unlink(initial.log + '.lock');
  }
}
export async function expireClaims(store: ReviewStore, now = Date.now()) {
  const expired = (finding: ReviewFinding) =>
    finding.rewriteRequest?.status === 'claimed' && now - Date.parse(finding.rewriteRequest.claimedAt ?? '') >= 120000;
  for (const entry of await store.list()) {
    if (!entry.writable) continue;
    const snapshot = await store.read(entry.reviewId);
    for (const finding of snapshot.review!.findings) {
      if (!expired(finding)) continue;
      await updateRequest(
        store,
        entry.reviewId,
        finding.id,
        f =>
          expired(f)
            ? {
                ...f,
                rewriteRequest: {
                  ...f.rewriteRequest,
                  status: 'pending',
                  claimedBy: undefined,
                  claimedAt: undefined,
                },
              }
            : undefined,
        'rewrite.requested',
      );
    }
  }
}
export async function claim(store: ReviewStore, reviewId: string, findingId: string, by: string) {
  await expireClaims(store);
  return updateRequest(
    store,
    reviewId,
    findingId,
    f => {
      if ((f.status ?? 'open') !== 'open' || f.rewriteRequest?.status !== 'pending')
        throw new ReviewError('This rewrite is not pending or is already claimed');
      if (f.rewriteRequest.target && f.rewriteRequest.target !== by)
        throw new ReviewError('This rewrite is targeted at another agent');
      return {
        ...f,
        rewriteRequest: { ...f.rewriteRequest, status: 'claimed', claimedBy: by, claimedAt: new Date().toISOString() },
      };
    },
    'rewrite.claimed',
  );
}
/** The events of a feed aimed at one agent; rewrite events only while their proof is still open. */
export async function targetedEvents(store: ReviewStore, events: readonly ProofmarksEvent[], agent: string) {
  const targeted: ProofmarksEvent[] = [];
  for (const event of events) {
    if (event.target !== agent) continue;
    if (event.type.startsWith('rewrite.')) {
      const current = (await store.read(event.reviewId)).review!.findings.find(f => f.id === event.findingId);
      if (!current || (current.status ?? 'open') !== 'open') continue;
      // A rewrite the agent asked for itself (self-driving) isn't news to it: pushed back, it read as the writer asking.
      if (event.type === 'rewrite.requested' && current.rewriteRequest?.requestedBy === agent) continue;
    }
    targeted.push(event);
  }
  return targeted;
}
/** Follow the events aimed at one agent from now on, in order, for a host that delivers them itself (the pi extension). */
export async function followTargeted(store: ReviewStore, agent: string, deliver: (event: ProofmarksEvent) => void) {
  let cursor = (await eventFeed(store)).cursor,
    closed = false,
    scanning = false,
    again = false;
  const scan = async () => {
    if (closed) return;
    if (scanning) {
      again = true;
      return;
    }
    scanning = true;
    try {
      const feed = await eventFeed(store, cursor);
      for (const event of await targetedEvents(store, feed.events, agent)) if (!closed) deliver(event);
      cursor = feed.cursor;
    } catch {
      /* A journal may be in the middle of an append; the next change retries. */
    } finally {
      scanning = false;
      if (again && !closed) {
        again = false;
        void scan();
      }
    }
  };
  const unwatch = watchLogs(store, () => void scan());
  return {
    close() {
      closed = true;
      unwatch();
    },
  };
}
export function watchLogs(store: ReviewStore, notify: () => void) {
  let closed = false;
  const closes: (() => void)[] = [];
  let fallback = false;
  const statWatch = (file: string) => {
    const callback = () => notify();
    watchFile(file, { interval: 200, persistent: false }, callback);
    closes.push(() => unwatchFile(file, callback));
  };
  const startFallback = () => {
    if (fallback || closed) return;
    fallback = true;
    if (store.config)
      for (const doc of store.config.documents) {
        statWatch(doc.logPath);
        statWatch(doc.reviewPath);
      }
    else
      void store
        .list()
        .then(async entries => {
          for (const entry of entries) {
            if (closed) break;
            const snapshot = await store.read(entry.reviewId);
            statWatch(snapshot.log);
            statWatch(snapshot.file);
          }
        })
        .catch(() => {});
  };
  const directories = new Set(
    store.config?.documents.map(doc => doc.reviewPath.slice(0, doc.reviewPath.lastIndexOf('/'))) ?? [store.reviewsDir],
  );
  for (const dir of directories)
    try {
      const watcher = watch(dir, (_event, file) => {
        if (file?.toString().endsWith('.log.jsonl') || file?.toString().endsWith('.json')) notify();
      });
      watcher.on('error', () => {
        watcher.close();
        startFallback();
      });
      closes.push(() => watcher.close());
    } catch {
      startFallback();
    }
  return () => {
    closed = true;
    closes.forEach(close => close());
  };
}
