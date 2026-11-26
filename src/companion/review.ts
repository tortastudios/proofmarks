import { adapterFor, matchRegion, inferFormat } from '../adapters/index';
import path from 'node:path';
import { detect } from '../detect/index';
import type { JudgeProvider } from '../judge/types';
import type { RunnerOptions } from '../judge/runner';
import { registeredReview } from './detector';
import { mergeReview, reconcileDecisions, ReviewStore, type ReviewDocument } from './state';
import { storeStrictness } from './strictness';
export const RULES_VERSION = '3';
/** Both transports refresh through this revision-checked, locked and memory-aware path. */
export async function reviewFile(
  file: string,
  provider: JudgeProvider,
  options: {
    root?: string;
    /** Where reviews go when the project has no config; see ReviewStore. */
    reviewsDir?: string;
    out?: string;
    cacheDir?: string;
    signal?: AbortSignal;
    onEstimate?: RunnerOptions['onEstimate'];
  } = {},
): Promise<ReviewDocument> {
  const absolute = path.resolve(file);
  const store = await ReviewStore.create(options.root ?? path.dirname(absolute), { reviewsDir: options.reviewsDir });
  const snapshot = await store.capture(absolute, options.out);
  options.signal?.throwIfAborted();
  const format =
    store.config?.documents.find(doc => doc.sourcePath === snapshot.sourceFile)?.format ??
    inferFormat(snapshot.sourceFile);
  const input =
    format === 'html' || format === 'jinja'
      ? adapterFor(format)
          .regions(snapshot.source)
          .filter(r => r.editable)
          .map(r => r.text)
          .join('\n\n')
      : snapshot.source;
  const review = await registeredReview(detect, input, store.sourceReference(snapshot.sourceFile), provider, {
    ...options,
    kind: format === 'html' || format === 'jinja' ? 'text' : 'mdx',
    strictness: bases => storeStrictness(store, bases),
    rules: store.config?.rules,
  });
  if (format === 'html' || format === 'jinja')
    for (const finding of review.findings) {
      try {
        finding.span = matchRegion(snapshot.source, finding.match, format);
      } catch {
        Object.assign(finding, {
          actionReason: 'This match crosses markup or a template expression and cannot be edited.',
        });
      }
    }
  return store.commit(snapshot, async () => {
    options.signal?.throwIfAborted();
    const dismissed = await store.dismissalKeys(snapshot);
    const settled = reconcileDecisions(snapshot.review, await store.decisions(snapshot));
    const merged = mergeReview(settled, review, dismissed);
    await store.saveDismissals(snapshot);
    return merged;
  });
}
