import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ReviewDocument, ReviewFinding } from '../companion/state';
/** Recover a durable lifecycle append if its projection rename was interrupted. */
export async function recoverRequests(review: ReviewDocument, source: string, raw: string, log: string) {
  let journal = '';
  try {
    if ((await realpath(log)) !== log) throw new Error('Decision log must not be a symlink');
    journal = await readFile(log, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return review;
    throw error;
  }
  if (journal && !journal.endsWith('\n')) throw new Error('Decision log is incomplete');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const records = journal
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const projection = records
    .filter(event => event.reviewAfter && event.reviewShaBefore === hash(raw) && event.sourceShaAfter === hash(source))
    .at(-1);
  const recovered = projection ? (projection.reviewAfter as ReviewDocument) : review;
  const beforeRevision = createHash('sha256').update(source).update('\0').update(raw).digest('hex');
  const updates = new Map<string, ReviewFinding>();
  for (const event of records) {
    if (event.beforeRevision !== beforeRevision || !String(event.action).startsWith('rewrite.')) continue;
    const next = event.after?.finding as ReviewFinding | undefined;
    if (next) updates.set(next.id, next);
  }
  if (!updates.size) return recovered;
  return {
    ...recovered,
    findings: recovered.findings.map(f => {
      const next = updates.get(f.id);
      return next && next.rule === f.rule && next.match === f.match ? next : f;
    }),
  };
}
