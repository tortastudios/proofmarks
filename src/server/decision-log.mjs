import { findingRegion, metaRegion, sourceRegions } from '../overlay/source-regions.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import { loadConfig } from '../config/index.mjs';
import { acquireReviewLock } from '../review-lock.mjs';
export async function getReviewPaths(base) {
  let config;
  try {
    config = await loadConfig(base);
  } catch (error) {
    throw Error('Config path is outside the allow-list. ' + error.message);
  }
  return Object.assign(
    Object.create(null),
    Object.fromEntries(
      config.documents.map(entry => [
        entry.id,
        {
          source: entry.source,
          findings: entry.review,
          log: entry.review.replace(/\.json$/, '.log.jsonl'),
          write: entry.write,
        },
      ]),
    ),
  );
}
export async function writableReview(base, id) {
  const entry = (await getReviewPaths(base))[id];
  if (!entry) throw Error('Review is outside the allow-list.');
  if (!entry.write) throw Error('Review is read-only.');
  return entry;
}
export const sha = value => createHash('sha256').update(value).digest('hex');
export async function withReviewLock(base, id, run) {
  base = await realpath(base);
  const entry = (await getReviewPaths(base))[id];
  if (!entry) throw Error('Review is outside the allow-list.');
  const file = path.join(base, entry.log + '.lock');
  const lock = await acquireReviewLock(file, 0o666).catch(error => {
    throw error.code === 'EEXIST' ? Error('Review is busy; retry after the current action.') : error;
  });
  try {
    return await run();
  } finally {
    await lock.close();
    await unlink(file);
  }
}
/**
 * `exact` is the source edits as made, when the caller has them: their spans are recorded as they are, since a short
 * rewrite such as "use" can appear more than once in the source.
 */
export function decisionRecord(id, action, before, after, sourceBefore, sourceAfter, exact) {
  const reverting = action === 'revert' && before.status === 'accepted';
  const textBefore = action === 'accept' ? after.before : reverting ? before.after : before.match;
  const textAfter = action === 'accept' ? after.after : reverting ? before.before : before.match;
  const edits = action === 'accept' ? after.edits : reverting ? before.edits : undefined;
  const spans = edits?.map((e, index) => {
    const made = exact?.length === edits.length ? exact[index] : undefined;
    if (made) return { target: e.target, start: made.start, end: made.end, before: made.before, after: made.after };
    const old = reverting ? e.after : e.before,
      region = e.target ? metaRegion(sourceBefore, e.target) : sourceRegions(sourceBefore)[0];
    const start = region.offset + unique(region.text, old);
    return { target: e.target, start, end: start + old.length, before: old, after: reverting ? e.before : e.after };
  });
  return {
    spans,
    eventId: randomUUID(),
    id,
    action,
    finding: before.id,
    before: { finding: before, text: textBefore },
    after: { finding: after, text: textAfter },
    timestamp: new Date().toISOString(),
    sourceShaBefore: sha(sourceBefore),
    sourceShaAfter: sha(sourceAfter),
  };
}
/** Commit journal is durable before the final findings write/response. Never truncate. */
export async function appendDecision(base, id, event) {
  return appendDecisions(base, id, [event]);
}
export async function appendDecisions(base, id, events) {
  base = await realpath(base);
  const entry = await writableReview(base, id);
  if (events.some(event => event.id !== id)) throw Error('Review is outside the allow-list.');
  const file = path.join(base, entry.log);
  // Refuse redirecting the append into a symlink, and refuse partial/corrupt journals.
  try {
    if ((await realpath(file)) !== file) throw Error('Log resolves outside the allow-list.');
    const raw = await readFile(file, 'utf8');
    if (raw && !raw.endsWith('\n')) throw Error('Incomplete decision log; preserve and repair before appending.');
    for (const line of raw.trim().split('\n').filter(Boolean)) JSON.parse(line);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const handle = await open(file, 'a');
  try {
    await handle.writeFile(events.map(event => JSON.stringify(event) + '\n').join(''));
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function atomic(file, bytes) {
  const temp = file + '.' + randomUUID() + '.tmp';
  const handle = await open(temp, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
function unique(source, text) {
  if (!text) return -1;
  const start = source.indexOf(text);
  if (start >= 0 && source.indexOf(text, start + 1) >= 0) throw Error('Replay text is ambiguous.');
  return start;
}
function transactionProjection(records, projection, review) {
  const projected = { ...review, ...structuredClone(projection.reviewAfter) };
  for (const event of records.slice(records.indexOf(projection) + 1)) {
    if (!String(event.action).startsWith('rewrite.') || !event.after?.finding) continue;
    const next = event.after.finding,
      index = projected.findings.findIndex(f => f.id === next.id && f.rule === next.rule && f.match === next.match);
    if (index >= 0) {
      projected.findings[index] = next;
      projected.proofmarksEventCursor = event.eventId;
    }
  }
  return projected;
}
/** Reduce journal to the latest decision per finding, then validate all edits before writing. */
export async function replayDecisions(base, id) {
  base = await realpath(base);
  return withReviewLock(base, id, async () => {
    const entry = await writableReview(base, id),
      sourceFile = path.join(base, entry.source),
      reviewFile = path.join(base, entry.findings),
      logFile = path.join(base, entry.log);
    for (const file of [sourceFile, reviewFile, logFile])
      if ((await realpath(file)) !== file) throw Error('Replay path resolves outside the allow-list.');
    const [sourceBytes, reviewBytes, log] = await Promise.all([
      readFile(sourceFile, 'utf8'),
      readFile(reviewFile, 'utf8'),
      readFile(logFile, 'utf8'),
    ]);
    if (!log.endsWith('\n')) throw Error('Incomplete decision log.');
    const records = log
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    const projection = records.filter(event => event.reviewAfter).at(-1);
    const projectedTransaction = projection
      ? transactionProjection(records, projection, JSON.parse(reviewBytes))
      : undefined;
    if (
      projection &&
      projection.id === id &&
      projection.sourceShaAfter === sha(sourceBytes) &&
      (projection.reviewShaBefore === sha(reviewBytes) ||
        JSON.stringify(projectedTransaction, null, 2) + '\n' === reviewBytes)
    ) {
      const next = JSON.stringify(projectedTransaction, null, 2) + '\n';
      if (next !== reviewBytes) await atomic(reviewFile, next);
      return {
        id,
        changed: next !== reviewBytes,
        decisions: records.filter(e => !String(e.action).startsWith('rewrite.')).length,
        sourceSha: sha(sourceBytes),
      };
    }
    const review = JSON.parse(reviewBytes);
    if (review.source !== entry.source) throw Error('Review source is outside the allow-list.');
    const latest = new Map(),
      history = new Map(),
      copies = new Map();
    for (const line of log.split('\n').filter(Boolean)) {
      const event = JSON.parse(line);
      if (['rewrite.requested', 'rewrite.claimed', 'rewrite.proposed', 'rewrite.failed'].includes(event.action))
        continue;
      if (
        event.id !== id ||
        !['accept', 'dismiss', 'revert', 'restore', 'supersede', 'unsupersede', 'carry', 'uncarry'].includes(
          event.action,
        ) ||
        event.finding !== event.after?.finding?.id ||
        event.finding !== event.before?.finding?.id ||
        typeof event.before.text !== 'string' ||
        typeof event.after.text !== 'string' ||
        !event.timestamp ||
        !event.sourceShaBefore ||
        !event.sourceShaAfter
      )
        throw Error('Invalid decision log entry.');
      for (const span of event.spans ?? []) {
        if (!span.target || JSON.stringify(span.target) === JSON.stringify(event.after.finding.target)) continue;
        if (typeof span.before !== 'string' || typeof span.after !== 'string') throw Error('Invalid decision span.');
        const key = event.finding + ':' + JSON.stringify(span.target),
          copy = copies.get(key) ?? { target: span.target, texts: new Set() };
        copy.texts.add(span.before);
        copy.texts.add(span.after);
        copy.desired = span.after;
        copies.set(key, copy);
      }
      latest.set(event.finding, event);
      const texts = history.get(event.finding) ?? new Set();
      texts.add(event.before.text);
      texts.add(event.after.text);
      history.set(event.finding, texts);
    }
    let source = sourceBytes;
    const findings = structuredClone(review.findings);
    for (const [findingId, event] of latest) {
      const index = findings.findIndex(f => f.id === findingId);
      if (index < 0) throw Error('Replay finding is missing.');
      // Finding definitions may not silently change beneath historical decisions.
      // A later rewrite version may follow an Undo; the decided text must still be one of the finding's versions.
      const versions = findings[index].proposals?.map(v => v.text) ?? [];
      if (
        findings[index].match !== event.after.finding.match ||
        (findings[index].proposed !== event.after.finding.proposed && !versions.includes(event.after.finding.proposed))
      )
        throw Error('Replay finding definition changed.');
      if (['supersede', 'unsupersede', 'carry', 'uncarry'].includes(event.action)) {
        findings[index] = event.after.finding;
        continue;
      }
      const desired = event.after.text;
      const region = findingRegion(
        source,
        { ...event.after.finding, match: event.before.text, after: event.after.text },
        true,
      );
      if (unique(region.text, desired) < 0) {
        const candidates = [...history.get(findingId)].filter(
          text => text !== desired && unique(region.text, text) >= 0,
        );
        if (candidates.length !== 1) throw Error('Replay requires one exact before/after match.');
        const old = candidates[0],
          at = region.offset + unique(region.text, old);
        source = source.slice(0, at) + desired + source.slice(at + old.length);
      }
      const later =
        findings[index].proposed !== event.after.finding.proposed
          ? {
              proposed: findings[index].proposed,
              proposals: findings[index].proposals,
              rewriteRequest: findings[index].rewriteRequest,
            }
          : {};
      findings[index] = { ...event.after.finding, ...(event.after.finding.status === 'open' ? later : {}) };
    }
    for (const copy of copies.values()) {
      const region = metaRegion(source, copy.target);
      if (unique(region.text, copy.desired) < 0) {
        const candidates = [...copy.texts].filter(t => unique(region.text, t) >= 0);
        if (candidates.length !== 1) throw Error('Replay requires one exact hidden copy.');
        const old = candidates[0],
          at = region.offset + unique(region.text, old);
        source = source.slice(0, at) + copy.desired + source.slice(at + old.length);
      }
    }
    const projected =
      projection && projection.sourceShaAfter === sha(source) ? projectedTransaction : { ...review, findings };
    const nextReview = JSON.stringify(projected, null, 2) + '\n';
    if (
      (await readFile(sourceFile, 'utf8')) !== sourceBytes ||
      (await readFile(reviewFile, 'utf8')) !== reviewBytes ||
      (await readFile(logFile, 'utf8')) !== log
    )
      throw Error('Files changed during replay.');
    const changed = source !== sourceBytes || JSON.stringify(review) !== JSON.stringify(projected);
    if (changed) {
      if (source !== sourceBytes) await atomic(sourceFile, source);
      await atomic(reviewFile, nextReview);
    }
    return { id, changed, decisions: latest.size, sourceSha: sha(source) };
  });
}
