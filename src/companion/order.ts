import { compareSourcePosition } from '../finding-order';
import { bodyStart } from '../detect/segment';
import { inferFormat, matchRegion } from '../adapters/index';
import type { ReviewDocument } from './state';
/** Legacy reviews may lack spans. Resolve those against source without changing IDs. */
export function sourceOrderedReview(review: ReviewDocument, source: string, file: string): ReviewDocument {
  const format = inferFormat(file),
    start = bodyStart(source);
  const positions = new Map(
    review.findings.map(f => {
      let span = f.span;
      const text =
        f.status === 'accepted' || f.status === 'accepted-unrecorded'
          ? (f.proposed ?? (typeof f.after === 'string' ? f.after : f.match))
          : f.match;
      if (!span || source.slice(span.start, span.end) !== text)
        try {
          if (format === 'html' || format === 'jinja') span = matchRegion(source, text, format);
          else {
            const index = source.indexOf(text, start);
            if (index >= 0) span = { start: index, end: index + text.length };
          }
        } catch {
          /* Missing text falls back to its recorded source span. */
        }
      return [f, { span, target: f.target }];
    }),
  );
  return {
    ...review,
    findings: [...review.findings].sort((a, b) => compareSourcePosition(positions.get(a)!, positions.get(b)!)),
  };
}
