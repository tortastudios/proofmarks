import { sourceOrderedReview } from './order';
import { recoverRequests } from '../events/recovery';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, unlink, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { findConfig } from './config';
import type { ProofmarksConfig } from '../config/index';
import type { RewriteVersion } from '../versions';
import { acquireReviewLock } from '../review-lock.mjs';
export type AfterScore = { probability: number; provider: string; model: string };
export type ReviewFinding = {
  id: string;
  rule: string;
  match: string;
  status?: string;
  proposed?: string;
  proposals?: RewriteVersion[];
  edit?: string;
  level?: string;
  focus?: { start: number; end: number };
  span?: { start: number; end: number };
  rewriteRequest?: {
    status: 'pending' | 'claimed' | 'proposed' | 'failed';
    version?: number;
    target?: string;
    claimedBy?: string;
    claimedAt?: string;
    error?: string;
    requestedAt?: string;
    /** The agent that asked for this rewrite itself, in self-driving; a request from the page has none. */
    requestedBy?: string;
    proposedAt?: string;
    by?: string;
    stillFlagged?: boolean;
  };
  judge?: { threshold?: number; probability?: number; score?: number; after?: AfterScore; [key: string]: unknown };
  [key: string]: unknown;
};
export type ReviewDocument = {
  source: string;
  findings: ReviewFinding[];
  rules: Record<string, unknown>[];
  [key: string]: unknown;
};
export type Decision = {
  eventId?: string;
  timestamp?: string;
  action: string;
  finding?: string;
  before?: { finding?: ReviewFinding; text?: string };
  after?: { finding?: ReviewFinding; text?: string };
  [key: string]: unknown;
};
export type Snapshot = {
  reviewId: string;
  file: string;
  log: string;
  sourceFile: string;
  source: string;
  raw: string;
  review?: ReviewDocument;
  revision: string;
};
export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewError';
  }
}
export const normalize = (text: string) =>
  text.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
export const identity = (finding: Pick<ReviewFinding, 'rule' | 'match'>) =>
  finding.rule + '\0' + normalize(finding.match);
export const revision = (source: string, raw: string) =>
  createHash('sha256').update(source).update('\0').update(raw).digest('hex');
export const within = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
async function safeRead(file: string, missing = false): Promise<string> {
  try {
    if ((await realpath(file)) !== file) throw new ReviewError('Symlink paths are not allowed');
    return await readFile(file, 'utf8');
  } catch (error) {
    if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}
export async function atomicJson(file: string, value: unknown) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(() => {});
  }
}
async function exclusive<T>(file: string, run: () => Promise<T>): Promise<T> {
  let handle;
  try {
    handle = await acquireReviewLock(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new ReviewError('Review is busy; retry after the current action');
    throw error;
  }
  try {
    return await run();
  } finally {
    await handle.close();
    await unlink(file);
  }
}
type MemoryEntry = { rule: string; text: string; reviewId?: string };
export class ReviewStore {
  readonly reviewsDir: string;
  readonly projectBase: string;
  /** Without a config, reviews sit beside the documents' folder (content/essays → content/reviews) unless reviewsDir says otherwise. */
  constructor(
    readonly root: string,
    readonly config?: ProofmarksConfig,
    reviewsDir?: string,
  ) {
    this.reviewsDir = reviewsDir ?? path.resolve(root, '../reviews');
    this.projectBase = config?.projectRoot ?? path.resolve(root, '../..');
  }
  static async create(root: string, options: { reviewsDir?: string } = {}) {
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory()) throw new ReviewError('Document root must be a directory');
    return new ReviewStore(canonical, await findConfig(canonical), options.reviewsDir);
  }
  async storage() {
    await mkdir(this.reviewsDir, { recursive: true });
    if ((await realpath(this.reviewsDir)) !== this.reviewsDir)
      throw new ReviewError('Review directory must not be a symlink');
  }
  async document(file: string) {
    const absolute = await realpath(path.resolve(this.root, file));
    if (
      !(this.config?.roots ?? [this.root]).some(root => within(root, absolute)) ||
      !/\.(?:md|mdx|html?|jinja2?|j2|njk|nunjucks|twig|liquid)$/.test(absolute)
    )
      throw new ReviewError('Document is outside the allowed root');
    return absolute;
  }
  sourceReference(file: string) {
    return path.relative(this.projectBase, file);
  }
  output(file: string, out?: string) {
    if (this.config) {
      const entry = this.config.documents.find(
        entry => entry.sourcePath === file && (out ? entry.reviewPath === path.resolve(out) : entry.write),
      );
      if (!entry?.write) throw new ReviewError('Document review is not listed as writable in proofmarks.config.json');
      return entry.reviewPath;
    }
    const stem = path.basename(file).replace(/\.mdx?$/, '');
    const target = out ? path.resolve(out) : path.join(this.reviewsDir, stem + '.json');
    if (path.dirname(target) !== this.reviewsDir || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(path.basename(target)))
      throw new ReviewError('Review output is outside the allowed directory');
    if (!path.basename(target).startsWith(stem + '.'))
      throw new ReviewError('Review output does not match the document');
    return target;
  }
  id(file: string) {
    if (this.config) {
      const entry = this.config.documents.find(entry => entry.reviewPath === path.resolve(this.reviewsDir, file));
      if (!entry) throw new ReviewError('Review is not listed in proofmarks.config.json');
      return entry.id;
    }
    return path.basename(file, '.json');
  }
  file(reviewId: string) {
    if (this.config) {
      const entry = this.config.documents.find(entry => entry.id === reviewId);
      if (!entry) throw new ReviewError('Review is not listed in proofmarks.config.json');
      return entry.reviewPath;
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(reviewId) || reviewId.includes('..'))
      throw new ReviewError('Invalid review identity');
    const stem = reviewId;
    return path.join(this.reviewsDir, stem + '.json');
  }
  async capture(file: string, out?: string, readonly = false): Promise<Snapshot> {
    const sourceFile = await this.document(file);
    const target = readonly && out ? path.resolve(out) : this.output(sourceFile, out);
    if (
      this.config
        ? !this.config.documents.some(entry => entry.reviewPath === target && entry.sourcePath === sourceFile)
        : path.dirname(target) !== this.reviewsDir
    )
      throw new ReviewError('Review is outside the allowed directory');
    if (!readonly) {
      if (this.config) {
        await mkdir(path.dirname(target), { recursive: true });
        if ((await realpath(path.dirname(target))) !== path.dirname(target))
          throw new ReviewError('Review directory must not be a symlink');
      } else await this.storage();
    }
    const [source, raw] = await Promise.all([safeRead(sourceFile), safeRead(target, true)]);
    const parsed = raw ? this.parseReview(raw) : undefined;
    const review = parsed
      ? await recoverRequests(parsed, source, raw, target.replace(/\.json$/, '.log.jsonl'))
      : undefined;
    if (review && review.source !== this.sourceReference(sourceFile))
      throw new ReviewError('Review source does not match the document');
    return {
      reviewId: this.id(target),
      file: target,
      log: target.replace(/\.json$/, '.log.jsonl'),
      sourceFile,
      source,
      raw,
      review: review ? sourceOrderedReview(review, source, sourceFile) : undefined,
      revision: revision(source, raw),
    };
  }
  parseReview(raw: string): ReviewDocument {
    let value: ReviewDocument;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new ReviewError('Review JSON is invalid');
    }
    if (
      typeof value.source !== 'string' ||
      !Array.isArray(value.findings) ||
      !Array.isArray(value.rules) ||
      value.findings.some(
        f => !f || typeof f.id !== 'string' || typeof f.rule !== 'string' || typeof f.match !== 'string',
      )
    )
      throw new ReviewError('Review JSON is invalid');
    if (new Set(value.findings.map(f => f.id)).size !== value.findings.length)
      throw new ReviewError('Review finding identities are duplicated');
    return value;
  }
  async read(reviewId: string): Promise<Snapshot> {
    const target = this.file(reviewId);
    const raw = await safeRead(target);
    const review = this.parseReview(raw);
    const sourceFile = await this.document(path.resolve(this.projectBase, review.source));
    return this.capture(sourceFile, target, true);
  }
  assertMutable(snapshot: Snapshot) {
    this.output(snapshot.sourceFile, snapshot.file);
  }
  async list() {
    let files: string[];
    try {
      if ((await realpath(this.reviewsDir)) !== this.reviewsDir)
        throw new ReviewError('Review directory must not be a symlink');
      files = await readdir(this.reviewsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (!this.config) return [];
        files = [];
      } else throw error;
    }
    if (this.config) files = this.config.documents.map(entry => entry.reviewPath);
    const results = [];
    for (const file of files
      .filter(
        file =>
          file.endsWith('.json') &&
          (!this.config ||
            this.config.documents.some(entry => entry.reviewPath === path.resolve(this.reviewsDir, file))),
      )
      .sort()) {
      let snapshot: Snapshot;
      try {
        snapshot = await this.read(this.id(file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      let writable = true;
      try {
        this.assertMutable(snapshot);
      } catch {
        writable = false;
      }
      const counts: Record<string, number> = {};
      for (const finding of snapshot.review!.findings) {
        const status = finding.status ?? 'open';
        counts[status] = (counts[status] ?? 0) + 1;
      }
      results.push({
        reviewId: snapshot.reviewId,
        source: snapshot.review!.source,
        revision: snapshot.revision,
        writable,
        counts,
      });
    }
    return results;
  }
  async decisions(snapshot: Pick<Snapshot, 'log'>, since?: string): Promise<Decision[]> {
    const raw = await safeRead(snapshot.log, true);
    if (raw && !raw.endsWith('\n')) throw new ReviewError('Decision log is incomplete');
    let events: Decision[];
    try {
      events = raw
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
    } catch {
      throw new ReviewError('Decision log is invalid');
    }
    events = events.filter(event => !event.action?.startsWith('rewrite.'));
    if (
      events.some(
        event =>
          !event ||
          !['accept', 'dismiss', 'revert', 'restore', 'supersede', 'unsupersede', 'carry', 'uncarry'].includes(
            event.action,
          ) ||
          typeof event.timestamp !== 'string',
      )
    )
      throw new ReviewError('Decision log is invalid');
    if (!since) return events;
    const cursor = events.findIndex(event => event.eventId === since);
    if (cursor >= 0) return events.slice(cursor + 1);
    const timestamp = Date.parse(since);
    if (!Number.isFinite(timestamp)) throw new ReviewError('Unknown decision cursor');
    return events.filter(event => Date.parse(event.timestamp!) > timestamp);
  }
  /** Every decision across this site's reviews, for learning its eye. A log that can't be read is left out. */
  async siteDecisions() {
    const files = this.config
      ? this.config.documents.map(entry => entry.reviewPath)
      : (await readdir(this.reviewsDir).catch(() => []))
          .filter(file => file.endsWith('.json'))
          .map(file => path.join(this.reviewsDir, file));
    const events: Decision[] = [];
    for (const file of files)
      events.push(...(await this.decisions({ log: file.replace(/\.json$/, '.log.jsonl') }).catch(() => [])));
    return events;
  }
  /** When each rule's learned line was last reset, kept beside Dismiss memory. */
  async strictnessResets(): Promise<Record<string, string>> {
    const raw = await safeRead(path.join(this.root, '.proofmarks/strictness.json'), true);
    try {
      const resets = raw ? (JSON.parse(raw) as { resets?: unknown }).resets : undefined;
      return resets && typeof resets === 'object'
        ? Object.fromEntries(
            Object.entries(resets).filter(([, at]) => typeof at === 'string' && Number.isFinite(Date.parse(at))),
          )
        : {};
    } catch {
      return {};
    }
  }
  /** Forget a rule's calls so far: its line goes back to the calibrated one until new calls move it. */
  async resetStrictness(rule: string) {
    const dir = path.join(this.root, '.proofmarks');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await realpath(dir)) !== dir) throw new ReviewError('Proofmarks directory must not be a symlink');
    await exclusive(path.join(dir, 'strictness.json.lock'), async () => {
      const resets = { ...(await this.strictnessResets()), [rule]: new Date().toISOString() };
      await atomicJson(path.join(dir, 'strictness.json'), { version: 1, resets });
    });
  }
  async commit(snapshot: Snapshot, update: () => Promise<ReviewDocument>): Promise<ReviewDocument> {
    this.assertMutable(snapshot);
    return exclusive(snapshot.log + '.lock', async () => {
      const [source, raw] = await Promise.all([safeRead(snapshot.sourceFile), safeRead(snapshot.file, true)]);
      if (revision(source, raw) !== snapshot.revision)
        throw new ReviewError('Source or review changed; reload before proposing or refreshing');
      const result = sourceOrderedReview(await update(), source, snapshot.sourceFile);
      if ((await safeRead(snapshot.sourceFile)) !== source || (await safeRead(snapshot.file, true)) !== raw)
        throw new ReviewError('Source or review changed while preparing the update');
      await atomicJson(snapshot.file, result);
      return result;
    });
  }
  async dismissalKeys(snapshot: Snapshot): Promise<Set<string>> {
    const memory = await this.readMemory();
    const keys = new Set(memory.map(item => identity({ rule: item.rule, match: item.text })));
    const latest = this.dismissals(await this.decisions(snapshot));
    for (const [key, item] of latest) {
      if (item.dismissed) keys.add(key);
      else if (
        !memory.some(
          entry => entry.reviewId !== snapshot.reviewId && identity({ rule: entry.rule, match: entry.text }) === key,
        )
      )
        keys.delete(key);
    }
    return keys;
  }
  dismissals(events: Decision[]) {
    const latest = new Map<string, { finding: ReviewFinding; dismissed: boolean }>();
    for (const event of events) {
      const finding = event.before?.finding ?? event.after?.finding;
      if (!finding) continue;
      if (event.action === 'dismiss') latest.set(identity(finding), { finding, dismissed: true });
      if (event.action === 'restore' || (event.action === 'revert' && event.before?.finding?.status === 'dismissed'))
        latest.set(identity(finding), { finding, dismissed: false });
    }
    return latest;
  }
  async readMemory(): Promise<MemoryEntry[]> {
    const file = path.join(this.root, '.proofmarks/dismissed.json');
    const raw = await safeRead(file, true);
    if (!raw) return [];
    let entries: MemoryEntry[];
    try {
      const value = JSON.parse(raw);
      entries = Array.isArray(value) ? value : value.entries;
    } catch {
      throw new ReviewError('Dismiss memory is invalid');
    }
    if (
      !Array.isArray(entries) ||
      entries.some(
        item =>
          !item ||
          typeof item.rule !== 'string' ||
          typeof item.text !== 'string' ||
          (item.reviewId !== undefined && typeof item.reviewId !== 'string'),
      )
    )
      throw new ReviewError('Dismiss memory is invalid');
    return entries;
  }
  async saveDismissals(snapshot: Snapshot) {
    const dir = path.join(this.root, '.proofmarks');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await realpath(dir)) !== dir) throw new ReviewError('Dismiss memory directory must not be a symlink');
    await exclusive(path.join(dir, 'dismissed.json.lock'), async () => {
      const old = await this.readMemory();
      const latest = this.dismissals(await this.decisions(snapshot));
      const entries = old.filter(
        entry => entry.reviewId !== snapshot.reviewId || !latest.has(identity({ rule: entry.rule, match: entry.text })),
      );
      for (const item of latest.values())
        if (item.dismissed)
          entries.push({ rule: item.finding.rule, text: normalize(item.finding.match), reviewId: snapshot.reviewId });
      if (entries.length || old.length) await atomicJson(path.join(dir, 'dismissed.json'), { version: 1, entries });
    });
  }
}
/** Keep stable identities and settled history; only new open marks can be suppressed by Dismiss memory. */
export function mergeReview(
  old: ReviewDocument | undefined,
  incoming: ReviewDocument,
  dismissed: Set<string>,
): ReviewDocument {
  const previous = new Map(old?.findings.map(f => [identity(f), f]) ?? []);
  const reserved = new Set(old?.findings.map(f => f.id));
  const used = new Set<string>();
  const findings: ReviewFinding[] = [];
  for (const next of incoming.findings) {
    const key = identity(next);
    const before = previous.get(key);
    if (dismissed.has(key) || before?.status === 'dismissed') continue;
    let id = before?.id ?? next.id;
    if ((!before && reserved.has(id)) || used.has(id))
      id = 'F' + createHash('sha256').update(key).digest('hex').slice(0, 16);
    if (used.has(id)) continue;
    used.add(id);
    findings.push({
      ...before,
      ...next,
      id,
      ...(before
        ? {
            status: before.status ?? next.status,
            proposed: before.proposed,
            proposals: before.proposals,
            rewriteRequest: before.rewriteRequest,
            judge: { ...next.judge, ...(before.judge?.after ? { after: before.judge.after } : {}) },
          }
        : {}),
    });
  }
  for (const before of old?.findings ?? []) {
    if (
      !used.has(before.id) &&
      ((before.status && before.status !== 'open') ||
        (!dismissed.has(identity(before)) && (before.proposed !== undefined || before.rewriteRequest)))
    ) {
      findings.push(before);
      used.add(before.id);
    }
  }
  return { ...old, ...incoming, findings };
}

/** Recover the durable decision if the writer stopped after journaling but before its review rename. */
export function reconcileDecisions(review: ReviewDocument | undefined, events: Decision[]): ReviewDocument | undefined {
  if (!review) return review;
  const latest = new Map<string, ReviewFinding>();
  for (const event of events) if (event.after?.finding) latest.set(event.after.finding.id, event.after.finding);
  return {
    ...review,
    findings: review.findings.map(finding => {
      const decided = latest.get(finding.id);
      if (
        !decided ||
        identity(decided) !== identity(finding) ||
        (decided.status ?? 'open') === (finding.status ?? 'open')
      )
        return finding;
      return { ...finding, ...decided };
    }),
  };
}
