import { readerText } from './card-prose';
/** Match the essay's two citation presentations without changing any inline elements. */
export function optimisticProse(text: string, matchedText: string) {
  const prose = text.replace(/ \(\[([^\]]+)\]\((https?:\/\/[^\s]+)\), [^)]*\)/g, (citation, label: string) =>
    matchedText.includes(label) ? citation : '',
  );
  return readerText(prose);
}
/** Markdown and MDX sources (the extensions inferFormat reads them by), or a page whose script declares Markdown prose. */
export const readsAsMarkdown = (source: string | undefined, prose?: string) =>
  prose === 'markdown' || /\.mdx?$/i.test(source ?? '');
