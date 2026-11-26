import { sourceOrderedReview } from '../companion/order';
import { adapterFor, matchRegion, type Format } from '../adapters/index';
import { affectedFindings } from './overlap';
import { recoverRequests } from '../events/recovery';
import type { ReviewDocument } from '../companion/state';
import { agentStatus } from '../agents/index';
import { loadRegistry } from '../detect/index';
import { paragraph } from '../events/index';
import type { ReviewFinding } from '../companion/state';
import { loadConfig } from '../config/index.mjs';
import { registryReview, editType } from '../overlay/registry';
import { editSpan, replacementStart, tidyDeletion } from '../overlay/deletion';
import {
  preferredRegion,
  sourceRegions,
  metaRegion,
  findingTarget,
  hiddenCopies,
  sameTarget,
} from '../overlay/source-regions.mjs';
import { reconcileReview } from '../overlay/reconcile';
import {
  appendDecision,
  appendDecisions,
  decisionRecord,
  sha,
  getReviewPaths,
  writableReview,
  withReviewLock,
} from './decision-log.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, rename, unlink, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import type { ProofmarksFinding, ProofmarksReview, ProofmarksTarget, ProofmarksEdit } from '../overlay/types';
import { nextVersion, rewriteVersions } from '../versions';

export type Action = 'accept' | 'dismiss' | 'revert' | 'restore';

export async function sourcePath(base: string, source: string) {
  try {
    const document = (await loadConfig(base)).documents.find(entry => entry.source === source);
    if (!document) throw new Error('Source is outside the allow-list.');
    return document.sourcePath;
  } catch (error) {
    throw new Error('Source is outside the allow-list. ' + (error as Error).message);
  }
}

/** A normalized character retains the exact source span for reversible edits. */
export function sourceMatch(source: string, match: string, target?: ProofmarksTarget, format: Format = 'mdx') {
  if (!target && (format === 'html' || format === 'jinja')) return matchRegion(source, match, format);
  const original = source;
  const region = target ? metaRegion(source, target) : preferredRegion(source, [match]);
  source = region.text;
  let text = '';
  const starts: number[] = [],
    ends: number[] = [];
  for (let i = 0; i < source.length; i++) {
    let char = source[i]!.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    if (/\s/.test(char)) char = ' ';
    if (char === ' ' && text.endsWith(' ')) {
      ends[ends.length - 1] = i + 1;
      continue;
    }
    text += char;
    starts.push(i);
    ends.push(i + 1);
  }
  const needle = match.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  if (!needle) throw new Error('The match is empty.');
  const first = text.indexOf(needle);
  if (first < 0) throw new Error('Source text no longer matches this finding.');
  if (text.indexOf(needle, first + 1) >= 0) throw new Error('The source match is ambiguous (more than once).');
  const span = { start: region.offset + starts[first]!, end: region.offset + ends[first + needle.length - 1]! };
  if (
    !adapterFor(format)
      .regions(original)
      .some(r => r.editable && span.start >= r.start && span.end <= r.end)
  )
    throw Error('This source span is not editable.');
  return span;
}
function exactMatch(
  source: string,
  match: string,
  target?: ProofmarksTarget,
  bodyOnly = false,
  format: Format = 'mdx',
) {
  if (!target && (format === 'html' || format === 'jinja')) {
    const matches = adapterFor(format)
      .regions(source)
      .filter(r => r.editable)
      .flatMap(r => {
        const text = source.slice(r.start, r.end);
        const at = match ? text.indexOf(match) : -1;
        if (at < 0) return [];
        if (text.indexOf(match, at + 1) >= 0) throw Error('Applied text is ambiguous; cannot revert safely.');
        return [{ start: r.start + at, end: r.start + at + match.length }];
      });
    if (matches.length !== 1) throw Error('Applied text is missing or ambiguous; cannot revert safely.');
    return matches[0]!;
  }
  const region = target
    ? metaRegion(source, target)
    : bodyOnly
      ? sourceRegions(source)[0]!
      : preferredRegion(source, [match], true);
  source = region.text;
  const start = match ? source.indexOf(match) : -1;
  if (start < 0) throw new Error('Applied text has changed; cannot revert safely.');
  if (source.indexOf(match, start + 1) >= 0) throw new Error('Applied text is ambiguous; cannot revert safely.');
  return { start: region.offset + start, end: region.offset + start + match.length };
}
function quoteStyle(proposed: string, before: string) {
  let after = proposed.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  if (/[‘’]/.test(before)) after = after.replace(/'/g, '’');
  if (/[“”]/.test(before)) {
    let open = true;
    after = after.replace(/"/g, () => {
      const quote = open ? '“' : '”';
      open = !open;
      return quote;
    });
  }
  return after;
}
const staleCopy = 'Another copy of this sentence changed. Reload to try again.';
function checkCopies(source: string, finding: ProofmarksFinding, expected: ProofmarksTarget[]) {
  const eligible = hiddenCopies(source, finding);
  if (
    expected.some(
      (target, i) =>
        !eligible.some(t => sameTarget(t, target)) || expected.slice(0, i).some(t => sameTarget(t, target)),
    )
  )
    throw Error(staleCopy);
  return eligible;
}
export function changeSource(
  source: string,
  input: ProofmarksFinding,
  action: Action,
  expectedCopies: ProofmarksTarget[] = input.hiddenCopies ?? [],
  format: Format = 'mdx',
) {
  const finding = { ...input, target: findingTarget(source, input) };
  delete finding.hiddenCopies;
  const apply = (edits: ProofmarksEdit[]) => {
    const sorted = [...edits].sort((a, b) => b.start - a.start);
    for (let i = 1; i < sorted.length; i++)
      if (sorted[i]!.end > sorted[i - 1]!.start) throw Error('Source edits overlap.');
    return sorted.reduce(
      (text, edit) => adapterFor(format).apply(text, edit, edit.after, { sourceText: true }),
      source,
    );
  };
  const status = finding.status ?? 'open';
  if (action === 'restore' && status !== 'dismissed') throw new Error('Restore requires a dismissed finding.');
  if (action === 'revert' || action === 'restore') {
    if (status === 'accepted-unrecorded') throw new Error('Accepted text has no exact revert history.');
    if (status === 'open') throw new Error('This finding is already open.');
    const next = { ...finding, status: 'open' as const };
    delete next.appliedAt;
    delete next.before;
    delete next.after;
    delete next.actionReason;
    delete next.edits;
    if (status === 'dismissed') return { source, finding: next };
    if (finding.before === undefined || finding.after === undefined)
      throw new Error('Exact revert history is missing.');
    const history = finding.edits ?? [{ target: finding.target, before: finding.before, after: finding.after }];
    // A rewrite recorded with its context is found by it. One recorded before edits kept their context, or whose context has changed
    // since, falls back to its text, which must then be the only copy.
    const placed = (edit: Pick<ProofmarksEdit, 'context' | 'after'>) => {
      if (!edit.context) return undefined;
      try {
        return editSpan(source, edit);
      } catch {
        return undefined;
      }
    };
    const edits = history.map(edit => {
      try {
        return {
          ...(edit.after === ''
            ? editSpan(source, edit)
            : (placed(edit) ?? exactMatch(source, edit.after, edit.target, !!finding.edits && !edit.target, format))),
          target: edit.target,
          before: edit.after,
          after: edit.before,
        };
      } catch (error) {
        if (!finding.target && edit.target) throw Error(staleCopy);
        throw error;
      }
    });
    if (format === 'html' || format === 'jinja')
      for (const edit of edits)
        if (
          !adapterFor(format)
            .regions(source)
            .some(r => r.editable && edit.start >= r.start && edit.end <= r.end)
        )
          throw Error('This match crosses markup or a template expression and cannot be edited.');
    return { source: apply(edits), finding: next, sourceEdits: edits };
  }
  if (status !== 'open') throw new Error('Finding has already been resolved.');
  const marked = sourceMatch(source, finding.match, finding.target, format);
  if (action === 'dismiss') return { source, finding: { ...finding, status: 'dismissed' as const } };
  const proposed = finding.proposed;
  if (proposed === undefined || (!proposed.trim() && editType(finding) !== 'delete'))
    throw new Error('No nonempty rewrite is available.');
  const replacement = (before: string, target?: ProofmarksTarget) => {
    let value = quoteStyle(proposed, before);
    if (target) {
      const region = metaRegion(source, target);
      // Preserve YAML scalar validity. Literal source histories include the escapes.
      if (region.quote === '"') value = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      else if (region.quote === "'") value = value.replace(/'/g, "''");
      else if (/[:#\n\r]|^[\[\]{},&*!|>'"%@`-]/.test(value)) throw Error('Rewrite needs a quoted metadata value.');
    }
    return value;
  };
  const companions = checkCopies(source, finding, expectedCopies);
  // A deletion in the body tidies its sentence: its period, an orphaned comma, a capital. Copies elsewhere
  // must match the marked text exactly, so a mark with copies is deleted as marked.
  const tidy =
    !proposed.trim() && !finding.target && !companions.length
      ? tidyDeletion(source, marked.start, marked.end, (text, start, end) => {
          const result = source.slice(0, start) + text + source.slice(end);
          return result.indexOf(text) === result.lastIndexOf(text);
        })
      : undefined;
  // A rewrite that opens with punctuation takes the space before the mark: ", but" for "— but".
  const span = tidy
    ? { start: tidy.start, end: tidy.end }
    : finding.target || companions.length
      ? marked
      : { start: replacementStart(source, marked.start, proposed), end: marked.end };
  const before = source.slice(span.start, span.end),
    plain = tidy ? tidy.after : replacement(before, finding.target);
  const after =
    format === 'html' || format === 'jinja'
      ? adapterFor(format)
          .apply(source, span, plain)
          .slice(span.start, source.length === span.end ? undefined : -(source.length - span.end))
      : plain;
  const edits: ProofmarksEdit[] = [{ ...span, target: finding.target, before, after }];
  for (const target of companions) {
    let copy;
    try {
      copy = exactMatch(source, before, target);
    } catch {
      throw Error(staleCopy);
    }
    edits.push({ ...copy, target, before, after: replacement(before, target) });
  }
  const updated = apply(edits);
  // Every edit keeps the text around it, so Undo and the page find a short rewrite such as ", but" where it was made,
  // not wherever the same text appears first.
  for (const edit of edits) {
    const offset =
        edit.start +
        edits
          .filter(other => other !== edit && other.end <= edit.start)
          .reduce((delta, other) => delta + other.after.length - (other.end - other.start), 0),
      end = offset + edit.after.length;
    edit.context = { left: updated.slice(Math.max(0, offset - 64), offset), right: updated.slice(end, end + 64) };
  }
  return {
    source: updated,
    finding: { ...finding, status: 'accepted' as const, appliedAt: new Date().toISOString(), before, after, edits },
    sourceEdits: edits,
  };
}
const version = (source: string, raw: string) =>
  createHash('sha256').update(source).update('\0').update(raw).digest('hex');
export async function readReview(base: string, reviewId?: string) {
  base = await realpath(base);
  if (!reviewId) throw new Error('Review identity required.');
  const config = await loadConfig(base);
  const format = config.documents.find(doc => doc.id === reviewId)?.format ?? 'mdx';
  const entry = (await getReviewPaths(base))[reviewId];
  if (!entry) throw new Error('Review is outside the allow-list.');
  const reviewPath = path.join(base, entry.findings);
  // A document nobody has reviewed yet has no file: it reads as an empty review, so the page offers its first review.
  let raw = '';
  try {
    if ((await realpath(reviewPath)) !== reviewPath) throw new Error('Review resolves outside the allow-list.');
    raw = await readFile(reviewPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const review = (raw ? JSON.parse(raw) : { source: entry.source, findings: [], rules: [] }) as ProofmarksReview;
  if (review.source !== entry.source) throw new Error('Source is outside the review allow-list.');
  const target = await sourcePath(base, entry.source);
  const source = await readFile(target, 'utf8');
  const recovered = await recoverRequests(
    review as unknown as ReviewDocument,
    source,
    raw,
    reviewPath.replace(/\.json$/, '.log.jsonl'),
  );
  return {
    format,
    review: sourceOrderedReview(recovered, source, target) as unknown as ProofmarksReview,
    raw,
    source,
    target,
    reviewPath,
    revision: version(source, raw),
  };
}
const sourceVersion = (source: string) => createHash('sha256').update(source).digest('hex');
/** Rewrites arriving change the review file every few seconds. A decision needs the source the reader saw; the review may move on, unless Accept would apply text the reader never saw. */
function current(
  data: { source: string; revision: string },
  revision: string,
  sourceRevision: string | undefined,
  exact: boolean,
) {
  if (revision !== data.revision && (exact || sourceRevision !== sourceVersion(data.source)))
    throw new Error('Source or review changed. Reload the finding and try again.');
}
export function availableReview(data: Awaited<ReturnType<typeof readReview>>) {
  const reconciled = reconcileReview(data.source, registryReview(data.review));
  return {
    ...reconciled.review,
    revision: data.revision,
    sourceRevision: sourceVersion(data.source),
    reconciliationWarnings: reconciled.warnings,
    findings: reconciled.review.findings.map(finding => {
      if (finding.status === 'superseded') return finding;
      const next = {
        ...finding,
        target: findingTarget(data.source, finding),
        hiddenCopies: hiddenCopies(data.source, finding),
      };
      delete next.actionReason;
      try {
        changeSource(
          data.source,
          { ...next },
          (next.status ?? 'open') === 'open' ? (next.proposed === undefined ? 'dismiss' : 'accept') : 'revert',
          undefined,
          data.format,
        );
      } catch (error) {
        next.actionReason = (error as Error).message;
      }
      return next;
    }),
  };
}
async function atomicWrite(file: string, data: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
let queue: Promise<unknown> = Promise.resolve();
export async function waitForSourceActions() {
  await queue;
}
/** A journal projection may precede its rename; GET waits for the owning transaction. */
export async function waitForReviewActions(base: string, reviewId?: string) {
  if (!reviewId) return;
  const entry = (await getReviewPaths(base))[reviewId];
  if (!entry) return;
  const lock = path.join(base, entry.log + '.lock');
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      await access(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Review is busy; retry after the current action.');
}
export function applySourceAction(
  base: string,
  id: string,
  action: Action,
  revision: string,
  requestedSource?: string,
  regenerate?: () => Promise<void>,
  timing?: (name: string, ms: number) => void,
  reviewId?: string,
  expectedCopies: ProofmarksTarget[] = [],
  version?: number,
  sourceRevision?: string,
) {
  if (!reviewId) return Promise.reject(new Error('Review identity required.'));
  const result = queue.then(() =>
    withReviewLock(base, reviewId, async () => {
      const data = await readReview(base, reviewId);
      await writableReview(base, reviewId);
      if (requestedSource !== undefined && requestedSource !== data.review.source)
        throw new Error('Source is outside the allow-list.');

      const repaired = reconcileReview(data.source, data.review).review;
      let finding = repaired.findings.find(f => f.id === id);
      if (!finding) throw new Error('Unknown finding.');
      if (action === 'accept' && version !== undefined) {
        // The reader accepts the version on screen; history keeps every version.
        const chosen = rewriteVersions(finding).find(v => v.version === version);
        if (!chosen) throw new Error('That rewrite version is no longer available. Reload and try again.');
        finding = {
          ...finding,
          proposed: chosen.text,
          rewriteRequest: finding.rewriteRequest && { ...finding.rewriteRequest, stillFlagged: chosen.stillFlagged },
        };
      }
      if (action === 'accept') checkCopies(data.source, finding, expectedCopies);
      if (action === 'revert' && finding.edits?.some(e => e.target))
        changeSource(data.source, finding, action, undefined, data.format);
      current(data, revision, sourceRevision, action === 'accept' && version === undefined);
      const changed = changeSource(data.source, finding, action, expectedCopies, data.format);
      const request = finding.rewriteRequest;
      if (request && ['pending', 'claimed'].includes(request.status))
        changed.finding = {
          ...changed.finding,
          rewriteRequest: { ...request, status: 'failed', error: 'Cancelled' },
        };
      const affected = affectedFindings(
        data.source,
        repaired.findings,
        finding,
        changed.finding,
        'sourceEdits' in changed ? (changed.sourceEdits ?? []) : [],
        action === 'revert' || action === 'restore',
        (f, target) => sourceMatch(data.source, f.match, target, data.format),
      );
      const transactionId = randomUUID();
      const review = sourceOrderedReview(
        { ...repaired, proofmarksEventCursor: transactionId, findings: affected.findings } as unknown as ReviewDocument,
        changed.source,
        data.target,
      ) as unknown as ProofmarksReview;
      const decided = review.findings.find(f => f.id === id)!;
      const next = JSON.stringify(review, null, 2) + '\n';
      // Recheck immediately before writing; never overwrite an intervening editor save.
      if (
        (await readFile(data.target, 'utf8')) !== data.source ||
        (await readFile(data.reviewPath, 'utf8')) !== data.raw
      )
        throw new Error('Files changed while applying the finding.');
      let started = performance.now();
      if (changed.source !== data.source) await atomicWrite(data.target, changed.source);
      timing?.('write', performance.now() - started);
      started = performance.now();
      try {
        if (changed.source !== data.source) await regenerate?.();
        timing?.('rebuild', performance.now() - started);
        started = performance.now();
        if (
          (await readFile(data.target, 'utf8')) !== changed.source ||
          (await readFile(data.reviewPath, 'utf8')) !== data.raw
        )
          throw new Error('Files changed while compiling the rewrite.');
        const event = decisionRecord(
          reviewId,
          action === 'revert' && finding.status === 'dismissed' ? 'restore' : action,
          finding,
          decided,
          data.source,
          changed.source,
          'sourceEdits' in changed ? changed.sourceEdits : undefined,
        );
        if (changed.source === data.source) {
          const span = sourceMatch(data.source, finding.match, findingTarget(data.source, finding), data.format);
          event.before.text = event.after.text = data.source.slice(span.start, span.end);
        }
        const companions = affected.transitions.map(change => ({
          ...decisionRecord(reviewId, change.action, change.before, change.after, data.source, changed.source),
          beforeRevision: data.revision,
        }));
        Object.assign(event, { eventId: transactionId, reviewShaBefore: sha(data.raw), reviewAfter: review });
        await appendDecisions(base, reviewId, [...companions, event]);
        await atomicWrite(data.reviewPath, next);
        timing?.('history', performance.now() - started);
      } catch (error) {
        if (changed.source !== data.source && (await readFile(data.target, 'utf8')) === changed.source) {
          await atomicWrite(data.target, data.source);
          await regenerate?.();
        }
        throw error;
      }
      return availableReview(await readReview(base, reviewId));
    }),
  );
  queue = result.catch(() => {});
  return result;
}

/** Request one rewrite, another version of one rewrite, or every unresolved proof without a proposal, atomically. */
export function requestRewrite(
  base: string,
  revision: string,
  reviewId: string,
  id?: string,
  requestedSource?: string,
  another = false,
  sourceRevision?: string,
) {
  const result = queue.then(() =>
    withReviewLock(base, reviewId, async () => {
      const data = await readReview(base, reviewId);
      await writableReview(base, reviewId);
      if (requestedSource !== undefined && requestedSource !== data.review.source)
        throw Error('Source is outside the allow-list.');
      current(data, revision, sourceRevision, false);
      if (id !== undefined && (!id || !data.review.findings.some(f => f.id === id))) throw Error('Unknown finding.');
      if (another && id === undefined) throw Error('Another rewrite needs one finding.');
      const target = (await agentStatus(base)).resolvedTarget;
      if (!target) throw Error('No connected agent or installed rewrite CLI is available.');
      const requestedAt = new Date().toISOString();
      const eligible = (f: ProofmarksFinding) =>
        (!id || f.id === id) &&
        (f.status ?? 'open') === 'open' &&
        (another ? f.proposed !== undefined : f.proposed === undefined) &&
        !['pending', 'claimed'].includes(f.rewriteRequest?.status ?? '');
      if (another && !data.review.findings.some(eligible))
        throw Error('This proof has no rewrite to replace, or another is already on the way.');
      const review = {
        ...data.review,
        findings: data.review.findings.map(f =>
          eligible(f)
            ? { ...f, rewriteRequest: { status: 'pending' as const, version: nextVersion(f), requestedAt, target } }
            : f,
        ),
      };
      if (
        (await readFile(data.target, 'utf8')) !== data.source ||
        (await readFile(data.reviewPath, 'utf8')) !== data.raw
      )
        throw Error('Files changed while requesting rewrites.');
      let eventCursor: string | undefined;
      for (const finding of review.findings) {
        const before = data.review.findings.find(f => f.id === finding.id)!;
        if (finding.rewriteRequest !== before.rewriteRequest) {
          const rule = loadRegistry().rules.find(r => r.id === finding.rule);
          eventCursor = randomUUID();
          await appendDecision(base, reviewId, {
            eventId: eventCursor,
            timestamp: requestedAt,
            id: reviewId,
            beforeRevision: data.revision,
            action: 'rewrite.requested',
            finding: finding.id,
            before: { finding: before },
            after: { finding },
            paragraph: paragraph(data.source, finding as unknown as ReviewFinding),
            why: rule?.why ?? '',
          });
        }
      }
      await atomicWrite(
        data.reviewPath,
        JSON.stringify({ ...review, ...(eventCursor ? { proofmarksEventCursor: eventCursor } : {}) }, null, 2) + '\n',
      );
      return availableReview(await readReview(base, reviewId));
    }),
  );
  queue = result.catch(() => {});
  return result;
}
