import { readFile } from 'node:fs/promises';
import { loadConfig } from '../config/index';
import { adapterFor } from '../adapters/index';
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export async function matchDocument(projectRoot: string, input: Record<string, unknown>) {
  if (
    Object.keys(input).some(key => !['url', 'sample'].includes(key)) ||
    typeof input.url !== 'string' ||
    typeof input.sample !== 'string' ||
    input.sample.length > 4000
  )
    throw Object.assign(new Error('Match takes a URL and up to 4,000 characters of article text.'), { status: 400 });
  let pathname: string;
  try {
    pathname = new URL(input.url, 'http://localhost').pathname;
  } catch {
    throw new Error('Invalid page URL.');
  }
  const config = await loadConfig(projectRoot);
  const patterns = config.documents.filter(
    doc =>
      doc.url &&
      new RegExp(
        '^' +
          doc.url
            .split('*')
            .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*') +
          '$',
      ).test(pathname),
  );
  if (patterns.length === 1) return { reviewId: patterns[0]!.id };
  if (patterns.length > 1)
    return { reviewId: null, reason: 'More than one configured document matches this page URL.' };
  const sample = normalize(input.sample);
  if (sample.length < 40) return { reviewId: null, reason: 'Add a document URL pattern in proofmarks.config.json.' };
  const words = sample.split(' ');
  const grams = words.slice(0, -4).map((_, i) => words.slice(i, i + 5).join(' '));
  const scores = await Promise.all(
    config.documents.map(async doc => {
      const source = await readFile(doc.sourcePath, 'utf8');
      const text = normalize(
        adapterFor(doc.format)
          .regions(source)
          .filter(r => r.kind === 'body' && r.editable)
          .map(r => r.text)
          .join(' '),
      );
      return { id: doc.id, score: grams.filter(gram => text.includes(gram)).length / Math.max(1, grams.length) };
    }),
  );
  scores.sort((a, b) => b.score - a.score);
  return scores[0] && scores[0].score >= 0.7 && (!scores[1] || scores[0].score - scores[1].score >= 0.15)
    ? { reviewId: scores[0].id }
    : { reviewId: null, reason: 'No unique source match. Add a document URL pattern in proofmarks.config.json.' };
}
